# Overlander iPhone App Configuration Guide

## Overview
This Route Tracker has been updated to receive GPS data from your Overlander iPhone app instead of collecting GPS data directly from the browser. The web interface now displays GPS routes sent from your iPhone.

## 🔧 Configuration Steps

### 1. **Get Your API Token**
- Open the Route Tracker web interface: https://tools.amrhein.info/route-tracker/
- The default token is: `default-token-123` 
- You can generate new tokens via the admin API (see Advanced Configuration)

### 2. **Configure Overlander iPhone App**
In your Overlander app, set the following:

| Setting | Value |
|---------|-------|
| **Endpoint URL** | `https://tools.amrhein.info/route-tracker/api/gps` |
| **Access Token** | `default-token-123` (or your custom token) |
| **Device ID** | `default-device` (or your custom device ID) |
| **HTTP Method** | `POST` |
| **Content-Type** | `application/json` |

### 3. **Data Format Options**
Choose one of these formats in your Overlander app:

- **"all"** - Send complete route data with all points
- **"latest"** - Send only the most recent GPS points 
- **"owntracks"** - Use OwnTracks compatible format

## 📱 iPhone App Setup

### Basic Configuration
1. Open Overlander app on your iPhone
2. Go to Settings → Data Export/Sharing
3. Add new endpoint with the values above
4. Enable GPS tracking
5. Start sending data to your server

### Example JSON Payload
```json
{
  "deviceId": "default-device",
  "routeName": "My Route",
  "lat": 49.4875,
  "lng": 8.466,
  "alt": 150.5,
  "speed": 25.0,
  "timestamp": "2026-04-03T10:30:00.000Z"
}
```

### OwnTracks Format (Alternative)
```json
{
  "_type": "location",
  "lat": 49.4875,
  "lon": 8.466,
  "alt": 150,
  "tst": 1712145000,
  "vel": 25,
  "acc": 5,
  "batt": 85
}
```

## 🖥️ Web Interface Usage

### Initial Setup
1. **Open Route Tracker**: http://localhost:6050
2. **Enter API Token**: Use `default-token-123` or generate new one
3. **Set Device ID**: Use `default-device` or your custom ID
4. **Click "Set Token"** to connect

### Viewing GPS Data
- **Real-time Updates**: Route automatically refreshes every 5 seconds
- **Route Statistics**: Distance, speed, elevation, duration
- **Interactive Map**: View current and historical routes
- **Export Options**: GPX, KML, JSON, CSV formats

### Managing Routes
- **Active Routes**: See currently tracking routes from your iPhone
- **Route History**: Browse all received routes
- **Export Data**: Download in various formats
- **Stop Routes**: End active tracking sessions

## 🔒 Security & Authentication

### Default Token
- Token: `default-token-123`
- This is for testing - generate secure tokens for production

### Generate New Tokens
```bash
# Create new API token (requires admin password)
curl -X POST http://localhost:6050/api/admin/tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "My iPhone Token", "adminPassword": "admin123"}'
```

### Environment Variables
```bash
# Set in docker-compose.yml or environment
ADMIN_PASSWORD=your-secure-password
PORT=3000
NODE_ENV=production
```

## 📊 API Endpoints

### GPS Data Reception
```
POST /api/gps
Authorization: Bearer your-token
Content-Type: application/json
```

### View Route Data
```
GET /api/routes/{routeId}
Authorization: Bearer your-token
```

### Device Management  
```
GET /api/devices/{deviceId}
GET /api/devices/{deviceId}/routes
POST /api/devices/{deviceId}/stop-route
```

## 🔧 Advanced Configuration

### Multiple Devices
- Use different Device IDs for different iPhones
- Each device maintains separate route history
- Switch between devices in the web interface

### Data Persistence
- GPS data stored in `/app/data/` directory
- Routes: `/app/data/routes/`
- Devices: `/app/data/devices/`
- Tokens: `/app/data/tokens.json`

### Custom Domain Setup
Update your domain in docker-compose.yml:
```yaml
labels:
  - "traefik.http.routers.route-tracker.rule=Host(`gps.yourdomain.com`)"
```

## 📱 Troubleshooting

### iPhone App Issues
- **No Data Appearing**: Check endpoint URL and token
- **Authentication Errors**: Verify token is correct
- **Connection Issues**: Ensure server is accessible from iPhone

### Server Issues
- **API Not Responding**: Check container logs
- **Token Issues**: Regenerate tokens via admin API
- **Storage Issues**: Check data directory permissions

### Check Container Status
```bash
docker ps | grep route-tracker
docker logs route-tracker
curl http://localhost:6050/api/health
```

## 🎯 Next Steps

1. **Configure your iPhone app** with the endpoint details
2. **Test GPS tracking** by starting a route in Overlander
3. **Monitor the web interface** to see real-time data
4. **Export your routes** in your preferred format
5. **Generate secure tokens** for production use

The Route Tracker now acts as a GPS data receiver and visualization platform for your iPhone's Overlander app, providing real-time route tracking and comprehensive data export capabilities!