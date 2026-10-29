# GPX Parts Extractor

A web-based tool (Flask + Python) for extracting waypoints, tracks, and routes from GPX container files into individual, separately downloadable files.

## Overview

Upload a GPX file containing multiple components and the tool splits them into individual files:

- **Waypoints** → Single file with all waypoints
- **Tracks** → One file per track, named directly from the `<trk><name>` tag in the GPX
- **Routes** → One file per route (if present)

Files are kept in a persistent archive. Re-uploading the same file (detected by GPX build date) skips reprocessing and shows the existing results immediately.

## Live Demo

Available at: [https://tools.amrhein.info/extract-gpx-parts/](https://tools.amrhein.info/extract-gpx-parts/)

## Features

- **Web interface** — upload, manage and download via browser
- **Persistent archive** — processed files are kept for re-use; no need to re-upload
- **Deduplication** — re-uploading the same file goes straight to existing results
- **Smart naming** — track files named from `<trk><name>` (e.g. `TET_S-01_20260102.gpx`)
- **Country detection** — TET country codes extracted from track names (`S→Sweden`, `D→Germany`, etc.)
- **Namespace-aware parsing** — handles GPX files with XML namespaces correctly
- **Per-file descriptions** — editable description field per archived file
- **Batch download** — select multiple extracted files and download as ZIP
- **Token-protected deletion** — files deleted only with correct delete token
- **Background processing** — large files processed asynchronously with progress page

## Requirements

- Docker + Docker Compose
- Reverse proxy (nginx / Traefik) routing traffic to the container

Python dependencies (inside container): `flask`, `werkzeug`, `defusedxml`, `gunicorn`

## Deployment

### Docker Compose

```yaml
services:
  extract-gpx-parts:
    build:
      context: ./extract-gpx-parts
    container_name: extract-gpx-parts
    restart: unless-stopped
    ports:
      - "6020:8080"          # container listens on unprivileged port 8080
    mem_limit: 1g
    environment:
      - MAX_CONTENT_LENGTH_MB=100
      - DELETE_TOKEN=${GPX_EXTRACTOR_DELETE_TOKEN}   # keep in .env, never commit
      - SECRET_KEY=${GPX_EXTRACTOR_SECRET_KEY}
    volumes:
      - ./extract-gpx-parts/data/uploads:/app/web/uploads
      - ./extract-gpx-parts/data/processed:/app/web/processed
      - ./extract-gpx-parts/data/metadata:/app/web/metadata
      - ./extract-gpx-parts/web/static:/app/web/static
      - ./extract-gpx-parts/web/templates:/app/web/templates
```

### Nginx reverse proxy

The app expects to be served under a path prefix (e.g. `/extract-gpx-parts/`). Example nginx location blocks:

```nginx
location /extract-gpx-parts/ {
    proxy_pass http://extract-gpx-parts/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 1024M;
    proxy_request_buffering off;
}

# API endpoints called from browser JS
location ~ ^/(upload|select-file|processing|job-status|job-result|job-result-direct|download|download-selected|download-all|delete-file|update-description|favicon.ico|api) {
    proxy_pass http://extract-gpx-parts;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 1024M;
    proxy_request_buffering off;
    proxy_buffering off;
}
```

### Build & run

```bash
docker compose build extract-gpx-parts
docker compose up -d extract-gpx-parts
```

## File Naming Convention

| Component  | Filename pattern                             |
|------------|----------------------------------------------|
| Waypoints  | `{suggested_name}_waypoints.gpx`             |
| Tracks     | `{trk_name}.gpx` (from `<trk><name>` tag)   |
| Routes     | `{rte_name}.gpx` (from `<rte><name>` tag)   |
| Summary    | `{suggested_name}_extraction_summary.txt`    |

The archive unique ID is derived from the upload filename stem + GPX build date, e.g. `S_20260102` for `S.gpx` with build date `2026-01-02`.

## Archive & Deduplication Logic

1. On upload, the `<metadata><time>` (build date) is extracted from the GPX
2. If a file with the same clean name already exists:
   - **Same or older build date** → skip processing, redirect to existing results
   - **Newer build date** → replace the old file and reprocess
3. Pressing ▶ in the file list:
   - If already processed (output directory saved in metadata) → show existing results immediately
   - If not yet processed → start background processing

## Directory Structure

```
extract-gpx-parts/
├── Dockerfile
├── .dockerignore
├── gpx_extractor.py          # Core extraction logic
├── data/                     # Persistent data (volume-mounted, not in git)
│   ├── uploads/              # Original uploaded GPX files
│   ├── processed/            # Extracted output directories
│   └── metadata/             # JSON metadata per uploaded file
└── web/
    ├── app.py                # Flask application
    ├── requirements.txt
    ├── static/
    │   ├── style.css
    │   ├── script.js
    │   ├── results.js
    │   └── favicon.ico
    └── templates/
        ├── index.html        # Main upload + archive page
        ├── results.html      # Extraction results page
        └── processing.html   # Background job progress page
```

Without `DELETE_TOKEN` deleting from the archive is disabled.

## Permissions

The container runs as an unprivileged user (UID 1000 / GID 1001 by default, override with the build args `APP_UID`/`APP_GID` to match the owner of the data volumes). Files are created with group-write permissions (`664`/`775`) so members of that group on the host can manage them without `sudo`.

## Archive housekeeping

Archived uploads, their metadata and their output directories are kept. Only abandoned `temp_*` uploads (older than 1 hour) and output directories that no archive entry refers to (older than 1 day) are removed.

## Tests

```bash
pip install -r web/requirements.txt pytest
pytest
```

## Tested With

- Large GPX files (164,000+ lines, 10+ MB)
- 900+ waypoints
- 28 individual tracks
- Garmin Desktop App exports
- TET (Trans Euro Trail) GPX format

## Changelog

### v1.2
- Security: downloads, ZIP export and file-info API are confined to the processed folder (path traversal fix)
- Security: delete token and Flask secret key come from the environment; token compared in constant time
- Security: archive IDs validated, XML parsed with `defusedxml`, container runs as non-root behind gunicorn
- Archive is no longer wiped hourly; only temp uploads and orphaned output folders are cleaned up
- ZIP downloads built in memory (no leftover temp files)
- Track/route names escaped in output XML; duplicate names get `_2`, `_3`, ...; elevation (`ele`) kept
- Summary shown again for already-processed files; `/health` endpoint; real tests

### v1.1
- Persistent file archive — files no longer auto-deleted after processing
- Deduplication: re-upload detects same build date and skips reprocessing  
- Track files named directly from `<trk><name>` tag
- Country detection from TET track names
- Editable per-file description field
- Favicon + Apple touch icon + PWA icon
- Token-protected deletion
- Background processing with progress page
- Reverse-proxy path-prefix aware JS API calls (`window.location.pathname` based)
- Fixed permissions: processed files created with group-write (664/775)
- `.dockerignore` prevents runtime data from being baked into image

### v1.0
- Initial release: basic GPX extraction (waypoints, tracks, routes)
- Flask web interface, Docker deployment
