#!/usr/bin/env python3
"""
POI Pattern Extractor Web Interface

A Flask web application for filtering and extracting POIs (waypoints) 
from GPX files based on pattern matching.
"""

import os
import sys
import re
import zipfile
import json
import hashlib
import threading
import time
import uuid
import fnmatch
import tempfile
import shutil
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify, send_from_directory
from datetime import datetime
from xml.etree import ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

# Add the parent directory to sys.path to import poi_extractor
sys.path.append(str(Path(__file__).parent.parent))
from poi_extractor import POIExtractor

app = Flask(__name__)
os.umask(0o002)  # Ensure new files/dirs get group-write (775/664) so host user can delete them
app.secret_key = 'poi_extractor_web_2026'  # Change this in production
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
DELETE_TOKEN = 'POI-Pattern-Filter-2026-Secure'  # Secure delete token

# Background processing setup
active_jobs = {}  # Store active processing jobs
job_executor = ThreadPoolExecutor(max_workers=3)  # Limit concurrent jobs


def allowed_file(filename):
    """Check if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


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


def create_metadata_file(job_id, original_filename, pattern_type, pattern, regex_pattern=None):
    """Create a metadata file for tracking job information."""
    metadata = {
        'job_id': job_id,
        'original_filename': original_filename,
        'pattern_type': pattern_type,
        'pattern': pattern,
        'regex_pattern': regex_pattern,
        'upload_time': datetime.now().isoformat(),
        'status': 'processing',
        'total_waypoints': 0,
        'matching_waypoints': 0,
        'results': []
    }
    
    metadata_file = METADATA_FOLDER / f"{job_id}.json"
    with open(metadata_file, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    return metadata_file


def update_metadata(job_id, updates):
    """Update metadata file with new information."""
    metadata_file = METADATA_FOLDER / f"{job_id}.json"
    
    try:
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        metadata.update(updates)
        
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
            
    except Exception as e:
        print(f"Error updating metadata for job {job_id}: {e}")


def process_poi_extraction(job_id, input_file, pattern_type, pattern, regex_pattern=None):
    """Process POI extraction in the background."""
    try:
        # Load metadata
        metadata_file = METADATA_FOLDER / f"{job_id}.json"
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        # Initialize extractor
        extractor = POIExtractor(input_file)
        
        # Extract all waypoints first to get total count
        all_waypoints = extractor.extract_waypoints()
        total_count = len(all_waypoints)
        
        # Apply pattern filtering
        if pattern_type == 'wildcard':
            matching_waypoints = extractor.filter_by_wildcard_pattern(all_waypoints, pattern)
        elif pattern_type == 'regex':
            matching_waypoints = extractor.filter_by_regex_pattern(all_waypoints, regex_pattern)
        else:
            matching_waypoints = all_waypoints
        
        matching_count = len(matching_waypoints)
        
        # Generate output filename
        original_name = Path(input_file).stem
        if pattern_type == 'wildcard':
            pattern_clean = pattern.replace('*', 'star').replace('?', 'any').replace('/', '_')
            output_filename = f"{original_name}_filtered_{pattern_clean}.gpx"
        else:
            output_filename = f"{original_name}_filtered_regex.gpx"
            
        output_file = PROCESSED_FOLDER / f"{job_id}_{output_filename}"
        
        # Create filtered GPX file
        extractor.create_filtered_gpx(matching_waypoints, output_file)
        
        # Update metadata
        update_metadata(job_id, {
            'status': 'completed',
            'total_waypoints': total_count,
            'matching_waypoints': matching_count,
            'output_filename': output_filename,
            'output_file': str(output_file),
            'processing_time': time.time(),
            'results': [{'name': wp['name'], 'lat': wp['lat'], 'lon': wp['lon']} for wp in matching_waypoints[:100]]  # Limit to 100 for metadata
        })
        
        # Mark job as completed
        if job_id in active_jobs:
            active_jobs[job_id]['status'] = 'completed'
            active_jobs[job_id]['output_file'] = str(output_file)
            active_jobs[job_id]['output_filename'] = output_filename
        
    except Exception as e:
        print(f"Error processing job {job_id}: {e}")
        update_metadata(job_id, {
            'status': 'error',
            'error_message': str(e)
        })
        if job_id in active_jobs:
            active_jobs[job_id]['status'] = 'error'
            active_jobs[job_id]['error'] = str(e)


@app.route('/')
def index():
    """Main upload page."""
    clean_old_files()
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and start processing."""
    if 'file' not in request.files:
        flash('No file selected')
        return redirect(request.url)
    
    file = request.files['file']
    pattern_type = request.form.get('pattern_type', 'wildcard')
    wildcard_pattern = request.form.get('wildcard_pattern', '').strip()
    regex_pattern = request.form.get('regex_pattern', '').strip()
    
    if file.filename == '':
        flash('No file selected')
        return redirect(url_for('index'))
    
    if pattern_type == 'wildcard' and not wildcard_pattern:
        flash('Please enter a wildcard pattern')
        return redirect(url_for('index'))
    
    if pattern_type == 'regex' and not regex_pattern:
        flash('Please enter a regex pattern')
        return redirect(url_for('index'))
    
    if file and allowed_file(file.filename):
        try:
            # Generate job ID and save file
            job_id = generate_job_id()
            filename = secure_filename(file.filename)
            
            # Create unique filename with job ID
            input_filename = f"{job_id}_{filename}"
            input_path = UPLOAD_FOLDER / input_filename
            file.save(input_path)
            
            # Create metadata file
            if pattern_type == 'wildcard':
                create_metadata_file(job_id, filename, pattern_type, wildcard_pattern)
                pattern_to_use = wildcard_pattern
                regex_to_use = None
            else:
                create_metadata_file(job_id, filename, pattern_type, regex_pattern, regex_pattern)
                pattern_to_use = regex_pattern
                regex_to_use = regex_pattern
            
            # Start background processing
            active_jobs[job_id] = {
                'status': 'processing',
                'filename': filename,
                'pattern_type': pattern_type,
                'pattern': pattern_to_use,
                'start_time': time.time()
            }
            
            # Submit to executor
            job_executor.submit(process_poi_extraction, job_id, str(input_path), pattern_type, pattern_to_use, regex_to_use)
            
            flash(f'File uploaded successfully! Processing job: {job_id}')
            return redirect(url_for('job_status', job_id=job_id))
            
        except Exception as e:
            flash(f'Error processing file: {str(e)}')
            return redirect(url_for('index'))
    else:
        flash('Invalid file type. Only .gpx files are allowed.')
        return redirect(url_for('index'))


