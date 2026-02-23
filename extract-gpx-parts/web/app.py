#!/usr/bin/env python3
"""
GPX Extractor Web Interface

A Flask web application for extracting GPX file components with 
upload, processing, and download functionality.
"""

import os
import sys
import re
import zipfile
import socket
import json
import hashlib
import threading
import time
import uuid
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify
import tempfile
import shutil
from datetime import datetime
from xml.etree import ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

# Add the parent directory to sys.path to import gpx_extractor
sys.path.append(str(Path(__file__).parent.parent))
from gpx_extractor import GPXExtractor, GPXMetadataExtractor

app = Flask(__name__)
os.umask(0o002)  # Ensure new files/dirs get group-write (775/664) so host user can delete them
app.secret_key = 'gpx_extractor_web_2026'  # Change this in production
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
DELETE_TOKEN = 'NXeurology-Unwitting5-Ut]nworn'  # Secure delete token

# Background processing setup
processing_jobs = {}  # Store job status and results
job_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=2)  # Limit concurrent processing

@app.errorhandler(413)
def request_entity_too_large(_error):
    """Handle uploads that exceed MAX_CONTENT_LENGTH."""
    message = f'File too large. Max allowed size is {max_content_mb}MB.'
    if request.accept_mimetypes.best == 'application/json':
        return jsonify({'error': message}), 413
    flash(message, 'error')
    return redirect('/extract-gpx-parts/')

