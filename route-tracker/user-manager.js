// User Management System for Route Tracker
class UserManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
    }

    init() {
        // Check if user is already logged in (from localStorage)
        const savedUser = localStorage.getItem('currentUser');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.isLoggedIn = true;
                this.updateAuthUI();
                this.showNotification(`Welcome back, ${this.currentUser.name}!`, 'success');
            } catch (error) {
                console.error('Error loading saved user:', error);
                localStorage.removeItem('currentUser');
            }
        }
    }

    async register(name, email, password) {
        try {
            // Validate input
            if (!name || !email || !password) {
                throw new Error('All fields are required');
            }

            if (!this.isValidEmail(email)) {
                throw new Error('Please enter a valid email address');
            }

            if (password.length < 6) {
                throw new Error('Password must be at least 6 characters long');
            }

            // Check if user already exists
            const existingUsers = this.getStoredUsers();
            if (existingUsers.find(user => user.email === email)) {
                throw new Error('An account with this email already exists');
            }

            // Create new user
            const newUser = {
                id: Date.now().toString(),
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password: await this.hashPassword(password), // In production, use proper server-side hashing
                createdAt: new Date().toISOString(),
                preferences: {
                    trackingInterval: 5000,
                    exportFormat: 'gpx',
                    mapCenter: [49.4875, 8.466], // Default to Mannheim
                    language: 'en'
                },
                stats: {
                    totalRoutes: 0,
                    totalDistance: 0,
                    totalTime: 0
                }
            };

            // Save user to storage
            existingUsers.push(newUser);
            localStorage.setItem('users', JSON.stringify(existingUsers));

            // Log in the new user
            this.currentUser = { ...newUser };
            delete this.currentUser.password; // Don't keep password in memory
            this.isLoggedIn = true;

            // Save current user session
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

            this.updateAuthUI();
            this.showNotification(`Welcome to Route Tracker, ${name}!`, 'success');

            return { success: true, user: this.currentUser };

        } catch (error) {
            console.error('Registration error:', error);
            this.showNotification(error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    async login(email, password) {
        try {
            // Validate input
            if (!email || !password) {
                throw new Error('Email and password are required');
            }

            // Find user
            const existingUsers = this.getStoredUsers();
            const user = existingUsers.find(u => u.email === email.toLowerCase().trim());

            if (!user) {
                throw new Error('No account found with this email address');
            }

            // Verify password
            const isPasswordValid = await this.verifyPassword(password, user.password);
            if (!isPasswordValid) {
                throw new Error('Invalid password');
            }

            // Log in user
            this.currentUser = { ...user };
            delete this.currentUser.password; // Don't keep password in memory
            this.isLoggedIn = true;

            // Update last login
            user.lastLogin = new Date().toISOString();
            localStorage.setItem('users', JSON.stringify(existingUsers));

            // Save current user session
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

            this.updateAuthUI();
            this.showNotification(`Welcome back, ${this.currentUser.name}!`, 'success');

            // Apply user preferences
            this.applyUserPreferences();

            return { success: true, user: this.currentUser };

        } catch (error) {
            console.error('Login error:', error);
            this.showNotification(error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    logout() {
        try {
            const userName = this.currentUser ? this.currentUser.name : 'User';
            
            // Clear user data
            this.currentUser = null;
            this.isLoggedIn = false;

            // Clear stored session
            localStorage.removeItem('currentUser');

            this.updateAuthUI();
            this.showNotification(`Goodbye, ${userName}!`, 'success');

            // Clear any user-specific UI state
            this.clearUserData();

            return { success: true };

        } catch (error) {
            console.error('Logout error:', error);
            this.showNotification('Error logging out', 'error');
            return { success: false, error: error.message };
        }
    }

    updateAuthUI() {
        const loggedOutSection = document.getElementById('auth-logged-out');
        const loggedInSection = document.getElementById('auth-logged-in');
        const userNameElement = document.getElementById('user-name');

        if (this.isLoggedIn && this.currentUser) {
            loggedOutSection.style.display = 'none';
            loggedInSection.style.display = 'flex';
            userNameElement.textContent = `Welcome, ${this.currentUser.name}!`;
        } else {
            loggedOutSection.style.display = 'flex';
            loggedInSection.style.display = 'none';
        }
    }

    applyUserPreferences() {
        if (!this.currentUser || !this.currentUser.preferences) return;

        const prefs = this.currentUser.preferences;

        // Apply tracking interval
        const trackingInterval = document.getElementById('tracking-interval');
        if (trackingInterval) {
            trackingInterval.value = prefs.trackingInterval;
        }

        // Apply map center if available
        if (prefs.mapCenter && window.routeTracker && window.routeTracker.map) {
            window.routeTracker.map.setView(prefs.mapCenter, 13);
        }

        console.log('Applied user preferences:', prefs);
    }

    saveUserPreferences() {
        if (!this.isLoggedIn || !this.currentUser) return;

        // Gather current preferences from UI
        const trackingInterval = document.getElementById('tracking-interval');
        
        const preferences = {
            trackingInterval: trackingInterval ? parseInt(trackingInterval.value) : 5000,
            exportFormat: 'gpx', // Default
            mapCenter: window.routeTracker && window.routeTracker.map ? 
                      [window.routeTracker.map.getCenter().lat, window.routeTracker.map.getCenter().lng] : 
                      [49.4875, 8.466],
            language: 'en'
        };

        // Update current user
        this.currentUser.preferences = preferences;

        // Update stored user data
        const existingUsers = this.getStoredUsers();
        const userIndex = existingUsers.findIndex(u => u.id === this.currentUser.id);
        if (userIndex !== -1) {
            existingUsers[userIndex].preferences = preferences;
            localStorage.setItem('users', JSON.stringify(existingUsers));
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
        }

        this.showNotification('Preferences saved', 'success');
    }

    updateUserStats(routeData) {
        if (!this.isLoggedIn || !this.currentUser) return;

        // Update user statistics
        this.currentUser.stats.totalRoutes += 1;
        this.currentUser.stats.totalDistance += routeData.totalDistance;
        this.currentUser.stats.totalTime += routeData.stats.duration;

        // Update stored data
        const existingUsers = this.getStoredUsers();
        const userIndex = existingUsers.findIndex(u => u.id === this.currentUser.id);
        if (userIndex !== -1) {
            existingUsers[userIndex].stats = this.currentUser.stats;
            localStorage.setItem('users', JSON.stringify(existingUsers));
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
        }

        console.log('Updated user stats:', this.currentUser.stats);
    }

    getUserRoutes() {
        if (!this.isLoggedIn || !this.currentUser) return [];

        // Get all routes and filter by user
        const allRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
        return allRoutes.filter(route => route.userId === this.currentUser.id);
    }

    clearUserData() {
        // Clear any sensitive user data from UI
        const routeNameInput = document.getElementById('route-name');
        if (routeNameInput) {
            routeNameInput.value = '';
        }

        // Reset map to default position
        if (window.routeTracker && window.routeTracker.map) {
            window.routeTracker.map.setView([49.4875, 8.466], 13);
        }
    }

    getStoredUsers() {
        try {
            return JSON.parse(localStorage.getItem('users') || '[]');
        } catch (error) {
            console.error('Error loading users:', error);
            return [];
        }
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    async hashPassword(password) {
        // Simple hash for demo purposes
        // In production, use proper server-side hashing with salt
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    async verifyPassword(password, hashedPassword) {
        const inputHash = await this.hashPassword(password);
        return inputHash === hashedPassword;
    }

    showNotification(message, type = 'success') {
        if (window.routeTracker) {
            window.routeTracker.showNotification(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    // Export user data (GDPR compliance)
    exportUserData() {
        if (!this.isLoggedIn || !this.currentUser) {
            this.showNotification('Please log in to export your data', 'warning');
            return;
        }

        const userData = {
            profile: this.currentUser,
            routes: this.getUserRoutes(),
            exported: new Date().toISOString()
        };

        const dataStr = JSON.stringify(userData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `route-tracker-data-${this.currentUser.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showNotification('User data exported successfully', 'success');
    }

    // Delete user account
    deleteAccount() {
        if (!this.isLoggedIn || !this.currentUser) return;

        const confirmation = prompt(
            `Are you sure you want to delete your account? This will permanently delete all your routes and data. Type "${this.currentUser.email}" to confirm:`
        );

        if (confirmation !== this.currentUser.email) {
            this.showNotification('Account deletion cancelled', 'warning');
            return;
        }

        try {
            // Remove user from stored users
            const existingUsers = this.getStoredUsers();
            const filteredUsers = existingUsers.filter(u => u.id !== this.currentUser.id);
            localStorage.setItem('users', JSON.stringify(filteredUsers));

            // Remove user's routes
            const allRoutes = JSON.parse(localStorage.getItem('savedRoutes') || '[]');
            const filteredRoutes = allRoutes.filter(route => route.userId !== this.currentUser.id);
            localStorage.setItem('savedRoutes', JSON.stringify(filteredRoutes));

            // Log out
            this.logout();

            this.showNotification('Account deleted successfully', 'success');

        } catch (error) {
            console.error('Error deleting account:', error);
            this.showNotification('Error deleting account', 'error');
        }
    }
}

// Initialize user manager when script loads
window.userManager = new UserManager();

console.log('User Manager loaded');