@app.route('/preview-pois', methods=['POST'])
def preview_pois():
    """Upload file and show POI preview before filtering."""
    if 'file' not in request.files:
        flash('No file selected')
        return redirect(url_for('index'))
    
    file = request.files['file']
    
    if file.filename == '':
        flash('No file selected')
        return redirect(url_for('index'))
    
    if file and allowed_file(file.filename):
        try:
            # Generate job ID and save file temporarily
            job_id = generate_job_id()
            filename = secure_filename(file.filename)
            
            # Create unique filename with job ID
            input_filename = f"{job_id}_{filename}"
            input_path = UPLOAD_FOLDER / input_filename
            file.save(input_path)
            
            # Extract POIs for preview
            extractor = POIExtractor(str(input_path))
            waypoints = extractor.extract_waypoints()
            
            # Create preview data
            preview_data = {
                'job_id': job_id,
                'total_pois': len(waypoints),
                'filename': filename,
                'pois': [{'name': w['name'], 'lat': w['lat'], 'lon': w['lon']} for w in waypoints[:50]]  # Show first 50
            }
            
            return render_template('poi_preview.html', preview=preview_data)
            
        except Exception as e:
            flash(f'Error reading GPX file: {str(e)}')
            return redirect(url_for('index'))
    else:
        flash('Invalid file type. Only .gpx files are allowed.')
        return redirect(url_for('index'))


