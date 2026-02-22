#!/usr/bin/env python3
"""
GPX Parts Extractor

This tool extracts different parts of a GPX file (waypoints, tracks, routes) 
into separate GPX files for easier management and analysis.

Usage:
    python gpx_extractor.py input.gpx [output_directory]
"""

import sys
import os
import argparse
from xml.etree import ElementTree as ET
from pathlib import Path
from datetime import datetime


class GPXExtractor:
    def __init__(self, gpx_file_path, output_dir=None):
        self.gpx_file_path = Path(gpx_file_path)
        self.output_dir = Path(output_dir) if output_dir else self.gpx_file_path.parent
        self.tree = None
        self.root = None
        self.namespace = {}
        
    def load_gpx(self):
        """Load and parse the GPX file"""
        try:
            self.tree = ET.parse(self.gpx_file_path)
            self.root = self.tree.getroot()
            
            # Extract namespace information
            if self.root.tag.startswith('{'):
                self.namespace[''] = self.root.tag.split('}')[0][1:]
                self.namespace['default'] = self.namespace['']
            
            print(f"✓ Loaded GPX file: {self.gpx_file_path}")
            print(f"✓ Root namespace: {self.namespace.get('default', 'None')}")
            return True
        except Exception as e:
            print(f"✗ Error loading GPX file: {e}")
            return False
    
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
    
    def extract_waypoints(self):
        """Extract all waypoints to a separate file"""
        # Handle namespaced elements
        if self.namespace.get('default'):
            waypoints = self.root.findall('.//{%s}wpt' % self.namespace['default'])
        else:
            waypoints = self.root.findall('.//wpt')
        
        if not waypoints:
            print("ℹ No waypoints found")
            return None
            
        output_file = self.output_dir / f"{self.gpx_file_path.stem}_waypoints.gpx"
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(self.get_gpx_header("waypoints"))
            
            for wpt in waypoints:
                f.write('  ')
                f.write(ET.tostring(wpt, encoding='unicode'))
                f.write('\n')
            
            f.write('\n</gpx>')
        
        print(f"✓ Extracted {len(waypoints)} waypoints to: {output_file}")
        return output_file
    
    def extract_tracks(self):
        """Extract each track to a separate file"""
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
            
            # Sanitize filename
            safe_name = "".join(c for c in track_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
            safe_name = safe_name.replace(' ', '_')
            
            output_file = self.output_dir / f"{self.gpx_file_path.stem}_track_{i:02d}_{safe_name}.gpx"
            
            # Count track points
            if self.namespace.get('default'):
                trkpts = trk.findall('.//{%s}trkpt' % self.namespace['default'])
            else:
                trkpts = trk.findall('.//trkpt')
            
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(self.get_gpx_header("track"))
                f.write('  ')
                f.write(ET.tostring(trk, encoding='unicode'))
                f.write('\n\n</gpx>')
            
            print(f"✓ Extracted track {i}: '{track_name}' ({len(trkpts)} points) to: {output_file}")
            output_files.append(output_file)
        
        return output_files
    
    def extract_routes(self):
        """Extract each route to a separate file"""
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
            
            # Sanitize filename
            safe_name = "".join(c for c in route_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
            safe_name = safe_name.replace(' ', '_')
            
            output_file = self.output_dir / f"{self.gpx_file_path.stem}_route_{i:02d}_{safe_name}.gpx"
            
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
            
            print(f"✓ Extracted route {i}: '{route_name}' ({len(rtepts)} points) to: {output_file}")
            output_files.append(output_file)
        
        return output_files
    
    def create_summary(self, waypoint_file, track_files, route_files):
        """Create a summary of what was extracted"""
        summary_file = self.output_dir / f"{self.gpx_file_path.stem}_extraction_summary.txt"
        
        with open(summary_file, 'w') as f:
            f.write(f"GPX Extraction Summary\n")
            f.write(f"{"="*50}\n")
            f.write(f"Source file: {self.gpx_file_path}\n")
            f.write(f"Extraction date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
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
        
        print(f"✓ Created extraction summary: {summary_file}")
        return summary_file
    
    def extract_all(self):
        """Extract all components from the GPX file"""
        if not self.load_gpx():
            return False
        
        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"\nExtracting components from {self.gpx_file_path.name}...")
        print(f"Output directory: {self.output_dir}")
        print("-" * 60)
        
        # Extract each component
        waypoint_file = self.extract_waypoints()
        track_files = self.extract_tracks()
        route_files = self.extract_routes()
        
        # Create summary
        summary_file = self.create_summary(waypoint_file, track_files, route_files)
        
        print("-" * 60)
        print(f"✓ Extraction complete! Created {1 + len(track_files) + len(route_files)} files.")
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