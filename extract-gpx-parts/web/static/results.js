// GPX Extractor - Results Page JavaScript

// Initialize results page functionality
document.addEventListener('DOMContentLoaded', function() {
    initializeResults();
});

function initializeResults() {
    updateSelectedCount();
    setupKeyboardShortcuts();
}

// File Selection Functions
function selectAll() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        window.gpxExtractor.selectedFiles.add(checkbox.dataset.filename);
    });
    updateSelectedCount();
    updateSelectAllCheckbox();
}

function selectNone() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    window.gpxExtractor.selectedFiles.clear();
    updateSelectedCount();
    updateSelectAllCheckbox();
}

function selectByType(type) {
    // First clear all selections
    selectNone();
    
    // Then select files of the specified type
    const items = document.querySelectorAll(`.file-item[data-type="${type}"]`);
    items.forEach(item => {
        const checkbox = item.querySelector('.file-checkbox');
        if (checkbox) {
            checkbox.checked = true;
            window.gpxExtractor.selectedFiles.add(checkbox.dataset.filename);
        }
    });
    
    updateSelectedCount();
    updateSelectAllCheckbox();
    
    // Show toast with count
    const count = window.gpxExtractor.selectedFiles.size;
    window.gpxUtils.showToast(`Selected ${count} ${type} file${count !== 1 ? 's' : ''}`, 'info');
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox.checked) {
        selectAll();
    } else {
        selectNone();
    }
}

function updateSelectedCount() {
    const selectedCount = document.getElementById('selectedCount');
    const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
    const count = window.gpxExtractor.selectedFiles.size;
    
    if (selectedCount) {
        selectedCount.textContent = count;
    }
    
    if (downloadSelectedBtn) {
        downloadSelectedBtn.disabled = count === 0;
        if (count === 0) {
            downloadSelectedBtn.innerHTML = '<i class="fas fa-download"></i> Download Selected (0)';
        } else {
            downloadSelectedBtn.innerHTML = `<i class="fas fa-download"></i> Download Selected (${count})`;
        }
    }
}

function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const totalCheckboxes = document.querySelectorAll('.file-checkbox').length;
    const selectedCount = window.gpxExtractor.selectedFiles.size;
    
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedCount === totalCheckboxes && totalCheckboxes > 0;
        selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCheckboxes;
    }
}

// Individual checkbox change handler
document.addEventListener('change', function(e) {
    if (e.target.classList.contains('file-checkbox')) {
        const filename = e.target.dataset.filename;
        
        if (e.target.checked) {
            window.gpxExtractor.selectedFiles.add(filename);
        } else {
            window.gpxExtractor.selectedFiles.delete(filename);
        }
        
        updateSelectedCount();
        updateSelectAllCheckbox();
    }
});

// Download Functions
async function downloadSelected() {
    const selectedFiles = Array.from(window.gpxExtractor.selectedFiles);
    
    if (selectedFiles.length === 0) {
        window.gpxUtils.showToast('No files selected', 'warning');
        return;
    }
    
    showLoadingOverlay('Preparing download...');
    
    try {
        const response = await fetch('/download-selected', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: selectedFiles,
                directory: window.gpxExtractor.outputDirectory
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Download failed');
        }
        
        // Create download link
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `selected_gpx_files_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        window.gpxUtils.showToast(`Downloaded ${selectedFiles.length} files`, 'success');
        
    } catch (error) {
        console.error('Download error:', error);
        window.gpxUtils.showToast(`Download failed: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

// File Preview Functions
function previewFile(filename) {
    const modal = document.getElementById('previewModal');
    const title = document.getElementById('previewTitle');
    const content = document.getElementById('previewContent');
    const downloadBtn = document.getElementById('downloadPreviewBtn');
    
    if (!modal || !title || !content) return;
    
    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Update title
    title.innerHTML = `<i class="fas fa-eye"></i> Preview: ${filename}`;
    
    // Show loading
    content.innerHTML = `
        <div class="loading">
            <i class="fas fa-spinner fa-spin"></i> Loading preview...
        </div>
    `;
    
    // Update download button
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            const downloadUrl = getFileDownloadUrl(filename);
            if (downloadUrl) {
                window.location.href = downloadUrl;
            }
        };
    }
    
    // Load file preview (simplified - just show file info)
    setTimeout(() => {
        const fileInfo = window.gpxExtractor.allFiles.find(f => f.name === filename);
        if (fileInfo) {
            content.innerHTML = `
                <div class="preview-content">
                    <div class="file-preview-header">
                        <div class="file-preview-icon">
                            <i class="fas ${getFileIcon(fileInfo.type)}"></i>
                        </div>
                        <div class="file-preview-info">
                            <h4>${filename}</h4>
                            <p><strong>Type:</strong> ${fileInfo.type.charAt(0).toUpperCase() + fileInfo.type.slice(1)}</p>
                            <p><strong>Size:</strong> ${window.gpxUtils.formatFileSize(fileInfo.size)}</p>
                        </div>
                    </div>
                    <div class="file-preview-actions">
                        <p>This GPX file contains geographic data that can be viewed in GPS applications, mapping software, or online map services.</p>
                        <div class="preview-buttons">
                            <button onclick="openInNewTab('${filename}')" class="button button-outline">
                                <i class="fas fa-external-link-alt"></i> Open in New Tab
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="preview-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Unable to load preview for this file.</p>
                </div>
            `;
        }
    }, 500);
}

