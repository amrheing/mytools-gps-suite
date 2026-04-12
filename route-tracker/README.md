# Route Tracker

A comprehensive web application for real-time GPS route tracking, route history management, and data export. Built as part of the myTools suite by Gerald Amrhein.

![Route Tracker](https://img.shields.io/badge/Status-Active-green) ![Version](https://img.shields.io/badge/Version-1.0.0-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

## 🚀 Features

### Recent Enhancements (v2.0)
- **🎨 Smart Route Visualization** — Automatic analysis classifies route segments as road (green) vs off-road (brown) based on speed patterns
- **🔧 Advanced Route Editing** — Comprehensive point manipulation system with drag-and-drop, add/delete, and point merging
- **🔐 PassKey Authentication** — Modern biometric authentication using WebAuthn standard for password-free secure login  
- **📍 Point Merging System** — Select multiple GPS points via rectangle selection or Alt+click and merge them into representative points
- **⚡ Performance Optimization** — Intelligent point simplification renders large routes (1000+ points) smoothly while preserving important features
- **🎯 Precision Controls** — Alt+drag for map movement during editing, fixed background prevents accidental map shifts
- **📊 Route Analysis** — Automatic pause point detection, road/off-road classification, and statistical analysis
- **📋 Route Management** — Copy routes for testing, bulk operations, and advanced admin features

### Core Tracking
- **Real-time GPS tracking** with high accuracy positioning
- **Customizable tracking intervals** (1s to 30s)
- **Pause/Resume functionality** for flexible route recording
- **Live route visualization** on interactive maps
- **Automatic distance and speed calculations**

### User Management
- **Secure user registration and authentication**
- **Personal route history** with user-specific data
- **Customizable preferences** for tracking settings
- **User statistics tracking** (total routes, distance, time)
- **GDPR-compliant data export and deletion**

### Data Export & Sharing
- **Multiple export formats**: GPX, KML, JSON, CSV
- **Bulk export capabilities** for multiple routes
- **Social sharing features** for route sharing
- **Downloadable route files** compatible with GPS devices
- **Route metadata** including timestamps, elevation, speed

### Mobile & Offline Support
- **Fully responsive design** optimized for mobile devices
- **Offline mode** with local data storage
- **Progressive Web App (PWA)** capabilities
- **Cross-platform compatibility** (iOS, Android, Desktop)
- **Background tracking support** when available

### Advanced Features
- **Interactive mapping** with OpenStreetMap integration
- **Route statistics** (distance, time, elevation, speed)
- **Waypoint management** with start/end markers
- **Real-time notifications** for tracking events
- **Route history viewer** with detailed analytics
- **Export format customization** for different use cases
- **GPS data point overlay** — toggle small dot markers per recorded point with per-point popups (speed, altitude, timestamp)
- **Advanced route editing** (admin) — comprehensive point manipulation system:
  - **Point dragging** — drag individual GPS points with visual feedback
  - **Point addition/deletion** — add points between existing ones or remove unwanted points
  - **Point merging system** — select multiple points via rectangle selection or Alt+click and merge them into single representative points
  - **Edit mode controls** — Alt+drag for map movement, fixed map background to prevent interference
  - **Route analysis integration** — automatic road/off-road classification with smart color coding
  - **Route copying** — duplicate routes for debugging and testing purposes
  - **Undo/save/discard** — full edit session management with change persistence

### Enhanced User Experience
- **Smart route visualization** — automatic analysis distinguishes road segments (green) from off-road sections (brown)
- **Pause point detection** — automatically identifies and visualizes route stops and breaks
- **Performance optimization** — intelligent point simplification for smooth rendering of large routes (1000+ points)
- **Biometric authentication** — PassKey/WebAuthn support for secure, password-free login
- **Touch-optimized interface** — responsive design optimized for mobile route editing
- **Real-time feedback** — live distance calculations and route statistics during editing

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3 (CSS Grid/Flexbox), Vanilla JavaScript (ES6+)
- **Mapping**: Leaflet.js with OpenStreetMap tiles
- **Backend**: Node.js 16+ with Express.js framework
- **Authentication**: @simplewebauthn/server v9 for PassKey/WebAuthn biometric authentication
- **Session Management**: express-session with file-based persistence
- **Security**: bcrypt password hashing, CORS protection, input validation
- **Storage**: File-based JSON storage with atomic operations
- **File Processing**: multer for uploads, sharp for image processing
- **Email**: nodemailer for admin notifications
- **Containerization**: Docker with multi-stage builds and nginx
- **Architecture**: Process clustering (4 workers) for performance
- **PWA**: Service Worker support for offline functionality

## 📱 Mobile Features

### GPS Integration
- High-accuracy positioning with configurable settings
- Battery optimization with intelligent tracking intervals
- Background location tracking when supported
- Speed and elevation monitoring

### Responsive Design
- Touch-optimized interface for mobile devices
- Adaptive layout for different screen sizes
- Swipe gestures for route navigation
- Mobile-first design approach

### Offline Capabilities
- Routes saved locally when offline
- Automatic sync when connection restored
- Cached map tiles for offline viewing
- Local storage for user preferences

## 🐳 Docker Deployment

### Quick Start
```bash
# Clone the repository (if part of myTools suite)
cd myTools/route-tracker

# Build the Docker image
docker build -t route-tracker .

# Run with shared styles volume
docker run -d \
  --name route-tracker \
  -p 6050:80 \
  -v $(pwd)/../shared:/usr/share/nginx/html/shared \
  route-tracker
```

### Docker Compose Integration
The application integrates with the myTools docker-compose.yml:

```yaml
route-tracker:
  build:
    context: ./route-tracker
  container_name: route-tracker
  ports:
    - "6050:80"
  restart: unless-stopped
  volumes:
    - ./shared:/usr/share/nginx/html/shared
  networks:
    - mytools-network
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.route-tracker.rule=Host(`route-tracker.local`)"
    - "traefik.http.services.route-tracker.loadbalancer.server.port=80"
```

## 🎯 Usage Guide

### Advanced Route Editing (Admin)
1. **Load any historical route** from the route history
2. **Click "Edit Points"** to enter advanced editing mode
3. **Drag individual points** to adjust GPS track accuracy
4. **Click points** to see popup with "Add After" and "Delete" options
5. **Use "Merge Points" mode** for combining clustered GPS points:
   - Draw rectangle around points to select multiple
   - Alt+click to select individual points
   - Click "Execute Merge" to combine into single representative point
6. **Navigate with Alt+drag** to move the map while editing
7. **Save changes** to persist edits or discard to revert

### Route Analysis & Visualization
- **Smart route display** automatically analyzes routes for road vs off-road classification
- **Pause points** are automatically detected and visualized
- **Performance optimization** handles routes with thousands of points smoothly
- **Toggle features** like data points and pause points for different views
- **Route statistics** provide detailed analytics on distance, time, elevation, and speed

### Authentication & Security
- **Modern PassKey login** using biometric authentication (fingerprint, Face ID, etc.)
- **Traditional email/password** available as fallback
- **Secure session management** with 24-hour sessions
- **Admin controls** for user and route management

### Getting Started
1. **Open the application** in your web browser
2. **Allow location access** when prompted
3. **Register an account** or use as guest
4. **Enter a route name** for your tracking session
5. **Click "Start Tracking"** to begin

### Tracking Routes
1. **Set tracking interval** based on your needs:
   - 1 second: High precision (battery intensive)
   - 5 seconds: Balanced (recommended)
   - 10-30 seconds: Battery saving
2. **Monitor real-time statistics** while tracking
3. **Use pause/resume** for breaks in your route
4. **Stop tracking** when finished

### Managing Routes
- **View route history** in the history section
- **Click routes** to view them on the map
- **Export routes** in your preferred format
- **Delete unwanted routes** to save storage

### Exporting Data
- **GPX**: For GPS devices and navigation apps
- **KML**: For Google Earth and mapping software
- **JSON**: For data analysis and backup
- **CSV**: For spreadsheet analysis

### User Account Benefits
- **Persistent route storage** across sessions
- **Customized preferences** and settings
- **Usage statistics** and analytics
- **Data backup** and export capabilities

## � Documentation

### Quick Reference
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Comprehensive system architecture and technical details
- **[DEVELOPER.md](DEVELOPER.md)** - Developer guide for contributing and extending functionality  
- **[CHANGELOG.md](CHANGELOG.md)** - Complete version history and feature evolution
- **[docs/user-guide.en.md](docs/user-guide.en.md)** - End-user documentation and tutorials
- **[docs/admin-guide.en.md](docs/admin-guide.en.md)** - Administrative features and management

### Development Resources
- **API Documentation** - See ARCHITECTURE.md for complete endpoint reference
- **Frontend Architecture** - RouteTracker class documentation in DEVELOPER.md
- **Deployment Guide** - Container and production setup in multiple guides
- **Feature Implementation** - Step-by-step development patterns and examples

### Quick Links
- 🏗️ **System Design** → [Architecture Overview](ARCHITECTURE.md#system-architecture)
- 🔧 **Development Setup** → [Developer Quick Start](DEVELOPER.md#quick-start)  
- 🎯 **Feature Guides** → [Implementation Patterns](DEVELOPER.md#feature-implementation)
- 🚀 **Recent Changes** → [Latest Enhancements](CHANGELOG.md#200---2026-04-11)
- 🐛 **Troubleshooting** → [Common Issues](DEVELOPER.md#debugging-guide)

## �🔧 Configuration

### Environment Variables
- `PORT`: Server port (default: 80)
- `MAX_ROUTES`: Maximum routes per user (default: 50)

### User Preferences
- **Tracking Interval**: GPS update frequency
- **Export Format**: Preferred export format
- **Map Center**: Default map location
- **Language**: Interface language (future feature)

## 🔒 Privacy & Security

### Data Protection
- **Local storage only**: No data sent to external servers
- **User control**: Full control over personal data
- **GDPR compliance**: Data export and deletion tools
- **Privacy by design**: Minimal data collection

### Security Features
- **Client-side authentication**: No server dependencies
- **Secure password hashing**: Protection for user accounts
- **Input validation**: Protection against malicious input
- **CORS protection**: Secure cross-origin requests

## 📊 Performance

### Optimization Features
- **Lazy loading**: Efficient resource loading
- **Gzip compression**: Reduced bandwidth usage
- **Caching strategies**: Fast repeat visits
- **Memory management**: Efficient GPS data handling

### Battery Optimization
- **Configurable intervals**: Balance accuracy vs battery
- **Background optimization**: Efficient when app is backgrounded
- **Sleep mode detection**: Pause tracking when device is idle

## 🛣️ Route Data Structure

### Waypoint Format
```json
{
  "lat": 49.4875,
  "lng": 8.466,
  "alt": 150.5,
  "timestamp": "2026-04-03T10:30:00.000Z",
  "accuracy": 5.2,
  "speed": 12.5
}
```

### Route Format
```json
{
  "id": "unique-route-id",
  "name": "Morning Jog",
  "startTime": "2026-04-03T10:00:00.000Z",
  "endTime": "2026-04-03T10:45:00.000Z",
  "points": [...],
  "totalDistance": 5.2,
  "stats": {
    "duration": 2700,
    "avgSpeed": 6.9
  }
}
```

## 🔄 Export Formats

### GPX Features
- Full track data with timestamps
- Elevation information when available
- Start/end waypoint markers
- Compatible with Garmin, Strava, etc.

### KML Features
- Visual styling for Google Earth
- Route lines with custom colors
- Placemark descriptions
- Altitude data integration

### JSON Features
- Complete route metadata
- Structured data format
- Easy programmatic access
- Backup and restore capability

### CSV Features
- Spreadsheet compatibility
- Point-by-point analysis
- Distance calculations
- Time series data

## 🚧 Development

### Building from Source
```bash
# Development setup (if extending the application)
git clone <repository>
cd route-tracker
docker build -t route-tracker-dev .
docker run -p 8080:80 route-tracker-dev
```

### Code Structure
```
route-tracker/
├── index.html          # Main application HTML
├── script.js           # Core tracking logic
├── user-manager.js     # User authentication system
├── export-manager.js   # Data export functionality  
├── route-tracker.js    # Route management (future)
├── Dockerfile          # Container configuration
└── README.md          # This documentation
```

## 📈 Roadmap

### Upcoming Features
- **Cloud sync** for cross-device route access
- **Route planning** with point-to-point navigation
- **Social features** for sharing and comparing routes
- **Advanced analytics** with detailed insights
- **Fitness tracking** integration
- **Multi-language support**

### Integration Plans
- **Strava connectivity** for route sharing
- **Garmin Connect** compatibility
- **Fitness device** synchronization
- **Weather data** integration
- **Traffic information** overlay

## 🤝 Contributing

Contributions are welcome! This application is part of the myTools suite focusing on:
- GPS and location services
- Data visualization and export
- Mobile-first web applications
- Privacy-focused solutions

## 📄 License

MIT License - see the myTools main repository for full license terms.

## 🆘 Support

For issues, feature requests, or questions:
1. Check the troubleshooting section below
2. Review the configuration options
3. Test in different browsers/devices
4. Check browser console for errors

### Troubleshooting

#### Location Access Issues
- Ensure HTTPS or localhost for geolocation API
- Check browser location permissions
- Verify GPS is enabled on mobile devices

#### Performance Issues
- Reduce tracking interval for battery saving
- Clear browser cache and localStorage
- Check available storage space

#### Export Issues
- Ensure browser supports file downloads
- Check popup blockers
- Verify sufficient route data exists

---

**Route Tracker** - Professional GPS tracking made simple. Part of the myTools suite by Gerald Amrhein.