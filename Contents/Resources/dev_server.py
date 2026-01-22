#!/Library/Developer/CommandLineTools/usr/bin/python3
from __future__ import annotations

import argparse
import errno
import http.server
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

SCRIPT_PATH = Path(__file__).resolve()
SCRIPT_DIR = SCRIPT_PATH.parent

# Support both repo layout (`scripts/dev_server.py`) and macOS app bundle layout
# (`Contents/Resources/dev_server.py`).
RUNTIME_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name in {"scripts", "bin"} else SCRIPT_DIR

SITE_ROOT = RUNTIME_ROOT
if not (SITE_ROOT / "Homepage.html").is_file() and (RUNTIME_ROOT / "site" / "Homepage.html").is_file():
    SITE_ROOT = (RUNTIME_ROOT / "site").resolve()
elif not (SITE_ROOT / "Homepage.html").is_file() and (SCRIPT_DIR / "Homepage.html").is_file():
    SITE_ROOT = SCRIPT_DIR
elif not (SITE_ROOT / "Homepage.html").is_file() and (SCRIPT_DIR / "site" / "Homepage.html").is_file():
    SITE_ROOT = (SCRIPT_DIR / "site").resolve()

WORKSPACE_ROOT = (RUNTIME_ROOT / "workspace").resolve()
DEFAULT_UPSTREAM = "http://127.0.0.1:11434"

CORS_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}
CORS_ALLOWED_SCHEMES = {"http", "https"}
CORS_TRUSTED_APP_SCHEMES = {"app", "applewebdata"}

SERVER_INSTANCE_ID = os.getenv("MK_SERVER_INSTANCE_ID") or secrets.token_hex(8)

SERVER_CONFIG_PATH = Path(
    os.getenv("MK_SERVER_CONFIG_PATH")
    or (Path.home() / "Library" / "Application Support" / "LocalLLM" / "server_config.json")
).expanduser()


def _load_server_config() -> Dict[str, Any]:
    path = SERVER_CONFIG_PATH
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_server_config(config: Dict[str, Any]) -> None:
    path = SERVER_CONFIG_PATH
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    tmp = path.with_suffix(path.suffix + f".tmp.{secrets.token_hex(6)}")
    try:
        tmp.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def _compute_local_ipv4() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def _default_port_for_scheme(scheme: str) -> int:
    return 443 if scheme and scheme.lower() == "https" else 80


def _is_loopback_host(host: str) -> bool:
    if not host:
        return False
    h = host.strip().lower()
    if h in {"localhost"}:
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _normalize_upstream(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return DEFAULT_UPSTREAM
    if "://" not in s:
        s = "http://" + s
    return s.rstrip("/")


def _upstream_points_to_self(upstream: str, *, server_port: int) -> bool:
    try:
        parsed = urlparse(upstream)
    except Exception:
        return False
    host = parsed.hostname
    if not host:
        return False
    port = parsed.port if parsed.port is not None else _default_port_for_scheme(parsed.scheme)
    if port != int(server_port):
        return False
    if _is_loopback_host(host) or host.strip().lower() in {"0.0.0.0", "::"}:
        return True
    local_ip = _compute_local_ipv4()
    return bool(local_ip and host.strip().lower() == local_ip.lower())


def _probe_existing_server(host: str, port: int) -> bool:
    if not host or not port:
        return False
    probe_host = host
    if probe_host in ("0.0.0.0", "::"):
        probe_host = "127.0.0.1"
    url = f"http://{probe_host}:{int(port)}/server/info"
    try:
        with urllib.request.urlopen(url, timeout=0.6) as resp:
            raw = resp.read()
            status = resp.status
    except Exception:
        return False
    if status < 200 or status >= 300:
        return False
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return False
    return isinstance(payload, dict) and payload.get("ok") is True


def _fetch_existing_server_info(host: str, port: int) -> Optional[Dict[str, Any]]:
    if not host or not port:
        return None
    probe_host = host
    if probe_host in ("0.0.0.0", "::"):
        probe_host = "127.0.0.1"
    url = f"http://{probe_host}:{int(port)}/server/info"
    try:
        with urllib.request.urlopen(url, timeout=0.8) as resp:
            raw = resp.read()
            status = resp.status
    except Exception:
        return None
    if status < 200 or status >= 300:
        return None
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return None
    return payload


def _is_valid_hostname(host: str) -> bool:
    h = str(host or "").strip().lower().rstrip(".")
    if not h:
        return False
    if len(h) > 253:
        return False
    labels = h.split(".")
    for label in labels:
        if not label or len(label) > 63:
            return False
        if label.startswith("-") or label.endswith("-"):
            return False
        if not re.fullmatch(r"[a-z0-9-]+", label):
            return False
    return True


def _sanitize_bind_host(host: str) -> str:
    raw = str(host or "").strip()
    if not raw:
        return "127.0.0.1"
    if "://" in raw or "/" in raw or raw.endswith(":"):
        return "127.0.0.1"

    candidate = raw
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]

    try:
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        pass

    if _is_valid_hostname(candidate):
        return candidate

    return "127.0.0.1"


