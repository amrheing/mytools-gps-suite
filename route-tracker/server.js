const cluster = require('cluster');
const MAX_WORKERS = 4;

// Primary process: fork workers and restart on crash
if (cluster.isPrimary) {
    const workerCount = Math.min(MAX_WORKERS, require('os').cpus().length);
    console.log(`[cluster] Primary ${process.pid} starting ${workerCount} workers`);
    for (let i = 0; i < workerCount; i++) cluster.fork();
    cluster.on('exit', (worker, code) => {
        console.log(`[cluster] Worker ${worker.process.pid} exited (code ${code}), restarting`);
        cluster.fork();
    });
    return;
}

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');
// const sharp = require('sharp');
// const exifr = require('exifr');
const nodemailer = require('nodemailer');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/app/data';

// File logger
const LOG_FILE = path.join(DATA_DIR, 'server.log');
const fsSync = require('fs');
function log(...args) {
    const line = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    console.log(line);
    try { fsSync.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}
// Patch console for unified output
const _consoleLog = console.log.bind(console);
console.log = (...args) => {
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    _consoleLog(line);
    try { fsSync.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n'); } catch (_) {}
};
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const RP_NAME = 'Route Tracker';
const RP_ID = process.env.RP_ID || 'tools.amrhein.info';
const ORIGIN = process.env.ORIGIN || 'https://tools.amrhein.info';

// Normalize credentialID to Base64URL string — handles legacy format where
// Uint8Array was stored as {"0":193,"1":28,...} before the storage bug was fixed
function normalizeCredentialIDStr(raw) {
    if (typeof raw === 'string') return raw;
    const bytes = Object.values(raw);
    return Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// Persist session secret across restarts so existing logins survive container rebuilds
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
let sessionSecret;
try {
    sessionSecret = require('fs').readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
} catch {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    try {
        require('fs').mkdirSync(DATA_DIR, { recursive: true });
        require('fs').writeFileSync(SESSION_SECRET_FILE, sessionSecret);
    } catch { /* data dir not available (e.g. CI) — use in-memory secret */ }
}

app.use(session({
    secret: process.env.SESSION_SECRET || sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: (() => {
        try {
            const sessionDir = require('path').join(DATA_DIR, 'sessions');
            require('fs').mkdirSync(sessionDir, { recursive: true });
            return new FileStore({ path: sessionDir, ttl: 86400, retries: 2, logFn: () => {} });
        } catch { return undefined; /* fallback to MemoryStore in CI */ }
    })(),
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
const noCacheHeaders = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
};
app.use(noCacheHeaders);
app.use(express.static('/app'));
app.use('/shared', express.static('/app/shared'));

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INVITE_TOKENS_FILE = path.join(DATA_DIR, 'invite-tokens.json');
const BCRYPT_ROUNDS = 12;

// =====================
// USER / AUTH HELPERS
// =====================

const loadUsers = async () => {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveUsers = async (users) => {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
};

const loadInviteTokens = async () => {
    try {
        const data = await fs.readFile(INVITE_TOKENS_FILE, 'utf8');
        return JSON.parse(data);
    } catch { return {}; }
};

const saveInviteTokens = async (tokens) => {
    await fs.writeFile(INVITE_TOKENS_FILE, JSON.stringify(tokens, null, 2));
};

const sendInviteEmail = async (toEmail, username, inviteUrl) => {
    const transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: parseInt(process.env.MAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.MAIL_USERNAME,
            pass: process.env.MAIL_PASSWORD
        }
    });
    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME || 'myTools'}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to: toEmail,
        subject: 'Your myTools Invitation',
        text: `Hello ${username},\n\nYou have been invited to access myTools.\n\nClick the link below to set your password:\n${inviteUrl}\n\nThis link expires in 72 hours.\n\nIf you did not expect this invitation, please ignore this email.`,
        html: `<p>Hello <strong>${username}</strong>,</p><p>You have been invited to access <strong>myTools</strong>.</p><p><a href="${inviteUrl}">Click here to set your password</a></p><p>Or copy this link:<br><code>${inviteUrl}</code></p><p>This link expires in 72 hours.</p><p style="color:#888;font-size:0.85em;">If you did not expect this invitation, please ignore this email.</p>`
    });
};

// Middleware: require web login session
const requireLogin = async (req, res, next) => {
    if (req.session && req.session.userId) return next();

    // Share sessions: validate shareId still exists (revocation check)
    if (req.session && req.session.role === 'share') {
        const shares = await loadShares();
        if (shares[req.session.shareId]) return next();
        // Share was revoked — destroy session
        req.session.destroy();
        if (req.headers['accept']?.includes('application/json') || req.headers['content-type']?.includes('application/json')) {
            return res.status(401).json({ error: 'Share link has been revoked' });
        }
        return res.redirect('./login.html');
    }

    if (req.headers['content-type']?.includes('application/json') || req.headers['accept']?.includes('application/json')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('./login.html');
};

// Middleware: require admin role
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.role === 'admin') return next();
    return res.status(403).json({ error: 'Admin access required' });
};

// Middleware: require admin + canViewLogs permission
const requireLogAccess = async (req, res, next) => {
    if (!req.session || req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const users = await loadUsers();
    const user = users[req.session.userId];
    if (!user || !user.canViewLogs) {
        return res.status(403).json({ error: 'Log viewer access not granted' });
    }
    next();
};

// Store incoming request logs for debugging — file-backed so all workers share the same log
const GPS_LOG_FILE = require('path').join(DATA_DIR, 'gps-request-log.json');
const MAX_LOGS = 100;

const loadRequestLogs = () => {
    try { return JSON.parse(require('fs').readFileSync(GPS_LOG_FILE, 'utf8')); } catch { return []; }
};
const saveRequestLog = (entry) => {
    try {
        let logs = loadRequestLogs();
        logs.unshift(entry);
        if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);
        require('fs').writeFileSync(GPS_LOG_FILE, JSON.stringify(logs));
    } catch { /* non-fatal */ }
};
// In-memory cache for reads (refreshed each request to /api/admin/logs)
let requestLogs = loadRequestLogs();

// Request logging middleware
const logRequests = (req, res, next) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        method: req.method,
        path: req.originalUrl.split('?')[0],   // originalUrl preserves the full path when middleware is mounted at a sub-path
        query: req.query,
        body: req.body,
        headers: {
            authorization: req.headers.authorization ? '***' : undefined,
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent']
        }
    };
    
    requestLogs = loadRequestLogs();
    saveRequestLog(logEntry);
    
    const bodyStr = req.body ? JSON.stringify(req.body) : '';
    console.log(`[${logEntry.timestamp}] ${logEntry.method} ${logEntry.path}`, bodyStr.substring(0, 200));
    // Log device_id fields specifically for diagnosis
    if (req.body?.locations || req.body?.current) {
        console.log(`  [device_id] body.device_id=${req.body.device_id} | locations.device_id=${req.body.locations?.[0]?.properties?.device_id} | current.device_id=${req.body.current?.properties?.device_id}`);
    }
    next();
};

// Apply logging to GPS endpoint
app.use('/api/gps', logRequests);

// Ensure data directory exists
const ensureDataDir = async () => {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(path.join(DATA_DIR, 'routes'), { recursive: true });
        await fs.mkdir(path.join(DATA_DIR, 'devices'), { recursive: true });
        await fs.mkdir(MEDIA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating data directories:', error);
    }
};

// Share link management
const loadShares = async () => {
    try {
        const sharesFile = path.join(DATA_DIR, 'shares.json');
        const data = await fs.readFile(sharesFile, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

const saveShares = async (shares) => {
    try {
        const sharesFile = path.join(DATA_DIR, 'shares.json');
        await fs.writeFile(sharesFile, JSON.stringify(shares, null, 2));
    } catch (error) {
        console.error('Error saving shares:', error);
    }
};

// OwnTracks Basic Auth middleware — validates username:password from HTTP Basic Auth header.
// If the request already has an active admin session (e.g. web testing tools), that is also accepted.
const validateOwnTracksAuth = async (req, res, next) => {
    // Admin session fallback — allows the web testing tools to work without Basic Auth
    if (req.session?.userId) {
        const users = await loadUsers();
        const sessionUser = users[req.session.userId];
        if (sessionUser) {
            req.gpsUserId = sessionUser.id;
            req.gpsUsername = sessionUser.username;
            return next();
        }
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Basic Auth required' });
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return res.status(401).json({ error: 'Invalid Basic Auth format' });
    const username = decoded.slice(0, colonIdx).trim().toLowerCase();
    const password = decoded.slice(colonIdx + 1);

    const users = await loadUsers();
    const user = Object.values(users).find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        console.log(`❌ OwnTracks auth failed for: ${username}`);
        return res.status(403).json({ error: 'Invalid username or password' });
    }
    console.log(`✅ OwnTracks auth for user: ${username}`);
    req.gpsUserId = user.id;
    req.gpsUsername = user.username;
    next();
};

// Passthrough for endpoints that already use requireLogin session auth
const validateToken = (req, res, next) => next();

// Auto-route scheduling
let autoRouteScheduler = null;

const startAutoRouteScheduler = () => {
    if (autoRouteScheduler) {
        clearInterval(autoRouteScheduler);
    }
    
    // Check every minute for devices that need new routes
    autoRouteScheduler = setInterval(async () => {
        await checkAndCreateAutoRoutes();
    }, 60000); // Check every minute
    
    console.log('🕐 Auto-route scheduler started');
};

const checkAndCreateAutoRoutes = async () => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Read all device files
        const devicesDir = path.join(DATA_DIR, 'devices');
        try {
            const deviceFiles = await fs.readdir(devicesDir);
            
            for (const file of deviceFiles) {
                if (!file.endsWith('.json')) continue;
                
                const deviceId = file.replace('.json', '');
                const deviceData = await getDeviceData(deviceId);
                
                // Check if device has auto-route enabled
                if (!deviceData.settings?.autoStartRoute) continue;
                
                // Check if we've already created a route today
                if (deviceData.settings.lastAutoRouteDate === today) continue;
                
                // Parse the configured time (HH:MM format)
                const autoTime = deviceData.settings.autoRouteTime || '00:00';
                const [hours, minutes] = autoTime.split(':').map(Number);
                
                // Check if it's time to create a new route
                const targetTime = new Date(now);
                targetTime.setHours(hours, minutes, 0, 0);
                
                // Only create if we've passed the target time and haven't created today
                if (now >= targetTime) {
                    await createAutoRoute(deviceId, deviceData);
                }
            }
        } catch (error) {
            // Devices directory doesn't exist yet
            console.log('No devices directory found, skipping auto-route check');
        }
    } catch (error) {
        console.error('Error in auto-route scheduler:', error);
    }
};

const createAutoRoute = async (deviceId, deviceData) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Complete current route if active
        if (deviceData.currentRoute) {
            try {
                const routeFile = path.join(DATA_DIR, 'routes', `${deviceData.currentRoute}.json`);
                const routeData = JSON.parse(await fs.readFile(routeFile, 'utf8'));
                if (routeData.status === 'active') {
                    routeData.status = 'completed';
                    routeData.endTime = new Date().toISOString();
                    await saveRoute(routeData);
                    console.log(`🔄 Auto-completed route: ${routeData.name}`);
                }
            } catch (error) {
                console.error('Error completing previous route:', error);
            }
        }
        
        // Create new route
        const routeName = `Auto Route ${new Date().toLocaleDateString()}`;
        const newRoute = createNewRoute(deviceId, routeName);
        
        // Update device data
        deviceData.currentRoute = newRoute.id;
        deviceData.routes.unshift(newRoute.id);
        deviceData.settings.lastAutoRouteDate = today;
        
        // Save route and device data
        await saveRoute(newRoute);
        await saveDeviceData(deviceId, deviceData);
        
        console.log(`🤖 Auto-created route: ${routeName} for device ${deviceId}`);
        
    } catch (error) {
        console.error(`Error creating auto-route for device ${deviceId}:`, error);
    }
};

