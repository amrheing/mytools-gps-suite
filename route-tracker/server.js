const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = '/app/data';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // set true if HTTPS-only (nginx handles TLS termination here)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.static('/usr/share/nginx/html'));
app.use('/shared', express.static('/app/shared'));

const USERS_FILE = path.join(DATA_DIR, 'users.json');
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

// Middleware: require web login session
const requireLogin = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    // API calls get 401, browser navigation gets redirect
    if (req.headers['content-type']?.includes('application/json') || req.headers['accept']?.includes('application/json')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
};

// Middleware: require admin role
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.role === 'admin') return next();
    return res.status(403).json({ error: 'Admin access required' });
};

// Store incoming request logs for debugging
let requestLogs = [];
const MAX_LOGS = 100;

// Request logging middleware
const logRequests = (req, res, next) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        headers: {
            authorization: req.headers.authorization ? '***' : undefined,
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent']
        }
    };
    
    requestLogs.unshift(logEntry);
    if (requestLogs.length > MAX_LOGS) {
        requestLogs = requestLogs.slice(0, MAX_LOGS);
    }
    
    console.log(`[${logEntry.timestamp}] ${logEntry.method} ${logEntry.path}`, req.body ? JSON.stringify(req.body).substring(0, 200) : '');
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
    } catch (error) {
        console.error('Error creating data directories:', error);
    }
};

// Load or create access tokens
const loadTokens = async () => {
    try {
        const tokensFile = path.join(DATA_DIR, 'tokens.json');
        const data = await fs.readFile(tokensFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Create default token if file doesn't exist
        const defaultTokens = {
            'default-token-123': {
                name: 'Default Device Token',
                created: new Date().toISOString(),
                lastUsed: null,
                deviceIds: []
            }
        };
        await saveTokens(defaultTokens);
        return defaultTokens;
    }
};

const saveTokens = async (tokens) => {
    try {
        const tokensFile = path.join(DATA_DIR, 'tokens.json');
        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error('Error saving tokens:', error);
    }
};

// Token validation middleware
const validateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // Extract token from Bearer header, Basic Auth username, query param, body, or OwnTracks topic
    let token = authHeader?.replace('Bearer ', '');
    
    // Basic Auth (OwnTracks HTTP mode uses username as token)
    if (!token && authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        token = decoded.split(':')[0]; // username part
    }
    
    if (!token) token = req.query.token;
    if (!token) token = req.body?.token;
    
    // OwnTracks topic format: "owntracks/<username>/<deviceId>"
    // Check both username (parts[1]) and deviceId (parts[2]) as potential tokens
    if (!token && req.body?.topic) {
        const parts = req.body.topic.split('/');
        if (parts.length >= 2) token = parts[1]; // username segment first
        // parts[2] will be checked against tokens below as fallback
    }
    
    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({ 
            error: 'Access token required',
            message: 'Provide token in Authorization header, query parameter, or body'
        });
    }

    const tokens = await loadTokens();
    
    // If token from parts[1] not valid, try parts[2] (the deviceId segment)
    if (!tokens[token] && req.body?.topic) {
        const parts = req.body.topic.split('/');
        if (parts.length >= 3) token = parts[2];
    }
    
    if (!tokens[token]) {
        console.log('❌ Token not found in tokens:', token);
        return res.status(403).json({ 
            error: 'Invalid access token',
            message: 'Token not found or expired'
        });
    }

    console.log('✅ Token validated successfully');
    console.log('===============================');

    // Update last used timestamp
    tokens[token].lastUsed = new Date().toISOString();
    await saveTokens(tokens);

    req.token = token;
    req.tokenData = tokens[token];
    next();
};

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
            lastUpdate: null
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
            source: 'overlander-app',
            version: '1.0'
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

// Parse different GPS data formats
const parseGPSData = (data, format = 'auto') => {
    let points = [];
    
    if (format === 'owntracks' || (format === 'auto' && data._type)) {
        // OwnTracks format
        if (data._type === 'location') {
            points.push({
                lat: data.lat,
                lng: data.lon,
                alt: data.alt || null,
                timestamp: new Date(data.tst * 1000).toISOString(),
                accuracy: data.acc || null,
                speed: data.vel || null,
                bearing: data.cog || null,
                battery: data.batt || null,
                source: 'owntracks'
            });
        }
    } else if (data.locations && Array.isArray(data.locations)) {
        // Overland app format: { locations: [ GeoJSON Feature, ... ] }
        points = data.locations
            .filter(f => f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates))
            .map(f => {
                const coords = f.geometry.coordinates; // [lon, lat, alt?]
                const props = f.properties || {};
                return {
                    lat: coords[1],
                    lng: coords[0],
                    alt: coords[2] != null ? coords[2] : (props.altitude || null),
                    timestamp: props.timestamp || new Date().toISOString(),
                    accuracy: props.horizontal_accuracy || null,
                    speed: props.speed != null ? props.speed : null,
                    bearing: props.course || null,
                    battery: props.battery_level != null ? Math.round(props.battery_level * 100) : null,
                    motion: props.motion ? props.motion[0] : null,
                    source: 'overland'
                };
            });
    } else if (Array.isArray(data)) {
        // Array of points
        points = data.map(point => ({
            lat: point.lat || point.latitude,
            lng: point.lng || point.lon || point.longitude,
            alt: point.alt || point.altitude || null,
            timestamp: point.timestamp || new Date().toISOString(),
            accuracy: point.accuracy || null,
            speed: point.speed || null,
            bearing: point.bearing || null,
            source: 'overlander'
        }));
    } else if (data.lat && data.lng) {
        // Single point
        points.push({
            lat: data.lat || data.latitude,
            lng: data.lng || data.lon || data.longitude,
            alt: data.alt || data.altitude || null,
            timestamp: data.timestamp || new Date().toISOString(),
            accuracy: data.accuracy || null,
            speed: data.speed || null,
            bearing: data.bearing || null,
            source: 'overlander'
        });
    }
    
    // Filter out any points with invalid coordinates
    return points.filter(p => p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng));
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

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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

