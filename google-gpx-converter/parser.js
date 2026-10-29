// Google Maps URL parsing - pure functions, no DOM access (also loaded by the Node tests)
(function (root) {
    'use strict';

    const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
    const LAT_LNG = new RegExp(`^\\s*(?:loc:\\s*)?${NUM}\\s*,\\s*${NUM}`);
    const AT = new RegExp(`/@${NUM},${NUM}`);
    // Route waypoints in the data parameter: !1d<lng>!2d<lat>
    const ROUTE_PAIR = new RegExp(`!1d${NUM}!2d${NUM}`, 'g');
    // Position of a place in the data parameter: !3d<lat>!4d<lng>
    const PLACE_PAIR = new RegExp(`!3d${NUM}!4d${NUM}`);

    function isValidLatLng(lat, lng) {
        return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    }

    function point(lat, lng, name) {
        lat = Number(lat);
        lng = Number(lng);
        return isValidLatLng(lat, lng) ? { lat, lng, name: name || null } : null;
    }

    // "50.38, 8.05" or "loc:50.38,8.05 (Limburg)" -> point
    function parseLatLng(text, name) {
        const m = LAT_LNG.exec(text || '');
        return m ? point(m[1], m[2], name) : null;
    }

    function decodeSegment(segment) {
        try {
            return decodeURIComponent(segment.replace(/\+/g, ' ')).trim();
        } catch (error) {
            return segment.replace(/\+/g, ' ').trim();
        }
    }

    function isGoogleMapsHost(hostname) {
        return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(hostname);
    }

    function parseUrl(text) {
        try {
            return new URL(text.trim());
        } catch (error) {
            return null;
        }
    }

    // Returns { kind: 'app' | 'goo', id } for Google short links, otherwise null
    function shortLinkInfo(text) {
        const url = parseUrl(text);
        if (!url) return null;
        const host = url.hostname.toLowerCase();
        let m;
        if (host === 'maps.app.goo.gl' && (m = url.pathname.match(/^\/([A-Za-z0-9_-]{4,40})\/?$/))) {
            return { kind: 'app', id: m[1] };
        }
        if (host === 'goo.gl' && (m = url.pathname.match(/^\/maps\/([A-Za-z0-9_-]{4,40})\/?$/))) {
            return { kind: 'goo', id: m[1] };
        }
        return null;
    }

    // Path segments after /dir/ up to the map view (@...) or data part
    function directionSegments(pathname) {
        const parts = pathname.split('/');
        const start = parts.indexOf('dir');
        if (start === -1) return [];
        const segments = [];
        for (const part of parts.slice(start + 1)) {
            if (part.startsWith('@') || part.startsWith('data=') || part === 'am=t') break;
            if (part) segments.push(decodeSegment(part));
        }
        return segments;
    }

    function routePairs(data) {
        const pairs = [];
        if (!data) return pairs;
        ROUTE_PAIR.lastIndex = 0;
        let m;
        while ((m = ROUTE_PAIR.exec(data)) !== null) {
            const p = point(m[2], m[1]);
            if (p) pairs.push(p);
        }
        return pairs;
    }

    // Waypoints named in the path get their coordinates from the data parameter, in order.
    // Waypoints given as coordinates in the path have no entry there.
    function parseDirections(segments, data) {
        const pairs = routePairs(data);
        const points = [];
        const unresolved = [];
        let next = 0;

        for (const segment of segments) {
            const fromCoords = parseLatLng(segment);
            if (fromCoords) {
                points.push(fromCoords);
            } else if (next < pairs.length) {
                points.push({ ...pairs[next++], name: segment });
            } else {
                unresolved.push(segment);
            }
        }
        if (segments.length === 0) points.push(...pairs);
        return { points, unresolved };
    }

    function parseQueryValue(value, result) {
        if (!value) return;
        const text = decodeSegment(value);
        const p = parseLatLng(text);
        if (p) {
            const label = text.match(/\(([^)]+)\)\s*$/);
            if (label) p.name = label[1].trim();
            result.points.push(p);
        } else {
            result.unresolved.push(text);
        }
    }

    /**
     * Parse one input line (Google Maps URL or plain "lat, lng").
     * Returns { points: [{lat, lng, name}], unresolved: [names without coordinates] }.
     * Throws only if the line is not a supported Google Maps link.
     */
    function parseMapUrl(text) {
        const plain = parseLatLng(text);
        if (plain && !/^\s*https?:/i.test(text)) return { points: [plain], unresolved: [] };

        const url = parseUrl(text);
        if (!url || !/^https?:$/.test(url.protocol)) throw new Error('Not a valid URL');
        if (shortLinkInfo(text)) throw new Error('Short URL must be expanded first');
        if (!isGoogleMapsHost(url.hostname)) throw new Error('Not a Google Maps URL');

        const path = url.pathname;
        const params = url.searchParams;
        const dataMatch = path.match(/\/data=([^/]+)/);
        const data = dataMatch ? decodeSegment(dataMatch[1]) : '';
        const at = path.match(AT);
        const result = { points: [], unresolved: [] };

        // Directions: /maps/dir/A/B/... or /maps/dir/?api=1&origin=...&destination=...
        if (/\/dir(\/|$)/.test(path)) {
            const segments = directionSegments(path);
            if (segments.length === 0 && (params.has('origin') || params.has('destination'))) {
                const stops = [params.get('origin'), ...(params.get('waypoints') || '').split('|'), params.get('destination')];
                stops.filter(Boolean).forEach(stop => parseQueryValue(stop, result));
                return result;
            }
            const route = parseDirections(segments, data);
            if (route.points.length > 0 || route.unresolved.length > 0) return route;
        }

        // Place: /maps/place/<name>/@.../data=...!3d<lat>!4d<lng>
        const placeMatch = path.match(/\/place\/([^/]+)/);
        if (placeMatch) {
            const name = decodeSegment(placeMatch[1]);
            const placePair = data.match(PLACE_PAIR);
            const p = (placePair && point(placePair[1], placePair[2], name)) || parseLatLng(name) || (at && point(at[1], at[2], name));
            if (p) {
                p.name = name;
                result.points.push(p);
            } else {
                result.unresolved.push(name);
            }
            return result;
        }

        // Search: /maps/search/<query> or /maps/search/?api=1&query=...
        const searchMatch = path.match(/\/search\/([^/]+)/);
        if (searchMatch && !searchMatch[1].startsWith('@')) {
            parseQueryValue(searchMatch[1], result);
            return result;
        }

        // Query parameters (old and new style)
        for (const key of ['query', 'q', 'll', 'center', 'saddr', 'daddr', 'destination']) {
            if (!params.has(key)) continue;
            const value = params.get(key);
            if (key === 'daddr') {
                value.split(/\s+to:/).forEach(stop => parseQueryValue(stop, result));
            } else {
                parseQueryValue(value, result);
            }
        }
        if (result.points.length > 0 || result.unresolved.length > 0) return result;

        // A place in the data parameter without /place/ in the path
        const placePair = data.match(PLACE_PAIR);
        if (placePair) {
            const p = point(placePair[1], placePair[2]);
            if (p) return { points: [p], unresolved: [] };
        }

        // Plain map view: /maps/@lat,lng,zoom
        if (at) {
            const p = point(at[1], at[2]);
            if (p) return { points: [p], unresolved: [] };
        }

        throw new Error('Unsupported URL format');
    }

    function escapeXml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Build a GPX 1.1 document. Element order follows the schema: metadata, wpt, rte, trk.
     * options: { name, includeWaypoints, includeRoute, includeTrack, includeTime, intervalMinutes, now }
     */
    function generateGPX(points, options = {}) {
        const name = escapeXml(options.name || 'Google Maps Route');
        const now = options.now || new Date();
        const requested = Number(options.intervalMinutes);
        const interval = Number.isFinite(requested) ? Math.min(1440, Math.max(1, requested)) : 5;
        const includeWaypoints = options.includeWaypoints !== false;
        const includeRoute = options.includeRoute !== false && points.length > 1;
        const includeTrack = Boolean(options.includeTrack) && points.length > 1;
        const pointName = (p, i) => escapeXml(p.name || `Point ${i + 1}`);

        let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Google Maps to GPX Converter"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <time>${now.toISOString()}</time>
  </metadata>
`;
        if (includeWaypoints || points.length === 1) {
            points.forEach((p, i) => {
                gpx += `  <wpt lat="${p.lat}" lon="${p.lng}">
    <name>${pointName(p, i)}</name>
  </wpt>
`;
            });
        }
        if (includeRoute) {
            gpx += `  <rte>
    <name>${name}</name>
`;
            points.forEach((p, i) => {
                gpx += `    <rtept lat="${p.lat}" lon="${p.lng}">
      <name>${pointName(p, i)}</name>
    </rtept>
`;
            });
            gpx += `  </rte>
`;
        }
        if (includeTrack) {
            gpx += `  <trk>
    <name>${name}</name>
    <trkseg>
`;
            points.forEach((p, i) => {
                gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">`;
                if (options.includeTime) {
                    gpx += `<time>${new Date(now.getTime() + i * interval * 60000).toISOString()}</time>`;
                }
                gpx += `</trkpt>
`;
            });
            gpx += `    </trkseg>
  </trk>
`;
        }
        return gpx + '</gpx>\n';
    }

    // Route name -> safe file name, keeps letters with accents/umlauts
    function fileNameFor(routeName) {
        const base = (routeName || '').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
        return `${base || 'route'}.gpx`;
    }

    const api = { parseMapUrl, parseLatLng, shortLinkInfo, isGoogleMapsHost, generateGPX, escapeXml, fileNameFor };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapsParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
