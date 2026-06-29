#!/usr/bin/env python3
"""
Local preview server for the site.

Why not just open index.html directly?
  The page uses ES modules + a video texture, which browsers block over
  the file:// protocol. You need to serve it over http. This tiny server
  also supports HTTP Range requests, which is what makes the scroll-scrub
  video seeking smooth.

Usage:
    python3 serve.py
    # then open http://localhost:8000

To deploy for real, just drop this folder on any static host
(Netlify, Vercel, GitHub Pages, Cloudflare Pages, etc.) — no server needed.
"""
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

TYPES = {".mp4": "video/mp4", ".js": "text/javascript", ".mjs": "text/javascript"}


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        for ext, t in TYPES.items():
            if path.endswith(ext):
                return t
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if not m:
            return super().do_GET()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)


if __name__ == "__main__":
    print(f"Serving on http://localhost:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
