#!/usr/bin/env python3
"""
POI Pattern Extractor

Core functionality for extracting and filtering POIs (waypoints) from GPX files
based on pattern matching (wildcards, regex).
"""

import re
import fnmatch
from pathlib import Path
from xml.etree import ElementTree as ET
from datetime import datetime
from typing import List, Dict, Optional


class POIExtractor:
    """Extracts and filters POIs from GPX files based on patterns."""
    
    def __init__(self, gpx_file_path: str):
        """Initialize with a GPX file path."""
        self.gpx_file_path = Path(gpx_file_path)
        self.tree = None
        self.root = None
        self.namespace = {}
        
        # Load and parse the GPX file
        self._parse_gpx()
    
    def _parse_gpx(self):
        """Parse the GPX file and set up namespace handling."""
        try:
            self.tree = ET.parse(self.gpx_file_path)
            self.root = self.tree.getroot()
            
            # Extract namespace from the root element
            if self.root.tag.startswith('{'):
                # Extract the namespace URI
                namespace_uri = self.root.tag[1:self.root.tag.find('}')]
                self.namespace = {'gpx': namespace_uri}
            else:
                # No namespace
                self.namespace = {}
                
        except ET.ParseError as e:
            raise ValueError(f"Invalid GPX file format: {e}")
        except FileNotFoundError:
            raise FileNotFoundError(f"GPX file not found: {self.gpx_file_path}")
    
    def extract_waypoints(self) -> List[Dict]:
        """Extract all waypoints (POIs) from the GPX file."""
        waypoints = []
        
        # Find all waypoint elements
        if self.namespace:
            wpt_elements = self.root.findall('.//gpx:wpt', self.namespace)
        else:
            wpt_elements = self.root.findall('.//wpt')
        
        for wpt in wpt_elements:
            waypoint_data = self._extract_waypoint_data(wpt)
            if waypoint_data:
                waypoints.append(waypoint_data)
        
        return waypoints
    
    def _extract_waypoint_data(self, wpt_element) -> Optional[Dict]:
        """Extract data from a single waypoint element."""
        try:
            # Get coordinates
            lat = float(wpt_element.get('lat'))
            lon = float(wpt_element.get('lon'))
            
            # Get name (required for filtering)
            if self.namespace:
                name_elem = wpt_element.find('gpx:name', self.namespace)
            else:
                name_elem = wpt_element.find('name')
            
            if name_elem is None or not name_elem.text:
                return None  # Skip waypoints without names
            
            name = name_elem.text.strip()
            
            # Get optional fields
            waypoint_data = {
                'lat': lat,
                'lon': lon,
                'name': name,
                'element': wpt_element  # Keep reference to original element
            }
            
            # Extract elevation
            if self.namespace:
                ele_elem = wpt_element.find('gpx:ele', self.namespace)
            else:
                ele_elem = wpt_element.find('ele')
            
            if ele_elem is not None and ele_elem.text:
                try:
                    waypoint_data['ele'] = float(ele_elem.text)
                except ValueError:
                    pass
            
            # Extract time
            if self.namespace:
                time_elem = wpt_element.find('gpx:time', self.namespace)
            else:
                time_elem = wpt_element.find('time')
            
            if time_elem is not None and time_elem.text:
                waypoint_data['time'] = time_elem.text
            
            # Extract description
            if self.namespace:
                desc_elem = wpt_element.find('gpx:desc', self.namespace)
            else:
                desc_elem = wpt_element.find('desc')
            
            if desc_elem is not None and desc_elem.text:
                waypoint_data['desc'] = desc_elem.text
            
            # Extract comment
            if self.namespace:
                cmt_elem = wpt_element.find('gpx:cmt', self.namespace)
            else:
                cmt_elem = wpt_element.find('cmt')
            
            if cmt_elem is not None and cmt_elem.text:
                waypoint_data['cmt'] = cmt_elem.text
            
            # Extract symbol
            if self.namespace:
                sym_elem = wpt_element.find('gpx:sym', self.namespace)
            else:
                sym_elem = wpt_element.find('sym')
            
            if sym_elem is not None and sym_elem.text:
                waypoint_data['sym'] = sym_elem.text
            
            # Extract type
            if self.namespace:
                type_elem = wpt_element.find('gpx:type', self.namespace)
            else:
                type_elem = wpt_element.find('type')
            
            if type_elem is not None and type_elem.text:
                waypoint_data['type'] = type_elem.text
            
            return waypoint_data
            
        except (ValueError, AttributeError) as e:
            print(f"Warning: Error processing waypoint: {e}")
            return None
    
    def filter_by_wildcard_pattern(self, waypoints: List[Dict], pattern: str) -> List[Dict]:
        """Filter waypoints using wildcard pattern matching.
        
        Supports:
        - * for multiple characters
        - ? for single character
        - Case-insensitive matching
        
        Examples:
        - "*-S28" matches "Something-S28", "! Abandoned building -S28"
        - "*-?28" matches "Something-S28", "Something-A28"
        - "Bridge*" matches "Bridge", "Bridge crossing"
        """
        if not pattern:
            return waypoints
        
        # Make pattern case-insensitive
        pattern_lower = pattern.lower()
        
        filtered = []
        for waypoint in waypoints:
            name_lower = waypoint['name'].lower()
            if fnmatch.fnmatch(name_lower, pattern_lower):
                filtered.append(waypoint)
        
        return filtered
    
    def filter_by_regex_pattern(self, waypoints: List[Dict], regex_pattern: str) -> List[Dict]:
        """Filter waypoints using regular expression pattern.
        
        Examples:
        - r".*-S\\d+$" matches names ending with -S followed by digits
        - r"^! .+-S\\d+$" matches names starting with "! " and ending with -S + digits
        - r"Bridge|Tunnel" matches names containing "Bridge" OR "Tunnel"
        """
        if not regex_pattern:
            return waypoints
        
        try:
            # Compile regex pattern (case-insensitive by default)
            compiled_pattern = re.compile(regex_pattern, re.IGNORECASE)
        except re.error as e:
            raise ValueError(f"Invalid regex pattern: {e}")
        
        filtered = []
        for waypoint in waypoints:
            if compiled_pattern.search(waypoint['name']):
                filtered.append(waypoint)
        
        return filtered
    
    def create_filtered_gpx(self, filtered_waypoints: List[Dict], output_file: str):
        """Create a new GPX file containing only the filtered waypoints."""
        if not filtered_waypoints:
            # Create empty GPX if no matches
            self._create_empty_gpx(output_file)
            return
        
        # Create new GPX root element with same attributes as original
        if self.namespace:
            # Preserve original namespace
            new_root = ET.Element(self.root.tag, self.root.attrib)
            
            # Copy namespace declarations
            for prefix, uri in self.namespace.items():
                if prefix == 'gpx':
                    new_root.set('xmlns', uri)
            
            # Copy other namespace attributes from original root
            for key, value in self.root.attrib.items():
                if key.startswith('xmlns'):
                    new_root.set(key, value)
                    
        else:
            new_root = ET.Element('gpx', self.root.attrib)
        
        # Copy metadata if present
        if self.namespace:
            metadata = self.root.find('gpx:metadata', self.namespace)
        else:
            metadata = self.root.find('metadata')
        
        if metadata is not None:
            new_root.append(metadata)
        
        # Add filtered waypoints
        for waypoint in filtered_waypoints:
            # Clone the original element to preserve all formatting and extensions
            wpt_copy = self._deep_copy_element(waypoint['element'])
            new_root.append(wpt_copy)
        
        # Create tree and write to file
        new_tree = ET.ElementTree(new_root)
        ET.indent(new_tree, space="  ")  # Pretty formatting
        
        new_tree.write(
            output_file,
            encoding='utf-8',
            xml_declaration=True
        )
    
    def _deep_copy_element(self, element):
        """Create a deep copy of an XML element."""
        # Create new element with same tag and attributes
        new_element = ET.Element(element.tag, element.attrib)
        
        # Copy text content
        new_element.text = element.text
        new_element.tail = element.tail
        
        # Recursively copy all children
        for child in element:
            new_element.append(self._deep_copy_element(child))
        
        return new_element
    
    def _create_empty_gpx(self, output_file: str):
        """Create an empty GPX file when no waypoints match."""
        if self.namespace:
            root = ET.Element('gpx', {
                'version': '1.1',
                'creator': 'POI Pattern Extractor',
                'xmlns': self.namespace['gpx']
            })
        else:
            root = ET.Element('gpx', {
                'version': '1.1',
                'creator': 'POI Pattern Extractor'
            })
        
        # Add metadata
        metadata = ET.SubElement(root, 'metadata')
        ET.SubElement(metadata, 'name').text = 'Filtered POIs - No matches found'
        ET.SubElement(metadata, 'desc').text = 'No waypoints matched the specified pattern'
        ET.SubElement(metadata, 'time').text = datetime.now().isoformat() + 'Z'
        
        tree = ET.ElementTree(root)
        ET.indent(tree, space="  ")
        
        tree.write(
            output_file,
            encoding='utf-8',
            xml_declaration=True
        )


