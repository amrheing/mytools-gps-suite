// Main Route Tracker Application - GPS Data Receiver
class RouteTracker {
    constructor() {
        this.map = null;
        this.currentRoute = null;
        this.activeRoutes = new Map(); // Store multiple device routes
        this.devices = new Map(); // Store device information
        this.refreshInterval = null;
        this.apiToken = localStorage.getItem('apiToken') || 'default-token-123';
        this.selectedDeviceId = localStorage.getItem('selectedDeviceId') || 'default-device';
        this.autoRefresh = true;
        this.refreshRate = 5000; // 5 seconds default
        
        // Initialize the application
        this.init();
    }

    async init() {
        try {
            // Check authentication first
            const authRes = await fetch('./api/auth/me');
            if (!authRes.ok) {
                window.location.href = './login.html';
                return;
            }
            const me = await authRes.json();

            // Use the GPS token assigned by admin (overrides localStorage)
            if (me.gpsToken) {
                this.apiToken = me.gpsToken;
                localStorage.setItem('apiToken', me.gpsToken);
            }

            // Show admin link for admins
            if (me.role === 'admin') {
                const adminLink = document.getElementById('admin-link');
                if (adminLink) adminLink.style.display = 'inline-flex';
            }

            // Initialize map
            this.initMap();
            
            // Initialize user management
            if (window.userManager) {
                window.userManager.init();
            }
            
            // Check API token and initialize UI
            this.initTokenUI();
            
            // Load initial data if token available
            if (this.apiToken) {
                await this.loadAndPopulateDevices(); // New method
                this.setupDeviceSelector(); // New method
                await this.loadDevicesAndRoutes();
                this.startAutoRefresh();
                
                // Auto-start GPS monitoring
                try {
                    this.startAutoGPSMonitoring();
                    console.log('GPS monitoring started automatically');
                } catch (error) {
                    console.error('Failed to auto-start GPS monitoring:', error);
                }
            }
            
            console.log('Route Tracker GPS Receiver initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Route Tracker:', error);
            this.showNotification('Failed to initialize: ' + error.message, 'error');
        }
    }

    initTokenUI() {
        // Update UI based on token availability
        const tokenSection = document.getElementById('token-setup');
        const mainApp = document.getElementById('main-app');
        
        if (this.apiToken) {
            if (tokenSection) tokenSection.style.display = 'none';
            if (mainApp) mainApp.style.display = 'block';
            document.getElementById('current-token').textContent = this.apiToken.substring(0, 8) + '...';
        } else {
            if (tokenSection) tokenSection.style.display = 'block';
            if (mainApp) mainApp.style.display = 'none';
        }
        
        // Setup token input
        const tokenInput = document.getElementById('api-token');
        if (tokenInput && this.apiToken) {
            tokenInput.value = this.apiToken;
        }
    }

