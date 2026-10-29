# ISP Connection Check

Download and instructions page for the desktop connection monitor in [`isp-connection-check/`](isp-connection-check/) (`pingmon.py` + `pingmon_gui.py`).

The monitor has to run locally so it keeps working (and logging) while the internet connection is down - a web page can't do that.

## Container contents

- `index.html` - download page with installation instructions
- `download/isp-connection-check.pyz` - built by the Dockerfile from `__main__.py`, `pingmon.py` and `pingmon_gui.py` (Python zipapp)
- `download/isp-connection-check.pyz.sha256` - its checksum, shown on the download page

The container is only reachable on `172.22.1.1:6060` (mailcow bridge); the public route is
`https://www.amrhein.info/isp-check/` via the mailcow nginx, embedded in `https://www.amrhein.info/tools/isp-connection-check/`.

Rebuild after changing the app: `docker compose up -d --build isp-check`
