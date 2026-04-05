const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = '/app/data';
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

// Token validation middleware
const validateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // Extract the raw token string from request (priority: Bearer > query > body > Basic Auth > topic)
    let raw = null;
    if (authHeader?.startsWith('Bearer ')) raw = authHeader.slice(7);
    if (!raw) raw = req.query.token;
    if (!raw) raw = req.body?.token;
    if (!raw && authHeader?.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        raw = decoded.split(':')[0];
    }
    if (!raw && req.body?.topic) {
        const parts = req.body.topic.split('/');
        if (parts.length >= 2) raw = parts[1];
    }

    if (!raw) {
        return res.status(401).json({ error: 'Access token required' });
    }

    // Share sessions bypass GPS token validation (read-only access controlled by canAccessDevice)
    if (req.session?.role === 'share') return next();
    const users = await loadUsers();
    const userByToken = Object.values(users).find(u => u.gpsToken && u.gpsToken === raw);
    if (userByToken) {
        console.log(`✅ GPS token validated for user: ${userByToken.username}`);
        req.token = raw;
        req.tokenData = { name: userByToken.username, userId: userByToken.id };
        req.tokenUserId = userByToken.id;
        return next();
    }

    // --- FALLBACK: check tokens.json (for shared/anonymous device tokens) ---
    const tokens = await loadTokens();
    let token = raw;

    // Try by key, then by name
    if (!tokens[token]) {
        const byName = Object.entries(tokens).find(([, t]) => t.name === token);
        if (byName) token = byName[0];
    }
    // Try topic parts[2] as last resort
    if (!tokens[token] && req.body?.topic) {
        const parts = req.body.topic.split('/');
        if (parts.length >= 3) token = parts[2];
        if (!tokens[token]) {
            const byName = Object.entries(tokens).find(([, t]) => t.name === token);
            if (byName) token = byName[0];
        }
    }

    if (!tokens[token]) {
        console.log(`❌ Token not found: ${raw}`);
        return res.status(403).json({ error: 'Invalid access token' });
    }

    console.log(`✅ Token validated: ${tokens[token].name}`);
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
        // Overland/Overlander batch format: { locations: [ GeoJSON Feature, ... ] }
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
    } else if (data.current && data.current.geometry) {
        // Overlander single-point format: { current: GeoJSON Feature, locations: [...] }
        // Process all locations if present, otherwise just current
        const features = (data.locations && data.locations.length > 0) ? data.locations : [data.current];
        points = features
            .filter(f => f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates))
            .map(f => {
                const coords = f.geometry.coordinates;
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
                    source: 'overlander'
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
            gpsToken: null,
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
        gpsToken: user?.gpsToken || null,
        allowedDevices: user?.allowedDevices || [],
        dataWindow: user?.dataWindow || { from: null, to: null },
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
        allowedDevices: u.allowedDevices || [],
        gpsToken: u.gpsToken || null,
        dataWindow: u.dataWindow || { from: null, to: null },
        created: u.created, lastLogin: u.lastLogin || null
    }));
    res.json(sanitized);
});