// Start the scheduler when server starts
startAutoRouteScheduler();

// Device management
const getDeviceData = async (deviceId) => {
    try {
        const deviceFile = path.join(DATA_DIR, 'devices', `${deviceId}.json`);
        const data = await fs.readFile(deviceFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {
            deviceId,
            name: `Device ${deviceId}`,
            created: new Date().toISOString(),
            routes: [],
            currentRoute: null,
            totalPoints: 0,
            lastUpdate: null,
            settings: {
                autoStartRoute: true, // Default: enabled
                autoRouteTime: '00:00',  // Default: midnight
                lastAutoRouteDate: null  // Track when last auto-route was created
            }
        };
    }
};

const saveDeviceData = async (deviceId, data) => {
    try {
        const deviceFile = path.join(DATA_DIR, 'devices', `${deviceId}.json`);
        await fs.writeFile(deviceFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving device data:', error);
    }
};

// Route management
const createNewRoute = (deviceId, routeName) => {
    const routeId = `${deviceId}_${Date.now()}`;
    return {
        id: routeId,
        deviceId,
        name: routeName || `Route ${new Date().toLocaleDateString()}`,
        startTime: new Date().toISOString(),
        endTime: null,
        points: [],
        totalDistance: 0,
        status: 'active',
        metadata: {
            source: 'owntracks',
            version: '1.0'
        },
        favorite: false,
        deleted: false,
        deletedAt: null,
        deletedBy: null,
        // Enhanced analysis data
        analysis: {
            segments: [],
            pausePoints: [],
            splitPoints: [],
            lastAnalyzed: null,
            version: '2.0'
        },
        // Visual configuration
        visualization: {
            colors: {
                road: '#2ecc71',      // Green for roads
                offroad: '#8b4513',   // Brown for nature/offroad
                pause: '#f39c12',     // Orange for pause points
                approach: '#e74c3c',  // Red for approach tracks
                departure: '#3498db'  // Blue for departure tracks
            },
            showAnalysis: true,
            showPausePoints: true,
            showTrackOutlines: true
        }
    };
};

const saveRoute = async (route) => {
    try {
        const routeFile = path.join(DATA_DIR, 'routes', `${route.id}.json`);
        await fs.writeFile(routeFile, JSON.stringify(route, null, 2));
    } catch (error) {
        console.error('Error saving route:', error);
    }
};

// Calculate distance between two points (Haversine formula)
const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

// Calculate bearing between two points
const calculateBearing = (lat1, lng1, lat2, lng2) => {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
};

// Parse OwnTracks JSON location payload
// OwnTracks HTTP mode POSTs all message types to the same endpoint.
// Only _type=location contains GPS data; all others are acknowledged with [].
const parseGPSData = (data) => {
    if (data._type !== 'location') return [];

    const point = {
        lat: data.lat,
        lng: data.lon,
        alt: data.alt || null,
        timestamp: new Date(data.tst * 1000).toISOString(),
        accuracy: data.acc || null,
        speed: data.vel || null,
        bearing: data.cog || null,
        battery: data.batt || null,
        source: 'owntracks'
    };

    if (point.lat == null || point.lng == null || isNaN(point.lat) || isNaN(point.lng)) return [];
    return [point];
};

// =====================
// ENHANCED ROUTE ANALYSIS FUNCTIONS
// =====================

// Simple road proximity detection using speed and movement patterns
const detectRoadProximity = async (point, previousPoints = []) => {
    try {
        // Basic heuristics for road detection:
        // 1. Speed > 30 km/h usually indicates road travel
        // 2. Consistent bearing suggests road following
        // 3. Regular GPS accuracy indicates good signal (roads vs forest)
        
        const speedKmh = (point.speed || 0) * 3.6;
        
        // If moving fast, likely on road
        if (speedKmh > 30) return true;
        
        // If stationary or very slow, check context
        if (speedKmh < 5) return false;
        
        // Check movement consistency with recent points
        if (previousPoints.length >= 3) {
            const recent = previousPoints.slice(-3);
            const bearings = [];
            
            for (let i = 0; i < recent.length - 1; i++) {
                const bearing = calculateBearing(
                    recent[i].lat, recent[i].lng,
                    recent[i + 1].lat, recent[i + 1].lng
                );
                bearings.push(bearing);
            }
            
            // Calculate bearing variance - roads have consistent bearings
            if (bearings.length > 1) {
                const avgBearing = bearings.reduce((a, b) => a + b) / bearings.length;
                const variance = bearings.reduce((sum, bearing) => {
                    const diff = Math.min(Math.abs(bearing - avgBearing), 360 - Math.abs(bearing - avgBearing));
                    return sum + diff * diff;
                }, 0) / bearings.length;
                
                // Low variance suggests road following
                return variance < 400; // degrees squared
            }
        }
        
        // Default: assume off-road for hiking speeds
        return speedKmh > 15;
        
    } catch (error) {
        console.log('Road detection error:', error.message);
        return false;
    }
};

// Analyze route segments for map matching
const analyzeRouteSegments = async (points) => {
    if (!points || points.length < 2) return [];
    
    const segments = [];
    let currentSegment = { 
        type: 'unknown', 
        points: [], 
        startIndex: 0,
        geometry: []
    };
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const previousPoints = points.slice(Math.max(0, i - 5), i);
        const isOnRoad = await detectRoadProximity(point, previousPoints);
        const segmentType = isOnRoad ? 'road' : 'offroad';
        
        if (segmentType !== currentSegment.type && currentSegment.points.length > 0) {
            // Segment type changed - finalize current and start new
            currentSegment.endIndex = i - 1;
            currentSegment.geometry = optimizeSegmentGeometry(currentSegment);
            segments.push(currentSegment);
            
            currentSegment = {
                type: segmentType,
                points: [point],
                startIndex: i,
                geometry: []
            };
        } else {
            currentSegment.type = segmentType;
            currentSegment.points.push(point);
        }
    }
    
    // Don't forget the last segment
    if (currentSegment.points.length > 0) {
        currentSegment.endIndex = points.length - 1;
        currentSegment.geometry = optimizeSegmentGeometry(currentSegment);
        segments.push(currentSegment);
    }
    
    return segments;
};

// Optimize segment geometry for rendering
const optimizeSegmentGeometry = (segment) => {
    if (!segment.points || segment.points.length === 0) return [];
    
    if (segment.type === 'road' && segment.points.length > 10) {
        // For road segments, use Douglas-Peucker simplification
        return simplifyPolyline(segment.points, 0.0001); // ~10m tolerance
    } else {
        // For off-road, keep more detail but still optimize
        return segment.points.length > 50 ? 
            simplifyPolyline(segment.points, 0.00005) : // ~5m tolerance
            segment.points.map(p => [p.lat, p.lng]);
    }
};

// Simple Douglas-Peucker line simplification
const simplifyPolyline = (points, tolerance) => {
    if (points.length <= 2) return points.map(p => [p.lat, p.lng]);
    
    const simplified = [points[0]];
    
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];
        
        // Calculate perpendicular distance to line between prev and next
        const distance = pointToLineDistance(curr, prev, next);
        
        if (distance > tolerance || i % 5 === 0) { // Keep every 5th point minimum
            simplified.push(curr);
        }
    }
    
    simplified.push(points[points.length - 1]);
    return simplified.map(p => [p.lat, p.lng]);
};

// Calculate perpendicular distance from point to line
const pointToLineDistance = (point, lineStart, lineEnd) => {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    
    const param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
        xx = lineStart.lat;
        yy = lineStart.lng;
    } else if (param > 1) {
        xx = lineEnd.lat;
        yy = lineEnd.lng;
    } else {
        xx = lineStart.lat + param * C;
        yy = lineStart.lng + param * D;
    }
    
    const dx = point.lat - xx;
    const dy = point.lng - yy;
    return Math.sqrt(dx * dx + dy * dy);
};