def allowed_file(filename):
    """Check if the uploaded file has an allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_short_name(filename_stem):
    """Extract short TET-style name from filename.
    e.g. 'TET_Sweden_v20200619_track_01_TET_D-01_20241001_S01' -> 'TET_D-01_20241001'
    Falls back to the original stem if no pattern matches.
    """
    # Match pattern like TET_XX-##_YYYYMMDD anywhere in the filename
    match = re.search(r'(TET_[A-Z]{1,3}-\d+_\d{8})', filename_stem)
    if match:
        return match.group(1)
    return filename_stem

def get_file_display_name(metadata, original_filename):
    """Generate display name: <filename> (<build_date>)"""
    clean_name = metadata.get('clean_name', Path(original_filename).stem)
    build_date = metadata.get('build_date', '')
    
    if build_date:
        # Format date for display
        try:
            if 'T' in build_date:
                date_part = build_date.split('T')[0]
                formatted_date = datetime.fromisoformat(date_part).strftime('%Y-%m-%d')
            else:
                formatted_date = build_date
            return f"{clean_name} ({formatted_date})"
        except:
            return f"{clean_name} ({build_date})"
    else:
        return clean_name

def save_file_metadata(unique_id, metadata, original_filename, file_path):
    """Save file metadata for management purposes"""
    metadata_file = METADATA_FOLDER / f"{unique_id}.json"
    file_info = {
        'unique_id': unique_id,
        'original_filename': original_filename,
        'file_path': str(file_path),
        'upload_date': datetime.now().isoformat(),
        'metadata': metadata,
        'display_name': get_file_display_name(metadata, original_filename),
        'clean_name': metadata.get('clean_name', Path(original_filename).stem),
        'description': ''
    }
    
    with open(metadata_file, 'w') as f:
        json.dump(file_info, f, indent=2)
    
    return file_info

def load_file_metadata(unique_id):
    """Load metadata for a specific file"""
    metadata_file = METADATA_FOLDER / f"{unique_id}.json"
    if not metadata_file.exists():
        return None
    
    try:
        with open(metadata_file, 'r') as f:
            return json.load(f)
    except:
        return None

def build_results_from_directory(file_info):
    """Reconstruct results dict from an already-processed output directory."""
    output_dir_name = file_info.get('output_directory')
    if not output_dir_name:
        return None
    output_dir = PROCESSED_FOLDER / output_dir_name
    if not output_dir.exists():
        return None

    extracted_files = []
    for gpx_file in sorted(output_dir.glob('*.gpx')):
        name_lower = gpx_file.name.lower()
        if 'waypoint' in name_lower:
            ftype = 'waypoints'
        elif 'route' in name_lower:
            ftype = 'route'
        else:
            ftype = 'track'
        extracted_files.append({
            'name': gpx_file.name,
            'size': gpx_file.stat().st_size,
            'type': ftype,
            'count': 0,
        })
    extracted_files.sort(key=lambda x: (x['type'], x['name']))

    summary_file = output_dir / 'summary.txt'
    summary_content = summary_file.read_text() if summary_file.exists() else ''

    meta = file_info.get('metadata', {})
    enhanced_metadata = {
        'trail_type': meta.get('trail_type'),
        'section_markers': meta.get('section_markers', []),
        'latest_modification': meta.get('latest_modification'),
        'creator': meta.get('creator'),
        'content_hash': meta.get('content_hash'),
        'suggested_name': meta.get('suggested_name'),
        'similar_versions': None,
    }

    return {
        'extracted_files': extracted_files,
        'original_filename': file_info.get('original_filename', ''),
        'output_directory': output_dir_name,
        'summary': summary_content,
        'enhanced_metadata': enhanced_metadata,
        'metadata': meta,
    }


def get_available_files():
    """Get list of available uploaded files with metadata"""
    available_files = []
    
    for metadata_file in METADATA_FOLDER.glob('*.json'):
        try:
            with open(metadata_file, 'r') as f:
                file_info = json.load(f)
                
            # Check if the actual file still exists
            file_path = Path(file_info.get('file_path', ''))
            if file_path.exists():
                available_files.append(file_info)
        except:
            continue
    
    # Sort by upload date, newest first
    available_files.sort(key=lambda x: x.get('upload_date', ''), reverse=True)
    return available_files

def is_newer_version(existing_metadata, new_metadata):
    """Check if new file has a newer build date than existing"""
    existing_date = existing_metadata.get('build_date', '')
    new_date = new_metadata.get('build_date', '')
    
    if not existing_date or not new_date:
        return True  # Allow if we can't determine dates
    
    try:
        existing_dt = datetime.fromisoformat(existing_date.replace('Z', '+00:00'))
        new_dt = datetime.fromisoformat(new_date.replace('Z', '+00:00'))
        return new_dt > existing_dt
    except:
        return True  # Allow if date parsing fails

def find_existing_file(clean_name):
    """Find existing file with same clean name"""
    for metadata_file in METADATA_FOLDER.glob('*.json'):
        try:
            with open(metadata_file, 'r') as f:
                file_info = json.load(f)
                
            if file_info.get('clean_name') == clean_name:
                return file_info
        except:
            continue
    return None

def start_background_processing(file_path, original_filename, existing_metadata=None, unique_id=None):
    """Start background processing and return job ID"""
    job_id = str(uuid.uuid4())
    print(f"Creating new job with ID: {job_id} for file: {original_filename}", flush=True)
    
    with job_lock:
        processing_jobs[job_id] = {
            'status': 'processing',
            'progress': 0,
            'message': 'Starting GPX processing...',
            'start_time': datetime.now().isoformat(),
            'result': None,
            'error': None
        }
        print(f"Job {job_id} added to processing_jobs. Total jobs: {len(processing_jobs)}", flush=True)
    
    # Submit job to executor
    future = executor.submit(background_process_gpx, job_id, file_path, original_filename, existing_metadata, unique_id)
    print(f"Background task submitted for job {job_id}", flush=True)
    
    return job_id

def background_process_gpx(job_id, file_path, original_filename, existing_metadata=None, unique_id=None):
    """Process GPX file in background thread"""
    try:
        # Update status
        update_job_status(job_id, 10, 'Loading GPX file...')
        
        # Extract GPX components with enhanced metadata
        extractor = GPXExtractor(file_path, PROCESSED_FOLDER)
        
        # Load GPX to get metadata before extracting
        if not extractor.load_gpx():
            update_job_status(job_id, 0, 'Error processing GPX file. Please check the file format.', 
                            status='error', error='Invalid GPX format')
            return
        
        update_job_status(job_id, 20, 'Analyzing GPX structure...')
        
        # Use existing metadata if provided (for selected files)
        if existing_metadata:
            extractor.metadata.update(existing_metadata)
        
        # Check for existing versions
        has_similar, similar_files = extractor.check_existing_version()
        
        update_job_status(job_id, 40, 'Preparing output directory...')
        
        # Use suggested name for output directory
        suggested_name = extractor.metadata.get('suggested_name', Path(original_filename).stem)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_dir = PROCESSED_FOLDER / f"{timestamp}_{suggested_name}_extracted"
        extractor.output_dir = output_dir
        output_dir.mkdir(exist_ok=True)
        
        update_job_status(job_id, 50, 'Extracting waypoints...')
        
        # Extract components
        waypoint_file = extractor.extract_waypoints_enhanced(suggested_name)
        
        update_job_status(job_id, 70, 'Extracting tracks...')
        track_files = extractor.extract_tracks_enhanced(suggested_name) 
        
        update_job_status(job_id, 85, 'Extracting routes...')
        route_files = extractor.extract_routes_enhanced(suggested_name)
        
        update_job_status(job_id, 95, 'Creating summary...')
        
        # Create enhanced summary
        summary_file = extractor.create_summary(waypoint_file, track_files, route_files)
        
        if not waypoint_file and not track_files and not route_files:
            update_job_status(job_id, 0, 'No extractable content found in GPX file.',
                            status='error', error='No extractable content')
            return
        
        # Get list of extracted files with enhanced information
        extracted_files = []
        
        if waypoint_file:
            file_info = {
                'name': waypoint_file.name,
                'size': waypoint_file.stat().st_size,
                'type': 'waypoints',
                'count': extractor.metadata['waypoint_count']
            }
            extracted_files.append(file_info)
        
        for track_file in track_files:
            file_info = {
                'name': track_file.name,
                'size': track_file.stat().st_size,
                'type': 'track',
                'count': 0  # Could extract track point count if needed
            }
            extracted_files.append(file_info)
        
        for route_file in route_files:
            file_info = {
                'name': route_file.name,
                'size': route_file.stat().st_size,
                'type': 'route',
                'count': 0  # Could extract route point count if needed
            }
            extracted_files.append(file_info)
        
        # Sort files by type and name
        extracted_files.sort(key=lambda x: (x['type'], x['name']))
        
        # Read summary file for display
        summary_content = summary_file.read_text() if summary_file.exists() else ""
        
        # Prepare enhanced metadata for display
        enhanced_metadata = {
            'trail_type': extractor.metadata.get('trail_type'),
            'section_markers': extractor.metadata.get('section_markers', []),
            'latest_modification': extractor.metadata.get('latest_modification'),
            'creator': extractor.metadata.get('creator'),
            'content_hash': extractor.metadata.get('content_hash'),
            'suggested_name': suggested_name,
            'similar_versions': similar_files if has_similar else None
        }
        
        # Store results
        result = {
            'extracted_files': extracted_files,
            'original_filename': original_filename,
            'output_directory': output_dir.name,
            'summary': summary_content,
            'enhanced_metadata': enhanced_metadata,
            'metadata': extractor.metadata
        }
        
        update_job_status(job_id, 100, 'Processing complete!', status='completed', result=result)

        # Persist output_directory in file metadata so we can serve existing results later
        if unique_id:
            file_meta = load_file_metadata(unique_id)
            if file_meta:
                file_meta['output_directory'] = output_dir.name
                metadata_file_path = METADATA_FOLDER / f"{unique_id}.json"
                with open(metadata_file_path, 'w') as mf:
                    json.dump(file_meta, mf, indent=2)

    except Exception as e:
        update_job_status(job_id, 0, f'Error processing file: {str(e)}',
                        status='error', error=str(e))

def update_job_status(job_id, progress, message, status=None, result=None, error=None):
    """Update job status in thread-safe manner"""
    with job_lock:
        if job_id in processing_jobs:
            processing_jobs[job_id]['progress'] = progress
            processing_jobs[job_id]['message'] = message
            processing_jobs[job_id]['last_update'] = datetime.now().isoformat()
            
            if status:
                processing_jobs[job_id]['status'] = status
            if result:
                processing_jobs[job_id]['result'] = result
            if error:
                processing_jobs[job_id]['error'] = error

@app.route('/job-status/<job_id>')
def get_job_status(job_id):
    """Get status of background processing job"""
    with job_lock:
        if job_id not in processing_jobs:
            return jsonify({'error': 'Job not found'}), 404
        
        job = processing_jobs[job_id].copy()
    
    return jsonify(job)

@app.route('/job-result-direct/<unique_id>')
def get_job_result_direct(unique_id):
    """Render results page for an already-processed file without a job"""
    file_info = load_file_metadata(unique_id)
    if not file_info:
        flash('File not found', 'error')
        return redirect('/extract-gpx-parts/')

    result = build_results_from_directory(file_info)
    if not result:
        flash('Processed archive not found. Re-processing required.', 'warning')
        return redirect('/extract-gpx-parts/')

    return render_template('results.html',
                           extracted_files=result['extracted_files'],
                           original_filename=result['original_filename'],
                           output_directory=result['output_directory'],
                           summary=result['summary'],
                           enhanced_metadata=result['enhanced_metadata'],
                           metadata=result['metadata'])

@app.route('/job-result/<job_id>')
def get_job_result(job_id):
    """Get result page for completed job"""
    with job_lock:
        if job_id not in processing_jobs:
            flash('Processing job not found', 'error')
            return redirect('/extract-gpx-parts/')
        
        job = processing_jobs[job_id]
        
        if job['status'] != 'completed' or not job.get('result'):
            flash('Job not completed or result not available', 'error')
            return redirect('/extract-gpx-parts/')
        
        result = job['result']
        
        # Clean up job after retrieving result
        del processing_jobs[job_id]
    
    return render_template('results.html', 
                         extracted_files=result['extracted_files'],
                         original_filename=result['original_filename'],
                         output_directory=result['output_directory'],
                         summary=result['summary'],
                         enhanced_metadata=result['enhanced_metadata'],
                         metadata=result['metadata'])

def cleanup_old_jobs():
    """Remove old job records to prevent memory leaks"""
    try:
        with job_lock:
            current_time = datetime.now()
            jobs_to_delete = []
            
            for job_id, job_data in processing_jobs.items():
                start_time = datetime.fromisoformat(job_data['start_time'])
                # Remove jobs older than 1 hour
                if (current_time - start_time).total_seconds() > 3600:
                    jobs_to_delete.append(job_id)
            
            for job_id in jobs_to_delete:
                del processing_jobs[job_id]
                
    except Exception as e:
        print(f"Job cleanup error: {e}")

def cleanup_old_files():
    """Remove old processed files to free up disk space"""
    try:
        # Remove files older than 1 hour
        import time
        current_time = time.time()
        for folder in [UPLOAD_FOLDER, PROCESSED_FOLDER, METADATA_FOLDER]:
            for file_path in folder.glob('**/*'):
                if file_path.is_file() and (current_time - file_path.stat().st_mtime) > 3600:
                    file_path.unlink()
    except Exception as e:
        print(f"Cleanup error: {e}")

def find_available_port(start_port=6001, max_port=6100):
    """Find an available port starting from start_port"""
    for port in range(start_port, max_port + 1):
        try:
            # Try to bind to the port to check if it's available
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"No available ports found in range {start_port}-{max_port}")

@app.route('/favicon.ico')
def favicon():
    return send_file(Path(__file__).parent / 'static' / 'favicon.ico', mimetype='image/x-icon')

@app.route('/')
def index():
    """Main upload page with available files list"""
    cleanup_old_files()
    cleanup_old_jobs()  # Clean up old processing jobs
    available_files = get_available_files()
    return render_template(
        'index.html',
        available_files=available_files,
        max_upload_mb=max_content_mb,
    )

@app.route('/select-file', methods=['POST'])
def select_file():
    """Handle file selection from available files list - Start background processing"""
    try:
        unique_id = request.json.get('unique_id')
        print(f"select_file called with unique_id: {unique_id}", flush=True)
        
        file_info = load_file_metadata(unique_id)
        
        if not file_info:
            print(f"File metadata not found for unique_id: {unique_id}", flush=True)
            return jsonify({'error': 'File not found'}), 404
        
        file_path = Path(file_info['file_path'])
        if not file_path.exists():
            print(f"File not found at path: {file_path}", flush=True)
            return jsonify({'error': 'File no longer exists'}), 404
        
        # If already processed, return existing results without re-processing
        existing_result = build_results_from_directory(file_info)
        if existing_result:
            return jsonify({
                'redirect': True,
                'url': f'/job-result-direct/{unique_id}',
                'message': 'File already processed — showing existing archive'
            })

        # Start background processing
        job_id = start_background_processing(file_path, file_info['original_filename'], file_info['metadata'], unique_id=unique_id)
        print(f"Started background processing with job_id: {job_id}", flush=True)
        
        with job_lock:
            print(f"Processing jobs after starting: {list(processing_jobs.keys())}", flush=True)
        
        return jsonify({
            'job_id': job_id,
            'status': 'processing',
            'message': 'File processing started in background'
        })
        
    except Exception as e:
        print(f"Error in select_file: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error starting processing: {str(e)}'}), 500

@app.route('/update-description', methods=['POST'])
def update_description():
    """Update the user description of a file"""
    unique_id = request.json.get('unique_id')
    description = request.json.get('description', '').strip()
    if not unique_id:
        return jsonify({'error': 'No unique_id provided'}), 400
    file_info = load_file_metadata(unique_id)
    if not file_info:
        return jsonify({'error': 'File not found'}), 404
    file_info['description'] = description
    metadata_file = METADATA_FOLDER / f"{unique_id}.json"
    with open(metadata_file, 'w') as f:
        json.dump(file_info, f, indent=2)
    return jsonify({'success': True})

@app.route('/delete-file', methods=['POST'])
def delete_file():
    """Delete file with token validation"""
    try:
        unique_id = request.json.get('unique_id')
        token = request.json.get('token')
        
        if token != DELETE_TOKEN:
            return jsonify({'error': 'Invalid delete token'}), 403
        
        file_info = load_file_metadata(unique_id)
        if not file_info:
            return jsonify({'error': 'File not found'}), 404
        
        # Delete the actual file
        file_path = Path(file_info['file_path'])
        if file_path.exists():
            file_path.unlink()
        
        # Delete metadata file
        metadata_file = METADATA_FOLDER / f"{unique_id}.json"
        if metadata_file.exists():
            metadata_file.unlink()
        
        return jsonify({'success': True, 'message': 'File deleted successfully'})
        
    except Exception as e:
        return jsonify({'error': f'Error deleting file: {str(e)}'}), 500

def process_gpx_file(file_path, original_filename, existing_metadata=None):
    """Process GPX file and return results"""
    try:
        # Extract GPX components with enhanced metadata
        extractor = GPXExtractor(file_path, PROCESSED_FOLDER)
        
        # Load GPX to get metadata before extracting
        if not extractor.load_gpx():
            return jsonify({'error': 'Error processing GPX file. Please check the file format.'}), 400
        
        # Use existing metadata if provided (for selected files)
        if existing_metadata:
            extractor.metadata.update(existing_metadata)
        
        # Check for existing versions
        has_similar, similar_files = extractor.check_existing_version()
        
        # Use suggested name for output directory
        suggested_name = extractor.metadata.get('suggested_name', Path(original_filename).stem)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_dir = PROCESSED_FOLDER / f"{timestamp}_{suggested_name}_extracted"
        extractor.output_dir = output_dir
        output_dir.mkdir(exist_ok=True)
        
        # Extract components
        waypoint_file = extractor.extract_waypoints_enhanced(suggested_name)
        track_files = extractor.extract_tracks_enhanced(suggested_name) 
        route_files = extractor.extract_routes_enhanced(suggested_name)
        
        # Create enhanced summary
        summary_file = extractor.create_summary(waypoint_file, track_files, route_files)
        
        if not waypoint_file and not track_files and not route_files:
            return jsonify({'error': 'No extractable content found in GPX file.'}), 400
        
        # Get list of extracted files with enhanced information
        extracted_files = []
        
        if waypoint_file:
            file_info = {
                'name': waypoint_file.name,
                'size': waypoint_file.stat().st_size,
                'type': 'waypoints',
                'count': extractor.metadata['waypoint_count']
            }
            extracted_files.append(file_info)
        
        for track_file in track_files:
            file_info = {
                'name': track_file.name,
                'size': track_file.stat().st_size,
                'type': 'track',
                'count': 0  # Could extract track point count if needed
            }
            extracted_files.append(file_info)
        
        for route_file in route_files:
            file_info = {
                'name': route_file.name,
                'size': route_file.stat().st_size,
                'type': 'route',
                'count': 0  # Could extract route point count if needed
            }
            extracted_files.append(file_info)
        
        # Sort files by type and name
        extracted_files.sort(key=lambda x: (x['type'], x['name']))
        
        # Read summary file for display
        summary_content = summary_file.read_text() if summary_file.exists() else ""
        
        # Prepare enhanced metadata for display
        enhanced_metadata = {
            'trail_type': extractor.metadata.get('trail_type'),
            'section_markers': extractor.metadata.get('section_markers', []),
            'latest_modification': extractor.metadata.get('latest_modification'),
            'creator': extractor.metadata.get('creator'),
            'content_hash': extractor.metadata.get('content_hash'),
            'suggested_name': suggested_name,
            'similar_versions': similar_files if has_similar else None
        }
        
        return render_template('results.html', 
                             extracted_files=extracted_files,
                             original_filename=original_filename,
                             output_directory=output_dir.name,
                             summary=summary_content,
                             enhanced_metadata=enhanced_metadata,
                             metadata=extractor.metadata)
    
    except Exception as e:
        return jsonify({'error': f'Error processing file: {str(e)}'}), 500

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and processing with enhanced metadata analysis"""
    if 'file' not in request.files:
        flash('No file selected', 'error')
        return redirect(request.url)
    
    file = request.files['file']
    
    if file.filename == '':
        flash('No file selected', 'error')
        return redirect(request.url)
    
    if not file or not allowed_file(file.filename):
        flash('Please upload a valid GPX file', 'error')
        return redirect(request.url)
    
    try:
        # Save uploaded file temporarily to extract metadata
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_path = UPLOAD_FOLDER / f"temp_{timestamp}_{filename}"
        
        file.save(temp_path)
        
        # Extract metadata first
        extractor = GPXExtractor(temp_path, PROCESSED_FOLDER)
        
        # Load GPX to get metadata
        if not extractor.load_gpx():
            temp_path.unlink()  # Clean up temp file
            flash('Error processing GPX file. Please check the file format.', 'error')
            return redirect('/extract-gpx-parts/')

        # DEBUG: print all extracted metadata + raw GPX content
        print(f"\n=== GPX METADATA DEBUG ===", flush=True)
        print(f"Original filename: {file.filename}", flush=True)
        print(f"Metadata from GPX extractor:", flush=True)
        for k, v in extractor.metadata.items():
            print(f"  {k}: {v}", flush=True)

        # Print raw track/waypoint names directly from the GPX tree
        print(f"\nRaw names from GPX elements:", flush=True)
        ns = extractor.namespace.get('default', '')
        root = extractor.root
        for tag in ['trk', 'wpt', 'rte']:
            full_tag = f'{{{ns}}}{tag}' if ns else tag
            for elem in root.findall(f'.//{full_tag}'):
                name_tag = f'{{{ns}}}name' if ns else 'name'
                name_el = elem.find(name_tag)
                if name_el is not None and name_el.text:
                    print(f"  <{tag}> name: {name_el.text}", flush=True)
        print(f"==========================\n", flush=True)
        
        # Get clean name for comparison - extract short name from the uploaded filename
        clean_name = extract_short_name(Path(filename).stem)
        
        # Check for existing file with same clean name
        existing_file = find_existing_file(clean_name)
        
        if existing_file:
            # Check if new file is newer
            if is_newer_version(existing_file['metadata'], extractor.metadata):
                # Remove old file and metadata
                old_file_path = Path(existing_file['file_path'])
                if old_file_path.exists():
                    old_file_path.unlink()
                
                old_metadata_file = METADATA_FOLDER / f"{existing_file['unique_id']}.json"
                if old_metadata_file.exists():
                    old_metadata_file.unlink()
                
                flash(f'Updated {clean_name} with newer version', 'success')
            else:
                # Keep existing file, remove temp — but show existing archive if processed
                temp_path.unlink()
                existing_result = build_results_from_directory(existing_file)
                if existing_result:
                    flash(f'{clean_name} is already in the archive.', 'info')
                    return redirect(f'/job-result-direct/{existing_file["unique_id"]}')
                flash(f'{clean_name} is already available in the file list.', 'info')
                return redirect('/extract-gpx-parts/')
        
        # Save the file permanently
        unique_filename = f"{timestamp}_{filename}"
        upload_path = UPLOAD_FOLDER / unique_filename
        temp_path.rename(upload_path)
        
        # Create unique identifier from filename and original creation date
        # Format: <short_name>_<YYYYMMDD_from_build_date>
        base_filename = extract_short_name(Path(filename).stem)

        # Override clean_name in extractor metadata with our short filename-based name
        extractor.metadata['clean_name'] = base_filename

        # Extract creation date from GPX metadata (build_date is from GPX <time> tag)
        build_date = extractor.metadata.get('build_date')
        if build_date:
            # Parse ISO format date and convert to YYYYMMDD
            try:
                # Handle ISO format: "2026-01-02T09:14:53.000Z"
                date_part = build_date.split('T')[0].replace('-', '')  # Extract YYYYMMDD
            except:
                date_part = timestamp  # Fallback to current timestamp
        else:
            date_part = timestamp
        
        unique_id = f"{base_filename}_{date_part}"
        
        # Save file metadata for management
        save_file_metadata(unique_id, extractor.metadata, filename, upload_path)
        
        # Start background processing
        job_id = start_background_processing(upload_path, filename, extractor.metadata, unique_id=unique_id)
        
        # Return processing page
        return render_template('processing.html', job_id=job_id, filename=filename)
    
    except Exception as e:
        # Clean up temp file on error
        if 'temp_path' in locals() and temp_path.exists():
            temp_path.unlink()
        flash(f'Error processing file: {str(e)}', 'error')
        return redirect('/extract-gpx-parts/')

