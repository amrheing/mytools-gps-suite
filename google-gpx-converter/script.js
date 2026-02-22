class GoogleMapsToGPXConverter {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.parsedPoints = [];
    }

    initializeElements() {
        this.urlInput = document.getElementById('urlInput');
        this.routeName = document.getElementById('routeName');
        this.includeTime = document.getElementById('includeTime');
        this.intervalMinutes = document.getElementById('intervalMinutes');
        this.convertBtn = document.getElementById('convertBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.statusContainer = document.getElementById('statusContainer');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.errorContainer = document.getElementById('errorContainer');
        this.errorList = document.getElementById('errorList');
        this.pointCount = document.getElementById('pointCount');
        this.gpxPreview = document.getElementById('gpxPreview');
    }

    attachEventListeners() {
        this.convertBtn.addEventListener('click', () => this.handleConvert());
        this.downloadBtn.addEventListener('click', () => this.downloadGPX());
        
        const expandUrlBtn = document.getElementById('expandUrlBtn');
        if (expandUrlBtn) {
            expandUrlBtn.addEventListener('click', () => this.handleExpandUrls());
        }
    }

    isShortUrl(url) {
        const shortUrlPatterns = [
            /maps\.app\.goo\.gl/,
            /goo\.gl\/maps/,
            /bit\.ly/,
            /tinyurl\.com/,
            /t\.co/
        ];
        
        return shortUrlPatterns.some(pattern => pattern.test(url));
    }

    async handleConvert() {
        const urls = this.urlInput.value.trim().split('\n').filter(url => url.trim() && !url.startsWith('#'));
        
        if (urls.length === 0) {
            this.showStatus('Please enter at least one Google Maps URL', 'error');
            return;
        }

        // Check for short URLs and provide guidance
        const shortUrls = urls.filter(url => this.isShortUrl ? this.isShortUrl(url) : false);
        if (shortUrls.length > 0) {
            this.showStatus(`Found ${shortUrls.length} short URL(s). Try using the "Auto-Expand URLs" button first, or expand them manually.`, 'info');
        }

        this.setLoading(true);
        this.clearResults();
        this.showStatus('Starting URL processing...', 'info');
        this.showProgress(0, urls.length, 'Initializing...');

        try {
            const points = [];
            const errors = []; 

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i].trim();
                
                // Update progress
                const progress = ((i + 1) / urls.length) * 100;
                this.updateProgress(progress, `Processing URL ${i + 1} of ${urls.length}...`);
                
                try {
                    const point = await this.parseMapUrl(url);
                    if (point) {
                        if (Array.isArray(point)) {
                            // Filter out points with invalid coordinates
                            const validPoints = point.filter(p => p.lat !== null && p.lng !== null && !isNaN(p.lat) && !isNaN(p.lng));
                            if (validPoints.length > 0) {
                                points.push(...validPoints);
                            } else {
                                // Add error for points that need geocoding
                                const invalidPoints = point.filter(p => p.lat === null || p.lng === null);
                                if (invalidPoints.length > 0) {
                                    errors.push(`URL ${i + 1}: Place names require geocoding - "${invalidPoints.map(p => p.name).join(', ')}". Use URLs with coordinates instead.`);
                                }
                            }
                        } else {
                            // Single point - validate coordinates
                            if (point.lat !== null && point.lng !== null && !isNaN(point.lat) && !isNaN(point.lng)) {
                                points.push(point);
                            } else {
                                errors.push(`URL ${i + 1}: Place name requires geocoding - "${point.name}". Use a URL with coordinates instead.`);
                            }
                        }
                    }
                } catch (error) {
                    const isShortUrl = this.isShortUrl ? this.isShortUrl(url) : false;
                    const errorMsg = isShortUrl 
                        ? `URL ${i + 1} (Short URL): ${error.message}`
                        : `URL ${i + 1}: ${error.message}`;
                    errors.push(errorMsg);
                }
            }

            if (points.length === 0) {
                this.hideProgress();
                this.showStatus('No valid coordinates found in the provided URLs', 'error');
                this.showErrors(errors);
                return;
            }

            this.parsedPoints = points;
            const gpxContent = this.generateGPX(points);
            
            this.updateProgress(100, 'Generating GPX file...');
            
            // Small delay to show completion
            await new Promise(resolve => setTimeout(resolve, 300));
            
            this.hideProgress();
            this.showResults(points.length, gpxContent);
            this.showStatus(`Successfully processed ${points.length} location(s)`, 'success');
            
            if (errors.length > 0) {
                this.showErrors(errors);
            }

        } catch (error) {
            this.hideProgress();
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    async parseMapUrl(url) {
        // Handle different Google Maps URL formats
        
        // Short URLs (maps.app.goo.gl)
        if (url.includes('maps.app.goo.gl') || url.includes('goo.gl/maps')) {
            // For short URLs, we'll need to resolve them or extract from share format
            return await this.parseShortUrl(url);
        }

        // Data parameter URLs (complex directions with encoded data)
        const dataMatch = url.match(/\/data=([^&]+)/);
        if (dataMatch) {
            const coordinatesFromData = this.parseDataParameter(dataMatch[1], url);
            if (coordinatesFromData && coordinatesFromData.length > 0) {
                return coordinatesFromData;
            }
        }

        // Direct coordinate URLs
        const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            return {
                lat: parseFloat(coordMatch[1]),
                lng: parseFloat(coordMatch[2]),
                name: `Location ${this.parsedPoints.length + 1}`
            };
        }

        // Multi-stop directions URLs (extract from path)
        const multiDirMatch = url.match(/\/maps\/dir\/([^/@]+)/);
        if (multiDirMatch) {
            const waypoints = this.parseDirectionsPath(multiDirMatch[1]);
            if (waypoints && waypoints.length > 0) {
                return waypoints;
            }
        }

        // Simple place search URLs
        const placeMatch = url.match(/\/maps\/\?q=([^&]+)/);
        if (placeMatch) {
            const query = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
            return {
                lat: null, // Will need geocoding
                lng: null,
                name: query,
                needsGeocoding: true
            };
        }

        // Directions URLs (simple two-point)
        const dirMatch = url.match(/\/maps\/dir\/([^\/]+)\/([^\/&?]+)/);
        if (dirMatch) {
            const origin = decodeURIComponent(dirMatch[1]).replace(/\+/g, ' ');
            const dest = decodeURIComponent(dirMatch[2]).replace(/\+/g, ' ');
            return [
                { lat: null, lng: null, name: origin, needsGeocoding: true },
                { lat: null, lng: null, name: dest, needsGeocoding: true }
            ];
        }

        throw new Error('Unsupported URL format');
    }

    async parseShortUrl(url) {
        // Try multiple approaches to handle short URLs
        
        // First, check if it's already expanded (contains coordinates)
        const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            return {
                lat: parseFloat(coordMatch[1]),
                lng: parseFloat(coordMatch[2]),
                name: `Location ${this.parsedPoints.length + 1}`
            };
        }

        // Try client-side expansion using fetch with redirect following
        try {
            const expandedUrl = await this.expandShortUrl(url);
            if (expandedUrl && expandedUrl !== url) {
                // Try to parse the expanded URL
                return await this.parseMapUrl(expandedUrl);
            }
        } catch (error) {
            console.warn('Client-side URL expansion failed:', error);
        }

        // Try to extract from common short URL patterns
        const shortUrlData = this.extractFromShortUrl(url);
        if (shortUrlData) {
            return shortUrlData;
        }

        // Provide helpful guidance for manual expansion
        throw new Error(`Short URL detected. Please expand it manually:\n1. Open ${url} in your browser\n2. Copy the full URL from the address bar\n3. Use that expanded URL instead`);
    }

    async expandShortUrl(url) {
        try {
            // Use the advanced URL expander
            return await URLExpander.expandUrl(url);
        } catch (error) {
            // Fallback to simple fetch approach
            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    mode: 'cors',
                    redirect: 'follow'
                });
                return response.url;
            } catch (fetchError) {
                console.warn('All URL expansion methods failed:', error, fetchError);
                throw new Error(`Cannot expand automatically. Try: ${URLExpander.getManualExpansionSuggestions(url).join(' → ')}`);
            }
        }
    }

    extractFromShortUrl(url) {
        // Try to extract useful information from known short URL patterns
        
        // Google's goo.gl URLs sometimes contain encoded data
        const googMatch = url.match(/goo\.gl\/maps\/([A-Za-z0-9]+)/);
        if (googMatch) {
            // This would require decoding Google's internal format
            // For now, return null to trigger manual expansion request
            return null;
        }

        // maps.app.goo.gl URLs
        const mapsAppMatch = url.match(/maps\.app\.goo\.gl\/([A-Za-z0-9]+)/);
        if (mapsAppMatch) {
            // These are Google's new short URLs - require expansion
            return null;
        }

        return null;
    }

    parseDataParameter(dataParam, fullUrl) {
        try {
            // Decode the data parameter
            const decoded = decodeURIComponent(dataParam);
            
            // Look for coordinate patterns in Google's encoded format
            // Pattern: 1d[longitude]!2d[latitude] or !1d[longitude]!2d[latitude]
            const coordPattern = /(?:^|!)1d(-?\d+\.?\d*)!2d(-?\d+\.?\d*)/g;
            const coordinates = [];
            let match;
            
            while ((match = coordPattern.exec(decoded)) !== null) {
                const lng = parseFloat(match[1]);
                const lat = parseFloat(match[2]);
                
                // Validate coordinates are reasonable
                if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    coordinates.push({
                        lat: lat,
                        lng: lng,
                        name: `Waypoint ${coordinates.length + 1}`
                    });
                }
            }
            
            if (coordinates.length > 0) {
                // Try to get place names from the URL path if available
                const urlPath = fullUrl.match(/\/maps\/dir\/([^/@?]+)/);
                if (urlPath) {
                    const places = this.parseDirectionsPath(urlPath[1]);
                    if (places && places.length > 0) {
                        // Merge coordinate data with place names
                        places.forEach((place, index) => {
                            if (coordinates[index]) {
                                coordinates[index].name = place.name;
                            }
                        });
                    }
                }
                
                return coordinates;
            }
            
            // Fallback: look for simpler coordinate patterns
            const simpleCoordMatch = decoded.match(/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (simpleCoordMatch) {
                return {
                    lat: parseFloat(simpleCoordMatch[1]),
                    lng: parseFloat(simpleCoordMatch[2]),
                    name: `Location from data`
                };
            }
            
        } catch (error) {
            console.warn('Error parsing data parameter:', error);
        }
        
        throw new Error('Could not parse coordinate data from URL');
    }

    parseDirectionsPath(pathSegment) {
        try {
            // Split by '/' and decode each segment
            const segments = pathSegment.split('/');
            const waypoints = [];
            
            segments.forEach((segment, index) => {
                if (segment.trim()) {
                    const decoded = decodeURIComponent(segment)
                        .replace(/\+/g, ' ')
                        .replace(/,\s*\d+$/, ''); // Remove postal codes
                    
                    waypoints.push({
                        lat: null,
                        lng: null,
                        name: decoded || `Waypoint ${index + 1}`,
                        needsGeocoding: true
                    });
                }
            });
            
            return waypoints.length > 0 ? waypoints : null;
        } catch (error) {
            console.warn('Error parsing directions path:', error);
            return null;
        }
    }

    generateGPX(points) {
        const now = new Date();
        const routeName = this.routeName.value.trim() || 'Google Maps Route';
        const includeTime = this.includeTime.checked;
        const intervalMinutes = parseInt(this.intervalMinutes.value) || 5;

        let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Google Maps to GPX Converter"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${this.escapeXml(routeName)}</name>
    <time>${now.toISOString()}</time>
  </metadata>
`;

        // Add track
        if (points.length > 1) {
            gpxContent += `  <trk>
    <name>${this.escapeXml(routeName)}</name>
    <trkseg>
`;
            points.forEach((point, index) => {
                const time = new Date(now.getTime() + index * intervalMinutes * 60 * 1000);
                gpxContent += `      <trkpt lat="${point.lat}" lon="${point.lng}">`;
                if (includeTime) {
                    gpxContent += `
        <time>${time.toISOString()}</time>`;
                }
                gpxContent += `
      </trkpt>
`;
            });

            gpxContent += `    </trkseg>
  </trk>
`;
        }

        // Add waypoints
        points.forEach((point, index) => {
            gpxContent += `  <wpt lat="${point.lat}" lon="${point.lng}">
    <name>${this.escapeXml(point.name || `Waypoint ${index + 1}`)}</name>
  </wpt>
`;
        });

        gpxContent += `</gpx>`;
        
        return gpxContent;
    }

    escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showResults(pointCount, gpxContent) {
        this.pointCount.textContent = `✅ ${pointCount} point(s) converted successfully!`;
        this.gpxPreview.textContent = gpxContent;
        this.resultsContainer.style.display = 'block';
        
        // Scroll to results and highlight download button
        this.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Briefly highlight the download button
        setTimeout(() => {
            this.downloadBtn.style.animation = 'pulse 1s ease-in-out';
            this.showStatus('🎉 GPX file ready! Click the green download button below.', 'success');
        }, 500);
    }

    clearResults() {
        this.resultsContainer.style.display = 'none';
        this.errorContainer.style.display = 'none';
        this.hideProgress();
    }
    
    showProgress(current, total, message) {
        this.progressContainer.style.display = 'block';
        const percentage = total > 0 ? (current / total) * 100 : 0;
        this.updateProgress(percentage, message);
    }
    
    updateProgress(percentage, message) {
        if (this.progressFill && this.progressText) {
            this.progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
            this.progressText.textContent = message || `${Math.round(percentage)}% complete`;
        }
    }
    
    hideProgress() {
        if (this.progressContainer) {
            this.progressContainer.style.display = 'none';
        }
    }

    showStatus(message, type) {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
    }

    showErrors(errors) {
        if (errors.length === 0) return;
        
        this.errorList.innerHTML = '';
        errors.forEach(error => {
            const li = document.createElement('li');
            li.textContent = error;
            this.errorList.appendChild(li);
        });
        this.errorContainer.style.display = 'block';
    }

    setLoading(loading) {
        this.convertBtn.disabled = loading;
        if (loading) {
            this.convertBtn.classList.add('loading');
        } else {
            this.convertBtn.classList.remove('loading');
        }
    }

    downloadGPX() {
        if (this.parsedPoints.length === 0) {
            this.showStatus('❌ No GPX data to download. Please process URLs first.', 'error');
            return;
        }

        const gpxContent = this.gpxPreview.textContent;
        if (!gpxContent || gpxContent.trim() === '') {
            this.showStatus('❌ GPX content is empty. Please try processing the URLs again.', 'error');
            return;
        }

        const routeName = this.routeName.value.trim() || 'route';
        const filename = `${routeName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.gpx`;

        const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);

        this.showStatus(`🎉 GPX file "${filename}" downloaded successfully! Check your Downloads folder.`, 'success');
    }
}

// Enhanced URL parser for more formats
class EnhancedURLParser {
    static parseURL(url) {
        const patterns = [
            // Standard coordinate format: @lat,lng,zoom
            { 
                regex: /@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)?/,
                extract: (match) => ({
                    lat: parseFloat(match[1]),
                    lng: parseFloat(match[2]),
                    name: `Coordinates (${match[1]}, ${match[2]})`
                })
            },
            
            // Place parameter: ?q=place
            {
                regex: /[\?&]q=([^&]+)/,
                extract: (match) => {
                    const place = decodeURIComponent(match[1]).replace(/\+/g, ' ');
                    return {
                        lat: null,
                        lng: null,
                        name: place,
                        needsGeocoding: true
                    };
                }
            },

            // LL parameter: ll=lat,lng
            {
                regex: /[\?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
                extract: (match) => ({
                    lat: parseFloat(match[1]),
                    lng: parseFloat(match[2]),
                    name: `Location (${match[1]}, ${match[2]})`
                })
            },

            // Destination parameter: destination=lat,lng
            {
                regex: /[\?&]destination=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
                extract: (match) => ({
                    lat: parseFloat(match[1]),
                    lng: parseFloat(match[2]),
                    name: `Destination (${match[1]}, ${match[2]})`
                })
            },

            // Origin parameter: origin=lat,lng
            {
                regex: /[\?&]origin=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
                extract: (match) => ({
                    lat: parseFloat(match[1]),
                    lng: parseFloat(match[2]),
                    name: `Origin (${match[1]}, ${match[2]})`
                })
            }
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern.regex);
            if (match) {
                return pattern.extract(match);
            }
        }

        return null;
    }

    async handleExpandUrls() {
        const urls = this.urlInput.value.trim().split('\n').filter(url => url.trim() && !url.startsWith('#'));
        const shortUrls = urls.filter(url => this.isShortUrl ? this.isShortUrl(url) : false);
        
        if (shortUrls.length === 0) {
            this.showStatus('No short URLs found in the input', 'info');
            return;
        }
        
        this.showStatus(`Found ${shortUrls.length} short URL(s) to expand...`, 'info');
        this.showProgress(0, shortUrls.length, 'Starting URL expansion...');
        
        const expandedUrls = [];
        let expandedCount = 0;
        
        for (let i = 0; i < shortUrls.length; i++) {
            const shortUrl = shortUrls[i];
            
            // Update progress
            const progress = ((i) / shortUrls.length) * 100;
            this.updateProgress(progress, `Expanding URL ${i + 1} of ${shortUrls.length}...`);
            
            try {
                const expanded = await this.expandShortUrl(shortUrl);
                if (expanded && expanded !== shortUrl) {
                    expandedUrls.push({ original: shortUrl, expanded });
                    expandedCount++;
                }
            } catch (error) {
                console.warn(`Failed to expand ${shortUrl}:`, error);
            }
        }
        
        this.updateProgress(100, 'Finalizing...');
        
        // Small delay to show completion
        await new Promise(resolve => setTimeout(resolve, 200));
        
        this.hideProgress();
        
        if (expandedCount > 0) {
            // Replace the short URLs with expanded ones in the input
            let newContent = this.urlInput.value;
            expandedUrls.forEach(({ original, expanded }) => {
                newContent = newContent.replace(original, expanded);
            });
            this.urlInput.value = newContent;
            this.showStatus(`Successfully expanded ${expandedCount} URL(s)`, 'success');
        } else {
            this.showStatus('Unable to expand URLs automatically. Please expand manually.', 'error');
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new GoogleMapsToGPXConverter();
    
    // Add some example URLs for demonstration
    const examples = [
        '# Example URLs (delete this section and paste your URLs):',
        'https://www.google.com/maps/@40.7128,-74.0060,15z',
        'https://www.google.com/maps/@40.7589,-73.9851,15z', 
        'https://www.google.com/maps/@40.6892,-74.0445,15z',
        '',
        '# Test URL - Multi-stop route (Bad Camberg to Scandinavia):',
        'https://www.google.com/maps/dir/Bad+Camberg,+65520/Malmö/Växjö/Jönköping/Halmstad/Grenaa/Odense/Flensburg/Bad+Camberg,+65520/@53.9154899,6.1642691,1744094m/data=!3m2!1e3!4b1!4m56!4m55!1m5!1m1!1s0x47bdb4026094960b:0x422435029b0a700!2m2!1d8.2650359!2d50.2982625!1m5!1m1!1s0x465305a574c3d5a1:0x4019078290e7a40!2m2!1d13.003822!2d55.604981!1m5!1m1!1s0x465723901633591b:0x4019078290e79e0!2m2!1d14.809064!2d56.877673!1m5!1m1!1s0x465a723867622839:0x4019078290e7a00!2m2!1d14.161788!2d57.782614!1m5!1m1!1s0x4651a26d7051287b:0x4019078290e79c0!2m2!1d12.857791!2d56.674377!1m5!1m1!1s0x464dd9450875e5e1:0x29046734e73647f3!2m2!1d10.874167!2d56.416944!1m5!1m1!1s0x464cd93939d93939:0x400bdbe05436a00!2m2!1d10.38831!2d55.39594!1m5!1m1!1s0x47b3429393939393:0x400bdbe05436a00!2m2!1d9.436754!2d54.783589!1m5!1m1!1s0x47bdb4026094960b:0x422435029b0a700!2m2!1d8.2650359!2d50.2982625!3e0?entry=tts'
    ];
    
    const urlInput = document.getElementById('urlInput');
    if (urlInput.value.trim() === '') {
        urlInput.value = examples.join('\n');
    }
});