    async loadAndPopulateDevices() {
        try {
            const response = await this.apiCall(`/api/devices`);
            if (response.ok) {
                const devices = await response.json();
                const selector = document.getElementById('device-selector');
                selector.innerHTML = '';
                devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.id;
                    option.textContent = device.name || device.id;
                    selector.appendChild(option);
                });
                // If cached device isn't in the allowed list, fall back to first available
                const ids = devices.map(d => d.id);
                if (!ids.includes(this.selectedDeviceId) && ids.length > 0) {
                    this.selectedDeviceId = ids[0];
                    localStorage.setItem('selectedDeviceId', this.selectedDeviceId);
                }
                selector.value = this.selectedDeviceId;
            }
        } catch (error) {
            console.error('Error loading devices:', error);
            this.showNotification('Error loading device list: ' + error.message, 'error');
        }
    }

    setupDeviceSelector() {
        const selector = document.getElementById('device-selector');
        selector.addEventListener('change', (event) => {
            this.selectedDeviceId = event.target.value;
            localStorage.setItem('selectedDeviceId', this.selectedDeviceId);
            this.showNotification(`Switched to device: ${this.selectedDeviceId}`, 'info');
            this.loadDevicesAndRoutes();
        });
    }

    async loadDevicesAndRoutes() {
        try {
            // Get device information
            const deviceResponse = await this.apiCall(`/api/devices/${this.selectedDeviceId}`);
            if (deviceResponse.ok) {
                const deviceData = await deviceResponse.json();
                this.devices.set(this.selectedDeviceId, deviceData);
                this.updateDeviceInfo(deviceData);
                
                // Load current active route if available
                if (deviceData.currentRoute) {
                    await this.loadRoute(deviceData.currentRoute);
                } else {
                    // If no active route, clear the map
                    if (this.currentRoute) {
                        this.map.removeLayer(this.currentRoute);
                        this.currentRoute = null;
                    }
                    this.updateRouteStats(null); // Clear stats
                }
                
                // Load recent routes list
                await this.loadRoutesList();
            }
        } catch (error) {
            console.error('Error loading data:', error);
            this.showNotification('Error loading device data: ' + error.message, 'error');
        }
    }

    async loadRoute(routeId) {
        try {
            const response = await this.apiCall(`/api/routes/${routeId}`);
            if (response.ok) {
                const routeData = await response.json();
                this.displayRoute(routeData);
                this.updateRouteStats(routeData);
                return routeData;
            }
        } catch (error) {
            console.error('Error loading route:', error);
        }
        return null;
    }

    async loadRoutesList() {
        try {
            const response = await this.apiCall(`/api/devices/${this.selectedDeviceId}/routes`);
            if (response.ok) {
                const data = await response.json();
                this.updateRoutesList(data.routes);
            }
        } catch (error) {
            console.error('Error loading routes list:', error);
        }
    }

    displayRoute(routeData) {
        // Clear existing layers
        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
        }
        this.map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                this.map.removeLayer(layer);
            }
        });
        
        // Create new route line
        if (routeData && routeData.points && routeData.points.length > 0) {
            const latLngs = routeData.points.map(p => [p.lat, p.lng]);
            
            this.currentRoute = L.polyline(latLngs, {
                color: '#e74c3c',
                weight: 4,
                opacity: 0.8
            }).addTo(this.map);
            
            // Add start/end markers
            const startPoint = routeData.points[0];
            const endPoint = routeData.points[routeData.points.length - 1];
            
            L.marker([startPoint.lat, startPoint.lng], {
                icon: L.icon({
                    iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="green"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
                    iconSize: [25, 25]
                })
            })
            .bindPopup(`Start: ${routeData.name}<br>Time: ${new Date(startPoint.timestamp).toLocaleString()}`)
            .addTo(this.map);
            
            if (routeData.points.length > 1) {
                L.marker([endPoint.lat, endPoint.lng], {
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
                        iconSize: [25, 25]
                    })
                })
                .bindPopup(`Current: ${routeData.name}<br>Time: ${new Date(endPoint.timestamp).toLocaleString()}<br>Speed: ${endPoint.speed ? (endPoint.speed * 3.6).toFixed(1) + ' km/h' : 'N/A'}`)
                .addTo(this.map);
            }
            
            // Fit map to route with proper padding for better visibility  
            this.map.fitBounds(latLngs, { padding: [20, 20], maxZoom: 17 });
        }
    }

    updateDeviceInfo(deviceData) {
        const deviceName = document.getElementById('device-name');
        const deviceStatus = document.getElementById('device-status');
        const lastUpdate = document.getElementById('last-update');
        
        if (deviceName) deviceName.textContent = deviceData.name;
        if (deviceStatus) {
            deviceStatus.textContent = deviceData.currentRoute ? 'Active Route' : 'No Active Route';
            deviceStatus.className = deviceData.currentRoute ? 'status-active' : 'status-inactive';
        }
        if (lastUpdate && deviceData.lastUpdate) {
            lastUpdate.textContent = new Date(deviceData.lastUpdate).toLocaleString();
        }
    }

    updateRouteStats(routeData) {
        if (!routeData || !routeData.points) return;
        
        const totalPoints = routeData.points.length;
        const totalDistance = routeData.totalDistance || 0;
        const startTime = new Date(routeData.startTime);
        const endTime = routeData.endTime ? new Date(routeData.endTime) : new Date();
        const duration = Math.floor((endTime - startTime) / 1000);
        
        // Calculate average speed
        const avgSpeed = duration > 0 ? (totalDistance / duration) * 3600 : 0;
        
        // Get current speed from last point
        let currentSpeed = 0;
        if (totalPoints > 0 && routeData.points[totalPoints - 1].speed) {
            currentSpeed = routeData.points[totalPoints - 1].speed * 3.6; // Convert m/s to km/h
        }
        
        // Update UI elements
        document.getElementById('total-distance').textContent = totalDistance.toFixed(2);
        document.getElementById('total-time').textContent = this.formatDuration(duration);
        document.getElementById('avg-speed').textContent = avgSpeed.toFixed(1);
        document.getElementById('current-speed').textContent = currentSpeed.toFixed(1);
        document.getElementById('waypoints').textContent = totalPoints;
        
        // Update elevation if available
        if (totalPoints > 0 && routeData.points[totalPoints - 1].alt) {
            document.getElementById('elevation').textContent = Math.round(routeData.points[totalPoints - 1].alt);
        }
    }

    updateRoutesList(routes) {
        const routeList = document.getElementById('route-list');
        if (!routeList || !routes) return;
        
        if (routes.length === 0) {
            routeList.innerHTML = '<div class="route-item"><div class="route-info"><p>No routes received yet. Configure your Overlander app to send GPS data to this server.</p></div></div>';
            return;
        }

        routeList.innerHTML = routes.map(route => `
            <div class="route-item">
                <div class="route-info">
                    <h4>${route.name}</h4>
                    <div class="route-meta">
                        <span>${new Date(route.startTime).toLocaleDateString()} • 
                        ${route.totalDistance.toFixed(2)} km • 
                        ${route.totalPoints} points • 
                        ${route.status}</span>
                    </div>
                </div>
                <div class="route-actions">
                    <button class="btn btn-sm btn-primary" onclick="routeTracker.viewRoute('${route.id}')">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="routeTracker.exportRoute('${route.id}')">
                        <i class="fas fa-download"></i> Export
                    </button>
                    ${route.status === 'active' ? `
                        <button class="btn btn-sm btn-warning" onclick="routeTracker.stopRoute('${route.id}')">
                            <i class="fas fa-stop"></i> Stop
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    async viewRoute(routeId) {
        const routeData = await this.loadRoute(routeId);
        if (routeData) {
            this.showNotification(`Viewing route: ${routeData.name}`, 'success');
        }
    }

    async exportRoute(routeId) {
        const routeData = await this.loadRoute(routeId);
        if (routeData && window.exportManager) {
            window.exportManager.exportRoute(routeData, 'gpx');
        }
    }

    async stopRoute(routeId) {
        if (!confirm('Stop the current active route?')) return;
        
        try {
            const response = await this.apiCall(`/api/devices/${this.selectedDeviceId}/stop-route`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showNotification('Route stopped successfully', 'success');
                await this.loadDevicesAndRoutes(); // Refresh data
            }
        } catch (error) {
            this.showNotification('Error stopping route: ' + error.message, 'error');
        }
    }

    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        if (this.autoRefresh) {
            this.refreshInterval = setInterval(async () => {
                await this.loadDevicesAndRoutes();
            }, this.refreshRate);
        }
    }

    async apiCall(endpoint, options = {}) {
        // Use relative path since we're served from the same context  
        const url = '.' + endpoint;
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            }
        };
        
        return fetch(url, { ...defaultOptions, ...options });
    }

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map').setView([49.4875, 8.466], 13); // Default to Mannheim, Germany

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Add scale
        L.control.scale().addTo(this.map);

        // Initialize live tracking properties
        this.liveMarker = null;
        this.liveTrail = [];
        this.trailLayerGroup = L.layerGroup().addTo(this.map);

        console.log('Map initialized');
    }

    updateLivePosition(lat, lng, data = {}) {
        if (!this.map || !lat || !lng) return;

        // Add point to trail
        this.liveTrail.push([lat, lng]);

        // Remove old marker
        if (this.liveMarker) {
            this.map.removeLayer(this.liveMarker);
        }

        // Clear previous trail layers
        this.trailLayerGroup.clearLayers();

        // Create route polyline if we have multiple points
        if (this.liveTrail.length > 1) {
            const routeLine = L.polyline(this.liveTrail, {
                color: '#007bff',
                weight: 4,
                opacity: 0.8
            });
            this.trailLayerGroup.addLayer(routeLine);

            // Add start marker (first point)
            const startMarker = L.marker(this.liveTrail[0], {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '<div style="background-color: #28a745; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                })
            }).bindPopup('Route Start');
            this.trailLayerGroup.addLayer(startMarker);
        }

        // Create current position marker (always on top)
        this.liveMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'live-gps-marker',
                html: '<div style="background-color: #dc3545; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(220,53,69,0.5); position: relative; z-index: 1000;"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(this.map);

        // Add popup with GPS info
        const popupContent = `
            <div style="font-size: 12px;">
                <strong>Current Position</strong><br>
                📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
                ${data.speed ? `🚀 ${(data.speed * 3.6).toFixed(1)} km/h<br>` : ''}
                ${data.alt ? `⛰️ ${data.alt}m elevation<br>` : ''}
                ${data.accuracy ? `🎯 ±${Math.round(data.accuracy)}m accuracy<br>` : ''}
                🕒 ${new Date().toLocaleTimeString()}<br>
                📊 ${this.liveTrail.length} GPS points received
            </div>
        `;
        this.liveMarker.bindPopup(popupContent);

        // Auto-fit map to show entire route, but keep reasonable zoom
        if (this.liveTrail.length > 1) {
            const bounds = L.latLngBounds(this.liveTrail);
            const padding = 0.001; // Add some padding around the route
            const paddedBounds = bounds.pad(0.1);
            
            // Fit to bounds but with max zoom limit for single points
            this.map.fitBounds(paddedBounds, {
                maxZoom: 16,
                padding: [20, 20]
            });
        } else {
            // For single point, center and zoom reasonably
            this.map.setView([lat, lng], 15);
        }

        console.log(`Live position updated: ${lat}, ${lng} (${this.liveTrail.length} points total)`);
    }

    clearLiveRoute() {
        // Clear trail data
        this.liveTrail = [];
        
        // Remove live GPS marker
        if (this.liveMarker) {
            this.map.removeLayer(this.liveMarker);
            this.liveMarker = null;
        }
        
        // Remove server-loaded route polyline
        if (this.currentRoute) {
            this.map.removeLayer(this.currentRoute);
            this.currentRoute = null;
        }
        
        // Remove all markers and polylines added directly to the map
        this.map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                this.map.removeLayer(layer);
            }
        });
        
        // Clear live trail layer group
        this.trailLayerGroup.clearLayers();
        
        console.log('Route cleared');
        this.showNotification('Route cleared', 'info');
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; color: white; cursor: pointer;">×</button>
        `;

        document.getElementById('notifications').appendChild(notification);

        // Show notification
        setTimeout(() => notification.classList.add('show'), 100);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    startAutoGPSMonitoring() {
        // Don't show GPS monitor panel - using button instead

        // Start the GPS monitoring loop
        this.startGPSMonitoringLoop();

        // Update the GPS status button
        this.updateGPSStatusButton(true);

        this.showNotification('GPS monitoring started automatically', 'success');
    }

    startGPSMonitoringLoop() {
        const apiToken = this.apiToken;
        if (!apiToken) {
            console.error('No API token available for GPS monitoring');
            return;
        }

        // Clear any existing interval
        if (window.gpsMonitorInterval) {
            clearInterval(window.gpsMonitorInterval);
        }

        let lastGPSRequestCount = 0;

        // Update GPS log function
        const updateGPSLog = async () => {
            try {
                const response = await fetch('./api/debug/requests', {
                    headers: { 'Authorization': `Bearer ${apiToken}` }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                const gpsRequests = data.requests.filter(req => 
                    req.path === '/api/gps' && req.method === 'POST'
                );
                
                const logDiv = document.getElementById('inline-gps-log');
                if (gpsRequests.length !== lastGPSRequestCount) {
                    // Update map with latest GPS position
                    if (gpsRequests.length > 0) {
                        const latestRequest = gpsRequests[0];
                        if (latestRequest && latestRequest.body && latestRequest.body.lat && latestRequest.body.lng) {
                            this.updateLivePosition(
                                latestRequest.body.lat, 
                                latestRequest.body.lng, 
                                latestRequest.body
                            );
                        }
                    }
                    
                    lastGPSRequestCount = gpsRequests.length;
                    
                    // Optional: Show notification for new GPS data (remove if too noisy)
                    if (gpsRequests.length > lastGPSRequestCount) {
                        console.log(`GPS data received: ${gpsRequests.length} total points`);
                    }
                }
            } catch (error) {
                console.error('GPS monitor error:', error);
                // Update button to show error state
                this.updateGPSStatusButton(false);
            }
        };
        
        // Initial load and start interval
        updateGPSLog();
        window.gpsMonitorInterval = setInterval(updateGPSLog, 5000);
        
        console.log('GPS monitoring loop started');
    }

    updateGPSStatusButton(isActive) {
        const button = document.getElementById('gps-status-btn');
        if (button) {
            if (isActive) {
                button.className = 'btn btn-success';
                button.innerHTML = '<i class="fas fa-satellite"></i> GPS Active';
            } else {
                button.className = 'btn btn-danger';
                button.innerHTML = '<i class="fas fa-satellite"></i> GPS Stopped';
            }
        }
    }

    stopGPSMonitoring() {
        // Clear monitoring interval
        if (window.gpsMonitorInterval) {
            clearInterval(window.gpsMonitorInterval);
            window.gpsMonitorInterval = null;
        }

        // Update button state
        this.updateGPSStatusButton(false);

        // Clear live route/markers
        this.clearLiveRoute();

        console.log('GPS monitoring stopped');
        this.showNotification('GPS monitoring stopped', 'info');
    }
}

// User Interface Helper Functions
function toggleTestingTools() {
    const content = document.getElementById('testing-tools-content');
    const chevron = document.getElementById('tools-chevron');
    
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        chevron.classList.remove('fa-chevron-up');
        chevron.classList.add('fa-chevron-down');
    } else {
        content.classList.add('expanded');
        chevron.classList.remove('fa-chevron-down');
        chevron.classList.add('fa-chevron-up');
    }
}

// Token Management Functions
function setApiToken() {
    const tokenInput = document.getElementById('api-token');
    const token = tokenInput.value.trim();
    
    if (!token) {
        alert('Please enter an API token');
        return;
    }
    
    window.routeTracker.apiToken = token;
    localStorage.setItem('apiToken', token);
    window.routeTracker.initTokenUI();
    
    // Update setup display elements
    updateSetupDisplay();
    
    // Test the token by loading data
    window.routeTracker.loadDevicesAndRoutes()
        .then(() => {
            window.routeTracker.showNotification('API token set successfully', 'success');
            window.routeTracker.startAutoRefresh();
        })
        .catch((error) => {
            window.routeTracker.showNotification('Invalid API token: ' + error.message, 'error');
            clearApiToken();
        });
}

function updateSetupDisplay() {
    const endpointUrl = document.getElementById('endpoint-url');
    const displayToken = document.getElementById('display-token');
    const displayDeviceId = document.getElementById('display-device-id');
    
    if (endpointUrl) {
        endpointUrl.textContent = `${window.location.origin}/api/gps`;
    }
    
    if (displayToken && window.routeTracker.apiToken) {
        displayToken.textContent = window.routeTracker.apiToken;
    }
    
    if (displayDeviceId) {
        displayDeviceId.textContent = window.routeTracker.selectedDeviceId;
    }
}

function clearApiToken() {
    window.routeTracker.apiToken = null;
    localStorage.removeItem('apiToken');
    window.routeTracker.initTokenUI();
    
    if (window.routeTracker.refreshInterval) {
        clearInterval(window.routeTracker.refreshInterval);
    }
}

function changeDevice() {
    const deviceInput = document.getElementById('device-id');
    const deviceId = deviceInput.value.trim() || 'default-device';
    
    window.routeTracker.selectedDeviceId = deviceId;
    localStorage.setItem('selectedDeviceId', deviceId);
    
    // Update setup display
    updateSetupDisplay();
    
    // Reload data for new device
    window.routeTracker.loadDevicesAndRoutes();
    window.routeTracker.showNotification(`Switched to device: ${deviceId}`, 'success');
}

function toggleAutoRefresh() {
    window.routeTracker.autoRefresh = !window.routeTracker.autoRefresh;
    const btn = document.getElementById('auto-refresh-btn');
    
    if (window.routeTracker.autoRefresh) {
        btn.innerHTML = '<i class="fas fa-pause"></i> Pause Auto-Refresh';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-warning');
        window.routeTracker.startAutoRefresh();
    } else {
        btn.innerHTML = '<i class="fas fa-play"></i> Start Auto-Refresh';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-success');
        if (window.routeTracker.refreshInterval) {
            clearInterval(window.routeTracker.refreshInterval);
        }
    }
}

function refreshData() {
    window.routeTracker.loadDevicesAndRoutes();
    window.routeTracker.showNotification('Data refreshed', 'success');
}

function changeRefreshRate() {
    const select = document.getElementById('refresh-rate');
    window.routeTracker.refreshRate = parseInt(select.value);
    
    if (window.routeTracker.autoRefresh) {
        window.routeTracker.startAutoRefresh(); // Restart with new rate
    }
}

// Export functions 
function exportCurrentRoute() {
    const device = window.routeTracker.devices.get(window.routeTracker.selectedDeviceId);
    if (device && device.currentRoute && window.exportManager) {
        window.routeTracker.exportRoute(device.currentRoute);
    } else {
        window.routeTracker.showNotification('No active route to export', 'warning');
    }
}

function exportRoute(format) {
    exportCurrentRoute(); // Use the current route export
}

function shareRoute() {
    const device = window.routeTracker.devices.get(window.routeTracker.selectedDeviceId);
    if (device && device.currentRoute) {
        const shareUrl = `${window.location.origin}/api/routes/${device.currentRoute}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'GPS Route',
                text: 'Check out this GPS route',
                url: shareUrl
            });
        } else {
            navigator.clipboard.writeText(shareUrl).then(() => {
                window.routeTracker.showNotification('Route URL copied to clipboard', 'success');
            });
        }
    } else {
        window.routeTracker.showNotification('No route to share', 'warning');
    }
}

