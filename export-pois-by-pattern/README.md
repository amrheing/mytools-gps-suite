# POI Pattern Extractor

Filter and extract Points of Interest (waypoints) from GPX files using pattern matching.

## Features

- **Wildcard Patterns**: Use `*` and `?` for simple pattern matching
- **Regular Expressions**: Advanced pattern matching with full regex support
- **Large File Support**: Process GPX files up to 500MB
- **Web Interface**: User-friendly drag-and-drop interface
- **Auto Cleanup**: Files automatically deleted after 24 hours
- **Pattern Examples**: Built-in examples to help create patterns

## Usage Examples

### Wildcard Patterns

- `*-S28` - Matches POIs ending with "-S28"
- `*-?28` - Matches POIs ending with single character + "28" (e.g., -S28, -A28)
- `Bridge*` - Matches POIs starting with "Bridge"
- `*Tunnel*` - Matches POIs containing "Tunnel" anywhere

### Regular Expression Patterns

- `.*-S\d+$` - Matches POIs ending with "-S" followed by numbers
- `^! .+-S\d+$` - Matches POIs starting with "! " and ending with "-S" + numbers
- `Bridge|Tunnel` - Matches POIs containing "Bridge" OR "Tunnel"
- `\b(AVOID|DANGER)\b` - Matches POIs containing exact words "AVOID" or "DANGER"

## API Endpoints

- `GET /` - Main upload page
- `POST /upload` - Upload and process GPX file
- `GET /job-status/<job_id>` - Check processing status
- `GET /job-result/<job_id>` - View results
- `GET /download/<job_id>` - Download filtered GPX
- `GET /api/job-status/<job_id>` - JSON status API

## File Structure

```
export-pois-by-pattern/
├── web/
│   ├── app.py              # Flask application
│   ├── templates/          # HTML templates
│   ├── static/             # CSS, JS, images
│   ├── uploads/            # Temporary file storage
│   ├── processed/          # Processed files
│   └── metadata/           # Job metadata
├── poi_extractor.py        # Core POI extraction logic
├── Dockerfile              # Container configuration
└── README.md              # This file
```

## Development

### Local Development

```bash
cd web/
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Docker Build

```bash
docker build -t poi-pattern-extractor .
docker run -p 6030:80 poi-pattern-extractor
```

### Integration with myTools

This app is designed to integrate with the myTools suite:

1. **Shared CSS**: Uses `../../shared/shared-styles.css` for consistent styling
2. **Port 6030**: Configured to run on port 6030 in the myTools ecosystem
3. **nginx Integration**: Routed via nginx proxy at `/export-pois-by-pattern/`

## Common Use Cases

### Route Planning
Filter POIs by route segments (e.g., `*-S1*` for all Stage 1 POIs)

### Safety Planning
Extract warnings and hazards (e.g., `*AVOID*` or `*DANGER*`)

### Service Points
Find fuel, food, accommodation (e.g., `*Fuel*|*Food*|*Hotel*`)

### Navigation Waypoints
Filter checkpoint or milestone POIs (e.g., `Checkpoint*`)

## Technical Details

- **Backend**: Python 3.13 + Flask
- **Frontend**: Vanilla JavaScript + CSS Grid/Flexbox
- **Processing**: XML parsing with ElementTree
- **Pattern Matching**: Python `fnmatch` and `re` modules
- **File Handling**: Secure filename handling with Werkzeug
- **Concurrency**: ThreadPoolExecutor for background processing