@app.route('/download/<path:directory>/<filename>')
def download_file(directory, filename):
    """Download a specific extracted file"""
    try:
        file_path = PROCESSED_FOLDER / directory / filename
        if not file_path.exists():
            flash('File not found', 'error')
            return redirect('/extract-gpx-parts/')
        
        return send_file(file_path, as_attachment=True, download_name=filename)
    
    except Exception as e:
        flash(f'Error downloading file: {str(e)}', 'error')
        return redirect('/extract-gpx-parts/')

@app.route('/download-selected', methods=['POST'])
def download_selected():
    """Download selected files as a ZIP archive"""
    try:
        selected_files = request.json.get('files', [])
        directory = request.json.get('directory')
        
        if not selected_files:
            return jsonify({'error': 'No files selected'}), 400
        
        output_dir = PROCESSED_FOLDER / directory
        
        # Create temporary ZIP file
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_zip.close()
        
        with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for filename in selected_files:
                file_path = output_dir / filename
                if file_path.exists():
                    zipf.write(file_path, filename)
        
        zip_name = f"selected_gpx_files_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        
        def remove_file(response):
            try:
                os.unlink(temp_zip.name)
            except Exception:
                pass
            return response
        
        return send_file(temp_zip.name, as_attachment=True, download_name=zip_name)
    
    except Exception as e:
        return jsonify({'error': f'Error creating ZIP file: {str(e)}'}), 500