// Detect pause points in route
const detectPausePoints = (points) => {
    if (!points || points.length < 2) return [];
    
    const pausePoints = [];
    const PAUSE_THRESHOLD = 3600000; // 1 hour in ms
    const MOVEMENT_RADIUS = 50; // 50 meters
    
    let pauseStart = null;
    let pauseCenter = null;
    let pausePoints_temp = [];
    
    for (let i = 0; i < points.length - 1; i++) {
        const point = points[i];
        const nextPoint = points[i + 1];
        
        if (!point.timestamp || !nextPoint.timestamp) continue;
        
        const distance = calculateDistance(point.lat, point.lng, nextPoint.lat, nextPoint.lng) * 1000; // km to m
        const timeDiff = new Date(nextPoint.timestamp) - new Date(point.timestamp);
        
        if (distance < MOVEMENT_RADIUS) {
            if (!pauseStart) {
                pauseStart = point;
                pauseCenter = { lat: point.lat, lng: point.lng, count: 1 };
                pausePoints_temp = [i];
            } else {
                // Update pause center (running average)
                pauseCenter.lat = (pauseCenter.lat * pauseCenter.count + point.lat) / (pauseCenter.count + 1);
                pauseCenter.lng = (pauseCenter.lng * pauseCenter.count + point.lng) / (pauseCenter.count + 1);
                pauseCenter.count++;
                pausePoints_temp.push(i);
            }
            
            const pauseDuration = new Date(point.timestamp) - new Date(pauseStart.timestamp);
            if (pauseDuration >= PAUSE_THRESHOLD) {
                // Found a significant pause
                const pausePoint = {
                    lat: pauseCenter.lat,
                    lng: pauseCenter.lng,
                    startTime: pauseStart.timestamp,
                    endTime: point.timestamp,
                    duration: Math.round(pauseDuration / 1000), // seconds
                    pointIndices: [...pausePoints_temp],
                    approaches: findApproachTracks(points, pausePoints_temp[0], pauseCenter),
                    departures: findDepartureTracks(points, pausePoints_temp[pausePoints_temp.length - 1], pauseCenter)
                };
                
                pausePoints.push(pausePoint);
                console.log(`🛑 Detected pause: ${Math.round(pauseDuration/60000)}min at [${pauseCenter.lat.toFixed(6)}, ${pauseCenter.lng.toFixed(6)}]`);
            }
        } else {
            // Movement detected - reset pause tracking
            pauseStart = null;
            pauseCenter = null;
            pausePoints_temp = [];
        }
    }
    
    return pausePoints;
};

// Find approach tracks leading to a pause point
const findApproachTracks = (points, pauseStartIndex, pauseCenter) => {
    const approaches = [];
    const TRACK_DISTANCE = 1000; // Look back 1km
    const approach = [];
    
    for (let i = pauseStartIndex - 1; i >= 0; i--) {
        const point = points[i];
        const distance = calculateDistance(point.lat, point.lng, pauseCenter.lat, pauseCenter.lng) * 1000; // km to m
        
        if (distance > TRACK_DISTANCE) break;
        
        approach.unshift({
            index: i,
            lat: point.lat,
            lng: point.lng,
            distance: distance,
            bearing: calculateBearing(point.lat, point.lng, pauseCenter.lat, pauseCenter.lng)
        });
    }
    
    if (approach.length > 0) {
        approaches.push({
            geometry: approach.map(p => [p.lat, p.lng]),
            distance: Math.max(...approach.map(p => p.distance)),
            points: approach.length
        });
    }
    
    return approaches;
};

// Find departure tracks leaving from a pause point
const findDepartureTracks = (points, pauseEndIndex, pauseCenter) => {
    const departures = [];
    const TRACK_DISTANCE = 1000; // Look ahead 1km
    const departure = [];
    
    for (let i = pauseEndIndex + 1; i < points.length; i++) {
        const point = points[i];
        const distance = calculateDistance(point.lat, point.lng, pauseCenter.lat, pauseCenter.lng) * 1000; // km to m
        
        if (distance > TRACK_DISTANCE) break;
        
        departure.push({
            index: i,
            lat: point.lat,
            lng: point.lng,
            distance: distance,
            bearing: calculateBearing(pauseCenter.lat, pauseCenter.lng, point.lat, point.lng)
        });
    }
    
    if (departure.length > 0) {
        departures.push({
            geometry: departure.map(p => [p.lat, p.lng]),
            distance: Math.max(...departure.map(p => p.distance)),
            points: departure.length
        });
    }
    
    return departures;
};

// Analyze complete route for enhanced features
const analyzeCompleteRoute = async (route) => {
    if (!route.points || route.points.length < 10) {
        return { segments: [], pausePoints: [], splitPoints: [] };
    }
    
    console.log(`🔍 Analyzing route with ${route.points.length} points...`);
    
    const [segments, pausePoints] = await Promise.all([
        analyzeRouteSegments(route.points),
        Promise.resolve(detectPausePoints(route.points))
    ]);
    
    console.log(`✅ Analysis complete: ${segments.length} segments, ${pausePoints.length} pause points`);
    
    return {
        segments,
        pausePoints,
        splitPoints: [] // User-defined split points (added via UI)
    };
};

