class GoogleMapsToGPXConverter {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.parsedPoints = [];
        this.gpxContent = '';
    }

    initializeElements() {
        this.urlInput = document.getElementById('urlInput');
        this.routeName = document.getElementById('routeName');
        this.includeTrack = document.getElementById('includeTrack');
        this.includeTime = document.getElementById('includeTime');
        this.intervalMinutes = document.getElementById('intervalMinutes');
        this.convertBtn = document.getElementById('convertBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.expandUrlBtn = document.getElementById('expandUrlBtn');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.errorContainer = document.getElementById('errorContainer');
        this.errorList = document.getElementById('errorList');
        this.pointCount = document.getElementById('pointCount');
        this.gpxPreview = document.getElementById('gpxPreview');
    }

    attachEventListeners() {
        this.convertBtn.addEventListener('click', () => this.handleConvert());
        this.downloadBtn.addEventListener('click', () => this.downloadGPX());
        if (this.expandUrlBtn) {
            this.expandUrlBtn.addEventListener('click', () => this.handleExpandUrls());
        }
        this.includeTrack.addEventListener('change', () => this.updateTrackOptions());
        this.includeTime.addEventListener('change', () => this.updateTrackOptions());
        this.updateTrackOptions();
    }

    // Timestamps only exist on track points
    updateTrackOptions() {
        this.includeTime.disabled = !this.includeTrack.checked;
        this.intervalMinutes.disabled = !this.includeTrack.checked || !this.includeTime.checked;
    }

    inputLines() {
        return this.urlInput.value.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    }

    async handleConvert() {
        const urls = this.inputLines();

        if (urls.length === 0) {
            this.showStatus('Please enter at least one Google Maps URL', 'error');
            return;
        }

        this.setLoading(true);
        this.clearResults();
        this.showStatus('Starting URL processing...', 'info');
        this.showProgress(0, urls.length, 'Initializing...');

        try {
            const points = [];
            const errors = [];

            for (let i = 0; i < urls.length; i++) {
                let url = urls[i];
                const isShort = Boolean(MapsParser.shortLinkInfo(url));
                this.updateProgress(((i + 1) / urls.length) * 100, `Processing URL ${i + 1} of ${urls.length}...`);

                try {
                    if (isShort) url = await URLExpander.expandUrl(url);
                    const { points: found, unresolved } = MapsParser.parseMapUrl(url);
                    points.push(...found);
                    if (unresolved.length > 0) {
                        errors.push(`URL ${i + 1}: No coordinates for "${unresolved.join(', ')}". Use a link with coordinates instead.`);
                    }
                } catch (error) {
                    errors.push(isShort ? `URL ${i + 1} (Short URL): ${error.message}` : `URL ${i + 1}: ${error.message}`);
                }
            }

            if (points.length === 0) {
                this.hideProgress();
                this.showStatus('No valid coordinates found in the provided URLs', 'error');
                this.showErrors(errors);
                return;
            }

            this.parsedPoints = points;
            this.gpxContent = MapsParser.generateGPX(points, {
                name: this.routeName.value.trim(),
                includeTrack: this.includeTrack.checked,
                includeTime: this.includeTime.checked,
                intervalMinutes: parseInt(this.intervalMinutes.value, 10)
            });

            this.updateProgress(100, 'Generating GPX file...');
            this.hideProgress();
            this.showResults(points.length, this.gpxContent);
            this.showErrors(errors);

        } catch (error) {
            this.hideProgress();
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    async handleExpandUrls() {
        const lines = this.urlInput.value.split('\n');
        const shortCount = lines.filter(line => MapsParser.shortLinkInfo(line)).length;

        if (shortCount === 0) {
            this.showStatus('No short URLs found in the input', 'info');
            return;
        }

        this.expandUrlBtn.disabled = true;
        this.showStatus(`Found ${shortCount} short URL(s) to expand...`, 'info');
        this.showProgress(0, shortCount, 'Starting URL expansion...');

        let done = 0;
        let expandedCount = 0;
        for (let i = 0; i < lines.length; i++) {
            if (!MapsParser.shortLinkInfo(lines[i])) continue;
            this.updateProgress((done / shortCount) * 100, `Expanding URL ${done + 1} of ${shortCount}...`);
            done++;
            try {
                lines[i] = await URLExpander.expandUrl(lines[i]);
                expandedCount++;
            } catch (error) {
                console.warn(`Failed to expand ${lines[i]}:`, error);
            }
        }

        this.hideProgress();
        this.expandUrlBtn.disabled = false;
        this.urlInput.value = lines.join('\n');

        if (expandedCount > 0) {
            this.showStatus(`Successfully expanded ${expandedCount} URL(s)`, 'success');
        } else {
            this.showStatus('Unable to expand URLs automatically. Please expand manually.', 'error');
        }
    }

    showResults(pointCount, gpxContent) {
        this.pointCount.textContent = `✅ ${pointCount} point(s) converted successfully!`;
        this.gpxPreview.textContent = gpxContent;
        this.resultsContainer.style.display = 'block';
        this.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.downloadBtn.style.animation = 'pulse 1s ease-in-out';
        this.showStatus('🎉 GPX file ready! Click the green download button below.', 'success');
    }

    clearResults() {
        this.resultsContainer.style.display = 'none';
        this.errorContainer.style.display = 'none';
        this.parsedPoints = [];
        this.gpxContent = '';
        this.hideProgress();
    }

    showProgress(current, total, message) {
        this.progressContainer.style.display = 'block';
        const percentage = total > 0 ? (current / total) * 100 : 0;
        this.updateProgress(percentage, message);
    }

    updateProgress(percentage, message) {
        if (this.progressFill && this.progressText) {
            this.progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
            this.progressText.textContent = message || `${Math.round(percentage)}% complete`;
        }
    }

    hideProgress() {
        if (this.progressContainer) {
            this.progressContainer.style.display = 'none';
        }
    }

    showStatus(message, type) {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
    }

    showErrors(errors) {
        if (errors.length === 0) return;

        this.errorList.innerHTML = '';
        errors.forEach(error => {
            const li = document.createElement('li');
            li.textContent = error;
            this.errorList.appendChild(li);
        });
        this.errorContainer.style.display = 'block';
    }

    setLoading(loading) {
        this.convertBtn.disabled = loading;
        this.convertBtn.classList.toggle('loading', loading);
    }

    downloadGPX() {
        if (this.parsedPoints.length === 0 || !this.gpxContent) {
            this.showStatus('❌ No GPX data to download. Please process URLs first.', 'error');
            return;
        }

        const filename = MapsParser.fileNameFor(this.routeName.value.trim());
        const blob = new Blob([this.gpxContent], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this.showStatus(`🎉 GPX file "${filename}" downloaded successfully! Check your Downloads folder.`, 'success');
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new GoogleMapsToGPXConverter();

    const examples = [
        '# Example URLs (delete this section and paste your URLs):',
        'https://www.google.com/maps/place/Limburg+an+der+Lahn/@50.3836,8.0503,13z',
        '50.2982625, 8.2650359',
        '',
        '# Multi-stop route (Bad Camberg to Scandinavia):',
        'https://www.google.com/maps/dir/Bad+Camberg,+65520/Malmö/Växjö/Jönköping/Halmstad/Grenaa/Odense/Flensburg/Bad+Camberg,+65520/@53.9154899,6.1642691,1744094m/data=!3m2!1e3!4b1!4m56!4m55!1m5!1m1!1s0x47bdb4026094960b:0x422435029b0a700!2m2!1d8.2650359!2d50.2982625!1m5!1m1!1s0x465305a574c3d5a1:0x4019078290e7a40!2m2!1d13.003822!2d55.604981!1m5!1m1!1s0x465723901633591b:0x4019078290e79e0!2m2!1d14.809064!2d56.877673!1m5!1m1!1s0x465a723867622839:0x4019078290e7a00!2m2!1d14.161788!2d57.782614!1m5!1m1!1s0x4651a26d7051287b:0x4019078290e79c0!2m2!1d12.857791!2d56.674377!1m5!1m1!1s0x464dd9450875e5e1:0x29046734e73647f3!2m2!1d10.874167!2d56.416944!1m5!1m1!1s0x464cd93939d93939:0x400bdbe05436a00!2m2!1d10.38831!2d55.39594!1m5!1m1!1s0x47b3429393939393:0x400bdbe05436a00!2m2!1d9.436754!2d54.783589!1m5!1m1!1s0x47bdb4026094960b:0x422435029b0a700!2m2!1d8.2650359!2d50.2982625!3e0?entry=tts'
    ];

    const urlInput = document.getElementById('urlInput');
    if (urlInput.value.trim() === '') {
        urlInput.value = examples.join('\n');
    }
});
