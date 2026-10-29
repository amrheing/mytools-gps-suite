// Short URL expansion via this tool's own server (nginx location /expand/).
// Only the short link ID is sent to Google; no third-party services are involved.
class URLExpander {
    static MAX_HOPS = 3;

    /**
     * Expand maps.app.goo.gl / goo.gl/maps links to the full Google Maps URL
     * @param {string} shortUrl
     * @returns {Promise<string>}
     */
    static async expandUrl(shortUrl) {
        let url = shortUrl.trim();
        for (let hop = 0; hop < this.MAX_HOPS; hop++) {
            const info = MapsParser.shortLinkInfo(url);
            if (!info) break;
            url = await this.resolveOnce(info);
        }
        if (MapsParser.shortLinkInfo(url)) throw new Error('Short URL could not be expanded');
        return url;
    }

    static async resolveOnce({ kind, id }) {
        let response;
        try {
            response = await fetch(`expand/${kind}/${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'omit' });
        } catch (error) {
            throw new Error('Short URL could not be expanded');
        }
        if (response.status === 404) throw new Error('Short URL not found');
        if (response.status === 429) throw new Error('Too many requests, please wait a minute');
        if (!response.ok) throw new Error('Short URL could not be expanded');

        const target = (await response.text()).trim();
        let parsed;
        try {
            parsed = new URL(target);
        } catch (error) {
            throw new Error('Short URL could not be expanded');
        }
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || !(MapsParser.isGoogleMapsHost(host) || host === 'maps.app.goo.gl' || host === 'goo.gl')) {
            throw new Error('Short URL does not point to Google Maps');
        }
        return parsed.href;
    }
}
