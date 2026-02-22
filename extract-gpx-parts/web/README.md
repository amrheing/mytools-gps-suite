# GPX Extractor Web Interface

A user-friendly web application for extracting components from GPX files.

## Features

- 📤 **File Upload**: Drag & drop or click to upload GPX files
- 🔍 **Smart Extraction**: Automatically separates waypoints, tracks, and routes
- ✅ **File Selection**: Select individual files or groups by type
- 📦 **Batch Download**: Download selected files as a ZIP archive
- 👁️ **File Preview**: Quick preview of extracted files
- 📱 **Responsive Design**: Works on desktop and mobile devices

## Quick Start

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application:**
   ```bash
   python app.py
   ```

3. **Open your browser:**
   Navigate to `http://localhost:5000`

4. **Upload and extract:**
   - Select your GPX file
   - Click "Extract Components"
   - Select and download the files you need

## Usage

### Upload Process
1. Choose a GPX file (max 100MB)
2. Click "Extract Components"
3. Wait for processing to complete

### Download Options
- **Individual files**: Click the download button next to any file
- **Selected files**: Check files and click "Download Selected"
- **All files**: Click "Download All Files" for everything

### File Selection
- **Select All**: Choose all extracted files
- **Select None**: Clear all selections
- **Waypoints Only**: Select only waypoint files
- **Tracks Only**: Select only track files

## File Structure

```
web/
├── app.py                 # Flask application
├── requirements.txt       # Python dependencies
├── templates/
│   ├── index.html        # Upload page
│   └── results.html      # Results page
└── static/
    ├── style.css         # Styling
    ├── script.js         # Main JavaScript
    └── results.js        # Results page JavaScript
```

## Configuration

The application can be configured by modifying these variables in `app.py`:

```python
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # Max file size
UPLOAD_FOLDER = Path('uploads')                        # Upload directory
PROCESSED_FOLDER = Path('processed')                   # Output directory
```

## Security Notes

- Files are automatically deleted after 1 hour
- Only GPX files are accepted
- File size is limited to 100MB
- No data is permanently stored

## API Endpoints

- `GET /` - Main upload page
- `POST /upload` - Handle file upload and processing
- `GET /download/<directory>/<filename>` - Download individual files
- `POST /download-selected` - Download selected files as ZIP
- `GET /download-all/<directory>` - Download all files as ZIP
- `GET /api/file-info/<directory>` - Get file information (JSON)

## Browser Support

- Modern browsers with JavaScript enabled
- File API support required for drag & drop
- Tested on Chrome, Firefox, Safari, and Edge

## Troubleshooting

### Common Issues

1. **"File too large" error**
   - Reduce file size or increase `MAX_CONTENT_LENGTH`

2. **"Processing failed" error**
   - Check if the file is a valid GPX format
   - Ensure the file isn't corrupted

3. **Download not working**
   - Check browser popup blocker
   - Ensure JavaScript is enabled

### Development Mode

Run with debugging enabled:

```bash
FLASK_ENV=development python app.py
```

### Production Deployment

For production use, consider:
- Using a proper WSGI server (Gunicorn, uWSGI)
- Setting up reverse proxy (Nginx)
- Configuring proper file limits
- Adding authentication if needed

## License

This project is open source and available under the MIT License.