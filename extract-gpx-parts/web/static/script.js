// GPX Extractor Web Interface - Main JavaScript

// Build API URLs from the current page path so reverse-proxy prefixes are handled correctly
const _basePath = (function() {
    const p = window.location.pathname;
    return p.endsWith('/') ? p : p + '/';
})();
const API_URLS = {
    selectFile: _basePath + 'select-file',
    deleteFile: _basePath + 'delete-file',
    updateDescription: _basePath + 'update-description'
};

// Global state
window.gpxExtractor = {
    selectedFiles: new Set(),
    allFiles: [],
    outputDirectory: '',
    currentDeleteId: null,
    currentDeleteName: null
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

// File Processing Functions
function processFile(uniqueId) {
    showLoading('Starting file processing...');
    
    fetch(API_URLS.selectFile, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            unique_id: uniqueId
        })
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        
        if (data.redirect && data.url) {
            // Already processed — go straight to existing results
            window.location.href = data.url;
        } else if (data.job_id) {
            // Redirect to processing page with job ID
            window.location.href = `/processing/${data.job_id}`;
        } else {
            throw new Error(data.error || 'Failed to start processing');
        }
    })
    .catch(error => {
        hideLoading();
        showToast(error.message || 'Error starting file processing', 'error');
        console.error('Error:', error);
    });
}

// Delete Functions
function showDeleteDialog(uniqueId, displayName) {
    window.gpxExtractor.currentDeleteId = uniqueId;
    window.gpxExtractor.currentDeleteName = displayName;
    
    const modal = document.getElementById('deleteModal');
    const fileNameElement = document.getElementById('deleteFileName');
    const tokenInput = document.getElementById('deleteToken');
    
    if (modal && fileNameElement && tokenInput) {
        fileNameElement.textContent = displayName;
        tokenInput.value = '';
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Focus on token input
        setTimeout(() => tokenInput.focus(), 100);
    }
}

function hideDeleteDialog() {
    const modal = document.getElementById('deleteModal');
    const tokenInput = document.getElementById('deleteToken');
    
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    
    if (tokenInput) {
        tokenInput.value = '';
    }
    
    window.gpxExtractor.currentDeleteId = null;
    window.gpxExtractor.currentDeleteName = null;
}

function confirmDelete() {
    const tokenInput = document.getElementById('deleteToken');
    const token = tokenInput ? tokenInput.value.trim() : '';
    const uniqueId = window.gpxExtractor.currentDeleteId;
    const displayName = window.gpxExtractor.currentDeleteName;
    
    if (!token) {
        showToast('Please enter the delete token', 'warning');
        return;
    }
    
    if (!uniqueId) {
        showToast('No file selected for deletion', 'error');
        return;
    }
    
    showLoading('Deleting file...');
    
    fetch(API_URLS.deleteFile, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            unique_id: uniqueId,
            token: token
        })
    })
    .then(response => response.json())
    .then(data => {
        hideLoading();
        hideDeleteDialog();
        
        if (data.success) {
            showToast(`Deleted: ${displayName}`, 'success');
            
            // Remove file item from DOM
            const fileItem = document.querySelector(`[data-unique-id="${uniqueId}"]`);
            if (fileItem) {
                fileItem.style.transition = 'all 0.3s ease';
                fileItem.style.opacity = '0';
                fileItem.style.transform = 'translateX(-100%)';
                
                setTimeout(() => {
                    fileItem.remove();
                    
                    // Check if list is empty now
                    const filesList = document.getElementById('filesList');
                    const remainingItems = filesList.querySelectorAll('.file-item');
                    
                    if (remainingItems.length === 0) {
                        filesList.innerHTML = `
                            <div class="empty-state">
                                <i class="fas fa-folder-open"></i>
                                <p>No uploaded files available</p>
                                <small>Upload a GPX file to get started</small>
                            </div>
                        `;
                    }
                }, 300);
            }
        } else {
            showToast(data.error || 'Failed to delete file', 'error');
        }
    })
    .catch(error => {
        hideLoading();
        hideDeleteDialog();
        showToast('Error deleting file', 'error');
        console.error('Error:', error);
    });
}

// Loading Functions
function showLoading(message = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');
    
    if (overlay) {
        if (text) text.textContent = message;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// File Input Setup
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
            if (fileName) fileName.textContent = file.name;
            if (fileSize) fileSize.textContent = formatFileSize(file.size);
            
            // Show file info, hide label
            if (fileLabel) fileLabel.style.display = 'none';
            if (fileInfo) fileInfo.style.display = 'flex';
            
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

// Utility Functions
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

function showImpressum() {
    const modal = document.getElementById('impressumModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function hideImpressum() {
    const modal = document.getElementById('impressumModal');
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
    
    // Handle delete dialog specific shortcuts
    if (e.key === 'Enter') {
        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal && deleteModal.style.display === 'flex') {
            e.preventDefault();
            confirmDelete();
        }
    }
});

// Add Enter key support for delete token input
document.addEventListener('DOMContentLoaded', function() {
    const tokenInput = document.getElementById('deleteToken');
    if (tokenInput) {
        tokenInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmDelete();
            }
        });
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
    showAbout,
    showImpressum,
    hideImpressum,
    showLoading,
    hideLoading,
    processFile,
    showDeleteDialog,
    hideDeleteDialog,
    confirmDelete
};