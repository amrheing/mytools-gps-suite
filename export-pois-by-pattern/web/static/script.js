// POI Pattern Extractor - Client-side JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // File upload handling
    const fileInput = document.getElementById('file');
    const fileLabel = document.querySelector('.file-label');
    
    if (fileInput && fileLabel) {
        fileInput.addEventListener('change', function() {
            const fileName = this.files[0]?.name;
            if (fileName) {
                fileLabel.innerHTML = `<i class="fas fa-check"></i> ${fileName}`;
                fileLabel.style.backgroundColor = 'var(--success-color)';
                fileLabel.style.color = 'white';
            }
        });
    }
    
    // Form validation
    const form = document.querySelector('.upload-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            const patternTypeRadio = document.querySelector('input[name="pattern_type"]:checked');
            if (!patternTypeRadio) return; // No pattern type selection found
            
            const patternType = patternTypeRadio.value;
            const wildcardPattern = document.getElementById('wildcard_pattern')?.value.trim() || '';
            const regexPattern = document.getElementById('regex_pattern')?.value.trim() || '';
            
            if (patternType === 'wildcard' && !wildcardPattern) {
                e.preventDefault();
                alert('Please enter a wildcard pattern');
                return;
            }
            
            if (patternType === 'regex' && !regexPattern) {
                e.preventDefault();
                alert('Please enter a regex pattern');
                return;
            }
            
            // Show loading state
            const submitBtn = document.querySelector('.btn-upload');
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                submitBtn.disabled = true;
            }
        });
    }
    
    // Pattern type switching
    const patternRadios = document.querySelectorAll('input[name="pattern_type"]');
    patternRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const wildcardGroup = document.getElementById('wildcard-group');
            const regexGroup = document.getElementById('regex-group');
            
            // Only proceed if both groups exist
            if (wildcardGroup && regexGroup) {
                if (this.value === 'wildcard') {
                    wildcardGroup.style.display = 'block';
                    regexGroup.style.display = 'none';
                } else {
                    wildcardGroup.style.display = 'none';
                    regexGroup.style.display = 'block';
                }
            }
        });
    });
    
    // Auto-refresh for processing pages
    if (window.location.pathname.includes('/job-status/')) {
        const statusIndicator = document.querySelector('.status-indicator');
        if (statusIndicator && statusIndicator.classList.contains('processing')) {
            // Refresh every 3 seconds for processing jobs
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        }
    }
    
    // Copy functionality for job IDs
    const codeElements = document.querySelectorAll('.mono');
    codeElements.forEach(element => {
        if (element.textContent.includes('-')) { // Likely a job ID
            element.style.cursor = 'pointer';
            element.title = 'Click to copy';
            
            element.addEventListener('click', function() {
                navigator.clipboard.writeText(this.textContent).then(() => {
                    const original = this.textContent;
                    this.textContent = 'Copied!';
                    this.style.backgroundColor = 'var(--success-color)';
                    
                    setTimeout(() => {
                        this.textContent = original;
                        this.style.backgroundColor = 'var(--primary-color)';
                    }, 1000);
                });
            });
        }
    });
});

// Auto-expand patterns based on example clicks
function useExample(pattern, type = 'wildcard') {
    const wildcardInput = document.getElementById('wildcard_pattern');
    const regexInput = document.getElementById('regex_pattern');
    const wildcardRadio = document.getElementById('wildcard');
    const regexRadio = document.getElementById('regex');
    
    // Check if elements exist (they only exist on the main upload page)
    if (!wildcardInput || !regexInput || !wildcardRadio || !regexRadio) {
        return; // Exit if elements don't exist
    }
    
    if (type === 'wildcard') {
        wildcardRadio.checked = true;
        wildcardInput.value = pattern;
        // Trigger change event
        wildcardRadio.dispatchEvent(new Event('change'));
    } else {
        regexRadio.checked = true;
        regexInput.value = pattern;
        // Trigger change event
        regexRadio.dispatchEvent(new Event('change'));
    }
    
    // Scroll to pattern input (only if it exists)
    const patternInputSection = document.querySelector('.pattern-input');
    if (patternInputSection) {
        patternInputSection.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
    }
}

// Utility functions for result pages
function downloadFile(jobId) {
    window.location.href = `/download/${jobId}`;
}

function goHome() {
    window.location.href = '/';
}

function refreshStatus() {
    window.location.reload();
}