@app.route('/download-all/<directory>')
def download_all(directory):
    """Download all extracted files as a ZIP archive"""
    try:
        output_dir = PROCESSED_FOLDER / directory
        
        if not output_dir.exists():
            flash('Directory not found', 'error')
            return redirect('/extract-gpx-parts/')
        
        # Create temporary ZIP file
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_zip.close()
        
        with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in output_dir.glob('*'):
                if file_path.is_file():
                    zipf.write(file_path, file_path.name)
        
        zip_name = f"all_extracted_files_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        
        def remove_file(response):
            try:
                os.unlink(temp_zip.name)
            except Exception:
                pass
            return response
        
        return send_file(temp_zip.name, as_attachment=True, download_name=zip_name)
    
    except Exception as e:
        flash(f'Error creating ZIP file: {str(e)}', 'error')
        return redirect('/extract-gpx-parts/')

@app.route('/api/file-info/<path:directory>')
def get_file_info(directory):
    """API endpoint to get file information for AJAX requests"""
    try:
        output_dir = PROCESSED_FOLDER / directory
        
        if not output_dir.exists():
            return jsonify({'error': 'Directory not found'}), 404
        
        files = []
        for file_path in output_dir.glob('*.gpx'):
            file_info = {
                'name': file_path.name,
                'size': file_path.stat().st_size,
                'type': 'waypoints' if 'waypoints' in file_path.name else 
                        'track' if 'track' in file_path.name else 
                        'route' if 'route' in file_path.name else 'unknown',
                'url': url_for('download_file', directory=directory, filename=file_path.name)
            }
            files.append(file_info)
        
        return jsonify({'files': files})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def format_file_size(size_bytes):
    """Format file size in human-readable format"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"

# Template filter
app.jinja_env.filters['format_file_size'] = format_file_size

@app.route('/processing/<job_id>')
def processing_page(job_id):
    """Show processing page for a job"""
    with job_lock:
        if job_id not in processing_jobs:
            print(f"Job {job_id} not found in processing_jobs. Available jobs: {list(processing_jobs.keys())}", flush=True)
            flash('Processing job not found', 'error')
            return redirect('/extract-gpx-parts/')
        
        job = processing_jobs[job_id]
        
        # If job is already complete, redirect to results
        if job['status'] == 'completed':
            return redirect(url_for('get_job_result', job_id=job_id))
        
        # Use a default filename since we don't store it in job data
        filename = 'GPX File'
    
    print(f"Rendering processing page for job {job_id}", flush=True)
    return render_template('processing.html', job_id=job_id, filename=filename)

if __name__ == '__main__':
    print("🌐 Starting GPX Extractor Web Interface...")
    print("📁 Upload directory:", UPLOAD_FOLDER.absolute())
    print("📁 Processed directory:", PROCESSED_FOLDER.absolute())
    
    # Use fixed port for Docker deployment
    port = int(os.environ.get('PORT', 80))
    print(f"🔗 Access the application at: http://localhost:{port}")
    print()
    
    # Run Flask application
    app.run(host='0.0.0.0', port=port, debug=False)