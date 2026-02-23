#!/usr/bin/env python3
"""
GPX Parts Extractor with Advanced Metadata Detection

This tool extracts different parts of a GPX file (waypoints, tracks, routes) 
into separate GPX files with intelligent naming based on metadata analysis.

Features:
- Automatic metadata extraction (name, version, build date)
- Smart filename generation with version detection
- Duplicate version detection and handling
- Enhanced GPX content analysis for better organization

Usage:
    python gpx_extractor.py input.gpx [output_directory]
"""

import sys
import os
import argparse
import re
import hashlib
from xml.etree import ElementTree as ET
from pathlib import Path
from datetime import datetime
from collections import Counter


class GPXMetadataExtractor:
    """Extract and analyze GPX file metadata for intelligent naming"""
    
    def __init__(self):
        self.patterns = {
            'tet_sweden': [
                r'tet\s*sweden', r'sweden\s*tet', r'trans\s*euro\s*trail\s*sweden',
                r'S-\d+', r'-S\d+', r'sweden', r'sverige'
            ],
            'version_markers': [
                r'v(\d+\.?\d*)', r'version\s*(\d+\.?\d*)', r'rev\s*(\d+)',
                r'build\s*(\d+)', r'(\d{4}-\d{2}-\d{2})', r'(\d{2}/\d{2}/\d{4})'
            ],
            'date_patterns': [
                r'(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z?',
                r'(\d{4}/\d{2}/\d{2})', r'(\d{2}/\d{2}/\d{4})',
                r'(\d{4}\d{2}\d{2})'
            ]
        }
    
    def extract_metadata(self, root, namespace=None):
        """Extract comprehensive metadata from GPX root element"""
        metadata = {
            'name': None,
            'description': None,
            'creator': None,
            'version': None,
            'build_date': None,
            'modification_date': None,
            'content_hash': None,
            'waypoint_count': 0,
            'track_count': 0,
            'route_count': 0,
            'section_markers': [],
            'suggested_name': None
        }
        
        # Extract basic metadata
        if namespace:
            metadata_elem = root.find('.//{%s}metadata' % namespace)
            waypoints = root.findall('.//{%s}wpt' % namespace)
            tracks = root.findall('.//{%s}trk' % namespace)
            routes = root.findall('.//{%s}rte' % namespace)
        else:
            metadata_elem = root.find('.//metadata')
            waypoints = root.findall('.//wpt')
            tracks = root.findall('.//trk')
            routes = root.findall('.//rte')
        
        # Count elements
        metadata['waypoint_count'] = len(waypoints)
        metadata['track_count'] = len(tracks)
        metadata['route_count'] = len(routes)
        
        # Extract creator and version info
        if 'creator' in root.attrib:
            metadata['creator'] = root.attrib['creator']
        if 'version' in root.attrib:
            metadata['version'] = root.attrib['version']
        
        # Extract metadata fields
        if metadata_elem is not None:
            for child in metadata_elem:
                tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                if tag == 'time':
                    metadata['build_date'] = child.text
                elif tag == 'name':
                    metadata['name'] = child.text
                elif tag == 'desc':
                    metadata['description'] = child.text
        
        # Analyze content for patterns
        content_analysis = self._analyze_content(waypoints, tracks, routes, namespace)
        metadata.update(content_analysis)
        
        # Generate content hash for version detection
        metadata['content_hash'] = self._generate_content_hash(root)
        
        # Generate suggested name
        metadata['suggested_name'] = self._generate_suggested_name(metadata)
        metadata['clean_name'] = self._generate_clean_name(metadata)
        
        return metadata
    
    def _analyze_content(self, waypoints, tracks, routes, namespace=None):
        """Analyze GPX content for patterns and metadata"""
        analysis = {
            'section_markers': [],
            'trail_type': None,
            'geographic_region': None,
            'latest_modification': None
        }
        
        section_pattern = re.compile(r'-?S(\d+)', re.IGNORECASE)
        date_pattern = re.compile(r'(\d{4}-\d{2}-\d{2})')
        
        all_names = []
        all_dates = []
        section_numbers = []
        
        # Analyze waypoint names and times
        for wpt in waypoints:
            # Handle namespaced element searches
            if namespace:
                name_elem = wpt.find('.//{%s}name' % namespace)
                time_elem = wpt.find('.//{%s}time' % namespace)
            else:
                name_elem = wpt.find('.//name')
                time_elem = wpt.find('.//time')
            
            if name_elem is not None and name_elem.text:
                name = name_elem.text
                all_names.append(name)
                
                # Look for section markers like -S12, S18, etc.
                sections = section_pattern.findall(name)
                section_numbers.extend([int(s) for s in sections])
            
            if time_elem is not None and time_elem.text:
                time_text = time_elem.text
                dates = date_pattern.findall(time_text)
                all_dates.extend(dates)
        
        # Analyze track names
        for trk in tracks:
            if namespace:
                name_elem = trk.find('.//{%s}name' % namespace)
            else:
                name_elem = trk.find('.//name')
            
            if name_elem is not None and name_elem.text:
                all_names.append(name_elem.text)
        
        # Determine trail type and region based on content
        name_text = ' '.join(all_names) if all_names else ""
        name_text_lower = name_text.lower()

        # TET country code map: TET_X-## where X is the country code
        tet_country_codes = {
            'S': ('TET_Sweden', 'Sweden'),
            'D': ('TET_Germany', 'Germany'),
            'A': ('TET_Austria', 'Austria'),
            'CH': ('TET_Switzerland', 'Switzerland'),
            'F': ('TET_France', 'France'),
            'E': ('TET_Spain', 'Spain'),
            'P': ('TET_Portugal', 'Portugal'),
            'I': ('TET_Italy', 'Italy'),
            'HR': ('TET_Croatia', 'Croatia'),
            'SLO': ('TET_Slovenia', 'Slovenia'),
            'BIH': ('TET_BosniaHerzegovina', 'Bosnia'),
            'MNE': ('TET_Montenegro', 'Montenegro'),
            'AL': ('TET_Albania', 'Albania'),
            'MK': ('TET_NorthMacedonia', 'North Macedonia'),
            'GR': ('TET_Greece', 'Greece'),
        }

        detected_trail = None
        detected_region = None

        # Try to detect country from TET_XX-## pattern in track names
        tet_country_match = re.search(r'TET_([A-Z]{1,3})-\d+', name_text)
        if tet_country_match:
            code = tet_country_match.group(1)
            if code in tet_country_codes:
                detected_trail, detected_region = tet_country_codes[code]
            else:
                detected_trail = f'TET_{code}'
                detected_region = code

        # Fallback: check for explicit country names in text
        if not detected_trail:
            for code, (trail, region) in tet_country_codes.items():
                if region.lower() in name_text_lower:
                    detected_trail = trail
                    detected_region = region
                    break

        # Final fallback: generic TET if TET keyword present
        if not detected_trail and 'tet' in name_text_lower:
            detected_trail = 'TET'
            detected_region = None

        if detected_trail:
            analysis['trail_type'] = detected_trail
            analysis['geographic_region'] = detected_region
        
        # Find section ranges
        if section_numbers:
            min_section = min(section_numbers)
            max_section = max(section_numbers)
            if min_section == max_section:
                analysis['section_markers'] = [f"S{min_section:02d}"]
            else:
                analysis['section_markers'] = [f"S{min_section:02d}-S{max_section:02d}"]
        
        # Find latest modification date
        if all_dates:
            latest_date = max(all_dates)
            analysis['latest_modification'] = latest_date
        
        return analysis
    
    def _generate_content_hash(self, root):
        """Generate hash of GPX content for version detection"""
        # Create a normalized string representation of the GPX content
        content_parts = []
        
        # Include key metadata
        if 'creator' in root.attrib:
            content_parts.append(f"creator:{root.attrib['creator']}")
        
        # Include bounds if available
        metadata = root.find('.//metadata')
        if metadata is not None:
            bounds = metadata.find('.//bounds')
            if bounds is not None:
                bound_str = f"bounds:{bounds.attrib.get('minlat', '')},{bounds.attrib.get('maxlat', '')}"
                content_parts.append(bound_str)
        
        # Include counts of major elements
        waypoints = root.findall('.//wpt')
        tracks = root.findall('.//trk')
        routes = root.findall('.//rte')
        
        content_parts.append(f"counts:wpt={len(waypoints)},trk={len(tracks)},rte={len(routes)}")
        
        # Create hash
        content_string = '|'.join(content_parts)
        return hashlib.md5(content_string.encode()).hexdigest()[:8]
    
    def _generate_suggested_name(self, metadata):
        """Generate a suggested filename based on metadata analysis"""
        name_parts = []
        
        # Use trail type if identified
        if metadata.get('trail_type'):
            name_parts.append(metadata['trail_type'].replace(' ', '_'))
        elif metadata.get('name'):
            # Clean up the name
            clean_name = re.sub(r'[^\w\s-]', '', metadata['name'])
            name_parts.append(clean_name.replace(' ', '_'))
        else:
            name_parts.append('GPX_Track')
        
        # Add section information
        if metadata.get('section_markers'):
            name_parts.append(metadata['section_markers'][0])
        
        # Add version/date information
        version_part = None
        if metadata.get('latest_modification'):
            # Use latest modification date as version
            date_str = metadata['latest_modification'].replace('-', '')
            version_part = f"v{date_str}"
        elif metadata.get('build_date'):
            # Use build date
            build_date = metadata['build_date']
            if 'T' in build_date:
                date_part = build_date.split('T')[0].replace('-', '')
                version_part = f"v{date_part}"
        
        if version_part:
            name_parts.append(version_part)
        
        # No content hash for cleaner names
        return '_'.join(name_parts)
    
    def _generate_clean_name(self, metadata):
        """Generate a clean name without version/hash for file management"""
        name_parts = []
        
        # Use trail type if identified
        if metadata.get('trail_type'):
            name_parts.append(metadata['trail_type'].replace(' ', '_'))
        elif metadata.get('name'):
            # Clean up the name
            clean_name = re.sub(r'[^\w\s-]', '', metadata['name'])
            name_parts.append(clean_name.replace(' ', '_'))
        else:
            name_parts.append('GPX_Track')
        
        # Add section information
        if metadata.get('section_markers'):
            name_parts.append(metadata['section_markers'][0])
        
        return '_'.join(name_parts)
    
    def get_unique_identifier(self, metadata):
        """Get unique identifier for file management (filename without hash)"""
        return self._generate_suggested_name(metadata)
    
    def get_file_display_name(self, metadata, original_filename):
        """Get display name in format: filename (build_date)"""
        build_date = metadata.get('build_date')
        if build_date and 'T' in build_date:
            date_part = build_date.split('T')[0]
            return f"{original_filename} ({date_part})"
        return original_filename