function hidePreview() {
    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function getFileIcon(type) {
    const icons = {
        'waypoints': 'fa-map-marker-alt',
        'track': 'fa-route',
        'route': 'fa-directions'
    };
    return icons[type] || 'fa-file';
}

function getFileDownloadUrl(filename) {
    const baseUrl = window.location.origin;
    return `${baseUrl}/download/${encodeURIComponent(window.gpxExtractor.outputDirectory)}/${encodeURIComponent(filename)}`;
}

function openInNewTab(filename) {
    const url = getFileDownloadUrl(filename);
    window.open(url, '_blank');
}

// Loading Overlay Functions
function showLoadingOverlay(message = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        const content = overlay.querySelector('.loading-content p');
        if (content) content.textContent = message;
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + A - Select All
        if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.target.tagName.toLowerCase().match(/input|textarea/)) {
            e.preventDefault();
            selectAll();
        }
        
        // Ctrl/Cmd + D - Download Selected
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            downloadSelected();
        }
        
        // Escape - Close modals
        if (e.key === 'Escape') {
            hidePreview();
            hideLoadingOverlay();
        }
    });
}

// Add preview styles
const previewStyles = `
    <style>
        .preview-content {
            padding: 1rem 0;
        }
        
        .file-preview-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .file-preview-icon {
            font-size: 3rem;
            color: var(--secondary-color);
        }
        
        .file-preview-info h4 {
            margin: 0 0 0.5rem 0;
            color: var(--text-color);
            word-break: break-all;
        }
        
        .file-preview-info p {
            margin: 0.25rem 0;
            color: var(--text-light);
        }
        
        .file-preview-actions {
            text-align: center;
        }
        
        .preview-buttons {
            margin-top: 1rem;
        }
        
        .preview-error {
            text-align: center;
            padding: 2rem;
            color: var(--text-light);
        }
        
        .preview-error i {
            font-size: 3rem;
            color: var(--error-color);
            display: block;
            margin-bottom: 1rem;
        }
        
        /* Responsive file list for small screens */
        @media (max-width: 768px) {
            .file-list-header {
                display: none;
            }
            
            .file-item {
                display: block;
                padding: 1rem;
                border: 1px solid #eee;
                border-radius: 8px;
                margin-bottom: 1rem;
            }
            
            .file-select {
                float: right;
                margin-bottom: 0.5rem;
            }
            
            .file-icon {
                display: inline-block;
                margin-right: 0.5rem;
            }
            
            .file-name {
                display: block;
                margin-bottom: 0.5rem;
            }
            
            .file-type {
                margin-bottom: 0.5rem;
            }
            
            .file-actions-cell {
                justify-content: flex-start;
            }
        }
    </style>
`;

// Add preview styles to page
document.head.insertAdjacentHTML('beforeend', previewStyles);

// Initialize selected files set
window.gpxExtractor.selectedFiles = new Set();