// Authentication UI functions (kept for compatibility)
function showLogin() {
    document.getElementById('overlay').classList.add('show');
    document.getElementById('login-form').classList.add('show');
}

function showRegister() {
    document.getElementById('overlay').classList.add('show');  
    document.getElementById('register-form').classList.add('show');
}

function closeModals() {
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('login-form').classList.remove('show');
    document.getElementById('register-form').classList.remove('show');
}

function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (window.userManager) {
        window.userManager.login(email, password);
    }
    closeModals();
}

function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    
    if (password !== confirm) {
        alert('Passwords do not match');
        return;
    }
    
    if (window.userManager) {
        window.userManager.register(name, email, password);
    }
    closeModals();
}

function logout() {
    fetch('./api/auth/logout', { method: 'POST' })
        .finally(() => { window.location.href = './login.html'; });
}

// Configuration Setup Helper
function showOverlanderSetup() {
    const setupInfo = `
📱 Overlander iPhone App Configuration:

🔗 Endpoint URL: ${window.location.origin}/api/gps
🔑 Access Token: ${window.routeTracker.apiToken || 'Set your token first!'}
🆔 Device ID: ${window.routeTracker.selectedDeviceId}

📁 Data Format Options:
• "all" - Send complete route data
• "latest" - Send only recent points  
• "owntracks" - OwnTracks compatible format

📡 HTTP Method: POST
📋 Content-Type: application/json

Example JSON payload:
{
  "deviceId": "${window.routeTracker.selectedDeviceId}",
  "routeName": "My Route",
  "lat": 49.4875,
  "lng": 8.466,
  "alt": 150,
  "speed": 25,
  "timestamp": "${new Date().toISOString()}"
}
    `;
    
    alert(setupInfo);
}