class GPXExtractor:
    def __init__(self, gpx_file_path, output_dir=None):
        self.gpx_file_path = Path(gpx_file_path)
        self.output_dir = Path(output_dir) if output_dir else self.gpx_file_path.parent
        self.tree = None
        self.root = None
        self.namespace = {}
        self.metadata = {}
        self.metadata_extractor = GPXMetadataExtractor()
        
    def load_gpx(self):
        """Load and parse the GPX file with metadata analysis"""
        try:
            self.tree = ET.parse(self.gpx_file_path)
            self.root = self.tree.getroot()
            
            # Extract namespace information
            if self.root.tag.startswith('{'):
                self.namespace[''] = self.root.tag.split('}')[0][1:]
                self.namespace['default'] = self.namespace['']
            
            # Extract comprehensive metadata
            namespace = self.namespace.get('default')
            self.metadata = self.metadata_extractor.extract_metadata(self.root, namespace)
            
            print(f"✓ Loaded GPX file: {self.gpx_file_path}")
            print(f"✓ Root namespace: {self.namespace.get('default', 'None')}")
            print(f"✓ Detected content: {self.metadata.get('trail_type', 'Unknown')}")
            
            if self.metadata.get('suggested_name'):
                print(f"✓ Suggested name: {self.metadata['suggested_name']}")
            
            self._print_content_summary()
            return True
        except Exception as e:
            print(f"✗ Error loading GPX file: {e}")
            return False
    
    def _print_content_summary(self):
        """Print a summary of the GPX content"""
        print("\n📊 Content Summary:")
        print(f"   • Waypoints: {self.metadata['waypoint_count']}")
        print(f"   • Tracks: {self.metadata['track_count']}")
        print(f"   • Routes: {self.metadata['route_count']}")
        
        if self.metadata.get('section_markers'):
            print(f"   • Sections: {', '.join(self.metadata['section_markers'])}")
        
        if self.metadata.get('latest_modification'):
            print(f"   • Latest update: {self.metadata['latest_modification']}")
        
        if self.metadata.get('creator'):
            print(f"   • Creator: {self.metadata['creator']}")
        
        print(f"   • Content hash: {self.metadata.get('content_hash', 'N/A')}")
    
    def check_existing_version(self):
        """Check if a similar version already exists in output directory"""
        if not self.output_dir.exists():
            return False, None
        
        suggested_base = self.metadata.get('suggested_name', self.gpx_file_path.stem)
        content_hash = self.metadata.get('content_hash')
        
        # Look for files with similar names or same content hash
        existing_files = []
        for existing_file in self.output_dir.glob('**/*_extraction_summary.txt'):
            summary_path = existing_file
            
            # Read existing summary to check for content hash
            try:
                summary_content = summary_path.read_text()
                if content_hash and content_hash in summary_content:
                    existing_files.append(summary_path.parent.name)
            except Exception:
                continue
        
        if existing_files:
            print(f"\n⚠️  Found potentially similar versions:")
            for existing in existing_files:
                print(f"   • {existing}")
            return True, existing_files
        
        return False, None
    
    def get_gpx_header(self, content_type="extracted"):
        """Create a new GPX header with metadata"""
        # Start with the original root attributes
        root_attribs = self.root.attrib.copy()
        
        # Build header
        header = '<?xml version="1.0" encoding="utf-8"?>'
        
        # Build GPX opening tag with all original attributes
        gpx_tag = '<gpx'
        for key, value in root_attribs.items():
            gpx_tag += f' {key}="{value}"'
        gpx_tag += '>'
        
        header += gpx_tag + '\n'
        
        # Add metadata
        header += '  <metadata>\n'
        
        # Try to preserve original metadata
        if self.namespace.get('default'):
            metadata_elem = self.root.find('.//{%s}metadata' % self.namespace['default'])
        else:
            metadata_elem = self.root.find('.//metadata')
        if metadata_elem is not None:
            # Copy existing metadata but update some fields
            for child in metadata_elem:
                if child.tag == 'time':
                    # Update time to current time
                    current_time = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                    header += f'    <time>{current_time}</time>\n'
                elif child.tag.endswith('bounds'):
                    # Skip bounds, will be recalculated if needed
                    continue
                else:
                    # Copy other metadata as-is
                    header += f'    {ET.tostring(child, encoding="unicode")}\n'
        else:
            # Create basic metadata if none exists
            current_time = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
            header += f'    <time>{current_time}</time>\n'
            header += f'    <desc>Extracted {content_type} from {self.gpx_file_path.name}</desc>\n'
        
        header += '  </metadata>\n\n'
        
        return header
    
    def extract_waypoints_enhanced(self, base_name):
        """Extract all waypoints with enhanced naming"""
        # Handle namespaced elements
        if self.namespace.get('default'):
            waypoints = self.root.findall('.//{%s}wpt' % self.namespace['default'])
        else:
            waypoints = self.root.findall('.//wpt')
        
        if not waypoints:
            print("ℹ No waypoints found")
            return None
            
        output_file = self.output_dir / f"{base_name}_waypoints.gpx"
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(self.get_gpx_header("waypoints"))
            
            for wpt in waypoints:
                f.write('  ')
                f.write(ET.tostring(wpt, encoding='unicode'))
                f.write('\n')
            
            f.write('\n</gpx>')
        
        print(f"✓ Extracted {len(waypoints)} waypoints to: {output_file.name}")
        return output_file
    
    def extract_tracks_enhanced(self, base_name):
        """Extract each track with enhanced naming and analysis"""
        # Handle namespaced elements
        if self.namespace.get('default'):
            tracks = self.root.findall('.//{%s}trk' % self.namespace['default'])
        else:
            tracks = self.root.findall('.//trk')
        
        if not tracks:
            print("ℹ No tracks found")
            return []
        
        output_files = []
        
        for i, trk in enumerate(tracks, 1):
            # Get track name if available
            if self.namespace.get('default'):
                name_elem = trk.find('.//{%s}name' % self.namespace['default'])
            else:
                name_elem = trk.find('.//name')
            
            track_name = name_elem.text if name_elem is not None else f"track_{i:02d}"
            
            # Sanitize filename - use track name directly as output filename
            safe_name = "".join(c for c in track_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
            safe_name = safe_name.replace(' ', '_')
            
            output_file = self.output_dir / f"{safe_name}.gpx"
            
            # Count track points and analyze time span
            if self.namespace.get('default'):
                trkpts = trk.findall('.//{%s}trkpt' % self.namespace['default'])
            else:
                trkpts = trk.findall('.//trkpt')
            
            # Extract time information from track points
            times = []
            for trkpt in trkpts[:10]:  # Sample first 10 points
                time_elem = trkpt.find('.//time')
                if time_elem is not None:
                    times.append(time_elem.text)
            
            time_info = f" (recorded: {times[0][:10]})" if times else ""
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(self.get_gpx_header("track"))
                f.write('  ')
                f.write(ET.tostring(trk, encoding='unicode'))
                f.write('\n\n</gpx>')
            
            print(f"✓ Extracted track {i}: '{track_name}' ({len(trkpts)} points{time_info}) to: {output_file.name}")
            output_files.append(output_file)
        
        return output_files
    
    def extract_routes_enhanced(self, base_name):
        """Extract each route with enhanced naming and analysis"""
        # Handle namespaced elements
        if self.namespace.get('default'):
            routes = self.root.findall('.//{%s}rte' % self.namespace['default'])
        else:
            routes = self.root.findall('.//rte')
        
        if not routes:
            print("ℹ No routes found")
            return []
        
        output_files = []
        
        for i, rte in enumerate(routes, 1):
            # Get route name if available
            if self.namespace.get('default'):
                name_elem = rte.find('.//{%s}name' % self.namespace['default'])
            else:
                name_elem = rte.find('.//name')
            
            route_name = name_elem.text if name_elem is not None else f"route_{i:02d}"
            
            # Sanitize filename - use route name directly as output filename
            safe_name = "".join(c for c in route_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
            safe_name = safe_name.replace(' ', '_')
            
            output_file = self.output_dir / f"{safe_name}.gpx"
            
            # Count route points
            if self.namespace.get('default'):
                rtepts = rte.findall('.//{%s}rtept' % self.namespace['default'])
            else:
                rtepts = rte.findall('.//rtept')
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(self.get_gpx_header("route"))
                f.write('  ')
                f.write(ET.tostring(rte, encoding='unicode'))
                f.write('\n\n</gpx>')
            
            print(f"✓ Extracted route {i}: '{route_name}' ({len(rtepts)} points) to: {output_file.name}")
            output_files.append(output_file)
        
        return output_files
    
    def create_summary(self, waypoint_file, track_files, route_files):
        """Create an enhanced summary with metadata information"""
        suggested_name = self.metadata.get('suggested_name', self.gpx_file_path.stem)
        summary_file = self.output_dir / f"{suggested_name}_extraction_summary.txt"
        
        with open(summary_file, 'w') as f:
            f.write(f"GPX Extraction Summary\n")
            f.write(f"{"="*50}\n")
            f.write(f"Source file: {self.gpx_file_path}\n")
            f.write(f"Extraction date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Enhanced metadata section
            f.write(f"📊 Content Analysis\n")
            f.write(f"{'-'*50}\n")
            if self.metadata.get('trail_type'):
                f.write(f"Trail type: {self.metadata['trail_type']}\n")
            if self.metadata.get('section_markers'):
                f.write(f"Sections: {', '.join(self.metadata['section_markers'])}\n")
            if self.metadata.get('latest_modification'):
                f.write(f"Latest update: {self.metadata['latest_modification']}\n")
            if self.metadata.get('creator'):
                f.write(f"Creator: {self.metadata['creator']}\n")
            f.write(f"Content hash: {self.metadata.get('content_hash', 'N/A')}\n")
            f.write(f"Suggested name: {self.metadata.get('suggested_name', 'N/A')}\n")
            
            f.write(f"\n📋 Component Counts\n")
            f.write(f"{'-'*50}\n")
            f.write(f"Waypoints: {self.metadata['waypoint_count']}\n")
            f.write(f"Tracks: {self.metadata['track_count']}\n")
            f.write(f"Routes: {self.metadata['route_count']}\n")
            
            f.write(f"\n📁 Extracted Files\n")
            f.write(f"{'-'*50}\n")
            if waypoint_file:
                f.write(f"Waypoints file: {waypoint_file.name}\n")
            else:
                f.write("Waypoints: None found\n")
            
            f.write(f"\nTracks extracted: {len(track_files)}\n")
            for track_file in track_files:
                f.write(f"  - {track_file.name}\n")
            
            f.write(f"\nRoutes extracted: {len(route_files)}\n")
            for route_file in route_files:
                f.write(f"  - {route_file.name}\n")
                
            f.write(f"\n🔧 Technical Details\n")
            f.write(f"{'-'*50}\n")
            f.write(f"Namespace: {self.namespace.get('default', 'None')}\n")
            f.write(f"GPX version: {self.metadata.get('version', 'Unknown')}\n")
            if self.metadata.get('build_date'):
                f.write(f"Build date: {self.metadata['build_date']}\n")
        
        print(f"✓ Created enhanced extraction summary: {summary_file}")
        return summary_file
    
    def extract_all(self):
        """Extract all components with enhanced naming and version detection"""
        if not self.load_gpx():
            return False
        
        # Check for existing versions
        has_similar, similar_files = self.check_existing_version()
        if has_similar:
            response = input(f"\n🤔 Continue with extraction? [y/N]: ")
            if response.lower() != 'y':
                print("❌ Extraction cancelled by user")
                return False
        
        # Create output directory with suggested name
        suggested_name = self.metadata.get('suggested_name', self.gpx_file_path.stem)
        self.output_dir = self.output_dir / f"{suggested_name}_extracted"
        self.output_dir.mkdir(parents=True, exist_ok=True, mode=0o775)
        
        print(f"\nExtracting components from {self.gpx_file_path.name}...")
        print(f"Output directory: {self.output_dir}")
        print(f"Using name: {suggested_name}")
        print("-" * 60)
        
        # Extract each component using the suggested name as base
        waypoint_file = self.extract_waypoints_enhanced(suggested_name)
        track_files = self.extract_tracks_enhanced(suggested_name)
        route_files = self.extract_routes_enhanced(suggested_name)
        
        # Create enhanced summary
        summary_file = self.create_summary(waypoint_file, track_files, route_files)
        
        print("-" * 60)
        print(f"✅ Extraction complete! Created {1 + len(track_files) + len(route_files)} files.")
        print(f"📁 Output directory: {self.output_dir}")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="Extract waypoints, tracks, and routes from a GPX file into separate files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python gpx_extractor.py my_route.gpx
  python gpx_extractor.py my_route.gpx ./extracted_parts/
  python gpx_extractor.py S.gpx
        """
    )
    parser.add_argument('gpx_file', help='Input GPX file to extract from')
    parser.add_argument('output_dir', nargs='?', help='Output directory (default: same as input file)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Validate input file
    gpx_file = Path(args.gpx_file)
    if not gpx_file.exists():
        print(f"✗ Error: GPX file '{gpx_file}' not found")
        sys.exit(1)
    
    if not gpx_file.suffix.lower() == '.gpx':
        print(f"✗ Error: File '{gpx_file}' is not a GPX file")
        sys.exit(1)
    
    # Set output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = gpx_file.parent / f"{gpx_file.stem}_extracted"
    
    # Extract components
    extractor = GPXExtractor(gpx_file, output_dir)
    success = extractor.extract_all()
    
    if success:
        print("\n🎉 All done! Check the output directory for extracted files.")
        sys.exit(0)
    else:
        print("\n❌ Extraction failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()