@app.route('/api/filter-preview', methods=['POST'])
def filter_preview():
    """API endpoint to preview filtered POIs without processing."""
    data = request.get_json()
    job_id = data.get('job_id')
    pattern = data.get('pattern', '').strip()
    pattern_type = data.get('pattern_type', 'wildcard')
    
    if not job_id or not pattern:
        return jsonify({'error': 'Missing job_id or pattern'}), 400
    
    try:
        # Find the uploaded file
        input_files = list(UPLOAD_FOLDER.glob(f"{job_id}_*"))
        if not input_files:
            return jsonify({'error': 'File not found'}), 404
        
        input_path = input_files[0]
        extractor = POIExtractor(str(input_path))
        all_waypoints = extractor.extract_waypoints()
        
        # Apply filter
        if pattern_type == 'wildcard':
            filtered_waypoints = extractor.filter_by_wildcard_pattern(all_waypoints, pattern)
        else:  # regex
            filtered_waypoints = extractor.filter_by_regex_pattern(all_waypoints, pattern)
        
        return jsonify({
            'total_pois': len(all_waypoints),
            'filtered_count': len(filtered_waypoints),
            'sample_matches': [w['name'] for w in filtered_waypoints[:10]]
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/process-filtered', methods=['POST'])
def process_filtered():
    """Process the POIs with the selected filter."""
    job_id = request.form.get('job_id')
    pattern_type = request.form.get('pattern_type', 'wildcard')
    pattern = request.form.get('pattern', '').strip()
    
    print(f"[DEBUG] process_filtered called with job_id={job_id}, pattern='{pattern}', pattern_type={pattern_type}")
    
    if not job_id:
        flash('Missing job information')
        return redirect('/')
        
    if not pattern:
        flash('Please enter a pattern to filter POIs')
        return redirect('/')
    
    try:
        # Find the uploaded file
        input_files = list(UPLOAD_FOLDER.glob(f"{job_id}_*"))
        if not input_files:
            flash('Original file not found')
            return redirect('/')
        
        input_path = input_files[0]
        filename = input_path.name.replace(f"{job_id}_", "")
        
        # Create metadata file
        create_metadata_file(job_id, filename, pattern_type, pattern)
        
        # Start background processing
        def process_job():
            process_gpx_file(job_id, str(input_path), pattern_type, pattern)
        
        executor.submit(process_job)
        
        return redirect(f'/job-status/{job_id}')
        
    except Exception as e:
        flash(f'Error starting processing: {str(e)}')
        return redirect('/')


@app.route('/job-status/<job_id>')
def job_status(job_id):
    """Check the status of a processing job."""
    if job_id not in active_jobs:
        flash('Job not found')
        return redirect(url_for('index'))
    
    job = active_jobs[job_id]
    
    # Try to load metadata for additional details
    try:
        metadata_file = METADATA_FOLDER / f"{job_id}.json"
        if metadata_file.exists():
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            job.update(metadata)
    except Exception as e:
        print(f"Error loading metadata for job {job_id}: {e}")
    
    return render_template('job_status.html', job=job, job_id=job_id)


@app.route('/job-result/<job_id>')
def job_result(job_id):
    """Display job results and download options."""
    # Load job metadata
    try:
        metadata_file = METADATA_FOLDER / f"{job_id}.json"
        if not metadata_file.exists():
            flash('Job not found')
            return redirect(url_for('index'))
        
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        if metadata['status'] != 'completed':
            flash('Job not completed yet')
            return redirect(url_for('job_status', job_id=job_id))
        
        return render_template('job_result.html', metadata=metadata, job_id=job_id)
        
    except Exception as e:
        flash(f'Error loading job results: {str(e)}')
        return redirect(url_for('index'))


@app.route('/download/<job_id>')
def download_file(job_id):
    """Download the processed file."""
    try:
        metadata_file = METADATA_FOLDER / f"{job_id}.json"
        if not metadata_file.exists():
            flash('Job not found')
            return redirect(url_for('index'))
        
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        if metadata['status'] != 'completed':
            flash('Job not completed yet')
            return redirect(url_for('job_status', job_id=job_id))
        
        output_file = Path(metadata['output_file'])
        if not output_file.exists():
            flash('Output file not found')
            return redirect(url_for('index'))
        
        return send_file(output_file, as_attachment=True, download_name=metadata['output_filename'])
        
    except Exception as e:
        flash(f'Error downloading file: {str(e)}')
        return redirect(url_for('index'))


@app.route('/api/job-status/<job_id>')
def api_job_status(job_id):
    """API endpoint to check job status."""
    try:
        metadata_file = METADATA_FOLDER / f"{job_id}.json"
        if not metadata_file.exists():
            return jsonify({'error': 'Job not found'}), 404
        
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        return jsonify(metadata)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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