def analyze_waypoint_patterns(gpx_file: str) -> Dict:
    """Analyze waypoint name patterns in a GPX file to help users build patterns.
    
    Returns:
        Dict with pattern analysis including common suffixes, prefixes, etc.
    """
    extractor = POIExtractor(gpx_file)
    waypoints = extractor.extract_waypoints()
    
    if not waypoints:
        return {'total_waypoints': 0, 'patterns': []}
    
    names = [wp['name'] for wp in waypoints]
    
    # Analyze patterns
    patterns = {
        'total_waypoints': len(waypoints),
        'sample_names': names[:20],  # First 20 names as examples
        'common_suffixes': _find_common_suffixes(names),
        'common_prefixes': _find_common_prefixes(names),
        'contains_s_numbers': [name for name in names if re.search(r'-S\d+', name)],
    }
    
    # Find numeric patterns
    s_number_pattern = re.compile(r'-S(\d+)')
    s_numbers = []
    for name in names:
        match = s_number_pattern.search(name)
        if match:
            s_numbers.append(int(match.group(1)))
    
    if s_numbers:
        patterns['s_number_range'] = {
            'min': min(s_numbers),
            'max': max(s_numbers),
            'count': len(s_numbers),
            'unique_numbers': sorted(set(s_numbers))
        }
    
    return patterns


