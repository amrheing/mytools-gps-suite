// Main Route Tracker Application - GPS Data Receiver
class RouteTracker {
    constructor() {
        this.map = null;
        this.currentRoute = null;
        this.activeRoutes = new Map(); // Store multiple device routes
        this.devices = new Map(); // Store device information
        this.refreshInterval = null;
        this.apiToken = null; // no longer used for web UI
        this.selectedDeviceId = localStorage.getItem('selectedDeviceId') || 'default-device';
        this.autoRefresh = true;
        this.refreshRate = 5000; // 5 seconds default
        
        // Initialize the application
        this.init();
    }

    async init() {
        try {
            // Check for share token in URL first
            const urlParams = new URLSearchParams(window.location.search);
            const shareToken = urlParams.get('share');

            let authRes = await fetch('./api/auth/me');

            // If not authenticated but a share token is present, try share auth
            if (!authRes.ok && shareToken) {
                const shareRes = await fetch('./api/auth/share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shareId: shareToken })
                });
                if (shareRes.ok) {
                    authRes = await fetch('./api/auth/me');
                }
            }

            if (!authRes.ok) {
                // Save current URL so login can redirect back (e.g. shared route link)
                sessionStorage.setItem('redirectAfterLogin', window.location.href);
                window.location.href = './login.html';
                return;
            }
            const me = await authRes.json();

            // Use the username from session for display
            if (me.role === 'admin') {
                const adminLink = document.getElementById('admin-link');
                if (adminLink) adminLink.style.display = 'inline-flex';
            }

            // Apply role class to body for CSS-based UI filtering
            document.body.classList.add('role-' + me.role);

            // Initialize map
            this.initMap();
            
            // Initialize user management
            if (window.userManager) {
                window.userManager.init();
            }
            
            // Show main app immediately (no token gate)
            const mainApp = document.getElementById('main-app');
            if (mainApp) mainApp.style.display = 'block';

            // Set OwnTracks endpoint URL in config section (admin only)
            const epEl = document.getElementById('endpoint-url');
            if (epEl) epEl.textContent = window.location.origin + '/route-tracker/api/gps';
            
            await this.loadAndPopulateDevices();
            this.setupDeviceSelector();
            await this.loadDevicesAndRoutes();
            this.startAutoRefresh();

                // If a shared route link was used, load that route directly
                const urlParams2 = new URLSearchParams(window.location.search);
                const sharedRoute = urlParams2.get('route') || (me.role === 'share' ? me.shareRouteId : null);
                if (sharedRoute) {
                    await this.loadRoute(sharedRoute);
                    this.showNotification('Loaded shared route', 'success');
                }
                
                // Auto-start GPS monitoring
                try {
                    this.startAutoGPSMonitoring();
                    console.log('GPS monitoring started automatically');
                } catch (error) {
                    console.error('Failed to auto-start GPS monitoring:', error);
                }
            
            console.log('Route Tracker GPS Receiver initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Route Tracker:', error);
            this.showNotification('Failed to initialize: ' + error.message, 'error');
        }
    }

    async loadAndPopulateDevices() {
        try {
            const response = await this.apiCall(`/api/devices`);
            if (response.ok) {
                const devices = await response.json();
                // Populate both selectors (admin controls panel + viewer panel)
                ['device-selector', 'device-selector-viewer'].forEach(id => {
                    const selector = document.getElementById(id);
                    if (!selector) return;
                    selector.innerHTML = '';
                    devices.forEach(device => {
                        const option = document.createElement('option');
                        option.value = device.id;
                        option.textContent = device.name || device.id;
                        selector.appendChild(option);
                    });
                });
                // If cached device isn't in the allowed list, fall back to first available
                const ids = devices.map(d => d.id);
                if (!ids.includes(this.selectedDeviceId) && ids.length > 0) {
                    this.selectedDeviceId = ids[0];
                    localStorage.setItem('selectedDeviceId', this.selectedDeviceId);
                }
                const s1 = document.getElementById('device-selector');
                const s2 = document.getElementById('device-selector-viewer');
                if (s1) s1.value = this.selectedDeviceId;
                if (s2) s2.value = this.selectedDeviceId;
            }
        } catch (error) {
            console.error('Error loading devices:', error);
            this.showNotification('Error loading device list: ' + error.message, 'error');
        }
    }

    onDeviceSelectorChange(value) {
        this.selectedDeviceId = value;
        localStorage.setItem('selectedDeviceId', value);
        // Keep both selectors in sync
        const s1 = document.getElementById('device-selector');
        const s2 = document.getElementById('device-selector-viewer');
        if (s1) s1.value = value;
        if (s2) s2.value = value;
        this.showNotification(`Switched to device: ${value}`, 'info');
        this.loadDevicesAndRoutes();
    }

    setupDeviceSelector() {
        const handler = (event) => this.onDeviceSelectorChange(event.target.value);
        const s1 = document.getElementById('device-selector');
        const s2 = document.getElementById('device-selector-viewer');
        if (s1) { s1.removeEventListener('change', s1._deviceHandler); s1._deviceHandler = handler; s1.addEventListener('change', handler); }
        if (s2) { s2.removeEventListener('change', s2._deviceHandler); s2._deviceHandler = handler; s2.addEventListener('change', handler); }
    }

    async loadDevicesAndRoutes() {
        // Don't interrupt route editing with a background refresh
        if (this.editMode) return;

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
                this.currentRouteData = routeData;
                this.currentRouteId = routeId;
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
        // Exit edit mode before loading a new route
        if (this.editMode) this.exitEditMode(false);

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
                color: routeData.color || '#e74c3c',
                weight: 4,
                opacity: 0.8
            }).addTo(this.map);

            // Build data-point dots layer
            this.buildRouteDataPoints(routeData);
            
            // Add start/end markers
            const startPoint = routeData.points[0];
            const endPoint = routeData.points[routeData.points.length - 1];
            
            L.marker([startPoint.lat, startPoint.lng], {
                icon: L.divIcon({
                    className: '',
                    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
                        <div style="background:#27ae60;color:white;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.4);line-height:1.4;">START</div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#27ae60" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    </div>`,
                    iconSize: [50, 44],
                    iconAnchor: [25, 44]
                })
            })
            .bindPopup(`Start: ${routeData.name}<br>Time: ${new Date(startPoint.timestamp).toLocaleString()}`)
            .addTo(this.map);
            
            if (routeData.points.length > 1) {
                L.marker([endPoint.lat, endPoint.lng], {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
                            <div style="background:#c0392b;color:white;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.4);line-height:1.4;">END</div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#c0392b" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        </div>`,
                        iconSize: [50, 44],
                        iconAnchor: [25, 44]
                    })
                })
                .bindPopup(`Current: ${routeData.name}<br>Time: ${new Date(endPoint.timestamp).toLocaleString()}<br>Speed: ${endPoint.speed ? (endPoint.speed * 3.6).toFixed(1) + ' km/h' : 'N/A'}`)
                .addTo(this.map);
            }
            
            // Fit map to route on first load only; don't reset if user has manually panned/zoomed
            if (!this.userHasMovedMap) {
                this.map.fitBounds(latLngs, { padding: [20, 20], maxZoom: 17 });
            }
        }
    }

    buildRouteDataPoints(routeData) {
        this.dataPointsLayerGroup.clearLayers();
        if (this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }
        if (!routeData || !routeData.points) return;
        routeData.points.forEach(p => {
            const popup = `<div style="font-size:12px;">
                📍 ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}<br>
                ${p.speed !== undefined && p.speed !== null ? `🚀 ${(p.speed * 3.6).toFixed(1)} km/h<br>` : ''}
                ${p.alt !== undefined && p.alt !== null ? `⛰️ ${p.alt}m<br>` : ''}
                🕒 ${new Date(p.timestamp).toLocaleTimeString()}
            </div>`;
            L.circleMarker([p.lat, p.lng], {
                radius: 4,
                color: '#c0392b',
                fillColor: '#e74c3c',
                fillOpacity: 0.85,
                weight: 1.5
            }).bindPopup(popup).addTo(this.dataPointsLayerGroup);
        });
        if (this.showDataPoints) {
            this.dataPointsLayerGroup.addTo(this.map);
        }
    }

    // =========================================================
    // ROUTE POINT EDITING
    // =========================================================

    toggleEditMode() {
        if (this.editMode) {
            this.exitEditMode(true);
        } else {
            this.enterEditMode();
        }
    }

    enterEditMode() {
        if (!this.currentRouteData || !this.currentRouteData.points) {
            this.showNotification('Load a route first to edit its points', 'warning');
            return;
        }
        this.editMode = true;
        // Record when editing started — used to preserve GPS points that arrive during the session
        this._editSnapshotTime = this.currentRouteData.points.length > 0
            ? this.currentRouteData.points[this.currentRouteData.points.length - 1].timestamp
            : new Date().toISOString();

        // Hide regular data point dots
        if (this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }

        this.buildEditMarkers();

        // Expand map to full window and lock page scroll
        const section = document.querySelector('.map-section');
        if (section) section.classList.add('map-edit-fullscreen');
        document.body.style.overflow = 'hidden';
        this.map.invalidateSize();

        document.getElementById('edit-toolbar').style.display = 'flex';
        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-warning');
            btn.innerHTML = '<i class="fas fa-times"></i> Exit Edit';
        }
        this.showNotification('Edit mode — right-click a point to add/delete · drag to move · Esc or "Exit Edit" to leave', 'info');
    }

    exitEditMode(restorePoints = true) {
        this.editMode = false;
        this.hideEditContextMenu();

        // Remove edit markers
        this.editMarkersGroup.clearLayers();
        if (this.map.hasLayer(this.editMarkersGroup)) {
            this.map.removeLayer(this.editMarkersGroup);
        }

        // Restore read-only data points
        if (restorePoints && this.currentRouteData) {
            this.buildRouteDataPoints(this.currentRouteData);
        }

        document.getElementById('edit-toolbar').style.display = 'none';

        // Restore map to normal size and re-enable page scroll
        const section = document.querySelector('.map-section');
        if (section) section.classList.remove('map-edit-fullscreen');
        document.body.style.overflow = '';
        this.map.invalidateSize();

        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-secondary');
            btn.innerHTML = '<i class="fas fa-pencil-alt"></i> Edit Points';
        }
    }

    buildEditMarkers() {
        this.editMarkersGroup.clearLayers();
        if (this.map.hasLayer(this.editMarkersGroup)) {
            this.map.removeLayer(this.editMarkersGroup);
        }

        const points = this.currentRouteData.points;

        points.forEach((p, i) => {
            const isNew = p._new === true;
            const bg = isNew ? '#3498db' : '#e74c3c';
            const border = isNew ? '#2471a3' : '#c0392b';

            const marker = L.marker([p.lat, p.lng], {
                draggable: true,
                zIndexOffset: 500,
                icon: L.divIcon({
                    className: '',
                    html: `<div class="edit-point-dot" style="background:${bg};border-color:${border};">${isNew ? '<span class="edit-point-new">+</span>' : ''}</div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                })
            });

            // Drag → update coordinates + redraw polyline
            marker.on('dragend', (e) => {
                const ll = e.target.getLatLng();
                this.currentRouteData.points[i].lat = +ll.lat.toFixed(7);
                this.currentRouteData.points[i].lng = +ll.lng.toFixed(7);
                this.redrawEditPolyline();
            });

            // Right-click → context menu
            marker.on('contextmenu', (e) => {
                L.DomEvent.preventDefault(e.originalEvent);
                L.DomEvent.stopPropagation(e.originalEvent);
                this.showEditContextMenu(e.originalEvent, i);
            });

            this.editMarkersGroup.addLayer(marker);
        });

        this.editMarkersGroup.addTo(this.map);
        this.redrawEditPolyline();
    }

    redrawEditPolyline() {
        if (this.currentRoute && this.currentRouteData) {
            this.currentRoute.setLatLngs(
                this.currentRouteData.points.map(p => [p.lat, p.lng])
            );
        }
    }

    showEditContextMenu(event, pointIndex) {
        const menu = document.getElementById('route-context-menu');
        if (!menu) return;
        // Position near cursor but keep inside viewport
        const x = Math.min(event.clientX, window.innerWidth - 180);
        const y = Math.min(event.clientY, window.innerHeight - 90);
        menu.style.left = x + window.scrollX + 'px';
        menu.style.top  = y + window.scrollY + 'px';
        menu.style.display = 'block';
        menu.dataset.pointIndex = pointIndex;
        event.preventDefault();
    }

    hideEditContextMenu() {
        const menu = document.getElementById('route-context-menu');
        if (menu) menu.style.display = 'none';
    }

    contextMenuAddAfter() {
        this.hideEditContextMenu();
        const menu = document.getElementById('route-context-menu');
        const i = parseInt(menu.dataset.pointIndex);
        const pts = this.currentRouteData.points;

        let newPt;
        if (i < pts.length - 1) {
            // Midpoint between i and i+1
            const tA = new Date(pts[i].timestamp).getTime();
            const tB = new Date(pts[i + 1].timestamp).getTime();
            newPt = {
                lat:       +((pts[i].lat + pts[i + 1].lat) / 2).toFixed(7),
                lng:       +((pts[i].lng + pts[i + 1].lng) / 2).toFixed(7),
                timestamp: new Date((tA + tB) / 2).toISOString(),
                alt:       (pts[i].alt !== null && pts[i + 1].alt !== null)
                               ? (pts[i].alt + pts[i + 1].alt) / 2
                               : pts[i].alt,
                speed:     null,
                accuracy:  null,
                _new:      true
            };
        } else {
            // Last point — copy it with a tiny offset so it's visible
            newPt = { ...pts[i], lat: +(pts[i].lat + 0.00005).toFixed(7), _new: true };
        }

        pts.splice(i + 1, 0, newPt);
        this.buildEditMarkers();
        this.showNotification('New point added in blue — drag it to the right location', 'info');
    }

    contextMenuDelete() {
        this.hideEditContextMenu();
        const menu = document.getElementById('route-context-menu');
        const i = parseInt(menu.dataset.pointIndex);
        const pts = this.currentRouteData.points;

        if (pts.length <= 2) {
            this.showNotification('Cannot delete: route needs at least 2 points', 'warning');
            return;
        }
        pts.splice(i, 1);
        this.buildEditMarkers();
        this.showNotification('Point deleted', 'info');
    }

    async saveRouteEdits() {
        if (!this.currentRouteData || !this.currentRouteId) return;

        // Strip internal _new flags before saving
        const points = this.currentRouteData.points.map(({ _new, ...p }) => p);
        // Pass snapshot time so the server can preserve GPS points that arrived during the edit
        const editSnapshotTime = this._editSnapshotTime || null;

        try {
            const res = await this.apiCall(`/api/routes/${this.currentRouteId}/points`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points, editSnapshotTime })
            });
            if (res.ok) {
                const data = await res.json();
                this.showNotification(`Route saved — ${data.totalPoints} points, ${data.totalDistance.toFixed(2)} km`, 'success');
                await this.loadRoute(this.currentRouteId);
                this.exitEditMode(false);
            } else {
                const err = await res.json().catch(() => ({}));
                this.showNotification('Save failed: ' + (err.error || res.status), 'error');
            }
        } catch (e) {
            this.showNotification('Save failed: ' + e.message, 'error');
        }
    }

    async discardRouteEdits() {
        const id = this.currentRouteId;
        this.exitEditMode(false);
        if (id) await this.loadRoute(id);
        this.showNotification('Changes discarded', 'info');
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

        // Preserve currently checked route IDs so a background refresh doesn't lose the selection
        const previouslyChecked = new Set(
            [...document.querySelectorAll('.merge-checkbox:checked')].map(cb => cb.dataset.routeId)
        );
        
        if (routes.length === 0) {
            routeList.innerHTML = '<div class="route-item"><div class="route-info"><p>No routes received yet. Configure your Overlander app to send GPS data to this server.</p></div></div>';
            this._updateMergeButton();
            return;
        }

routeList.innerHTML = routes.map(route => {
            const start = route.startTime ? new Date(route.startTime) : null;
            const end   = route.endTime   ? new Date(route.endTime)   : null;
            const fmt = (d) => d ? d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const statusBadge = route.status === 'active'
                ? `<span style="background:#27ae60;color:#fff;font-size:0.74em;padding:1px 6px;border-radius:10px;font-weight:600;">LIVE</span>`
                : '';
            const routeColor = route.color || '#e74c3c';
            const colorDot = `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${routeColor};border:1px solid rgba(0,0,0,0.18);flex-shrink:0;margin-right:4px;vertical-align:middle;"></span>`;
            const metaParts = [
                `<i class="fas fa-hdd" style="margin-right:3px;"></i>${route.deviceId || this.selectedDeviceId}`,
                `<i class="fas fa-play" style="margin-right:3px;"></i>${fmt(start)}`,
                end ? `<i class="fas fa-stop" style="margin-right:3px;"></i>${fmt(end)}` : null,
                `<i class="fas fa-road" style="margin-right:3px;"></i>${route.totalDistance.toFixed(2)}&thinsp;km`,
                `<i class="fas fa-map-pin" style="margin-right:3px;"></i>${route.totalPoints}&thinsp;pts`,
            ].filter(Boolean).join('<span style="color:#ccc;margin:0 5px;">|</span>');
            return `
            <div class="route-item" style="border-left:4px solid ${routeColor};">
                <div class="route-item-header">
                    <label class="route-merge-check admin-only" title="Select to merge" style="margin:0;">
                        <input type="checkbox" class="merge-checkbox" data-route-id="${route.id}" data-route-name="${route.name.replace(/"/g,'&quot;')}" data-route-start="${route.startTime}" onchange="routeTracker._updateMergeButton()">
                    </label>
                    <div class="route-info" style="flex:1;min-width:0;">
                        <h4>${colorDot}${route.name} ${statusBadge}</h4>
                        <div class="route-meta">${metaParts}</div>
                    </div>
                </div>
                <div class="route-actions">
                    <button class="btn btn-sm btn-primary" onclick="routeTracker.viewRoute('${route.id}')">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="routeTracker.exportRoute('${route.id}')">
                        <i class="fas fa-download"></i> Export
                    </button>
                    <button class="btn btn-sm btn-info admin-only" onclick="routeTracker.editRoute('${route.id}', '${route.name.replace(/'/g, "\\'") }', '${route.color || '#e74c3c'}')">
                        <i class="fas fa-pencil-alt"></i> Rename
                    </button>
                    <button class="btn btn-sm btn-danger admin-only" onclick="routeTracker.deleteRoute('${route.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    ${route.status === 'active' ? `
                        <button class="btn btn-sm btn-warning admin-only" onclick="routeTracker.stopRoute('${route.id}')">
                            <i class="fas fa-stop"></i> Stop
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-success admin-only" onclick="routeTracker.activateRoute('${route.id}')" title="Set as active — GPS will append here">
                            <i class="fas fa-play"></i> Set Active
                        </button>
                    `}
                </div>
            </div>`;
        }).join('');

        // Restore checkbox selections from before the re-render
        if (previouslyChecked.size > 0) {
            document.querySelectorAll('.merge-checkbox').forEach(cb => {
                if (previouslyChecked.has(cb.dataset.routeId)) cb.checked = true;
            });
        }
        this._updateMergeButton();
    }

    _updateMergeButton() {
        const btn = document.getElementById('merge-routes-btn');
        if (!btn) return;
        const checked = document.querySelectorAll('.merge-checkbox:checked').length;
        if (checked >= 2) {
            btn.style.display = 'inline-flex';
            btn.innerHTML = `<i class="fas fa-compress-arrows-alt"></i>&nbsp;Merge ${checked} Routes`;
        } else {
            btn.style.display = 'none';
        }
    }

    async mergeSelectedRoutes() {
        const checked = [...document.querySelectorAll('.merge-checkbox:checked')];
        const routeIds = checked.map(cb => cb.dataset.routeId);
        if (routeIds.length < 2) return;

        // Find the oldest selected route's name as default
        const oldest = checked.reduce((a, b) =>
            new Date(a.dataset.routeStart) <= new Date(b.dataset.routeStart) ? a : b
        );
        const defaultName = oldest.dataset.routeName || '';

        const name = prompt('Name for merged route:', defaultName);
        if (name === null) return; // cancelled

        if (!confirm(`Merge ${routeIds.length} routes into one? This cannot be undone.`)) return;

        try {
            const response = await this.apiCall(`/api/devices/${this.selectedDeviceId}/routes/merge`, {
                method: 'POST',
                body: JSON.stringify({ routeIds, name: name.trim() })
            });
            if (response.ok) {
                const result = await response.json();
                this.showNotification(`Merged into "${result.route.name}" — ${result.route.totalPoints} pts, ${result.route.totalDistance.toFixed(2)} km`, 'success');
                await this.loadDevicesAndRoutes();
            } else {
                const err = await response.json();
                this.showNotification('Merge failed: ' + (err.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            this.showNotification('Error merging routes: ' + error.message, 'error');
        }
    }

    async viewRoute(routeId) {
        const routeData = await this.loadRoute(routeId);
        if (!routeData) return;
        // Pause auto-refresh so the history route stays on screen
        this._historyViewMode = true;
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        this._setResetBtnMode('history');
        // Load only media belonging to this route
        loadMediaMarkers(this.selectedDeviceId, routeId);
        // Zoom map to fit the loaded route
        if (this.currentRoute) {
            this.map.fitBounds(this.currentRoute.getBounds(), { padding: [30, 30], maxZoom: 17 });
        }
        this.showNotification(`Viewing: ${routeData.name} — click "Back to Live" to return`, 'info');
    }

    _setResetBtnMode(mode) {
        const btn = document.querySelector('button[onclick="resetMapView()"]');
        if (!btn) return;
        if (mode === 'history') {
            btn.innerHTML = '<i class="fas fa-broadcast-tower"></i> Back to Live';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-warning');
        } else {
            btn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i> Reset View';
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-secondary');
        }
    }

    async exportRoute(routeId) {
        const routeData = await this.loadRoute(routeId);
        if (routeData && window.exportManager) {
            window.exportManager.exportRoute(routeData, 'gpx');
        }
    }

    async activateRoute(routeId) {
        if (!confirm('Set this route as the active route? New GPS points will be appended to it. Any currently active route will be stopped.')) return;
        try {
            const response = await this.apiCall(`/api/devices/${this.selectedDeviceId}/routes/${routeId}/activate`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                this.showNotification(`"${result.name}" is now the active route — GPS will append here`, 'success');
                // Return to live view
                this._historyViewMode = false;
                this._setResetBtnMode('live');
                await this.loadDevicesAndRoutes();
                this.startAutoRefresh();
            } else {
                const err = await response.json();
                this.showNotification('Failed: ' + (err.error || 'unknown error'), 'error');
            }
        } catch (error) {
            this.showNotification('Error: ' + error.message, 'error');
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

    async editRoute(routeId, currentName, currentColor) {
        // Open the inline edit dialog
        const dlg = document.getElementById('route-edit-dialog');
        if (dlg) {
            document.getElementById('route-edit-id').value = routeId;
            document.getElementById('route-edit-name').value = currentName;
            document.getElementById('route-edit-color').value = currentColor || '#e74c3c';
            dlg.showModal();
            return;
        }
        // Fallback: prompt only
        const newName = prompt('Route name:', currentName);
        if (!newName || newName.trim() === currentName) return;
        await this._saveRouteEdit(routeId, newName.trim(), currentColor);
    }

    async _saveRouteEdit(routeId, name, color) {
        try {
            const response = await this.apiCall(`/api/routes/${routeId}`, {
                method: 'PATCH',
                body: JSON.stringify({ name, color })
            });
            if (response.ok) {
                this.showNotification('Route updated', 'success');
                await this.loadDevicesAndRoutes();
                // Re-apply color live if this is the currently displayed route
                if (routeId === this.currentRouteId && this.currentRoute) {
                    this.currentRoute.setStyle({ color });
                }
            } else {
                this.showNotification('Failed to update route', 'error');
            }
        } catch (error) {
            this.showNotification('Error: ' + error.message, 'error');
        }
    }

    async deleteRoute(routeId) {
        if (!confirm('Delete this route permanently? This cannot be undone.')) return;
        try {
            const response = await this.apiCall(`/api/routes/${routeId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                this.showNotification('Route deleted', 'success');
                await this.loadDevicesAndRoutes();
            } else {
                this.showNotification('Failed to delete route', 'error');
            }
        } catch (error) {
            this.showNotification('Error deleting route: ' + error.message, 'error');
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
            headers: { 'Content-Type': 'application/json' }
        };
        return fetch(url, { ...defaultOptions, ...options });
    }

    initMap() {
        // Initialize Leaflet map — scroll wheel zoom disabled; use Alt+scroll or the +/- controls
        this.map = L.map('map', { scrollWheelZoom: false }).setView([49.4875, 8.466], 13); // Default to Mannheim, Germany

        // Enable zoom only while Alt/Option is held
        this.map.getContainer().addEventListener('wheel', (e) => {
            if (e.altKey) {
                this.map.scrollWheelZoom.enable();
            } else {
                this.map.scrollWheelZoom.disable();
            }
        }, { passive: true });

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Add scale
        L.control.scale().addTo(this.map);

        // Track whether user has manually moved/zoomed the map
        this.userHasMovedMap = false;
        this.map.on('dragstart zoomstart', () => { this.userHasMovedMap = true; });

        // Initialize live tracking properties
        this.liveMarker = null;
        this.liveTrail = [];
        this.trailLayerGroup = L.layerGroup().addTo(this.map);

        // Data points (small dots on route lines) - off by default
        this.showDataPoints = false;
        this.dataPointsLayerGroup = L.layerGroup();

        // Route point editing state
        this.editMode = false;
        this.currentRouteData = null;
        this.currentRouteId = null;
        this.editMarkersGroup = L.layerGroup();

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', () => this.hideEditContextMenu());
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideEditContextMenu(); });

        console.log('Map initialized');
    }

    updateLivePosition(lat, lng, data = {}) {
        if (!this.map || !lat || !lng) return;

        // Add point to trail
        this.liveTrail.push([lat, lng]);

        // Add live data point dot
        L.circleMarker([lat, lng], {
            radius: 4,
            color: '#0056b3',
            fillColor: '#007bff',
            fillOpacity: 0.85,
            weight: 1.5
        }).bindPopup(`<div style="font-size:12px;">
            📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
            ${data.speed ? `🚀 ${(data.speed * 3.6).toFixed(1)} km/h<br>` : ''}
            ${data.alt ? `⛰️ ${data.alt}m<br>` : ''}
            🕒 ${new Date().toLocaleTimeString()}
        </div>`).addTo(this.dataPointsLayerGroup);
        if (this.showDataPoints && !this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.dataPointsLayerGroup.addTo(this.map);
        }

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

        // Only auto-fit if the user hasn't manually moved the map
        if (!this.userHasMovedMap) {
            if (this.liveTrail.length > 1) {
                this.map.fitBounds(L.latLngBounds(this.liveTrail).pad(0.1), {
                    maxZoom: 16,
                    padding: [20, 20]
                });
            } else {
                this.map.setView([lat, lng], 15);
            }
        }

        console.log(`Live position updated: ${lat}, ${lng} (${this.liveTrail.length} points total)`);
    }

    toggleDataPoints() {
        this.showDataPoints = !this.showDataPoints;
        if (this.showDataPoints) {
            this.dataPointsLayerGroup.addTo(this.map);
        } else {
            if (this.map.hasLayer(this.dataPointsLayerGroup)) {
                this.map.removeLayer(this.dataPointsLayerGroup);
            }
        }
        // Update button appearance
        const btn = document.getElementById('data-points-btn');
        if (btn) {
            btn.classList.toggle('btn-info', this.showDataPoints);
            btn.classList.toggle('btn-secondary', !this.showDataPoints);
            btn.querySelector('i').className = this.showDataPoints ? 'fas fa-dot-circle' : 'fas fa-circle';
            btn.querySelector('span').textContent = this.showDataPoints ? ' Hide Points' : ' Show Points';
        }
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

        // Clear data point dots
        this.dataPointsLayerGroup.clearLayers();
        if (this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }
        
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
        // Clear any existing interval
        if (window.gpsMonitorInterval) {
            clearInterval(window.gpsMonitorInterval);
        }

        let lastGPSRequestCount = 0;

        // Update GPS log function
        const updateGPSLog = async () => {
            try {
                const response = await fetch('./api/debug/requests');
                
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
    const tracker = window.routeTracker;
    const device = tracker.devices.get(tracker.selectedDeviceId);
    if (!device || !device.currentRoute) {
        tracker.showNotification('No active route to share', 'warning');
        return;
    }

    // Find current route name for the label
    const routeId = device.currentRoute;
    const deviceId = tracker.selectedDeviceId;

    tracker.apiCall('/api/shares', {
        method: 'POST',
        body: JSON.stringify({ routeId, deviceId, label: `${deviceId} – ${new Date().toLocaleDateString()}` })
    }).then(async res => {
        const data = await res.json();
        if (res.ok) {
            // Construct URL client-side (server doesn't know the public base path behind proxy)
            const base = window.location.href.split('?')[0];
            const shareUrl = `${base}?share=${data.shareId}`;
            if (navigator.share) {
                navigator.share({ title: data.share.label, url: shareUrl });
            } else {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    tracker.showNotification('Share link copied to clipboard', 'success');
                });
            }
        } else {
            tracker.showNotification(`Failed to create share link: ${data.error || res.status}`, 'error');
        }
    }).catch(err => tracker.showNotification('Error creating share link: ' + err.message, 'error'));
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

// Clear live GPS route function
function zoomToFit() {
    const rt = window.routeTracker;
    if (!rt || !rt.map) return;
    if (rt.currentRoute) {
        rt.map.fitBounds(rt.currentRoute.getBounds(), { padding: [30, 30], maxZoom: 17 });
    } else if (rt.liveTrail && rt.liveTrail.length > 1) {
        rt.map.fitBounds(L.latLngBounds(rt.liveTrail).pad(0.1), { maxZoom: 16, padding: [20, 20] });
    } else if (rt.liveTrail && rt.liveTrail.length === 1) {
        rt.map.setView(rt.liveTrail[0], 15);
    }
}

function resetMapView() {
    const rt = window.routeTracker;
    if (!rt || !rt.map) return;

    // If we were browsing a history route, resume live tracking first
    if (rt._historyViewMode) {
        rt._historyViewMode = false;
        rt._setResetBtnMode('live');
        rt.loadDevicesAndRoutes().then(() => {
            rt.startAutoRefresh();
        });
        return;
    }

    rt.userHasMovedMap = false;
    // Fit to live trail if available, otherwise current route layer, otherwise default
    if (rt.liveTrail && rt.liveTrail.length > 1) {
        rt.map.fitBounds(L.latLngBounds(rt.liveTrail).pad(0.1), { maxZoom: 16, padding: [20, 20] });
    } else if (rt.liveTrail && rt.liveTrail.length === 1) {
        rt.map.setView(rt.liveTrail[0], 15);
    } else if (rt.currentRoute) {
        rt.map.fitBounds(rt.currentRoute.getBounds(), { padding: [20, 20], maxZoom: 17 });
    } else {
        rt.map.setView([49.4875, 8.466], 13);
    }
}

function clearLiveRoute() {
    if (window.routeTracker && window.routeTracker.clearLiveRoute) {
        window.routeTracker.clearLiveRoute();
    } else {
        console.error('Route tracker not available');
        alert('Route tracker not available');
    }
}

function toggleDataPoints() {
    if (window.routeTracker) window.routeTracker.toggleDataPoints();
}

function toggleEditMode() {
    if (window.routeTracker) window.routeTracker.toggleEditMode();
}

function saveRouteEdits() {
    if (window.routeTracker) window.routeTracker.saveRouteEdits();
}

function discardRouteEdits() {
    if (window.routeTracker) window.routeTracker.discardRouteEdits();
}

function contextMenuAddAfter() {
    if (window.routeTracker) window.routeTracker.contextMenuAddAfter();
}

function contextMenuDelete() {
    if (window.routeTracker) window.routeTracker.contextMenuDelete();
}

function mergeSelectedRoutes() {
    if (window.routeTracker) window.routeTracker.mergeSelectedRoutes();
}

function saveRouteEdit() {
    const id    = document.getElementById('route-edit-id').value;
    const name  = document.getElementById('route-edit-name').value.trim();
    const color = document.getElementById('route-edit-color').value;
    if (!name) return;
    document.getElementById('route-edit-dialog').close();
    if (window.routeTracker) window.routeTracker._saveRouteEdit(id, name, color);
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

// ═══════════════════════════════════════════════════════════
//  MEDIA — photos & YouTube videos on the map
// ═══════════════════════════════════════════════════════════

const mediaState = {
    markers: [],          // Leaflet marker instances
    activeTab: 'photo',
    pickingCoords: false,
    pickedLat: null,
    pickedLng: null,
    coordPickerHandler: null,
    escHandler: null,
    cancelCurrentPick: null,  // generic cancel fn for any active map-pick
};

// ── open/close upload dialog ──────────────────────────────
function openMediaUpload() {
    const dlg = document.getElementById('media-upload-dialog');
    resetMediaForm();
    dlg.showModal();
}

function resetMediaForm() {
    document.getElementById('media-photo-file').value = '';
    document.getElementById('media-photo-desc').value = '';
    document.getElementById('media-photo-lat').value = '';
    document.getElementById('media-photo-lng').value = '';
    document.getElementById('media-photo-loc-gps').style.display = 'none';
    document.getElementById('media-photo-loc-none').style.display = 'none';
    document.getElementById('media-yt-url').value = '';
    document.getElementById('media-yt-desc').value = '';
    document.getElementById('media-yt-lat').value = '';
    document.getElementById('media-yt-lng').value = '';
    document.getElementById('media-yt-coords').textContent = 'No point selected yet';
    const status = document.getElementById('media-upload-status');
    status.style.display = 'none';
    mediaState.pickedLat = null;
    mediaState.pickedLng = null;
    switchMediaTab('photo');
}

function switchMediaTab(tab) {
    mediaState.activeTab = tab;
    document.getElementById('media-panel-photo').style.display = tab === 'photo' ? '' : 'none';
    document.getElementById('media-panel-youtube').style.display = tab === 'youtube' ? '' : 'none';
    document.getElementById('media-tab-photo').className = 'btn ' + (tab === 'photo' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('media-tab-youtube').className = 'btn ' + (tab === 'youtube' ? 'btn-primary' : 'btn-secondary');
    // reset shared coord state
    mediaState.pickedLat = null;
    mediaState.pickedLng = null;
}

// ── file selected: read EXIF GPS client-side ──────────────
async function onMediaPhotoSelected() {
    const file = document.getElementById('media-photo-file').files[0];
    if (!file) return;
    document.getElementById('media-photo-loc-gps').style.display = 'none';
    document.getElementById('media-photo-loc-none').style.display = 'none';
    try {
        const gps = await exifr.gps(file);
        if (gps && gps.latitude && gps.longitude) {
            document.getElementById('media-photo-lat').value = gps.latitude;
            document.getElementById('media-photo-lng').value = gps.longitude;
            document.getElementById('media-photo-loc-text').textContent =
                `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`;
            document.getElementById('media-photo-loc-gps').style.display = '';
        } else {
            document.getElementById('media-photo-lat').value = '';
            document.getElementById('media-photo-lng').value = '';
            document.getElementById('media-photo-loc-none').style.display = '';
            // Auto-trigger map picking — slight delay so dialog can process the file-select event
            setTimeout(() => startMapCoordPicker(), 300);
        }
    } catch {
        document.getElementById('media-photo-lat').value = '';
        document.getElementById('media-photo-lng').value = '';
        document.getElementById('media-photo-loc-none').style.display = '';
        setTimeout(() => startMapCoordPicker(), 300);
    }
}

// ── map coord picker ──────────────────────────────────────
function startMapCoordPicker() {
    const dlg = document.getElementById('media-upload-dialog');
    const activeTab = mediaState.activeTab;
    dlg.close();
    mediaState.pickingCoords = true;
    document.body.style.cursor = 'crosshair';

    const map = window.routeTracker && window.routeTracker.map;
    if (!map) return;

    // Remove any previous stale handler
    if (mediaState.coordPickerHandler) {
        map.off('click', mediaState.coordPickerHandler);
    }

    const cleanupUploadPick = () => {
        map.off('click', mediaState.coordPickerHandler);
        mediaState.coordPickerHandler = null;
        mediaState.pickingCoords = false;
        document.body.style.cursor = '';
        document.removeEventListener('keydown', mediaState.escHandler);
        mediaState.escHandler = null;
        mediaState.cancelCurrentPick = null;
        dlg.showModal();
    };

    const finishPick = (lat, lng) => {
        mediaState.pickedLat = lat;
        mediaState.pickedLng = lng;
        const coordText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        if (activeTab === 'photo') {
            document.getElementById('media-photo-lat').value = lat;
            document.getElementById('media-photo-lng').value = lng;
            document.getElementById('media-photo-loc-text').textContent = coordText;
            document.getElementById('media-photo-loc-gps').style.display = '';
            document.getElementById('media-photo-loc-none').style.display = 'none';
        } else {
            document.getElementById('media-yt-lat').value = lat;
            document.getElementById('media-yt-lng').value = lng;
            document.getElementById('media-yt-coords').textContent = coordText;
        }
        cleanupUploadPick(false);
    };

    mediaState.coordPickerHandler = (e) => finishPick(e.latlng.lat, e.latlng.lng);
    mediaState.escHandler = (e) => { if (e.key === 'Escape') cancelMapCoordPicker(); };
    mediaState.cancelCurrentPick = () => cleanupUploadPick();
    document.addEventListener('keydown', mediaState.escHandler);
    setTimeout(() => { map.on('click', mediaState.coordPickerHandler); }, 200);
}

function cancelMapCoordPicker() {
    if (mediaState.cancelCurrentPick) {
        mediaState.cancelCurrentPick();
        mediaState.cancelCurrentPick = null;
    }
}

// ── submit photo ──────────────────────────────────────────
async function submitPhotoUpload() {
    const file = document.getElementById('media-photo-file').files[0];
    const lat = document.getElementById('media-photo-lat').value;
    const lng = document.getElementById('media-photo-lng').value;
    const desc = document.getElementById('media-photo-desc').value;
    const deviceId = window.routeTracker?.selectedDeviceId;

    if (!file) return showMediaStatus('Please select a photo.', 'error');
    if (!lat || !lng) return showMediaStatus('Please pick coordinates on the map.', 'error');
    if (!deviceId) return showMediaStatus('No device selected.', 'error');

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('lat', lat);
    formData.append('lng', lng);
    formData.append('description', desc);

    showMediaStatus('<i class="fas fa-spinner fa-spin"></i> Uploading...', 'info');
    try {
        const routeId = window.routeTracker?.currentRouteId || '';
        if (routeId) formData.append('routeId', routeId);
        const res = await fetch(`./api/media/${deviceId}/photo`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        showMediaStatus('<i class="fas fa-check"></i> Photo uploaded!', 'success');
        setTimeout(() => {
            document.getElementById('media-upload-dialog').close();
            loadMediaMarkers(deviceId, window.routeTracker?.currentRouteId);
        }, 1000);
    } catch (e) {
        showMediaStatus('Upload failed: ' + e.message, 'error');
    }
}

// ── submit youtube ────────────────────────────────────────
async function submitYoutubeAdd() {
    const url = document.getElementById('media-yt-url').value.trim();
    const desc = document.getElementById('media-yt-desc').value.trim();
    const lat = document.getElementById('media-yt-lat').value;
    const lng = document.getElementById('media-yt-lng').value;
    const deviceId = window.routeTracker?.selectedDeviceId;

    if (!url) return showMediaStatus('Please enter a YouTube URL.', 'error');
    if (!lat || !lng) return showMediaStatus('Please pick coordinates on the map.', 'error');
    if (!deviceId) return showMediaStatus('No device selected.', 'error');

    showMediaStatus('<i class="fas fa-spinner fa-spin"></i> Saving...', 'info');
    try {
        const routeId = window.routeTracker?.currentRouteId || undefined;
        const res = await fetch(`./api/media/${deviceId}/youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, description: desc, lat, lng, ...(routeId ? { routeId } : {}) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showMediaStatus('<i class="fas fa-check"></i> Video added!', 'success');
        setTimeout(() => {
            document.getElementById('media-upload-dialog').close();
            loadMediaMarkers(deviceId, window.routeTracker?.currentRouteId);
        }, 1000);
    } catch (e) {
        showMediaStatus('Failed: ' + e.message, 'error');
    }
}

function showMediaStatus(msg, type) {
    const el = document.getElementById('media-upload-status');
    const colors = { error: '#f8d7da', success: '#d4edda', info: '#d1ecf1' };
    const borders = { error: '#f5c6cb', success: '#c3e6cb', info: '#bee5eb' };
    el.style.display = '';
    el.style.background = colors[type] || '#fff';
    el.style.border = `1px solid ${borders[type] || '#ddd'}`;
    el.style.borderRadius = '6px';
    el.style.padding = '10px 14px';
    el.style.fontSize = '0.9rem';
    el.innerHTML = msg;
}

// Global onerror handler for media thumbnails (avoids broken JS in HTML attributes)
window.mediaThumbError = function(img) {
    img.style.display = 'none';
    img.parentElement.innerHTML = '<i class="fas fa-camera" style="line-height:38px;font-size:18px;color:#888;padding-left:11px;"></i>';
};

// ── load & render media markers on map ───────────────────
async function loadMediaMarkers(deviceId, routeId) {
    const map = window.routeTracker?.map;
    if (!map || !deviceId) return;

    // Remove existing media markers
    mediaState.markers.forEach(m => map.removeLayer(m));
    mediaState.markers = [];

    try {
        const qs = routeId ? `?routeId=${encodeURIComponent(routeId)}` : '';
        const res = await fetch(`./api/media/${deviceId}${qs}`);
        if (!res.ok) return;
        const entries = await res.json();

        entries.forEach(entry => {
            const marker = createMediaMarker(entry, deviceId, map);
            if (marker) mediaState.markers.push(marker);
        });
    } catch (e) {
        console.warn('Could not load media markers:', e.message);
    }
}

function createMediaMarker(entry, deviceId, map) {
    const isAdmin = document.body.classList.contains('role-admin');
    const cursor = isAdmin ? 'grab' : 'pointer';
    const tipAttr = isAdmin ? ' title="Drag to reposition"' : '';
    if (entry.type === 'photo') {
        const thumbUrl = `./api/media/${deviceId}/${entry.id}/thumb`;
        iconHtml = `<div style="width:44px;height:44px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);overflow:hidden;background:#eee;cursor:${cursor};user-select:none;-webkit-user-select:none;"${tipAttr}>
                      <img src="${thumbUrl}" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" onerror="mediaThumbError(this)">
                    </div>`;
    } else if (entry.type === 'youtube') {
        iconHtml = `<div style="width:44px;height:44px;border-radius:50%;background:#FF0000;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;cursor:${cursor};user-select:none;-webkit-user-select:none;"${tipAttr}>
                      <i class="fab fa-youtube" style="color:white;font-size:22px;pointer-events:none;"></i>
                    </div>`;
    } else {
        return null;
    }

    const icon = L.divIcon({ html: iconHtml, className: '', iconSize: [44, 44], iconAnchor: [22, 22] });
    const marker = L.marker([entry.lat, entry.lng], {
        icon,
        draggable: isAdmin,
    }).addTo(map);

    // Short click → open viewer (only if not just dragged)
    let dragJustHappened = false;
    marker.on('dragstart', () => { dragJustHappened = false; });
    marker.on('drag',      () => { dragJustHappened = true; });
    marker.on('dragend', async (e) => {
        const { lat, lng } = e.target.getLatLng();
        entry.lat = lat;
        entry.lng = lng;
        try {
            const res = await fetch(`./api/media/${encodeURIComponent(deviceId)}/${encodeURIComponent(entry.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.error('Failed to save position:', err);
            }
        } catch (e) { console.error('PATCH error:', e); }
    });
    marker.on('click', () => {
        if (dragJustHappened) { dragJustHappened = false; return; }
        openMediaViewer(entry, deviceId);
    });

    return marker;
}

// ── media viewer overlay ──────────────────────────────────
function openMediaViewer(entry, deviceId) {
    deviceId = deviceId || window.routeTracker?.selectedDeviceId;
    const dlg = document.getElementById('media-viewer-dialog');
    const content = document.getElementById('media-viewer-content');
    const desc = document.getElementById('media-viewer-desc');
    const actions = document.getElementById('media-viewer-actions');

    desc.textContent = entry.description || '';
    actions.innerHTML = '';

    if (entry.type === 'photo') {
        const photoUrl = `./api/media/${deviceId}/${entry.id}/photo`;
        content.innerHTML = `<img src="${photoUrl}" style="width:100%;max-height:75vh;object-fit:contain;display:block;background:#000;">`;
        actions.innerHTML = `<a href="${photoUrl}" download class="btn btn-success btn-sm"><i class="fas fa-download"></i> Download</a>`;

    } else if (entry.type === 'youtube') {
        const videoId = extractYoutubeId(entry.url);
        content.innerHTML = videoId
            ? `<div style="position:relative;padding-bottom:56.25%;height:0;">
                 <iframe src="https://www.youtube.com/embed/${videoId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe>
               </div>`
            : `<div style="padding:40px;text-align:center;color:white;">Could not embed video.</div>`;
        actions.innerHTML = `<a href="${entry.url}" target="_blank" rel="noopener" class="btn btn-danger btn-sm"><i class="fab fa-youtube"></i> Open in YouTube</a>`;
    }

    dlg.showModal();
}

function extractYoutubeId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
        return u.searchParams.get('v');
    } catch { return null; }
}

// Hook into device loading — reload media when device/route changes
const _origLoadDevicesAndRoutes = RouteTracker.prototype.loadDevicesAndRoutes;
RouteTracker.prototype.loadDevicesAndRoutes = async function() {
    await _origLoadDevicesAndRoutes.call(this);
    loadMediaMarkers(this.selectedDeviceId, this.currentRouteId);
};

console.log('Route Tracker GPS Receiver script loaded - Debug functions available');