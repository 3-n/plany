#!/bin/sh
# Double-click in Finder to start the app; it opens in Safari. Close this window (or Ctrl+C) to stop.
cd "$(dirname "$0")" && exec /usr/bin/python3 server.py "$@"