def _find_common_suffixes(names: List[str], min_length: int = 3) -> List[str]:
    """Find common suffixes in waypoint names."""
    suffix_counts = {}
    
    for name in names:
        for i in range(min_length, min(len(name), 20)):
            suffix = name[-i:]
            if suffix not in suffix_counts:
                suffix_counts[suffix] = 0
            suffix_counts[suffix] += 1
    
    # Return suffixes that appear in at least 2 names
    common_suffixes = [suffix for suffix, count in suffix_counts.items() if count >= 2]
    return sorted(common_suffixes, key=lambda x: suffix_counts[x], reverse=True)[:10]


def _find_common_prefixes(names: List[str], min_length: int = 2) -> List[str]:
    """Find common prefixes in waypoint names."""
    prefix_counts = {}
    
    for name in names:
        for i in range(min_length, min(len(name), 20)):
            prefix = name[:i]
            if prefix not in prefix_counts:
                prefix_counts[prefix] = 0
            prefix_counts[prefix] += 1
    
    # Return prefixes that appear in at least 2 names
    common_prefixes = [prefix for prefix, count in prefix_counts.items() if count >= 2]
    return sorted(common_prefixes, key=lambda x: prefix_counts[x], reverse=True)[:10]


if __name__ == '__main__':
    # Example usage
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python poi_extractor.py <gpx_file> <pattern> [output_file]")
        print("Examples:")
        print("  python poi_extractor.py myfile.gpx '*-S28'")
        print("  python poi_extractor.py myfile.gpx '.*-S\\d+$' --regex")
        sys.exit(1)
    
    gpx_file = sys.argv[1]
    pattern = sys.argv[2]
    output_file = sys.argv[3] if len(sys.argv) > 3 else f"filtered_{Path(gpx_file).stem}.gpx"
    use_regex = '--regex' in sys.argv
    
    try:
        extractor = POIExtractor(gpx_file)
        waypoints = extractor.extract_waypoints()
        
        print(f"Found {len(waypoints)} total waypoints in {gpx_file}")
        
        if use_regex:
            filtered = extractor.filter_by_regex_pattern(waypoints, pattern)
            print(f"Filtered with regex '{pattern}': {len(filtered)} matches")
        else:
            filtered = extractor.filter_by_wildcard_pattern(waypoints, pattern)
            print(f"Filtered with wildcard '{pattern}': {len(filtered)} matches")
        
        # Show sample matches
        if filtered:
            print("\nSample matches:")
            for waypoint in filtered[:5]:
                print(f"  - {waypoint['name']}")
            if len(filtered) > 5:
                print(f"  ... and {len(filtered) - 5} more")
        
        # Create filtered GPX
        extractor.create_filtered_gpx(filtered, output_file)
        print(f"\nFiltered GPX saved to: {output_file}")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)