// =====================
// AUTH ENDPOINTS
// =====================

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = await loadUsers();
    const user = Object.values(users).find(u => u.username === username.trim().toLowerCase());

    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    if (!user.passwordHash) return res.status(401).json({ error: 'Account not yet activated. Please use your invitation link to set a password.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    // Update last login
    users[user.id].lastLogin = new Date().toISOString();
    await saveUsers(users);

    res.json({ success: true, username: user.username, role: user.role });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ======================
// PASSKEY (WebAuthn)
// ======================

// Step 1: Get registration options (must be logged in)
app.get('/api/auth/passkey/register-options', requireLogin, async (req, res) => {
    try {
        const users = await loadUsers();
        const user = users[req.session.userId];
        if (!user) return res.status(404).json({ error: 'User not found' });

        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID: RP_ID,
            userID: Buffer.from(user.id),
            userName: user.username,
            userDisplayName: user.username,
            attestationType: 'none',
            excludeCredentials: (user.passkeys || []).map(pk => ({
                id: pk.credentialID,
                type: 'public-key',
                transports: pk.transports || [],
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
        });

        req.session.passkeyRegChallenge = options.challenge;
        // simplewebauthn v9 returns user.id as a Buffer; convert to Base64URL string for the client
        const jsonOptions = {
            ...options,
            user: {
                ...options.user,
                id: Buffer.from(options.user.id).toString('base64')
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            },
        };
        res.json(jsonOptions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Step 2: Verify registration
app.post('/api/auth/passkey/register', requireLogin, async (req, res) => {
    try {
        const users = await loadUsers();
        const user = users[req.session.userId];
        if (!user) return res.status(404).json({ error: 'User not found' });

        const expectedChallenge = req.session.passkeyRegChallenge;
        if (!expectedChallenge) return res.status(400).json({ error: 'No challenge. Restart registration.' });

        const verification = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ error: 'Verification failed' });
        }

        const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
        if (!user.passkeys) user.passkeys = [];
        const label = req.body.label || `Passkey ${user.passkeys.length + 1}`;
        // credentialID is a Uint8Array in v9 — store as Base64URL string for reliable lookup
        const credentialIDStr = Buffer.from(credentialID).toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        user.passkeys.push({
            credentialID: credentialIDStr,
            credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64'),
            counter,
            transports: req.body.response?.transports || [],
            registeredAt: new Date().toISOString(),
            label,
        });

        delete req.session.passkeyRegChallenge;
        await saveUsers(users);
        res.json({ success: true, label });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Step 3: Get authentication challenge (no login required)
app.get('/api/auth/passkey/challenge', async (req, res) => {
    try {
        // Use empty allowCredentials to trigger discoverable-credential mode —
        // the device (iPhone) will present all saved passkeys for this RP via Face ID
        // without needing to match credential IDs, avoiding the QR-code fallback.
        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            allowCredentials: [],
            userVerification: 'preferred',
        });

        req.session.passkeyAuthChallenge = options.challenge;
        res.json(options);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Step 4: Verify authentication
app.post('/api/auth/passkey/verify', async (req, res) => {
    try {
        const expectedChallenge = req.session.passkeyAuthChallenge;
        if (!expectedChallenge) return res.status(400).json({ error: 'No challenge. Try again.' });

        const users = await loadUsers();
        let targetUser = null;
        let targetPasskey = null;

        for (const user of Object.values(users)) {
            const pk = (user.passkeys || []).find(p => normalizeCredentialIDStr(p.credentialID) === req.body.id);
            if (pk) { targetUser = user; targetPasskey = pk; break; }
        }

        if (!targetUser || !targetPasskey) {
            return res.status(404).json({ error: 'Passkey not recognized' });
        }

        // Normalize to Base64URL string for verifier (also migrate in-memory for save)
        const credentialIDStr = normalizeCredentialIDStr(targetPasskey.credentialID);
        targetPasskey.credentialID = credentialIDStr;

        const verification = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            authenticator: {
                credentialID: credentialIDStr,
                credentialPublicKey: Buffer.from(targetPasskey.credentialPublicKey, 'base64'),
                counter: targetPasskey.counter,
                transports: targetPasskey.transports,
            },
        });

        if (!verification.verified) {
            return res.status(401).json({ error: 'Passkey verification failed' });
        }

        targetPasskey.counter = verification.authenticationInfo.newCounter;
        targetUser.lastLogin = new Date().toISOString();
        await saveUsers(users);

        delete req.session.passkeyAuthChallenge;
        req.session.userId = targetUser.id;
        req.session.username = targetUser.username;
        req.session.role = targetUser.role;

        res.json({ success: true, username: targetUser.username, role: targetUser.role });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Rename a passkey
app.patch('/api/auth/passkey/:credentialID', requireLogin, async (req, res) => {
    try {
        const { label } = req.body;
        if (!label || !label.trim()) return res.status(400).json({ error: 'Label required' });
        const users = await loadUsers();
        const user = users[req.session.userId];
        if (!user) return res.status(404).json({ error: 'User not found' });
        const pk = (user.passkeys || []).find(p => normalizeCredentialIDStr(p.credentialID) === req.params.credentialID);
        if (!pk) return res.status(404).json({ error: 'Passkey not found' });
        pk.label = label.trim();
        await saveUsers(users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a passkey
app.delete('/api/auth/passkey/:credentialID', requireLogin, async (req, res) => {
    try {
        const users = await loadUsers();
        const user = users[req.session.userId];
        if (!user) return res.status(404).json({ error: 'User not found' });

        const before = (user.passkeys || []).length;
        user.passkeys = (user.passkeys || []).filter(pk => normalizeCredentialIDStr(pk.credentialID) !== req.params.credentialID);
        if (user.passkeys.length === before) return res.status(404).json({ error: 'Passkey not found' });

        await saveUsers(users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Current session info
app.get('/api/auth/me', requireLogin, async (req, res) => {
    // Share session
    if (req.session.role === 'share') {
        return res.json({
            userId: null,
            username: 'shared-link',
            role: 'viewer',
            shareId: req.session.shareId,
            shareRouteId: req.session.shareRouteId,
            shareDeviceId: req.session.shareDeviceId,
            allowedDevices: [req.session.shareDeviceId],
            dataWindow: { from: null, to: null }
        });
    }
    const users = await loadUsers();
    const user = users[req.session.userId];
    res.json({
        userId: req.session.userId,
        username: req.session.username,
        role: req.session.role,
        allowedDevices: user?.allowedDevices || [],
        dataWindow: user?.dataWindow || { from: null, to: null },
        canViewLogs: user?.canViewLogs || false,
        passkeys: (user?.passkeys || []).map(pk => ({
            credentialID: normalizeCredentialIDStr(pk.credentialID),
            label: pk.label,
            registeredAt: pk.registeredAt,
            transports: pk.transports,
        })),
    });
});

// Authenticate with a share token (no password needed)
app.post('/api/auth/share', async (req, res) => {
    const { shareId } = req.body;
    if (!shareId) return res.status(400).json({ error: 'shareId required' });

    const shares = await loadShares();
    const share = shares[shareId];
    if (!share) return res.status(404).json({ error: 'Share link not found or revoked' });

    // Check expiry
    if (share.expiresAt && new Date() > new Date(share.expiresAt)) {
        return res.status(410).json({ error: 'Share link has expired' });
    }

    // Establish limited share session
    req.session.role = 'share';
    req.session.shareId = shareId;
    req.session.shareRouteId = share.routeId;
    req.session.shareDeviceId = share.deviceId;

    // Track access count
    shares[shareId].accessCount = (shares[shareId].accessCount || 0) + 1;
    shares[shareId].lastAccessed = new Date().toISOString();
    await saveShares(shares);

    console.log(`🔗 Share link accessed: ${shareId} → route ${share.routeId}`);
    res.json({ success: true, routeId: share.routeId, deviceId: share.deviceId, label: share.label });
});

// =====================
// ADMIN: USER MANAGEMENT
// =====================

// List all users (admin only)
app.get('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const sanitized = Object.values(users).map(u => ({
        id: u.id, username: u.username, role: u.role,
        email: u.email || null,
        hasPassword: !!u.passwordHash,
        allowedDevices: u.allowedDevices || [],
        devices: u.devices || [],
        historyRouteLimit: (u.historyRouteLimit ?? null),
        dataWindow: u.dataWindow || { from: null, to: null },
        canViewLogs: u.canViewLogs || false,
        passkeyCount: (u.passkeys || []).length,
        created: u.created, lastLogin: u.lastLogin || null
    }));
    res.json(sanitized);
});

// Admin: clear all passkeys for a user
app.delete('/api/admin/users/:id/passkeys', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const user = users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const removed = (user.passkeys || []).length;
    user.passkeys = [];
    await saveUsers(users);
    res.json({ success: true, removed });
});

// Create user (admin only)
app.post('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    const { username, password, email, role, allowedDevices, dataWindow, historyRouteLimit } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    if (!password && !email) return res.status(400).json({ error: 'Password or email address required' });

    const users = await loadUsers();
    if (Object.values(users).find(u => u.username === username.trim().toLowerCase())) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    users[id] = {
        id,
        username: username.trim().toLowerCase(),
        passwordHash: password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null,
        email: email ? email.trim().toLowerCase() : null,
        role: role === 'admin' ? 'admin' : 'viewer',
        allowedDevices: allowedDevices || [],
        devices: [],
        canViewLogs: false,
        historyRouteLimit: (historyRouteLimit === null || historyRouteLimit === '' || Number.isNaN(Number(historyRouteLimit)))
            ? null
            : Math.max(1, parseInt(historyRouteLimit, 10)),
        dataWindow: dataWindow || { from: null, to: null },
        created: new Date().toISOString(),
        lastLogin: null
    };

    await saveUsers(users);
    res.json({ success: true, id, username: users[id].username, role: users[id].role });
});

// Update user (admin only) - change password, role, allowedDevices
app.put('/api/admin/users/:id', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const user = users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.body.password) {
        user.passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    }
    if (req.body.role) user.role = req.body.role === 'admin' ? 'admin' : 'viewer';
    if (req.body.allowedDevices !== undefined) user.allowedDevices = req.body.allowedDevices;
    if (req.body.dataWindow !== undefined) user.dataWindow = req.body.dataWindow;
    if (req.body.canViewLogs !== undefined) user.canViewLogs = !!req.body.canViewLogs;
    if (req.body.email !== undefined) user.email = req.body.email ? req.body.email.trim().toLowerCase() : null;
    if (req.body.historyRouteLimit !== undefined) {
        const v = req.body.historyRouteLimit;
        user.historyRouteLimit = (v === null || v === '' || Number.isNaN(Number(v))) ? null : Math.max(1, parseInt(v, 10));
    }

    await saveUsers(users);
    res.json({ success: true });
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    if (!users[req.params.id]) return res.status(404).json({ error: 'User not found' });
    // Prevent deleting last admin
    const admins = Object.values(users).filter(u => u.role === 'admin');
    if (admins.length === 1 && users[req.params.id].role === 'admin') {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
    delete users[req.params.id];
    await saveUsers(users);
    res.json({ success: true });
});

// Send invitation email to user
app.post('/api/admin/users/:id/invite', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const user = users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.email) return res.status(400).json({ error: 'User has no email address set' });

    const token = crypto.randomBytes(32).toString('hex');
    const tokens = await loadInviteTokens();
    // Revoke any existing unused tokens for this user
    for (const t of Object.keys(tokens)) {
        if (tokens[t].userId === user.id && !tokens[t].usedAt) delete tokens[t];
    }
    tokens[token] = {
        userId: user.id,
        email: user.email,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        usedAt: null
    };
    await saveInviteTokens(tokens);

    const baseUrl = (process.env.ORIGIN || 'https://tools.amrhein.info');
    const inviteUrl = `${baseUrl}/route-tracker/invite/${token}`;
    try {
        await sendInviteEmail(user.email, user.username, inviteUrl);
        res.json({ success: true });
    } catch (error) {
        console.error('[invite] Email send failed:', error.message);
        res.status(500).json({ error: 'Failed to send invitation email: ' + error.message });
    }
});

// Public: serve invite set-password page
app.get('/invite/:token', (req, res) => {
    res.sendFile(path.join('/app', 'invite.html'));
});

// Public: set password via invite token
app.post('/api/invite/:token', async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const tokens = await loadInviteTokens();
    const tokenData = tokens[req.params.token];
    if (!tokenData) return res.status(404).json({ error: 'Invalid invitation link' });
    if (tokenData.usedAt) return res.status(410).json({ error: 'This invitation link has already been used' });
    if (new Date(tokenData.expiresAt) < new Date()) return res.status(410).json({ error: 'This invitation link has expired. Ask an admin to resend the invitation.' });

    const users = await loadUsers();
    const user = users[tokenData.userId];
    if (!user) return res.status(404).json({ error: 'User account not found' });

    user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await saveUsers(users);

    tokenData.usedAt = new Date().toISOString();
    await saveInviteTokens(tokens);

    res.json({ success: true, username: user.username });
});

// =====================
// API Endpoints
// =====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'Route Tracker GPS Receiver API'
    });
});

// Debug beacon — logs client viewport/UA info to console
app.post('/api/debug-beacon', (req, res) => {
    const data = req.body || {};
    const ua = req.headers['user-agent'] || 'unknown';
    console.log('[DEBUG-BEACON]', JSON.stringify({
        time: new Date().toISOString(),
        ua,
        ...data
    }, null, 2));
    res.json({ ok: true });
});

app.get('/api/admin/media-devices', requireLogin, requireAdmin, async (req, res) => {
    try {
        const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => []);
        const mediaDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

        const devicesDir = path.join(DATA_DIR, 'devices');
        const deviceFiles = await fs.readdir(devicesDir).catch(() => []);
        const registeredDeviceIds = new Set(
            deviceFiles
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace(/\.json$/, ''))
        );

        const deviceIds = [];
        for (const deviceId of mediaDirs) {
            if (!registeredDeviceIds.has(deviceId)) continue;
            const mediaJsonFile = path.join(MEDIA_DIR, deviceId, 'media.json');
            let mediaItems = [];
            try {
                mediaItems = JSON.parse(await fs.readFile(mediaJsonFile, 'utf8'));
            } catch {
                mediaItems = [];
            }
            if (Array.isArray(mediaItems) && mediaItems.length > 0) {
                deviceIds.push(deviceId);
            }
        }

        res.json(deviceIds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================
// DEVICE MANAGEMENT
// =====================

// List all devices with full summary (admin)
app.get('/api/admin/devices', requireLogin, requireAdmin, async (req, res) => {
    try {
        await ensureDataDir();
        const devicesDir = path.join(DATA_DIR, 'devices');
        const files = await fs.readdir(devicesDir).catch(() => []);
        const devices = await Promise.all(files.filter(f => f.endsWith('.json')).map(async f => {
            const d = await getDeviceData(f.replace('.json', ''));
            return {
                id: d.deviceId,
                name: d.name,
                routeCount: (d.routes || []).length,
                totalPoints: d.totalPoints || 0,
                lastUpdate: d.lastUpdate || null,
                currentRoute: d.currentRoute || null,
                settings: d.settings || {
                    autoStartRoute: true,
                    autoRouteTime: '00:00',
                    lastAutoRouteDate: null
                }
            };
        }));
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename a device (admin)
app.patch('/api/admin/devices/:deviceId', requireLogin, requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const deviceId = req.params.deviceId;
    const deviceFile = path.join(DATA_DIR, 'devices', `${deviceId}.json`);
    try {
        await fs.access(deviceFile);
    } catch {
        return res.status(404).json({ error: 'Device not found' });
    }
    const data = await getDeviceData(deviceId);
    data.name = name.trim();
    await saveDeviceData(deviceId, data);
    res.json({ success: true, name: data.name });
});

// Delete a device and all associated data (admin)
app.delete('/api/admin/devices/:deviceId', requireLogin, requireAdmin, async (req, res) => {
    const deviceId = req.params.deviceId;
    const deviceFile = path.join(DATA_DIR, 'devices', `${deviceId}.json`);
    try {
        await fs.access(deviceFile);
    } catch {
        return res.status(404).json({ error: 'Device not found' });
    }

    // Load device to get its route list
    const deviceData = await getDeviceData(deviceId);
    let routesDeleted = 0;

    // Delete all route files belonging to this device
    for (const routeId of (deviceData.routes || [])) {
        try {
            await fs.unlink(path.join(DATA_DIR, 'routes', `${routeId}.json`));
            routesDeleted++;
        } catch { /* already gone */ }
    }

    // Delete device file
    await fs.unlink(deviceFile);

    // Remove device from all users' devices[] and allowedDevices[]
    const users = await loadUsers();
    let usersUpdated = 0;
    for (const user of Object.values(users)) {
        let changed = false;
        if ((user.devices || []).includes(deviceId)) {
            user.devices = user.devices.filter(d => d !== deviceId);
            changed = true;
        }
        if ((user.allowedDevices || []).includes(deviceId)) {
            user.allowedDevices = user.allowedDevices.filter(d => d !== deviceId);
            changed = true;
        }
        if (changed) usersUpdated++;
    }
    await saveUsers(users);

    // Delete media directory for this device
    const mediaDeviceDir = path.join(MEDIA_DIR, deviceId);
    try {
        await fs.rm(mediaDeviceDir, { recursive: true, force: true });
    } catch { /* no media for this device */ }

    res.json({ success: true, routesDeleted, usersUpdated });
});

app.post('/api/shares', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { routeId, deviceId, label, expiresAt } = req.body;
        if (!routeId || !deviceId) return res.status(400).json({ error: 'routeId and deviceId required' });

        const shareId = crypto.randomBytes(12).toString('hex');
        const shares = await loadShares();
        shares[shareId] = {
            id: shareId,
            routeId,
            deviceId,
            label: label || routeId,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt || null,
            accessCount: 0,
            lastAccessed: null
        };
        await saveShares(shares);

        const base = req.protocol + '://' + req.get('host') + req.baseUrl;
        const shareUrl = `${base}/?share=${shareId}`;
        res.json({ success: true, shareId, shareUrl, share: shares[shareId] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/shares', requireLogin, requireAdmin, async (req, res) => {
    try {
        const shares = await loadShares();
        res.json(Object.values(shares));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/shares/:shareId', requireLogin, requireAdmin, async (req, res) => {
    try {
        const shares = await loadShares();
        if (!shares[req.params.shareId]) return res.status(404).json({ error: 'Share not found' });
        delete shares[req.params.shareId];
        await saveShares(shares);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Receive GPS data from OwnTracks app (HTTP mode)
app.post('/api/gps', validateOwnTracksAuth, async (req, res) => {
    try {
        // OwnTracks sends all message types to the same endpoint.
        // Non-location types must be acknowledged with HTTP 200 and an empty array.
        if (req.body._type && req.body._type !== 'location') {
            return res.status(200).json([]);
        }

        // Extract deviceId from OwnTracks topic (owntracks/<user>/<device>)
        let deviceId = null;
        if (req.body?.topic) {
            const parts = req.body.topic.split('/');
            if (parts.length >= 3) deviceId = parts[2];
        }
        if (!deviceId) deviceId = req.body?.tid || 'default-device';

        // Auto-register device to the authenticated user
        const users = await loadUsers();
        const gpsUser = users[req.gpsUserId];
        if (gpsUser && !gpsUser.devices) gpsUser.devices = [];
        if (gpsUser && !gpsUser.devices.includes(deviceId)) {
            gpsUser.devices.push(deviceId);
            await saveUsers(users);
            console.log(`📱 Registered device '${deviceId}' to user '${gpsUser.username}'`);
        }

        const routeName = req.body.routeName || req.headers['route-name'];

        console.log(`Received GPS data from device: ${deviceId}`);

        // Parse GPS data
        const points = parseGPSData(req.body);
        
        if (points.length === 0) {
            return res.status(400).json({ 
                error: 'No valid GPS points found',
                receivedData: req.body
            });
        }
        
        // Get or create device data
        let deviceData = await getDeviceData(deviceId);
        
        // Get or create current route
        let currentRoute = null;
        if (deviceData.currentRoute) {
            try {
                const routeFile = path.join(DATA_DIR, 'routes', `${deviceData.currentRoute}.json`);
                const routeData = await fs.readFile(routeFile, 'utf8');
                currentRoute = JSON.parse(routeData);
            } catch (error) {
                console.log('Current route not found, creating new one');
            }
        }
        
        // Determine if we need a new route
        // Use last point's timestamp (not startTime) so long active routes don't get split
        const routeTimeout = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        const lastPointTime = currentRoute?.points?.length > 0
            ? new Date(currentRoute.points[currentRoute.points.length - 1].timestamp)
            : (currentRoute ? new Date(currentRoute.startTime) : null);
        const isRouteExpired = !!lastPointTime && (new Date() - lastPointTime) > routeTimeout;
            
        const needNewRoute = !currentRoute || 
                            (routeName && routeName !== currentRoute.name) ||
                            (currentRoute && currentRoute.status !== 'active') ||
                            isRouteExpired;
        
        // Create new route only when needed
        if (needNewRoute) {
            // Mark previous route as completed if it exists
            if (currentRoute && currentRoute.status === 'active') {
                currentRoute.status = 'completed';
                currentRoute.endTime = new Date().toISOString();
                await saveRoute(currentRoute);
                console.log(`🏁 Completed route: ${currentRoute.name}`);
            }
            
            currentRoute = createNewRoute(deviceId, routeName);
            deviceData.currentRoute = currentRoute.id;
            deviceData.routes.unshift(currentRoute.id);
            console.log(`📍 Created new route: ${currentRoute.name} (${currentRoute.id})`);
        } else {
            console.log(`➕ Adding ${points.length} points to existing route: ${currentRoute.name}`);
        }
        
        // Add points to current route
        points.forEach(point => {
            // Calculate distance if not first point
            if (currentRoute.points.length > 0) {
                const lastPoint = currentRoute.points[currentRoute.points.length - 1];
                const distance = calculateDistance(
                    lastPoint.lat, lastPoint.lng,
                    point.lat, point.lng
                );
                currentRoute.totalDistance += distance;
            }
            
            currentRoute.points.push(point);
        });
        
        // Update route metadata
        currentRoute.totalPoints = currentRoute.points.length;
        currentRoute.lastUpdate = new Date().toISOString();
        if (currentRoute.points.length > 0) {
            // Update end time to latest point for active routes
            const latestPoint = currentRoute.points[currentRoute.points.length - 1];
            currentRoute.lastPointTime = latestPoint.timestamp;
        }
        
        // Update device data
        deviceData.totalPoints += points.length;
        deviceData.lastUpdate = new Date().toISOString();
        
        // Trigger route analysis for large routes or when completed
        const shouldAnalyze = currentRoute.points.length > 100 && 
                             (currentRoute.points.length % 500 === 0 || // Every 500 points
                              currentRoute.status !== 'active'); // When route completed
        
        if (shouldAnalyze && (!currentRoute.analysis?.lastAnalyzed || 
            new Date() - new Date(currentRoute.analysis.lastAnalyzed) > 300000)) { // 5 min cooldown
            try {
                console.log(`🔍 Triggering route analysis for ${currentRoute.name}...`);
                currentRoute.analysis = await analyzeCompleteRoute(currentRoute);
                currentRoute.analysis.lastAnalyzed = new Date().toISOString();
                console.log(`✅ Route analysis completed for ${currentRoute.name}`);
            } catch (error) {
                console.error('Route analysis failed:', error.message);
            }
        }
        
        // Save data
        await saveRoute(currentRoute);
        await saveDeviceData(deviceId, deviceData);
        
        console.log(`✅ Route ${currentRoute.name}: ${currentRoute.points.length} points, ${currentRoute.totalDistance.toFixed(2)}km`);
        
        res.json({
            success: true,
            routeId: currentRoute.id,
            routeName: currentRoute.name,
            pointsAdded: points.length,
            totalPoints: currentRoute.points.length,
            totalDistance: currentRoute.totalDistance,
            status: currentRoute.status
        });
        
    } catch (error) {
        console.error('Error processing GPS data:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get all devices (list all available devices)
app.get('/api/devices', requireLogin, validateToken, async (req, res) => {
    try {
        await ensureDataDir();
        const devicesDir = path.join(DATA_DIR, 'devices');
        
        try {
            const files = await fs.readdir(devicesDir);
            const deviceFiles = files.filter(f => f.endsWith('.json'));
            let devices = [];
            
            for (const file of deviceFiles) {
                const deviceId = file.replace('.json', '');
                if (!(await canAccessDevice(req, deviceId))) continue;
                const deviceData = await getDeviceData(deviceId);
                devices.push({
                    id: deviceData.deviceId,
                    name: deviceData.name,
                    lastUpdate: deviceData.lastUpdate,
                    currentRoute: deviceData.currentRoute
                });
            }
            
            res.json(devices);
        } catch (error) {
            // No devices directory yet
            res.json([]);
        }
    } catch (error) {
        console.error('Error listing devices:', error);
        res.status(500).json({ error: 'Failed to list devices' });
    }
});

// Helper: check if current session user can access a device
const canAccessDevice = async (req, deviceId) => {
    if (req.session.role === 'admin') return true;
    // Share sessions: only allow their specific device
    if (req.session.role === 'share') return req.session.shareDeviceId === deviceId;
    const users = await loadUsers();
    const user = users[req.session.userId];
    if (!user) return false;
    const allowed = user.allowedDevices || [];
    return allowed.length === 0 || allowed.includes(deviceId);
};

// Get device status
app.get('/api/devices/:deviceId', requireLogin, validateToken, async (req, res) => {
    if (!(await canAccessDevice(req, req.params.deviceId))) return res.status(403).json({ error: 'Access denied' });
    try {
        const deviceId = req.params.deviceId;
        const deviceData = await getDeviceData(deviceId);
        res.json(deviceData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update device settings (admin only)
app.put('/api/devices/:deviceId/settings', requireLogin, requireAdmin, async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const { autoStartRoute, autoRouteTime } = req.body;
        
        const deviceData = await getDeviceData(deviceId);
        
        // Initialize settings if not exists
        if (!deviceData.settings) {
            deviceData.settings = {
                autoStartRoute: true,
                autoRouteTime: '00:00',
                lastAutoRouteDate: null
            };
        }
        
        // Update settings
        if (autoStartRoute !== undefined) {
            deviceData.settings.autoStartRoute = !!autoStartRoute;
        }
        if (autoRouteTime !== undefined) {
            // Validate time format (HH:MM)
            if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(autoRouteTime)) {
                return res.status(400).json({ error: 'Invalid time format. Use HH:MM (24-hour)' });
            }
            deviceData.settings.autoRouteTime = autoRouteTime;
        }
        
        await saveDeviceData(deviceId, deviceData);
        
        res.json({ 
            success: true, 
            settings: deviceData.settings,
            message: `Auto-route settings updated for device ${deviceId}`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manually trigger auto-route creation (admin only)
app.post('/api/devices/:deviceId/create-auto-route', requireLogin, requireAdmin, async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const deviceData = await getDeviceData(deviceId);
        
        await createAutoRoute(deviceId, deviceData);
        
        res.json({ 
            success: true, 
            message: `Auto-route created manually for device ${deviceId}`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get route data
app.get('/api/routes/:routeId', requireLogin, validateToken, async (req, res) => {
    try {
        const routeId = req.params.routeId;

        // Share sessions: only allow access to their specific route
        if (req.session.role === 'share' && req.session.shareRouteId !== routeId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        const routeData = await fs.readFile(routeFile, 'utf8');
        const route = JSON.parse(routeData);
        
        // Apply data window filter if user has one
        const users = await loadUsers();
        const dw = users[req.session.userId]?.dataWindow;
        if (dw && (dw.from || dw.to)) {
            const from = dw.from ? new Date(dw.from).getTime() : null;
            const to = dw.to ? new Date(dw.to + 'T23:59:59').getTime() : null;
            route.points = route.points.filter(p => {
                const t = new Date(p.timestamp).getTime();
                if (isNaN(t)) return true;
                if (from && t < from) return false;
                if (to && t > to) return false;
                return true;
            });
        }

        // Support different response formats
        const format = req.query.format || 'full';
        
        if (format === 'latest') {
            const latestPoints = route.points.slice(-10); // Last 10 points
            res.json({
                ...route,
                points: latestPoints,
                totalPoints: route.points.length,
                returnedPoints: latestPoints.length
            });
        } else {
            res.json(route);
        }
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Trigger route analysis
app.post('/api/routes/:routeId/analyze', requireLogin, validateToken, async (req, res) => {
    try {
        const routeId = req.params.routeId;
        
        // Check if user can access this route
        if (req.session.role === 'share' && req.session.shareRouteId !== routeId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        let routeData;
        
        try {
            const data = await fs.readFile(routeFile, 'utf8');
            routeData = JSON.parse(data);
        } catch (error) {
            return res.status(404).json({ error: 'Route not found' });
        }
        
        // Perform route analysis
        console.log(`🔍 Manual route analysis triggered for ${routeData.name}`);
        
        try {
            const analysis = await analyzeCompleteRoute(routeData);
            routeData.analysis = analysis;
            routeData.analysis.lastAnalyzed = new Date().toISOString();
            
            // Save updated route with analysis
            await saveRoute(routeData);
            
            console.log(`✅ Manual route analysis completed for ${routeData.name}`);
            
            res.json({
                success: true,
                message: 'Route analysis completed',
                analysis: analysis,
                route: routeData
            });
        } catch (analysisError) {
            console.error('Route analysis failed:', analysisError);
            res.status(500).json({ 
                error: 'Route analysis failed', 
                details: analysisError.message 
            });
        }
        
    } catch (error) {
        console.error('Route analysis endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add route archiving endpoint  
app.post('/api/routes/:routeId/archive', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeId = req.params.routeId;
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        
        let routeData;
        try {
            const data = await fs.readFile(routeFile, 'utf8');
            routeData = JSON.parse(data);
        } catch (error) {
            return res.status(404).json({ error: 'Route not found' });
        }
        
        // Mark as archived
        routeData.status = 'archived';
        routeData.archivedAt = new Date().toISOString();
        
        await saveRoute(routeData);
        
        console.log(`📦 Route archived: ${routeData.name}`);
        
        res.json({
            success: true,
            message: 'Route archived successfully'
        });
        
    } catch (error) {
        console.error('Route archive error:', error);
        res.status(500).json({ error: 'Failed to archive route' });
    }
});

// Copy a route for testing/debugging
app.post('/api/routes/:routeId/copy', requireLogin, requireAdmin, async (req, res) => {
    try {
        const sourceRouteId = req.params.routeId;
        const { name, deviceId } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Route name is required' });
        }
        
        // Read source route 
        const sourceFile = path.join(DATA_DIR, 'routes', `${sourceRouteId}.json`);
        const sourceData = await fs.readFile(sourceFile, 'utf8');
        const sourceRoute = JSON.parse(sourceData);
        
        // Create new route ID
        const newRouteId = `${(deviceId || sourceRoute.deviceId)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create copied route with new metadata
        const copiedRoute = {
            ...sourceRoute,
            id: newRouteId,
            name: name.trim(),
            deviceId: deviceId || sourceRoute.deviceId,
            copyOf: sourceRouteId,
            copyTimestamp: new Date().toISOString(),
            status: 'completed', // Copies are never active
            endTime: sourceRoute.endTime || new Date().toISOString(), // Ensure end time is set
            favorite: false,
            deleted: false,
            deletedAt: null,
            deletedBy: null
        };
        
        // Remove any live/active flags
        delete copiedRoute.isLive;
        
        // Save copied route
        const newFile = path.join(DATA_DIR, 'routes', `${newRouteId}.json`);
        await fs.writeFile(newFile, JSON.stringify(copiedRoute, null, 2), 'utf8');
        
        // Update device routes list
        const device = await getDeviceData(copiedRoute.deviceId);
        if (!device.routes.includes(newRouteId)) {
            device.routes.unshift(newRouteId);
            
            const deviceFile = path.join(DATA_DIR, 'devices', `${copiedRoute.deviceId}.json`);
            await fs.writeFile(deviceFile, JSON.stringify(device, null, 2), 'utf8');
        }
        
        console.log(`📋 Route copied: ${sourceRouteId} → ${newRouteId} ("${name}")`);
        
        res.json({ 
            success: true, 
            message: 'Route copied successfully',
            newRouteId,
            newRouteName: name.trim()
        });
        
    } catch (error) {
        console.error('Error copying route:', error);
        res.status(500).json({ error: 'Failed to copy route: ' + error.message });
    }
});

// List routes for device
app.get('/api/devices/:deviceId/routes', requireLogin, validateToken, async (req, res) => {
    if (!(await canAccessDevice(req, req.params.deviceId))) return res.status(403).json({ error: 'Access denied' });
    try {
        const deviceId = req.params.deviceId;
        const deviceData = await getDeviceData(deviceId);
        
        const routes = await Promise.all(
            deviceData.routes.map(async (routeId) => {
                try {
                    const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
                    const routeData = await fs.readFile(routeFile, 'utf8');
                    const route = JSON.parse(routeData);
                    
                    // Return summary without all points
                    return {
                        id: route.id,
                        deviceId: route.deviceId,
                        name: route.name,
                        color: route.color || null,
                        favorite: route.favorite === true,
                        deleted: route.deleted === true,
                        startTime: route.startTime,
                        endTime: route.endTime,
                        totalPoints: route.points.length,
                        totalDistance: route.totalDistance,
                        status: route.status
                    };
                } catch (error) {
                    return null;
                }
            })
        );
        
        let filtered = routes.filter(r => r !== null && r.deleted !== true);

        // Always sort chronologically (newest first)
        filtered.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

        // Apply data window filter if user has one
        const users = await loadUsers();
        const dw = users[req.session.userId]?.dataWindow;
        if (dw && (dw.from || dw.to)) {
            const from = dw.from ? new Date(dw.from).getTime() : null;
            const to = dw.to ? new Date(dw.to + 'T23:59:59').getTime() : null;
            filtered = filtered.filter(r => {
                const t = r.startTime ? new Date(r.startTime).getTime() : null;
                if (!t || isNaN(t)) return true;
                if (from && t < from) return false;
                if (to && t > to) return false;
                return true;
            });
        }

        const user = users[req.session.userId];
        const historyRouteLimit = user?.historyRouteLimit;
        const limitValue = (historyRouteLimit && Number.isFinite(Number(historyRouteLimit)))
            ? Number(historyRouteLimit)
            : null;

        res.json({ deviceId, routes: filtered, historyRouteLimit: limitValue });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stop current route
app.post('/api/devices/:deviceId/stop-route', requireLogin, validateToken, async (req, res) => {
    if (!(await canAccessDevice(req, req.params.deviceId))) return res.status(403).json({ error: 'Access denied' });
    try {
        const deviceId = req.params.deviceId;
        const deviceData = await getDeviceData(deviceId);
        
        if (deviceData.currentRoute) {
            const routeFile = path.join(DATA_DIR, 'routes', `${deviceData.currentRoute}.json`);
            const routeData = await fs.readFile(routeFile, 'utf8');
            const route = JSON.parse(routeData);
            
            route.endTime = new Date().toISOString();
            route.status = 'completed';
            
            await saveRoute(route);
            
            deviceData.currentRoute = null;
            await saveDeviceData(deviceId, deviceData);
            
            res.json({
                success: true,
                message: 'Route stopped',
                route: {
                    id: route.id,
                    name: route.name,
                    totalPoints: route.points.length,
                    totalDistance: route.totalDistance
                }
            });
        } else {
            res.json({ message: 'No active route to stop' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename a route
app.patch('/api/routes/:routeId', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
        const routeFile = path.join(DATA_DIR, 'routes', `${req.params.routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        route.name = name.trim();
        if (color && /^#[0-9a-fA-F]{6}$/.test(color)) route.color = color;
        await saveRoute(route);
        res.json({ success: true, name: route.name, color: route.color || null });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Toggle route favorite state
app.patch('/api/routes/:routeId/favorite', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeFile = path.join(DATA_DIR, 'routes', `${req.params.routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        route.favorite = req.body.favorite === true;
        await saveRoute(route);
        res.json({ success: true, favorite: route.favorite });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Update route points (manual editing — add, delete, move)
// editSnapshotTime: if provided, any points on the server with timestamp AFTER this are preserved
// and appended to the edited set, so live GPS pushes during an edit session are not lost.
app.put('/api/routes/:routeId/points', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { points, editSnapshotTime } = req.body;
        console.log(`📝 Updating route ${req.params.routeId} points: ${points?.length} points`);
        if (!Array.isArray(points) || points.length < 2) {
            return res.status(400).json({ error: 'points array with at least 2 entries is required' });
        }
        for (const p of points) {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
                return res.status(400).json({ error: 'Each point must have numeric lat and lng' });
            }
        }
        const routeFile = path.join(DATA_DIR, 'routes', `${req.params.routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));

        // If route is still active and we have a snapshot time, preserve any GPS points
        // that arrived on the server after the edit session started
        let finalPoints = points;
        if (editSnapshotTime && route.status === 'active' && Array.isArray(route.points)) {
            const cutoff = new Date(editSnapshotTime).getTime();
            const newServerPoints = route.points.filter(p => {
                const t = p.timestamp ? new Date(p.timestamp).getTime() : 0;
                return t > cutoff;
            });
            if (newServerPoints.length > 0) {
                finalPoints = [...points, ...newServerPoints];
                finalPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            }
        }

        route.points = finalPoints;
        // Recalculate total distance
        let totalDistance = 0;
        for (let i = 1; i < finalPoints.length; i++) {
            totalDistance += calculateDistance(finalPoints[i-1].lat, finalPoints[i-1].lng, finalPoints[i].lat, finalPoints[i].lng);
        }
        route.totalDistance = totalDistance;
        route.totalPoints = finalPoints.length;
        route.startTime = finalPoints[0].timestamp || route.startTime;
        if (route.status !== 'active') {
            route.endTime = finalPoints[finalPoints.length - 1].timestamp || route.endTime;
        }

        // Points changed: previous analysis geometry is stale and can render wrong paths.
        route.analysis = {
            segments: [],
            pausePoints: [],
            splitPoints: [],
            lastAnalyzed: null,
            version: '2.0'
        };

        await saveRoute(route);
        console.log(`✅ Route ${req.params.routeId} points updated successfully: ${finalPoints.length} points, ${totalDistance.toFixed(2)}km`);
        res.json({ success: true, totalPoints: finalPoints.length, totalDistance });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Activate a completed route — makes it the active route for the device so GPS appends to it
app.post('/api/devices/:deviceId/routes/:routeId/activate', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { deviceId, routeId } = req.params;
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        if (route.deviceId !== deviceId) return res.status(400).json({ error: 'Route does not belong to this device' });

        const deviceData = await getDeviceData(deviceId);

        // Complete any currently active route first
        if (deviceData.currentRoute && deviceData.currentRoute !== routeId) {
            try {
                const curFile = path.join(DATA_DIR, 'routes', `${deviceData.currentRoute}.json`);
                const cur = JSON.parse(await fs.readFile(curFile, 'utf8'));
                if (cur.status === 'active') {
                    cur.status = 'completed';
                    cur.endTime = new Date().toISOString();
                    await saveRoute(cur);
                }
            } catch { /* current route file missing — ignore */ }
        }

        route.status = 'active';
        route.endTime = null;
        await saveRoute(route);

        deviceData.currentRoute = routeId;
        if (!deviceData.routes.includes(routeId)) deviceData.routes.unshift(routeId);
        await saveDeviceData(deviceId, deviceData);

        console.log(`▶️  Activated route: ${route.name} (${routeId}) for device ${deviceId}`);
        res.json({ success: true, routeId, name: route.name });
    } catch (error) {
        console.error('Error activating route:', error);
        res.status(500).json({ error: 'Failed to activate route' });
    }
});

// Soft-delete a route (move to basket)
app.delete('/api/routes/:routeId', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeId = req.params.routeId;
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        const deviceId = route.deviceId;

        route.deleted = true;
        route.deletedAt = new Date().toISOString();
        route.deletedBy = req.session.username || 'admin';
        if (route.status === 'active') route.status = 'completed';
        await saveRoute(route);

        // Clear currentRoute if needed
        const deviceData = await getDeviceData(deviceId);
        if (deviceData.currentRoute === routeId) deviceData.currentRoute = null;
        await saveDeviceData(deviceId, deviceData);

        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Admin: list routes in basket
app.get('/api/admin/routes/basket', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routesDir = path.join(DATA_DIR, 'routes');
        const files = await fs.readdir(routesDir).catch(() => []);
        const items = [];

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const route = JSON.parse(await fs.readFile(path.join(routesDir, file), 'utf8'));
                if (route.deleted === true) {
                    items.push({
                        id: route.id,
                        deviceId: route.deviceId,
                        name: route.name,
                        totalPoints: Array.isArray(route.points) ? route.points.length : (route.totalPoints || 0),
                        totalDistance: route.totalDistance || 0,
                        startTime: route.startTime,
                        endTime: route.endTime,
                        deletedAt: route.deletedAt || null,
                        deletedBy: route.deletedBy || null
                    });
                }
            } catch {
                // ignore invalid files
            }
        }

        items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
        res.json({ routes: items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: restore route from basket
app.post('/api/admin/routes/:routeId/restore', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeFile = path.join(DATA_DIR, 'routes', `${req.params.routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        route.deleted = false;
        route.deletedAt = null;
        route.deletedBy = null;
        await saveRoute(route);
        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Admin: permanently delete selected basket routes
app.delete('/api/admin/routes/basket', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeIds = Array.isArray(req.body?.routeIds) ? req.body.routeIds : [];
        if (routeIds.length === 0) return res.status(400).json({ error: 'routeIds required' });

        let deletedCount = 0;
        for (const routeId of routeIds) {
            const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
            let route;
            try {
                route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
            } catch {
                continue;
            }
            if (route.deleted !== true) continue;

            const deviceData = await getDeviceData(route.deviceId);
            deviceData.routes = (deviceData.routes || []).filter(id => id !== routeId);
            if (deviceData.currentRoute === routeId) deviceData.currentRoute = null;
            await saveDeviceData(route.deviceId, deviceData);

            await fs.unlink(routeFile).catch(() => {});
            deletedCount++;
        }

        res.json({ success: true, deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: permanently delete all routes in basket
app.delete('/api/admin/routes/basket/all', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routesDir = path.join(DATA_DIR, 'routes');
        const files = await fs.readdir(routesDir).catch(() => []);
        const ids = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const route = JSON.parse(await fs.readFile(path.join(routesDir, file), 'utf8'));
                if (route.deleted === true) ids.push(route.id);
            } catch {
                // ignore invalid files
            }
        }

        if (ids.length === 0) return res.json({ success: true, deletedCount: 0 });

        let deletedCount = 0;
        for (const routeId of ids) {
            const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
            let route;
            try {
                route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
            } catch {
                continue;
            }

            const deviceData = await getDeviceData(route.deviceId);
            deviceData.routes = (deviceData.routes || []).filter(id => id !== routeId);
            if (deviceData.currentRoute === routeId) deviceData.currentRoute = null;
            await saveDeviceData(route.deviceId, deviceData);

            await fs.unlink(routeFile).catch(() => {});
            deletedCount++;
        }

        res.json({ success: true, deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Merge multiple routes into one (sorted by time, recalculates distance)
app.post('/api/devices/:deviceId/routes/merge', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { routeIds, name } = req.body;
        if (!Array.isArray(routeIds) || routeIds.length < 2) {
            return res.status(400).json({ error: 'At least 2 route IDs required' });
        }

        // Load and validate all routes belong to this device
        const routes = [];
        for (const id of routeIds) {
            const routeFile = path.join(DATA_DIR, 'routes', `${id}.json`);
            const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
            if (route.deviceId !== deviceId) {
                return res.status(400).json({ error: `Route ${id} does not belong to device ${deviceId}` });
            }
            routes.push(route);
        }

        // Sort routes by startTime so the oldest becomes the base
        routes.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        // Merge all points sorted by timestamp
        const allPoints = routes.flatMap(r => r.points);
        allPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Recalculate total distance
        let totalDistance = 0;
        for (let i = 1; i < allPoints.length; i++) {
            totalDistance += calculateDistance(
                allPoints[i-1].lat, allPoints[i-1].lng,
                allPoints[i].lat, allPoints[i].lng
            );
        }

        const anyActive = routes.some(r => r.status === 'active');
        const endTimes = routes.filter(r => r.endTime).map(r => new Date(r.endTime));
        const endTime = anyActive ? null : (endTimes.length > 0 ? new Date(Math.max(...endTimes)).toISOString() : null);

        // Build merged route using the oldest route's ID
        const mergedRoute = {
            ...routes[0],
            name: (name && name.trim()) ? name.trim() : routes[0].name,
            points: allPoints,
            totalDistance,
            startTime: routes[0].startTime,
            endTime,
            status: anyActive ? 'active' : 'completed'
        };
        await saveRoute(mergedRoute);

        // Delete the other route files
        const toDelete = routes.slice(1);
        for (const route of toDelete) {
            await fs.unlink(path.join(DATA_DIR, 'routes', `${route.id}.json`));
        }

        // Update device data
        const deviceData = await getDeviceData(deviceId);
        const deletedIds = new Set(toDelete.map(r => r.id));
        deviceData.routes = deviceData.routes.filter(id => !deletedIds.has(id));
        if (!deviceData.routes.includes(mergedRoute.id)) {
            deviceData.routes.unshift(mergedRoute.id);
        }
        if (deletedIds.has(deviceData.currentRoute)) {
            deviceData.currentRoute = mergedRoute.id;
        }
        await saveDeviceData(deviceId, deviceData);

        console.log(`🔀 Merged ${routes.length} routes into ${mergedRoute.id} (${allPoints.length} pts, ${totalDistance.toFixed(2)} km)`);
        res.json({ success: true, route: { id: mergedRoute.id, name: mergedRoute.name, totalPoints: allPoints.length, totalDistance } });
    } catch (error) {
        console.error('Error merging routes:', error);
        res.status(500).json({ error: 'Failed to merge routes' });
    }
});

// =====================
// DEBUGGING ENDPOINTS
// =====================

// Admin log viewer endpoint - requires canViewLogs permission
app.get('/api/admin/logs', requireLogin, requireLogAccess, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const gpsOnly = req.query.gpsOnly === 'true';
    requestLogs = loadRequestLogs(); // refresh from file
    const logs = gpsOnly
        ? requestLogs.filter(log => log.path === '/api/gps' && log.method === 'POST')
        : requestLogs;
    res.json({
        total: requestLogs.length,
        gpsTotal: requestLogs.filter(l => l.path === '/api/gps' && l.method === 'POST').length,
        logs: logs.slice(0, limit)
    });
});

// Debug endpoint - view recent requests (session auth, used by GPS monitoring loop)
app.get('/api/debug/requests', requireLogin, (req, res) => {
    requestLogs = loadRequestLogs(); // refresh from shared file
    res.json({
        total: requestLogs.length,
        requests: requestLogs.slice(0, 20), // Last 20 requests
        summary: {
            gpsRequests: requestLogs.filter(log => log.path === '/api/gps').length,
            lastGpsRequest: requestLogs.find(log => log.path === '/api/gps')?.timestamp || null
        }
    });
});

// Debug endpoint - connectivity test  
app.get('/api/debug/connectivity', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        server: 'Route Tracker GPS Receiver',
        endpoints: {
            gps: '/api/gps',
            health: '/api/health',
            debug: '/api/debug/connectivity'
        },
        testUrl: req.protocol + '://' + req.get('host') + '/api/debug/ping'
    });
});

// Debug endpoint - ping test
app.all('/api/debug/ping', (req, res) => {
    res.json({
        method: req.method,
        timestamp: new Date().toISOString(),
        message: 'pong',
        received: {
            query: req.query,
            body: req.body,
            headers: Object.keys(req.headers)
        }
    });
});

// Debug endpoint - system status
app.get('/api/debug/status', requireLogin, requireAdmin, validateToken, async (req, res) => {
    try {
        // Count files in data directories
        const devicesDir = path.join(DATA_DIR, 'devices');
        const routesDir = path.join(DATA_DIR, 'routes');
        
        let deviceCount = 0;
        let routeCount = 0;
        
        try {
            const devices = await fs.readdir(devicesDir);
            deviceCount = devices.filter(f => f.endsWith('.json')).length;
        } catch (e) { /* ignore */ }
        
        try {
            const routes = await fs.readdir(routesDir);
            routeCount = routes.filter(f => f.endsWith('.json')).length;
        } catch (e) { /* ignore */ }
        
        res.json({
            status: 'running',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            data: {
                devices: deviceCount,
                routes: routeCount,
                requestLogs: requestLogs.length
            },
            recentActivity: {
                lastRequest: requestLogs[0]?.timestamp || null,
                lastGpsData: requestLogs.find(log => log.path === '/api/gps' && log.method === 'POST')?.timestamp || null,
                requestsInLastHour: requestLogs.filter(log => 
                    new Date() - new Date(log.timestamp) < 3600000
                ).length
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint - view device data
app.get('/api/debug/devices', requireLogin, validateToken, async (req, res) => {
    try {
        const devicesDir = path.join(DATA_DIR, 'devices');
        let devices = [];
        
        try {
            const files = await fs.readdir(devicesDir);
            for (const file of files.filter(f => f.endsWith('.json'))) {
                const deviceData = await getDeviceData(file.replace('.json', ''));
                devices.push({
                    deviceId: deviceData.deviceId,
                    name: deviceData.name,
                    created: deviceData.created,
                    lastUpdate: deviceData.lastUpdate,
                    totalPoints: deviceData.totalPoints,
                    routeCount: deviceData.routes.length,
                    hasActiveRoute: !!deviceData.currentRoute
                });
            }
        } catch (e) { /* ignore */ }
        
        res.json({ devices });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// Initialize and start server
const startServer = async () => {
    await ensureDataDir();

    // Bootstrap admin user if no users exist
    const users = await loadUsers();
    if (Object.keys(users).length === 0) {
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword) throw new Error('ADMIN_PASSWORD environment variable is not set');
        const id = crypto.randomBytes(8).toString('hex');
        users[id] = {
            id,
            username: 'admin',
            passwordHash: await bcrypt.hash(adminPassword, BCRYPT_ROUNDS),
            role: 'admin',
            allowedDevices: [],
            devices: [],
            created: new Date().toISOString(),
            lastLogin: null
        };
        await saveUsers(users);
        console.log(`✅ Admin user created. Username: admin  Password: ${adminPassword}`);
    }
    
    // ─── MEDIA ROUTES ────────────────────────────────────────────────────────

    // multer: store uploads in a temp dir, we process with sharp then move
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
        fileFilter: (req, file, cb) => {
            if (file.mimetype.startsWith('image/')) cb(null, true);
            else cb(new Error('Only image files are allowed'));
        }
    });

    // helpers
    const mediaFile = (deviceId) => path.join(MEDIA_DIR, deviceId, 'media.json');

    const loadMedia = async (deviceId) => {
        try {
            const raw = await fs.readFile(mediaFile(deviceId), 'utf8');
            return JSON.parse(raw);
        } catch { return []; }
    };

    const saveMedia = async (deviceId, entries) => {
        const dir = path.join(MEDIA_DIR, deviceId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(mediaFile(deviceId), JSON.stringify(entries, null, 2));
    };

    // GET all media for a device — logged in users only
    // Optional ?routeId= filter: returns entries belonging to that route, plus legacy entries (no routeId)
    app.get('/api/media/:deviceId', requireLogin, async (req, res) => {
        try {
            const entries = await loadMedia(req.params.deviceId);
            const { routeId } = req.query;
            const result = routeId
                ? entries.filter(e => !e.routeId || e.routeId === routeId)
                : entries;
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET photo file
    app.get('/api/media/:deviceId/:id/photo', requireLogin, async (req, res) => {
        const file = path.join(MEDIA_DIR, req.params.deviceId, 'photos', `${req.params.id}.jpg`);
        try {
            await fs.access(file);
            res.sendFile(file);
        } catch { res.status(404).json({ error: 'Not found' }); }
    });

    // GET thumbnail
    app.get('/api/media/:deviceId/:id/thumb', requireLogin, async (req, res) => {
        const file = path.join(MEDIA_DIR, req.params.deviceId, 'photos', `${req.params.id}_thumb.jpg`);
        try {
            await fs.access(file);
            res.sendFile(file);
        } catch { res.status(404).json({ error: 'Not found' }); }
    });

    // POST upload photo — admin only
    app.post('/api/media/:deviceId/photo', requireLogin, requireAdmin, upload.single('photo'), async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { description = '', lat, lng, timestamp, routeId } = req.body;

            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            // Extract EXIF GPS via sharp metadata
            const metadata = await sharp(req.file.buffer).metadata();
            let photoLat = parseFloat(lat);
            let photoLng = parseFloat(lng);
            let photoTime = timestamp || new Date().toISOString();

            // Try exifr if no coords provided
            if ((!photoLat || !photoLng) || isNaN(photoLat) || isNaN(photoLng)) {
                try {
                    const gps = await exifr.gps(req.file.buffer);
                    if (gps && gps.latitude && gps.longitude) {
                        photoLat = gps.latitude;
                        photoLng = gps.longitude;
                    }
                } catch (e) { /* no EXIF GPS */ }
            }

            if (!photoLat || !photoLng || isNaN(photoLat) || isNaN(photoLng)) {
                return res.status(400).json({ error: 'no_gps', message: 'No GPS data in photo. Please provide coordinates.' });
            }

            // Determine target ratio from original dimensions
            const { width, height } = metadata;
            const ratio = width / height;
            let targetWidth, targetHeight;
            if (ratio >= 1) {
                // Landscape: 16:9 or 16:10
                if (Math.abs(ratio - 16/10) < Math.abs(ratio - 16/9)) {
                    targetWidth = 1980; targetHeight = Math.round(1980 * 10 / 16);
                } else {
                    targetWidth = 1980; targetHeight = Math.round(1980 * 9 / 16);
                }
            } else {
                // Portrait: 3:4
                targetHeight = 1980; targetWidth = Math.round(1980 * 3 / 4);
            }

            const id = crypto.randomBytes(8).toString('hex');
            const photoDir = path.join(MEDIA_DIR, deviceId, 'photos');
            await fs.mkdir(photoDir, { recursive: true });

            // Save resized full photo
            await sharp(req.file.buffer)
                .resize(targetWidth, targetHeight, { fit: 'cover', position: 'attention' })
                .jpeg({ quality: 85 })
                .toFile(path.join(photoDir, `${id}.jpg`));

            // Save thumbnail (200px wide)
            await sharp(req.file.buffer)
                .resize(200, 200, { fit: 'cover', position: 'attention' })
                .jpeg({ quality: 75 })
                .toFile(path.join(photoDir, `${id}_thumb.jpg`));

            const entry = {
                id,
                type: 'photo',
                lat: photoLat,
                lng: photoLng,
                timestamp: photoTime,
                description,
                filename: `${id}.jpg`,
                createdAt: new Date().toISOString(),
                ...(routeId ? { routeId } : {})
            };

            const entries = await loadMedia(deviceId);
            entries.push(entry);
            await saveMedia(deviceId, entries);

            res.json({ success: true, entry });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // POST add YouTube video — admin only
    app.post('/api/media/:deviceId/youtube', requireLogin, requireAdmin, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { url, description = '', lat, lng, routeId } = req.body;

            if (!url || !url.includes('youtu')) return res.status(400).json({ error: 'Invalid YouTube URL' });
            const photoLat = parseFloat(lat);
            const photoLng = parseFloat(lng);
            if (isNaN(photoLat) || isNaN(photoLng)) return res.status(400).json({ error: 'Coordinates required' });

            const id = crypto.randomBytes(8).toString('hex');
            const entry = {
                id,
                type: 'youtube',
                lat: photoLat,
                lng: photoLng,
                url,
                description,
                createdAt: new Date().toISOString(),
                ...(routeId ? { routeId } : {})
            };

            const entries = await loadMedia(deviceId);
            entries.push(entry);
            await saveMedia(deviceId, entries);

            res.json({ success: true, entry });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // DELETE media entry — admin only
    app.delete('/api/media/:deviceId/:id', requireLogin, requireAdmin, async (req, res) => {
        try {
            const { deviceId, id } = req.params;
            const entries = await loadMedia(deviceId);
            const entry = entries.find(e => e.id === id);
            if (!entry) return res.status(404).json({ error: 'Not found' });

            if (entry.type === 'photo') {
                const photoDir = path.join(MEDIA_DIR, deviceId, 'photos');
                await fs.unlink(path.join(photoDir, `${id}.jpg`)).catch(() => {});
                await fs.unlink(path.join(photoDir, `${id}_thumb.jpg`)).catch(() => {});
            }

            await saveMedia(deviceId, entries.filter(e => e.id !== id));
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.patch('/api/media/:deviceId/:id', requireLogin, requireAdmin, async (req, res) => {
        try {
            const { deviceId, id } = req.params;
            const { description, lat, lng } = req.body;
            const entries = await loadMedia(deviceId);
            const entry = entries.find(e => e.id === id);
            if (!entry) return res.status(404).json({ error: 'Not found' });
            if (description !== undefined) entry.description = description;
            if (lat !== undefined) entry.lat = parseFloat(lat);
            if (lng !== undefined) entry.lng = parseFloat(lng);
            await saveMedia(deviceId, entries);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Helper: parse raw EXIF buffer for GPS (IFD GPS tags)
    // ─── END MEDIA ROUTES ─────────────────────────────────────────────────────

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Route Tracker GPS Receiver API running on port ${PORT} (worker ${process.pid})`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
        console.log(`GPS endpoint: http://localhost:${PORT}/api/gps`);
    });
};

startServer().catch(console.error);

module.exports = app;