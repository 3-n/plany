#!/usr/bin/env python3
"""Local server for the plan overlay app.

Serves the folder as a static site and adds a tiny write API so the app can
save plans into ./data. Without this server (e.g. on GitHub Pages) the same
files work as a read-only viewer.

    python3 server.py            # http://localhost:8765
    python3 server.py --port 9000 --no-open
"""

import argparse
import http.server
import json
import os
import re
import shutil
import socketserver
import sys
import threading
import webbrowser
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
MANIFEST = os.path.join(DATA, "layers.json")
# Only files directly inside these data subfolders may be written or deleted.
WRITABLE = re.compile(r"^(layers|sources)/[A-Za-z0-9_.-]{1,120}$")
MAX_UPLOAD = 1024 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".webp": "image/webp",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # The app and its data change while you work; never serve stale copies.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in self.path:
            super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _target(self):
        rel = parse_qs(urlparse(self.path).query).get("path", [""])[0]
        if not WRITABLE.match(rel) or ".." in rel:
            return None
        return os.path.join(DATA, rel)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            raise ValueError("bad Content-Length")
        return self.rfile.read(length)

    def _route(self):
        return urlparse(self.path).path.split("/api/", 1)[-1] if "/api/" in self.path else None

    def do_GET(self):
        if self._route() == "status":
            return self._json(200, {"editable": True})
        if self._route() is not None:
            return self._json(404, {"error": "not found"})
        super().do_GET()

    def do_PUT(self):
        route = self._route()
        try:
            if route == "manifest":
                doc = json.loads(self._read_body())
                if not isinstance(doc, dict) or not isinstance(doc.get("layers"), list):
                    return self._json(400, {"error": "manifest must be {layers: [...]}"})
                write_atomic(MANIFEST, json.dumps(doc, ensure_ascii=False, indent=1).encode())
                return self._json(200, {"ok": True})
            if route == "file":
                target = self._target()
                if not target:
                    return self._json(400, {"error": "invalid path"})
                write_atomic(target, self._read_body())
                return self._json(200, {"ok": True})
        except (ValueError, json.JSONDecodeError) as e:
            return self._json(400, {"error": str(e)})
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if self._route() == "file":
            target = self._target()
            if not target:
                return self._json(400, {"error": "invalid path"})
            if os.path.isfile(target):
                os.remove(target)
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true", help="don't open Safari")
    args = ap.parse_args()

    os.makedirs(os.path.join(DATA, "layers"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "sources"), exist_ok=True)
    if not os.path.exists(MANIFEST):
        write_atomic(MANIFEST, b'{"version": 1, "layers": []}\n')

    try:
        httpd = Server(("127.0.0.1", args.port), Handler)
    except OSError as e:
        sys.exit(f"Port {args.port} is busy ({e}). Is the app already running? Try --port 8766.")

    url = f"http://localhost:{args.port}/"
    print(f"Serving {ROOT}\nOpen {url}  (Ctrl+C to stop)")
    if not args.no_open:
        def open_browser():
            if sys.platform == "darwin" and shutil.which("open"):
                os.system(f"open -a Safari '{url}' || open '{url}'")
            else:
                webbrowser.open(url)
        threading.Timer(0.6, open_browser).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