def _canonical_ui_host(host: str) -> str:
    if not host:
        return "localhost"
    h = host.strip()
    if h in ("0.0.0.0", "::"):
        return "localhost"
    if _is_loopback_host(h):
        return "localhost"
    return h


DEFAULTS_BIN = "/usr/bin/defaults"
AGENTC_DEFAULTS_DOMAIN = "Ai.AgentC"


def _defaults_read(domain: str, key: str) -> str:
    try:
        proc = subprocess.run(
            [DEFAULTS_BIN, "read", domain, key],
            capture_output=True,
            text=True,
            timeout=1.0,
        )
    except Exception:
        return ""
    if proc.returncode != 0:
        return ""
    return (proc.stdout or "").strip()


def _defaults_write_str(domain: str, key: str, value: str) -> bool:
    try:
        proc = subprocess.run(
            [DEFAULTS_BIN, "write", domain, key, str(value)],
            capture_output=True,
            text=True,
            timeout=1.0,
        )
        return proc.returncode == 0
    except Exception:
        return False


def _defaults_write_int(domain: str, key: str, value: int) -> bool:
    try:
        proc = subprocess.run(
            [DEFAULTS_BIN, "write", domain, key, "-int", str(int(value))],
            capture_output=True,
            text=True,
            timeout=1.0,
        )
        return proc.returncode == 0
    except Exception:
        return False


def _read_agentc_defaults() -> Dict[str, Any]:
    return {
        "serverHost": _defaults_read(AGENTC_DEFAULTS_DOMAIN, "AgentC.serverHost"),
        "serverPort": _defaults_read(AGENTC_DEFAULTS_DOMAIN, "AgentC.serverPort"),
        "ollamaUpstream": _defaults_read(AGENTC_DEFAULTS_DOMAIN, "AgentC.ollamaUpstream"),
    }


def _desired_ollama_upstream(current_upstream: str, *, server_port: int) -> str:
    raw = str(current_upstream or "").strip()
    try:
        parsed = urlparse(raw)
    except Exception:
        return "http://localhost:11434"
    host = parsed.hostname
    if not host:
        return "http://localhost:11434"
    port = parsed.port if parsed.port is not None else _default_port_for_scheme(parsed.scheme)
    if port == int(server_port) and _is_loopback_host(host):
        return "http://localhost:11434"
    if _is_loopback_host(host) and port == 11434:
        return "http://localhost:11434"
    return raw


def _repair_agentc_defaults(*, server_port: int, upstream: str) -> Dict[str, Any]:
    before = _read_agentc_defaults()
    desired_host = "localhost"
    desired_upstream = _desired_ollama_upstream(upstream, server_port=server_port)

    _defaults_write_str(AGENTC_DEFAULTS_DOMAIN, "AgentC.serverHost", desired_host)
    _defaults_write_int(AGENTC_DEFAULTS_DOMAIN, "AgentC.serverPort", int(server_port))
    _defaults_write_str(AGENTC_DEFAULTS_DOMAIN, "AgentC.ollamaUpstream", desired_upstream)

    after = _read_agentc_defaults()
    return {
        "ok": True,
        "before": before,
        "after": after,
        "desired": {"serverHost": desired_host, "serverPort": int(server_port), "ollamaUpstream": desired_upstream},
    }


