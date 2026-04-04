// Export Manager for Route Tracker
// Handles exporting route data to various formats (GPX, KML, JSON)
class ExportManager {
    constructor() {
        this.supportedFormats = ['gpx', 'kml', 'json', 'csv'];
    }

    exportRoute(routeData, format = 'gpx') {
        if (!routeData || !routeData.points || routeData.points.length === 0) {
            this.showNotification('No route data to export', 'warning');
            return;
        }

        try {
            let exportData;
            let filename;
            let mimeType;

            switch (format.toLowerCase()) {
                case 'gpx':
                    exportData = this.generateGPX(routeData);
                    filename = `${this.sanitizeFilename(routeData.name)}.gpx`;
                    mimeType = 'application/gpx+xml';
                    break;
                
                case 'kml':
                    exportData = this.generateKML(routeData);
                    filename = `${this.sanitizeFilename(routeData.name)}.kml`;
                    mimeType = 'application/vnd.google-earth.kml+xml';
                    break;
                
                case 'json':
                    exportData = this.generateJSON(routeData);
                    filename = `${this.sanitizeFilename(routeData.name)}.json`;
                    mimeType = 'application/json';
                    break;
                
                case 'csv':
                    exportData = this.generateCSV(routeData);
                    filename = `${this.sanitizeFilename(routeData.name)}.csv`;
                    mimeType = 'text/csv';
                    break;
                
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }

            this.downloadFile(exportData, filename, mimeType);
            this.showNotification(`Route exported as ${format.toUpperCase()}`, 'success');

            // Update user stats if logged in
            if (window.userManager && window.userManager.isLoggedIn) {
                // Track export in user preferences
                console.log(`User exported route in ${format} format`);
            }

        } catch (error) {
            console.error('Export error:', error);
            this.showNotification(`Export failed: ${error.message}`, 'error');
        }
    }

    generateGPX(routeData) {
        const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Tracker by Gerald Amrhein" 
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 
     http://www.topografix.com/GPX/1/1/gpx.xsd" 
     xmlns="http://www.topografix.com/GPX/1/1" 
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`;

        const metadataSection = `
  <metadata>
    <name>${this.escapeXML(routeData.name)}</name>
    <desc>Route exported from Route Tracker</desc>
    <author>
      <name>Route Tracker</name>
    </author>
    <time>${new Date(routeData.startTime).toISOString()}</time>
  </metadata>`;

        const trackSection = `
  <trk>
    <name>${this.escapeXML(routeData.name)}</name>
    <desc>Tracked route with ${routeData.points.length} waypoints</desc>
    <trkseg>`;

        const trackPoints = routeData.points.map(point => {
            const timeStr = new Date(point.timestamp).toISOString();
            const elevation = point.alt ? `\n        <ele>${point.alt.toFixed(2)}</ele>` : '';
            return `      <trkpt lat="${point.lat.toFixed(8)}" lon="${point.lng.toFixed(8)}">${elevation}
        <time>${timeStr}</time>
      </trkpt>`;
        }).join('\n');

        const trackEnd = `
    </trkseg>
  </trk>`;

        // Add waypoints section (start and end points)
        const waypointsSection = this.generateGPXWaypoints(routeData);

        const gpxEnd = `</gpx>`;

        return gpxHeader + metadataSection + trackSection + trackPoints + trackEnd + waypointsSection + gpxEnd;
    }

    generateGPXWaypoints(routeData) {
        if (routeData.points.length === 0) return '';

        const startPoint = routeData.points[0];
        const endPoint = routeData.points[routeData.points.length - 1];

        return `
  <wpt lat="${startPoint.lat.toFixed(8)}" lon="${startPoint.lng.toFixed(8)}">
    <name>Start: ${this.escapeXML(routeData.name)}</name>
    <desc>Route start point</desc>
    <sym>Flag, Green</sym>
    <time>${new Date(startPoint.timestamp).toISOString()}</time>
  </wpt>
  <wpt lat="${endPoint.lat.toFixed(8)}" lon="${endPoint.lng.toFixed(8)}">
    <name>End: ${this.escapeXML(routeData.name)}</name>
    <desc>Route end point</desc>
    <sym>Flag, Red</sym>
    <time>${new Date(endPoint.timestamp).toISOString()}</time>
  </wpt>`;
    }

    generateKML(routeData) {
        const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${this.escapeXML(routeData.name)}</name>
    <description>Route exported from Route Tracker</description>`;

        // Style definitions
        const styleSection = `
    <Style id="routeLine">
      <LineStyle>
        <color>ff0000ff</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="startPoint">
      <IconStyle>
        <color>ff00ff00</color>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="endPoint">
      <IconStyle>
        <color>ff0000ff</color>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href>
        </Icon>
      </IconStyle>
    </Style>`;

        // Track line
        const coordinates = routeData.points.map(point => 
            `${point.lng.toFixed(8)},${point.lat.toFixed(8)},${(point.alt || 0).toFixed(2)}`
        ).join('\n        ');

        const placemarkSection = `
    <Placemark>
      <name>Route: ${this.escapeXML(routeData.name)}</name>
      <description>
        <![CDATA[
        <b>Route Details:</b><br/>
        Distance: ${routeData.totalDistance ? routeData.totalDistance.toFixed(2) : '0'} km<br/>
        Points: ${routeData.points.length}<br/>
        Start: ${new Date(routeData.startTime).toLocaleString()}<br/>
        ${routeData.endTime ? `End: ${new Date(routeData.endTime).toLocaleString()}<br/>` : ''}
        ]]>
      </description>
      <styleUrl>#routeLine</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
        ${coordinates}
        </coordinates>
      </LineString>
    </Placemark>`;

        // Start and end point placemarks
        const waypointSection = this.generateKMLWaypoints(routeData);

        const kmlEnd = `
  </Document>
</kml>`;

        return kmlHeader + styleSection + placemarkSection + waypointSection + kmlEnd;
    }

