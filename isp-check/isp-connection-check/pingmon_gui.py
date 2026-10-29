#!/usr/bin/env python3
"""Desktop GUI for pingmon.py: live monitor view plus a settings editor for pingmon.json."""

from __future__ import annotations

import json
import glob
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

import pingmon

MODULE_DIR = Path(__file__).resolve().parent
PACKAGED = MODULE_DIR.is_file()  # running from inside the .pyz single-file app
# Config and logs live next to the app file, never inside the .pyz.
SCRIPT_DIR = MODULE_DIR.parent if PACKAGED else MODULE_DIR
MONITOR_COMMAND = [str(MODULE_DIR), "--monitor"] if PACKAGED else [str(MODULE_DIR / "pingmon.py")]
DEFAULT_CONFIG_PATH = SCRIPT_DIR / "pingmon.json"

SECTION_HEADERS = {"Parameter legend", "General", "Targets", "Connection", "Info"}
EVENT_RE = re.compile(r"^\[[^\]]+\] \[(INFO|WARN|ERROR)\] (.*)$")
KV_RE = re.compile(r"^ {3}(\S[^:]*?)\s*:\s*(.*)$")
DATA_KV_RE = re.compile(r"^ {5}(\S[^:]*?)\s*:\s*(.*)$")
# Target names may contain spaces ("my nas"), so names are matched up to the " -> " / " (" separator.
TARGET_RE = re.compile(r"^ {3}(\S.*?)\s+-> (.*)$")
FAILURE_RE = re.compile(r"^(.+?) \((.*)\) FAILURE$")
RECOVERED_RE = re.compile(r"^(.+?) \((.*)\) recovered after (\d+)h (\d+)m (\d+)s$")
FLAKY_RE = re.compile(r"^(.+?) \((.*)\) ping failed")
CHANGED_RE = re.compile(r"^Connection changed: (.*) -> (.*) \(profile: \S+ -> (\S+)\)$")
DETECTED_RE = re.compile(r"^Provider detected: (.*) \(profile: (\S+)\)$")
SPEED_RE = re.compile(r"Speed test\s*:\s*down=(\S+) Mbps, up=(\S+) Mbps")

STATUS_COLORS = {
    "STOPPED": "#7f8c8d",
    "STARTING": "#3498db",
    "ONLINE": "#27ae60",
    "DEGRADED": "#f39c12",
    "OUTAGE": "#e74c3c",
}


def format_match(keywords: list[str]) -> str:
    # JSON-quoted so keywords with meaningful spaces (e.g. "o2 ", " lte") survive editing.
    return ", ".join(json.dumps(keyword) for keyword in keywords)