def _restart_server_async(*, server: http.server.ThreadingHTTPServer, argv: list[str]) -> None:
    def worker():
        time.sleep(0.15)
        try:
            server.shutdown()
        except Exception:
            pass
        try:
            server.server_close()
        except Exception:
            pass
        try:
            subprocess.Popen(argv, start_new_session=True)
        except Exception as e:
            sys.stderr.write(f"failed to restart server: {e}\n")
            sys.stderr.flush()
            return
        os._exit(0)

    threading.Thread(target=worker, daemon=False).start()


def _make_server(host: str, port: int, handler) -> http.server.ThreadingHTTPServer:
    last_err: Optional[Exception] = None
    for _ in range(24):
        try:
            return http.server.ThreadingHTTPServer((host, port), handler)
        except OSError as e:
            last_err = e
            if getattr(e, "errno", None) == errno.EADDRINUSE:
                time.sleep(0.15)
                continue
            raise
    if last_err:
        raise last_err
    return http.server.ThreadingHTTPServer((host, port), handler)


def _cors_allow_origin(handler: http.server.BaseHTTPRequestHandler) -> Optional[str]:
    origin = (handler.headers.get("Origin") or "").strip()
    if not origin:
        return None
    if origin == "null":
        return "null"
    try:
        parsed = urlparse(origin)
    except Exception:
        return None
    if parsed.scheme in CORS_TRUSTED_APP_SCHEMES:
        return origin
    if parsed.scheme not in CORS_ALLOWED_SCHEMES:
        return None
    if not parsed.hostname:
        return None
    if parsed.hostname in CORS_ALLOWED_HOSTS:
        return origin
    return None


def _set_cors_headers(handler: http.server.BaseHTTPRequestHandler) -> None:
    allowed = _cors_allow_origin(handler)
    if not allowed:
        return
    handler.send_header("Access-Control-Allow-Origin", allowed)
    handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-MK-Tool-Token")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Max-Age", "600")


