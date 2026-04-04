# Route Tracker Quick Start Guide

## 🚀 Getting Started

### 1. Launch the Application
```bash
# Navigate to the myTools directory
cd /opt/containerd/myTools

# Start the Route Tracker with Docker Compose
docker-compose up -d route-tracker

# Or build and run individually
cd route-tracker
docker build -t route-tracker .
docker run -d -p 6050:80 -v ../shared:/usr/share/nginx/html/shared route-tracker
```

### 2. Access the Application
- **HTTPS Production**: https://tools.amrhein.info/route-tracker/
- **Local Development**: http://localhost:6050

### 3. First Use
1. Open the application in your web browser
2. Allow location access when prompted
3. Create a user account for persistent route storage
4. Start your first route!

## 📱 Mobile Usage

### Setup for Mobile
1. Open the app in your mobile browser (Chrome/Safari)
2. **Add to Home Screen** for full-screen experience
3. Enable **High Accuracy Location** in device settings
4. Keep the app active for continuous tracking

### Battery Optimization Tips
- Use 5-10 second intervals for balance
- Enable battery saver mode when not actively tracking
- Close other apps during long tracking sessions

## 🗺️ Features Overview

### Real-time Tracking
- **Start Tracking**: Enter route name, select interval, click Start
- **Live Stats**: Distance, speed, elevation, duration
- **Pause/Resume**: Take breaks without losing data
- **Stop & Save**: Automatic route saving

### Route Management  
- **View History**: Click any saved route to view on map
- **Export Data**: GPX, KML, JSON, CSV formats available
- **Delete Routes**: Manage storage space
- **Share Routes**: Copy links or use native sharing

### User Accounts
- **Registration**: Secure local account creation
- **Preferences**: Customize tracking settings
- **Statistics**: Track total distance, routes, time
- **Data Export**: GDPR-compliant data download

## 📊 Export Formats

### GPX (Recommended)
- **Best for**: GPS devices, Strava, Garmin Connect
- **Contains**: Full track with timestamps, elevation
- **Compatible with**: Most navigation and fitness apps

### KML  
- **Best for**: Google Earth, Google Maps
- **Contains**: Visual styling, route descriptions
- **Features**: Colored lines, start/end markers

### JSON
- **Best for**: Data analysis, backup
- **Contains**: Complete route metadata
- **Format**: Structured data with all tracking info

### CSV
- **Best for**: Spreadsheet analysis
- **Contains**: Point-by-point data
- **Includes**: Distance calculations, time series

## 🔧 Configuration

### Tracking Settings
- **1 second**: Maximum precision (high battery use)
- **5 seconds**: Recommended balance
- **10-30 seconds**: Battery saving mode

### Storage Management
- Routes stored locally in browser
- Maximum 50 routes per user
- Older routes auto-deleted when limit reached
- Export important routes for backup

## 🛠️ Troubleshooting

### Location Issues
```bash
# Check if HTTPS is enabled (required for geolocation)
# Verify location permissions in browser settings
# Ensure GPS is active on mobile devices
```

### Performance Problems
```bash
# Clear browser cache and localStorage
# Reduce tracking interval
# Close other browser tabs
# Check available device storage
```

### Export Problems
```bash
# Disable popup blockers
# Ensure route has data points
# Try different export format
# Check browser download settings
```

## 🔒 Privacy & Security

### Data Storage
- **Local Only**: All data stored in browser localStorage
- **No Server Upload**: Routes never leave your device
- **User Control**: Full data export and deletion

### Security Features
- Secure password hashing
- Input validation and sanitization
- CORS protection for API calls
- No external tracking or analytics

## 🌐 Integration with myTools

### Shared Design System
- Consistent UI with other myTools applications
- Shared styles and components
- Mobile-responsive design patterns

### Docker Integration
- Part of myTools docker-compose stack
- Shared network for service communication
- Traefik routing for easy access
- Automatic shared styles mounting

### Development Workflow
- Hot-reload capabilities in development
- Consistent build and deployment process
- Shared documentation and practices

---

**Happy Tracking!** 🏃‍♂️🚗🚲

For more detailed information, see the complete README.md file.