// =====================
// DEBUGGING FUNCTIONS
// =====================

// Test connectivity to server
async function testConnectivity() {
    const results = {
        timestamp: new Date().toISOString(),
        tests: []
    };
    
    try {
        // Test 1: Basic connectivity
        const connectTest = await fetch('./api/debug/connectivity');
        results.tests.push({
            name: 'Basic Connectivity',
            status: connectTest.ok ? 'PASS' : 'FAIL',
            details: connectTest.ok ? await connectTest.json() : `HTTP ${connectTest.status}`
        });
        
        // Test 2: Ping endpoint
        const pingTest = await fetch('./api/debug/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ test: 'connectivity' })
        });
        results.tests.push({
            name: 'Ping Test',
            status: pingTest.ok ? 'PASS' : 'FAIL',
            details: pingTest.ok ? await pingTest.json() : `HTTP ${pingTest.status}`
        });
        
        // Test 3: Token validation (if token available)
        const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
        if (apiToken) {
            const tokenTest = await fetch('./api/debug/status', {
                headers: { 'Authorization': `Bearer ${apiToken}` }
            });
            results.tests.push({
                name: 'Token Validation',
                status: tokenTest.ok ? 'PASS' : 'FAIL',
                details: tokenTest.ok ? 'Token valid' : `HTTP ${tokenTest.status} - Invalid token`
            });
        }
        
        // Test 4: GPS endpoint (simulated)
        if (apiToken) {
            const gpsTest = await fetch('./api/gps', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    deviceId: 'test-device',
                    lat: 49.4875,
                    lng: 8.466,
                    timestamp: new Date().toISOString(),
                    test: true
                })
            });
            results.tests.push({
                name: 'GPS Endpoint Test',
                status: gpsTest.ok ? 'PASS' : 'FAIL',
                details: gpsTest.ok ? 'GPS endpoint accepting data' : `HTTP ${gpsTest.status}`
            });
        }
        
    } catch (error) {
        results.tests.push({
            name: 'Connectivity Error',
            status: 'ERROR',
            details: error.message
        });
    }
    
    // Display results
    showConnectivityResults(results);
}

