# Google Maps to GPX Converter

Turns Google Maps links into a GPX file for navigation devices and apps (Garmin, BMW Navigator, DMD2, OsmAnd, …).

## How it works

- Everything runs in the browser except one thing: Google short links (`maps.app.goo.gl/…`, `goo.gl/maps/…`)
  are expanded by this tool's own nginx (`/expand/app/<id>`, `/expand/goo/<id>`). Only the link ID is sent to
  Google, with no client headers or cookies. Rate limited to 30 requests per minute per client.
- `parser.js` reads the coordinates from the link, `script.js` is the UI, `url-expander.js` calls the resolver.
- The GPX file contains every stop as a waypoint (`<wpt>`) and, for two or more stops, a route (`<rte>`) so the
  navigation device calculates the way itself. A track (`<trk>`, straight lines between the stops) and
  timestamps are optional. Google links contain only the stops, never the road geometry.

## Supported input (one per line)

| Input | Example | Coordinates taken from |
|---|---|---|
| Short link | `https://maps.app.goo.gl/5A5xc4qnSdL8DcVp6` | expanded, then as below |
| Place | `https://www.google.com/maps/place/Name/@50.38,8.06,13z/data=…!3d50.3836!4d8.0503` | `!3d/!4d` in `data=`, else `@` |
| Route | `https://www.google.com/maps/dir/A/B/@…/data=…!1d8.26!2d50.29…` | `!1d/!2d` in `data=`, coordinates in the path |
| Route (API) | `https://www.google.com/maps/dir/?api=1&origin=50.1,8.2&destination=50.3,8.4` | `origin`, `waypoints`, `destination` |
| Query | `https://maps.google.com/maps?q=50.1,8.2`, `?ll=`, `?query=`, `/maps/search/50.1,8.2` | parameter |
| Map view | `https://www.google.com/maps/@40.7128,-74.0060,15z` | `@` |
| Coordinates | `50.3836, 8.0503` | the line itself |

Lines starting with `#` are ignored. Place names without coordinates (e.g. `?q=Central+Park`, routes without
`data=`, some places shared from the Google Maps app) are reported as errors; there is no geocoding.

## Development

```bash
node --test google-gpx-converter/tests/   # parser and GPX tests
python3 -m http.server 8080                # UI only; short links need the nginx resolver (docker)
```

## Deployment

`docker compose up -d --build google-gpx-converter` in `/opt/containerd/myTools` (port 6010). On www.amrhein.info the
host nginx proxies `/google-gpx-converter/` to it and injects the site theme and the German translation
(`amrhein-website: public/tool-theme/i18n-de.js`) — new or changed UI texts need an entry there.
