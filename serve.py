#!/usr/bin/env python3
"""Serve the repo root locally so prototype/ can fetch ../data/*.json. Usage: python3 serve.py [port]"""
import os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8791"))
print(f"serving {os.getcwd()} at http://127.0.0.1:{port}/prototype/", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