// Display connectivity test results
function showConnectivityResults(results) {
    const panel = document.getElementById('connectivity-panel');
    const container = document.getElementById('connectivity-results');
    
    if (!panel || !container) {
        console.error('Connectivity panel elements not found');
        return;
    }
    
    const resultHTML = `
        <div style="font-family: monospace; background: #f8f9fa; padding: 20px; border-radius: 8px;">
            <div style="display: flex; align-items: center; margin-bottom: 15px; padding: 10px; background: #e3f2fd; border-radius: 4px;">
                <i class="fas fa-clock" style="color: #1976d2; margin-right: 10px;"></i>
                <strong>Timestamp:</strong>&nbsp;${results.timestamp}
            </div>
            <div style="margin: 15px 0;">
                ${results.tests.map(test => `
                    <div style="margin: 10px 0; padding: 15px; background: ${test.status === 'PASS' ? '#d4edda' : test.status === 'FAIL' ? '#f8d7da' : '#fff3cd'}; border-radius: 4px; border-left: 4px solid ${test.status === 'PASS' ? '#28a745' : test.status === 'FAIL' ? '#dc3545' : '#ffc107'};">
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <i class="fas fa-${test.status === 'PASS' ? 'check-circle' : test.status === 'FAIL' ? 'times-circle' : 'exclamation-circle'}" style="color: ${test.status === 'PASS' ? '#28a745' : test.status === 'FAIL' ? '#dc3545' : '#ffc107'}; margin-right: 10px;"></i>
                            <strong>${test.name}: ${test.status}</strong>
                        </div>
                        <div style="background: rgba(255,255,255,0.7); padding: 8px; border-radius: 3px; font-size: 11px; max-height: 120px; overflow-y: auto;">
                            ${typeof test.details === 'object' ? JSON.stringify(test.details, null, 2) : test.details}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="padding: 10px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
                <small style="color: #856404;">
                    <i class="fas fa-lightbulb"></i> If tests fail, check your network connection and token configuration.
                </small>
            </div>
        </div>
    `;
    
    container.innerHTML = resultHTML;
    panel.style.display = 'block';
    
    // Scroll panel into view
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Debug function to check token status
function debugTokenStatus() {
    console.log('=== TOKEN DEBUG ===');
    console.log('window.routeTracker exists:', !!window.routeTracker);
    console.log('window.routeTracker.apiToken:', window.routeTracker?.apiToken ? window.routeTracker.apiToken.substring(0, 10) + '...' : 'none');
    console.log('localStorage apiToken:', localStorage.getItem('apiToken') ? localStorage.getItem('apiToken').substring(0, 10) + '...' : 'none');
    console.log('==================');
}

// View incoming requests and debug data
async function showDebugPanel() {
    // Ensure we have an API token
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    if (!apiToken) {
        alert('Please set an API token first to view debug information.');
        return;
    }
    
    console.log('Debug panel - using token:', apiToken ? apiToken.substring(0, 10) + '...' : 'none');
    
    try {
        // Get debug data from server
        const [requestsRes, statusRes, devicesRes] = await Promise.all([
            fetch('./api/debug/requests', { headers: { 'Authorization': `Bearer ${apiToken}` } }),
            fetch('./api/debug/status', { headers: { 'Authorization': `Bearer ${apiToken}` } }),
            fetch('./api/debug/devices', { headers: { 'Authorization': `Bearer ${apiToken}` } })
        ]);
        
        // Check if all requests succeeded
        if (!requestsRes.ok || !statusRes.ok || !devicesRes.ok) {
            throw new Error(`API calls failed: requests:${requestsRes.status}, status:${statusRes.status}, devices:${devicesRes.status}`);
        }
        
        const requests = await requestsRes.json();
        const status = await statusRes.json();
        const devices = await devicesRes.json();
        
        // Validate response structure
        if (!requests || !status || !devices) {
            throw new Error('Invalid response structure from debug APIs');
        }
        if (!devices.devices) {
            throw new Error('Invalid devices response structure');
        }
        
        // Build devices HTML separately to avoid nested template literals
        let devicesHTML = '<p>No devices found. Send GPS data to create a device.</p>';
        if (devices && devices.devices && Array.isArray(devices.devices) && devices.devices.length > 0) {
            devicesHTML = devices.devices.map(device => {
                const statusColor = device.hasActiveRoute ? '#28a745' : '#6c757d';
                const statusText = device.hasActiveRoute ? 'Active Route' : 'Inactive';
                const lastUpdate = device.lastUpdate ? new Date(device.lastUpdate).toLocaleString() : 'Never';
                
                return '<div style="margin: 10px 0; padding: 10px; background: white; border-radius: 4px; border-left: 4px solid ' + statusColor + ';">' +
                    '<strong>' + (device.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</strong> (' + (device.deviceId || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + ')<br>' +
                    '<small>Points: ' + (device.totalPoints || 0) + ' | Routes: ' + (device.routeCount || 0) + ' | ' + 
                    'Last update: ' + lastUpdate + ' | Status: ' + statusText + '</small>' +
                    '</div>';
            }).join('');
        }
        
        // Build requests HTML separately
        let requestsHTML = '<p>No requests logged yet.</p>';
        if (requests && requests.requests && Array.isArray(requests.requests) && requests.requests.length > 0) {
            requestsHTML = requests.requests.slice(0, 10).map(req => {
                const methodColor = req.method === 'POST' ? '#007bff' : '#28a745';
                const bodyHTML = req.body ? '<div style="background: #f8f9fa; padding: 5px; border-radius: 3px; margin-top: 5px; max-height: 100px; overflow-y: auto;"><pre>' + JSON.stringify(req.body, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '</pre></div>' : '';
                const queryHTML = Object.keys(req.query).length > 0 ? '<div style="color: #6c757d; margin-top: 5px;">Query: ' + JSON.stringify(req.query).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '</div>' : '';
                
                return '<div style="margin: 10px 0; padding: 10px; background: white; border-radius: 4px; font-family: monospace; font-size: 12px; border-left: 4px solid ' + methodColor + ';">' +
                    '<div style="margin-bottom: 5px;">' +
                    '<strong>' + (req.method || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + ' ' + (req.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</strong> ' +
                    '<span style="float: right; color: #6c757d;">' + new Date(req.timestamp).toLocaleTimeString() + '</span>' +
                    '</div>' +
                    bodyHTML + queryHTML +
                    '</div>';
            }).join('');
        }
        
        // Create debug panel HTML using string concatenation
        const debugHTML = 
            '<div style="font-family: Arial, sans-serif;">' +
                '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">' +
                    '<div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">' +
                        '<h3>📊 System Status</h3>' +
                        '<ul style="margin: 0; padding-left: 20px;">' +
                            '<li><strong>Status:</strong> ' + (status.status || 'Unknown') + '</li>' +
                            '<li><strong>Uptime:</strong> ' + Math.floor((status.uptime || 0) / 3600) + 'h ' + Math.floor(((status.uptime || 0) % 3600) / 60) + 'm</li>' +
                            '<li><strong>Devices:</strong> ' + ((status.data && status.data.devices) || 0) + '</li>' +
                            '<li><strong>Routes:</strong> ' + ((status.data && status.data.routes) || 0) + '</li>' +
                            '<li><strong>Tokens:</strong> ' + ((status.data && status.data.tokens) || 0) + '</li>' +
                            '<li><strong>Request logs:</strong> ' + ((status.data && status.data.requestLogs) || 0) + '</li>' +
                        '</ul>' +
                    '</div>' +
                    
                    '<div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">' +
                        '<h3>📡 Recent Activity</h3>' +
                        '<ul style="margin: 0; padding-left: 20px;">' +
                            '<li><strong>Last request:</strong> ' + ((status.recentActivity && status.recentActivity.lastRequest) || 'None') + '</li>' +
                            '<li><strong>Last GPS data:</strong> ' + ((status.recentActivity && status.recentActivity.lastGpsData) || 'None') + '</li>' +
                            '<li><strong>Requests/hour:</strong> ' + ((status.recentActivity && status.recentActivity.requestsInLastHour) || 0) + '</li>' +
                        '</ul>' +
                    '</div>' +
                '</div>' +
                
                '<div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">' +
                    '<h3>📱 Devices (' + (devices && devices.devices ? devices.devices.length : 0) + ')</h3>' +
                    devicesHTML +
                '</div>' +
                
                '<div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">' +
                    '<h3>📥 Recent Requests (Last ' + (requests && requests.requests ? Math.min(requests.requests.length, 10) : 0) + ')</h3>' +
                    requestsHTML +
                '</div>' +
            '</div>';
        
        // Display in inline panel instead of popup
        const panel = document.getElementById('system-debug-panel');
        const container = document.getElementById('debug-panel-content');
        
        if (panel && container) {
            container.innerHTML = debugHTML;
            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            console.error('Debug panel elements not found');
        }
        
    } catch (error) {
        alert('Error loading debug panel: ' + error.message);
        console.error('Debug panel error:', error);
    }
}

// Monitor GPS data in real-time
// Global variable to track GPS monitoring state
let gpsMonitorInterval = null;
let lastGPSRequestCount = 0;

function startGPSMonitor() {
    // Ensure we have an API token
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    if (!apiToken) {
        alert('Please set an API token first to monitor GPS data.');
        return;
    }
    
    // Show the GPS monitor panel
    const panel = document.getElementById('gps-monitor-panel');
    const container = document.getElementById('gps-monitor-content');
    
    if (!panel || !container) {
        console.error('GPS monitor panel elements not found');
        return;
    }
    
    // Initialize the monitor display
    container.innerHTML = `
        <div style="text-align: center; padding: 15px; background: #d4edda; border-radius: 4px; margin-bottom: 20px;">
            <i class="fas fa-satellite"></i> Ready to monitor GPS data... (Updates every 5 seconds)
        </div>
        <div id="inline-gps-log">
            <div style="padding: 20px; text-align: center; color: #6c757d;">
                <i class="fas fa-satellite fa-2x" style="margin-bottom: 10px;"></i><br>
                No GPS data received yet. Send data from your device to see it here.
            </div>
        </div>
    `;
    
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Toggle GPS monitoring function
function toggleGPSMonitor() {
    const button = document.getElementById('gps-monitor-toggle');
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    
    if (!apiToken) {
        alert('Please set an API token first to monitor GPS data.');
        return;
    }
    
    if (gpsMonitorInterval) {
        // Stop monitoring
        clearInterval(gpsMonitorInterval);
        gpsMonitorInterval = null;
        
        button.innerHTML = '<i class="fas fa-play"></i> Start Monitoring';
        button.className = 'btn btn-sm btn-success';
        
        document.getElementById('inline-gps-log').innerHTML = `
            <div style="padding: 20px; text-align: center; color: #6c757d;">
                <i class="fas fa-pause-circle fa-2x" style="margin-bottom: 10px;"></i><br>
                GPS monitoring stopped. Click "Start Monitoring" to resume.
            </div>
        `;
    } else {
        // Start monitoring
        button.innerHTML = '<i class="fas fa-stop"></i> Stop Monitoring';
        button.className = 'btn btn-sm btn-danger';
        
        // Update GPS log function
        const updateGPSLog = async () => {
            try {
                const response = await fetch('./api/debug/requests', {
                    headers: { 'Authorization': `Bearer ${apiToken}` }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                const gpsRequests = data.requests.filter(req => 
                    req.path === '/api/gps' && req.method === 'POST'
                );
                
                const logDiv = document.getElementById('inline-gps-log');
                if (logDiv && gpsRequests.length !== lastGPSRequestCount) {
                    if (gpsRequests.length === 0) {
                        logDiv.innerHTML = `
                            <div style="padding: 20px; text-align: center; color: #6c757d;">
                                <i class="fas fa-satellite fa-2x" style="margin-bottom: 10px;"></i><br>
                                Monitoring active... No GPS data received yet.
                            </div>
                        `;
                    } else {
                        // Update map with latest GPS position
                        const latestRequest = gpsRequests[0];
                        if (latestRequest && latestRequest.body && latestRequest.body.lat && latestRequest.body.lng) {
                            window.routeTracker.updateLivePosition(
                                latestRequest.body.lat, 
                                latestRequest.body.lng, 
                                latestRequest.body
                            );
                        }
                        
                        logDiv.innerHTML = gpsRequests.slice(0, 10).map(req => {
                            const body = req.body || {};
                            const timestamp = new Date(req.timestamp).toLocaleString();
                            
                            return `
                                <div style="margin: 10px 0; padding: 15px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #007bff;">
                                    <div style="color: #6c757d; font-size: 12px; margin-bottom: 5px;">
                                        <i class="fas fa-clock"></i> ${timestamp}
                                    </div>
                                    <div style="font-family: monospace; margin: 5px 0;">
                                        <div style="margin-bottom: 5px;">
                                            <i class="fas fa-map-marker-alt" style="color: #dc3545;"></i> 
                                            <strong>Lat:</strong> ${body.lat || 'N/A'}, 
                                            <strong>Lng:</strong> ${body.lng || 'N/A'}
                                        </div>
                                        <div style="font-size: 11px; color: #6c757d;">
                                            <i class="fas fa-mobile-alt"></i> ${body.deviceId || 'Unknown Device'}
                                            ${body.speed ? `&nbsp;•&nbsp;<i class="fas fa-tachometer-alt"></i> ${(body.speed * 3.6).toFixed(1)} km/h` : ''}
                                            ${body.alt ? `&nbsp;•&nbsp;<i class="fas fa-mountain"></i> ${body.alt}m` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                    
                    lastGPSRequestCount = gpsRequests.length;
                }
            } catch (error) {
                console.error('GPS monitor error:', error);
                const logDiv = document.getElementById('inline-gps-log');
                if (logDiv) {
                    logDiv.innerHTML = `
                        <div style="padding: 15px; background: #f8d7da; border-radius: 4px; color: #721c24; text-align: center;">
                            <i class="fas fa-exclamation-triangle"></i> Error loading GPS data: ${error.message}
                        </div>
                    `;
                }
            }
        };
        
        // Initial load and start interval
        updateGPSLog();
        gpsMonitorInterval = setInterval(updateGPSLog, 5000);
    }
}

