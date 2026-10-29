#!/usr/bin/env python3
"""Monitor configured targets with ping and print failures."""

from __future__ import annotations

import csv
import datetime as datetime_module
import ipaddress
import json
import platform
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

PROGRAM_NAME = "ISP Connection Check"
PROGRAM_VERSION = "1.1.0"
PROGRAM_LICENSE = "MIT"
PROGRAM_URL = "https://github.com/amrheing/ISP-Connection-Check"


@dataclass
class TargetState:
    name: str
    target: str
    failure_start: float | None = None
    first_failure_at: float | None = None  # wall clock, for log/CSV timestamps
    first_failure_mono: float | None = None  # monotonic, for durations (immune to clock jumps/sleep)
    outages: int = 0
    downtime: int = 0
    consecutive_failures: int = 0


def get_default_gateway() -> str | None:
    try:
        if platform.system() == "Darwin":
            output = subprocess.run(
                ["route", "-n", "get", "default"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
            ).stdout
            match = re.search(r"gateway:\s*(\S+)", output)
        else:
            output = subprocess.run(
                ["ip", "route", "show", "default"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
            ).stdout
            match = re.search(r"default via (\S+)", output)
    except OSError:
        return None
    return match.group(1) if match else None


def get_system_resolvers() -> list[str]:
    # The DNS servers actually used to resolve web/host targets, to tell if they depend on our "dns" test target.
    try:
        if platform.system() == "Darwin":
            output = subprocess.run(
                ["scutil", "--dns"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
            ).stdout
            found = re.findall(r"nameserver\[\d+\]\s*:\s*(\S+)", output)
        else:
            output = Path("/etc/resolv.conf").read_text()
            found = re.findall(r"^\s*nameserver\s+(\S+)", output, re.MULTILINE)
    except OSError:
        return []
    resolvers: list[str] = []
    for resolver in found:
        if resolver not in resolvers:
            resolvers.append(resolver)
    return resolvers


def _is_ip_address(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def get_isp_info(timeout: int = 3, retries: int = 2) -> dict | None:
    # Identifies the current internet provider (ISP/ASN) via the public IP, useful to tell Starlink vs. carrier apart.
    # Retries with a short delay since a just-switched WAN interface may need a moment before routing works.
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(
                "http://ip-api.com/json/?fields=isp,org,as,query", timeout=timeout
            ) as response:
                data = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            if attempt + 1 < retries:
                time.sleep(1)
            continue
        isp = data.get("isp") or data.get("org")
        if isp:
            return {"name": isp, "public_ip": data.get("query"), "asn": data.get("as") or ""}
    return None


CGNAT_NETWORK = ipaddress.ip_network("100.64.0.0/10")  # RFC 6598 shared address space used by carrier-grade NAT


def get_local_ip(family: socket.AddressFamily) -> str | None:
    probe = ("8.8.8.8", 80) if family == socket.AF_INET else ("2001:4860:4860::8888", 80)
    try:
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            sock.connect(probe)
            return sock.getsockname()[0]
    except OSError:
        return None


def get_public_ip(url: str, timeout: int = 3) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            value = response.read().decode().strip()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    return value or None


def classify_ip(public_ip: str | None, local_ip: str | None) -> str:
    if not public_ip:
        return "unavailable"
    try:
        addr = ipaddress.ip_address(public_ip)
    except ValueError:
        return "unknown"
    if addr.version == 4 and addr in CGNAT_NETWORK:
        return "CGNAT (ISP-level shared address, not a usable external IP)"
    if addr.is_private or addr.is_link_local:
        return "private/link-local (not globally routable)"
    if local_ip and local_ip == public_ip:
        return "directly routable (no NAT)"
    return "NAT'd (usable external IP, translated by a router)"


def get_ip_status(family: socket.AddressFamily, url: str) -> dict:
    public_ip = get_public_ip(url)
    local_ip = get_local_ip(family)
    return {"public_ip": public_ip, "status": classify_ip(public_ip, local_ip)}


SPEED_TEST_BYTES = 5_000_000
SPEED_TEST_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pingmon-speedtest/1.0)"}


def run_speed_test(payload_bytes: int = SPEED_TEST_BYTES, timeout: int = 15) -> dict:
    # Single-connection HTTP test against Cloudflare's speed endpoint - a rough estimate, not an Ookla-grade measurement.
    # Cloudflare returns 403 for requests without a browser-like User-Agent, hence the header below.
    result = {"download_mbps": None, "upload_mbps": None}
    try:
        request = urllib.request.Request(
            f"https://speed.cloudflare.com/__down?bytes={payload_bytes}", headers=SPEED_TEST_HEADERS
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            # Start timing once the headers are in, so DNS/TCP/TLS setup doesn't drag the result down
            # (noticeable on high-latency links like Starlink with only 5 MB of payload).
            start = time.monotonic()
            downloaded = len(response.read())
        elapsed = time.monotonic() - start
        if elapsed > 0 and downloaded > 0:
            result["download_mbps"] = round((downloaded * 8 / 1_000_000) / elapsed, 2)
    except (urllib.error.URLError, TimeoutError, OSError):
        pass

    try:
        payload = b"0" * payload_bytes
        request = urllib.request.Request(
            "https://speed.cloudflare.com/__up", data=payload, method="POST", headers=SPEED_TEST_HEADERS
        )
        start = time.monotonic()
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
        elapsed = time.monotonic() - start
        if elapsed > 0:
            result["upload_mbps"] = round((payload_bytes * 8 / 1_000_000) / elapsed, 2)
    except (urllib.error.URLError, TimeoutError, OSError):
        pass
    return result


DEFAULT_CONNECTION_PROFILES = {
    "starlink": {
        "match": ["starlink", "spacex", "space exploration technologies", "as14593"],
        "interval": 2,
        "ping_timeout": 1,
        "failure_threshold": 3,
    },
    # No plain "telekom": Deutsche Telekom's DSL/fibre lines report the same name and would land here.
    "cellular": {
        "match": ["t-mobile", "vodafone", "telefonica", "o2 ", "mobilfunk", "cellular", " lte", "wireless", "mobile"],
        "interval": 2,
        "ping_timeout": 1,
        "failure_threshold": 1,
    },
    "default": {
        "match": [],
        "interval": 2,
        "ping_timeout": 1,
        "failure_threshold": 1,
    },
}


def select_connection_profile(isp_name: str | None, profiles: dict, asn: str | None = None) -> str:
    # Keywords are matched against the ISP name plus the AS string (e.g. "AS14593 Space Exploration ..."),
    # so a profile can also pin an uplink by its AS number.
    if isp_name:
        lower = f"{isp_name} {asn or ''}".lower()
        for name, profile in profiles.items():
            if name != "default" and any(keyword in lower for keyword in profile.get("match", [])):
                return name
    return "default"


DEFAULT_CONFIG = {
    "targets": {
        "dns": "1.1.1.1",
        "web": "google.com",
        "gateway": "",
    },
    "connection_profiles": DEFAULT_CONNECTION_PROFILES,
    "isp_check_interval": 15,
    "speed_test_on_connection_change": True,
    "speed_test_interval_minutes": 60,
    "log_dir": "logs",
    "log_prefix": "ping_monitor",
    "logfiles_to_keep": 10,
    "verbose_downtime": True,
}


def create_default_config(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(DEFAULT_CONFIG, indent=2) + "\n")


def load_config(path: Path) -> tuple[list[TargetState], dict]:
    try:
        config = json.loads(path.read_text())
    except FileNotFoundError as error:
        raise ValueError(f"Config file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error

    if not isinstance(config, dict):
        raise ValueError("The config must be a JSON object")
    targets_config = config.get("targets", {})
    if not isinstance(targets_config, dict):
        raise ValueError("The config must contain a 'targets' object")
    targets_config = dict(targets_config)
    for name, target in targets_config.items():
        if not isinstance(target, str):
            raise ValueError(f"Target '{name}' must be a host name or IP address (string)")
        if target.strip().startswith("-"):
            # Would be passed to ping as an option instead of a host.
            raise ValueError(f"Target '{name}' is not a valid host: {target}")
        targets_config[name] = target.strip()
    if not targets_config.get("gateway"):
        default_gateway = get_default_gateway()
        if default_gateway:
            targets_config["gateway"] = default_gateway
            config["_gateway_source"] = "default (auto-detected)"
        else:
            targets_config.pop("gateway", None)
            config["_gateway_source"] = "unavailable"
    else:
        config["_gateway_source"] = "configured"
    if not targets_config:
        raise ValueError("The config must contain a non-empty 'targets' object")
    targets = [TargetState(name, target) for name, target in targets_config.items()]

    for key in ("interval", "ping_timeout", "failure_threshold"):
        _check_positive_int(config.get(key, 1), key)
    profiles = config.get("connection_profiles") or {}
    if not isinstance(profiles, dict):
        raise ValueError("connection_profiles must be an object")
    for profile_name, profile in profiles.items():
        if not isinstance(profile, dict):
            raise ValueError(f"Connection profile '{profile_name}' must be an object")
        match = profile.get("match", [])
        if not isinstance(match, list) or not all(isinstance(keyword, str) for keyword in match):
            raise ValueError(f"Connection profile '{profile_name}': match must be a list of strings")
        for key in ("interval", "ping_timeout", "failure_threshold"):
            if key in profile:
                _check_positive_int(profile[key], f"{profile_name}.{key}")
    _check_positive_int(config.get("isp_check_interval", 15), "isp_check_interval")
    _check_positive_int(config.get("speed_test_interval_minutes", 60), "speed_test_interval_minutes", minimum=0)
    _check_positive_int(config.get("logfiles_to_keep", 10), "logfiles_to_keep")
    return targets, config


def _check_positive_int(value: object, label: str, minimum: int = 1) -> None:
    # bool is an int subclass - "interval": true must not count as 1.
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise ValueError(f"{label} must be a whole number >= {minimum}")


def timestamp(value: float | None = None) -> str:
    moment = datetime_module.datetime.fromtimestamp(value or time.time())
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def format_duration(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}h {minutes:02d}m {seconds:02d}s"


def format_bytes(num_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024 or unit == "GB":
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} GB"


PING_ROUNDTRIP_BYTES = 128  # rough ICMP request+reply size per target per check
ISP_CHECK_RESPONSE_BYTES = 500  # rough ip-api.com JSON response size


def estimate_hourly_data_usage(
    num_targets: int,
    interval: int,
    isp_check_interval: int,
    speed_test_interval_minutes: int,
) -> dict:
    checks_per_hour = 3600 / interval
    ping_bytes = checks_per_hour * num_targets * PING_ROUNDTRIP_BYTES

    isp_checks_per_hour = 3600 / isp_check_interval if isp_check_interval else 0
    isp_bytes = isp_checks_per_hour * ISP_CHECK_RESPONSE_BYTES

    speed_tests_per_hour = 60 / speed_test_interval_minutes if speed_test_interval_minutes else 0
    speed_bytes = speed_tests_per_hour * (SPEED_TEST_BYTES * 2)  # download + upload

    return {
        "ping": ping_bytes,
        "isp_check": isp_bytes,
        "speed_test": speed_bytes,
        "total": ping_bytes + isp_bytes + speed_bytes,
    }


def ping(target: str, timeout: int) -> bool:
    if platform.system() == "Darwin":
        command = ["ping", "-c", "1", "-W", str(timeout * 1000), target]
    else:
        command = ["ping", "-c", "1", "-W", str(timeout), target]
    try:
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return result.returncode == 0


def prune_old_logs(log_dir: Path, log_prefix: str, keep: int) -> None:
    # keep=0 is valid (logfiles_to_keep=1: only this run's new pair survives).
    if keep < 0:
        return
    for suffix in (".log", ".csv"):
        files = sorted(log_dir.glob(f"{log_prefix}_*{suffix}"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old_file in files[keep:]:
            old_file.unlink(missing_ok=True)


def load_speed_stats(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_speed_stats(path: Path, stats: dict) -> None:
    path.write_text(json.dumps(stats, indent=2) + "\n")


def record_speed_result(stats: dict, provider: str, result: dict) -> dict:
    # Keeps a running average per provider so failovers can be compared against each uplink's own history.
    entry = stats.setdefault(provider, {})
    if result["download_mbps"] is not None:
        count = entry.get("count_download", 0) + 1
        avg = entry.get("download_avg", 0.0) + (result["download_mbps"] - entry.get("download_avg", 0.0)) / count
        entry["count_download"] = count
        entry["download_avg"] = round(avg, 2)
        entry["last_download"] = result["download_mbps"]
    if result["upload_mbps"] is not None:
        count = entry.get("count_upload", 0) + 1
        avg = entry.get("upload_avg", 0.0) + (result["upload_mbps"] - entry.get("upload_avg", 0.0)) / count
        entry["count_upload"] = count
        entry["upload_avg"] = round(avg, 2)
        entry["last_upload"] = result["upload_mbps"]
    return entry


def format_speed_stat_entry(entry: dict | None) -> str:
    if not entry:
        return "no data yet"
    down = (
        f"down avg={entry['download_avg']} Mbps ({entry['count_download']} runs, last={entry['last_download']})"
        if "download_avg" in entry
        else "down: no data"
    )
    up = (
        f"up avg={entry['upload_avg']} Mbps ({entry['count_upload']} runs, last={entry['last_upload']})"
        if "upload_avg" in entry
        else "up: no data"
    )
    return f"{down}, {up}"


class BackgroundTask:
    # Runs a slow network call (ISP lookup, speed test) off the ping loop, so pings keep their rhythm -
    # most importantly during an outage, when every lookup runs into its timeouts.
    # A daemon thread (not a ThreadPoolExecutor) so a running speed test never delays shutdown.
    def __init__(self, function, *args) -> None:
        self.result = None
        self._done = threading.Event()

        def run() -> None:
            try:
                self.result = function(*args)
            finally:
                self._done.set()

        threading.Thread(target=run, daemon=True).start()

    def done(self) -> bool:
        return self._done.is_set()


def main() -> int:
    print("=" * 50)
    print(f" {PROGRAM_NAME} v{PROGRAM_VERSION}")
    print(f" License: {PROGRAM_LICENSE} - {PROGRAM_URL}")
    print("=" * 50)

    script_dir = Path(__file__).resolve().parent
    if script_dir.is_file():  # running from inside the .pyz single-file app
        script_dir = script_dir.parent
    config_path = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else script_dir / "pingmon.json"
    if not config_path.is_absolute():
        config_path = Path.cwd() / config_path

    if not config_path.exists():
        create_default_config(config_path)
        print(f"No config found, created default config at {config_path}")

    try:
        targets, config = load_config(config_path)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    log_dir = Path(config.get("log_dir", "logs"))
    if not log_dir.is_absolute():
        log_dir = script_dir / log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    log_prefix = config.get("log_prefix", "ping_monitor")
    logfiles_to_keep = config.get("logfiles_to_keep", 10)
    prune_old_logs(log_dir, log_prefix, logfiles_to_keep - 1)  # -1: this run's new log/csv still to be created
    stamp = time.strftime("%Y%m%d_%H%M%S")
    log_path = log_dir / f"{log_prefix}_{stamp}.log"
    csv_path = log_dir / f"{log_prefix}_{stamp}.csv"

    isp_info = get_isp_info()
    ipv4_status = get_ip_status(socket.AF_INET, "https://api.ipify.org")
    ipv6_status = get_ip_status(socket.AF_INET6, "https://api6.ipify.org")
    speed_result = run_speed_test()

    speed_stats_path = config_path.parent / "pingmon_speed_stats.json"
    speed_stats = load_speed_stats(speed_stats_path)
    record_speed_result(speed_stats, isp_info["name"] if isp_info else "unknown", speed_result)
    save_speed_stats(speed_stats_path, speed_stats)

    profiles = {**DEFAULT_CONNECTION_PROFILES, **(config.get("connection_profiles") or {})}
    profile_name = select_connection_profile(
        isp_info["name"] if isp_info else None, profiles, isp_info["asn"] if isp_info else None
    )
    profile = profiles.get(profile_name, DEFAULT_CONNECTION_PROFILES["default"])

    # Explicit top-level settings always win over the auto-selected connection profile.
    interval = config["interval"] if "interval" in config else profile.get("interval", 2)
    ping_timeout = config["ping_timeout"] if "ping_timeout" in config else profile.get("ping_timeout", 1)
    failure_threshold = (
        config["failure_threshold"] if "failure_threshold" in config else profile.get("failure_threshold", 1)
    )
    verbose = config.get("verbose_downtime", True)
    isp_check_interval = config.get("isp_check_interval", 15)
    speed_test_on_connection_change = config.get("speed_test_on_connection_change", True)
    speed_test_interval_minutes = config.get("speed_test_interval_minutes", 60)
    started = time.time()
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    with csv_path.open("w", newline="") as csv_file, log_path.open("w") as log_file:
        writer = csv.writer(csv_file)
        writer.writerow(["name", "target", "failure_start", "failure_end", "duration_seconds", "status"])

        def report(level: str, message: str) -> None:
            line = f"[{timestamp()}] [{level}] {message}"
            print(line, flush=True)
            log_file.write(line + "\n")
            log_file.flush()

        print(f"PING FAILURE MONITOR\nConfig: {config_path}\nTargets: {len(targets)}")
        report("INFO", "Monitoring started")

        gateway_source = config.get("_gateway_source", "unavailable")
        provider_display = f"{isp_info['name']} ({isp_info['public_ip']})" if isp_info else "unknown (no internet or lookup failed)"
        target_width = max(len(state.name) for state in targets)

        system_resolvers = get_system_resolvers()
        dns_target = next((state for state in targets if state.name == "dns"), None)
        dns_in_resolvers = bool(dns_target) and dns_target.target in system_resolvers
        hostname_targets = [
            state.name for state in targets if state is not dns_target and not _is_ip_address(state.target)
        ]
        if not system_resolvers:
            dns_chain_note = "system resolver(s) unknown"
        elif not dns_target:
            dns_chain_note = f"system resolver(s) {system_resolvers}; no 'dns' target configured to compare"
        elif dns_in_resolvers:
            dns_chain_note = (
                f"system resolver(s) {system_resolvers}; dns test host IS used to resolve "
                f"{hostname_targets or 'hostname targets'} - their failures may just reflect a dns outage"
            )
        else:
            dns_chain_note = (
                f"system resolver(s) {system_resolvers}; dns test host is NOT used to resolve "
                f"{hostname_targets or 'hostname targets'} - their failures are independent of the dns target"
            )

        print("-" * 50)
        print(" Parameter legend")
        print("   Verbose downtime  : log every failed ping, incl. ones still within failure_threshold, and WARN while down")
        print("   Gateway           : source of the gateway target (configured vs. auto-detected)")
        print("   Provider          : ISP/ASN owning the current public IP")
        print("   Profile           : connection profile auto-selected based on the provider")
        print("   Interval          : seconds between ping checks")
        print("   Ping timeout      : seconds to wait for a ping reply")
        print("   Failure threshold : consecutive failed checks before a target is logged as down")
        print("   IPv4 / IPv6       : public address and whether it's NAT'd/CGNAT or a directly usable external IP")
        print("   DNS chain         : whether hostname targets resolve via the same server as the 'dns' target")
        print("   ISP check interval: how often (s) the provider is re-checked, to catch silent multi-WAN failovers")
        print("   Speed test        : single-connection download/upload estimate")
        print("   Logfiles to keep  : max log/CSV file pairs retained in the log dir, oldest pruned on startup")
        print("-" * 50)
        print(" General")
        print(f"   Log file          : {log_path}")
        print(f"   CSV file          : {csv_path}")
        print(f"   Verbose downtime  : {verbose}")
        print(f"   Gateway           : {gateway_source}")
        print(f"   Logfiles to keep  : {logfiles_to_keep}")
        print(" Targets")
        for state in targets:
            print(f"   {state.name.ljust(target_width)} -> {state.target}")
        print(" Connection")
        print(f"   Provider          : {provider_display}")
        print(f"   Profile           : {profile_name}")
        print(f"   Interval          : {interval}s")
        print(f"   Ping timeout      : {ping_timeout}s")
        print(f"   Failure threshold : {failure_threshold} consecutive fail(s)")
        print(f"   IPv4              : {ipv4_status['public_ip'] or 'unavailable'} ({ipv4_status['status']})")
        print(f"   IPv6              : {ipv6_status['public_ip'] or 'unavailable'} ({ipv6_status['status']})")
        print(f"   DNS chain         : {dns_chain_note}")
        print(f"   ISP check interval: {isp_check_interval}s")
        print(
            f"   Speed test        : "
            f"down={speed_result['download_mbps'] if speed_result['download_mbps'] is not None else 'unavailable'} Mbps, "
            f"up={speed_result['upload_mbps'] if speed_result['upload_mbps'] is not None else 'unavailable'} Mbps "
            f"(on connection change: {speed_test_on_connection_change}, every: "
            f"{f'{speed_test_interval_minutes} min' if speed_test_interval_minutes else 'disabled'})"
        )
        print(f"   Speed avg (provider): {format_speed_stat_entry(speed_stats.get(isp_info['name'] if isp_info else 'unknown'))}")
        print("-" * 50)

        print(" Info")
        if speed_result["download_mbps"] is not None or speed_result["upload_mbps"] is not None:
            print(
                f"   Ran a baseline speed test at startup: down={speed_result['download_mbps']} Mbps, "
                f"up={speed_result['upload_mbps']} Mbps. It will re-run "
                f"{'on every connection change' if speed_test_on_connection_change else 'only on the schedule below'}"
                f"{' and' if speed_test_on_connection_change and speed_test_interval_minutes else ''}"
                f"{f' every {speed_test_interval_minutes} min' if speed_test_interval_minutes else ''}."
            )
        else:
            print("   Baseline speed test at startup failed or is unavailable (no internet or the endpoint was unreachable).")

        usage = estimate_hourly_data_usage(len(targets), interval, isp_check_interval, speed_test_interval_minutes)
        print("   Estimated data volume from these settings (excludes extra speed tests triggered by connection changes):")
        print(f"     Pings      : ~{format_bytes(usage['ping'])}/hour")
        print(f"     ISP checks : ~{format_bytes(usage['isp_check'])}/hour")
        print(f"     Speed tests: ~{format_bytes(usage['speed_test'])}/hour")
        print(
            f"     Total      : ~{format_bytes(usage['total'])}/hour, "
            f"~{format_bytes(usage['total'] * 24)}/day, ~{format_bytes(usage['total'] * 24 * 30)}/month"
        )
        print("-" * 50)

        def format_speed_result(result: dict) -> str:
            down = result["download_mbps"] if result["download_mbps"] is not None else "unavailable"
            up = result["upload_mbps"] if result["upload_mbps"] is not None else "unavailable"
            return f"Speed test: down={down} Mbps, up={up} Mbps"

        def apply_isp_info(new_isp_info: dict | None) -> bool:
            # Behind a multi-WAN failover router, the active uplink can change without any ping ever failing.
            # Returns True if the provider really changed (so a speed test is worth running).
            nonlocal isp_info, profile_name, profile, interval, ping_timeout, failure_threshold
            if new_isp_info is None:
                # A failed lookup (e.g. during a real outage, no internet yet) is not a confirmed provider
                # change - keep the current profile instead of flip-flopping to "unknown"/default.
                return False
            new_provider = new_isp_info["name"]
            old_provider = isp_info["name"] if isp_info else None
            if new_provider == old_provider:
                isp_info = new_isp_info  # public IP may have changed within the same provider
                return False
            new_profile_name = select_connection_profile(new_provider, profiles, new_isp_info.get("asn"))
            new_profile = profiles.get(new_profile_name, DEFAULT_CONNECTION_PROFILES["default"])
            if old_provider is None:
                # The startup lookup failed - this is the first successful one, not a failover.
                report("INFO", f"Provider detected: {new_provider} (profile: {new_profile_name})")
            else:
                report(
                    "INFO",
                    f"Connection changed: {old_provider} -> {new_provider} "
                    f"(profile: {profile_name} -> {new_profile_name})",
                )
                report(
                    "INFO",
                    f"Previous provider ({old_provider}) speed: "
                    f"{format_speed_stat_entry(speed_stats.get(old_provider))}",
                )
            isp_info = new_isp_info
            profile_name = new_profile_name
            profile = new_profile
            if "interval" not in config:
                interval = profile.get("interval", 2)
            if "ping_timeout" not in config:
                ping_timeout = profile.get("ping_timeout", 1)
            if "failure_threshold" not in config:
                failure_threshold = profile.get("failure_threshold", 1)
            return old_provider is not None

        def apply_speed_result(result: dict) -> None:
            nonlocal speed_result
            speed_result = result
            record_speed_result(speed_stats, isp_info["name"] if isp_info else "unknown", result)
            save_speed_stats(speed_stats_path, speed_stats)
            report("INFO", format_speed_result(result))

        total_outages = 0
        down_targets: set[str] = set()
        isp_task: BackgroundTask | None = None
        speed_task: BackgroundTask | None = None
        last_isp_check = time.monotonic()
        last_speed_test = time.monotonic()
        isp_check_now = False
        ping_pool = ThreadPoolExecutor(max_workers=len(targets), thread_name_prefix="ping")
        next_tick = time.monotonic()

        while not stopping:
            # Collect results of background work started in earlier rounds.
            if isp_task and isp_task.done():
                if apply_isp_info(isp_task.result) and speed_test_on_connection_change and not speed_task:
                    speed_task = BackgroundTask(run_speed_test)
                    last_speed_test = time.monotonic()
                isp_task = None
            if speed_task and speed_task.done():
                apply_speed_result(speed_task.result)
                speed_task = None

            now = time.monotonic()
            if not isp_task and (isp_check_now or now - last_isp_check >= isp_check_interval):
                isp_task = BackgroundTask(get_isp_info)
                last_isp_check = now
                isp_check_now = False
            if (
                speed_test_interval_minutes
                and not speed_task
                and now - last_speed_test >= speed_test_interval_minutes * 60
            ):
                speed_task = BackgroundTask(run_speed_test)
                last_speed_test = now

            # Ping all targets at once - one round takes at most ping_timeout, however many targets are down.
            results = list(ping_pool.map(lambda state: ping(state.target, ping_timeout), targets))

            for state, ok in zip(targets, results):
                if ok:
                    state.consecutive_failures = 0
                    if state.failure_start is not None:
                        ended = time.time()
                        seconds = int(time.monotonic() - state.first_failure_mono)
                        state.outages += 1
                        state.downtime += seconds
                        report("INFO", f"{state.name} ({state.target}) recovered after {format_duration(seconds)}")
                        writer.writerow([state.name, state.target, timestamp(state.first_failure_at), timestamp(ended), seconds, "COMPLETE"])
                        csv_file.flush()
                        down_targets.discard(state.name)
                        # Overlapping outages across targets count as a single combined outage.
                        if not down_targets:
                            print(f"--- outages since start ({timestamp(started)}): {total_outages} ---")
                            isp_check_now = True
                            print()
                    state.failure_start = None
                    state.first_failure_at = None
                    state.first_failure_mono = None
                    continue

                state.consecutive_failures += 1
                if state.consecutive_failures == 1:
                    state.first_failure_at = time.time()
                    state.first_failure_mono = time.monotonic()
                if state.consecutive_failures < failure_threshold:
                    if verbose:
                        report(
                            "WARN",
                            f"{state.name} ({state.target}) ping failed "
                            f"({state.consecutive_failures}/{failure_threshold}, within failure_threshold)",
                        )
                    continue
                if state.failure_start is None:
                    state.failure_start = time.time()
                    if not down_targets:
                        total_outages += 1
                        # Check right as the outage starts - a brief auto-failover may already have
                        # switched (and switched back) before we'd otherwise notice at recovery.
                        isp_check_now = True
                    down_targets.add(state.name)
                    report("ERROR", f"{state.name} ({state.target}) FAILURE")
                elif verbose:
                    seconds = int(time.monotonic() - state.first_failure_mono)
                    report("WARN", f"{state.name} ({state.target}) still down for {format_duration(seconds)}")

            # Fixed rhythm: sleep until the next tick instead of a full interval after the work.
            next_tick += interval
            delay = next_tick - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_tick = time.monotonic()  # fell behind (e.g. machine slept) - don't try to catch up

        ping_pool.shutdown(wait=False, cancel_futures=True)
        ended = time.time()
        for state in targets:
            if state.failure_start is not None:
                seconds = int(time.monotonic() - state.first_failure_mono)
                state.outages += 1
                state.downtime += seconds
                writer.writerow([state.name, state.target, timestamp(state.first_failure_at), timestamp(ended), seconds, "INCOMPLETE"])

    print("\nPING MONITOR SUMMARY")
    print(f"Runtime: {format_duration(int(ended - started))}")
    for state in targets:
        print(f"{state.name} ({state.target}): {state.outages} outages, {format_duration(state.downtime)} downtime")
    print(f"Log: {log_path}\nCSV: {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