// Create user (admin only)
app.post('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    const { username, password, role, allowedDevices, gpsToken, dataWindow } = req.body;
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
        gpsToken: gpsToken || null,
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
    if (req.body.gpsToken !== undefined) user.gpsToken = req.body.gpsToken || null;
    if (req.body.dataWindow !== undefined) user.dataWindow = req.body.dataWindow;

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
app.get('/api/admin/tokens', requireLogin, requireAdmin, async (req, res) => {
    try {
        const tokens = await loadTokens();
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/media-devices', requireLogin, requireAdmin, async (req, res) => {
    try {
        const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => []);
        const deviceIds = entries.filter(e => e.isDirectory()).map(e => e.name);
        res.json(deviceIds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/tokens', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        
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

app.delete('/api/admin/tokens/:token', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { token } = req.params;
        const tokens = await loadTokens();
        if (!tokens[token]) return res.status(404).json({ error: 'Token not found' });
        delete tokens[token];
        await saveTokens(tokens);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================
// SHARE LINK MANAGEMENT
// =====================

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

// Receive GPS data from Overlander app
app.post('/api/gps', validateToken, async (req, res) => {
    try {
        // Extract deviceId — priority:
        // 1. query param (explicit override)
        // 2. OwnTracks topic third segment (owntracks/<user>/<device>)
        // 3. Overland/Overlander top-level device_id field
        // 4. First location's properties.device_id
        // 5. body.deviceId / header
        // 6. fallback
        let deviceId = req.query.deviceId;

        if (!deviceId && req.body?.topic) {
            const parts = req.body.topic.split('/');
            if (parts.length >= 3) deviceId = parts[2];
        }
        if (!deviceId) deviceId = req.body?.device_id;
        if (!deviceId && req.body?.locations?.[0]?.properties?.device_id) {
            deviceId = req.body.locations[0].properties.device_id;
        }
        // Overlander {current: GeoJSON} format
        if (!deviceId && req.body?.current?.properties?.device_id) {
            deviceId = req.body.current.properties.device_id;
        }
        if (!deviceId) deviceId = req.body?.deviceId || req.headers['device-id'] || 'default-device';
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
        
        let filtered = routes.filter(r => r !== null);

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

        res.json({ deviceId, routes: filtered });
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
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
        const routeFile = path.join(DATA_DIR, 'routes', `${req.params.routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        route.name = name.trim();
        await saveRoute(route);
        res.json({ success: true, name: route.name });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
    }
});

// Delete a route
app.delete('/api/routes/:routeId', requireLogin, requireAdmin, async (req, res) => {
    try {
        const routeId = req.params.routeId;
        const routeFile = path.join(DATA_DIR, 'routes', `${routeId}.json`);
        const route = JSON.parse(await fs.readFile(routeFile, 'utf8'));
        const deviceId = route.deviceId;

        // Remove route file
        await fs.unlink(routeFile);

        // Remove from device's route list and clear currentRoute if needed
        const deviceData = await getDeviceData(deviceId);
        deviceData.routes = deviceData.routes.filter(id => id !== routeId);
        if (deviceData.currentRoute === routeId) deviceData.currentRoute = null;
        await saveDeviceData(deviceId, deviceData);

        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'Route not found' });
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
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword) throw new Error('ADMIN_PASSWORD environment variable is not set');
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
    app.get('/api/media/:deviceId', requireLogin, async (req, res) => {
        try {
            const entries = await loadMedia(req.params.deviceId);
            res.json(entries);
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
            const { description = '', lat, lng, timestamp } = req.body;

            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            // Extract EXIF GPS via sharp metadata
            const metadata = await sharp(req.file.buffer).metadata();
            let photoLat = parseFloat(lat);
            let photoLng = parseFloat(lng);
            let photoTime = timestamp || new Date().toISOString();

            // Try EXIF if no coords provided
            if ((!photoLat || !photoLng) && metadata.exif) {
                try {
                    // Parse EXIF manually — sharp exposes raw exif buffer
                    const exifData = parseExifGPS(metadata.exif);
                    if (exifData) {
                        photoLat = exifData.lat;
                        photoLng = exifData.lng;
                        if (exifData.timestamp) photoTime = exifData.timestamp;
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
                createdAt: new Date().toISOString()
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
            const { url, description = '', lat, lng } = req.body;

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
                createdAt: new Date().toISOString()
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
            const { description } = req.body;
            const entries = await loadMedia(deviceId);
            const entry = entries.find(e => e.id === id);
            if (!entry) return res.status(404).json({ error: 'Not found' });
            entry.description = description !== undefined ? description : entry.description;
            await saveMedia(deviceId, entries);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Helper: parse raw EXIF buffer for GPS (IFD GPS tags)
    function parseExifGPS(exifBuffer) {
        try {
            // Look for GPS IFD markers in raw EXIF — simple implementation
            // GPS Latitude: tag 0x0002, Longitude: 0x0004
            const buf = Buffer.isBuffer(exifBuffer) ? exifBuffer : Buffer.from(exifBuffer);

            // Find Exif header
            const exifHeader = buf.indexOf('Exif\0\0');
            if (exifHeader === -1) return null;
            const tiffStart = exifHeader + 6;

            // Determine byte order
            const byteOrder = buf.readUInt16BE(tiffStart);
            const littleEndian = byteOrder === 0x4949;
            const readUInt16 = (offset) => littleEndian ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
            const readUInt32 = (offset) => littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);

            // IFD0 offset
            const ifd0Offset = tiffStart + readUInt32(tiffStart + 4);
            const ifd0Count = readUInt16(ifd0Offset);

            let gpsIFDOffset = null;
            for (let i = 0; i < ifd0Count; i++) {
                const entry = ifd0Offset + 2 + i * 12;
                const tag = readUInt16(entry);
                if (tag === 0x8825) { // GPS IFD pointer
                    gpsIFDOffset = tiffStart + readUInt32(entry + 8);
                    break;
                }
            }
            if (!gpsIFDOffset) return null;

            const gpsCount = readUInt16(gpsIFDOffset);
            const gpsData = {};
            for (let i = 0; i < gpsCount; i++) {
                const entry = gpsIFDOffset + 2 + i * 12;
                const tag = readUInt16(entry);
                gpsData[tag] = { entry, type: readUInt16(entry + 2), count: readUInt32(entry + 4), valueOffset: entry + 8 };
            }

            // Tag 1=LatRef, 2=Lat, 3=LonRef, 4=Lon
            if (!gpsData[2] || !gpsData[4]) return null;

            const readRational = (offset) => {
                const num = readUInt32(tiffStart + offset);
                const den = readUInt32(tiffStart + offset + 4);
                return den === 0 ? 0 : num / den;
            };

            const latOffset = readUInt32(gpsData[2].valueOffset);
            const latDeg = readRational(latOffset);
            const latMin = readRational(latOffset + 8);
            const latSec = readRational(latOffset + 16);
            let lat = latDeg + latMin / 60 + latSec / 3600;

            const lonOffset = readUInt32(gpsData[4].valueOffset);
            const lonDeg = readRational(lonOffset);
            const lonMin = readRational(lonOffset + 8);
            const lonSec = readRational(lonOffset + 16);
            let lng = lonDeg + lonMin / 60 + lonSec / 3600;

            // Apply S/W negative
            if (gpsData[1]) {
                const latRef = buf.toString('ascii', tiffStart + readUInt32(gpsData[1].valueOffset), tiffStart + readUInt32(gpsData[1].valueOffset) + 1);
                if (latRef === 'S') lat = -lat;
            }
            if (gpsData[3]) {
                const lonRef = buf.toString('ascii', tiffStart + readUInt32(gpsData[3].valueOffset), tiffStart + readUInt32(gpsData[3].valueOffset) + 1);
                if (lonRef === 'W') lng = -lng;
            }

            return (lat !== 0 || lng !== 0) ? { lat, lng } : null;
        } catch { return null; }
    }

    // ─── END MEDIA ROUTES ─────────────────────────────────────────────────────

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Route Tracker GPS Receiver API running on port ${PORT}`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
        console.log(`GPS endpoint: http://localhost:${PORT}/api/gps`);
    });
};

startServer().catch(console.error);

module.exports = app;