    generateKMLWaypoints(routeData) {
        if (routeData.points.length === 0) return '';

        const startPoint = routeData.points[0];
        const endPoint = routeData.points[routeData.points.length - 1];

        return `
    <Placemark>
      <name>Start</name>
      <description>Route start point</description>
      <styleUrl>#startPoint</styleUrl>
      <Point>
        <coordinates>${startPoint.lng.toFixed(8)},${startPoint.lat.toFixed(8)},${(startPoint.alt || 0).toFixed(2)}</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>End</name>
      <description>Route end point</description>
      <styleUrl>#endPoint</styleUrl>
      <Point>
        <coordinates>${endPoint.lng.toFixed(8)},${endPoint.lat.toFixed(8)},${(endPoint.alt || 0).toFixed(2)}</coordinates>
      </Point>
    </Placemark>`;
    }

    generateJSON(routeData) {
        const exportData = {
            format: "Route Tracker JSON Export",
            version: "1.0",
            exportedAt: new Date().toISOString(),
            route: {
                name: routeData.name,
                startTime: routeData.startTime,
                endTime: routeData.endTime || new Date(),
                totalDistance: routeData.totalDistance || 0,
                statistics: routeData.stats || {},
                points: routeData.points.map(point => ({
                    latitude: point.lat,
                    longitude: point.lng,
                    altitude: point.alt || null,
                    timestamp: point.timestamp,
                    accuracy: point.accuracy || null,
                    speed: point.speed || null
                })),
                metadata: {
                    pointCount: routeData.points.length,
                    creator: "Route Tracker by Gerald Amrhein",
                    source: "GPS tracking"
                }
            }
        };

        return JSON.stringify(exportData, null, 2);
    }

    generateCSV(routeData) {
        const headers = [
            'Point_Number',
            'Timestamp',
            'Latitude',
            'Longitude',
            'Altitude',
            'Accuracy',
            'Speed',
            'Distance_From_Start'
        ];

        let csvContent = headers.join(',') + '\n';
        let cumulativeDistance = 0;

        routeData.points.forEach((point, index) => {
            // Calculate distance from start if not first point
            if (index > 0) {
                const prevPoint = routeData.points[index - 1];
                const distance = this.calculateDistance(
                    prevPoint.lat, prevPoint.lng,
                    point.lat, point.lng
                );
                cumulativeDistance += distance;
            }

            const row = [
                index + 1,
                new Date(point.timestamp).toISOString(),
                point.lat.toFixed(8),
                point.lng.toFixed(8),
                (point.alt || 0).toFixed(2),
                (point.accuracy || 0).toFixed(2),
                (point.speed || 0).toFixed(2),
                cumulativeDistance.toFixed(3)
            ];

            csvContent += row.join(',') + '\n';
        });

        return csvContent;
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        // Haversine formula for distance calculation
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the URL object
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    sanitizeFilename(name) {
        // Remove invalid filename characters
        return name.replace(/[<>:"/\\|?*]/g, '_')
                  .replace(/\s+/g, '_')
                  .substring(0, 100); // Limit length
    }

    escapeXML(text) {
        if (!text) return '';
        return text.replace(/[<>&'"]/g, (char) => {
            switch (char) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return char;
            }
        });
    }

    // Bulk export multiple routes
    exportMultipleRoutes(routes, format = 'gpx') {
        if (!routes || routes.length === 0) {
            this.showNotification('No routes to export', 'warning');
            return;
        }

        try {
            const timestamp = new Date().toISOString().split('T')[0];
            
            if (format === 'json') {
                // Export as single JSON file with all routes
                const exportData = {
                    format: "Route Tracker Bulk Export",
                    version: "1.0",
                    exportedAt: new Date().toISOString(),
                    routeCount: routes.length,
                    routes: routes
                };
                
                this.downloadFile(
                    JSON.stringify(exportData, null, 2),
                    `route-tracker-bulk-export-${timestamp}.json`,
                    'application/json'
                );
            } else {
                // Create a zip-like structure by downloading multiple files
                routes.forEach((route, index) => {
                    setTimeout(() => {
                        this.exportRoute(route, format);
                    }, index * 500); // Stagger downloads
                });
            }

            this.showNotification(`${routes.length} routes exported`, 'success');

        } catch (error) {
            console.error('Bulk export error:', error);
            this.showNotification(`Bulk export failed: ${error.message}`, 'error');
        }
    }

    // Import route data (for future functionality)
    importRoute(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }

            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const content = event.target.result;
                    let routeData;

                    if (file.name.toLowerCase().endsWith('.json')) {
                        routeData = this.parseJSONRoute(content);
                    } else if (file.name.toLowerCase().endsWith('.gpx')) {
                        routeData = this.parseGPXRoute(content);
                    } else {
                        throw new Error('Unsupported file format');
                    }

                    resolve(routeData);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseJSONRoute(jsonContent) {
        // Parse JSON route data
        const data = JSON.parse(jsonContent);
        
        if (data.route) {
            return data.route;
        } else if (data.points) {
            return data;
        } else {
            throw new Error('Invalid JSON route format');
        }
    }

    parseGPXRoute(gpxContent) {
        // Basic GPX parsing (would need full XML parser for production)
        throw new Error('GPX import not yet implemented');
    }

    showNotification(message, type = 'success') {
        if (window.routeTracker) {
            window.routeTracker.showNotification(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }
}

// Initialize export manager
window.exportManager = new ExportManager();

console.log('Export Manager loaded');