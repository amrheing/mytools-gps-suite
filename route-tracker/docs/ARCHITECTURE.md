# Route Tracker - Architecture Documentation

## Table of Contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [File Structure](#file-structure)
- [Data Models](#data-models)
- [API Endpoints](#api-endpoints)
- [Frontend Architecture](#frontend-architecture)
- [Authentication System](#authentication-system)
- [Route Processing Pipeline](#route-processing-pipeline)
- [Enhanced Features](#enhanced-features)
- [Storage Architecture](#storage-architecture)
- [Development Workflow](#development-workflow)
- [Deployment Architecture](#deployment-architecture)

## Overview

Route Tracker is a comprehensive GPS route tracking application that provides real-time route recording, visualization, analysis, and management capabilities. The system architecture follows a client-server model with a Node.js backend and a vanilla JavaScript frontend, deployed via Docker containers.

**Core Purpose**: Enable users to record GPS routes via OwnTracks/Overlander integration, visualize them with smart analysis, and manage route data through an advanced editing interface.

**Key Capabilities**:
- Real-time GPS data ingestion from OwnTracks protocol
- Smart route analysis with road/off-road classification  
- Advanced route editing with point manipulation
- PassKey/WebAuthn biometric authentication
- Multiple export formats (GPX, KML, JSON, CSV)
- Route merging and point grouping functionality
- Admin features for user and route management

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ROUTE TRACKER SYSTEM                     │
├─────────────────────────────────────────────────────────────┤
│  Frontend (Vanilla JS)           Backend (Node.js/Express) │
│  ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│  │ Route Visualization        │ │ GPS Data Ingestion      │ │
│  │ - Leaflet.js mapping       │ │ - OwnTracks protocol    │ │
│  │ - Smart route display      │ │ - Real-time processing  │ │
│  │ - Point editing UI         │ │ - Route analysis        │ │
│  └─────────────────────────────┘ └─────────────────────────┘ │
│  ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│  │ User Interface             │ │ Authentication          │ │
│  │ - Route management         │ │ - WebAuthn/PassKeys     │ │
│  │ - Export functionality     │ │ - Session management    │ │
│  │ - Admin controls           │ │ - User management       │ │
│  └─────────────────────────────┘ └─────────────────────────┘ │
│  ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│  │ Edit Mode System           │ │ Data Storage            │ │
│  │ - Point selection          │ │ - File-based JSON      │ │
│  │ - Drag & drop             │ │ - Route files           │ │
│  │ - Point merging           │ │ - User data             │ │
│  │ - Context menus           │ │ - Session storage       │ │
│  └─────────────────────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                             │
├─────────────────────────────────────────────────────────────┤
│  OwnTracks App               Overlander App                 │
│  - iOS/Android GPS          - Professional GPS logging     │
│  - Real-time streaming      - High-accuracy positioning    │
│  - MQTT/HTTP protocols      - Route management            │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Backend Stack
- **Runtime**: Node.js 16+ with cluster support (4 workers max)
- **Framework**: Express.js for REST API and static file serving
- **Authentication**: @simplewebauthn/server v9 for PassKey/WebAuthn
- **Session Management**: express-session with file store persistence
- **Security**: bcrypt for password hashing, CORS protection
- **File Processing**: multer for uploads, sharp for image processing
- **Email**: nodemailer for notifications (admin features)

### Frontend Stack
- **Core**: Vanilla JavaScript ES6+ (no frameworks)
- **Mapping**: Leaflet.js with OpenStreetMap tiles
- **UI**: CSS3 with Grid/Flexbox, responsive design
- **Storage**: localStorage for client-side data persistence
- **PWA**: Service Worker support for offline functionality

### Infrastructure
- **Containerization**: Docker with multi-stage builds
- **Reverse Proxy**: nginx for static file serving
- **Networking**: Docker Compose with custom networks
- **Storage**: Volume mounts for persistent data
- **Deployment**: Docker Swarm ready with health checks

## File Structure

```
route-tracker/
├── server.js                 # Main backend entry point (cluster primary)
├── package.json              # Dependencies and scripts
├── Dockerfile               # Multi-stage container build
├── index.html              # Main application interface
├── script.js               # Frontend route tracker logic
├── admin.html              # Administrative interface
├── login.html              # Authentication interface
├── invite.html             # User invitation system
├── user-manager.js         # Client-side user management
├── export-manager.js       # Data export functionality
├── docs/                   # Documentation files
│   ├── admin-guide.en.md   # Administrative documentation
│   ├── user-guide.en.md    # User documentation
│   └── ...                 # Additional language versions
├── shared/                 # Shared CSS and assets
│   ├── styles.css          # Common styling
│   └── components/         # Reusable UI components
├── data/                   # Runtime data directory (mounted)
│   ├── users.json          # User account data
│   ├── devices/            # Device-specific data
│   │   └── {userId}.json   # Individual user route lists
│   ├── routes/             # Individual route files
│   │   └── {routeId}.json  # GPS track data with analysis
│   ├── sessions/           # Session storage
│   └── .session-secret     # Persistent session key
└── .github/               # GitHub Actions and templates
    └── github-instructions # Development guidelines
```

### Key File Responsibilities

**server.js** (2600+ lines):
- Cluster management and worker coordination
- Express.js application configuration
- Authentication endpoints (WebAuthn, traditional login)
- GPS data ingestion from OwnTracks protocol
- Route analysis and smart segmentation
- File-based data storage operations
- Admin APIs for user and route management

**script.js** (2500+ lines):
- RouteTracker class with comprehensive functionality
- Real-time GPS data visualization
- Interactive route editing with point manipulation
- Map controls and user interface management
- Export functionality for multiple formats
- Advanced features like point merging and route copying

**index.html**:
- Single-page application layout
- Responsive mobile-first design
- Modal dialogs for user interactions
- Toolbar and control integration

## Data Models

### User Model
```json
{
  "id": "unique-user-id",
  "email": "user@example.com",
  "passwordHash": "bcrypt-hash",
  "admin": false,
  "devices": ["device-1", "device-2"],
  "preferences": {
    "trackingInterval": 5,
    "exportFormat": "gpx",
    "mapCenter": [49.4875, 8.466]
  },
  "passkeys": [
    {
      "id": "credential-id",
      "publicKey": "public-key-data",
      "counter": 0,
      "credentialDeviceType": "singleDevice"
    }
  ],
  "createdAt": "2026-04-11T10:00:00.000Z",
  "lastLogin": "2026-04-11T10:00:00.000Z"
}
```

### Device Model
```json
{
  "routes": ["route-id-1", "route-id-2"],
  "currentRoute": "active-route-id",
  "stats": {
    "totalRoutes": 25,
    "totalDistance": 1234.5,
    "totalTime": 67890
  }
}
```

### Route Model
```json
{
  "id": "unique-route-id",
  "name": "Route Name",
  "deviceId": "device-identifier",
  "startTime": "2026-04-11T10:00:00.000Z",
  "endTime": "2026-04-11T12:30:00.000Z",
  "totalDistance": 25.7,
  "totalPoints": 1847,
  "status": "completed",
  "color": "#e74c3c",
  "points": [
    {
      "lat": 49.4875,
      "lng": 8.466,
      "alt": 150.5,
      "timestamp": "2026-04-11T10:00:00.000Z",
      "accuracy": 5.2,
      "speed": 12.5,
      "heading": 285,
      "_merged": false
    }
  ],
  "analysis": {
    "segments": [
      {
        "startIndex": 0,
        "endIndex": 100,
        "type": "road",
        "distance": 2.5,
        "avgSpeed": 45.2
      }
    ],
    "pausePoints": [
      {
        "lat": 49.4875,
        "lng": 8.466,
        "startTime": "2026-04-11T11:00:00.000Z",
        "endTime": "2026-04-11T11:15:00.000Z",
        "duration": 900
      }
    ],
    "roadPercentage": 75.2,
    "offroadPercentage": 24.8
  },
  "visualization": {
    "colors": {
      "road": "#2ecc71",
      "offroad": "#8b4513",
      "pause": "#f39c12"
    }
  }
}
```

### GPS Point Model
```json
{
  "lat": 49.4875,           // Latitude (required)
  "lng": 8.466,             // Longitude (required)  
  "alt": 150.5,             // Altitude in meters (optional)
  "timestamp": "ISO-8601",  // GPS timestamp (required)
  "accuracy": 5.2,          // Accuracy in meters (optional)
  "speed": 12.5,            // Speed in m/s (optional)
  "heading": 285,           // Heading in degrees (optional)
  "_merged": true,          // Merged point marker (internal)
  "_new": true,             // Newly added point (internal)
  "merged_from": 5,         // Number of points merged (internal)
  "merge_timestamp": "ISO"  // When merge occurred (internal)
}
```

## API Endpoints

### Authentication Endpoints

**POST /api/auth/register-begin**
- Initiates WebAuthn registration
- Returns challenge and options for credential creation
- Input: `{ email, username }`
- Output: WebAuthn registration options

**POST /api/auth/register-finish**  
- Completes WebAuthn registration
- Verifies credential and creates user account
- Input: WebAuthn credential response
- Output: Success/failure status

**POST /api/auth/login-begin**
- Initiates WebAuthn authentication
- Returns challenge for existing credentials
- Input: `{ email }`
- Output: WebAuthn authentication options

**POST /api/auth/login-finish**
- Completes WebAuthn authentication
- Verifies credential and establishes session
- Input: WebAuthn authentication response
- Output: User session data

**POST /api/auth/login** (Fallback)
- Traditional email/password authentication
- Input: `{ email, password }`
- Output: User session data

**POST /api/auth/logout**
- Destroys user session
- No input required
- Output: Success confirmation

### GPS Data Endpoints

**POST /api/gps**
- Primary GPS data ingestion endpoint
- Accepts OwnTracks protocol data
- Performs real-time route building and analysis
- Input: OwnTracks GPS payload
- Output: Processing confirmation

**GET /api/devices/:deviceId/routes**
- Lists all routes for a device
- Returns route metadata with statistics
- Output: Array of route summaries

**GET /api/routes/:routeId**
- Retrieves complete route data
- Includes GPS points and analysis
- Output: Complete route object with points

**DELETE /api/routes/:routeId**
- Deletes a specific route
- Admin or owner access required
- Output: Deletion confirmation

### Route Management Endpoints

**POST /api/routes/:routeId/analysis**
- Triggers route analysis pipeline
- Performs road/off-road classification
- Generates pause point detection
- Output: Analysis results

**PUT /api/routes/:routeId**
- Updates route data (admin)
- Used for saving edited routes
- Input: Modified route object
- Output: Updated route data

**POST /api/routes/:routeId/copy**
- Creates a copy of existing route
- Used for debugging and testing
- Input: `{ name }` (optional)
- Output: New route data

**POST /api/devices/:deviceId/routes/merge**
- Merges multiple routes into one
- Input: `{ routeIds: [...] }`
- Output: Merged route data

### Export Endpoints

**GET /api/routes/:routeId/export?format=gpx**
- Exports route in specified format
- Formats: gpx, kml, json, csv
- Output: Formatted route data file

**GET /api/devices/:deviceId/export?format=gpx**
- Bulk export all device routes
- Same format options as single route
- Output: Zip archive or concatenated file

### Admin Endpoints

**GET /api/admin/routes**
- Lists all routes across all users (admin)
- Includes user association data
- Output: Complete route listing

**DELETE /api/admin/routes/cleanup**
- Removes orphaned route files (admin)
- Output: Cleanup statistics

**GET /api/admin/stats**
- System-wide statistics (admin)
- Route counts, storage usage, user metrics
- Output: Administrative dashboard data

## Frontend Architecture

### RouteTracker Class Structure

The main frontend logic is encapsulated in the `RouteTracker` class with these core responsibilities:

**Core Properties:**
```javascript
class RouteTracker {
  constructor() {
    this.map = null;                    // Leaflet map instance
    this.currentRoute = null;           // Active polyline layer
    this.routeLayers = [];             // Route segment layers
    this.dataPointsLayerGroup = null;  // GPS point markers
    this.editMarkersGroup = null;      // Edit mode markers
    
    // State management
    this.currentRouteData = null;      // Loaded route data
    this.currentRouteId = null;        // Active route identifier
    this.editMode = false;             // Edit mode status
    this.mergeMode = false;           // Point merge mode status
    this.selectedPoints = new Set();  // Selected point indices
    
    // UI elements
    this.showDataPoints = false;       // Point visibility toggle
    this.showPausePoints = true;       // Pause point visibility
  }
}
```

**Core Methods:**

**Route Display & Visualization:**
- `displayRoute(routeData)` - Main route rendering with smart analysis
- `displaySmartRoute(routeData)` - Enhanced route with road/off-road segments  
- `displaySimpleRoute(routeData)` - Fallback basic route display
- `buildRouteDataPoints(routeData)` - GPS point marker generation
- `simplifyPointsForDisplay(points)` - Performance optimization for large routes

**Route Analysis & Processing:**
- `triggerRouteAnalysis()` - Initiates server-side route analysis
- `drawPausePoints(pausePoints)` - Visualizes pause locations
- `calculateDistance(lat1, lng1, lat2, lng2)` - Haversine distance calculation

**Edit Mode System:**
- `toggleEditMode()` - Enters/exits point editing mode
- `enterEditMode()` - Configures edit interface and controls
- `exitEditMode()` - Restores normal view mode
- `updateEditMarkers()` - Refreshes edit point display
- `makeMarkerDraggable(marker, index)` - Implements point dragging

**Point Merging System:**
- `toggleMergeMode()` - Enables rectangular point selection
- `enterMergeMode()` - Sets up selection interface
- `executePointMerge()` - Combines selected points
- `mergeSelectedPoints(points)` - Core merging algorithm
- `startRectangleSelection()` - Drag selection handling

**User Interaction:**
- `addPointAfter(index)` - Adds new point after existing one
- `deletePoint(index)` - Removes point with validation
- `setupEditModeKeyListeners()` - Alt+drag map control
- `preventMapDrag(event)` - Selective map interaction control

**Data Management:**
- `loadRouteHistory()` - Fetches user route list
- `loadRoute(routeId)` - Retrieves specific route data
- `saveRouteEdits()` - Persists edit mode changes
- `copyRoute(routeId)` - Creates route copy for testing

### UI State Management

**Edit Mode Controls:**
- Map interactions are selectively disabled to prevent accidental panning
- Alt+drag enables map movement while editing points
- Point selection via rectangular drag or Alt+click individual points
- Context-sensitive notifications guide user actions

**Visual Feedback:**
- Route segments colored by type (green=road, brown=off-road)
- Merged points displayed in orange with special styling
- Selected points highlighted in red during merge operations
- Progressive disclosure of advanced features based on user actions

### Performance Optimizations

**Point Simplification:**
- Routes with >200 points are simplified for display performance
- Merged points are always preserved during simplification
- Distance-based filtering maintains route accuracy while improving rendering

**Lazy Loading:**
- Route analysis triggered automatically for substantial routes (>100 points)
- Analysis results cached to avoid recomputation
- Map tile caching for offline viewing

## Authentication System

### WebAuthn/PassKey Integration

The application implements modern biometric authentication using WebAuthn standard with PassKey support:

**Registration Flow:**
1. User provides email/username
2. Server generates challenge with @simplewebauthn/server
3. Browser prompts for biometric/security key
4. Credential verification and account creation
5. Session establishment

**Authentication Flow:**
1. User enters email
2. Server looks up existing credentials
3. Challenge generation for known credentials
4. Biometric verification
5. Session creation with 24-hour timeout

**Legacy Support:**
- Traditional email/password authentication available as fallback
- bcrypt password hashing with 12 rounds
- Gradual migration path to PassKey authentication

**Session Management:**
- File-based session storage for container persistence
- Session secrets persisted across container restarts
- Automatic session cleanup with TTL expiration

## Route Processing Pipeline

### GPS Data Ingestion

**OwnTracks Protocol Support:**
- Real-time GPS data reception via HTTP POST
- JSON payload parsing and validation
- Automatic route building and continuation logic
- Device identification and user association

**Data Processing:**
```javascript
// Incoming GPS point processing
const processGPSPoint = (data) => {
  // Extract coordinates and metadata
  const point = {
    lat: parseFloat(data.lat),
    lng: parseFloat(data.lon), 
    alt: data.alt || null,
    timestamp: new Date(data.tst * 1000).toISOString(),
    accuracy: data.acc || null,
    speed: data.vel || null,
    heading: data.cog || null
  };
  
  // Route building logic
  if (isNewRoute(data)) {
    createNewRoute(point);
  } else {
    appendToCurrentRoute(point);
  }
  
  // Trigger analysis for substantial routes
  if (routePointCount > 100) {
    scheduleAnalysis();
  }
};
```

### Smart Route Analysis

**Segment Classification Algorithm:**
- Speed-based road vs off-road determination
- Pause point detection using time gaps
- Movement pattern analysis for activity classification
- Statistical aggregation for route summaries

**Analysis Pipeline:**
1. **Speed Analysis**: Classify segments based on velocity patterns
2. **Pause Detection**: Identify stops using time/distance thresholds  
3. **Road Classification**: Determine road vs off-road segments
4. **Visualization Preparation**: Generate color-coded route data
5. **Statistics Calculation**: Distance, time, elevation, speed metrics

**Pause Point Algorithm:**
```javascript
const detectPausePoints = (points) => {
  const pausePoints = [];
  let pauseStart = null;
  
  for (let i = 1; i < points.length; i++) {
    const timeDiff = new Date(points[i].timestamp) - new Date(points[i-1].timestamp);
    const distance = calculateDistance(points[i-1], points[i]);
    
    if (timeDiff > PAUSE_TIME_THRESHOLD && distance < PAUSE_DISTANCE_THRESHOLD) {
      if (!pauseStart) pauseStart = i-1;
    } else if (pauseStart !== null) {
      pausePoints.push(createPausePoint(pauseStart, i-1));
      pauseStart = null;
    }
  }
  
  return pausePoints;
};
```

## Enhanced Features

### Advanced Point Editing

**Point Merging System:**
- Rectangle selection for multiple point selection
- Alt+click for individual point selection
- Geometric center calculation for merged points
- Metadata preservation from representative points
- Visual distinction for merged points

**Edit Mode Features:**
- Fixed map interaction (Alt+drag only for map movement)
- Direct point dragging with real-time route updates
- Point addition/deletion with route integrity validation
- Undo/redo capability for edit operations

### Route Copy & Debug Features

**Route Duplication:**
- Complete route copying with new unique IDs
- Metadata preservation and customizable naming
- Debug-friendly functionality for testing route operations
- Proper route list integration

### Export System Enhancements

**Multi-Format Export:**
- GPX: Full GPS track with waypoints and metadata
- KML: Google Earth compatible with visual styling
- JSON: Complete route data with analysis results
- CSV: Point-by-point data for spreadsheet analysis

**Bulk Export Capabilities:**
- Device-level export for all user routes
- Zip archive generation for large datasets
- Format-specific optimizations

### Performance Optimizations

**Point Simplification:**
- Distance-based point reduction for large routes
- Merged point preservation during simplification
- Configurable simplification parameters
- Performance monitoring and adaptive limits

**Memory Management:**
- Route data lazy loading
- Map layer cleanup and optimization
- Browser storage management
- Large route handling strategies

## Storage Architecture

### File-Based Data Storage

**Directory Structure:**
```
/app/data/
├── users.json              # User accounts and credentials
├── invite-tokens.json       # Invitation system tokens
├── .session-secret         # Persistent session key
├── devices/                # Device-specific data
│   ├── user1-device1.json  # Route lists per device
│   └── user2-device1.json
├── routes/                 # Individual route files
│   ├── route-001.json      # Complete GPS track data
│   ├── route-002.json
│   └── ...
├── sessions/              # Session storage
│   ├── session-001.json
│   └── ...
└── media/                 # Uploaded media files
    ├── photos/
    └── documents/
```

**Data Persistence Strategy:**
- JSON file format for human readability and debugging
- Atomic file operations to prevent corruption
- Regular backup and cleanup procedures
- Volume mounting for container persistence

**Scalability Considerations:**
- File-based storage suitable for moderate usage
- Database migration path planned for high-volume deployments
- Efficient file naming and organization for quick access
- Index files for improved query performance

### Storage Optimization

**Route Data Compression:**
- Coordinate precision optimization (7 decimal places)
- Metadata minimization for storage efficiency
- Optional data compression for large routes
- Archive strategies for old routes

**Cleanup Procedures:**
- Orphaned file detection and removal
- Session cleanup with TTL expiration
- Route consolidation and archival
- Storage space monitoring and alerts

## Development Workflow

### Local Development Setup

**Prerequisites:**
- Node.js 16+
- Docker and Docker Compose
- Git for version control

**Development Commands:**
```bash
# Clone and setup
git clone [repository]
cd route-tracker

# Install dependencies
npm install

# Development mode with auto-restart
npm run dev

# Production build
docker build -t route-tracker .

# Run with docker-compose
docker-compose up -d
```

**Development Environment:**
- Hot reload with nodemon for backend changes
- Live reload for frontend development
- Volume mounting for rapid iteration
- Separate development and production configurations

### Code Organization Standards

**Backend Structure:**
- Modular route handlers grouped by functionality
- Utility functions for common operations
- Error handling with appropriate HTTP status codes
- Logging and monitoring integration

**Frontend Structure:**
- Class-based architecture for maintainability
- Event-driven programming model
- Separation of concerns between UI and data
- Progressive enhancement for feature additions

### Testing Strategy

**Unit Testing:**
- Core algorithm testing (distance calculations, analysis)
- Data processing pipeline validation
- Authentication flow verification
- Export format validation

**Integration Testing:**
- API endpoint testing
- User workflow testing
- Cross-browser compatibility
- Mobile device testing

**Performance Testing:**
- Large route handling (1000+ points)
- Concurrent user simulation
- Memory usage profiling
- Database operation benchmarking

### Deployment Pipeline

**Container Build Process:**
```dockerfile
# Multi-stage build for optimization
FROM node:16-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM nginx:alpine
COPY --from=builder /app /app
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Production Configuration:**
- nginx reverse proxy for static file serving
- Process clustering for improved performance
- Health check endpoints for monitoring
- Graceful shutdown handling

**Monitoring and Alerting:**
- Application performance monitoring
- Error tracking and notification
- Storage usage monitoring
- User activity analytics

## Deployment Architecture

### Docker Configuration

**Multi-Service Setup:**
```yaml
version: '3.8'
services:
  route-tracker:
    build: ./route-tracker
    container_name: route-tracker
    ports:
      - "6050:3000"
    volumes:
      - ./route-tracker/data:/app/data
      - ./shared:/app/shared
    environment:
      - NODE_ENV=production
      - ORIGIN=https://tools.amrhein.info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Container Orchestration:**
- Docker Compose for local development
- Docker Swarm ready for production scaling
- Health checks for automatic recovery
- Volume mounting for data persistence

### Security Configuration

**Access Control:**
- Admin-only endpoints protected by middleware
- User session validation for all authenticated routes
- CORS configuration for cross-origin requests
- Rate limiting for API endpoints

**Data Protection:**
- Password hashing with bcrypt
- Session secret persistence across restarts
- Secure cookie configuration
- Input validation and sanitization

---

This architecture documentation provides a comprehensive overview of the Route Tracker system. For specific implementation details, refer to the source code files and additional documentation in the `/docs` directory.

**Last Updated**: April 11, 2026  
**Version**: 2.0 (Enhanced with point editing and analysis features)  
**Author**: Gerald Amrhein

---

## CI/CD Pipeline Architecture

### Overview
The myTools project uses GitHub Actions for continuous integration and deployment, providing automated testing, building, and deployment across all components.

**Pipeline Configuration**: `.github/workflows/ci-cd.yml`
**Trigger Events**: push to main/develop, pull requests, releases

### Pipeline Structure

#### Test Job
- **Platform**: ubuntu-latest
- **Python Testing**: extract-gpx-parts with pytest and coverage
- **Node.js Testing**: Route Tracker health endpoint validation
- **Coverage**: Automatic upload to Codecov

#### Docker Build Job
- **Conditional Execution**: Only runs with Docker Hub credentials
- **Multi-Platform**: Buildx for cross-platform compatibility
- **Registry Support**: Docker Hub with GitHub Container Registry fallback
- **Optimization**: Layer caching for faster builds

### Component Testing Strategy

#### Route Tracker Testing
```bash
# Isolated environment setup
mkdir -p /tmp/route-tracker-data/{routes,devices,sessions}
DATA_DIR=/tmp/route-tracker-data PORT=3000 node server.js &

# Health check with retry logic
for i in $(seq 1 15); do
  curl -sf http://localhost:3000/api/health && break
  sleep 2
done

# API validation
curl -f http://localhost:3000/api/routes
```

#### Extract GPX Parts Testing
```bash
# Comprehensive test suite
cd extract-gpx-parts
python -m pytest --cov=. --cov-report=xml

# Coverage reporting
codecov-action@v3 with coverage.xml
```

### Configuration Management

#### Required Secrets (Optional)
- `DOCKERHUB_USERNAME`: Docker Hub account username
- `DOCKERHUB_TOKEN`: Docker Hub access token with push permissions

#### Conditional Logic
```yaml
# Only build/push with credentials
if: ${{ secrets.DOCKERHUB_USERNAME && secrets.DOCKERHUB_TOKEN }}
```

### Health Monitoring

Each component provides health endpoints for monitoring:

- **Route Tracker**: `GET /api/health`
  ```json
  {"status": "healthy", "timestamp": "2024-01-02T15:30:00Z"}
  ```

- **Extract GPX Parts**: Flask application health in web interface
- **Google GPX Converter**: Static files, no health endpoint needed

### Security Best Practices

1. **Secret Management**: All credentials stored as GitHub secrets
2. **Conditional Building**: No hardcoded usernames or tokens
3. **Isolated Testing**: Temporary data directories for tests
4. **Graceful Degradation**: Pipeline succeeds without Docker credentials

### Deployment Workflow

1. **Development**: Commits to develop branch trigger testing only
2. **Integration**: Pull requests to main trigger full build and test
3. **Production**: Tagged releases trigger production deployment
4. **Monitoring**: Health checks validate successful deployments

### Troubleshooting

**Common Issues**:
- Missing Docker credentials: Pipeline runs tests but skips Docker builds
- Health check failures: Server startup timeout or port conflicts
- Test failures: Missing dependencies or environment configuration

**Resolution Steps**:
1. Check GitHub Actions logs for specific error messages
2. Validate health endpoint responses manually
3. Ensure all required dependencies are installed
4. Verify Docker Hub credentials are properly configured