def parse_match(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    try:
        parsed = json.loads(f"[{text}]")
        if all(isinstance(item, str) for item in parsed):
            return parsed
    except json.JSONDecodeError:
        pass
    return [part.strip() for part in text.split(",") if part.strip()]


class PingmonGui(tk.Tk):
    def __init__(self, config_path: Path) -> None:
        super().__init__()
        self.title(f"{pingmon.PROGRAM_NAME} v{pingmon.PROGRAM_VERSION}")
        self.geometry("1150x780")
        self.minsize(950, 620)

        self.proc: subprocess.Popen | None = None
        self.output: queue.Queue[str | None] = queue.Queue()
        self.started_at: float | None = None
        self.raw_config: dict = {}
        self.targets: dict[str, str] = {}
        self.profiles: dict[str, dict] = {}
        self.section: str | None = None
        self.target_rows: dict[str, dict] = {}
        self.down_targets: set[str] = set()
        self.total_outages = 0

        self.config_path_var = tk.StringVar(value=str(config_path))

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True)
        monitor_tab = ttk.Frame(notebook)
        settings_tab = ttk.Frame(notebook)
        notebook.add(monitor_tab, text="Monitor")
        notebook.add(settings_tab, text="Settings")
        self.build_monitor_tab(monitor_tab)
        self.build_settings_tab(settings_tab)

        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.load_config()
        self.set_status("STOPPED")
        self.after(150, self.poll_output)
        self.after(1000, self.tick)

    # ------------------------------------------------------------------ monitor tab
    def build_monitor_tab(self, parent: ttk.Frame) -> None:
        bar = ttk.Frame(parent)
        bar.pack(fill="x", padx=8, pady=8)
        self.status_label = tk.Label(bar, text="", fg="white", font=("TkDefaultFont", 14, "bold"), padx=16, pady=6)
        self.status_label.pack(side="left")
        self.runtime_label = ttk.Label(bar, text="")
        self.runtime_label.pack(side="left", padx=12)
        ttk.Button(bar, text="Open log folder", command=self.open_log_folder).pack(side="right")
        ttk.Button(bar, text="Clear output", command=self.clear_output).pack(side="right", padx=4)
        self.stop_button = ttk.Button(bar, text="Stop", command=self.stop_monitor, state="disabled")
        self.stop_button.pack(side="right", padx=4)
        self.start_button = ttk.Button(bar, text="Start", command=self.start_monitor)
        self.start_button.pack(side="right", padx=4)

        panes = ttk.PanedWindow(parent, orient="vertical")
        panes.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        top = ttk.Frame(panes)
        panes.add(top, weight=2)
        top.columnconfigure(0, weight=1)
        top.columnconfigure(1, weight=1)
        top.rowconfigure(0, weight=1)

        info_frame = ttk.LabelFrame(top, text="Connection & settings in use")
        info_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
        self.info_tree = ttk.Treeview(info_frame, columns=("value",), show="tree headings", height=10)
        self.info_tree.heading("#0", text="Parameter")
        self.info_tree.heading("value", text="Value")
        self.info_tree.column("#0", width=170, stretch=False)
        self.info_tree.column("value", width=380)
        info_scroll = ttk.Scrollbar(info_frame, orient="vertical", command=self.info_tree.yview)
        self.info_tree.configure(yscrollcommand=info_scroll.set)
        self.info_tree.pack(side="left", fill="both", expand=True)
        info_scroll.pack(side="right", fill="y")
        self.info_items: dict[str, str] = {}

        targets_frame = ttk.LabelFrame(top, text="Targets")
        targets_frame.grid(row=0, column=1, sticky="nsew", padx=(4, 0))
        columns = ("target", "status", "outages", "downtime", "last")
        self.status_tree = ttk.Treeview(targets_frame, columns=columns, show="tree headings", height=10)
        self.status_tree.heading("#0", text="Name")
        self.status_tree.column("#0", width=90, stretch=False)
        for column, title, width in (
            ("target", "Target", 130),
            ("status", "Status", 80),
            ("outages", "Outages", 65),
            ("downtime", "Downtime", 95),
            ("last", "Last event", 140),
        ):
            self.status_tree.heading(column, text=title)
            self.status_tree.column(column, width=width)
        self.status_tree.tag_configure("UP", foreground="#1e8449")
        self.status_tree.tag_configure("FLAKY", foreground="#b9770e")
        self.status_tree.tag_configure("DOWN", foreground="#c0392b")
        self.status_tree.pack(fill="both", expand=True)

        output_frame = ttk.LabelFrame(panes, text="Output (same as terminal)")
        panes.add(output_frame, weight=3)
        self.output_text = ScrolledText(output_frame, wrap="word", height=14, font=("TkFixedFont", 10), state="disabled")
        self.output_text.pack(fill="both", expand=True)
        self.output_text.tag_configure("INFO", foreground="#1f618d")
        self.output_text.tag_configure("WARN", foreground="#b9770e")
        self.output_text.tag_configure("ERROR", foreground="#c0392b")
        self.output_text.tag_configure("OK", foreground="#1e8449")
        self.output_text.tag_configure("DIM", foreground="#7f8c8d")

    def set_status(self, status: str) -> None:
        self.status_label.configure(text=status, bg=STATUS_COLORS[status])

    def set_info(self, key: str, value: str) -> None:
        if key in self.info_items:
            self.info_tree.item(self.info_items[key], values=(value,))
        else:
            self.info_items[key] = self.info_tree.insert("", "end", text=key, values=(value,))

    def update_target_row(self, name: str, **fields: object) -> None:
        row = self.target_rows.setdefault(
            name, {"target": "", "status": "-", "outages": 0, "downtime": 0, "last": ""}
        )
        row.update(fields)
        values = (
            row["target"],
            row["status"],
            row["outages"],
            pingmon.format_duration(row["downtime"]),
            row["last"],
        )
        if self.status_tree.exists(name):
            self.status_tree.item(name, values=values, tags=(row["status"],))
        else:
            self.status_tree.insert("", "end", iid=name, text=name, values=values, tags=(row["status"],))

    def refresh_overall_status(self) -> None:
        if not self.proc:
            return
        if not self.target_rows:
            self.set_status("STARTING")
        elif not self.down_targets:
            self.set_status("ONLINE")
        elif len(self.down_targets) >= len(self.target_rows):
            self.set_status("OUTAGE")
        else:
            self.set_status("DEGRADED")

    def append_output(self, line: str, tag: str | None) -> None:
        self.output_text.configure(state="normal")
        self.output_text.insert("end", line + "\n", (tag,) if tag else ())
        # Keep memory bounded for multi-day runs; the full history is in the log file anyway.
        if int(self.output_text.index("end-1c").split(".")[0]) > 5000:
            self.output_text.delete("1.0", "1000.0")
        self.output_text.configure(state="disabled")
        self.output_text.see("end")

    def clear_output(self) -> None:
        self.output_text.configure(state="normal")
        self.output_text.delete("1.0", "end")
        self.output_text.configure(state="disabled")

    def handle_line(self, line: str) -> None:
        stripped = line.strip()
        tag = None

        if stripped in SECTION_HEADERS and line.startswith(" "):
            self.section = stripped
            tag = "DIM"
        elif set(stripped) == {"-"} or set(stripped) == {"="}:
            if self.section == "Info":
                self.section = None
            tag = "DIM"
        elif self.section == "Targets" and (match := TARGET_RE.match(line)):
            self.update_target_row(match.group(1), target=match.group(2), status="UP")
            self.refresh_overall_status()
        elif self.section in ("General", "Connection") and (match := KV_RE.match(line)):
            self.set_info(match.group(1), match.group(2))
        elif self.section == "Info" and (match := DATA_KV_RE.match(line)):
            self.set_info(f"Data volume: {match.group(1)}", match.group(2))
        elif self.section == "Parameter legend":
            tag = "DIM"
        elif event := EVENT_RE.match(line):
            tag = event.group(1)
            tag = self.handle_event(event.group(2), tag)
        elif stripped.startswith("ERROR"):
            tag = "ERROR"

        self.append_output(line, tag)

    def handle_event(self, message: str, tag: str) -> str:
        now = time.strftime("%H:%M:%S")
        if match := FAILURE_RE.match(message):
            name = match.group(1)
            if not self.down_targets:
                self.total_outages += 1
                self.set_info("Outages (combined)", str(self.total_outages))
            self.down_targets.add(name)
            self.update_target_row(name, status="DOWN", last=f"{now} failure")
        elif match := RECOVERED_RE.match(message):
            name = match.group(1)
            hours, minutes, seconds = (int(match.group(i)) for i in (3, 4, 5))
            row = self.target_rows.get(name, {"outages": 0, "downtime": 0})
            self.down_targets.discard(name)
            self.update_target_row(
                name,
                status="UP",
                outages=row["outages"] + 1,
                downtime=row["downtime"] + hours * 3600 + minutes * 60 + seconds,
                last=f"{now} recovered",
            )
            tag = "OK"
        elif match := FLAKY_RE.match(message):
            name = match.group(1)
            if name not in self.down_targets:
                self.update_target_row(name, status="FLAKY", last=f"{now} ping failed")
        elif match := CHANGED_RE.match(message):
            self.set_info("Provider", match.group(2))
            self.set_info("Profile", match.group(3))
            tag = "WARN"
        elif match := DETECTED_RE.match(message):
            self.set_info("Provider", match.group(1))
            self.set_info("Profile", match.group(2))
        elif match := SPEED_RE.search(message):
            self.set_info("Speed test", f"down={match.group(1)} Mbps, up={match.group(2)} Mbps ({now})")
        self.refresh_overall_status()
        return tag

    def poll_output(self) -> None:
        try:
            while True:
                line = self.output.get_nowait()
                if line is None:
                    self.on_process_exit()
                    break
                self.handle_line(line.rstrip("\n"))
        except queue.Empty:
            pass
        self.after(150, self.poll_output)

    def tick(self) -> None:
        if self.proc and self.started_at:
            self.runtime_label.configure(
                text=f"Running for {pingmon.format_duration(int(time.time() - self.started_at))}"
            )
        self.after(1000, self.tick)

    def start_monitor(self) -> None:
        if self.proc:
            return
        config_path = Path(self.config_path_var.get()).expanduser()
        try:
            pending = self.collect_config()
        except ValueError as error:
            messagebox.showerror("Invalid settings", str(error))
            return
        if pending != self.raw_config or not config_path.exists():
            answer = messagebox.askyesnocancel(
                "Unsaved settings", "Settings differ from the config file. Save them before starting?"
            )
            if answer is None:
                return
            if answer and not self.save_config():
                return

        self.info_tree.delete(*self.info_tree.get_children())
        self.info_items.clear()
        self.status_tree.delete(*self.status_tree.get_children())
        self.target_rows.clear()
        self.down_targets.clear()
        self.total_outages = 0
        self.section = None

        command = [sys.executable, "-u", *MONITOR_COMMAND, str(config_path)]
        kwargs: dict = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            self.proc = subprocess.Popen(
                command,
                cwd=SCRIPT_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                **kwargs,
            )
        except OSError as error:
            messagebox.showerror("Start failed", str(error))
            self.proc = None
            return

        threading.Thread(target=self.read_process_output, args=(self.proc,), daemon=True).start()
        self.started_at = time.time()
        self.start_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.set_status("STARTING")
        self.append_output(
            "(Startup runs ISP lookup and a baseline speed test first - this can take ~20s.)", "DIM"
        )

    def read_process_output(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            self.output.put(line)
        proc.wait()
        self.output.put(None)

    def stop_monitor(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        self.stop_button.configure(state="disabled")
        self.append_output("Stopping (waits for the current check to finish)...", "DIM")
        # SIGINT lets pingmon finish the current cycle and print its summary + close the CSV cleanly.
        if os.name == "nt":
            self.proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            self.proc.send_signal(signal.SIGINT)
        self.after(15000, self.force_kill, self.proc)

    def force_kill(self, proc: subprocess.Popen) -> None:
        if proc.poll() is None:
            proc.kill()

    def on_process_exit(self) -> None:
        code = self.proc.returncode if self.proc else None
        self.proc = None
        self.started_at = None
        self.start_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.set_status("STOPPED")
        self.append_output(f"Monitor process exited (code {code}).", "DIM")

    def open_log_folder(self) -> None:
        log_dir = Path(self.raw_config.get("log_dir", "logs")).expanduser()
        if not log_dir.is_absolute():
            log_dir = SCRIPT_DIR / log_dir
        log_dir.mkdir(parents=True, exist_ok=True)
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(log_dir)])
        elif os.name == "nt":
            os.startfile(log_dir)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(log_dir)])

    def on_close(self) -> None:
        if self.proc and self.proc.poll() is None:
            if not messagebox.askokcancel("Quit", "Monitoring is running. Stop it and quit?"):
                return
            self.proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.destroy()

    # ----------------------------------------------------------------- settings tab
    def build_settings_tab(self, parent: ttk.Frame) -> None:
        top = ttk.Frame(parent)
        top.pack(fill="x", padx=8, pady=8)
        ttk.Label(top, text="Config file:").pack(side="left")
        ttk.Entry(top, textvariable=self.config_path_var).pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(top, text="Browse...", command=self.browse_config).pack(side="left")
        ttk.Button(top, text="Reload", command=self.load_config).pack(side="left", padx=2)
        ttk.Button(top, text="Load defaults", command=self.load_defaults).pack(side="left", padx=2)
        ttk.Button(top, text="Save", command=self.save_config).pack(side="left", padx=2)
        self.settings_message = ttk.Label(parent, text="", foreground="#1e8449")
        self.settings_message.pack(fill="x", padx=8)

        body = ttk.Frame(parent)
        body.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(1, weight=1)

        general = ttk.LabelFrame(body, text="General")
        general.grid(row=0, column=0, sticky="nsew", padx=(0, 4), pady=(0, 6))
        self.var_isp_interval = tk.StringVar()
        self.var_speed_interval = tk.StringVar()
        self.var_speed_on_change = tk.BooleanVar()
        self.var_verbose = tk.BooleanVar()
        self.var_log_dir = tk.StringVar()
        self.var_log_prefix = tk.StringVar()
        self.var_logs_keep = tk.StringVar()
        self.form_row(general, 0, "ISP check interval (s)", self.var_isp_interval, "re-check provider to catch silent failovers")
        self.form_row(general, 1, "Speed test every (min)", self.var_speed_interval, "0 = disabled")
        ttk.Checkbutton(general, text="Speed test on connection change", variable=self.var_speed_on_change).grid(
            row=2, column=0, columnspan=3, sticky="w", padx=6, pady=2
        )
        ttk.Checkbutton(general, text="Verbose downtime (log every failed ping)", variable=self.var_verbose).grid(
            row=3, column=0, columnspan=3, sticky="w", padx=6, pady=2
        )
        self.form_row(general, 4, "Log directory", self.var_log_dir, "relative to the app folder")
        self.form_row(general, 5, "Log file prefix", self.var_log_prefix, "")
        self.form_row(general, 6, "Log files to keep", self.var_logs_keep, "oldest pruned on start")

        overrides = ttk.LabelFrame(body, text="Ping overrides (empty = use connection profile)")
        overrides.grid(row=0, column=1, sticky="nsew", padx=(4, 0), pady=(0, 6))
        self.var_interval = tk.StringVar()
        self.var_timeout = tk.StringVar()
        self.var_threshold = tk.StringVar()
        self.form_row(overrides, 0, "Interval (s)", self.var_interval, "seconds between ping checks")
        self.form_row(overrides, 1, "Ping timeout (s)", self.var_timeout, "wait for a reply")
        self.form_row(overrides, 2, "Failure threshold", self.var_threshold, "consecutive fails = down")
        ttk.Label(
            overrides,
            text="Values set here apply to every provider and disable\nthe automatic per-profile values below.",
            foreground="#7f8c8d",
        ).grid(row=3, column=0, columnspan=3, sticky="w", padx=6, pady=6)

        self.build_targets_editor(body)
        self.build_profiles_editor(body)

    def form_row(self, parent: ttk.Frame, row: int, label: str, var: tk.StringVar, hint: str) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=2)
        ttk.Entry(parent, textvariable=var, width=18).grid(row=row, column=1, sticky="w", padx=6, pady=2)
        ttk.Label(parent, text=hint, foreground="#7f8c8d").grid(row=row, column=2, sticky="w", padx=6, pady=2)

    def build_targets_editor(self, body: ttk.Frame) -> None:
        frame = ttk.LabelFrame(body, text="Ping targets")
        frame.grid(row=1, column=0, sticky="nsew", padx=(0, 4))
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(0, weight=1)
        self.targets_tree = ttk.Treeview(frame, columns=("host",), show="tree headings", height=6)
        self.targets_tree.heading("#0", text="Name")
        self.targets_tree.heading("host", text="Host / IP")
        self.targets_tree.column("#0", width=120, stretch=False)
        self.targets_tree.grid(row=0, column=0, columnspan=2, sticky="nsew", padx=6, pady=6)
        self.targets_tree.bind("<<TreeviewSelect>>", self.on_target_select)

        self.var_target_name = tk.StringVar()
        self.var_target_host = tk.StringVar()
        ttk.Label(frame, text="Name").grid(row=1, column=0, sticky="w", padx=6)
        ttk.Entry(frame, textvariable=self.var_target_name).grid(row=1, column=1, sticky="ew", padx=6, pady=2)
        ttk.Label(frame, text="Host / IP").grid(row=2, column=0, sticky="w", padx=6)
        ttk.Entry(frame, textvariable=self.var_target_host).grid(row=2, column=1, sticky="ew", padx=6, pady=2)
        buttons = ttk.Frame(frame)
        buttons.grid(row=3, column=0, columnspan=2, sticky="w", padx=6, pady=4)
        ttk.Button(buttons, text="Add / Update", command=self.upsert_target).pack(side="left")
        ttk.Button(buttons, text="Remove", command=self.remove_target).pack(side="left", padx=4)
        ttk.Label(
            frame,
            text="Tip: target 'gateway' with empty host = auto-detect your router.\n"
            "Target 'dns' is compared with your system resolver (DNS chain check).",
            foreground="#7f8c8d",
        ).grid(row=4, column=0, columnspan=2, sticky="w", padx=6, pady=(0, 6))

    def build_profiles_editor(self, body: ttk.Frame) -> None:
        frame = ttk.LabelFrame(body, text="Connection profiles (auto-selected by ISP name)")
        frame.grid(row=1, column=1, sticky="nsew", padx=(4, 0))
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(0, weight=1)
        columns = ("match", "interval", "timeout", "threshold")
        self.profiles_tree = ttk.Treeview(frame, columns=columns, show="tree headings", height=6)
        self.profiles_tree.heading("#0", text="Profile")
        self.profiles_tree.column("#0", width=90, stretch=False)
        for column, title, width in (
            ("match", "Match keywords", 200),
            ("interval", "Interval", 60),
            ("timeout", "Timeout", 60),
            ("threshold", "Threshold", 70),
        ):
            self.profiles_tree.heading(column, text=title)
            self.profiles_tree.column(column, width=width, stretch=column == "match")
        self.profiles_tree.grid(row=0, column=0, columnspan=2, sticky="nsew", padx=6, pady=6)
        self.profiles_tree.bind("<<TreeviewSelect>>", self.on_profile_select)

        self.var_profile_name = tk.StringVar()
        self.var_profile_match = tk.StringVar()
        self.var_profile_interval = tk.StringVar()
        self.var_profile_timeout = tk.StringVar()
        self.var_profile_threshold = tk.StringVar()
        for row, (label, var) in enumerate(
            (
                ("Name", self.var_profile_name),
                ("Match keywords", self.var_profile_match),
                ("Interval (s)", self.var_profile_interval),
                ("Ping timeout (s)", self.var_profile_timeout),
                ("Failure threshold", self.var_profile_threshold),
            ),
            start=1,
        ):
            ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", padx=6)
            ttk.Entry(frame, textvariable=var).grid(row=row, column=1, sticky="ew", padx=6, pady=2)
        buttons = ttk.Frame(frame)
        buttons.grid(row=6, column=0, columnspan=2, sticky="w", padx=6, pady=4)
        ttk.Button(buttons, text="Add / Update", command=self.upsert_profile).pack(side="left")
        ttk.Button(buttons, text="Remove", command=self.remove_profile).pack(side="left", padx=4)
        ttk.Label(
            frame,
            text='Keywords: comma-separated, quote them to keep spaces, e.g. "o2 ", " lte".\n'
            "Matched case-insensitively against the ISP name; 'default' is used otherwise.",
            foreground="#7f8c8d",
        ).grid(row=7, column=0, columnspan=2, sticky="w", padx=6, pady=(0, 6))

    def refresh_targets_tree(self) -> None:
        self.targets_tree.delete(*self.targets_tree.get_children())
        for name, host in self.targets.items():
            self.targets_tree.insert("", "end", iid=name, text=name, values=(host or "(auto-detect)",))

    def refresh_profiles_tree(self) -> None:
        self.profiles_tree.delete(*self.profiles_tree.get_children())
        for name, profile in self.profiles.items():
            self.profiles_tree.insert(
                "",
                "end",
                iid=name,
                text=name,
                values=(
                    format_match(profile.get("match", [])),
                    profile.get("interval", ""),
                    profile.get("ping_timeout", ""),
                    profile.get("failure_threshold", ""),
                ),
            )

    def on_target_select(self, _event: object) -> None:
        selection = self.targets_tree.selection()
        if selection:
            name = selection[0]
            self.var_target_name.set(name)
            self.var_target_host.set(self.targets.get(name, ""))

    def on_profile_select(self, _event: object) -> None:
        selection = self.profiles_tree.selection()
        if selection:
            name = selection[0]
            profile = self.profiles.get(name, {})
            self.var_profile_name.set(name)
            self.var_profile_match.set(format_match(profile.get("match", [])))
            self.var_profile_interval.set(str(profile.get("interval", "")))
            self.var_profile_timeout.set(str(profile.get("ping_timeout", "")))
            self.var_profile_threshold.set(str(profile.get("failure_threshold", "")))

    def upsert_target(self) -> None:
        name = self.var_target_name.get().strip()
        host = self.var_target_host.get().strip()
        if not name:
            messagebox.showerror("Target", "Name is required.")
            return
        if "(" in name or ")" in name:
            # The monitor's output wraps the host in parentheses after the name.
            messagebox.showerror("Target", "The name must not contain parentheses.")
            return
        if host.startswith("-") or " " in host:
            messagebox.showerror("Target", "Host / IP must be a host name or IP address.")
            return
        self.targets[name] = host
        self.refresh_targets_tree()

    def remove_target(self) -> None:
        for name in self.targets_tree.selection():
            self.targets.pop(name, None)
        self.refresh_targets_tree()

    def upsert_profile(self) -> None:
        name = self.var_profile_name.get().strip()
        if not name:
            messagebox.showerror("Profile", "Name is required.")
            return
        try:
            profile = {
                "match": parse_match(self.var_profile_match.get()),
                "interval": self.parse_int(self.var_profile_interval.get(), "Interval", 1),
                "ping_timeout": self.parse_int(self.var_profile_timeout.get(), "Ping timeout", 1),
                "failure_threshold": self.parse_int(self.var_profile_threshold.get(), "Failure threshold", 1),
            }
        except ValueError as error:
            messagebox.showerror("Profile", str(error))
            return
        self.profiles[name] = profile
        self.refresh_profiles_tree()

    def remove_profile(self) -> None:
        for name in self.profiles_tree.selection():
            if name == "default":
                messagebox.showinfo("Profile", "The 'default' profile is required and can't be removed.")
                continue
            self.profiles.pop(name, None)
        self.refresh_profiles_tree()

    @staticmethod
    def parse_int(text: str, label: str, minimum: int) -> int:
        try:
            value = int(str(text).strip())
        except ValueError:
            raise ValueError(f"{label} must be a whole number.") from None
        if value < minimum:
            raise ValueError(f"{label} must be at least {minimum}.")
        return value

    def browse_config(self) -> None:
        path = filedialog.askopenfilename(
            initialdir=str(Path(self.config_path_var.get()).expanduser().parent),
            filetypes=[("JSON config", "*.json"), ("All files", "*")],
        )
        if path:
            self.config_path_var.set(path)
            self.load_config()

    def load_defaults(self) -> None:
        self.populate_form(json.loads(json.dumps(pingmon.DEFAULT_CONFIG)))
        self.settings_message.configure(text="Defaults loaded - click Save to write them to the config file.")

    def load_config(self) -> None:
        path = Path(self.config_path_var.get()).expanduser()
        if not path.exists():
            self.raw_config = {}
            self.populate_form(json.loads(json.dumps(pingmon.DEFAULT_CONFIG)))
            self.settings_message.configure(text=f"{path} does not exist yet - showing defaults, Save to create it.")
            return
        try:
            config = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            messagebox.showerror("Config", f"Could not read {path}:\n{error}")
            return
        self.raw_config = config
        self.populate_form(config)
        self.settings_message.configure(text=f"Loaded {path}")

    def populate_form(self, config: dict) -> None:
        self.targets = dict(config.get("targets", {}))
        profiles = config.get("connection_profiles") or pingmon.DEFAULT_CONNECTION_PROFILES
        self.profiles = json.loads(json.dumps(profiles))
        self.profiles.setdefault("default", dict(pingmon.DEFAULT_CONNECTION_PROFILES["default"]))
        self.var_isp_interval.set(str(config.get("isp_check_interval", 15)))
        self.var_speed_interval.set(str(config.get("speed_test_interval_minutes", 60)))
        self.var_speed_on_change.set(bool(config.get("speed_test_on_connection_change", True)))
        self.var_verbose.set(bool(config.get("verbose_downtime", True)))
        self.var_log_dir.set(str(config.get("log_dir", "logs")))
        self.var_log_prefix.set(str(config.get("log_prefix", "ping_monitor")))
        self.var_logs_keep.set(str(config.get("logfiles_to_keep", 10)))
        self.var_interval.set(str(config["interval"]) if "interval" in config else "")
        self.var_timeout.set(str(config["ping_timeout"]) if "ping_timeout" in config else "")
        self.var_threshold.set(str(config["failure_threshold"]) if "failure_threshold" in config else "")
        self.refresh_targets_tree()
        self.refresh_profiles_tree()

    def collect_config(self) -> dict:
        if not self.targets:
            raise ValueError("At least one ping target is required.")
        config = dict(self.raw_config)  # keeps keys this GUI doesn't know about
        config["targets"] = dict(self.targets)
        config["connection_profiles"] = json.loads(json.dumps(self.profiles))
        config["isp_check_interval"] = self.parse_int(self.var_isp_interval.get(), "ISP check interval", 1)
        config["speed_test_on_connection_change"] = bool(self.var_speed_on_change.get())
        config["speed_test_interval_minutes"] = self.parse_int(self.var_speed_interval.get(), "Speed test interval", 0)
        config["log_dir"] = self.var_log_dir.get().strip() or "logs"
        config["log_prefix"] = self.var_log_prefix.get().strip() or "ping_monitor"
        config["logfiles_to_keep"] = self.parse_int(self.var_logs_keep.get(), "Log files to keep", 1)
        config["verbose_downtime"] = bool(self.var_verbose.get())
        for key, var, label in (
            ("interval", self.var_interval, "Interval override"),
            ("ping_timeout", self.var_timeout, "Ping timeout override"),
            ("failure_threshold", self.var_threshold, "Failure threshold override"),
        ):
            if var.get().strip():
                config[key] = self.parse_int(var.get(), label, 1)
            else:
                config.pop(key, None)
        return config

    def save_config(self) -> bool:
        try:
            config = self.collect_config()
        except ValueError as error:
            messagebox.showerror("Invalid settings", str(error))
            return False
        path = Path(self.config_path_var.get()).expanduser()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(config, indent=2) + "\n")
        except OSError as error:
            messagebox.showerror("Save failed", str(error))
            return False
        self.raw_config = config
        note = " (restart monitoring to apply)" if self.proc else ""
        self.settings_message.configure(text=f"Saved {path} at {time.strftime('%H:%M:%S')}{note}")
        return True


