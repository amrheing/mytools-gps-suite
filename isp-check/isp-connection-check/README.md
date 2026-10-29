# ISP Connection Check

A lightweight, dependency-free Python tool that monitors your internet connection via ping, detects outages, identifies your current ISP/uplink, and adapts its sensitivity automatically — built for multi-WAN setups (e.g. Starlink + cellular failover) where different uplinks have very different normal behavior.

## Why

Satellite links like Starlink have routine multi-second packet loss during satellite handoffs, which looks like an "outage" to a naive ping monitor. Cellular/terrestrial links behave differently again. This tool auto-detects which uplink is currently active and applies matching thresholds, instead of one-size-fits-all settings.

## Features

- **Ping monitoring** for any number of named targets (DNS, web, gateway, ...), with combined outage counting (simultaneous target failures count as one outage, not several).
- **Auto-detected default gateway** (via `route`/`ip route`), overridable per target in config.
- **ISP/provider detection** via public IP + ASN lookup, with **connection profiles** (e.g. `starlink`, `cellular`, `default`) that auto-select `interval` / `ping_timeout` / `failure_threshold` based on the detected provider. Explicit top-level config values always override the profile.
- **Multi-WAN failover detection**: periodically re-checks the active provider (not just after ping outages, since failover can be seamless) and logs when it changes, switching profiles live.
- **Public IP / NAT classification** for IPv4 and IPv6 (directly routable, NAT'd, or CGNAT).
- **DNS resolution chain check**: compares your system's actual DNS resolver(s) against the configured `dns` test target, to tell whether hostname-target failures are DNS-related or independent.
- **Simple speed test** (single-connection download/upload estimate via Cloudflare's speed endpoint), run at startup, on connection change, and/or on a fixed schedule — with a running per-provider average persisted across restarts.
- **Data usage estimate** printed at startup, based on your configured intervals.
- **Auto-created default config** on first run, with log/CSV rotation (`logfiles_to_keep`).

## Requirements

- Python 3.10+
- `ping` and `route` (macOS) or `ip` (Linux) available on `PATH`
- Internet access for ISP/speed-test/IP lookups (optional — the tool degrades gracefully offline)

No third-party packages required.

## Usage

### GUI

```bash
python3 pingmon_gui.py [path/to/config.json]
```

- **Monitor** tab: Start/Stop, overall status (online / degraded / outage), connection & settings in use, per-target status/outages/downtime, and the full terminal output.
- **Settings** tab: edit all options below (targets, connection profiles, overrides, speed test, logging) and save them to the config file - no JSON editing needed. Restart monitoring to apply changes.

The GUI needs Tkinter with Tk 8.6+. On macOS don't use Apple's `/usr/bin/python3` (Tk 8.5 shows an empty black window) - use the python.org installer or `brew install python python-tk`. Linux: `sudo apt install python3-tk` (Debian/Ubuntu), `sudo dnf install python3-tkinter` (Fedora).

### Command line

```bash
python3 pingmon.py [path/to/config.json]
```

If no config file exists at the given (or default `pingmon.json`) path, one is created automatically with sensible defaults.

Stop with `Ctrl+C` — a summary of outages/downtime per target is printed on exit.

## Configuration

All options live in `pingmon.json` (auto-created if missing):

| Key | Default | Description |
|---|---|---|
| `targets` | `{"dns": "1.1.1.1", "web": "google.com", "gateway": ""}` | Named ping targets. Empty `"gateway"` value = auto-detect the system's default gateway. |
| `connection_profiles` | `starlink` / `cellular` / `default` | Each profile has a `match` keyword list (matched against the detected ISP name) and its own `interval` / `ping_timeout` / `failure_threshold`. |
| `interval` | *(from profile)* | Seconds between ping checks. Set explicitly to override profile auto-selection. |
| `ping_timeout` | *(from profile)* | Seconds to wait for a ping reply. |
| `failure_threshold` | *(from profile)* | Consecutive failed checks before a target is logged as down (filters out transient blips). |
| `verbose_downtime` | `true` | Log every failed ping (incl. ones still within `failure_threshold`) and a `WARN` line on every check while a target stays down. |
| `isp_check_interval` | `15` | Seconds between background checks for a provider/failover change. |
| `speed_test_on_connection_change` | `true` | Run a speed test immediately after a detected provider change. |
| `speed_test_interval_minutes` | `60` | Run a speed test on a fixed schedule (`0` disables). |
| `log_dir` | `logs` | Directory for log/CSV output. |
| `log_prefix` | `ping_monitor` | Filename prefix for log/CSV files. |
| `logfiles_to_keep` | `10` | Max log/CSV file pairs retained; oldest are pruned on startup. |

Per-provider speed test history is persisted separately in `pingmon_speed_stats.json` (git-ignored).

## Output

On startup, the tool prints a parameter legend, general/target/connection settings, and an estimated data-volume summary, then streams timestamped `INFO` / `WARN` / `ERROR` events to both the console and a log file, plus a CSV of completed outages.

## License

[MIT](LICENSE)
