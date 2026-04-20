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
