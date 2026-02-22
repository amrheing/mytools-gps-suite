// GPX Extractor Web Interface - Main JavaScript

// Global state
window.gpxExtractor = {
    selectedFiles: new Set(),
    allFiles: [],
    outputDirectory: ''
};

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // File input handling
    setupFileInput();
    
    // Form submission
    setupFormSubmission();
    
    // Initialize any existing data from HTML data attributes
    const dataElement = document.getElementById('extraction-data');
    if (dataElement) {
        try {
            const filesData = dataElement.getAttribute('data-files');
            const outputDir = dataElement.getAttribute('data-output-directory');
            
            window.gpxExtractor.allFiles = filesData ? JSON.parse(filesData) : [];
            window.gpxExtractor.outputDirectory = outputDir || '';
        } catch (error) {
            console.warn('Failed to parse extraction data:', error);
            window.gpxExtractor.allFiles = [];
            window.gpxExtractor.outputDirectory = '';
        }
    }
}

function setupFileInput() {
    const fileInput = document.getElementById('file');
    const fileLabel = document.querySelector('.file-input-label');
    const fileInfo = document.querySelector('.file-info');
    const fileName = document.querySelector('.file-name');
    const fileSize = document.querySelector('.file-size');

    if (!fileInput) return;

    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        
        if (file) {
            // Update file info display
            fileName.textContent = file.name;
            fileSize.textContent = formatFileSize(file.size);
            
            // Show file info, hide label
            fileLabel.style.display = 'none';
            fileInfo.style.display = 'flex';
            
            // Validate file
            if (!file.name.toLowerCase().endsWith('.gpx')) {
                showToast('Please select a GPX file', 'error');
                resetFileInput();
                return;
            }
            
            if (file.size > 100 * 1024 * 1024) { // 100MB
                showToast('File is too large. Maximum size is 100MB', 'error');
                resetFileInput();
                return;
            }
            
            showToast('GPX file ready for processing', 'success');
        }
    });

    // Click handler for file info to change file
    if (fileInfo) {
        fileInfo.addEventListener('click', function() {
            resetFileInput();
        });
    }
}

function resetFileInput() {
    const fileInput = document.getElementById('file');
    const fileLabel = document.querySelector('.file-input-label');
    const fileInfo = document.querySelector('.file-info');
    
    if (fileInput) fileInput.value = '';
    if (fileLabel) fileLabel.style.display = 'inline-block';
    if (fileInfo) fileInfo.style.display = 'none';
}

function setupFormSubmission() {
    const form = document.querySelector('.upload-form');
    const progressDiv = document.querySelector('.upload-progress');
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    const uploadButton = document.querySelector('.upload-button');

    if (!form) return;

    form.addEventListener('submit', function(e) {
        const fileInput = document.getElementById('file');
        
        if (!fileInput || !fileInput.files[0]) {
            e.preventDefault();
            showToast('Please select a GPX file first', 'error');
            return;
        }

        // Show progress
        if (progressDiv) {
            progressDiv.style.display = 'block';
            uploadButton.disabled = true;
            uploadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        }
        
        // Simulate progress (since we can't track real upload progress easily)
        simulateProgress();
    });
}

function simulateProgress() {
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    
    if (!progressFill || !progressText) return;
    
    let progress = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90; // Stop at 90% until real completion
        
        progressFill.style.width = progress + '%';
        
        if (progress < 30) {
            progressText.textContent = 'Uploading file...';
        } else if (progress < 60) {
            progressText.textContent = 'Analyzing GPX structure...';
        } else if (progress < 90) {
            progressText.textContent = 'Extracting components...';
        } else {
            progressText.textContent = 'Almost done...';
            clearInterval(interval);
        }
    }, 200);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${getToastIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    // Add to page
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Remove after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

function getToastIcon(type) {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-triangle',
        warning: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
}

// Modal functions
function showAbout() {
    const modal = document.getElementById('aboutModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function hideAbout() {
    const modal = document.getElementById('aboutModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
});

// Keyboard support for modals
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal[style*="block"], .modal[style*="flex"]');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
        document.body.style.overflow = 'auto';
    }
});

// Add toast styles dynamically
const toastStyles = `
    <style>
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 300px;
        }
        
        .toast.show {
            transform: translateX(0);
        }
        
        .toast-success {
            background: #27ae60;
        }
        
        .toast-error {
            background: #e74c3c;
        }
        
        .toast-warning {
            background: #f39c12;
        }
        
        .toast-info {
            background: #3498db;
        }
        
        @media (max-width: 768px) {
            .toast {
                right: 10px;
                left: 10px;
                min-width: auto;
                transform: translateY(-100%);
            }
            
            .toast.show {
                transform: translateY(0);
            }
        }
    </style>
`;

// Add styles to page
document.head.insertAdjacentHTML('beforeend', toastStyles);

// Utility functions for other scripts
window.gpxUtils = {
    formatFileSize,
    showToast,
    hideAbout,
    showAbout
};