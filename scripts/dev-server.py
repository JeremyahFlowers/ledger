#!/usr/bin/env python3
"""Static file server for local development, with caching turned off.

    python3 scripts/dev-server.py [port]

Why this exists rather than `python3 -m http.server`: that server sends no
cache headers at all, so browsers fall back to heuristic caching and hold on to
stale JS and CSS. During development that produces a uniquely wasteful failure
— you edit a module, reload, and test the previous version, with nothing on
screen indicating it. Worse, a partially-stale load mixes new and old modules
and throws on a missing export, which looks like a real bug and isn't.

Every response here carries no-store, so a reload always fetches the current
file. This is a development convenience only; production caching is the service
worker's job (see sw.js).
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8910


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # The default logs every asset request, which buries anything useful.
        if args and isinstance(args[0], str) and " 200 " not in args[0]:
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {ROOT} at http://localhost:{port}/ (caching disabled)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
