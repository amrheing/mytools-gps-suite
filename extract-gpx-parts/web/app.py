#!/usr/bin/env python3
"""
GPX Extractor Web Interface

A Flask web application for extracting GPX file components with 
upload, processing, and download functionality.
"""

import os
import sys
import zipfile
import socket
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify
import tempfile
import shutil
from datetime import datetime

# Add the parent directory to sys.path to import gpx_extractor
sys.path.append(str(Path(__file__).parent.parent))
from gpx_extractor import GPXExtractor

app = Flask(__name__)
app.secret_key = 'gpx_extractor_web_2026'  # Change this in production
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

# Configuration
UPLOAD_FOLDER = Path(__file__).parent / 'uploads'
PROCESSED_FOLDER = Path(__file__).parent / 'processed'
UPLOAD_FOLDER.mkdir(exist_ok=True)
PROCESSED_FOLDER.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {'gpx'}

def allowed_file(filename):
    """Check if the uploaded file has an allowed extension"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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

def cleanup_old_files():
    """Remove old processed files to free up disk space"""
    try:
        # Remove files older than 1 hour
        import time
        current_time = time.time()
        for folder in [UPLOAD_FOLDER, PROCESSED_FOLDER]:
            for file_path in folder.glob('**/*'):
                if file_path.is_file() and (current_time - file_path.stat().st_mtime) > 3600:
                    file_path.unlink()
    except Exception as e:
        print(f"Cleanup error: {e}")

@app.route('/')
def index():
    """Main upload page"""
    cleanup_old_files()
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload and processing"""
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
        # Save uploaded file
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{filename}"
        
        upload_path = UPLOAD_FOLDER / unique_filename
        file.save(upload_path)
        
        # Create output directory
        output_dir = PROCESSED_FOLDER / f"{timestamp}_{Path(filename).stem}_extracted"
        output_dir.mkdir(exist_ok=True)
        
        # Extract GPX components
        extractor = GPXExtractor(upload_path, output_dir)
        success = extractor.extract_all()
        
        if not success:
            flash('Error processing GPX file. Please check the file format.', 'error')
            return redirect(url_for('index'))
        
        # Get list of extracted files
        extracted_files = []
        for file_path in output_dir.glob('*.gpx'):
            file_info = {
                'name': file_path.name,
                'size': file_path.stat().st_size,
                'type': 'waypoints' if 'waypoints' in file_path.name else 
                        'track' if 'track' in file_path.name else 
                        'route' if 'route' in file_path.name else 'unknown'
            }
            extracted_files.append(file_info)
        
        # Sort files by type and name
        extracted_files.sort(key=lambda x: (x['type'], x['name']))
        
        # Read summary file
        summary_file = output_dir / f"{Path(filename).stem}_extraction_summary.txt"
        summary_content = ""
        if summary_file.exists():
            summary_content = summary_file.read_text()
        
        return render_template('results.html', 
                             extracted_files=extracted_files,
                             original_filename=filename,
                             output_directory=output_dir.name,
                             summary=summary_content)
    
    except Exception as e:
        flash(f'Error processing file: {str(e)}', 'error')
        return redirect(url_for('index'))

@app.route('/download/<path:directory>/<filename>')
def download_file(directory, filename):
    """Download a specific extracted file"""
    try:
        file_path = PROCESSED_FOLDER / directory / filename
        if not file_path.exists():
            flash('File not found', 'error')
            return redirect(url_for('index'))
        
        return send_file(file_path, as_attachment=True, download_name=filename)
    
    except Exception as e:
        flash(f'Error downloading file: {str(e)}', 'error')
        return redirect(url_for('index'))

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
            return redirect(url_for('index'))
        
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
        return redirect(url_for('index'))

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