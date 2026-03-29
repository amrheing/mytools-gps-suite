from flask import Flask, render_template, request, send_file, jsonify, redirect, url_for
import xml.etree.ElementTree as ET
import re
import os
import zipfile
import tempfile
from werkzeug.utils import secure_filename
import uuid
from datetime import datetime
import fnmatch

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
app.config['UPLOAD_FOLDER'] = '/tmp/uploads'
app.config['RESULTS_FOLDER'] = '/tmp/results'

# Ensure directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['RESULTS_FOLDER'], exist_ok=True)

# GPX namespace
GPX_NS = {'gpx': 'http://www.topografix.com/GPX/1/1'}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not file.filename.lower().endswith('.gpx'):
            return jsonify({'error': 'Only GPX files are allowed'}), 400
        
        # Generate unique filename
        job_id = str(uuid.uuid4())
        filename = f"{job_id}.gpx"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        file.save(filepath)
        
        # Extract basic POI info for preview
        pois = extract_all_pois(filepath)
        
        return jsonify({
            'job_id': job_id,
            'filename': secure_filename(file.filename),
            'total_pois': len(pois),
            'preview': pois[:10]  # Show first 10 for preview
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/search', methods=['POST'])
def search_pois():
    try:
        data = request.get_json()
        job_id = data.get('job_id')
        pattern = data.get('pattern', '').strip()
        use_regex = data.get('use_regex', False)
        case_sensitive = data.get('case_sensitive', False)
        
        if not job_id or not pattern:
            return jsonify({'error': 'Missing job_id or pattern'}), 400
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{job_id}.gpx")
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # Extract all POIs
        all_pois = extract_all_pois(filepath)
        
        # Filter POIs by pattern
        matching_pois = filter_pois_by_pattern(all_pois, pattern, use_regex, case_sensitive)
        
        return jsonify({
            'total_found': len(matching_pois),
            'matches': matching_pois,
            'pattern_used': pattern,
            'regex_mode': use_regex
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/export', methods=['POST'])
def export_pois():
    try:
        data = request.get_json()
        job_id = data.get('job_id')
        pattern = data.get('pattern', '').strip()
        use_regex = data.get('use_regex', False)
        case_sensitive = data.get('case_sensitive', False)
        export_format = data.get('format', 'gpx')
        
        if not job_id or not pattern:
            return jsonify({'error': 'Missing job_id or pattern'}), 400
        
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{job_id}.gpx")
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # Extract and filter POIs
        all_pois = extract_all_pois_full(filepath)
        matching_pois = filter_pois_by_pattern_full(all_pois, pattern, use_regex, case_sensitive)
        
        if not matching_pois:
            return jsonify({'error': 'No POIs match the pattern'}), 400
        
        # Create output file
        output_filename = f"pois_{pattern.replace('*', 'STAR').replace('?', 'Q')}_{len(matching_pois)}_pois.gpx"
        output_path = os.path.join(app.config['RESULTS_FOLDER'], f"{job_id}_{output_filename}")
        
        create_gpx_with_pois(matching_pois, output_path)
        
        return jsonify({
            'download_url': f"/download/{job_id}_{output_filename}",
            'filename': output_filename,
            'poi_count': len(matching_pois)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    try:
        filepath = os.path.join(app.config['RESULTS_FOLDER'], filename)
        if not os.path.exists(filepath):
            return "File not found", 404
        
        return send_file(filepath, as_attachment=True)
    except Exception as e:
        return str(e), 500

def extract_all_pois(filepath):
    """Extract basic POI info for preview"""
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        
        pois = []
        for wpt in root.findall('gpx:wpt', GPX_NS):
            name_elem = wpt.find('gpx:name', GPX_NS)
            name = name_elem.text if name_elem is not None else "Unnamed POI"
            
            lat = wpt.get('lat', '')
            lon = wpt.get('lon', '')
            
            pois.append({
                'name': name,
                'lat': lat,
                'lon': lon
            })
        
        return pois
    except Exception as e:
        raise Exception(f"Error parsing GPX file: {str(e)}")

def extract_all_pois_full(filepath):
    """Extract full POI data including all XML elements"""
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        
        pois = []
        for wpt in root.findall('gpx:wpt', GPX_NS):
            pois.append(wpt)
        
        return pois
    except Exception as e:
        raise Exception(f"Error parsing GPX file: {str(e)}")

def filter_pois_by_pattern(pois, pattern, use_regex=False, case_sensitive=False):
    """Filter POIs by pattern matching on names"""
    matching = []
    
    for poi in pois:
        name = poi['name']
        
        if not case_sensitive:
            name_to_check = name.lower()
            pattern_to_check = pattern.lower()
        else:
            name_to_check = name
            pattern_to_check = pattern
        
        match = False
        
        if use_regex:
            try:
                flags = 0 if case_sensitive else re.IGNORECASE
                match = bool(re.search(pattern_to_check, name_to_check, flags))
            except re.error:
                continue
        else:
            # Use fnmatch for wildcard patterns
            match = fnmatch.fnmatch(name_to_check, pattern_to_check)
        
        if match:
            matching.append(poi)
    
    return matching

def filter_pois_by_pattern_full(pois, pattern, use_regex=False, case_sensitive=False):
    """Filter POI XML elements by pattern matching"""
    matching = []
    
    for wpt in pois:
        name_elem = wpt.find('gpx:name', GPX_NS)
        name = name_elem.text if name_elem is not None else "Unnamed POI"
        
        if not case_sensitive:
            name_to_check = name.lower()
            pattern_to_check = pattern.lower()
        else:
            name_to_check = name
            pattern_to_check = pattern
        
        match = False
        
        if use_regex:
            try:
                flags = 0 if case_sensitive else re.IGNORECASE
                match = bool(re.search(pattern_to_check, name_to_check, flags))
            except re.error:
                continue
        else:
            # Use fnmatch for wildcard patterns
            match = fnmatch.fnmatch(name_to_check, pattern_to_check)
        
        if match:
            matching.append(wpt)
    
    return matching

def create_gpx_with_pois(pois, output_path):
    """Create a new GPX file with filtered POIs"""
    # Create GPX root structure
    gpx = ET.Element('gpx')
    gpx.set('version', '1.1')
    gpx.set('creator', 'POI Pattern Extractor')
    gpx.set('xmlns', 'http://www.topografix.com/GPX/1/1')
    gpx.set('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    gpx.set('xsi:schemaLocation', 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd')
    
    # Add metadata
    metadata = ET.SubElement(gpx, 'metadata')
    name_elem = ET.SubElement(metadata, 'name')
    name_elem.text = f'Filtered POIs ({len(pois)} points)'
    
    desc_elem = ET.SubElement(metadata, 'desc')
    desc_elem.text = f'POIs extracted by pattern matching on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}'
    
    time_elem = ET.SubElement(metadata, 'time')
    time_elem.text = datetime.now().isoformat() + 'Z'
    
    # Add POIs
    for poi in pois:
        gpx.append(poi)
    
    # Write to file
    tree = ET.ElementTree(gpx)
    ET.indent(tree, space="  ", level=0)
    tree.write(output_path, encoding='utf-8', xml_declaration=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)