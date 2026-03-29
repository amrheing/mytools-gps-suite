class GPXToKMLConverter {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.parsedData = null;
        this.kmlContent = '';
    }

    initializeElements() {
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.selectFileBtn = document.getElementById('selectFileBtn');
        this.fileInfo = document.getElementById('fileInfo');
        this.fileName = document.getElementById('fileName');
        this.fileSize = document.getElementById('fileSize');
        this.clearFileBtn = document.getElementById('clearFileBtn');
        
        this.kmlName = document.getElementById('kmlName');
        this.includeWaypoints = document.getElementById('includeWaypoints');
        this.includeTracks = document.getElementById('includeTracks');
        this.includeRoutes = document.getElementById('includeRoutes');
        this.trackColor = document.getElementById('trackColor');
        this.trackWidth = document.getElementById('trackWidth');
        this.trackWidthValue = document.getElementById('trackWidthValue');
        
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
        
        this.waypointCount = document.getElementById('waypointCount');
        this.trackPointCount = document.getElementById('trackPointCount');
        this.routeCount = document.getElementById('routeCount');
        this.kmlPreviewElement = document.getElementById('kmlContent');
    }

    attachEventListeners() {
        // File upload events
        this.selectFileBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.clearFileBtn.addEventListener('click', () => this.clearFile());
        
        // Drag and drop events
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
        
        // Conversion events
        this.convertBtn.addEventListener('click', () => this.handleConvert());
        this.downloadBtn.addEventListener('click', () => this.downloadKML());
        
        // Track width slider
        this.trackWidth.addEventListener('input', (e) => {
            this.trackWidthValue.textContent = e.target.value;
        });
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        // Validate file type
        if (!file.name.toLowerCase().endsWith('.gpx') && !file.name.toLowerCase().endsWith('.xml')) {
            this.showError(['Please select a GPX file (.gpx or .xml extension)']);
            return;
        }

        // Show file info
        this.fileName.textContent = file.name;
        this.fileSize.textContent = `(${this.formatFileSize(file.size)})`;
        this.fileInfo.style.display = 'flex';
        this.convertBtn.disabled = false;
        
        // Store file for conversion
        this.selectedFile = file;
        
        // Update status
        this.showStatus('File selected. Ready to convert.', 'success');
    }

    clearFile() {
        this.fileInput.value = '';
        this.fileInfo.style.display = 'none';
        this.convertBtn.disabled = true;
        this.selectedFile = null;
        this.hideResults();
        this.hideStatus();
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async handleConvert() {
        if (!this.selectedFile) {
            this.showError(['No file selected']);
            return;
        }

        try {
            this.showProgress('Reading GPX file...');
            this.hideResults();
            this.hideErrors();

            // Read file content
            const fileContent = await this.readFileContent(this.selectedFile);
            
            this.showProgress('Parsing GPX data...');
            
            // Parse GPX content
            this.parsedData = await this.parseGPX(fileContent);
            
            this.showProgress('Generating KML...');
            
            // Generate KML
            this.kmlContent = this.generateKML(this.parsedData);
            
            this.hideProgress();
            this.showResults();
            
        } catch (error) {
            this.hideProgress();
            this.showError([`Conversion failed: ${error.message}`]);
        }
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseGPX(xmlContent) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlContent, 'text/xml');
            
            // Check for parsing errors
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML format');
            }

            const data = {
                waypoints: [],
                tracks: [],
                routes: []
            };

            // Parse waypoints
            const waypoints = doc.querySelectorAll('wpt');
            waypoints.forEach(wpt => {
                const lat = parseFloat(wpt.getAttribute('lat'));
                const lon = parseFloat(wpt.getAttribute('lon'));
                const name = this.getElementText(wpt, 'name') || 'Waypoint';
                const desc = this.getElementText(wpt, 'desc') || '';
                const ele = this.getElementText(wpt, 'ele');
                
                data.waypoints.push({
                    lat, lon, name, desc,
                    elevation: ele ? parseFloat(ele) : null
                });
            });

            // Parse tracks
            const tracks = doc.querySelectorAll('trk');
            tracks.forEach(trk => {
                const trackName = this.getElementText(trk, 'name') || 'Track';
                const trackDesc = this.getElementText(trk, 'desc') || '';
                const segments = [];
                
                const trksegs = trk.querySelectorAll('trkseg');
                trksegs.forEach(trkseg => {
                    const points = [];
                    const trkpts = trkseg.querySelectorAll('trkpt');
                    
                    trkpts.forEach(trkpt => {
                        const lat = parseFloat(trkpt.getAttribute('lat'));
                        const lon = parseFloat(trkpt.getAttribute('lon'));
                        const ele = this.getElementText(trkpt, 'ele');
                        const time = this.getElementText(trkpt, 'time');
                        
                        points.push({
                            lat, lon,
                            elevation: ele ? parseFloat(ele) : null,
                            time: time || null
                        });
                    });
                    
                    if (points.length > 0) {
                        segments.push(points);
                    }
                });
                
                if (segments.length > 0) {
                    data.tracks.push({
                        name: trackName,
                        description: trackDesc,
                        segments
                    });
                }
            });

            // Parse routes
            const routes = doc.querySelectorAll('rte');
            routes.forEach(rte => {
                const routeName = this.getElementText(rte, 'name') || 'Route';
                const routeDesc = this.getElementText(rte, 'desc') || '';
                const points = [];
                
                const rtepts = rte.querySelectorAll('rtept');
                rtepts.forEach(rtept => {
                    const lat = parseFloat(rtept.getAttribute('lat'));
                    const lon = parseFloat(rtept.getAttribute('lon'));
                    const name = this.getElementText(rtept, 'name') || '';
                    const ele = this.getElementText(rtept, 'ele');
                    
                    points.push({
                        lat, lon, name,
                        elevation: ele ? parseFloat(ele) : null
                    });
                });
                
                if (points.length > 0) {
                    data.routes.push({
                        name: routeName,
                        description: routeDesc,
                        points
                    });
                }
            });

            return data;
            
        } catch (error) {
            throw new Error(`GPX parsing failed: ${error.message}`);
        }
    }

    getElementText(element, tagName) {
        const child = element.querySelector(tagName);
        return child ? child.textContent.trim() : null;
    }

    generateKML(data) {
        const kmlName = this.kmlName.value || 'Converted Track';
        const trackColor = this.trackColor.value;
        const trackWidth = this.trackWidth.value;
        
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${this.escapeXML(kmlName)}</name>
    <description>Converted from GPX file</description>
    
    <!-- Line Style -->
    <Style id="trackStyle">
      <LineStyle>
        <color>${trackColor}</color>
        <width>${trackWidth}</width>
      </LineStyle>
    </Style>
    
    <Style id="waypointStyle">
      <IconStyle>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href>
        </Icon>
      </IconStyle>
    </Style>
`;

        // Add waypoints as placemarks
        if (this.includeWaypoints.checked && data.waypoints.length > 0) {
            kml += `    <Folder>
      <name>Waypoints</name>
      <description>${data.waypoints.length} waypoints</description>
`;
            
            data.waypoints.forEach(waypoint => {
                kml += `      <Placemark>
        <name>${this.escapeXML(waypoint.name)}</name>
        <description>${this.escapeXML(waypoint.desc)}</description>
        <styleUrl>#waypointStyle</styleUrl>
        <Point>
          <coordinates>${waypoint.lon},${waypoint.lat}${waypoint.elevation ? ',' + waypoint.elevation : ''}</coordinates>
        </Point>
      </Placemark>
`;
            });
            
            kml += `    </Folder>
`;
        }

        // Add tracks
        if (this.includeTracks.checked && data.tracks.length > 0) {
            kml += `    <Folder>
      <name>Tracks</name>
      <description>${data.tracks.length} tracks</description>
`;
            
            data.tracks.forEach(track => {
                kml += `      <Placemark>
        <name>${this.escapeXML(track.name)}</name>
        <description>${this.escapeXML(track.description)}</description>
        <styleUrl>#trackStyle</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>
`;
                
                track.segments.forEach(segment => {
                    segment.forEach(point => {
                        kml += `            ${point.lon},${point.lat}${point.elevation ? ',' + point.elevation : ''}\n`;
                    });
                });
                
                kml += `          </coordinates>
        </LineString>
      </Placemark>
`;
            });
            
            kml += `    </Folder>
`;
        }

        // Add routes
        if (this.includeRoutes.checked && data.routes.length > 0) {
            kml += `    <Folder>
      <name>Routes</name>
      <description>${data.routes.length} routes</description>
`;
            
            data.routes.forEach(route => {
                kml += `      <Placemark>
        <name>${this.escapeXML(route.name)}</name>
        <description>${this.escapeXML(route.description)}</description>
        <styleUrl>#trackStyle</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>
`;
                
                route.points.forEach(point => {
                    kml += `            ${point.lon},${point.lat}${point.elevation ? ',' + point.elevation : ''}\n`;
                });
                
                kml += `          </coordinates>
        </LineString>
      </Placemark>
`;
            });
            
            kml += `    </Folder>
`;
        }

        kml += `  </Document>
</kml>`;

        return kml;
    }

    escapeXML(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    downloadKML() {
        if (!this.kmlContent) {
            this.showError(['No KML content to download']);
            return;
        }

        const fileName = (this.kmlName.value || 'converted-track').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.kml';
        const blob = new Blob([this.kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        this.showStatus('KML file downloaded successfully!', 'success');
    }

    showProgress(message) {
        this.progressContainer.style.display = 'block';
        this.progressText.textContent = message;
        this.progressFill.style.width = '50%';
    }

    hideProgress() {
        this.progressContainer.style.display = 'none';
    }

    showResults() {
        if (!this.parsedData) return;
        
        // Update counts
        this.waypointCount.textContent = this.parsedData.waypoints.length;
        
        let totalTrackPoints = 0;
        this.parsedData.tracks.forEach(track => {
            track.segments.forEach(segment => {
                totalTrackPoints += segment.length;
            });
        });
        this.trackPointCount.textContent = totalTrackPoints;
        this.routeCount.textContent = this.parsedData.routes.length;
        
        // Show preview
        const previewContent = this.kmlContent.length > 2000 ? 
            this.kmlContent.substring(0, 2000) + '\n\n... (truncated)' : 
            this.kmlContent;
        this.kmlPreviewElement.textContent = previewContent;
        
        this.resultsContainer.style.display = 'block';
    }

    hideResults() {
        this.resultsContainer.style.display = 'none';
    }

    showStatus(message, type = 'info') {
        const icon = type === 'success' ? 'fas fa-check-circle' : 'fas fa-info-circle';
        this.statusMessage.innerHTML = `<i class="${icon}"></i><span>${message}</span>`;
        this.statusContainer.style.display = 'block';
        this.statusContainer.className = `status-container ${type}`;
    }

    hideStatus() {
        this.statusContainer.style.display = 'none';
    }

    showError(errors) {
        this.errorList.innerHTML = '';
        errors.forEach(error => {
            const li = document.createElement('li');
            li.textContent = error;
            this.errorList.appendChild(li);
        });
        this.errorContainer.style.display = 'block';
    }

    hideErrors() {
        this.errorContainer.style.display = 'none';
    }
}

// Initialize the converter when page loads
document.addEventListener('DOMContentLoaded', () => {
    new GPXToKMLConverter();
});