// Helper functions for panel management
function hidePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.style.display = 'none';
    }
    
    // Stop GPS monitoring if closing GPS panel
    if (panelId === 'gps-monitor-panel' && gpsMonitorInterval) {
        clearInterval(gpsMonitorInterval);
        gpsMonitorInterval = null;
        
        const button = document.getElementById('gps-monitor-toggle');
        if (button) {
            button.innerHTML = '<i class="fas fa-play"></i> Start Monitoring';
            button.className = 'btn btn-sm btn-success';
        }
    }
}

// Refresh debug panel function
function refreshDebugPanel() {
    showDebugPanel();
}

// =====================
// GPS CLIENT FUNCTIONS
// =====================

// Global variables for GPS client
let gpsClientInterval = null;
let gpsClientWatchId = null;

// Toggle GPS sender function
function toggleGPSSender() {
    const button = document.getElementById('gps-sender-btn');
    const statusPanel = document.getElementById('gps-client-status');
    const statusContent = document.getElementById('gps-status-content');
    
    // Debug token retrieval
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    console.log('GPS Client - Token check:', {
        'window.routeTracker exists': !!window.routeTracker,
        'window.routeTracker.apiToken': window.routeTracker?.apiToken ? 'EXISTS' : 'NOT_SET',
        'localStorage apiToken': localStorage.getItem('apiToken') ? 'EXISTS' : 'NOT_SET',
        'final token': apiToken ? apiToken.substring(0, 10) + '...' : 'NONE'
    });
    
    if (!apiToken) {
        alert('Please set an API token first to send GPS data. Click "Set Token" and enter: default-token-123');
        return;
    }
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by this browser.');
        return;
    }
    
    if (gpsClientInterval) {
        // Stop GPS sending
        clearInterval(gpsClientInterval);
        gpsClientInterval = null;
        
        if (gpsClientWatchId) {
            navigator.geolocation.clearWatch(gpsClientWatchId);
            gpsClientWatchId = null;
        }
        
        button.innerHTML = '<i class="fas fa-play"></i> Start Sending GPS';
        button.className = 'btn btn-success';
        
        statusContent.innerHTML = 'GPS sending stopped. Click "Start Sending GPS" to resume.';
        statusPanel.style.display = 'block';
    } else {
        // Start GPS sending
        button.innerHTML = '<i class="fas fa-stop"></i> Stop Sending GPS';
        button.className = 'btn btn-danger';
        
        statusContent.innerHTML = `
            <div style="color: #17a2b8;">
                <i class="fas fa-spinner fa-spin"></i> Starting GPS tracking... Please allow location access.
            </div>
            <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                Using token: ${apiToken.substring(0, 15)}...
            </div>
        `;
        statusPanel.style.display = 'block';
        
        let sendCount = 0;
        
        // Watch position with high accuracy
        gpsClientWatchId = navigator.geolocation.watchPosition(
            async (position) => {
                sendCount++;
                
                const gpsData = {
                    deviceId: `web-client-${window.routeTracker?.selectedDeviceId || 'default'}`,
                    routeName: `Web Client Route ${new Date().toDateString()}`,
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    timestamp: new Date().toISOString(),
                    speed: position.coords.speed || 0,
                    alt: position.coords.altitude || 0,
                    accuracy: position.coords.accuracy,
                    source: 'web-gps-client'
                };
                
                console.log('Sending GPS data:', gpsData);
                console.log('Using token:', apiToken.substring(0, 15) + '...');
                
                try {
                    const response = await fetch('./api/gps', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(gpsData)
                    });
                    
                    console.log('GPS API response:', response.status, response.statusText);
                    
                    if (response.ok) {
                        const result = await response.json();
                        console.log('GPS API success:', result);
                        
                        statusContent.innerHTML = `
                            <div style="color: #28a745;">
                                <i class="fas fa-check-circle"></i> GPS data sent successfully! 
                            </div>
                            <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                                Sent ${sendCount} updates | Last: ${new Date().toLocaleTimeString()}<br>
                                📍 ${gpsData.lat.toFixed(6)}, ${gpsData.lng.toFixed(6)}<br>
                                🎯 Accuracy: ${Math.round(gpsData.accuracy)}m
                                ${gpsData.speed > 0 ? ` | 🚀 ${(gpsData.speed * 3.6).toFixed(1)} km/h` : ''}<br>
                                📊 Route: ${result.routeId} | Points: ${result.totalPoints}
                            </div>
                        `;
                    } else {
                        const errorText = await response.text();
                        console.error('GPS API error:', response.status, errorText);
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }
                } catch (error) {
                    console.error('GPS send error:', error);
                    statusContent.innerHTML = `
                        <div style="color: #dc3545;">
                            <i class="fas fa-exclamation-triangle"></i> Error sending GPS data: ${error.message}
                        </div>
                        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                            Check console for details. Try refreshing the page and setting token again.
                        </div>
                    `;
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                statusContent.innerHTML = `
                    <div style="color: #dc3545;">
                        <i class="fas fa-exclamation-triangle"></i> GPS Error: ${error.message}
                    </div>
                    <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                        Please enable location services and try again.
                    </div>
                `;
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );
    }
}

