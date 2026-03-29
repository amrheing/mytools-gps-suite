# GPX to KML Converter

A web-based tool that converts GPX (GPS Exchange Format) files to KML (Keyhole Markup Language) format for use with Google Earth, Google Maps, and other mapping applications.

## Features

- **File Upload Support**: Drag & drop or click to select GPX files
- **Complete GPX Parsing**: Handles waypoints, tracks, and routes
- **KML Generation**: Creates properly formatted KML files with:
  - Placemarks for waypoints
  - LineString paths for tracks and routes
  - Configurable styling (colors, line width)
  - Organized folder structure

- **Customization Options**:
  - Set custom KML document names
  - Choose track colors (Red, Green, Blue, Yellow, Magenta, Cyan)
  - Adjust line width (1-10px)
  - Toggle waypoints, tracks, and routes individually

- **User-Friendly Interface**:
  - Real-time file validation
  - Progress tracking during conversion
  - Statistics display (waypoint/track counts)
  - KML preview before download
  - Comprehensive error reporting

## How to Use

1. **Open the Tool**: Open `index.html` in your web browser
2. **Upload GPX File**: 
   - Drag & drop a GPX file onto the upload zone, or
   - Click "Select File" to browse for a GPX file
3. **Configure Options**:
   - Set a custom KML document name
   - Choose track color and width
   - Select which elements to include (waypoints, tracks, routes)
4. **Convert**: Click "Convert to KML" 
5. **Download**: Click "Download KML File" to save the result

## Supported GPX Elements

### Waypoints (`<wpt>`)
- Converted to KML Placemarks
- Preserves name, description, and location
- Includes elevation data when available
- Uses standard pushpin icon styling

### Tracks (`<trk>`)
- Converted to KML LineString paths
- Supports multiple track segments
- Preserves track name and description
- Maintains elevation and time data
- Applies configurable styling

### Routes (`<rte>`)
- Converted to KML LineString paths
- Preserves route name and description
- Includes all route points with names
- Uses same styling as tracks

## KML Output Format

The generated KML includes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Your Custom Name</name>
    <Style id="trackStyle">
      <!-- Track styling (color, width) -->
    </Style>
    <Folder>
      <name>Waypoints</name>
      <!-- Waypoint placemarks -->
    </Folder>
    <Folder>
      <name>Tracks</name>
      <!-- Track paths -->
    </Folder>
    <Folder>
      <name>Routes</name>
      <!-- Route paths -->
    </Folder>
  </Document>
</kml>
```

## Technical Details

### File Requirements
- **Supported formats**: `.gpx` and `.xml` files
- **Encoding**: UTF-8 (standard GPX format)
- **Schema**: Standard GPX 1.1 format

### Browser Support
- Modern web browsers with File API support
- JavaScript enabled
- No server-side processing required

### Processing Steps
1. **File Validation**: Checks file extension and format
2. **XML Parsing**: Uses DOM Parser to read GPX structure
3. **Data Extraction**: Parses waypoints, tracks, and routes
4. **KML Generation**: Creates properly formatted KML with styling
5. **Download**: Generates downloadable blob with correct MIME type

## Error Handling

The tool provides detailed error messages for:
- Invalid file formats
- Corrupted XML/GPX files
- Missing coordinate data
- Parsing failures
- Browser compatibility issues

## Related Tools

- **[Google Maps to GPX Converter](../google-gpx-converter/)**: Convert Google Maps URLs to GPX format
- **[Tools Landing Page](../index.html)**: Access all available tools

## File Structure

```
gpx-to-kml-converter/
├── index.html          # Main interface
├── script.js           # Core conversion logic
├── styles.css          # Custom styling
└── README.md           # This documentation
```

## Development

### Key Functions

- `parseGPX(xmlContent)`: Parses GPX XML and extracts data
- `generateKML(data)`: Converts parsed data to KML format
- `processFile(file)`: Handles file upload and validation
- `downloadKML()`: Generates and triggers KML download

### Dependencies

- Font Awesome (icons)
- Shared styles from `../shared/shared-styles.css`
- Modern browser APIs (File API, Blob, URL)

## Contributing

To add features or fix bugs:

1. Test with various GPX files from different GPS devices
2. Ensure KML compatibility with Google Earth and mapping apps
3. Maintain responsive design for mobile devices
4. Follow existing code structure and commenting style

## Known Limitations

- Client-side processing only (no server upload)
- Large files may impact browser performance
- Complex GPX extensions may not be preserved
- Styling options are limited to basic KML features

## Examples

### Input GPX
```xml
<gpx>
  <wpt lat="40.7128" lon="-74.0060">
    <name>New York City</name>
  </wpt>
  <trk>
    <name>Central Park Walk</name>
    <trkseg>
      <trkpt lat="40.7829" lon="-73.9654"><ele>45</ele></trkpt>
      <trkpt lat="40.7831" lon="-73.9656"><ele>47</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
```

### Output KML
```xml
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Converted Track</name>
    <Folder><name>Waypoints</name>
      <Placemark>
        <name>New York City</name>
        <Point><coordinates>-74.0060,40.7128</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder><name>Tracks</name>
      <Placemark>
        <name>Central Park Walk</name>
        <LineString>
          <coordinates>-73.9654,40.7829,45 -73.9656,40.7831,47</coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>
```