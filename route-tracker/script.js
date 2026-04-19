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
        this._allRoutes = [];
        this._historyRouteLimit = null;
        this.historyFilters = {
            dateFrom: '',
            dateTo: '',
            favoritesOnly: false
        };
        const now = new Date();
        this.archiveCalendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Reference to translation function
        this.t = window.t;

        // Dynamic UI parts (route history list, mode buttons) need an explicit refresh on language change.
        document.addEventListener('languageChange', async () => {
            this.t = window.t;
            try {
                await this.loadRoutesList();
            } catch (error) {
                console.warn('Failed to refresh routes list after language change:', error);
            }

            this._setResetBtnMode(this._historyViewMode ? 'history' : 'live');

            const editBtn = document.getElementById('edit-mode-btn');
            if (editBtn) {
                if (this.editMode) {
                    editBtn.innerHTML = `<i class="fas fa-times"></i> ${this.t ? this.t('map.exit_edit', 'Exit Edit') : 'Exit Edit'}`;
                } else {
                    editBtn.innerHTML = `<i class="fas fa-pencil-alt"></i> ${this.t ? this.t('map.edit_points', 'Edit Points') : 'Edit Points'}`;
                }
            }
        });

        this._onResponsiveLayoutChange = () => this.enforceResponsiveControlPanelLayout();
        
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
            this.enforceResponsiveControlPanelLayout();

            // Set OwnTracks endpoint URL in config section (admin only)
            const epEl = document.getElementById('endpoint-url');
            if (epEl) epEl.textContent = 'https://tracker.route-tracker.de';
            
            await this.loadAndPopulateDevices();
            this.setupDeviceSelector();
            this.setupHistoryFilters();
            this.setupArchiveCalendar();
            this.enforceResponsiveControlPanelLayout();

            window.addEventListener('resize', this._onResponsiveLayoutChange, { passive: true });
            window.addEventListener('orientationchange', this._onResponsiveLayoutChange, { passive: true });
            await this.loadDevicesAndRoutes();
            this.startAutoRefresh();

                // If a shared route link was used, load that route directly
                const urlParams2 = new URLSearchParams(window.location.search);
                const sharedRoute = urlParams2.get('route') || (me.role === 'share' ? me.shareRouteId : null);
                if (sharedRoute) {
                    await this.loadRoute(sharedRoute);
                    this.showNotification(window.t ? window.t('notify.route_loaded', 'Loaded shared route') : 'Loaded shared route', 'success');
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
            this.showNotification(window.t ? window.t('error.failed_initialize', 'Failed to initialize') + ': ' + error.message : 'Failed to initialize: ' + error.message, 'error');
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
        this.showNotification(window.t ? window.t('notify.device_switched', 'Switched to device') + `: ${value}` : `Switched to device: ${value}`, 'info');
        // Reset initial load flag so switching device re-runs the startup logic
        this._initialLoadDone = false;
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

                // Decide which route to show (only on first load, not on auto-refresh)
                if (!this._initialLoadDone) {
                    this._initialLoadDone = true;
                    const savedRouteId  = localStorage.getItem('lastRouteId');
                    const savedDeviceId = localStorage.getItem('lastRouteDeviceId');

                    if (savedRouteId && savedDeviceId === this.selectedDeviceId) {
                        // Restore the last viewed route
                        await this.loadRoute(savedRouteId);
                    } else if (deviceData.currentRoute) {
                        // Fall back to current active route
                        await this.loadRoute(deviceData.currentRoute);
                    } else {
                        // No active route — load the most recent completed route
                        await this.centerOnRecentActivity();
                    }
                } else {
                    // Auto-refresh: only reload if currently showing the active route
                    if (deviceData.currentRoute && this.currentRouteId === deviceData.currentRoute) {
                        await this.loadRoute(deviceData.currentRoute);
                    }
                }

                // Load recent routes list
                await this.loadRoutesList();
            }
        } catch (error) {
            console.error('Error loading data:', error);
            this.showNotification('Error loading device data: ' + error.message, 'error');
        }
    }

    async centerOnRecentActivity() {
        if (this.mapCentered || this.userHasMovedMap) return;
        
        try {
            // First try to get recent GPS data from debug endpoint
            const debugResponse = await this.apiCall('/api/debug/requests');
            if (debugResponse.ok) {
                const data = await debugResponse.json();
                const gpsRequests = data.requests.filter(req => 
                    req.path === '/api/gps' && req.method === 'POST'
                );
                
                if (gpsRequests.length > 0) {
                    const latestRequest = gpsRequests[0];
                    if (latestRequest && latestRequest.body && latestRequest.body.lat && latestRequest.body.lng) {
                        console.log('Centering map on recent GPS data');
                        this.map.setView([latestRequest.body.lat, latestRequest.body.lng], 14);
                        this.mapCentered = true;
                        return;
                    }
                }
            }
            
            // If no recent GPS data, try to center on the most recent route
            const routesResponse = await this.apiCall(`/api/devices/${this.selectedDeviceId}/routes`);
            if (routesResponse.ok) {
                const routesData = await routesResponse.json();
                if (routesData.routes && routesData.routes.length > 0) {
                    const mostRecentRoute = routesData.routes[0]; // Routes should be sorted by date
                    if (mostRecentRoute.id) {
                        console.log('Centering map on most recent route');
                        const routeData = await this.loadRoute(mostRecentRoute.id);
                        if (routeData && routeData.points && routeData.points.length > 0) {
                            // Center on the last point of the most recent route
                            const lastPoint = routeData.points[routeData.points.length - 1];
                            this.map.setView([lastPoint.lat, lastPoint.lng], 14);
                            this.mapCentered = true;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error centering on recent activity:', error);
        }
    }

    async loadRoute(routeId) {
        try {
            const response = await this.apiCall(`/api/routes/${routeId}?_t=${Date.now()}`); // Add cache buster
            if (response.ok) {
                const routeData = await response.json();
                console.log(`🔍 Loaded route ${routeId}: ${routeData.name} - ${routeData.points?.length} points`);
                this.currentRouteData = routeData;
                this.currentRouteId = routeId;
                this.displayRoute(routeData);
                this.updateRouteStats(routeData);
                const activeRouteName = document.getElementById('active-route-name');
                if (activeRouteName) activeRouteName.textContent = routeData.name || routeId;
                // Persist so reload restores the same route
                localStorage.setItem('lastRouteId', routeId);
                localStorage.setItem('lastRouteDeviceId', this.selectedDeviceId);
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
                this._allRoutes = Array.isArray(data.routes) ? data.routes : [];
                this._historyRouteLimit = (data.historyRouteLimit && Number.isFinite(Number(data.historyRouteLimit)))
                    ? Number(data.historyRouteLimit)
                    : null;
                this.refreshRouteHistoryView();
            }
        } catch (error) {
            console.error('Error loading routes list:', error);
        }
    }

    setupHistoryFilters() {
        const fromInput = document.getElementById('history-date-from');
        const toInput = document.getElementById('history-date-to');
        const favoritesOnly = document.getElementById('history-favorites-only');
        const clearBtn = document.getElementById('history-filter-clear');

        if (!fromInput || !toInput || !favoritesOnly || !clearBtn) return;

        fromInput.addEventListener('change', () => {
            this.historyFilters.dateFrom = fromInput.value || '';
            this.refreshRouteHistoryView();
        });
        toInput.addEventListener('change', () => {
            this.historyFilters.dateTo = toInput.value || '';
            this.refreshRouteHistoryView();
        });
        favoritesOnly.addEventListener('change', () => {
            this.historyFilters.favoritesOnly = !!favoritesOnly.checked;
            this.refreshRouteHistoryView();
        });
        clearBtn.addEventListener('click', () => {
            fromInput.value = '';
            toInput.value = '';
            favoritesOnly.checked = false;
            this.historyFilters = { dateFrom: '', dateTo: '', favoritesOnly: false };
            this.refreshRouteHistoryView();
        });
    }

    enforceResponsiveControlPanelLayout() {
        // Set ios-phone class so the .ios-phone CSS fallback rules activate.
        // The class-based CSS media queries handle the actual layout now;
        // we no longer need to override inline styles via JS.
        const ua = navigator.userAgent || '';
        const isIPhone = /iPhone|iPod/i.test(ua);
        const minScreenSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
        const hasTouch = (navigator.maxTouchPoints || 0) > 1;
        const isPhoneFormFactor = hasTouch && minScreenSide > 0 && minScreenSide <= 500;
        document.body.classList.toggle('ios-phone', isIPhone || isPhoneFormFactor);
    }

    setupArchiveCalendar() {
        const prevBtn = document.getElementById('archive-cal-prev');
        const nextBtn = document.getElementById('archive-cal-next');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.archiveCalendarMonth = new Date(
                    this.archiveCalendarMonth.getFullYear(),
                    this.archiveCalendarMonth.getMonth() - 1,
                    1
                );
                this.renderArchiveCalendar();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.archiveCalendarMonth = new Date(
                    this.archiveCalendarMonth.getFullYear(),
                    this.archiveCalendarMonth.getMonth() + 1,
                    1
                );
                this.renderArchiveCalendar();
            });
        }

        this.renderArchiveCalendar();
    }

    _toDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    _getRouteFilterDate(route) {
        if (!route) return null;
        // Keep calendar marker dates and date-filter behavior consistent.
        const iso = route.status !== 'active'
            ? (route.endTime || route.startTime)
            : route.startTime;
        if (!iso) return null;
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    _getArchivedDateCounts() {
        const counts = new Map();
        for (const route of this._allRoutes) {
            const isArchived = route && route.status !== 'active';
            if (!isArchived) continue;

            const date = this._getRouteFilterDate(route);
            if (!date) continue;

            const key = this._toDateKey(date);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return counts;
    }

    renderArchiveCalendar() {
        const monthEl = document.getElementById('archive-cal-month');
        const weekdaysEl = document.getElementById('archive-cal-weekdays');
        const daysEl = document.getElementById('archive-cal-days');
        if (!monthEl || !weekdaysEl || !daysEl) return;

        const lang = (window.currentLanguage === 'de') ? 'de-DE' : 'en-US';
        const monthLabel = this.archiveCalendarMonth.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
        monthEl.textContent = monthLabel;

        const archivedCounts = this._getArchivedDateCounts();
        const selectedDay = (this.historyFilters.dateFrom && this.historyFilters.dateFrom === this.historyFilters.dateTo)
            ? this.historyFilters.dateFrom
            : '';

        weekdaysEl.innerHTML = '';
        const baseMonday = new Date(Date.UTC(2026, 0, 5));
        for (let i = 0; i < 7; i++) {
            const wd = new Date(baseMonday.getTime() + i * 24 * 3600 * 1000);
            const node = document.createElement('div');
            node.className = 'archive-calendar-weekday';
            node.textContent = wd.toLocaleDateString(lang, { weekday: 'short' });
            weekdaysEl.appendChild(node);
        }

        const year = this.archiveCalendarMonth.getFullYear();
        const month = this.archiveCalendarMonth.getMonth();
        const first = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let offset = first.getDay() - 1;
        if (offset < 0) offset = 6;

        daysEl.innerHTML = '';
        for (let i = 0; i < offset; i++) {
            const empty = document.createElement('div');
            empty.className = 'archive-calendar-day empty';
            daysEl.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const key = this._toDateKey(date);
            const count = archivedCounts.get(key) || 0;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'archive-calendar-day';
            if (count > 0) btn.classList.add('has-archive');
            if (selectedDay && selectedDay === key) btn.classList.add('selected');
            btn.textContent = String(day);
            btn.title = count > 0
                ? `${count} ${this.t ? this.t('history.archive_items', 'archived route(s)') : 'archived route(s)'}`
                : (this.t ? this.t('history.no_archives_day', 'No archived routes on this day') : 'No archived routes on this day');

            if (count > 0) {
                const badge = document.createElement('span');
                badge.className = 'archive-calendar-day-count';
                badge.textContent = String(count);
                btn.appendChild(badge);
            }

            btn.addEventListener('click', () => {
                const fromInput = document.getElementById('history-date-from');
                const toInput = document.getElementById('history-date-to');

                if (this.historyFilters.dateFrom === key && this.historyFilters.dateTo === key) {
                    this.historyFilters.dateFrom = '';
                    this.historyFilters.dateTo = '';
                    if (fromInput) fromInput.value = '';
                    if (toInput) toInput.value = '';
                } else {
                    this.historyFilters.dateFrom = key;
                    this.historyFilters.dateTo = key;
                    if (fromInput) fromInput.value = key;
                    if (toInput) toInput.value = key;
                }

                this.refreshRouteHistoryView();
            });

            daysEl.appendChild(btn);
        }
    }

    getFilteredSortedRoutes(routes) {
        if (!Array.isArray(routes)) return [];

        const sorted = [...routes].sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
        const hasDateFilter = !!(this.historyFilters.dateFrom || this.historyFilters.dateTo);

        const filtered = sorted.filter(route => {
            if (this.historyFilters.favoritesOnly && !route.favorite) return false;

            const routeDate = this._getRouteFilterDate(route);
            const t = routeDate ? routeDate.getTime() : null;
            if (!t || Number.isNaN(t)) return true;

            if (this.historyFilters.dateFrom) {
                const from = new Date(`${this.historyFilters.dateFrom}T00:00:00`).getTime();
                if (t < from) return false;
            }
            if (this.historyFilters.dateTo) {
                const to = new Date(`${this.historyFilters.dateTo}T23:59:59`).getTime();
                if (t > to) return false;
            }
            return true;
        });

        // Apply limit only when no date filter is active (calendar click bypasses the limit)
        // Favorites are always shown regardless of limit
        if (!hasDateFilter && this._historyRouteLimit) {
            const limit = this._historyRouteLimit;
            return filtered.filter((route, index) => route.favorite || index < limit);
        }

        return filtered;
    }

    refreshRouteHistoryView() {
        this.renderArchiveCalendar();
        this.updateRoutesList(this.getFilteredSortedRoutes(this._allRoutes));
    }

    displayRoute(routeData) {
        // Exit edit mode before loading a new route
        if (this.editMode) this.exitEditMode(false);
        
        console.log(`🗺️ Displaying route: ${routeData.name} - ${routeData.points?.length} points`);
        console.log('First few points:', routeData.points?.slice(0, 3));
        console.log('Last few points:', routeData.points?.slice(-3));
        
        // Store current route data for editing
        this.currentRouteData = routeData;

        // Clear existing layers
        this.clearAllLayers();

        // Check if route has enhanced analysis data - use smart display if available
        if (routeData && routeData.analysis && routeData.analysis.segments && routeData.analysis.segments.length > 0) {
            this.displaySmartRoute(routeData);
        } else {
            // Always display the route first, then optionally enhance
            this.displaySimpleRoute(routeData);
            
            // Auto-trigger analysis for substantial routes (>100 points) in background
            if (routeData?.points?.length > 100 && !routeData.analysis) {
                setTimeout(() => this.triggerRouteAnalysis(), 1000);
            }
        }
        
        // Center map on route data if this is the first route loaded and user hasn't moved map
        if (routeData && routeData.points && routeData.points.length > 0 && !this.mapCentered && !this.userHasMovedMap) {
            setTimeout(() => {
                if (typeof zoomToFit === 'function') {
                    zoomToFit();
                    this.mapCentered = true;
                }
            }, 500);
        }
        // Also auto-zoom to fit for historical routes (non-live routes).
        else if (routeData && !routeData.isLive && routeData.points && routeData.points.length > 0) {
            setTimeout(() => {
                if (typeof zoomToFit === 'function') zoomToFit();
            }, 500);
        }
    }

    // Enhanced smart route display with analysis
    displaySmartRoute(routeData) {
        if (!routeData?.points?.length) return;
        
        console.log('🎨 Rendering smart route with analysis...');
        this.routeLayers = this.routeLayers || [];
        
        // 1. Draw route segments with appropriate colors
        if (routeData.analysis.segments && routeData.analysis.segments.length > 0) {
            routeData.analysis.segments.forEach((segment, index) => {
                const colors = routeData.visualization?.colors || {
                    road: '#2ecc71',
                    offroad: '#8b4513'
                };
                
                const color = segment.type === 'road' ? colors.road : colors.offroad;
                const geometry = segment.geometry && segment.geometry.length > 0 ? 
                                segment.geometry : 
                                segment.points.map(p => [p.lat, p.lng]);
                
                if (geometry.length > 0) {
                    const polyline = L.polyline(geometry, {
                        color: color,
                        weight: segment.type === 'road' ? 5 : 4,
                        opacity: 0.8,
                        className: `route-segment-${segment.type}`
                    });
                    
                    // Add tooltip for segment info with simplified count
                    const displayCount = segment.geometry && segment.geometry.length > 0 ? 
                                        segment.geometry.length : segment.points.length;
                    polyline.bindTooltip(
                        `${segment.type.toUpperCase()}: ${(segment.distance_km || 0).toFixed(1)}km`, 
                        {
                            sticky: true,
                            className: `segment-tooltip-${segment.type}`
                        }
                    );
                    
                    this.routeLayers.push(polyline.addTo(this.map));
                    
                    if (index === 0) this.currentRoute = polyline; // For bounds calculation
                }
            });
            
            console.log(`✅ Drew ${routeData.analysis.segments.length} route segments`);
        } else {
            // Fallback to simple rendering if no segments
            this.displaySimpleRoute(routeData);
        }
        
        // 2. Draw pause points with yellow circles
        if (routeData.analysis.pausePoints && routeData.visualization?.showPausePoints) {
            this.drawPausePoints(routeData.analysis.pausePoints, routeData.visualization.colors);
        }
        
        // 3. Add start/end markers
        this.addStartEndMarkers(routeData);
        
        // 4. Build data-point dots layer (optional)
        this.buildRouteDataPoints(routeData);
    }

    // Simple route display (fallback)
    displaySimpleRoute(routeData) {
        if (routeData && routeData.points && routeData.points.length > 0) {
            const latLngs = routeData.points.map(p => [p.lat, p.lng]);
            
            this.currentRoute = L.polyline(latLngs, {
                color: routeData.color || '#e74c3c',
                weight: 4,
                opacity: 0.8
            }).addTo(this.map);

            // Add start/end markers
            this.addStartEndMarkers(routeData);
            
            // Build data-point dots layer
            this.buildRouteDataPoints(routeData);
        }
    }

    // Draw pause points with approach/departure tracks
    drawPausePoints(pausePoints, colors = {}) {
        const pauseColors = {
            pause: colors.pause || '#f39c12',
            approach: colors.approach || '#e74c3c', 
            departure: colors.departure || '#3498db',
            ...colors
        };
        
        pausePoints.forEach((pause, pauseIndex) => {
            // Main pause circle (smaller size, more transparent)
            const pauseCircle = L.circle([pause.lat, pause.lng], {
                color: pauseColors.pause,
                fillColor: pauseColors.pause,
                fillOpacity: 0.5,
                radius: 50,
                weight: 2,
                className: 'pause-circle'
            });
            
            const popup = this.createPausePopup(pause);
            pauseCircle.bindPopup(popup);
            this.routeLayers.push(pauseCircle.addTo(this.map));
            
            // Draw approach tracks with colored outlines
            if (pause.approaches && this.currentRouteData?.visualization?.showTrackOutlines) {
                pause.approaches.forEach((approach, i) => {
                    if (approach.geometry && approach.geometry.length > 0) {
                        // Approach track outline
                        const outlineColor = pauseColors.approach;
                        const outline = L.polyline(approach.geometry, {
                            color: outlineColor,
                            weight: 6,
                            opacity: 0.7,
                            className: 'approach-outline'
                        });
                        
                        this.routeLayers.push(outline.addTo(this.map));
                        
                        // Approach direction arrow
                        const lastPoint = approach.geometry[approach.geometry.length - 1];
                        const arrow = L.marker(lastPoint, {
                            icon: L.divIcon({
                                className: 'approach-arrow',
                                html: `<div style="color:${outlineColor};">→</div>`,
                                iconSize: [20, 20]
                            })
                        });
                        this.routeLayers.push(arrow.addTo(this.map));
                    }
                });
            }
            
            // Draw departure tracks with colored outlines  
            if (pause.departures && this.currentRouteData?.visualization?.showTrackOutlines) {
                pause.departures.forEach((departure, i) => {
                    if (departure.geometry && departure.geometry.length > 0) {
                        // Departure track outline
                        const outlineColor = pauseColors.departure;
                        const outline = L.polyline(departure.geometry, {
                            color: outlineColor,
                            weight: 6,
                            opacity: 0.7,
                            className: 'departure-outline'
                        });
                        
                        this.routeLayers.push(outline.addTo(this.map));
                        
                        // Departure direction arrow
                        const firstPoint = departure.geometry[0];
                        const arrow = L.marker(firstPoint, {
                            icon: L.divIcon({
                                className: 'departure-arrow',
                                html: `<div style="color:${outlineColor};">←</div>`,
                                iconSize: [20, 20]
                            })
                        });
                        this.routeLayers.push(arrow.addTo(this.map));
                    }
                });
            }
            
            console.log(`🛑 Drew pause point ${pauseIndex + 1}: ${Math.round(pause.duration/3600)}h`);
        });
    }

    createPausePopup(pause) {
        const duration = Math.round(pause.duration / 3600 * 10) / 10; // Hours with 1 decimal
        const startTime = new Date(pause.startTime).toLocaleString();
        const endTime = new Date(pause.endTime).toLocaleString();
        
        return `
            <div class="pause-popup" style="font-size:12px; max-width:200px;">
                <h4 style="margin:0 0 8px 0; color:#f39c12;">🛑 Pause Point</h4>
                <p style="margin:2px 0;"><strong>Duration:</strong> ${duration}h</p>
                <p style="margin:2px 0;"><strong>From:</strong> ${startTime}</p>
                <p style="margin:2px 0;"><strong>To:</strong> ${endTime}</p>
                <p style="margin:2px 0;"><strong>Approaches:</strong> ${pause.approaches?.length || 0}</p>
                <p style="margin:2px 0;"><strong>Departures:</strong> ${pause.departures?.length || 0}</p>
            </div>
        `;
    }

    addStartEndMarkers(routeData) {
        if (!routeData?.points?.length) return;
        
        const startPoint = routeData.points[0];
        const endPoint = routeData.points[routeData.points.length - 1];
        
        // Initialize layer tracking if needed
        if (!this.routeLayers) this.routeLayers = [];
        
        // Start marker
        const startMarker = L.marker([startPoint.lat, startPoint.lng], {
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
        
        this.routeLayers.push(startMarker);
        
        // End marker (if different from start)
        if (routeData.points.length > 1) {
            const endMarker = L.marker([endPoint.lat, endPoint.lng], {
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
            
            this.routeLayers.push(endMarker);
        }
    }

    // Clear all route layers
    clearAllLayers() {
        console.log('Clearing all route layers from the map...');

        // Ensure shared layer groups always exist (other methods call clearLayers on them)
        if (!this.dataPointsLayerGroup) this.dataPointsLayerGroup = L.layerGroup();
        if (!this.editMarkersGroup) this.editMarkersGroup = L.layerGroup();

        // Remove main polyline
        if (this.currentRoute && this.map.hasLayer(this.currentRoute)) {
            this.map.removeLayer(this.currentRoute);
        }
        this.currentRoute = null;

        // Remove segmented polylines
        if (this.routeLayers && this.routeLayers.length > 0) {
            this.routeLayers.forEach(layer => {
                if (this.map.hasLayer(layer)) {
                    this.map.removeLayer(layer);
                }
            });
        }
        this.routeLayers = [];

        // Remove data point markers
        if (this.dataPointsLayerGroup && this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }
        this.dataPointsLayerGroup.clearLayers();

        // Remove edit mode markers
        if (this.editMarkersGroup && this.map.hasLayer(this.editMarkersGroup)) {
            this.map.removeLayer(this.editMarkersGroup);
        }
        this.editMarkersGroup.clearLayers();

        // Remove pause point markers and layers
        if (this.pausePointsLayer && this.map.hasLayer(this.pausePointsLayer)) {
            this.map.removeLayer(this.pausePointsLayer);
        }
        this.pausePointsLayer = null;

        // Remove start/end markers
        if (this.startMarker && this.map.hasLayer(this.startMarker)) {
            this.map.removeLayer(this.startMarker);
        }
        this.startMarker = null;
        if (this.endMarker && this.map.hasLayer(this.endMarker)) {
            this.map.removeLayer(this.endMarker);
        }
        this.endMarker = null;
        
        console.log('All layers cleared.');
    }

    // Simplify points for display performance using distance-based decimation
    simplifyPointsForDisplay(points, maxPoints = 200, minDistance = 50) {
        if (!points || points.length <= maxPoints) return points;
        
        const simplified = [points[0]]; // Always keep first point
        let lastIncluded = points[0];
        
        for (let i = 1; i < points.length - 1; i++) {
            const current = points[i];
            const distance = this.calculateDistance(lastIncluded.lat, lastIncluded.lng, current.lat, current.lng);
            
            // Always include merged points (critical for route continuity after point merging)
            const isMergedPoint = current._merged === true;
            
            // Include point if it's merged, far enough, or we need to sample more
            if (isMergedPoint || distance > minDistance || simplified.length < maxPoints / 2) {
                simplified.push(current);
                lastIncluded = current;
            }
        }
        
        simplified.push(points[points.length - 1]); // Always keep last point
        return simplified;
    }
    
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    buildRouteDataPoints(routeData) {
        this.dataPointsLayerGroup.clearLayers();
        if (this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }
        if (!routeData || !routeData.points) return;
        
        // Archive original points but simplify for display
        const originalCount = routeData.points.length;
        const displayPoints = this.simplifyPointsForDisplay(routeData.points, 200, 25);
        
        console.log(`📍 Point optimization: ${originalCount} original → ${displayPoints.length} displayed`);
        
        displayPoints.forEach((p, index) => {
            const isKeyPoint = index === 0 || index === displayPoints.length - 1;
            const popup = `<div style="font-size:12px;">
                📍 ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}<br>
                ${p.speed !== undefined && p.speed !== null ? `🚀 ${(p.speed * 3.6).toFixed(1)} km/h<br>` : ''}
                ${p.alt !== undefined && p.alt !== null ? `⛰️ ${p.alt}m<br>` : ''}
                🕒 ${new Date(p.timestamp).toLocaleTimeString()}<br>
                <small>${isKeyPoint ? '(Key Point)' : `Point ${index + 1}/${displayPoints.length}`}</small>
            </div>`;
            L.circleMarker([p.lat, p.lng], {
                radius: isKeyPoint ? 6 : 4,
                color: isKeyPoint ? '#27ae60' : '#c0392b',
                fillColor: isKeyPoint ? '#2ecc71' : '#e74c3c',
                fillOpacity: isKeyPoint ? 0.9 : 0.7,
                weight: isKeyPoint ? 2 : 1.5
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
        
        console.log(`✏️ Entering edit mode for: ${this.currentRouteData.name} - ${this.currentRouteData.points?.length} points`);
        console.log('Edit mode - First few points:', this.currentRouteData.points?.slice(0, 3));
        console.log('Edit mode - Last few points:', this.currentRouteData.points?.slice(-3));
        
        this.editMode = true;
        this.mergeMode = false;
        // Record when editing started — used to preserve GPS points that arrive during the session
        this._editSnapshotTime = this.currentRouteData.points.length > 0
            ? this.currentRouteData.points[this.currentRouteData.points.length - 1].timestamp
            : new Date().toISOString();

        // Hide regular data point dots
        if (this.map.hasLayer(this.dataPointsLayerGroup)) {
            this.map.removeLayer(this.dataPointsLayerGroup);
        }

        this.buildEditMarkers();
        this.setupRouteContextMenu();

        // Disable map zoom and keyboard, and initially disable dragging
        this.map.touchZoom.disable();
        this.map.doubleClickZoom.disable();
        this.map.scrollWheelZoom.disable();
        this.map.boxZoom.disable();
        this.map.keyboard.disable();
        this.map.dragging.disable();
        
        // Set up Alt key listeners for map dragging control
        this.setupEditModeKeyListeners();

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
            btn.innerHTML = `<i class="fas fa-times"></i> ${this.t ? this.t('map.exit_edit', 'Exit Edit') : 'Exit Edit'}`;
        }
        this.showNotification('Edit mode — Alt+drag to move map · drag points to move · right-click for options · Esc to exit', 'info');
    }

    exitEditMode(restorePoints = true) {
        this.editMode = false;
        this.mergeMode = false;
        this.hideEditContextMenu();
        this.exitMergeMode();
        this.resetMergeMode();

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

        // Re-enable all map interactions
        this.map.dragging.enable();
        this.map.touchZoom.enable();
        this.map.doubleClickZoom.enable();
        this.map.scrollWheelZoom.enable();
        this.map.boxZoom.enable();
        this.map.keyboard.enable();
        
        // Remove edit mode key listeners
        this.removeEditModeKeyListeners();

        // Restore map to normal size and re-enable page scroll
        const section = document.querySelector('.map-section');
        if (section) section.classList.remove('map-edit-fullscreen');
        document.body.style.overflow = '';
        this.map.invalidateSize();

        const btn = document.getElementById('edit-mode-btn');
        if (btn) {
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-secondary');
            btn.innerHTML = `<i class="fas fa-pencil-alt"></i> ${this.t ? this.t('map.edit_points', 'Edit Points') : 'Edit Points'}`;
        }
    }

    buildEditMarkers() {
        // Use the new updateEditMarkers function which handles selection highlighting
        this.updateEditMarkers();
    }

    // Redraw polyline for edit mode with merged point handling
    redrawMergedEditPolyline() {
        if (!this.currentRouteData?.points) return;
        
        // Clear only route visuals, keep edit markers on map
        if (this.currentRoute && this.map.hasLayer(this.currentRoute)) {
            this.map.removeLayer(this.currentRoute);
        }
        this.currentRoute = null;

        if (this.routeLayers && this.routeLayers.length > 0) {
            this.routeLayers.forEach(layer => {
                if (this.map.hasLayer(layer)) {
                    this.map.removeLayer(layer);
                }
            });
        }
        this.routeLayers = [];
        if (this.pausePointsLayer && this.map.hasLayer(this.pausePointsLayer)) {
            this.map.removeLayer(this.pausePointsLayer);
        }
        this.pausePointsLayer = null;
        
        // Draw clean polyline connecting all points including merged points
        const routePoints = this.currentRouteData.points.map(p => [p.lat, p.lng]);
        
        if (routePoints.length > 1) {
            this.currentRoute = L.polyline(routePoints, {
                color: '#34495e',
                weight: 4,
                opacity: 0.7,
                className: 'edit-mode-route'
            }).addTo(this.map);
        }
    }
    
    // Highlight merged point after creation
    highlightMergedPoint(pointIndex) {
        if (!this.currentRouteData?.points[pointIndex]) return;
        
        const point = this.currentRouteData.points[pointIndex];
        
        // Brief highlight animation
        const highlight = L.circleMarker([point.lat, point.lng], {
            radius: 15,
            color: '#f39c12',
            fillColor: 'transparent',
            weight: 4,
            opacity: 1
        }).addTo(this.map);
        
        // Animate highlight
        let opacity = 1;
        const fadeOut = setInterval(() => {
            opacity -= 0.1;
            highlight.setStyle({ opacity });
            if (opacity <= 0) {
                this.map.removeLayer(highlight);
                clearInterval(fadeOut);
            }
        }, 100);
        
        // Show instruction
        setTimeout(() => {
            this.showNotification('Drag the orange merged point to adjust its final position', 'info');
        }, 1000);
    }

    showEditContextMenu(event, pointIndex) {
        // Prevent default context menu and stop propagation immediately
        event.preventDefault();
        event.stopPropagation();
        
        const menu = document.getElementById('route-context-menu');
        if (!menu) return;
        
        // Close any open popups
        this.map.closePopup();
        
        // Position near cursor but keep inside viewport
        const x = Math.min(event.clientX, window.innerWidth - 180);
        const y = Math.min(event.clientY, window.innerHeight - 90);
        menu.style.left = x + window.scrollX + 'px';
        menu.style.top  = y + window.scrollY + 'px';
        menu.style.display = 'block';
        menu.dataset.pointIndex = pointIndex;
        
        console.log(`Context menu shown for point ${pointIndex} at (${x}, ${y})`);
    }

    hideEditContextMenu() {
        const menu = document.getElementById('route-context-menu');
        if (menu) menu.style.display = 'none';
    }

    // Enhanced context menu setup for route analysis features
    setupRouteContextMenu() {
        // Remove existing context menu listeners - using point-specific context menus instead
        this.map.off('contextmenu');
        
        // Context menus are now handled by individual point markers
        // This prevents conflicting menu systems during edit mode
    }

    createEnhancedContextMenu(latlng) {
        const nearestPoint = this.findNearestRoutePoint(latlng.lat, latlng.lng);
        
        return L.popup({
            className: 'route-context-menu enhanced-context',
            closeButton: false,
            autoClose: false,
            closeOnClick: true
        }).setLatLng(latlng).setContent(`
            <div class="enhanced-context-menu">
                <h4>🛠️ Route Tools</h4>
                <div class="context-menu-section">
                    <h5>✂️ Route Operations</h5>
                    <button onclick="routeTracker.splitRouteAt(${latlng.lat}, ${latlng.lng}, ${nearestPoint.index})" class="context-btn">
                        ✂️ Split Route Here
                    </button>
                    <button onclick="routeTracker.addPauseMarker(${latlng.lat}, ${latlng.lng})" class="context-btn">
                        🛑 Mark as Pause Point
                    </button>
                </div>
                <div class="context-menu-section">
                    <h5>📍 Point Operations</h5>
                    <button onclick="routeTracker.contextMenuAddAfter(); routeTracker.map.closePopup();" class="context-btn">
                        ➕ Add Point After
                    </button>
                    <button onclick="routeTracker.contextMenuDelete(); routeTracker.map.closePopup();" class="context-btn">
                        ❌ Delete Point
                    </button>
                </div>
                <div class="context-menu-section">
                    <h5>🔍 Analysis</h5>
                    <button onclick="routeTracker.triggerRouteAnalysis()" class="context-btn">
                        🔍 Re-analyze Route
                    </button>
                    <button onclick="routeTracker.toggleVisualizationFeature('showPausePoints')" class="context-btn">
                        👁️ Toggle Pause Points
                    </button>
                </div>
            </div>
        `);
    }

    findNearestRoutePoint(lat, lng) {
        if (!this.currentRouteData?.points?.length) return { index: 0, distance: Infinity };
        
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        
        this.currentRouteData.points.forEach((point, index) => {
            const distance = Math.sqrt(
                Math.pow(point.lat - lat, 2) + Math.pow(point.lng - lng, 2)
            );
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });
        
        return { index: nearestIndex, distance: nearestDistance };
    }

    // Split route at specified location
    async splitRouteAt(lat, lng, pointIndex) {
        console.log('splitRouteAt called with:', { lat, lng, pointIndex });
        this.map.closePopup();
        
        if (pointIndex <= 0 || pointIndex >= this.currentRouteData.points.length - 1) {
            console.log('Cannot split at route boundaries. Index:', pointIndex, 'Length:', this.currentRouteData.points.length);
            this.showNotification('Cannot split at route start or end', 'warning');
            return;
        }
        
        console.log('Showing confirmation dialog...');
        const part1Count = pointIndex + 1;
        const part2Count = this.currentRouteData.points.length - (pointIndex + 1);
        const confirmed = confirm(`Split route at point ${pointIndex + 1}? This will create 2 separate routes:\n\n` +
                                `Part 1: ${part1Count} points (start to split point)\n` +
                                `Part 2: ${part2Count} points (after split point to end)`);
        if (!confirmed) {
            console.log('User cancelled split operation');
            return;
        }
        
        console.log('User confirmed split, proceeding...');
        try {
            // Create two new routes
            const originalName = this.currentRouteData.name;
            const splitTimestamp = this.currentRouteData.points[pointIndex].timestamp;
            const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            
            const route1 = {
                ...this.currentRouteData,
                id: `${this.currentRouteData.id}_part1_${timestamp}`,
                name: `${originalName} (Part 1 - ${timestamp})`,
                points: this.currentRouteData.points.slice(0, pointIndex + 1),
                endTime: splitTimestamp,
                status: 'completed'
            };
            
            const route2 = {
                ...this.currentRouteData,  
                id: `${this.currentRouteData.id}_part2_${timestamp}`,
                name: `${originalName} (Part 2 - ${timestamp})`,
                points: this.currentRouteData.points.slice(pointIndex + 1),
                startTime: splitTimestamp
            };
            
            // Recalculate distances for both parts
            route1.totalDistance = this.calculateRouteDistance(route1.points);
            route2.totalDistance = this.calculateRouteDistance(route2.points);
            
            console.log('Route 1 data:', { 
                name: route1.name, 
                points: route1.points.length, 
                distance: route1.totalDistance,
                firstPoint: route1.points[0],
                lastPoint: route1.points[route1.points.length - 1],
                pointRange: `0 to ${pointIndex}`,
                actualSlice: `slice(0, ${pointIndex + 1})`
            });
            console.log('Route 2 data:', { 
                name: route2.name, 
                points: route2.points.length, 
                distance: route2.totalDistance,
                firstPoint: route2.points[0],
                lastPoint: route2.points[route2.points.length - 1],
                pointRange: `${pointIndex + 1} to ${this.currentRouteData.points.length - 1}`,
                actualSlice: `slice(${pointIndex + 1})`
            });
            
            // Verify no overlap
            const totalOriginal = this.currentRouteData.points.length;
            const totalSplit = route1.points.length + route2.points.length;
            console.log('Point verification:', {
                originalTotal: totalOriginal,
                splitTotal: totalSplit,
                difference: totalOriginal - totalSplit,
                splitIndex: pointIndex
            });
            
            // Validate split makes sense
            if (route1.points.length === 0 || route2.points.length === 0) {
                throw new Error('Route split resulted in empty route - invalid split point');
            }
            if (totalSplit !== totalOriginal) {
                throw new Error(`Point count mismatch: Original ${totalOriginal}, Split total ${totalSplit}, should be equal`);
            }
            if (Math.abs(route1.points.length - route2.points.length) < 2) {
                console.warn('WARNING: Split routes have very similar point counts - possible split logic issue');
            }
            
            // Save split routes using copy endpoint pattern
            console.log('Creating first route copy...');
            const response1 = await this.apiCall(`/api/routes/${this.currentRouteData.id}/copy`, {
                method: 'POST',
                body: JSON.stringify({
                    name: route1.name,
                    deviceId: this.selectedDeviceId
                })
            });
            
            let route1Updated = false;
            let route2Updated = false;
            
            // Create second route by copying first split result
            let route1Result = null;
            if (response1.ok) {
                try {
                    route1Result = await response1.json();
                    console.log('First route created:', route1Result?.newRouteId);
                    console.log('Full route1Result:', route1Result);
                } catch (e) {
                    console.error('Failed to parse route1 response JSON:', e);
                    const responseText = await response1.text();
                    console.error('Route1 response text:', responseText);
                    throw new Error(`Failed to parse first route response: ${e.message}`);
                }
                
                // Now manually update the first route with correct points
                if (route1Result?.newRouteId) {
                    console.log('Updating first route points...');
                    console.log('Route 1 points to update:', route1.points.length, 'first:', route1.points[0], 'last:', route1.points[route1.points.length-1]);
                    const updateResponse1 = await this.apiCall(`/api/routes/${route1Result.newRouteId}/points`, {
                        method: 'PUT',
                        body: JSON.stringify({ points: route1.points })
                    });
                    console.log('First route points update response:', updateResponse1.status);
                    if (!updateResponse1.ok) {
                        const errorText = await updateResponse1.text();
                        console.error('Failed to update route 1 points:', errorText);
                    } else {
                        const updateResult1 = await updateResponse1.json();
                        console.log('Route 1 update result:', updateResult1);
                        route1Updated = true;
                        console.log(`Route 1 points updated: ${route1.points.length} points`);
                    }
                } else {
                    console.error('Cannot update route 1 points - no route ID');
                }
            } else {
                console.error('Failed to create first route:', response1.status);
                const errorText = await response1.text();
                console.error('Response1 error:', errorText);
            }
            
            console.log('Creating second route copy...');
            const response2 = await this.apiCall(`/api/routes/${this.currentRouteData.id}/copy`, {
                method: 'POST',
                body: JSON.stringify({
                    name: route2.name,
                    deviceId: this.selectedDeviceId
                })
            });
            
            let route2Result = null;
            if (response2.ok) {
                try {
                    route2Result = await response2.json();
                    console.log('Second route created:', route2Result?.newRouteId);
                    console.log('Full route2Result:', route2Result);
                } catch (e) {
                    console.error('Failed to parse route2 response JSON:', e);
                    const responseText = await response2.text();
                    console.error('Route2 response text:', responseText);
                    throw new Error(`Failed to parse second route response: ${e.message}`);
                }
                
                // Update the second route with correct points
                if (route2Result?.newRouteId) {
                    console.log('Updating second route points...');
                    console.log('Route 2 points to update:', route2.points.length, 'first:', route2.points[0], 'last:', route2.points[route2.points.length-1]);
                    const updateResponse2 = await this.apiCall(`/api/routes/${route2Result.newRouteId}/points`, {
                        method: 'PUT',
                        body: JSON.stringify({ points: route2.points })
                    });
                    console.log('Second route points update response:', updateResponse2.status);
                    if (!updateResponse2.ok) {
                        const errorText = await updateResponse2.text();
                        console.error('Failed to update route 2 points:', errorText);
                    } else {
                        const updateResult2 = await updateResponse2.json();
                        console.log('Route 2 update result:', updateResult2);
                        route2Updated = true;
                        console.log(`Route 2 points updated: ${route2.points.length} points`);
                    }
                } else {
                    console.error('Cannot update route 2 points - no route ID');
                }
            } else {
                console.error('Failed to create second route:', response2.status);
                const errorText = await response2.text();
                console.error('Response2 error:', errorText);
            }
            
            if (response1.ok && response2.ok && route1Result && route2Result && route1Updated && route2Updated) {
                console.log('Both split routes saved and updated successfully');
                console.log('Route 1 result:', route1Result);
                console.log('Route 2 result:', route2Result);
                
                // Validate response structure
                if (!route1Result?.newRouteId) {
                    throw new Error('Route 1 response missing newRouteId');
                }
                if (!route2Result?.newRouteId) {
                    throw new Error('Route 2 response missing newRouteId');
                }
                
                this.showNotification(`Route split successfully! Created "${route1Result.newRouteName}" and "${route2Result.newRouteName}"`, 'success');
                
                // Optionally archive original route
                const archiveOriginal = confirm('Archive the original route?');
                console.log('Archive original?', archiveOriginal);
                if (archiveOriginal) {
                    await this.archiveRoute(this.currentRouteData.id);
                    console.log('Original route archived');
                }
                
                this.exitEditMode(false);
                console.log('Exited edit mode, waiting for server to process updates...');
                
                // Wait a moment for server to finish processing
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                console.log('Reloading routes list...');
                await this.loadDevicesAndRoutes(); // Full refresh instead of just route list
                
                // Load the first part of the split route with fresh data
                console.log('Loading first split route with fresh data:', route1Result.newRouteId);
                await this.loadRoute(route1Result.newRouteId);
            } else {
                console.error('Failed to save split routes completely.');
                console.error('Response1 ok:', response1.ok, 'Response2 ok:', response2.ok);
                console.error('Route1 updated:', route1Updated, 'Route2 updated:', route2Updated);
                console.error('Route1Result:', route1Result);
                console.error('Route2Result:', route2Result);
                
                let errorMsg = 'Failed to split route: ';
                if (!response1.ok) {
                    errorMsg += 'First route creation failed. ';
                } else if (!route1Result) {
                    errorMsg += 'First route response was empty. ';
                } else if (!route1Result.newRouteId) {
                    errorMsg += 'First route response missing newRouteId. ';
                } else if (!route1Updated) {
                    errorMsg += 'Route 1 points update failed. ';
                }
                
                if (!response2.ok) {
                    errorMsg += 'Second route creation failed. ';
                } else if (!route2Result) {
                    errorMsg += 'Second route response was empty. ';
                } else if (!route2Result.newRouteId) {
                    errorMsg += 'Second route response missing newRouteId. ';
                } else if (!route2Updated) {
                    errorMsg += 'Route 2 points update failed. ';
                }
                
                throw new Error(errorMsg);
            }
            
        } catch (error) {
            console.error('Route split error:', error);
            console.error('Error stack:', error.stack);
            const errorMsg = 'Failed to split route: ' + error.message;
            this.showNotification(errorMsg, 'error', 10000); // Show error for 10 seconds
            alert('Route Split Error:\\n\\n' + errorMsg + '\\n\\nCheck console for details.');
        }
    }

    // Add a pause marker at specified location
    addPauseMarker(lat, lng) {
        this.map.closePopup();
        
        if (!this.currentRouteData.analysis) {
            this.currentRouteData.analysis = { segments: [], pausePoints: [], splitPoints: [] };
        }
        
        const pausePoint = {
            lat: lat,
            lng: lng,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 0,
            manual: true,
            pointIndices: [],
            approaches: [],
            departures: []
        };
        
        this.currentRouteData.analysis.pausePoints.push(pausePoint);
        
        // Redraw with new pause point
        this.displayRoute(this.currentRouteData);
        this.showNotification('Manual pause point added', 'success');
    }

    // Trigger route analysis
    async triggerRouteAnalysis() {
        if (this.map?.closePopup) this.map.closePopup();
        
        if (!this.currentRouteData?.points?.length) {
            console.log('No route data to analyze');
            return;
        }
        
        this.showNotification('Analyzing route...', 'info');
        
        try {
            const response = await this.apiCall(`/api/routes/${this.currentRouteData.id}/analyze`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const updatedRoute = await response.json();
                this.currentRouteData = updatedRoute;
                // Use smart display for analyzed routes
                if (updatedRoute.analysis) {
                    this.clearAllLayers();
                    this.displaySmartRoute(updatedRoute);
                }
                this.showNotification('Route analysis completed!', 'success');
            } else {
                console.log('Analysis failed, keeping simple display');
            }
        } catch (error) {
            console.error('Route analysis error:', error);
            this.showNotification('Route analysis failed: ' + error.message, 'error');
        }
    }

    // Toggle visualization features
    toggleVisualizationFeature(feature) {
        this.map.closePopup();
        
        if (!this.currentRouteData?.visualization) return;
        
        this.currentRouteData.visualization[feature] = !this.currentRouteData.visualization[feature];
        
        // Redraw route with updated visualization settings
        this.displayRoute(this.currentRouteData);
        
        const status = this.currentRouteData.visualization[feature] ? 'enabled' : 'disabled';
        this.showNotification(`${feature.replace(/([A-Z])/g, ' $1').toLowerCase()} ${status}`, 'info');
    }

    // ========================================================= 
    // POINT MERGING FUNCTIONALITY
    // ========================================================= 
    
    toggleMergeMode() {
        this.mergeMode = !this.mergeMode;
        const btn = document.getElementById('merge-mode-btn');
        const executeBtn = document.getElementById('execute-merge-btn');
        
        if (this.mergeMode) {
            this.enterMergeMode();
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-warning');
            btn.innerHTML = '<i class="fas fa-times"></i> Cancel Merge';
            executeBtn.style.display = 'inline-block';
        } else {
            this.exitMergeMode();
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-primary');
            btn.innerHTML = '<i class="fas fa-object-group"></i> Merge Points';
            executeBtn.style.display = 'none';
        }
    }
    
    // Reset merge mode UI after successful merge
    resetMergeMode() {
        const btn = document.getElementById('merge-mode-btn');
        const executeBtn = document.getElementById('execute-merge-btn');
        
        if (btn) {
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-primary');
            btn.innerHTML = '<i class="fas fa-object-group"></i> Merge Points';
        }
        
        if (executeBtn) {
            executeBtn.style.display = 'none';
        }
    }
    
    enterMergeMode() {
        if (!this.editMode) {
            this.showNotification('Enter edit mode first', 'warning');
            return;
        }
        
        this.mergeMode = true;
        this.selectedPoints = new Set(); // Track selected point indices
        this.selectionRectangle = null;
        this.drawing = false;
        this.startPoint = null;
        
        // Disable map dragging and interactions
        this.map.dragging.disable();
        this.map.touchZoom.disable();
        this.map.doubleClickZoom.disable();
        this.map.scrollWheelZoom.disable();
        this.map.boxZoom.disable();
        this.map.keyboard.disable();
        
        // Set up drawing and selection event handlers
        this.map.on('mousedown', this.startRectangleSelection.bind(this));
        this.map.on('mousemove', this.updateRectangleSelection.bind(this));
        this.map.on('mouseup', this.finishRectangleSelection.bind(this));
        this.map.on('click', this.handlePointSelection.bind(this));
        
        // Add visual feedback for selected points
        this.updateEditMarkers();
        
        this.showNotification('Merge mode: Draw rectangle to select points · Alt+click for individual points · Press Merge to combine', 'info');
    }
    
    exitMergeMode() {
        this.mergeMode = false;
        this.drawing = false;
        this.selectedPoints = new Set();
        
        // Re-enable map interactions
        this.map.dragging.enable();
        this.map.touchZoom.enable();
        this.map.doubleClickZoom.enable();
        this.map.scrollWheelZoom.enable();
        this.map.boxZoom.enable();
        this.map.keyboard.enable();
        
        // Remove event handlers
        this.map.off('mousedown', this.startRectangleSelection.bind(this));
        this.map.off('mousemove', this.updateRectangleSelection.bind(this));
        this.map.off('mouseup', this.finishRectangleSelection.bind(this));
        this.map.off('click', this.handlePointSelection.bind(this));
        
        // Clear selection rectangle
        if (this.selectionRectangle) {
            this.map.removeLayer(this.selectionRectangle);
            this.selectionRectangle = null;
        }
        
        // Reset edit markers to normal appearance
        this.updateEditMarkers();
    }
    
    // Set up keyboard listeners for Alt+drag map control in edit mode
    setupEditModeKeyListeners() {
        this.editModeKeyDown = (e) => {
            if (e.altKey && !this.map.dragging.enabled()) {
                this.map.dragging.enable();
            }
        };
        
        this.editModeKeyUp = (e) => {
            if (!e.altKey && this.map.dragging.enabled()) {
                this.map.dragging.disable();
            }
        };
        
        document.addEventListener('keydown', this.editModeKeyDown);
        document.addEventListener('keyup', this.editModeKeyUp);
        
        // Also listen for Alt key release when focus leaves window
        window.addEventListener('blur', () => {
            if (this.editMode) this.map.dragging.disable();
        });
    }
    
    // Remove edit mode keyboard listeners
    removeEditModeKeyListeners() {
        if (this.editModeKeyDown) {
            document.removeEventListener('keydown', this.editModeKeyDown);
            this.editModeKeyDown = null;
        }
        if (this.editModeKeyUp) {
            document.removeEventListener('keyup', this.editModeKeyUp);
            this.editModeKeyUp = null;
        }
        
        window.removeEventListener('blur', () => {
            if (this.editMode) this.map.dragging.disable();
        });
    }
    
    startRectangleSelection(e) {
        if (!this.mergeMode || e.originalEvent.defaultPrevented) return;
        
        // Only start rectangle selection with left mouse button (no modifiers)
        if (e.originalEvent.altKey || e.originalEvent.ctrlKey || e.originalEvent.shiftKey) return;
        
        this.drawing = true;
        this.startPoint = e.latlng;
        
        // Clear previous selection rectangle
        if (this.selectionRectangle) {
            this.map.removeLayer(this.selectionRectangle);
        }
        
        // Create new rectangle
        this.selectionRectangle = L.rectangle([[e.latlng.lat, e.latlng.lng], [e.latlng.lat, e.latlng.lng]], {
            color: '#3498db',
            weight: 2,
            opacity: 0.8,
            fillColor: '#3498db',
            fillOpacity: 0.1,
            dashArray: '5, 5'
        }).addTo(this.map);
        
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
    }
    
    updateRectangleSelection(e) {
        if (!this.drawing || !this.mergeMode || !this.startPoint) return;
        
        // Update rectangle bounds
        const bounds = L.latLngBounds(this.startPoint, e.latlng);
        this.selectionRectangle.setBounds(bounds);
    }
    
    finishRectangleSelection(e) {
        if (!this.drawing || !this.mergeMode) return;
        
        this.drawing = false;
        
        if (!this.startPoint) return;
        
        // Find points within the rectangle
        const bounds = L.latLngBounds(this.startPoint, e.latlng);
        const pointsInRectangle = this.findPointsInBounds(bounds);
        
        if (pointsInRectangle.length === 0) {
            this.showNotification('No points found in selection area', 'info');
            this.map.removeLayer(this.selectionRectangle);
            return;
        }
        
        // Add points to selection
        pointsInRectangle.forEach(pointData => {
            this.selectedPoints.add(pointData.index);
        });
        
        this.updateEditMarkers();
        this.showNotification(`Selected ${pointsInRectangle.length} points (${this.selectedPoints.size} total selected)`, 'info');
        
        // Clear rectangle
        this.map.removeLayer(this.selectionRectangle);
        this.selectionRectangle = null;
        this.startPoint = null;
    }
    
    handlePointSelection(e) {
        if (!this.mergeMode || !e.originalEvent.altKey) return;
        
        // Find closest point to click
        const clickPoint = e.latlng;
        let closestPointIndex = -1;
        let minDistance = Infinity;
        
        this.currentRouteData.points.forEach((point, index) => {
            const distance = this.calculateDistance(
                clickPoint.lat, clickPoint.lng,
                point.lat, point.lng
            );
            
            if (distance < minDistance && distance < 100) { // Within 100 meters
                minDistance = distance;
                closestPointIndex = index;
            }
        });
        
        if (closestPointIndex >= 0) {
            if (this.selectedPoints.has(closestPointIndex)) {
                this.selectedPoints.delete(closestPointIndex);
                this.showNotification(`Point deselected (${this.selectedPoints.size} selected)`, 'info');
            } else {
                this.selectedPoints.add(closestPointIndex);
                this.showNotification(`Point selected (${this.selectedPoints.size} selected)`, 'info');
            }
            
            this.updateEditMarkers();
        }
        
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
    }
    
    findPointsInBounds(bounds) {
        if (!this.currentRouteData?.points) return [];
        
        const pointsInBounds = [];
        
        for (let i = 0; i < this.currentRouteData.points.length; i++) {
            const point = this.currentRouteData.points[i];
            const latlng = L.latLng(point.lat, point.lng);
            
            if (bounds.contains(latlng)) {
                pointsInBounds.push({ index: i, point: point });
            }
        }
        
        return pointsInBounds;
    }
    
    updateEditMarkers() {
        // Rebuild edit markers with selection highlighting and merged point special styling
        this.editMarkersGroup.clearLayers();
        
        if (!this.currentRouteData?.points) return;
        
        this.currentRouteData.points.forEach((point, index) => {
            const isSelected = this.selectedPoints && this.selectedPoints.has(index);
            const isMerged = point._merged === true;
            
            let radius, color, fillColor, weight, className;
            
            if (isMerged) {
                // Special styling for merged points
                radius = 10;
                color = '#e67e22';
                fillColor = '#f39c12';
                weight = 3;
                className = 'edit-point-marker merged-point';
            } else if (isSelected) {
                // Selected points
                radius = 8;
                color = '#e74c3c';
                fillColor = '#c0392b';
                weight = 3;
                className = 'edit-point-marker selected-point';
            } else {
                // Normal points
                radius = 6;
                color = '#3498db';
                fillColor = '#2980b9';
                weight = 2;
                className = 'edit-point-marker';
            }
            
            const marker = L.circleMarker([point.lat, point.lng], {
                radius,
                color,
                fillColor,
                fillOpacity: 0.8,
                weight,
                className
            });
            
            // Create larger clickable area (3x bigger) with light grey background
            const clickRadius = radius * 3;
            const clickArea = L.circleMarker([point.lat, point.lng], {
                radius: clickRadius,
                color: '#cccccc',
                fillColor: 'transparent',
                fillOpacity: 0,
                weight: 1,
                className: 'edit-point-clickarea'
            });
            
            // Add both markers to a group so they move together
            // Put clickArea first so it's behind the visual marker
            const markerGroup = L.layerGroup([clickArea, marker]);
            
            // Add custom drag functionality for circle markers (not in merge mode)
            if (!this.mergeMode) {
                // Make both the click area and visual marker draggable
                this.addDragHandlers(clickArea, marker, index);
                this.addDragHandlers(marker, marker, index);
            }
            
            // Add popup with point info and action buttons
            let popupContent = `
                <div style="font-size:12px;">
                    📍 Point ${index + 1}<br>
                    ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}<br>
                    ${point.timestamp ? new Date(point.timestamp).toLocaleString() : ''}
            `;
            
            if (isMerged) {
                popupContent += `<br><strong>🔗 MERGED POINT</strong><br><small>Combined ${point.merged_from} points</small>`;
            } else if (isSelected) {
                popupContent += '<br><strong>SELECTED</strong>';
            }
            
            // Note: Action buttons removed - use right-click context menu instead
            popupContent += `</div>`;
            
            // Bind all interactions to both the larger clickable area and the visual marker
            clickArea.bindPopup(popupContent);
            marker.bindPopup(popupContent);
            
            // Add context menu for right-click on both areas
            const contextMenuHandler = (e) => {
                // Don't show popup on right-click
                clickArea.closePopup();
                marker.closePopup();
                this.showEditContextMenu(e.originalEvent, index);
                return false; // Prevent event bubbling
            };
            
            clickArea.on('contextmenu', contextMenuHandler);
            marker.on('contextmenu', contextMenuHandler);
            
            this.editMarkersGroup.addLayer(markerGroup);
        });
        
        if (!this.map.hasLayer(this.editMarkersGroup)) {
            this.editMarkersGroup.addTo(this.map);
        }
        
        // Update polyline if in edit mode
        if (this.editMode) {
            this.redrawMergedEditPolyline();
        }
    }
    
    // Add drag handlers to a marker
    addDragHandlers(dragTarget, visualMarker, pointIndex) {
        let isDragging = false;
        let dragStarted = false;
        
        dragTarget.on('mousedown', (e) => {
            // Only start dragging if not holding Alt (Alt is for map movement)
            if (e.originalEvent.altKey) return;
            
            isDragging = true;
            dragStarted = false;
            
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            
            // Add temporary mouse move listener to the map
            const onMouseMove = (moveEvent) => {
                if (isDragging) {
                    dragStarted = true;
                    // Update visual marker position during drag
                    visualMarker.setLatLng(moveEvent.latlng);
                    // If dragging the click area, update it too
                    if (dragTarget !== visualMarker) {
                        dragTarget.setLatLng(moveEvent.latlng);
                    }
                }
            };
            
            const onMouseUp = (upEvent) => {
                if (isDragging) {
                    isDragging = false;
                    
                    if (dragStarted) {
                        // Update the actual point data
                        const newPos = visualMarker.getLatLng();
                        this.currentRouteData.points[pointIndex].lat = +newPos.lat.toFixed(7);
                        this.currentRouteData.points[pointIndex].lng = +newPos.lng.toFixed(7);
                        
                        // Redraw route line
                        this.redrawMergedEditPolyline();
                    }
                }
                
                // Clean up event listeners
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            // Attach temporary listeners
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            document.addEventListener('mouseup', onMouseUp); // Backup for mouse leaving map area
        });
    }

    // Make circle marker draggable with custom implementation (legacy method)
    makeMarkerDraggable(clickArea, visualMarker, pointIndex) {
        let isDragging = false;
        let dragStarted = false;
        
        clickArea.on('mousedown', (e) => {
            // Only start dragging if not holding Alt (Alt is for map movement)
            if (e.originalEvent.altKey) return;
            
            isDragging = true;
            dragStarted = false;
            
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
            
            // Add temporary mouse move listener to the map
            const onMouseMove = (moveEvent) => {
                if (isDragging) {
                    dragStarted = true;
                    // Update both markers' positions during drag
                    clickArea.setLatLng(moveEvent.latlng);
                    visualMarker.setLatLng(moveEvent.latlng);
                }
            };
            
            const onMouseUp = (upEvent) => {
                if (isDragging) {
                    isDragging = false;
                    
                    if (dragStarted) {
                        // Update the actual point data
                        const newPos = visualMarker.getLatLng();
                        this.currentRouteData.points[pointIndex].lat = +newPos.lat.toFixed(7);
                        this.currentRouteData.points[pointIndex].lng = +newPos.lng.toFixed(7);
                        
                        // Redraw route line
                        this.redrawMergedEditPolyline();
                    }
                }
                
                // Clean up event listeners
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            // Attach temporary listeners
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            document.addEventListener('mouseup', onMouseUp); // Backup for mouse leaving map area
        });
    }
    
    // Simplified context menu functions for point operations
    addPointAfter(pointIndex) {
        console.log(`Adding point after index ${pointIndex}`);
        const pts = this.currentRouteData.points;
        
        let newPt;
        if (pointIndex < pts.length - 1) {
            // Midpoint between pointIndex and pointIndex+1
            const tA = new Date(pts[pointIndex].timestamp).getTime();
            const tB = new Date(pts[pointIndex + 1].timestamp).getTime();
            newPt = {
                lat: +((pts[pointIndex].lat + pts[pointIndex + 1].lat) / 2).toFixed(7),
                lng: +((pts[pointIndex].lng + pts[pointIndex + 1].lng) / 2).toFixed(7),
                timestamp: new Date((tA + tB) / 2).toISOString(),
                alt: (pts[pointIndex].alt !== null && pts[pointIndex + 1].alt !== null)
                    ? (pts[pointIndex].alt + pts[pointIndex + 1].alt) / 2
                    : pts[pointIndex].alt,
                speed: null,
                accuracy: null,
                _new: true
            };
        } else {
            // Last point — copy it with a tiny offset so it's visible
            newPt = { ...pts[pointIndex], lat: +(pts[pointIndex].lat + 0.00005).toFixed(7), _new: true };
        }
        
        pts.splice(pointIndex + 1, 0, newPt);
        console.log(`Point added at index ${pointIndex + 1}, total points now: ${pts.length}`);
        
        // Refresh the display
        this.updateEditMarkers();
        this.redrawMergedEditPolyline();
        this.showNotification('New point added — drag it to the right location', 'info');
    }
    
    deletePoint(pointIndex) {
        console.log(`Deleting point at index ${pointIndex}`);
        const pts = this.currentRouteData.points;
        
        if (pts.length <= 2) {
            this.showNotification('Cannot delete: route needs at least 2 points', 'warning');
            return;
        }
        
        pts.splice(pointIndex, 1);
        console.log(`Point deleted, total points now: ${pts.length}`);
        
        // Refresh the display
        this.updateEditMarkers();
        this.redrawMergedEditPolyline();
        this.showNotification('Point deleted', 'info');
    }
    
    closeContextMenu() {
        this.map.closePopup();
    }

    executePointMerge() {
        if (!this.selectedPoints || this.selectedPoints.size < 2) {
            this.showNotification('Select at least 2 points to merge', 'warning');
            return;
        }
        
        // Convert Set to array and prepare for merging
        const pointsToMerge = Array.from(this.selectedPoints).map(index => ({
            index: index,
            point: this.currentRouteData.points[index]
        }));
        
        // Sort by index for proper processing
        pointsToMerge.sort((a, b) => a.index - b.index);
        
        // Confirm merge
        if (confirm(`Merge ${pointsToMerge.length} selected points into one representative point?\nStay in edit mode to adjust final position.`)) {
            const mergedPointIndex = this.mergeSelectedPoints(pointsToMerge);
            this.selectedPoints.clear();
            
            // Exit merge mode but stay in edit mode
            this.exitMergeMode();
            this.resetMergeMode();
            
            // Refresh edit markers and highlight the merged point
            this.updateEditMarkers();
            
            // Focus on merged point for immediate editing
            this.highlightMergedPoint(mergedPointIndex);
            
            this.showNotification(`Merged ${pointsToMerge.length} points. You can now move the merged point to its final position.`, 'success');
        }
    }
    
    mergeSelectedPoints(pointsToMerge) {
        if (pointsToMerge.length < 2) return;
        
        // Calculate center position of selection (geometric center)
        const avgLat = pointsToMerge.reduce((sum, p) => sum + p.point.lat, 0) / pointsToMerge.length;
        const avgLng = pointsToMerge.reduce((sum, p) => sum + p.point.lng, 0) / pointsToMerge.length;
        
        // Find the optimal insertion point (middle of the sequence)
        const firstIndex = pointsToMerge[0].index;
        const lastIndex = pointsToMerge[pointsToMerge.length - 1].index;
        const middleIndex = Math.floor((firstIndex + lastIndex) / 2);
        
        // Create merged point with averaged position and metadata from middle point
        let basePoint = pointsToMerge[0].point;
        if (pointsToMerge.length > 2) {
            const middlePointData = pointsToMerge.find(p => p.index === middleIndex) || pointsToMerge[Math.floor(pointsToMerge.length / 2)];
            basePoint = middlePointData.point;
        }
        
        const mergedPoint = {
            ...basePoint,
            lat: avgLat,
            lng: avgLng,
            merged_from: pointsToMerge.length,
            merge_timestamp: new Date().toISOString(),
            _merged: true // Mark as merged point for special handling
        };
        
        // Get indices in reverse order for safe removal
        const indices = pointsToMerge.map(p => p.index).sort((a, b) => b - a);
        
        // Remove all selected points
        indices.forEach(index => {
            this.currentRouteData.points.splice(index, 1);
        });
        
        // Insert merged point at the position of the first removed point
        const insertIndex = indices[indices.length - 1]; // First index (smallest)
        this.currentRouteData.points.splice(insertIndex, 0, mergedPoint);
        
        console.log(`📍 Point merge: ${pointsToMerge.length} points → 1 point at ${avgLat.toFixed(6)}, ${avgLng.toFixed(6)} (index ${insertIndex})`);
        
        return insertIndex; // Return index of merged point
    }

    contextMenuAddAfter(pointIndex = null) {
        this.hideEditContextMenu();
        
        // Get point index from parameter or fallback to menu dataset
        let i;
        if (pointIndex !== null) {
            i = pointIndex;
        } else {
            const menu = document.getElementById('route-context-menu');
            i = parseInt(menu.dataset.pointIndex);
        }
        
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
        this.updateEditMarkers();
        this.showNotification('New point added in blue — drag it to the right location', 'info');
    }

    contextMenuSplitRoute(pointIndex = null) {
        console.log('contextMenuSplitRoute called with pointIndex:', pointIndex);
        this.hideEditContextMenu();
        
        // Get point index from parameter or fallback to menu dataset
        let i;
        if (pointIndex !== null) {
            i = pointIndex;
        } else {
            const menu = document.getElementById('route-context-menu');
            i = parseInt(menu.dataset.pointIndex);
            console.log('Got point index from menu dataset:', i);
        }
        
        console.log('Current route data:', this.currentRouteData);
        console.log('Points length:', this.currentRouteData?.points?.length);
        console.log('Attempting to split at index:', i);
        
        if (i >= 0 && i < this.currentRouteData.points.length) {
            const splitPoint = this.currentRouteData.points[i];
            console.log('Split point details:', {
                index: i,
                point: splitPoint,
                timestamp: splitPoint.timestamp,
                coordinates: [splitPoint.lat, splitPoint.lng]
            });
        }
        
        // Get the coordinates of the split point for the splitRouteAt function
        const pts = this.currentRouteData.points;
        if (i >= 0 && i < pts.length) {
            const point = pts[i];
            console.log('Calling splitRouteAt with:', point.lat, point.lng, i);
            this.splitRouteAt(point.lat, point.lng, i);
        } else {
            console.error('Invalid point index:', i, 'for points length:', pts.length);
            this.showNotification(this.t ? this.t('error.invalid_split_point', 'Invalid split point selected') : 'Invalid split point selected', 'error');
        }
    }

    contextMenuDelete(pointIndex = null) {
        this.hideEditContextMenu();
        
        // Get point index from parameter or fallback to menu dataset
        let i;
        if (pointIndex !== null) {
            i = pointIndex;
        } else {
            const menu = document.getElementById('route-context-menu');
            i = parseInt(menu.dataset.pointIndex);
        }
        
        const pts = this.currentRouteData.points;

        if (pts.length <= 2) {
            this.showNotification('Cannot delete: route needs at least 2 points', 'warning');
            return;
        }
        pts.splice(i, 1);
        this.updateEditMarkers();
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
            deviceStatus.className = `gps-ampel ${deviceData.currentRoute ? 'status-active' : 'status-inactive'}`;
            deviceStatus.title = deviceData.currentRoute ? 'Active Route' : 'No Active Route';
        }
        if (lastUpdate && deviceData.lastUpdate) {
            lastUpdate.textContent = new Date(deviceData.lastUpdate).toLocaleString();
        }
        const lastActivity = document.getElementById('last-activity');
        if (lastActivity && deviceData.lastUpdate) {
            const d = new Date(deviceData.lastUpdate);
            lastActivity.textContent = d.toLocaleString();
            lastActivity.style.display = '';
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
            const hasFilters = !!(this.historyFilters.dateFrom || this.historyFilters.dateTo || this.historyFilters.favoritesOnly);
            const msg = hasFilters
                ? (this.t ? this.t('history.no_matches', 'No routes match current filters.') : 'No routes match current filters.')
                : (this.t ? this.t('history.no_routes', 'No routes received yet. Configure your Overlander app to send GPS data to this server.') : 'No routes received yet. Configure your Overlander app to send GPS data to this server.');
            routeList.innerHTML = `<div class="route-item"><div class="route-info"><p>${msg}</p></div></div>`;
            this._updateMergeButton();
            return;
        }

routeList.innerHTML = routes.map(route => {
            const start = route.startTime ? new Date(route.startTime) : null;
            const end   = route.endTime   ? new Date(route.endTime)   : null;
            const fmt = (d) => {
                if (!d) return '—';
                try {
                    return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
                } catch {
                    // Older Safari can throw on dateStyle/timeStyle.
                    return d.toLocaleString();
                }
            };
            const statusBadge = route.status === 'active'
                ? `<span style="background:#27ae60;color:#fff;font-size:0.74em;padding:1px 6px;border-radius:10px;font-weight:600;">LIVE</span>`
                : '';
            const routeColor = route.color || '#e74c3c';
            const favIcon = route.favorite
                ? '<i class="fas fa-star" style="color:#f1c40f;margin-left:6px;"></i>'
                : '';
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
                        <h4>${colorDot}${route.name}${favIcon} ${statusBadge}</h4>
                        <div class="route-meta">${metaParts}</div>
                    </div>
                </div>
                <div class="route-actions">
                    <button class="btn btn-sm btn-primary history-action-btn" onclick="routeTracker.viewRoute('${route.id}')">
                        <i class="fas fa-eye"></i> ${this.t ? this.t('history.view', 'View') : 'View'}
                    </button>
                    <button class="btn btn-sm btn-secondary history-action-btn" onclick="routeTracker.exportRoute('${route.id}')">
                        <i class="fas fa-download"></i> ${this.t ? this.t('history.export', 'Export') : 'Export'}
                    </button>
                    <button class="btn btn-sm btn-info admin-only history-action-btn" onclick="routeTracker.editRoute('${route.id}', '${route.name.replace(/'/g, "\\'") }', '${route.color || '#e74c3c'}')">
                        <i class="fas fa-pencil-alt"></i> ${this.t ? this.t('history.rename', 'Rename') : 'Rename'}
                    </button>
                    <button class="btn btn-sm btn-warning admin-only history-action-btn" onclick="routeTracker.copyRoute('${route.id}', '${route.name.replace(/'/g, "\\'") }')" title="Copy route for testing/debugging">
                        <i class="fas fa-copy"></i> ${this.t ? this.t('history.copy', 'Copy') : 'Copy'}
                    </button>
                    <button class="btn btn-sm btn-secondary admin-only history-action-btn" onclick="routeTracker.toggleRouteFavorite('${route.id}', ${route.favorite === true})" title="${route.favorite ? (this.t ? this.t('history.unfavorite', 'Unfavorite') : 'Unfavorite') : (this.t ? this.t('history.favorite', 'Favorite') : 'Favorite')}">
                        <i class="${route.favorite ? 'fas' : 'far'} fa-star"></i>
                    </button>
                    <button class="btn btn-sm btn-danger admin-only history-action-btn" onclick="routeTracker.deleteRoute('${route.id}')">
                        <i class="fas fa-trash"></i> ${this.t ? this.t('history.move_to_basket', 'Move to Basket') : 'Move to Basket'}
                    </button>
                    ${route.status === 'active' ? `
                        <button class="btn btn-sm btn-warning admin-only history-action-btn" onclick="routeTracker.stopRoute('${route.id}')">
                            <i class="fas fa-stop"></i> ${this.t ? this.t('history.stop', 'Stop') : 'Stop'}
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-success admin-only history-action-btn" onclick="routeTracker.activateRoute('${route.id}')" title="Set as active — GPS will append here">
                            <i class="fas fa-play"></i> ${this.t ? this.t('history.set_active', 'Set Active') : 'Set Active'}
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
            btn.innerHTML = `<i class="fas fa-broadcast-tower"></i> ${this.t ? this.t('map.back_to_live', 'Back to Live') : 'Back to Live'}`;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-warning');
        } else {
            btn.innerHTML = `<i class="fas fa-expand-arrows-alt"></i> ${this.t ? this.t('map.reset_view', 'Reset View') : 'Reset View'}`;
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
        if (!confirm('Move this route to basket? It can be restored in Admin.')) return;
        try {
            const response = await this.apiCall(`/api/routes/${routeId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                this.showNotification(this.t ? this.t('history.move_to_basket', 'Move to Basket') : 'Moved to basket', 'success');
                await this.loadDevicesAndRoutes();
            } else {
                this.showNotification('Failed to move route to basket', 'error');
            }
        } catch (error) {
            this.showNotification('Error moving route to basket: ' + error.message, 'error');
        }
    }

    async toggleRouteFavorite(routeId, currentFavorite) {
        try {
            const response = await this.apiCall(`/api/routes/${routeId}/favorite`, {
                method: 'PATCH',
                body: JSON.stringify({ favorite: !currentFavorite })
            });
            if (response.ok) {
                await this.loadRoutesList();
            } else {
                this.showNotification('Failed to update favorite state', 'error');
            }
        } catch (error) {
            this.showNotification('Error updating favorite: ' + error.message, 'error');
        }
    }
    
    async copyRoute(routeId, routeName) {
        const newName = await this.askForText(
            this.t ? this.t('history.copy_prompt', 'Copy route with new name:') : 'Copy route with new name:',
            `${routeName} (Copy)`
        );
        if (!newName || newName.trim() === '') return;
        
        try {
            const response = await this.apiCall(`/api/routes/${routeId}/copy`, {
                method: 'POST',
                body: JSON.stringify({
                    name: newName.trim(),
                    deviceId: this.selectedDeviceId
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showNotification(`Route copied successfully as "${newName}"`, 'success');
                await this.loadDevicesAndRoutes();
                
                // Optionally load the new route
                if (confirm('Load the copied route?')) {
                    this.viewRoute(result.newRouteId);
                }
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || 'Failed to copy route');
            }
        } catch (error) {
            console.error('Error copying route:', error);
            this.showNotification('Failed to copy route: ' + error.message, 'error');
        }
    }

    async askForText(message, defaultValue = '') {
        return await new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = [
                'position:fixed',
                'inset:0',
                'background:rgba(0,0,0,0.55)',
                'z-index:10050',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'padding:16px'
            ].join(';');

            const modal = document.createElement('div');
            modal.style.cssText = [
                'width:min(520px,100%)',
                'background:#fff',
                'border-radius:12px',
                'box-shadow:0 16px 40px rgba(0,0,0,0.25)',
                'padding:16px'
            ].join(';');

            modal.innerHTML = `
                <div style="font-size:0.95rem;font-weight:600;color:#2c3e50;margin-bottom:10px;">${message}</div>
                <input id="rt-copy-name-input" type="text" style="width:100%;padding:10px 12px;border:1px solid #d9dee5;border-radius:8px;font-size:0.9rem;" />
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
                    <button id="rt-copy-cancel" class="btn btn-sm btn-secondary" type="button">${this.t ? this.t('common.cancel', 'Cancel') : 'Cancel'}</button>
                    <button id="rt-copy-ok" class="btn btn-sm btn-primary" type="button">OK</button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const input = modal.querySelector('#rt-copy-name-input');
            const okBtn = modal.querySelector('#rt-copy-ok');
            const cancelBtn = modal.querySelector('#rt-copy-cancel');

            if (input) {
                input.value = defaultValue || '';
                input.focus();
                input.select();
            }

            const cleanup = (value) => {
                overlay.remove();
                resolve(value);
            };

            okBtn?.addEventListener('click', () => cleanup(input ? input.value : defaultValue));
            cancelBtn?.addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });
            input?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') cleanup(input.value);
                if (e.key === 'Escape') cleanup(null);
            });
        });
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
        // Restore last map position from localStorage.
        // Discard the stale Mannheim default that old code used to save on logout.
        const rawLat = parseFloat(localStorage.getItem('mapLat'));
        const rawLng = parseFloat(localStorage.getItem('mapLng'));
        const isMannheimDefault = Math.abs(rawLat - 49.4875) < 0.001 && Math.abs(rawLng - 8.466) < 0.001;
        const hasSaved = localStorage.getItem('mapLat') && !isMannheimDefault;
        const savedLat  = hasSaved ? rawLat  : 49.4875;
        const savedLng  = hasSaved ? rawLng  : 8.466;
        const savedZoom = hasSaved ? (parseInt(localStorage.getItem('mapZoom'), 10) || 13) : 13;
        if (isMannheimDefault) {
            // Clear stale default so route auto-zoom can position the map correctly
            localStorage.removeItem('mapLat');
            localStorage.removeItem('mapLng');
            localStorage.removeItem('mapZoom');
        }
        this.map = L.map('map', { scrollWheelZoom: false }).setView([savedLat, savedLng], savedZoom);
        this.mapCentered = hasSaved; // only treat as already positioned if we had real saved data

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

        // Persist map position so it survives page reload
        this.map.on('moveend zoomend', () => {
            const c = this.map.getCenter();
            localStorage.setItem('mapLat',  c.lat);
            localStorage.setItem('mapLng',  c.lng);
            localStorage.setItem('mapZoom', this.map.getZoom());
        });

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
            this.mapCentered = true; // Mark that we've centered on real data
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
        const activeRouteName = document.getElementById('active-route-name');
        if (activeRouteName) activeRouteName.textContent = '—';
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

    showNotification(message, type = 'success', timeout = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; color: white; cursor: pointer;">×</button>
        `;

        document.getElementById('notifications').appendChild(notification);

        // Show notification
        setTimeout(() => notification.classList.add('show'), 100);

        // Auto remove after specified timeout
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, timeout);
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
                button.className = 'btn-icon-gps btn-icon-active';
                button.title = 'GPS Active — click to stop';
            } else {
                button.className = 'btn-icon-gps btn-icon-stopped';
                button.title = 'GPS Stopped — click to start';
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

    // Helper function to calculate total route distance
    calculateRouteDistance(points) {
        if (!points || points.length < 2) return 0;
        
        let totalDistance = 0;
        for (let i = 1; i < points.length; i++) {
            const distance = this.calculateDistance(
                points[i-1].lat, points[i-1].lng,
                points[i].lat, points[i].lng
            );
            totalDistance += distance;
        }
        return totalDistance;
    }

    // Calculate distance between two points (Haversine formula)
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Archive a route (mark as archived or move to archive)
    async archiveRoute(routeId) {
        try {
            const response = await this.apiCall(`/api/routes/${routeId}/archive`, {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showNotification('Route archived', 'success');
                return true;
            } else {
                throw new Error('Archive failed');
            }
        } catch (error) {
            console.error('Archive route error:', error);
            this.showNotification('Failed to archive route: ' + error.message, 'error');
            return false;
        }
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
        btn.className = 'btn-icon-gps btn-icon-pause admin-only';
        btn.title = 'Pause auto-refresh';
        btn.innerHTML = '<i class="fas fa-pause"></i>';
        window.routeTracker.startAutoRefresh();
    } else {
        btn.className = 'btn-icon-gps btn-icon-play admin-only';
        btn.title = 'Resume auto-refresh';
        btn.innerHTML = '<i class="fas fa-play"></i>';
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

// Improved zoom to fit function
function zoomToFit() {
    const rt = window.routeTracker;
    if (!rt || !rt.map) return;
    
    // Stop auto-refresh to avoid conflicts
    clearInterval(rt.refreshInterval);
    
    // Check for enhanced route layers first (smart route display)
    if (rt.routeLayers && rt.routeLayers.length > 0) {
        // Calculate bounds from all route layers
        let bounds = null;
        rt.routeLayers.forEach(layer => {
            if (layer.getBounds && typeof layer.getBounds === 'function') {
                if (!bounds) {
                    bounds = layer.getBounds();
                } else {
                    bounds.extend(layer.getBounds());
                }
            }
        });
        
        if (bounds && bounds.isValid()) {
            rt.map.fitBounds(bounds, { 
                padding: [50, 50], 
                maxZoom: 15 
            });
        }
    } else if (rt.currentRoute) {
        // Fallback to simple route display
        rt.map.fitBounds(rt.currentRoute.getBounds(), { 
            padding: [50, 50], 
            maxZoom: 15 
        });
    } else if (rt.liveTrail && rt.liveTrail.length > 1) {
        rt.map.fitBounds(L.latLngBounds(rt.liveTrail).pad(0.1), { 
            maxZoom: 16, 
            padding: [50, 50] 
        });
    } else if (rt.liveTrail && rt.liveTrail.length === 1) {
        rt.map.setView(rt.liveTrail[0], 15);
    }
    
    // Restart auto-refresh after zoom settles
    setTimeout(() => {
        if (rt.autoRefreshEnabled) {
            rt.startAutoRefresh();
        }
    }, 1000);
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

function toggleMergeMode() {
    if (window.routeTracker) window.routeTracker.toggleMergeMode();
}

function executeMerge() {
    if (window.routeTracker) window.routeTracker.executePointMerge();
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

function contextMenuSplitRoute() {
    if (window.routeTracker) window.routeTracker.contextMenuSplitRoute();
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

// Helper function to update setup display
function updateSetupDisplay() {
    // Update OwnTracks setup display with current API URL
    const urlElement = document.querySelector('code');
    if (urlElement && urlElement.textContent === 'Loading...') {
        urlElement.textContent = window.location.origin + '/route-tracker/api/gps';
    }
}

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