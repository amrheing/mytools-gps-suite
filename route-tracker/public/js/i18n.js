// Route Tracker - Internationalization System
// Handles language detection, switching, and text translation

class I18nManager {
    constructor() {
        this.currentLanguage = 'en';
        this.supportedLanguages = ['en', 'de'];
        this.translations = window.translations || {};
        
        // Initialize language from various sources
        this.initializeLanguage();
        
        // Set up language change listeners
        this.setupEventListeners();
    }
    
    initializeLanguage() {
        // Priority: localStorage > URL parameter > browser language > default
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');
        const savedLang = localStorage.getItem('preferred-language');
        const browserLang = navigator.language.toLowerCase();
        
        let detectedLang = 'en'; // default
        
        if (urlLang && this.supportedLanguages.includes(urlLang)) {
            detectedLang = urlLang;
        } else if (savedLang && this.supportedLanguages.includes(savedLang)) {
            detectedLang = savedLang;
        } else if (browserLang.startsWith('de')) {
            detectedLang = 'de';
        }
        
        this.setLanguage(detectedLang, false); // false = don't show notification on init
    }
    
    setLanguage(language, showNotification = true) {
        if (!this.supportedLanguages.includes(language)) {
            console.warn(`Language '${language}' not supported. Available: ${this.supportedLanguages.join(', ')}`);
            return false;
        }
        
        const oldLanguage = this.currentLanguage;
        this.currentLanguage = language;
        
        // Save preference
        localStorage.setItem('preferred-language', language);
        
        // Update HTML lang attribute
        document.documentElement.lang = language;
        
        // Translate the page
        this.translatePage();
        
        // Update language switcher UI
        this.updateLanguageSwitcher();
        
        // Show notification if language changed and notification requested
        if (showNotification && oldLanguage !== language) {
            const message = language === 'de' ? 'Sprache auf Deutsch geändert' : 'Language changed to English';
            window.routeTracker?.showNotification(message, 'success');
        }
        
        // Emit language change event for other components
        document.dispatchEvent(new CustomEvent('languageChange', {
            detail: { language, oldLanguage }
        }));
        
        return true;
    }
    
    translate(key, fallback = key) {
        if (!this.translations[this.currentLanguage]) {
            console.warn(`No translations found for language: ${this.currentLanguage}`);
            return fallback;
        }
        
        const translation = this.translations[this.currentLanguage][key];
        if (translation === undefined) {
            console.warn(`Translation missing for key: ${key} (${this.currentLanguage})`);
            return fallback;
        }
        
        return translation;
    }
    
    translatePage() {
        // Translate elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.translate(key);
            
            // Handle different element types
            if (element.tagName === 'INPUT' && (element.type === 'submit' || element.type === 'button')) {
                element.value = translation;
            } else if (element.hasAttribute('data-i18n-placeholder')) {
                const placeholderKey = element.getAttribute('data-i18n-placeholder');
                const placeholderTranslation = this.translate(placeholderKey);
                element.placeholder = placeholderTranslation;
            } else if (element.tagName === 'INPUT' && element.placeholder !== undefined) {
                element.placeholder = translation;
            } else if (element.title !== undefined && element.getAttribute('data-i18n-title') === 'true') {
                element.title = translation;
            } else {
                // For most elements, replace text content but preserve HTML structure
                if (element.children.length > 0) {
                    // If element has children, only replace direct text nodes
                    this.replaceTextNodes(element, translation);
                } else {
                    element.textContent = translation;
                }
            }
        });
        
        // Update dynamic content that might not have data-i18n attributes
        this.updateDynamicContent();
    }
    
    replaceTextNodes(element, newText) {
        // Find and replace text nodes while preserving child elements
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue.trim()) {
                textNodes.push(node);
            }
        }
        
        // Replace the first significant text node with new text
        if (textNodes.length > 0) {
            textNodes[0].nodeValue = newText;
            // Remove other text nodes to avoid duplication
            for (let i = 1; i < textNodes.length; i++) {
                textNodes[i].nodeValue = '';
            }
        }
    }
    
    updateDynamicContent() {
        // Update page title
        document.title = this.translate('app.title') + ' - ' + this.translate('app.subtitle');
        
        // Update any other dynamic content
        const deviceNameEl = document.getElementById('device-name');
        if (deviceNameEl && deviceNameEl.textContent === 'Unknown') {
            deviceNameEl.textContent = this.translate('gps.unknown');
        }
        
        const deviceStatusEl = document.getElementById('device-status');
        if (deviceStatusEl && deviceStatusEl.textContent === 'No Data') {
            deviceStatusEl.textContent = this.translate('gps.no_data');
        }
        
        const lastUpdateEl = document.getElementById('last-update');
        if (lastUpdateEl && lastUpdateEl.textContent === 'Never') {
            lastUpdateEl.textContent = this.translate('gps.never');
        }
    }
    
    updateLanguageSwitcher() {
        // Update active language in switcher
        document.querySelectorAll('.language-option').forEach(option => {
            const lang = option.getAttribute('data-lang');
            if (lang === this.currentLanguage) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }
    
    setupEventListeners() {
        // Listen for language switch clicks
        document.addEventListener('click', (event) => {
            if (event.target.closest('.language-option')) {
                const langOption = event.target.closest('.language-option');
                const newLang = langOption.getAttribute('data-lang');
                if (newLang && newLang !== this.currentLanguage) {
                    this.setLanguage(newLang);
                }
            }
        });
        
        // Listen for DOM changes to translate new content
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        const i18nElements = node.querySelectorAll ? node.querySelectorAll('[data-i18n]') : [];
                        i18nElements.forEach(element => {
                            const key = element.getAttribute('data-i18n');
                            const translation = this.translate(key);
                            element.textContent = translation;
                        });
                        
                        // Check if the node itself has data-i18n
                        if (node.hasAttribute && node.hasAttribute('data-i18n')) {
                            const key = node.getAttribute('data-i18n');
                            const translation = this.translate(key);
                            node.textContent = translation;
                        }
                    }
                });
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    getLanguageInfo() {
        return {
            current: this.currentLanguage,
            supported: this.supportedLanguages,
            name: this.currentLanguage === 'de' ? 'Deutsch' : 'English',
            flag: this.currentLanguage === 'de' ? '🇩🇪' : '🇺🇸'
        };
    }
    
    // Utility method: Get all available languages with their metadata
    getAvailableLanguages() {
        return [
            { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
            { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' }
        ];
    }
}

// Global translation function for easy access
window.t = function(key, fallback = key) {
    return window.i18n ? window.i18n.translate(key, fallback) : fallback;
};

// Initialize i18n system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.i18n = new I18nManager();
    console.log('I18n initialized:', window.i18n.getLanguageInfo());
});

// Export for modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18nManager;
}