# ISP Connection Check

Download and instructions page for the desktop connection monitor in [`isp-connection-check/`](isp-connection-check/) (`pingmon.py` + `pingmon_gui.py`).

The monitor has to run locally so it keeps working (and logging) while the internet connection is down - a web page can't do that.

## Container contents

- `index.html` - download page with installation instructions
- `download/isp-connection-check.zip` - built by the Dockerfile from `isp-connection-check/` (`pingmon.py`, `pingmon_gui.py`, `README.md`, `LICENSE`)
- `download/pingmon.py`, `download/pingmon_gui.py` - single files

Rebuild after changing the app: `docker compose up -d --build isp-check`
