#!/usr/bin/env python3
"""Tiny static dev server for the sample site that disables caching.

`python -m http.server` lets the browser cache CSS/JS aggressively, so edits
appear not to take effect until a hard refresh. This server sends no-store
headers on every response, so a normal reload always fetches the latest files.

It also exposes ONE virtual endpoint, ``/live/dispatch_posts.json``, that streams
the WarForge composer's runtime post log (``<repo>/data/api_dump/dispatch_posts.json``)
which lives OUTSIDE this folder. The site fetches it and merges GM-composed
dispatches into the feed live -- so a dispatch you send shows up on reload
without re-running ``fetch_map.py``. Missing/unreadable -> ``[]``.

To keep the war state LIVE, the server also re-runs ``fetch_map.build()`` on a
background thread every ``WARFORGE_REBAKE_SECS`` seconds (default 30), so the
page's own poll always reads fresh data. Set ``WARFORGE_REBAKE_SECS=0`` to
disable and go back to manual ``python fetch_map.py`` bakes.

    python serve.py            # serves this folder at http://localhost:8090
    python serve.py 8090       # explicit port

Binds to every interface, so the site is reachable from your phone on the same
Wi-Fi at the printed Network URL (Windows may pop a firewall prompt the first
time -- allow it on Private networks).
"""
import http.server
import os
import socket
import socketserver
import sys
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8090))
# This script lives in <repo>/web-sample/. Resolve both BEFORE chdir.
SITE_DIR = os.path.dirname(os.path.abspath(__file__))
# Optional GM-composed live dispatches. Self-contained: kept INSIDE the project; if the
# file is absent the /live endpoint just returns [] (the standalone build has no composer).
LIVE_POSTS = os.path.join(SITE_DIR, "_source", "data", "api_dump", "dispatch_posts.json")
os.chdir(SITE_DIR)

# How often to re-pull holotable + re-bake data/*.json on a background thread.
# fetch_map.py only fetches when run, so without this the served snapshot is
# frozen at the last manual bake. 0 disables auto-rebake.
REBAKE_SECS = int(os.environ.get("WARFORGE_REBAKE_SECS", "30"))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # Drop conditional headers so the browser never gets a 304 (stale) response.
    def send_head(self):
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

    def do_GET(self):
        if self.path.split("?", 1)[0].rstrip("/") == "/live/dispatch_posts.json":
            return self._serve_live_posts()
        return super().do_GET()

    def do_POST(self):
        # The lore editor (lore-editor.html) POSTs the full lore.json here to save it
        # straight to data/lore.json — local dev tool, only writes that one file.
        if self.path.split("?", 1)[0].rstrip("/") == "/save/lore.json":
            return self._save_lore()
        self.send_error(404)

    def _save_lore(self):
        # Local authoring only: a public/always-on deploy must NOT let arbitrary callers overwrite
        # lore.json. Allow localhost, or an explicit WARFORGE_ALLOW_SAVE=1 opt-in for remote authoring.
        host = self.client_address[0] if self.client_address else ""
        if host not in ("127.0.0.1", "::1") and os.environ.get("WARFORGE_ALLOW_SAVE") != "1":
            self.send_error(403, "lore save disabled (localhost only)"); return
        import json as _json
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        try:
            obj = _json.loads(raw.decode("utf-8"))                 # validate it's real JSON
            pretty = _json.dumps(obj, indent=2, ensure_ascii=False)
        except Exception as e:                                     # noqa: BLE001
            self.send_response(400); self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(("invalid JSON: " + str(e)).encode("utf-8")); return
        target = os.path.join(SITE_DIR, "data", "lore.json")
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(pretty)
        os.replace(tmp, target)                                    # atomic
        self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers()
        self.wfile.write(b"ok")

    def _serve_live_posts(self):
        try:
            with open(LIVE_POSTS, "rb") as f:
                body = f.read()
        except OSError:
            body = b"[]"                       # not composed yet -> empty feed, no error
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def _rebake_loop():
    """Re-run fetch_map.build() every REBAKE_SECS seconds (fail-soft).

    Runs in a daemon thread so the static server stays up no matter what; if the
    bake throws (holotable down, transient API error) the last good data/*.json
    stays in place and we just try again next cycle.
    """
    try:
        import fetch_map                       # same folder as this script (on sys.path)
    except Exception as e:                     # noqa: BLE001
        print(f"  [rebake] DISABLED - could not import fetch_map.py: {e}", flush=True)
        return
    while True:
        try:
            fetch_map.build()                  # pull holotable + write data/*.json (atomic)
        except Exception as e:                 # noqa: BLE001  (offline / API hiccup)
            print(f"  [rebake] skipped (holotable unreachable?): {e}", flush=True)
        time.sleep(REBAKE_SECS)


def _lan_ips():
    """Best-effort list of this machine's LAN IPv4 addresses (for the phone URL)."""
    ips = set()
    try:                                       # the route the OS would use to reach
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)  # the internet -> our LAN IP
        s.connect(("8.8.8.8", 80))             # no packets sent for UDP connect()
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"WARFORGE sample site  (no-cache dev server)", flush=True)
        print(f"  Local:    http://localhost:{PORT}", flush=True)
        for ip in _lan_ips():
            print(f"  Network:  http://{ip}:{PORT}   <- open this on your phone (same Wi-Fi)", flush=True)
        print(f"  Live posts endpoint: /live/dispatch_posts.json", flush=True)
        if REBAKE_SECS > 0:                    # keep the war state live in the background
            threading.Thread(target=_rebake_loop, daemon=True).start()
            print(f"  Auto-rebake: every {REBAKE_SECS}s from holotable.net (WARFORGE_REBAKE_SECS=0 to disable)", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
