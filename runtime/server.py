"""Simple WSGI server exposing a /generate endpoint on port 8000.

POST /generate
  JSON body: {"message": "..."}
  Returns JSON: {"assistant_text": "...", "validation": {...}, "recommended": [...]}

No network calls; uses local generator stub and packet enforcer.
"""
from __future__ import annotations

import sys
from pathlib import Path
from wsgiref.simple_server import make_server
import json
from typing import Callable

# Ensure workspace root is on sys.path so imports like 'tools' and 'runtime' resolve
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import loader
from tools import runner
from runtime import packet_enforcer
from runtime import tool_recommender
import runtime.cli as cli


def app(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    method = environ.get("REQUEST_METHOD", "GET")
    if path == "/":
        # Serve the packaged homepage if present, fall back to simple manager page
        homepage = ROOT / "Contents" / "Resources" / "Homepage.html"
        if homepage.exists():
            content = homepage.read_bytes()
            start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")])
            return [content]
        start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")])
        html = (
            "<html><body>"
            "<h1>Local LLM Manager</h1>"
            "<form method='post' action='/generate'>"
            "<textarea name='message' rows=6 cols=60>test</textarea><br/>"
            "<button type='submit'>Generate</button>"
            "</form>"
            "</body></html>"
        )
        return [html.encode("utf-8")]

    if path == "/health":
        start_response("200 OK", [("Content-Type", "application/json")])
        try:
            registry = loader.load_manifest()
            info = {"status": "ok", "tools_count": len(registry), "tools": list(registry.keys())}
        except Exception as e:
            info = {"status": "error", "error": str(e)}
        return [json.dumps(info).encode("utf-8")]

    if path == "/server/info":
        start_response("200 OK", [("Content-Type", "application/json")])
        try:
            registry = loader.load_manifest()
            payload = {"service": "local-llm-manager", "tools": list(registry.keys())}
        except Exception as e:
            payload = {"error": str(e)}
        return [json.dumps(payload).encode("utf-8")]

    if path == "/generate" and method in ("POST",):
        try:
            try:
                size = int(environ.get("CONTENT_LENGTH", 0))
            except Exception:
                size = 0
            body = environ["wsgi.input"].read(size) if size else environ["wsgi.input"].read()
            try:
                data = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                qs = body.decode("utf-8")
                data = {}
                for part in qs.split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        data[k] = v
            message = data.get("message", "")
            registry = loader.load_manifest()
            recommended = tool_recommender.recommend_tools(message, registry)
            assistant_text = packet_enforcer.enforce_or_regenerate(cli.generate_fn_stub, message)
            validation = runner.run_tool("system_packet_validator", {"text": assistant_text})
            payload = {"assistant_text": assistant_text, "validation": validation, "recommended": recommended}
            start_response("200 OK", [("Content-Type", "application/json")])
            return [json.dumps(payload).encode("utf-8")]
        except Exception as e:
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [json.dumps({"error": str(e)}).encode("utf-8")]

    if path == "/jotform/fill" and method in ("POST",):
        # Trigger the jotform autofill snapshot script and return the saved path
        import subprocess
        script = ROOT / "scripts" / "jotform_logout.sh"
        if not script.exists():
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [json.dumps({"error": "jotform script not found"}).encode("utf-8")]
        try:
            # Run script and capture output
            p = subprocess.run([str(script)], capture_output=True, text=True, timeout=60)
            if p.returncode != 0:
                start_response("500 Internal Server Error", [("Content-Type", "application/json")])
                return [json.dumps({"error": p.stderr.strip() or p.stdout.strip()}).encode("utf-8")]
            out = p.stdout.strip()
            start_response("200 OK", [("Content-Type", "application/json")])
            return [json.dumps({"result": out}).encode("utf-8")]
        except Exception as e:
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [json.dumps({"error": str(e)}).encode("utf-8")]

    if path == "/eod/pdf" and method in ("POST",):
        # Accept JSON body: { "html": "...", "filename": "optional-name.pdf" }
        try:
            size = int(environ.get("CONTENT_LENGTH", 0))
        except Exception:
            size = 0
        body = environ["wsgi.input"].read(size) if size else environ["wsgi.input"].read()
        try:
            data = json.loads(body.decode("utf-8") if body else "{}")
        except Exception:
            start_response("400 Bad Request", [("Content-Type", "application/json")])
            return [json.dumps({"error": "invalid json"}).encode("utf-8")]
        html = data.get("html", "")
        if not html:
            start_response("400 Bad Request", [("Content-Type", "application/json")])
            return [json.dumps({"error": "missing html"}).encode("utf-8")]
        fn = data.get("filename") or f"end-of-day-{int(__import__('time').time())}.pdf"
        tmpdir = ROOT / "tmp"
        tmpdir.mkdir(parents=True, exist_ok=True)
        tmpfile = tmpdir / (fn + ".html")
        outpdf = Path.home() / "Desktop" / fn
        tmpfile.write_text(html, encoding="utf-8")
        script = ROOT / "scripts" / "print_html_to_pdf.sh"
        if not script.exists():
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [json.dumps({"error": "print script missing"}).encode("utf-8")]
        import subprocess
        try:
            p = subprocess.run([str(script), str(tmpfile), str(outpdf)], capture_output=True, text=True, timeout=120)
            if p.returncode != 0:
                start_response("500 Internal Server Error", [("Content-Type", "application/json")])
                return [json.dumps({"error": p.stderr.strip() or p.stdout.strip()}).encode("utf-8")]
            start_response("200 OK", [("Content-Type", "application/json")])
            return [json.dumps({"result": str(outpdf)}).encode("utf-8")]
        except Exception as e:
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [json.dumps({"error": str(e)}).encode("utf-8")]

    start_response("404 Not Found", [("Content-Type", "text/plain")])
    return [b"Not Found"]


def run_server(host: str = "0.0.0.0", port: int = 8000, serve: Callable = app, max_tries: int = 10):
    """Try to bind starting at `port`, advancing if the port is in use (up to max_tries).

    Adds a simple /health endpoint and prints the chosen port.
    """
    chosen_port = None
    for attempt in range(max_tries):
        try_port = port + attempt
        try:
            server = make_server(host, try_port, serve)
        except OSError as e:
            # Address already in use or other bind issue -> try next port
            continue
        else:
            chosen_port = try_port
            break
    if chosen_port is None:
        raise RuntimeError(f"Unable to bind to ports {port}..{port+max_tries-1}")
    bind_host = host
    # If host was 0.0.0.0, show localhost in printed URL for local accessibility
    display_host = "127.0.0.1" if bind_host == "0.0.0.0" else bind_host
    print(f"Serving on http://{display_host}:{chosen_port} (bound to {bind_host})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server stopped")


if __name__ == "__main__":
    import os

    host = os.getenv("HOST", "0.0.0.0")
    try:
        port = int(os.getenv("PORT", "8000"))
    except Exception:
        port = 8000
    try:
        max_tries = int(os.getenv("MAX_TRIES", "10"))
    except Exception:
        max_tries = 10
    run_server(host=host, port=port, max_tries=max_tries)
