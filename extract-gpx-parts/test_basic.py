"""Tests for the GPX extractor and the web app's file handling.

Run from extract-gpx-parts/: pip install -r web/requirements.txt pytest && pytest
"""
import importlib
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / 'web'))

from gpx_extractor import GPXExtractor  # noqa: E402

SAMPLE_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
  <metadata><time>2026-01-02T09:14:53Z</time></metadata>
  <wpt lat="47.1" lon="8.1"><name>Hütte &amp; Tal</name></wpt>
  <trk><name>Berg &amp; Tal</name><trkseg>
    <trkpt lat="47.1" lon="8.1"><ele>512.3</ele></trkpt>
    <trkpt lat="47.2" lon="8.2"/>
  </trkseg></trk>
  <trk><name>Berg &amp; Tal</name><trkseg><trkpt lat="47.3" lon="8.3"/></trkseg></trk>
  <trk><name></name><trkseg><trkpt lat="47.4" lon="8.4"/></trkseg></trk>
</gpx>
"""


def test_extraction_writes_valid_unique_files(tmp_path):
    gpx = tmp_path / 'sample.gpx'
    gpx.write_text(SAMPLE_GPX, encoding='utf-8')
    out_dir = tmp_path / 'out'
    out_dir.mkdir()
    extractor = GPXExtractor(gpx, out_dir)
    assert extractor.load_gpx()
    wpt = extractor.extract_waypoints_enhanced('sample')
    tracks = extractor.extract_tracks_enhanced('sample')

    assert sorted(t.name for t in tracks) == ['Berg__Tal.gpx', 'Berg__Tal_2.gpx', 'track_03.gpx']

    # Every output must be well-formed XML, even with '&' in names
    for path in [wpt, *tracks]:
        ET.parse(path)

    first = (out_dir / 'Berg__Tal.gpx').read_text(encoding='utf-8')
    assert '<name>Berg &amp; Tal</name>' in first
    assert '<ele>512.3</ele>' in first


def test_entity_expansion_is_rejected(tmp_path):
    bomb = tmp_path / 'bomb.gpx'
    bomb.write_text("""<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
<gpx><metadata><name>&b;</name></metadata></gpx>""")
    assert not GPXExtractor(bomb, tmp_path).load_gpx()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('DELETE_TOKEN', 'test-token')
    import app as app_module
    app_module = importlib.reload(app_module)
    for name in ('UPLOAD_FOLDER', 'PROCESSED_FOLDER', 'METADATA_FOLDER'):
        folder = tmp_path / name.lower()
        folder.mkdir()
        monkeypatch.setattr(app_module, name, folder)
    (tmp_path / 'secret.txt').write_text('top secret')
    out = app_module.PROCESSED_FOLDER / '20260101_000000_x_extracted'
    out.mkdir()
    (out / 'a.gpx').write_text('<gpx/>')
    app_module.app.config['TESTING'] = True
    with app_module.app.test_client() as c:
        c.module = app_module
        c.out_dir = out
        yield c


def test_download_selected_blocks_traversal(client):
    resp = client.post('/download-selected', json={'directory': '.', 'files': ['../secret.txt']})
    assert resp.status_code == 404
    resp = client.post('/download-selected', json={'directory': client.out_dir.name,
                                                   'files': ['../../secret.txt', 'a.gpx']})
    assert resp.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(resp.data)).namelist() == ['a.gpx']


def test_download_routes_block_traversal(client):
    assert client.get(f'/download/{client.out_dir.name}/a.gpx').status_code == 200
    assert client.get('/download/../secret.txt').status_code in (302, 404)
    assert client.get('/download/%2E%2E/secret.txt').status_code in (302, 404)
    assert client.get('/api/file-info/..').status_code == 404
    assert client.get('/download-all/..').status_code in (302, 404)


def test_metadata_ids_are_validated(client):
    (client.module.METADATA_FOLDER.parent / 'evil.json').write_text('{}')
    resp = client.post('/update-description', json={'unique_id': '../evil', 'description': 'x'})
    assert resp.status_code == 404
    assert (client.module.METADATA_FOLDER.parent / 'evil.json').read_text() == '{}'


def test_delete_requires_configured_token(client):
    m = client.module
    m.save_file_metadata('S_20260102', {}, 'S.gpx', m.UPLOAD_FOLDER / 'S.gpx')
    assert client.post('/delete-file', json={'unique_id': 'S_20260102', 'token': 'wrong'}).status_code == 403
    assert client.post('/delete-file', json={'unique_id': 'S_20260102', 'token': 'test-token'}).status_code == 200


def test_cleanup_keeps_archive(client):
    m = client.module
    upload = m.UPLOAD_FOLDER / '20260101_S.gpx'
    upload.write_text('<gpx/>')
    info = m.save_file_metadata('S_20260101', {}, 'S.gpx', upload)
    info['output_directory'] = client.out_dir.name
    meta_file = m.METADATA_FOLDER / 'S_20260101.json'
    meta_file.write_text(json.dumps(info))
    orphan = m.PROCESSED_FOLDER / 'old_orphan_extracted'
    orphan.mkdir()
    temp = m.UPLOAD_FOLDER / 'temp_abandoned.gpx'
    temp.write_text('x')
    old = time.time() - 3 * 24 * 3600
    for p in (upload, client.out_dir, orphan, temp, meta_file):
        os.utime(p, (old, old))

    m.cleanup_old_files()

    assert upload.exists() and client.out_dir.exists() and meta_file.exists()
    assert not orphan.exists() and not temp.exists()


def test_health(client):
    assert client.get('/health').get_json() == {'status': 'ok'}