// Current session info
app.get('/api/auth/me', requireLogin, (req, res) => {
    res.json({ userId: req.session.userId, username: req.session.username, role: req.session.role });
});

// =====================
// ADMIN: USER MANAGEMENT
// =====================

// List all users (admin only)
app.get('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const sanitized = Object.values(users).map(u => ({
        id: u.id, username: u.username, role: u.role,
        allowedDevices: u.allowedDevices || [],
        created: u.created, lastLogin: u.lastLogin || null
    }));
    res.json(sanitized);
});

// Create user (admin only)
app.post('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    const { username, password, role, allowedDevices } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = await loadUsers();
    if (Object.values(users).find(u => u.username === username.trim().toLowerCase())) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    users[id] = {
        id,
        username: username.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role: role === 'admin' ? 'admin' : 'viewer',
        allowedDevices: allowedDevices || [],
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

// Token management for admin
app.post('/api/admin/tokens', async (req, res) => {
    try {
        const { name, adminPassword } = req.body;
        
        // Simple admin protection (in production, use proper auth)
        if (adminPassword !== (process.env.ADMIN_PASSWORD || 'admin123')) {
            return res.status(403).json({ error: 'Invalid admin password' });
        }
        
        const newToken = crypto.randomBytes(32).toString('hex');
        const tokens = await loadTokens();
        
        tokens[newToken] = {
            name: name || 'New Device Token',
            created: new Date().toISOString(),
            lastUsed: null,
            deviceIds: []
        };
        
        await saveTokens(tokens);
        
        res.json({ 
            token: newToken, 
            message: 'Token created successfully',
            tokenData: tokens[newToken]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Receive GPS data from Overlander app
app.post('/api/gps', validateToken, async (req, res) => {
    try {
        // Extract deviceId - for OwnTracks, use the device segment from topic
        let deviceId = req.body.deviceId || req.headers['device-id'] || 'default-device';
        if (req.body?.topic) {
            const parts = req.body.topic.split('/');
            if (parts.length >= 3) deviceId = parts[2]; // owntracks/<user>/<deviceId>
        }
        const format = req.body.format || req.query.format || 'auto';
        const routeName = req.body.routeName || req.headers['route-name'];
        
        console.log(`Received GPS data from device: ${deviceId}`);
        
        // Parse GPS data
        const points = parseGPSData(req.body, format);
        
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
        const routeTimeout = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        const isRouteExpired = currentRoute && 
            (new Date() - new Date(currentRoute.startTime)) > routeTimeout;
            
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

// Get route data
app.get('/api/routes/:routeId', requireLogin, validateToken, async (req, res) => {
    try {
        const routeId = req.params.routeId;
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        const routeData = await fs.readFile(routeFile, 'utf8');
        const route = JSON.parse(routeData);
        
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
                        name: route.name,
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
        
        res.json({
            deviceId,
            routes: routes.filter(r => r !== null)
        });
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

// =====================
// DEBUGGING ENDPOINTS
// =====================

// Debug endpoint - view recent requests
app.get('/api/debug/requests', requireLogin, validateToken, (req, res) => {
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
        
        const tokens = await loadTokens();
        
        res.json({
            status: 'running',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            data: {
                devices: deviceCount,
                routes: routeCount,
                tokens: Object.keys(tokens).length,
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
    await loadTokens(); // Initialize tokens

    // Bootstrap admin user if no users exist
    const users = await loadUsers();
    if (Object.keys(users).length === 0) {
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const id = crypto.randomBytes(8).toString('hex');
        users[id] = {
            id,
            username: 'admin',
            passwordHash: await bcrypt.hash(adminPassword, BCRYPT_ROUNDS),
            role: 'admin',
            allowedDevices: [],
            created: new Date().toISOString(),
            lastLogin: null
        };
        await saveUsers(users);
        console.log(`✅ Admin user created. Username: admin  Password: ${adminPassword}`);
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Route Tracker GPS Receiver API running on port ${PORT}`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
        console.log(`GPS endpoint: http://localhost:${PORT}/api/gps`);
    });
};

startServer().catch(console.error);

module.exports = app;