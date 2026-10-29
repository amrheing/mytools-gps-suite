// Run with: node --test google-gpx-converter/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

const coords = r => r.points.map(p => [p.lat, p.lng]);

test('place link uses the place position (!3d/!4d), not the map centre', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/place/Limburg/@50.38,8.06,13z/data=!3m1!4b1!4m6!3m5!1s0x47bc1b:0x4223!8m2!3d50.3836!4d8.0503');
    assert.deepEqual(coords(r), [[50.3836, 8.0503]]);
    assert.equal(r.points[0].name, 'Limburg');
});

test('place link without data falls back to @', () => {
    const r = P.parseMapUrl("https://www.google.com/maps/place/Park's+Inn/@33.57,-98.11,10z");
    assert.deepEqual(coords(r), [[33.57, -98.11]]);
    assert.equal(r.points[0].name, "Park's Inn");
});

test('place link without any coordinates is reported, not dropped silently', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/place/Via+Arnaldo+Tornieri,+62,+36100+Vicenza+VI/data=!4m2!3m1!1s0x477f322085032267:0x971009d62c31f087');
    assert.deepEqual(r.points, []);
    assert.deepEqual(r.unresolved, ['Via Arnaldo Tornieri, 62, 36100 Vicenza VI']);
});

test('multi-stop route takes waypoints from data, names from the path', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/dir/Pantheon/Vatican+City/@41.91,12.48,14.25z/am=t/data=!3m1!5s0x1:0x2!4m14!4m13!1m5!1m1!1s0x1:0x2!2m2!1d12.4768729!2d41.8986108!1m5!1m1!1s0x3:0x4!2m2!1d12.4536007!2d41.9021788!3e2?entry=tts');
    assert.deepEqual(coords(r), [[41.8986108, 12.4768729], [41.9021788, 12.4536007]]);
    assert.deepEqual(r.points.map(p => p.name), ['Pantheon', 'Vatican City']);
});

test('route with coordinates in the path mixes both sources in order', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/dir/50.1,8.2/Limburg/50.3,8.4/@50.2,8.3,10z/data=!4m8!4m7!1m0!1m5!1m1!1s0x1:0x2!2m2!1d8.05!2d50.38!1m0');
    assert.deepEqual(coords(r), [[50.1, 8.2], [50.38, 8.05], [50.3, 8.4]]);
    assert.equal(r.points[1].name, 'Limburg');
});

test('route without data does not collapse to the map centre', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/dir/Limburg/Frankfurt/@50.2,8.3,10z');
    assert.deepEqual(r.points, []);
    assert.deepEqual(r.unresolved, ['Limburg', 'Frankfurt']);
});

test('api=1 directions', () => {
    const r = P.parseMapUrl('https://www.google.com/maps/dir/?api=1&origin=50.1,8.2&destination=50.3,8.4&waypoints=50.2,8.3');
    assert.deepEqual(coords(r), [[50.1, 8.2], [50.2, 8.3], [50.3, 8.4]]);
});

test('query parameters: q, ll, query, loc: and labels', () => {
    assert.deepEqual(coords(P.parseMapUrl('https://maps.google.com/maps?q=50.1,8.2')), [[50.1, 8.2]]);
    assert.deepEqual(coords(P.parseMapUrl('https://maps.google.com/maps?ll=40.7128,-74.0060')), [[40.7128, -74.006]]);
    assert.deepEqual(coords(P.parseMapUrl('https://www.google.com/maps/search/?api=1&query=47.5,9.7')), [[47.5, 9.7]]);
    const r = P.parseMapUrl('https://www.google.de/maps?q=loc:50.1,8.2+(Treffpunkt)');
    assert.deepEqual(coords(r), [[50.1, 8.2]]);
    assert.equal(r.points[0].name, 'Treffpunkt');
    assert.deepEqual(P.parseMapUrl('https://maps.google.com/maps?q=Central+Park').unresolved, ['Central Park']);
});

test('search path and plain map view', () => {
    assert.deepEqual(coords(P.parseMapUrl('https://www.google.com/maps/search/50.1,+8.2')), [[50.1, 8.2]]);
    assert.deepEqual(P.parseMapUrl('https://www.google.com/maps/search/Limburg').unresolved, ['Limburg']);
    assert.deepEqual(coords(P.parseMapUrl('https://www.google.com/maps/@40.7128,-74.0060,15z')), [[40.7128, -74.006]]);
});

test('plain coordinates as input line', () => {
    assert.deepEqual(coords(P.parseMapUrl('50.2982625, 8.2650359')), [[50.2982625, 8.2650359]]);
});

test('invalid input is rejected', () => {
    assert.throws(() => P.parseMapUrl('https://example.com/maps/@50,8,10z'), /Not a Google Maps URL/);
    assert.throws(() => P.parseMapUrl('hello'), /Not a valid URL/);
    assert.throws(() => P.parseMapUrl('https://www.google.com/maps'), /Unsupported URL format/);
    assert.throws(() => P.parseMapUrl('https://www.google.com/maps/@95,8,10z'), /Unsupported URL format/);
});

test('short link detection', () => {
    assert.deepEqual(P.shortLinkInfo('https://maps.app.goo.gl/5A5xc4qnSdL8DcVp6'), { kind: 'app', id: '5A5xc4qnSdL8DcVp6' });
    assert.deepEqual(P.shortLinkInfo('https://goo.gl/maps/abc123'), { kind: 'goo', id: 'abc123' });
    assert.equal(P.shortLinkInfo('https://www.google.com/maps/dir/Bad+Camberg/Gate.com'), null);
    assert.equal(P.shortLinkInfo('https://maps.app.goo.gl/../etc'), null);
});

test('GPX follows the schema order and escapes names', () => {
    const points = [{ lat: 50.1, lng: 8.2, name: 'A & <B>' }, { lat: 50.3, lng: 8.4, name: null }];
    const gpx = P.generateGPX(points, { name: 'Tour "1"', includeTrack: true, includeTime: true, intervalMinutes: 0, now: new Date('2026-01-01T00:00:00Z') });
    const order = ['<metadata>', '<wpt', '<rte>', '<trk>'].map(tag => gpx.indexOf(tag));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every(i => i > 0));
    assert.match(gpx, /<name>A &amp; &lt;B&gt;<\/name>/);
    assert.match(gpx, /<name>Point 2<\/name>/);
    assert.match(gpx, /<name>Tour &quot;1&quot;<\/name>/);
    assert.match(gpx, /2026-01-01T00:01:00.000Z/, 'interval 0 is clamped to 1 minute');
});

test('GPX without track has no timestamps on points', () => {
    const gpx = P.generateGPX([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], { includeTime: true });
    assert.equal(gpx.includes('<trk>'), false);
    assert.equal((gpx.match(/<time>/g) || []).length, 1);
});

test('file name keeps umlauts', () => {
    assert.equal(P.fileNameFor('Skandinavien-Tour Växjö 2026'), 'Skandinavien-Tour_Växjö_2026.gpx');
    assert.equal(P.fileNameFor('  '), 'route.gpx');
});
