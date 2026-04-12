# Route Tracker - Developer Guide

## Table of Contents
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Key Components](#key-components)
- [Development Workflow](#development-workflow)
- [Feature Implementation](#feature-implementation)
- [Debugging Guide](#debugging-guide)
- [Testing Strategy](#testing-strategy)
- [Production Deployment](#production-deployment)

## Quick Start

### Development Environment Setup
```bash
# 1. Navigate to project directory
cd /opt/containerd/myTools/route-tracker

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Or run in Docker for full-stack testing
docker-compose up -d
docker logs -f route-tracker

# 5. Access application
# Local: http://localhost:3000
# Docker: http://localhost:6050
```

### Key Configuration Files
- `package.json` - Dependencies and scripts
- `server.js` - Main backend application (2600+ lines)
- `script.js` - Frontend RouteTracker class (2500+ lines)  
- `index.html` - Main application interface
- `Dockerfile` - Container build configuration
- `docker-compose.yml` - Multi-service orchestration

## Architecture Overview

### System Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend      │    │   Data Layer    │
│   (script.js)   │◄──►│   (server.js)   │◄──►│  (JSON Files)   │
│                 │    │                 │    │                 │
│ - RouteTracker  │    │ - Express.js    │    │ - users.json    │
│ - Leaflet.js    │    │ - WebAuthn      │    │ - routes/*.json │
│ - Edit System   │    │ - GPS Handler   │    │ - devices/*.json│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   User Input    │    │   API Layer     │    │   File System   │
│ - Touch/Mouse   │    │ - REST Routes   │    │ - Atomic Ops    │
│ - Keyboard      │    │ - Auth Middleware│    │ - Backup/Sync   │
│ - Biometrics    │    │ - Data Validation│    │ - Cleanup       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Flow Architecture
```
GPS Data → OwnTracks → HTTP POST → server.js → Route Building → Analysis → Storage
    ↓
Frontend ← WebSocket/Poll ← Route Data ← File System ← JSON Storage
    ↓
User Interaction → Edit Mode → Point Manipulation → Save API → Update Storage
```

## Key Components

### Backend Core (server.js)

**Main Sections:**
- **Lines 1-100**: Cluster setup, dependencies, middleware configuration
- **Lines 100-300**: Authentication system (WebAuthn + traditional)
- **Lines 300-600**: User management and session handling
- **Lines 600-1200**: GPS data ingestion and route building
- **Lines 1200-1600**: Route analysis and smart segmentation
- **Lines 1600-2000**: Export functionality and format conversion
- **Lines 2000-2400**: Route management (copy, merge, delete)
- **Lines 2400-2600**: Admin APIs and system management

**Critical Functions:**
```javascript
// GPS data processing entry point
app.post('/api/gps', async (req, res) => {
  // OwnTracks protocol handling
  // Route building logic
  // Real-time analysis triggering
});

// Route analysis pipeline
async function analyzeRoute(routeData) {
  // Speed-based segment classification
  // Pause point detection
  // Statistical calculations
  // Visualization data generation
}

// WebAuthn authentication
app.post('/api/auth/login-begin', async (req, res) => {
  // Challenge generation
  // Credential lookup
  // Options preparation
});
```

### Frontend Core (script.js)

**RouteTracker Class Structure:**
```javascript
class RouteTracker {
  // Core properties
  constructor() {
    this.map = null;              // Leaflet map instance
    this.currentRouteData = null; // Active route data
    this.editMode = false;        // Edit state flag
    this.mergeMode = false;       // Point merge state
    this.selectedPoints = new Set(); // Selected point indices
  }
  
  // Main route display entry point
  displayRoute(routeData) {
    // Smart vs simple route rendering
    // Analysis data integration
    // Performance optimization
  }
  
  // Edit mode system
  toggleEditMode() {
    // UI state management
    // Map interaction control
    // Tool activation
  }
  
  // Point merging system
  executePointMerge() {
    // Multi-point selection processing
    // Geometric calculations
    // Data structure updates
  }
}
```

**Key Method Categories:**
- **Lines 1-300**: Initialization, map setup, data loading
- **Lines 300-600**: Route display and visualization
- **Lines 600-900**: Edit mode and point manipulation
- **Lines 900-1200**: Point merging and selection system
- **Lines 1200-1500**: User interface and event handling
- **Lines 1500-1800**: Data export and management
- **Lines 1800-2100**: Advanced features (copy, analysis)
- **Lines 2100-2400**: Utility functions and helpers

### Authentication System

**WebAuthn Implementation:**
```javascript
// Registration flow
const registerUser = async (email, username) => {
  // 1. Generate challenge
  const options = await generateRegistrationOptions({
    rpName: 'Route Tracker',
    rpID: 'tools.amrhein.info',
    userID: crypto.randomBytes(32),
    userName: email,
    userDisplayName: username
  });
  
  // 2. Browser credential creation
  const credential = await navigator.credentials.create({
    publicKey: options
  });
  
  // 3. Server verification
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: origin
  });
};
```

**Session Management:**
- File-based session storage for container persistence
- 24-hour session timeout with renewal capability
- Session secret persistence across container restarts
- Graceful fallback for legacy authentication

## Development Workflow

### Making Changes

**Backend Changes (server.js):**
```bash
# 1. Edit server.js
# 2. Test with nodemon (auto-restart)
npm run dev

# 3. Or manually restart in Docker
docker restart route-tracker

# 4. Monitor logs
docker logs -f route-tracker

# 5. Test API endpoints
curl http://localhost:6050/api/routes
```

**Frontend Changes (script.js, index.html):**
```bash
# 1. Edit frontend files
# 2. Refresh browser (no build step required)
# 3. Check browser console for errors
# 4. Test functionality thoroughly

# For CSS changes:
# Edit shared/styles.css for global styles
# Edit inline styles in HTML for component-specific styles
```

**Hot Development Tips:**
- Use browser dev tools for frontend debugging
- Check both browser console and server logs
- Test edit mode features in admin account
- Validate GPS data flow with OwnTracks simulator

### Adding New Features

**New API Endpoint:**
```javascript
// 1. Add to server.js in appropriate section
app.post('/api/new-feature', requireLogin, async (req, res) => {
  try {
    // 2. Input validation
    const { param1, param2 } = req.body;
    if (!param1 || !param2) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    
    // 3. Business logic
    const result = await processFeature(param1, param2);
    
    // 4. Response with appropriate status
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Feature error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**New Frontend Feature:**
```javascript
// 1. Add method to RouteTracker class
class RouteTracker {
  newFeature() {
    // 2. Update UI state
    this.featureActive = true;
    
    // 3. Add event listeners
    this.map.on('click', this.handleFeatureClick.bind(this));
    
    // 4. Provide user feedback
    this.showNotification('Feature activated', 'info');
  }
  
  handleFeatureClick(event) {
    // 5. Feature-specific logic
    const result = this.processClick(event.latlng);
    
    // 6. Update display
    this.updateUI(result);
  }
}

// 7. Add UI controls in index.html
<button onclick="routeTracker.newFeature()">New Feature</button>
```

### Common Development Patterns

**Error Handling:**
```javascript
// Backend
try {
  const result = await riskyOperation();
  res.json({ success: true, data: result });
} catch (error) {
  console.error('Operation failed:', error);
  res.status(500).json({ error: 'Operation failed' });
}

// Frontend
try {
  const response = await fetch('/api/endpoint');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  this.handleSuccess(data);
} catch (error) {
  this.showNotification(error.message, 'error');
}
```

**Data Updates:**
```javascript
// Always update both data and display
updateRouteData(newData) {
  // 1. Update internal state
  this.currentRouteData = newData;
  
  // 2. Refresh display
  this.updateEditMarkers();
  this.redrawMergedEditPolyline();
  
  // 3. Notify user
  this.showNotification('Route updated', 'success');
}
```

## Feature Implementation

### Edit Mode System

**Key Implementation Details:**
- Edit mode toggles map interactions (Alt+drag only)
- Point dragging implemented with custom event handlers
- Context menus use click-to-popup instead of right-click
- All changes are validated before applying
- Save/discard functionality preserves user choice

**Adding New Edit Operations:**
```javascript
// 1. Add method to RouteTracker class
newEditOperation() {
  // 2. Validate edit mode is active
  if (!this.editMode) {
    this.showNotification('Enter edit mode first', 'warning');
    return;
  }
  
  // 3. Perform operation
  const result = this.performOperation();
  
  // 4. Update markers and polyline
  this.updateEditMarkers();
  this.redrawMergedEditPolyline();
  
  // 5. Provide feedback
  this.showNotification('Operation completed', 'success');
}
```

### Point Merging System

**Core Algorithm:**
```javascript
mergeSelectedPoints(pointsToMerge) {
  // 1. Calculate geometric center
  const avgLat = pointsToMerge.reduce((sum, p) => sum + p.point.lat, 0) / pointsToMerge.length;
  const avgLng = pointsToMerge.reduce((sum, p) => sum + p.point.lng, 0) / pointsToMerge.length;
  
  // 2. Create representative point
  const mergedPoint = {
    ...baseMetadata,
    lat: avgLat,
    lng: avgLng,
    _merged: true,
    merged_from: pointsToMerge.length,
    merge_timestamp: new Date().toISOString()
  };
  
  // 3. Remove original points (reverse order for index stability)
  const indices = pointsToMerge.map(p => p.index).sort((a, b) => b - a);
  indices.forEach(index => this.currentRouteData.points.splice(index, 1));
  
  // 4. Insert merged point at optimal position
  const insertIndex = indices[indices.length - 1];
  this.currentRouteData.points.splice(insertIndex, 0, mergedPoint);
  
  return insertIndex;
}
```

### Route Analysis Pipeline

**Analysis Trigger Points:**
- Automatic for routes >100 points on first display
- Manual via "Re-analyze Route" button
- After significant edit operations
- During route import/creation

**Analysis Implementation:**
```javascript
// Server-side analysis
const analyzeRoute = async (route) => {
  const segments = [];
  const pausePoints = [];
  
  // Speed-based classification
  for (let i = 1; i < route.points.length; i++) {
    const speed = calculateSpeed(route.points[i-1], route.points[i]);
    const segmentType = speed > ROAD_SPEED_THRESHOLD ? 'road' : 'offroad';
    
    // Segment building logic
    if (segments.length === 0 || segments[segments.length - 1].type !== segmentType) {
      segments.push(createNewSegment(i-1, segmentType));
    } else {
      extendLastSegment(segments, i);
    }
  }
  
  // Pause detection
  pausePoints = detectPausePoints(route.points);
  
  return {
    segments,
    pausePoints,
    roadPercentage: calculateRoadPercentage(segments),
    offroadPercentage: calculateOffroadPercentage(segments)
  };
};
```

## Debugging Guide

### Common Issues and Solutions

**Point Dragging Not Working:**
```javascript
// Check event handler attachment
console.log('Edit markers:', this.editMarkersGroup.getLayers().length);

// Verify drag implementation
this.editMarkersGroup.eachLayer(layer => {
  console.log('Layer events:', Object.keys(layer._events || {}));
});

// Test map interaction state
console.log('Map dragging enabled:', this.map.dragging.enabled());
```

**Route Analysis Failure:**
```javascript
// Check route data structure
console.log('Route points:', route.points?.length);
console.log('Point structure:', route.points?.[0]);

// Validate analysis triggers
console.log('Analysis conditions:', {
  hasPoints: route.points && route.points.length > 0,
  minPoints: route.points?.length > 100,
  noExistingAnalysis: !route.analysis
});
```

**Authentication Issues:**
```javascript
// Check WebAuthn support
console.log('WebAuthn support:', {
  available: !!navigator.credentials,
  publicKeySupported: !!window.PublicKeyCredential,
  userAgent: navigator.userAgent
});

// Debug session state
fetch('/api/auth/status')
  .then(res => res.json())
  .then(data => console.log('Auth status:', data));
```

### Logging and Monitoring

**Backend Logging:**
```javascript
// Add temporary debugging
console.log(`📍 Processing GPS point: ${data.lat}, ${data.lon}`);
console.log(`🔀 Route analysis: ${segments.length} segments, ${pausePoints.length} pauses`);
console.log(`👤 User action: ${req.session.userId} - ${req.method} ${req.path}`);
```

**Frontend Debugging:**
```javascript
// Enable detailed logging
window.routeTracker.debugMode = true;

// Monitor edit operations
window.addEventListener('editOperation', (event) => {
  console.log('Edit operation:', event.detail);
});

// Track performance
console.time('Route rendering');
this.displayRoute(routeData);
console.timeEnd('Route rendering');
```

### Browser Dev Tools

**Useful Console Commands:**
```javascript
// Inspect current route
window.routeTracker.currentRouteData

// Check edit mode state
window.routeTracker.editMode

// Examine map layers
window.routeTracker.map.eachLayer(layer => console.log(layer))

// Test API endpoints
fetch('/api/routes').then(r => r.json()).then(console.log)
```

## Testing Strategy

### Manual Testing Checklist

**Core Functionality:**
- [ ] GPS data reception and route building
- [ ] Route visualization with analysis
- [ ] User authentication (both WebAuthn and traditional)
- [ ] Route export in all formats
- [ ] Edit mode entry/exit
- [ ] Point dragging and manipulation
- [ ] Point merging with selection tools
- [ ] Route copy and management

**Edge Cases:**
- [ ] Large routes (1000+ points)
- [ ] Routes with no GPS accuracy data
- [ ] Rapid GPS updates
- [ ] Poor network conditions
- [ ] Browser compatibility (Chrome, Firefox, Safari)
- [ ] Mobile device testing (iOS, Android)

### Automated Testing

**API Testing:**
```bash
# Test GPS endpoint
curl -X POST http://localhost:6050/api/gps \
  -H "Content-Type: application/json" \
  -d '{"lat":49.4875,"lon":8.466,"tst":1713701234}'

# Test route retrieval
curl http://localhost:6050/api/routes/test-route-id

# Test authentication
curl -X POST http://localhost:6050/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

**Performance Testing:**
```javascript
// Large route simulation
const generateLargeRoute = (pointCount) => {
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({
      lat: 49.4875 + Math.random() * 0.1,
      lng: 8.466 + Math.random() * 0.1,
      timestamp: new Date(Date.now() + i * 5000).toISOString(),
      speed: Math.random() * 50
    });
  }
  return { points };
};

// Test rendering performance
console.time('Large route rendering');
window.routeTracker.displayRoute(generateLargeRoute(2000));
console.timeEnd('Large route rendering');
```

## Production Deployment

### Container Management

**Build and Deploy:**
```bash
# Build optimized container
docker build -t route-tracker:latest .

# Deploy with compose
docker-compose up -d route-tracker

# Check health and logs
docker ps | grep route-tracker
docker logs -f route-tracker

# Update deployment
docker-compose pull route-tracker
docker-compose up -d route-tracker
```

**Health Monitoring:**
```bash
# Health check endpoint
curl http://localhost:6050/health

# Monitor resource usage
docker stats route-tracker

# Check data directory
ls -la /opt/containerd/myTools/route-tracker/data/
```

### Backup and Maintenance

**Data Backup:**
```bash
# Backup data directory
tar -czf route-tracker-backup-$(date +%Y%m%d).tar.gz \
  /opt/containerd/myTools/route-tracker/data/

# Restore data
tar -xzf route-tracker-backup-20260411.tar.gz -C /

# Cleanup old routes (admin API)
curl -X DELETE http://localhost:6050/api/admin/routes/cleanup
```

**Performance Optimization:**
```bash
# Clean up old sessions
find /opt/containerd/myTools/route-tracker/data/sessions -mtime +7 -delete

# Optimize route files
node -e "
  const fs = require('fs');
  const path = require('path');
  // Route optimization script here
"

# Monitor storage usage
du -sh /opt/containerd/myTools/route-tracker/data/*
```

---

This developer guide provides comprehensive information for continuing development work on the Route Tracker system. For specific technical details, refer to the ARCHITECTURE.md file and source code comments.

**Last Updated**: April 11, 2026  
**Contributors**: Gerald Amrhein

---

## Working with CI/CD Pipeline

### Overview
The myTools project uses GitHub Actions for automated testing, building, and deployment. Understanding the pipeline helps ensure smooth development and deployment processes.

### Pipeline Configuration

**Location**: `.github/workflows/ci-cd.yml`
**Triggers**: push to main/develop branches, pull requests to main, releases

### Setting Up CI/CD

#### For Contributors (Testing Only)
No special setup required. The pipeline automatically:
1. Runs all tests when you push code
2. Validates Route Tracker health endpoints
3. Reports coverage to Codecov
4. Builds Docker images (but doesn't push without credentials)

#### For Maintainers (Full Pipeline)
Configure GitHub repository secrets:
1. Go to Settings → Secrets and variables → Actions
2. Add secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: Docker Hub access token

**Creating Docker Hub Token:**
```bash
# 1. Log in to Docker Hub
# 2. Go to Account Settings → Security
# 3. Click "New Access Token"
# 4. Set description: "GitHub Actions myTools"
# 5. Set permissions: Read, Write, Delete
# 6. Copy token (shown once only)
```

### Development Workflow with CI/CD

#### Feature Development
```bash
# 1. Create feature branch
git checkout -b feature/new-capability
git push origin feature/new-capability

# 2. Make changes and commit
git add .
git commit -m "Add new capability"
git push origin feature/new-capability

# 3. Create PR to main
# Pipeline automatically runs tests
# Review pipeline status in GitHub Actions tab
```

#### Pre-commit Testing
```bash
# Test locally before pushing
cd route-tracker
npm test

cd ../extract-gpx-parts
python -m pytest

# Check Route Tracker health locally
npm start &
curl http://localhost:3000/api/health
```

#### Monitoring Pipeline Status
1. **GitHub Actions Tab**: View all pipeline runs
2. **PR Status Checks**: See test results in pull requests
3. **Commit Status**: Green checkmark indicates successful pipeline

### Pipeline Jobs Explained

#### Test Job
**Purpose**: Validate code quality and functionality
**Components**:
- Python tests for extract-gpx-parts
- Node.js health checks for Route Tracker
- Coverage reporting

**Common Failures**:
- Python test failures: Check `pytest` output
- Health check timeout: Server startup issues
- Missing dependencies: Update requirements files

#### Docker Build Job
**Purpose**: Build and push container images
**Conditions**: Only runs with Docker Hub credentials
**Components**:
- Multi-platform builds (linux/amd64, linux/arm64)
- Layer caching for speed
- Automatic tagging (latest, branch names, SHA)

**Common Issues**:
- Build failures: Check Dockerfile syntax
- Push authentication: Verify Docker Hub credentials
- Size limits: Optimize image layers

### Troubleshooting CI/CD Issues

#### Test Failures
```bash
# Debug locally
cd extract-gpx-parts
python -m pytest -v

# Check specific test
python -m pytest tests/test_specific.py::test_function -v

# Route Tracker debugging
cd route-tracker
DEBUG=* npm start
```

#### Docker Build Failures
```bash
# Test build locally
docker build -t route-tracker-test .

# Check for common issues
docker run --rm route-tracker-test node --version
docker run --rm route-tracker-test npm list
```

#### Health Check Failures
```bash
# Manual health check
cd route-tracker
DATA_DIR=/tmp/test-data node server.js &
sleep 5
curl -v http://localhost:3000/api/health

# Check logs
docker logs route-tracker
```

### Pipeline Optimization Tips

#### Faster Builds
- Use `.dockerignore` to exclude unnecessary files
- Leverage Docker layer caching
- Use multi-stage builds for smaller images

#### Reliable Tests
- Use isolated test environments
- Add retry logic for flaky tests
- Mock external dependencies

#### Security Best Practices
- Never commit secrets to code
- Use GitHub secrets for sensitive data
- Regularly rotate Docker Hub tokens
- Review security alerts in GitHub

### Manual Deployment Override

If CI/CD is unavailable, manual deployment:
```bash
# Build images locally
docker build -t your-username/route-tracker:latest ./route-tracker
docker build -t your-username/extract-gpx-parts:latest ./extract-gpx-parts
docker build -t your-username/google-gpx-converter:latest ./google-gpx-converter

# Push manually
docker push your-username/route-tracker:latest
docker push your-username/extract-gpx-parts:latest
docker push your-username/google-gpx-converter:latest

# Deploy to production
docker-compose pull
docker-compose up -d
```