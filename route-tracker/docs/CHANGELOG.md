# Route Tracker - Changelog

## [2.1.0] - 2026-04-12

### 🤖 Auto-Route System Added

#### Automated Route Creation
- **Daily route scheduling** with customizable time settings per device
- **Smart route completion** automatically finishes active routes before starting new ones
- **Server-side scheduler** checks every minute for pending route creation
- **Admin device management** with per-device auto-route configuration
- **Manual route triggering** for testing and immediate route creation

#### Device Management Interface
- **Auto-Route Settings Modal** with enable/disable toggle and time picker
- **Device table enhancement** showing auto-route status and schedule
- **Test functionality** for immediate auto-route creation
- **Settings persistence** with device-specific configuration storage
- **Admin controls** for managing auto-route behavior across all devices

#### Technical Implementation
- **Minute-by-minute scheduler** using setInterval for reliable timing
- **Device settings API** endpoints for configuration management
- **Route name formatting** with "Auto Route MM/DD/YYYY" pattern
- **Graceful error handling** with comprehensive logging
- **Performance optimization** for background scheduling operations

### 🔧 Admin Interface Improvements
- **Device Management section** added to admin panel
- **Auto-Route column** in device table for quick status visibility
- **Robot icon controls** for intuitive auto-route management
- **Modal-based settings** with modern UI/UX design
- **Real-time updates** after configuration changes

---

## [2.0.0] - 2026-04-11

### 🎯 Major Features Added

#### Advanced Route Editing System
- **Complete point manipulation interface** with drag-and-drop functionality
- **Point addition/deletion** via click-to-popup context menus
- **Professional edit mode** with fixed map background and Alt+drag navigation
- **Real-time visual feedback** during point editing operations
- **Edit session management** with save/discard/undo capabilities

#### Point Merging System
- **Rectangle selection tool** for multi-point selection
- **Alt+click individual selection** for precise point targeting
- **Intelligent point merging** with geometric center calculations
- **Merged point preservation** during performance optimization
- **Visual distinction** for merged points with special styling

#### Smart Route Analysis
- **Automatic road/off-road classification** based on speed patterns
- **Pause point detection** using time and distance algorithms  
- **Color-coded route visualization** (green=road, brown=off-road, yellow=pause)
- **Statistical analysis** with road/off-road percentages
- **Performance-optimized rendering** for routes with 1000+ points

#### Modern Authentication
- **PassKey/WebAuthn integration** using @simplewebauthn/server v9
- **Biometric authentication** (fingerprint, Face ID, Windows Hello)
- **Traditional login fallback** for device compatibility
- **Secure session management** with persistent secrets across restarts

### 🔧 Technical Improvements

#### Backend Enhancements
- **Process clustering** with 4-worker configuration for improved performance
- **Atomic file operations** for data integrity and corruption prevention
- **Route analysis pipeline** with intelligent segment classification
- **Route copying APIs** for debugging and testing workflows
- **Bulk operation support** for route merging and management

#### Frontend Architecture
- **Event-driven UI updates** with proper state management
- **Performance optimization** with intelligent point simplification
- **Memory management** for large route handling
- **Touch-optimized controls** for mobile device compatibility
- **Progressive feature enhancement** based on user capabilities

#### Data Model Evolution
- **Enhanced route metadata** with analysis results and visualization data
- **Point marking system** for merged and manually added points
- **Flexible export formats** supporting analysis data inclusion
- **Backward compatibility** with existing route data

### 🎨 User Experience Improvements

#### Interface Enhancements
- **Click-to-popup menus** replacing complex right-click context systems
- **Progressive disclosure** of advanced features based on user actions
- **Real-time notifications** with context-sensitive guidance
- **Responsive mobile interface** optimized for touch interactions
- **Visual feedback systems** for all interactive operations

#### Workflow Optimizations
- **Streamlined edit workflow** with clear entry/exit paths
- **One-click feature access** through intuitive button placement
- **Automatic feature detection** and appropriate UI adaptation
- **Error prevention** with operation validation and user confirmation

