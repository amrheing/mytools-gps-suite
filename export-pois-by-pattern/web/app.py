#!/usr/bin/env python3
"""
POI Pattern Extractor Web Interface

A Flask web application for filtering and extracting POIs (waypoints)
from GPX files based on pattern matching.
"""

import os
import re
import sys
import json
import secrets
import time
import uuid
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Add the parent directory to sys.path to import poi_extractor
sys.path.append(str(Path(__file__).parent.parent))
from poi_extractor import POIExtractor


class PrefixMiddleware:
    """Set SCRIPT_NAME so url_for() builds URLs below the proxy prefix.

    nginx strips /export-pois-by-pattern/ before forwarding, so Flask only
    sees "/..." paths. Without this, generated links point to the site root.
    """

    def __init__(self, wsgi_app, prefix):
        self.wsgi_app = wsgi_app
        self.prefix = prefix.rstrip('/')

    def __call__(self, environ, start_response):
        if self.prefix:
            environ['SCRIPT_NAME'] = self.prefix
        return self.wsgi_app(environ, start_response)


app = Flask(__name__)
app.wsgi_app = PrefixMiddleware(app.wsgi_app, os.getenv('URL_PREFIX', '/export-pois-by-pattern'))
os.umask(0o002)  # Ensure new files/dirs get group-write (775/664) so host user can delete them
app.secret_key = os.getenv('SECRET_KEY') or secrets.token_hex(32)
# Default to 500MB unless overridden by env var
max_content_mb = int(os.getenv('MAX_CONTENT_LENGTH_MB', '500'))
app.config['MAX_CONTENT_LENGTH'] = max_content_mb * 1024 * 1024

# Configuration
UPLOAD_FOLDER = Path(__file__).parent / 'uploads'
PROCESSED_FOLDER = Path(__file__).parent / 'processed'
METADATA_FOLDER = Path(__file__).parent / 'metadata'  # Store file metadata
UPLOAD_FOLDER.mkdir(exist_ok=True)
PROCESSED_FOLDER.mkdir(exist_ok=True)
METADATA_FOLDER.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {'gpx'}
MAX_PATTERN_LENGTH = 200
JOB_ID_RE = re.compile(r'^[0-9a-f-]{36}$')

# Background processing setup
job_executor = ThreadPoolExecutor(max_workers=3)  # Limit concurrent jobs


