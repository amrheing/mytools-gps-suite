"""Entry point for the single-file app (isp-connection-check.pyz)."""

import sys

if len(sys.argv) > 1 and sys.argv[1] in ("--monitor", "--cli"):
    del sys.argv[1]
    import pingmon

    raise SystemExit(pingmon.main())

import pingmon_gui

raise SystemExit(pingmon_gui.main())