// Send single GPS location
function sendSingleGPS() {
    const statusPanel = document.getElementById('gps-client-status');
    const statusContent = document.getElementById('gps-status-content');
    
    // Debug token retrieval
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    console.log('Single GPS - Token check:', {
        'window.routeTracker exists': !!window.routeTracker,
        'final token': apiToken ? apiToken.substring(0, 10) + '...' : 'NONE'
    });
    
    if (!apiToken) {
        alert('Please set an API token first to send GPS data. Click "Set Token" and enter: default-token-123');
        return;
    }
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by this browser.');
        return;
    }
    
    statusContent.innerHTML = `
        <div style="color: #17a2b8;">
            <i class="fas fa-spinner fa-spin"></i> Getting current location...
        </div>
        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
            Using token: ${apiToken.substring(0, 15)}...
        </div>
    `;
    statusPanel.style.display = 'block';
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const gpsData = {
                deviceId: `web-single-${window.routeTracker?.selectedDeviceId || 'default'}`,
                routeName: `Single Location ${new Date().toLocaleString()}`,
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                timestamp: new Date().toISOString(),
                speed: position.coords.speed || 0,
                alt: position.coords.altitude || 0,
                accuracy: position.coords.accuracy,
                source: 'web-single-gps'
            };
            
            console.log('Sending single GPS:', gpsData);
            
            try {
                const response = await fetch('./api/gps', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(gpsData)
                });
                
                console.log('Single GPS response:', response.status, response.statusText);
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('Single GPS success:', result);
                    
                    statusContent.innerHTML = `
                        <div style="color: #28a745;">
                            <i class="fas fa-check-circle"></i> Single GPS location sent successfully!
                        </div>
                        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                            📍 ${gpsData.lat.toFixed(6)}, ${gpsData.lng.toFixed(6)}<br>
                            🎯 Accuracy: ${Math.round(gpsData.accuracy)}m<br>
                            🕐 ${new Date().toLocaleString()}<br>
                            📊 Route: ${result.routeId} | Points: ${result.totalPoints}
                        </div>
                    `;
                } else {
                    const errorText = await response.text();
                    console.error('Single GPS error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
            } catch (error) {
                console.error('Single GPS send error:', error);
                statusContent.innerHTML = `
                    <div style="color: #dc3545;">
                        <i class="fas fa-exclamation-triangle"></i> Error sending GPS data: ${error.message}
                    </div>
                    <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                        Check console for details. Try refreshing the page and setting token again.
                    </div>
                `;
            }
        },
        (error) => {
            console.error('Single GPS geolocation error:', error);
            statusContent.innerHTML = `
                <div style="color: #dc3545;">
                    <i class="fas fa-exclamation-triangle"></i> GPS Error: ${error.message}
                </div>
                <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                    Please enable location services and try again.
                </div>
            `;
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

// Send fake GPS location for testing
function sendFakeGPS() {
    const statusPanel = document.getElementById('gps-client-status');
    const statusContent = document.getElementById('gps-status-content');
    
    // Debug token retrieval
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    console.log('Fake GPS - Token check:', {
        'window.routeTracker exists': !!window.routeTracker,
        'final token': apiToken ? apiToken.substring(0, 10) + '...' : 'NONE'
    });
    
    if (!apiToken) {
        alert('Please set an API token first to send GPS data. Click "Set Token" and enter: default-token-123');
        return;
    }
    
    // Generate random coordinates around Mannheim, Germany (default map center)
    const baseLat = 49.4875;
    const baseLng = 8.466;
    const randomOffset = 0.01; // ~1km radius
    
    const fakeGpsData = {
        deviceId: `web-fake-${window.routeTracker?.selectedDeviceId || 'default'}`,
        routeName: `Test Route ${new Date().toDateString()}`,
        lat: baseLat + (Math.random() - 0.5) * randomOffset,
        lng: baseLng + (Math.random() - 0.5) * randomOffset,
        timestamp: new Date().toISOString(),
        speed: Math.random() * 15, // 0-15 m/s (0-54 km/h)
        alt: 100 + Math.random() * 50, // 100-150m elevation
        accuracy: 5 + Math.random() * 10, // 5-15m accuracy
        source: 'web-fake-gps'
    };
    
    statusContent.innerHTML = `
        <div style="color: #17a2b8;">
            <i class="fas fa-spinner fa-spin"></i> Sending test GPS location...
        </div>
        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
            Using token: ${apiToken.substring(0, 15)}...
        </div>
    `;
    statusPanel.style.display = 'block';
    
    console.log('Sending fake GPS:', fakeGpsData);
    
    fetch('./api/gps', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(fakeGpsData)
    })
    .then(response => {
        console.log('Fake GPS response:', response.status, response.statusText);
        
        if (response.ok) {
            return response.json().then(result => {
                console.log('Fake GPS success:', result);
                
                statusContent.innerHTML = `
                    <div style="color: #28a745;">
                        <i class="fas fa-check-circle"></i> Test GPS location sent successfully!
                    </div>
                    <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                        📍 ${fakeGpsData.lat.toFixed(6)}, ${fakeGpsData.lng.toFixed(6)}<br>
                        🚀 Speed: ${(fakeGpsData.speed * 3.6).toFixed(1)} km/h<br>
                        ⛰️ Altitude: ${Math.round(fakeGpsData.alt)}m<br>
                        🕐 ${new Date().toLocaleString()}<br>
                        📊 Route: ${result.routeId} | Points: ${result.totalPoints}
                    </div>
                `;
            });
        } else {
            return response.text().then(errorText => {
                console.error('Fake GPS error:', response.status, errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            });
        }
    })
    .catch(error => {
        console.error('Fake GPS send error:', error);
        statusContent.innerHTML = `
            <div style="color: #dc3545;">
                <i class="fas fa-exclamation-triangle"></i> Error sending test GPS: ${error.message}
            </div>
            <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                Check console for details. Try refreshing the page and setting token again.
            </div>
        `;
    });
}

// Send random GPS location within 1km of actual position
function sendRandomNearbyGPS() {
    const statusPanel = document.getElementById('gps-client-status');
    const statusContent = document.getElementById('gps-status-content');
    
    // Debug token retrieval
    const apiToken = window.routeTracker?.apiToken || localStorage.getItem('apiToken');
    console.log('Random Nearby GPS - Token check:', {
        'window.routeTracker exists': !!window.routeTracker,
        'final token': apiToken ? apiToken.substring(0, 10) + '...' : 'NONE'
    });
    
    if (!apiToken) {
        alert('Please set an API token first to send GPS data. Click "Set Token" and enter: default-token-123');
        return;
    }
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by this browser. Using default location.');
        // Fall back to default location
        sendRandomAroundCoordinates(49.4875, 8.466, 'default location');
        return;
    }
    
    statusContent.innerHTML = `
        <div style="color: #17a2b8;">
            <i class="fas fa-spinner fa-spin"></i> Getting your location for random nearby GPS...
        </div>
        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
            Using token: ${apiToken.substring(0, 15)}...
        </div>
    `;
    statusPanel.style.display = 'block';
    
    // Get current position first
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Use actual position as base for random coordinates
            console.log('Got actual position:', position.coords.latitude, position.coords.longitude);
            sendRandomAroundCoordinates(
                position.coords.latitude, 
                position.coords.longitude, 
                'your location'
            );
        },
        (error) => {
            console.log('Geolocation error, using default location:', error);
            // Fall back to default location if geolocation fails
            statusContent.innerHTML = `
                <div style="color: #f39c12;">
                    <i class="fas fa-exclamation-circle"></i> Could not get your location, using default area...
                </div>
            `;
            setTimeout(() => {
                sendRandomAroundCoordinates(49.4875, 8.466, 'default location (Mannheim, Germany)');
            }, 1000);
        },
        {
            enableHighAccuracy: false, // Don't need high accuracy for this
            timeout: 5000,
            maximumAge: 300000 // 5 minutes
        }
    );
    
    // Helper function to send random coordinates around a base position
    function sendRandomAroundCoordinates(baseLat, baseLng, locationName) {
        // Generate random coordinates within ~1km radius
        // 1km ≈ 0.009 degrees latitude, 0.011 degrees longitude (at ~50° latitude)
        const latOffset = 0.009; 
        const lngOffset = 0.011;
        
        // Generate random point within circular area (not just square)
        const angle = Math.random() * 2 * Math.PI;
        const radius = Math.random(); // 0-1 for uniform distribution in circle
        const distance = Math.sqrt(radius); // Square root for uniform area distribution
        
        const randomLat = baseLat + (distance * Math.cos(angle) * latOffset);
        const randomLng = baseLng + (distance * Math.sin(angle) * lngOffset);
        
        const randomGpsData = {
            deviceId: `web-random-${window.routeTracker?.selectedDeviceId || 'default'}`,
            routeName: `Random Route ${new Date().toDateString()}`,
            lat: randomLat,
            lng: randomLng,
            timestamp: new Date().toISOString(),
            speed: Math.random() * 20, // 0-20 m/s (0-72 km/h)
            alt: 80 + Math.random() * 100, // 80-180m elevation
            accuracy: 3 + Math.random() * 12, // 3-15m accuracy
            source: 'web-random-nearby-gps'
        };
        
        console.log('Sending random nearby GPS:', randomGpsData);
        console.log(`Base location was: ${baseLat.toFixed(6)}, ${baseLng.toFixed(6)} (${locationName})`);
        console.log(`Random offset: ${((randomLat - baseLat) * 111000).toFixed(0)}m north, ${((randomLng - baseLng) * 111000 * Math.cos(baseLat * Math.PI / 180)).toFixed(0)}m east`);
        
        fetch('./api/gps', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(randomGpsData)
        })
        .then(response => {
            console.log('Random GPS response:', response.status, response.statusText);
            
            if (response.ok) {
                return response.json().then(result => {
                    console.log('Random GPS success:', result);
                    
                    // Calculate distance from base
                    const distanceMeters = Math.round(
                        Math.sqrt(
                            Math.pow((randomLat - baseLat) * 111000, 2) + 
                            Math.pow((randomLng - baseLng) * 111000 * Math.cos(baseLat * Math.PI / 180), 2)
                        )
                    );
                    
                    statusContent.innerHTML = `
                        <div style="color: #28a745;">
                            <i class="fas fa-check-circle"></i> Random nearby GPS sent successfully!
                        </div>
                        <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                            📍 ${randomGpsData.lat.toFixed(6)}, ${randomGpsData.lng.toFixed(6)}<br>
                            📏 ${distanceMeters}m from ${locationName}<br>
                            🚀 Speed: ${(randomGpsData.speed * 3.6).toFixed(1)} km/h<br>
                            ⛰️ Altitude: ${Math.round(randomGpsData.alt)}m<br>
                            🕐 ${new Date().toLocaleString()}<br>
                            📊 Route: ${result.routeId} | Points: ${result.totalPoints}
                        </div>
                    `;
                });
            } else {
                return response.text().then(errorText => {
                    console.error('Random GPS error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                });
            }
        })
        .catch(error => {
            console.error('Random GPS send error:', error);
            statusContent.innerHTML = `
                <div style="color: #dc3545;">
                    <i class="fas fa-exclamation-triangle"></i> Error sending random GPS: ${error.message}
                </div>
                <div style="font-size: 12px; margin-top: 5px; color: #6c757d;">
                    Check console for details. Try refreshing the page and setting token again.
                </div>
            `;
        });
    }
}

// Clear live GPS route function
function clearLiveRoute() {
    if (window.routeTracker && window.routeTracker.clearLiveRoute) {
        window.routeTracker.clearLiveRoute();
    } else {
        console.error('Route tracker not available');
        alert('Route tracker not available');
    }
}

// Toggle GPS monitoring function
function toggleGPSMonitoring() {
    if (window.routeTracker) {
        if (window.gpsMonitorInterval) {
            // Stop monitoring
            window.routeTracker.stopGPSMonitoring();
        } else {
            // Start monitoring
            window.routeTracker.startAutoGPSMonitoring();
        }
    } else {
        console.error('Route tracker not available');
        alert('Route tracker not available');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Ensure overlay is hidden on startup
    closeModals();
    
    window.routeTracker = new RouteTracker();
    
    // Update setup display with current values
    setTimeout(() => {
        updateSetupDisplay();
    }, 100);
});

console.log('Route Tracker GPS Receiver script loaded - Debug functions available');