def allowed_file(filename):
    """Check if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def valid_job_id(job_id):
    """Job IDs are UUID4 strings; reject anything else before touching the filesystem."""
    return bool(job_id and JOB_ID_RE.match(job_id))


def clean_old_files():
    """Clean up files older than 24 hours."""
    current_time = time.time()
    cutoff_time = current_time - (24 * 60 * 60)  # 24 hours ago

    for folder in [UPLOAD_FOLDER, PROCESSED_FOLDER, METADATA_FOLDER]:
        try:
            for file_path in folder.glob('*'):
                if file_path.is_file() and file_path.stat().st_mtime < cutoff_time:
                    file_path.unlink()
                    print(f"Cleaned up old file: {file_path}")
        except Exception as e:
            print(f"Error cleaning up files in {folder}: {e}")


def generate_job_id():
    """Generate a unique job ID."""
    return str(uuid.uuid4())


def find_upload(job_id):
    """Return the uploaded GPX file for a job, or None."""
    input_files = list(UPLOAD_FOLDER.glob(f"{job_id}_*.gpx"))
    return input_files[0] if input_files else None


def write_json(path, data):
    """Write JSON atomically so readers never see a half-written file."""
    tmp_path = path.with_suffix('.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


def load_metadata(job_id):
    """Load a job's metadata file, or None if it does not exist."""
    metadata_file = METADATA_FOLDER / f"{job_id}.json"
    if not metadata_file.exists():
        return None
    with open(metadata_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_metadata_file(job_id, original_filename, pattern_type, pattern):
    """Create a metadata file for tracking job information."""
    metadata = {
        'job_id': job_id,
        'original_filename': original_filename,
        'pattern_type': pattern_type,
        'pattern': pattern,
        'upload_time': datetime.now().isoformat(),
        'status': 'processing',
        'total_waypoints': 0,
        'matching_waypoints': 0,
        'results': []
    }

    metadata_file = METADATA_FOLDER / f"{job_id}.json"
    write_json(metadata_file, metadata)
    return metadata_file


def update_metadata(job_id, updates):
    """Update metadata file with new information."""
    metadata_file = METADATA_FOLDER / f"{job_id}.json"

    try:
        metadata = load_metadata(job_id) or {}
        metadata.update(updates)
        write_json(metadata_file, metadata)
    except Exception as e:
        print(f"Error updating metadata for job {job_id}: {e}")


def check_pattern(pattern_type, pattern):
    """Return an error message for an unusable pattern, or None."""
    if pattern_type not in ('wildcard', 'regex'):
        return 'Unknown pattern type'
    if not pattern:
        return 'Please enter a pattern'
    if len(pattern) > MAX_PATTERN_LENGTH:
        return f'Pattern is too long (max. {MAX_PATTERN_LENGTH} characters)'
    return None


def output_filename_for(original_filename, pattern_type, pattern):
    """Build a short, filesystem-safe name for the filtered GPX file."""
    original_name = Path(original_filename).stem[:60]
    if pattern_type == 'wildcard':
        pattern_clean = pattern.replace('*', 'star').replace('?', 'any')
        pattern_clean = secure_filename(pattern_clean)[:40] or 'pattern'
        return f"{original_name}_filtered_{pattern_clean}.gpx"
    return f"{original_name}_filtered_regex.gpx"


def filter_waypoints(waypoints, pattern_type, pattern):
    """Apply the selected pattern type to a list of waypoint dicts."""
    if pattern_type == 'wildcard':
        return POIExtractor.filter_by_wildcard_pattern(waypoints, pattern)
    return POIExtractor.filter_by_regex_pattern(waypoints, pattern)


def process_poi_extraction(job_id, input_file, original_filename, pattern_type, pattern):
    """Process POI extraction in the background."""
    try:
        # Initialize extractor
        extractor = POIExtractor(input_file)

        # Extract all waypoints first to get total count
        all_waypoints = extractor.extract_waypoints()
        total_count = len(all_waypoints)

        # Apply pattern filtering
        matching_waypoints = filter_waypoints(all_waypoints, pattern_type, pattern)
        matching_count = len(matching_waypoints)

        output_filename = output_filename_for(original_filename, pattern_type, pattern)
        output_file = PROCESSED_FOLDER / f"{job_id}_{output_filename}"

        # Create filtered GPX file
        extractor.create_filtered_gpx(matching_waypoints, output_file)

        # Update metadata
        update_metadata(job_id, {
            'status': 'completed',
            'total_waypoints': total_count,
            'matching_waypoints': matching_count,
            'output_filename': output_filename,
            'processing_time': time.time(),
            'results': [{'name': wp['name'], 'lat': wp['lat'], 'lon': wp['lon']} for wp in matching_waypoints[:100]]  # Limit to 100 for metadata
        })

    except ValueError as e:
        # Invalid GPX or pattern: the message is meant for the user
        update_metadata(job_id, {'status': 'error', 'error_message': str(e)})
    except Exception as e:
        print(f"Error processing job {job_id}: {e}")
        update_metadata(job_id, {
            'status': 'error',
            'error_message': 'An internal error occurred while processing the file.'
        })


def start_job(job_id, input_path, original_filename, pattern_type, pattern):
    """Create the job's metadata and hand it to the background executor."""
    create_metadata_file(job_id, original_filename, pattern_type, pattern)
    job_executor.submit(process_poi_extraction, job_id, str(input_path), original_filename, pattern_type, pattern)


@app.route('/')
def index():
    """Main upload page."""
    clean_old_files()
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and start processing."""
    file = request.files.get('file')
    pattern_type = request.form.get('pattern_type', 'wildcard')
    if pattern_type == 'wildcard':
        pattern = request.form.get('wildcard_pattern', '').strip()
    else:
        pattern = request.form.get('regex_pattern', '').strip()

    if not file or file.filename == '':
        flash('No file selected')
        return redirect(url_for('index'))

    error = check_pattern(pattern_type, pattern)
    if error:
        flash(error)
        return redirect(url_for('index'))

    if not allowed_file(file.filename):
        flash('Invalid file type. Only .gpx files are allowed.')
        return redirect(url_for('index'))

    try:
        # Generate job ID and save file
        job_id = generate_job_id()
        filename = secure_filename(file.filename) or 'upload.gpx'
        input_path = UPLOAD_FOLDER / f"{job_id}_{filename}"
        file.save(input_path)

        start_job(job_id, input_path, filename, pattern_type, pattern)
        return redirect(url_for('job_status', job_id=job_id))

    except Exception as e:
        print(f"Error starting upload job: {e}")
        flash('Error processing file')
        return redirect(url_for('index'))


@app.route('/preview-pois', methods=['POST'])
def preview_pois():
    """Upload file and show POI preview before filtering."""
    file = request.files.get('file')

    if not file or file.filename == '':
        flash('No file selected')
        return redirect(url_for('index'))

    if not allowed_file(file.filename):
        flash('Invalid file type. Only .gpx files are allowed.')
        return redirect(url_for('index'))

    try:
        # Generate job ID and save file temporarily
        job_id = generate_job_id()
        filename = secure_filename(file.filename) or 'upload.gpx'
        input_path = UPLOAD_FOLDER / f"{job_id}_{filename}"
        file.save(input_path)

        # Extract POIs for preview
        extractor = POIExtractor(str(input_path))
        waypoints = extractor.extract_waypoints()

        # Cache the names so live pattern tests don't re-parse the GPX on every keystroke
        write_json(METADATA_FOLDER / f"{job_id}_names.json", [w['name'] for w in waypoints])

        # Create preview data
        preview_data = {
            'job_id': job_id,
            'total_pois': len(waypoints),
            'filename': filename,
            'pois': [{'name': w['name'], 'lat': w['lat'], 'lon': w['lon']} for w in waypoints[:50]]  # Show first 50
        }

        return render_template('poi_preview.html', preview=preview_data)

    except ValueError as e:
        flash(f'Error reading GPX file: {e}')
        return redirect(url_for('index'))
    except Exception as e:
        print(f"Error previewing file: {e}")
        flash('Error reading GPX file')
        return redirect(url_for('index'))


@app.route('/api/filter-preview', methods=['POST'])
def filter_preview():
    """API endpoint to preview filtered POIs without processing."""
    data = request.get_json(silent=True) or {}
    job_id = data.get('job_id')
    pattern = (data.get('pattern') or '').strip()
    pattern_type = data.get('pattern_type', 'wildcard')

    if not valid_job_id(job_id):
        return jsonify({'error': 'Missing job_id'}), 400

    error = check_pattern(pattern_type, pattern)
    if error:
        return jsonify({'error': error}), 400

    names_file = METADATA_FOLDER / f"{job_id}_names.json"
    if not names_file.exists():
        return jsonify({'error': 'File not found'}), 404

    try:
        with open(names_file, 'r', encoding='utf-8') as f:
            all_waypoints = [{'name': name} for name in json.load(f)]

        filtered_waypoints = filter_waypoints(all_waypoints, pattern_type, pattern)

        return jsonify({
            'total_pois': len(all_waypoints),
            'filtered_count': len(filtered_waypoints),
            'sample_matches': [w['name'] for w in filtered_waypoints[:10]]
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Error in filter preview for job {job_id}: {e}")
        return jsonify({'error': 'Internal error'}), 500


@app.route('/process-filtered', methods=['POST'])
def process_filtered():
    """Process the POIs with the selected filter."""
    job_id = request.form.get('job_id')
    pattern_type = request.form.get('pattern_type', 'wildcard')
    pattern = request.form.get('pattern', '').strip()

    if not valid_job_id(job_id):
        flash('Missing job information')
        return redirect(url_for('index'))

    error = check_pattern(pattern_type, pattern)
    if error:
        flash(error)
        return redirect(url_for('index'))

    input_path = find_upload(job_id)
    if not input_path:
        flash('Original file not found')
        return redirect(url_for('index'))

    try:
        filename = input_path.name[len(job_id) + 1:]
        start_job(job_id, input_path, filename, pattern_type, pattern)
        return redirect(url_for('job_status', job_id=job_id))

    except Exception as e:
        print(f"Error starting job {job_id}: {e}")
        flash('Error starting processing')
        return redirect(url_for('index'))


@app.route('/job-status/<job_id>')
def job_status(job_id):
    """Check the status of a processing job."""
    job = load_metadata(job_id) if valid_job_id(job_id) else None
    if job is None:
        flash('Job not found')
        return redirect(url_for('index'))

    return render_template('job_status.html', job=job, job_id=job_id)


@app.route('/job-result/<job_id>')
def job_result(job_id):
    """Display job results and download options."""
    metadata = load_metadata(job_id) if valid_job_id(job_id) else None
    if metadata is None:
        flash('Job not found')
        return redirect(url_for('index'))

    if metadata['status'] != 'completed':
        return redirect(url_for('job_status', job_id=job_id))

    return render_template('job_result.html', metadata=metadata, job_id=job_id)


@app.route('/download/<job_id>')
def download_file(job_id):
    """Download the processed file."""
    metadata = load_metadata(job_id) if valid_job_id(job_id) else None
    if metadata is None:
        flash('Job not found')
        return redirect(url_for('index'))

    if metadata['status'] != 'completed':
        return redirect(url_for('job_status', job_id=job_id))

    output_file = PROCESSED_FOLDER / f"{job_id}_{metadata['output_filename']}"
    if not output_file.exists():
        flash('Output file not found (files are deleted after 24 hours)')
        return redirect(url_for('index'))

    return send_file(output_file, as_attachment=True, download_name=metadata['output_filename'])


@app.route('/api/job-status/<job_id>')
def api_job_status(job_id):
    """API endpoint to check job status."""
    metadata = load_metadata(job_id) if valid_job_id(job_id) else None
    if metadata is None:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(metadata)


@app.route('/shared/shared-styles.css')
def shared_styles():
    """Serve shared CSS file with cache-busting headers"""
    shared_css_path = Path(__file__).parent.parent / 'shared' / 'shared-styles.css'
    response = send_file(shared_css_path, mimetype='text/css')
    # Add cache-busting headers to force browser reload
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


if __name__ == '__main__':
    print(f"Starting POI Pattern Extractor on http://0.0.0.0:80")
    print(f"Upload folder: {UPLOAD_FOLDER}")
    print(f"Processed folder: {PROCESSED_FOLDER}")
    print(f"Metadata folder: {METADATA_FOLDER}")
    print(f"Max file size: {max_content_mb}MB")

    # Clean up old files on startup
    clean_old_files()

    app.run(host='0.0.0.0', port=80, debug=False)