RELAUNCH_ENV = "ISP_CHECK_RELAUNCHED"
PYTHON_CANDIDATES = (
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    *sorted(glob.glob("/Library/Frameworks/Python.framework/Versions/3.*/bin/python3"), reverse=True),
    *sorted(glob.glob("/opt/homebrew/bin/python3.*[0-9]"), reverse=True),
)


def find_python_with_modern_tk() -> str | None:
    current = os.path.realpath(sys.executable)
    for candidate in PYTHON_CANDIDATES:
        if not os.access(candidate, os.X_OK) or os.path.realpath(candidate) == current:
            continue
        try:
            result = subprocess.run(
                [candidate, "-c", "import sys, tkinter; sys.exit(0 if tkinter.TkVersion >= 8.6 else 1)"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            return candidate
    return None


def check_tk_version() -> bool:
    # Apple's /usr/bin/python3 bundles Tk 8.5, which renders an empty black window on current macOS.
    patchlevel = tk.Tcl().eval("info patchlevel")
    if tk.TkVersion >= 8.6:
        return True
    if not os.environ.get(RELAUNCH_ENV):
        better = find_python_with_modern_tk()
        if better:
            print(f"Tk {patchlevel} is too old, restarting with {better}", file=sys.stderr)
            os.environ[RELAUNCH_ENV] = "1"
            os.execv(better, [better, *sys.argv])
    print(
        f"ERROR: Tk {patchlevel} is too old for the GUI (needs 8.6+), the window would stay blank.\n"
        f"Python used: {sys.executable}\n"
        "Fix on macOS: install Python from https://www.python.org/downloads/ and start with\n"
        "  /usr/local/bin/python3 isp-connection-check.pyz\n"
        "or with Homebrew: brew install python python-tk && $(brew --prefix)/bin/python3 isp-connection-check.pyz\n"
        "The command line version works with any Python: python3 isp-connection-check.pyz --cli",
        file=sys.stderr,
    )
    return False


def main() -> int:
    if not check_tk_version():
        return 1
    config_path = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else DEFAULT_CONFIG_PATH
    if not config_path.is_absolute():
        config_path = Path.cwd() / config_path
    app = PingmonGui(config_path)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
