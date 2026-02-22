// Advanced URL expansion utilities for handling short URLs
class URLExpander {
    
    /**
     * Attempts to expand a short URL using multiple methods
     * @param {string} shortUrl - The short URL to expand
     * @returns {Promise<string>} - The expanded URL
     */
    static async expandUrl(shortUrl) {
        const methods = [
            this.expandViaFetch,
            this.expandViaIframe,
            this.expandViaProxy,
            this.expandViaCorsSite
        ];

        for (const method of methods) {
            try {
                const expanded = await method.call(this, shortUrl);
                if (expanded && expanded !== shortUrl && this.isValidExpandedUrl(expanded)) {
                    return expanded;
                }
            } catch (error) {
                console.warn(`URL expansion method failed:`, error);
                continue;
            }
        }

        throw new Error('All expansion methods failed');
    }

    /**
     * Method 1: Direct fetch with redirect following
     */
    static async expandViaFetch(shortUrl) {
        try {
            const response = await fetch(shortUrl, {
                method: 'HEAD',
                mode: 'cors', 
                redirect: 'follow',
                credentials: 'omit'
            });
            return response.url;
        } catch (error) {
            // Try with no-cors mode
            const response = await fetch(shortUrl, {
                method: 'GET',
                mode: 'no-cors',
                redirect: 'follow',
                credentials: 'omit'
            });
            return response.url;
        }
    }

    /**
     * Method 2: Hidden iframe approach (for some redirects)
     */
    static async expandViaIframe(shortUrl) {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '0px';
            iframe.style.height = '0px';
            
            let resolved = false;
            
            const cleanup = () => {
                if (iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            };

            iframe.onload = () => {
                try {
                    const expandedUrl = iframe.contentWindow.location.href;
                    if (!resolved && expandedUrl && expandedUrl !== shortUrl) {
                        resolved = true;
                        cleanup();
                        resolve(expandedUrl);
                    }
                } catch (error) {
                    // Cross-origin restrictions - can't access iframe content
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        reject(new Error('Cross-origin iframe access blocked'));
                    }
                }
            };

            iframe.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(new Error('Iframe failed to load'));
                }
            };

            // Timeout after 5 seconds
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(new Error('Iframe expansion timeout'));
                }
            }, 5000);

            document.body.appendChild(iframe);
            iframe.src = shortUrl;
        });
    }

    /**
     * Method 3: Use a CORS proxy service
     */
    static async expandViaProxy(shortUrl) {
        const proxyServices = [
            'https://api.allorigins.win/get?url=',
            'https://cors-anywhere.herokuapp.com/',
            'https://api.codetabs.com/v1/proxy?quest='
        ];

        for (const proxyBase of proxyServices) {
            try {
                const proxyUrl = proxyBase + encodeURIComponent(shortUrl);
                const response = await fetch(proxyUrl);
                
                if (response.ok) {
                    // For allorigins
                    if (proxyBase.includes('allorigins')) {
                        const data = await response.json();
                        return this.extractRedirectFromHtml(data.contents);
                    }
                    
                    // For direct proxies, check for redirected URL
                    return response.url;
                }
            } catch (error) {
                continue;
            }
        }

        throw new Error('All proxy services failed');
    }

    /**
     * Method 4: Use a dedicated URL expansion service
     */
    static async expandViaCorsSite(shortUrl) {
        // Using unshorten.me API (free tier available)
        try {
            const response = await fetch(`https://unshorten.me/s/${encodeURIComponent(shortUrl)}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.url) {
                    return data.url;
                }
            }
        } catch (error) {
            // Fallback to another service
        }

        throw new Error('CORS-enabled services failed');
    }

    /**
     * Extract redirect URLs from HTML content
     */
    static extractRedirectFromHtml(html) {
        // Look for JavaScript redirects
        const jsRedirectPatterns = [
            /window\.location\.replace\(["']([^"']+)["']\)/,
            /window\.location\.href\s*=\s*["']([^"']+)["']/,
            /location\.href\s*=\s*["']([^"']+)["']/,
            /window\.location\s*=\s*["']([^"']+)["']/
        ];

        for (const pattern of jsRedirectPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        // Look for meta refresh redirects
        const metaMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;\s*url=([^"']+)["']/i);
        if (metaMatch && metaMatch[1]) {
            return metaMatch[1];
        }

        // Look for canonical URLs (sometimes used for redirects)
        const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
        if (canonicalMatch && canonicalMatch[1]) {
            return canonicalMatch[1];
        }

        throw new Error('No redirect found in HTML');
    }

    /**
     * Validate that the expanded URL looks like a valid Google Maps URL
     */
    static isValidExpandedUrl(url) {
        const googleMapsPatterns = [
            /maps\.google\./,
            /www\.google\..+\/maps/,
            /maps\.app\.goo\.gl/
        ];

        return googleMapsPatterns.some(pattern => pattern.test(url)) && 
               (url.includes('@') || url.includes('q=') || url.includes('dir/'));
    }

    /**
     * Get suggestions for manual URL expansion
     */
    static getManualExpansionSuggestions(shortUrl) {
        const suggestions = [
            `1. Open ${shortUrl} in a new browser tab`,
            `2. Wait for the page to fully load and redirect`,
            `3. Copy the URL from your browser's address bar`,
            `4. The expanded URL should contain coordinates (@lat,lng) or location names`,
            `5. Paste the expanded URL back into this tool`
        ];

        return suggestions;
    }
}