### 🔒 Security & Reliability

#### Authentication Security
- **Modern WebAuthn standard** implementation with full specification compliance
- **Credential device type tracking** for enhanced security policies
- **Session security** with httpOnly cookies and CSRF protection
- **Password-free authentication** reducing credential-based attack vectors

#### Data Protection
- **File-based persistence** with atomic write operations
- **Session secret persistence** across container restarts and updates
- **Input validation** and sanitization for all user data
- **Access control** with admin-only endpoint protection

### 🚀 Performance Enhancements

#### Route Rendering Optimization
- **Intelligent point simplification** maintaining route accuracy while improving performance
- **Merged point preservation** during optimization to maintain editing capability
- **Lazy analysis triggering** for substantial routes (>100 points)
- **Efficient layer management** with proper cleanup and memory usage

#### Scalability Improvements
- **Multi-worker processing** with cluster management and automatic restart
- **Efficient data storage** with optimized JSON structure and indexing
- **Cache-friendly operations** with reduced redundant calculations
- **Resource management** with configurable limits and monitoring

### 🐛 Bug Fixes

#### Edit Mode Stability
- **Fixed point dragging conflicts** with map interaction systems
- **Resolved context menu interference** between browser and application menus
- **Corrected event propagation** issues preventing proper point selection
- **Stabilized touch interaction** on mobile devices during editing

#### Data Consistency
- **Route list synchronization** after copy operations and bulk changes
- **Point index integrity** during add/delete/merge operations  
- **Analysis data consistency** with point modifications
- **Export format reliability** with enhanced error handling

#### Authentication Reliability
- **PassKey credential normalization** handling legacy storage formats
- **Session persistence** across container updates and restarts
- **Login state consistency** with proper session validation
- **Error handling improvement** with user-friendly feedback

### 📋 API Changes

#### New Endpoints
- `POST /api/routes/:routeId/analysis` - Trigger route analysis pipeline
- `POST /api/routes/:routeId/copy` - Create route copy for testing/debugging
- `PUT /api/routes/:routeId` - Update route data (admin edit mode)
- `POST /api/auth/register-begin` - Initiate WebAuthn registration
- `POST /api/auth/register-finish` - Complete WebAuthn registration
- `POST /api/auth/login-begin` - Initiate WebAuthn authentication  
- `POST /api/auth/login-finish` - Complete WebAuthn authentication

#### Enhanced Endpoints
- Enhanced `/api/gps` with automatic analysis triggering and improved route building
- Enhanced `/api/routes/:routeId` with analysis data inclusion and visualization metadata
- Enhanced `/api/devices/:deviceId/routes` with route statistics and metadata
- Enhanced export endpoints with analysis data format options

### 🔄 Migration Notes

#### Data Migration
- **Automatic analysis** triggered for existing routes on first access
- **Backward compatibility** maintained for all existing route data
- **Progressive enhancement** of route metadata with analysis results
- **Legacy authentication** support maintained alongside PassKey implementation

#### Configuration Updates
- **Session management** configuration for file-based persistence  
- **WebAuthn configuration** with Relying Party ID and origin settings
- **Process clustering** with configurable worker count limits
- **Performance optimization** settings for point simplification

---

## [1.0.0] - 2026-03-15

### Initial Release
- **Core GPS tracking** with OwnTracks protocol support
- **Route visualization** with Leaflet.js mapping
- **Basic user management** with email/password authentication  
- **Export functionality** for GPX, KML, JSON, and CSV formats
- **Mobile-responsive design** with PWA capabilities
- **Docker containerization** with nginx reverse proxy
- **Route history management** with user-specific data storage

---

**Legend:**
- 🎯 Major Features
- 🔧 Technical Improvements  
- 🎨 User Experience
- 🔒 Security & Reliability
- 🚀 Performance
- 🐛 Bug Fixes
- 📋 API Changes
- 🔄 Migration Notes