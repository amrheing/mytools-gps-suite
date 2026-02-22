# Google Maps to GPX Converter

A simple web-based tool that converts Google Maps URLs to GPX files for use with GPS devices and navigation applications.

## Features

- **Multiple URL Format Support**: Handles various Google Maps URL formats including:
  - Direct coordinate URLs (`@lat,lng,zoom`)
  - Place search URLs (`?q=place+name`)
  - Direction URLs (`/dir/origin/destination`)
  - Short URLs (with limitations)

- **GPX Generation**: Creates valid GPX files with:
  - Waypoints for each location
  - Track sequences for multiple points
  - Configurable timestamps
  - Custom route names

- **User-Friendly Interface**:
  - Clean, responsive design
  - Real-time preview of generated GPX
  - Error reporting for invalid URLs
  - One-click download functionality

## How to Use

1. **Open the Tool**: Open `index.html` in your web browser
2. **Enter URLs**: Paste one or more Google Maps URLs in the text area (one per line)
3. **Configure Options**:
   - Set a custom route name (optional)
   - Choose whether to include timestamps
   - Set time intervals between points
4. **Convert**: Click "Convert to GPX"
5. **Download**: Click "Download GPX File" to save the result

## Supported URL Formats

### Direct Coordinates
```
https://www.google.com/maps/@40.7128,-74.0060,15z
https://maps.google.com/maps?ll=40.7128,-74.0060
```

### Place Searches
```
https://maps.google.com/maps?q=Central+Park,New+York
https://www.google.com/maps/search/Statue+of+Liberty
```

### Directions
```
https://www.google.com/maps/dir/Times+Square/Central+Park
https://maps.google.com/maps?origin=Times+Square&destination=Central+Park
```

### Share URLs
```
https://maps.app.goo.gl/xyz123
https://goo.gl/maps/abc123
```

**Short URL Support**: The tool now includes advanced short URL expansion with multiple methods:
- Automatic redirect following
- CORS proxy services  
- Hidden iframe expansion
- Manual expansion guidance

Use the "Try Auto-Expand URLs" button to automatically convert short URLs to their full forms.

## Technical Details

### Files Structure
- `index.html` - Main web interface
- `styles.css` - Responsive CSS styling
- `script.js` - Core conversion logic
- `url-expander.js` - Advanced short URL expansion utilities

### Short URL Handling
The tool includes sophisticated short URL expansion:
- **Multiple expansion methods**: Direct fetch, iframe, CORS proxies, and external services
- **Automatic fallback**: Tries multiple methods sequentially
- **Manual guidance**: Provides step-by-step instructions when auto-expansion fails
- **Smart detection**: Identifies various short URL patterns

### GPX Output
The tool generates GPX 1.1 compliant files with:
- Metadata including creation time and route name
- Track segments for routing between points
- Individual waypoints for each location
- Optional timestamps with configurable intervals

### Browser Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile responsive design
- No server-side dependencies (runs entirely in browser)

## Limitations

1. **Short URLs**: Most short URLs can be expanded automatically, but some may require manual expansion due to CORS restrictions
2. **Geocoding**: Place name URLs may not include exact coordinates (requires external geocoding service)
3. **Complex Routes**: Multi-stop routes with traffic data are simplified to waypoints
4. **Real-time Data**: Does not include live traffic or route conditions

## Examples

### Input URLs
```
https://www.google.com/maps/@40.7829,73.9654,15z
https://maps.google.com/maps?q=Brooklyn+Bridge,New+York
https://www.google.com/maps/dir/Times+Square/Brooklyn+Bridge
```

### Generated GPX
The tool will create a GPX file with waypoints for each location and a track connecting them.

## Development

To extend or modify the tool:

1. **URL Parsing**: Modify the `parseMapUrl` method in `script.js`
2. **GPX Format**: Update the `generateGPX` method for different output formats
3. **Styling**: Edit `styles.css` for visual changes
4. **Features**: Add new options in the HTML form and handle them in JavaScript

## Installation

No installation required! Simply:
1. Download all files to a directory
2. Open `index.html` in a web browser
3. Start converting URLs

## License

This project is open source and available under the MIT License.