def _json_response(handler: http.server.BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _text_response(handler: http.server.BaseHTTPRequestHandler, status: int, text: str, content_type: str) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _read_request_body(handler: http.server.BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return b""
    return handler.rfile.read(length)


def _safe_workspace_path(rel: str) -> Path:
    rel = (rel or "").strip()
    if rel in ("", "."):
        return WORKSPACE_ROOT

    path = Path(rel)
    if path.is_absolute():
        raise ValueError("Path must be relative to workspace.")

    resolved = (WORKSPACE_ROOT / path).resolve()
    if resolved == WORKSPACE_ROOT:
        return resolved

    ws_prefix = str(WORKSPACE_ROOT) + os.sep
    if not str(resolved).startswith(ws_prefix):
        raise ValueError("Path escapes workspace.")
    return resolved


def _proxy_request(
    *,
    upstream: str,
    handler: http.server.BaseHTTPRequestHandler,
    method: str,
    path: str,
    body: bytes,
    timeout_s: int,
) -> None:
    target = upstream.rstrip("/") + path
    try:
        req = urllib.request.Request(target, data=body if method != "GET" else None, method=method)
        ct = handler.headers.get("Content-Type")
        if ct:
            req.add_header("Content-Type", ct)
        accept = handler.headers.get("Accept")
        if accept:
            req.add_header("Accept", accept)

        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = resp.read()
            status = resp.status
            headers = dict(resp.headers)
    except urllib.error.HTTPError as e:
        data = e.read()
        status = e.code
        headers = dict(e.headers)
    except Exception as e:
        _json_response(handler, 502, {"error": str(e)})
        return

    handler.send_response(status)
    handler.send_header("Content-Type", headers.get("Content-Type", "application/json"))
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def _proxy_request_stream(
    *,
    upstream: str,
    handler: http.server.BaseHTTPRequestHandler,
    method: str,
    path: str,
    body: bytes,
    timeout_s: int,
) -> None:
    target = upstream.rstrip("/") + path
    try:
        req = urllib.request.Request(target, data=body if method != "GET" else None, method=method)
        ct = handler.headers.get("Content-Type")
        if ct:
            req.add_header("Content-Type", ct)
        accept = handler.headers.get("Accept")
        if accept:
            req.add_header("Accept", accept)

        resp = urllib.request.urlopen(req, timeout=timeout_s)
        status = resp.status
        headers = dict(resp.headers)
        stream = resp
    except urllib.error.HTTPError as e:
        status = e.code
        headers = dict(e.headers)
        stream = e
    except Exception as e:
        _json_response(handler, 502, {"error": str(e)})
        return

    handler.send_response(status)
    handler.send_header("Content-Type", headers.get("Content-Type", "application/json"))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Transfer-Encoding", "chunked")
    handler.end_headers()
    try:
        handler.wfile.flush()
    except Exception:
        pass

    try:
        while True:
            chunk = stream.read(8192)
            if not chunk:
                break
            try:
                size = f"{len(chunk):X}\r\n".encode("ascii")
                handler.wfile.write(size)
                handler.wfile.write(chunk)
                handler.wfile.write(b"\r\n")
                handler.wfile.flush()
            except BrokenPipeError:
                break
    finally:
        try:
            try:
                handler.wfile.write(b"0\r\n\r\n")
                handler.wfile.flush()
            except Exception:
                pass
            stream.close()
        except Exception:
            pass


def _handle_health(handler: http.server.BaseHTTPRequestHandler, upstream: str) -> None:
    target = upstream.rstrip("/") + "/api/version"
    try:
        with urllib.request.urlopen(target, timeout=10) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except Exception as e:
        _json_response(handler, 502, {"ok": False, "error": str(e)})
        return

    if status < 200 or status >= 300:
        msg = raw.decode("utf-8", errors="replace").strip()
        _json_response(handler, status, {"ok": False, "error": msg or f"HTTP {status}"})
        return

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        _json_response(handler, 502, {"ok": False, "error": "Invalid JSON from upstream /api/version"})
        return

    if isinstance(payload, dict):
        out: Dict[str, Any] = {"ok": True, "upstream": upstream}
        out.update(payload)
        _json_response(handler, 200, out)
        return

    _json_response(handler, 200, {"ok": True, "upstream": upstream, "version": str(payload)})


def _inject_tool_token(html: str, token: str) -> str:
    injection = f'<script>window.__MK_TOOL_TOKEN={json.dumps(token)};</script>'
    if "</head>" in html:
        return html.replace("</head>", injection + "</head>", 1)
    return injection + html


def _is_loopback_addr(addr: str) -> bool:
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return False


def _serve_file(handler: http.server.BaseHTTPRequestHandler, path: Path, *, tool_token: Optional[str] = None) -> None:
    if not path.exists() or not path.is_file():
        _text_response(handler, 404, "not found\n", "text/plain; charset=utf-8")
        return

    raw = path.read_bytes()
    content_type, _ = mimetypes.guess_type(str(path))
    content_type = content_type or "application/octet-stream"

    client_host = ""
    try:
        client_host = str(handler.client_address[0] if handler.client_address else "")
    except Exception:
        client_host = ""

    # Only inject the tool token for loopback clients; this avoids exposing local
    # filesystem/shell tools if the server is bound to a LAN interface.
    if tool_token and path.name.lower() == "homepage.html" and _is_loopback_addr(client_host):
        try:
            html = raw.decode("utf-8")
            html = _inject_tool_token(html, tool_token)
            raw = html.encode("utf-8")
            content_type = "text/html; charset=utf-8"
        except Exception:
            # fallback to raw bytes
            pass

    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


def _require_tool_token(handler: http.server.BaseHTTPRequestHandler, expected: str) -> bool:
    got = (handler.headers.get("X-MK-Tool-Token") or "").strip()
    if not got or got != expected:
        _json_response(handler, 403, {"error": "Tool token missing or invalid."})
        return False
    return True


def _handle_tool(handler: http.server.BaseHTTPRequestHandler, tool_token: str, tool_name: str, body: bytes) -> None:
    client_host = ""
    try:
        client_host = str(handler.client_address[0] if handler.client_address else "")
    except Exception:
        client_host = ""
    if not _is_loopback_addr(client_host):
        _json_response(handler, 403, {"error": "Tools are only available from this machine (loopback)."})
        return

    if not _require_tool_token(handler, tool_token):
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    try:
        WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        _json_response(handler, 500, {"error": f"Failed to create workspace: {e}"})
        return

    try:
        if tool_name == "list_dir":
            rel = str(payload.get("path") or ".")
            target = _safe_workspace_path(rel)
            if not target.exists():
                _json_response(handler, 404, {"error": "Directory not found.", "path": rel})
                return
            if not target.is_dir():
                _json_response(handler, 400, {"error": "Not a directory.", "path": rel})
                return
            entries = []
            for p in sorted(target.iterdir(), key=lambda x: x.name.lower()):
                try:
                    st = p.lstat()
                except Exception:
                    st = None
                entries.append(
                    {
                        "name": p.name,
                        "type": "dir" if p.is_dir() else "file" if p.is_file() else "other",
                        "size": int(st.st_size) if st else None,
                    }
                )
            _json_response(handler, 200, {"ok": True, "path": rel, "entries": entries})
            return

        if tool_name == "read_file":
            rel = str(payload.get("path") or "")
            if not rel:
                _json_response(handler, 400, {"error": "Missing path."})
                return
            target = _safe_workspace_path(rel)
            if not target.exists() or not target.is_file():
                _json_response(handler, 404, {"error": "File not found.", "path": rel})
                return
            raw = target.read_bytes()
            try:
                text = raw.decode("utf-8")
                encoding = "utf-8"
            except Exception:
                text = raw.decode("utf-8", errors="replace")
                encoding = "utf-8 (lossy)"
            max_chars = int(payload.get("max_chars") or 240_000)
            if len(text) > max_chars:
                text = text[:max_chars] + "\n…(truncated)…\n"
            _json_response(handler, 200, {"ok": True, "path": rel, "encoding": encoding, "content": text})
            return

        if tool_name == "write_file":
            rel = str(payload.get("path") or "")
            if not rel:
                _json_response(handler, 400, {"error": "Missing path."})
                return
            content = payload.get("content")
            if content is None:
                _json_response(handler, 400, {"error": "Missing content."})
                return
            overwrite = bool(payload.get("overwrite", True))
            target = _safe_workspace_path(rel)
            if target.exists() and not overwrite:
                _json_response(handler, 409, {"error": "File exists and overwrite=false.", "path": rel})
                return
            target.parent.mkdir(parents=True, exist_ok=True)
            data = str(content).encode("utf-8")
            max_bytes = int(payload.get("max_bytes") or 2_000_000)
            if len(data) > max_bytes:
                _json_response(handler, 413, {"error": "Content too large.", "path": rel, "max_bytes": max_bytes})
                return
            target.write_bytes(data)
            _json_response(handler, 200, {"ok": True, "path": rel, "bytes": len(data)})
            return

        if tool_name == "run_shell":
            command = str(payload.get("command") or "").strip()
            if not command:
                _json_response(handler, 400, {"error": "Missing command."})
                return
            timeout_ms = int(payload.get("timeout_ms") or 120_000)
            if timeout_ms < 1_000:
                timeout_ms = 1_000
            if timeout_ms > 600_000:
                timeout_ms = 600_000

            result = subprocess.run(
                command,
                shell=True,
                cwd=str(WORKSPACE_ROOT),
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000.0,
            )
            stdout = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            max_out = int(payload.get("max_chars") or 120_000)
            if len(stdout) > max_out:
                stdout = stdout[:max_out] + "\n…(truncated)…\n"
            if len(stderr) > max_out:
                stderr = stderr[:max_out] + "\n…(truncated)…\n"

            _json_response(
                handler,
                200,
                {
                    "ok": True,
                    "command": command,
                    "exit_code": int(result.returncode),
                    "stdout": stdout,
                    "stderr": stderr,
                    "cwd": str(WORKSPACE_ROOT),
                },
            )
            return

        _json_response(handler, 404, {"error": f"Unknown tool: {tool_name}"})
    except subprocess.TimeoutExpired:
        _json_response(handler, 408, {"error": "Command timed out."})
    except ValueError as e:
        _json_response(handler, 400, {"error": str(e)})
    except Exception as e:
        _json_response(handler, 500, {"error": str(e)})


def build_handler(*, upstream: str, tool_token: str):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def end_headers(self) -> None:  # noqa: N802
            _set_cors_headers(self)
            self.send_header("Connection", "close")
            super().end_headers()

        def do_OPTIONS(self):  # noqa: N802
            # Same-origin requests won’t preflight; this is just a safety net.
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def do_GET(self):  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path or self.path
            host_header = (self.headers.get("Host") or "").strip()
            host_only = host_header
            if host_only.startswith("[") and "]" in host_only:
                host_only = host_only[1:].split("]", 1)[0]
            else:
                host_only = host_only.split(":", 1)[0]
            if host_only in ("127.0.0.1", "::1") and path in ("/", "/Homepage", "/Homepage.html"):
                try:
                    _, port = self.server.server_address[:2]
                except Exception:
                    port = 8000
                loc = f"http://localhost:{int(port)}/" + (("?" + parsed.query) if parsed.query else "")
                self.send_response(302)
                self.send_header("Location", loc)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            if path in ("/Homepage.html", "/Homepage"):
                loc = "/" + (("?" + parsed.query) if parsed.query else "")
                self.send_response(302)
                self.send_header("Location", loc)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return

            if self.path in ("/", "/Homepage", "/Homepage.html"):
                _serve_file(self, SITE_ROOT / "Homepage.html", tool_token=tool_token)
                return

            if self.path == "/emoji-palette.json":
                _serve_file(self, SITE_ROOT / "emoji-palette.json")
                return

            if self.path == "/health":
                _handle_health(self, upstream)
                return

            if self.path == "/server/info":
                try:
                    host, port = self.server.server_address[:2]
                except Exception:
                    host, port = "", 0
                lan_enabled = str(host) in ("0.0.0.0", "::")
                ip = _compute_local_ipv4()
                iphone_url = f"http://{ip}:{port}/Homepage.html" if ip and port else ""
                config = _load_server_config()
                _json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "instance_id": str(SERVER_INSTANCE_ID),
                        "lan_enabled": lan_enabled,
                        "lan_preference": bool(config.get("lan")) if isinstance(config, dict) else None,
                        "host": str(host),
                        "port": int(port) if port else None,
                        "iphone_url": iphone_url,
                    },
                )
                return

            if self.path == "/server/prefs":
                client_host = ""
                try:
                    client_host = str(self.client_address[0] if self.client_address else "")
                except Exception:
                    client_host = ""
                if not _is_loopback_addr(client_host):
                    _json_response(self, 403, {"ok": False, "error": "Prefs are only available from localhost."})
                    return
                if not _require_tool_token(self, tool_token):
                    return
                _json_response(self, 200, {"ok": True, "prefs": _read_agentc_defaults()})
                return

            if self.path.startswith("/api/"):
                _proxy_request(upstream=upstream, handler=self, method="GET", path=self.path, body=b"", timeout_s=60)
                return

            if self.path == "/favicon.ico":
                self.send_response(204)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return

            # Static passthrough (best-effort) for local assets.
            rel = self.path.lstrip("/").split("?", 1)[0]
            if rel and not rel.startswith(".") and ".." not in rel:
                candidate = (SITE_ROOT / rel).resolve()
                if str(candidate).startswith(str(SITE_ROOT.resolve()) + os.sep) and candidate.is_file():
                    _serve_file(self, candidate)
                    return

            _text_response(self, 404, "not found\n", "text/plain; charset=utf-8")

        def do_POST(self):  # noqa: N802
            body = _read_request_body(self)
            path = self.path.split("?", 1)[0]

            if path == "/server/lan":
                client_host = ""
                try:
                    client_host = str(self.client_address[0] if self.client_address else "")
                except Exception:
                    client_host = ""
                if not _is_loopback_addr(client_host):
                    _json_response(self, 403, {"error": "LAN settings can only be changed from localhost."})
                    return
                if not _require_tool_token(self, tool_token):
                    return
                try:
                    payload = json.loads(body.decode("utf-8") if body else "{}")
                except Exception:
                    _json_response(self, 400, {"error": "Invalid JSON body."})
                    return
                enabled = bool(payload.get("enabled"))
                config = _load_server_config()
                if not isinstance(config, dict):
                    config = {}
                config["lan"] = enabled
                _save_server_config(config)

                try:
                    host, port = self.server.server_address[:2]
                except Exception:
                    host, port = "127.0.0.1", 8000

                argv = [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--port",
                    str(int(port) if port else 8000),
                    "--host",
                    "127.0.0.1",
                    "--upstream",
                    upstream,
                ]
                if enabled:
                    argv.append("--lan")

                _json_response(self, 200, {"ok": True, "enabled": enabled, "restarting": True})
                _restart_server_async(server=self.server, argv=argv)
                return

            if path == "/server/repair":
                client_host = ""
                try:
                    client_host = str(self.client_address[0] if self.client_address else "")
                except Exception:
                    client_host = ""
                if not _is_loopback_addr(client_host):
                    _json_response(self, 403, {"ok": False, "error": "Repair can only be run from localhost."})
                    return
                if not _require_tool_token(self, tool_token):
                    return
                try:
                    _, port = self.server.server_address[:2]
                except Exception:
                    port = 8000
                out = _repair_agentc_defaults(server_port=int(port) if port else 8000, upstream=upstream)
                out["ui_url"] = f"http://localhost:{int(port) if port else 8000}/"
                _json_response(self, 200, out)
                return

            if path.startswith("/tool/"):
                tool_name = path.removeprefix("/tool/").strip("/")
                _handle_tool(self, tool_token, tool_name, body)
                return

            if path.startswith("/api/"):
                if path.startswith("/api/pull"):
                    _proxy_request_stream(upstream=upstream, handler=self, method="POST", path=path, body=body, timeout_s=300)
                else:
                    _proxy_request(upstream=upstream, handler=self, method="POST", path=path, body=body, timeout_s=300)
                return

            _text_response(self, 404, "not found\n", "text/plain; charset=utf-8")

        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    return Handler


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Local dev server: serves Homepage.html and proxies /api/* to Ollama.")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument(
        "--lan",
        action="store_true",
        help="Bind to all interfaces (0.0.0.0) so you can open the UI from your iPhone on the same Wi‑Fi. Tools remain loopback-only.",
    )
    parser.add_argument("--upstream", default=os.getenv("OLLAMA_UPSTREAM", DEFAULT_UPSTREAM))
    args = parser.parse_args(argv)

    if args.lan:
        args.host = "0.0.0.0"

    raw_host = args.host
    args.host = _sanitize_bind_host(args.host)
    if raw_host and raw_host != args.host:
        sys.stderr.write(f"warning: invalid host {raw_host!r}; using {args.host}\n")
        sys.stderr.flush()

    args.upstream = _normalize_upstream(args.upstream)
    if _upstream_points_to_self(args.upstream, server_port=args.port):
        sys.stderr.write(
            f"warning: upstream {args.upstream} points to this server (port {args.port}); falling back to {DEFAULT_UPSTREAM}\n"
        )
        sys.stderr.flush()
        args.upstream = DEFAULT_UPSTREAM

    try:
        _repair_agentc_defaults(server_port=args.port, upstream=args.upstream)
    except Exception:
        pass

    if _probe_existing_server(args.host, args.port):
        info = _fetch_existing_server_info(args.host, args.port)
        display_host = _canonical_ui_host(args.host)
        msg = (
            "Local dev server running:\n"
            f"  URL: http://{display_host}:{args.port}/Homepage.html\n"
        )
        iphone_url = (info or {}).get("iphone_url")
        if iphone_url:
            msg += f"  iPhone URL: {iphone_url}\n"
        sys.stderr.write(msg)
        sys.stderr.flush()
        return 0

    tool_token = secrets.token_urlsafe(24)
    handler = build_handler(upstream=args.upstream, tool_token=tool_token)
    try:
        server = _make_server(args.host, args.port, handler)
    except OSError as e:
        if getattr(e, "errno", None) == errno.EADDRINUSE:
            sys.stderr.write(
                f"error: port {args.port} is already in use.\n"
                f"If the AgentC UI is already running, open http://localhost:{args.port}/ in your browser.\n"
            )
            sys.stderr.flush()
            return 2
        raise

    lan_url = None
    if args.host in ("0.0.0.0", "::"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                ip = s.getsockname()[0]
            lan_url = f"http://{ip}:{args.port}/Homepage.html"
        except Exception:
            lan_url = None

    msg = (
        "Local dev server running:\n"
        f"  URL: http://{_canonical_ui_host(args.host)}:{args.port}/Homepage.html\n"
    )
    if lan_url:
        msg += f"  iPhone URL: {lan_url}\n"
    msg += f"  Upstream: {args.upstream}\n" f"  Workspace: {WORKSPACE_ROOT}\n"
    sys.stderr.write(msg)
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
