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
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

SCRIPT_PATH = Path(__file__).resolve()
SCRIPT_DIR = SCRIPT_PATH.parent

# Support both repo layout (`scripts/dev_server.py`) and macOS app bundle layout
# (`Contents/Resources/dev_server.py`).
RUNTIME_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name in {"scripts", "bin"} else SCRIPT_DIR
APP_ROOT_OVERRIDE = os.getenv("AGENTC_APP_ROOT") or os.getenv("MK_APP_ROOT") or ""
APP_ROOT = (
    Path(APP_ROOT_OVERRIDE).expanduser().resolve()
    if APP_ROOT_OVERRIDE
    else (
        RUNTIME_ROOT.parent.parent
        if RUNTIME_ROOT.name == "Resources" and RUNTIME_ROOT.parent.name == "Contents"
        else RUNTIME_ROOT.parent
    )
)

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
TELEMETRY_ROOT = (APP_ROOT / "tmp" / "blueprint-telemetry").resolve()
TELEMETRY_FILE = (TELEMETRY_ROOT / "events.jsonl").resolve()


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value and str(value).strip():
            return str(value).strip()
    return ""


def _node_bin() -> str:
    explicit = _first_env("NODE_BIN", "AGENTC_NODE_BIN")
    if explicit:
        return explicit

    detected = shutil.which("node")
    if detected:
        return detected

    for candidate in ("/usr/local/bin/node", "/opt/homebrew/bin/node"):
        if Path(candidate).is_file():
            return candidate

    return "node"


def _telemetry_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"


def _telemetry_trim(value: Any, max_len: int = 240) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:max_len]


def _telemetry_safe_json(value: Any, depth: int = 0) -> Any:
    if value is None:
        return None
    if depth > 4:
        return None
    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > 4000:
            return value[:4000]
        return value
    if isinstance(value, (list, tuple)):
        return [_telemetry_safe_json(item, depth + 1) for item in list(value)[:50]]
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key in list(value.keys())[:50]:
            out[str(key)] = _telemetry_safe_json(value.get(key), depth + 1)
        return out
    return str(value)


def _telemetry_route_id_from_path(path: str) -> str:
    text = _telemetry_trim(path, 400).split("?", 1)[0].strip()
    if not text or text == "/":
        return "root"
    return text.strip("/").replace("/", ".")


def _telemetry_ensure_store() -> None:
    TELEMETRY_ROOT.mkdir(parents=True, exist_ok=True)
    if not TELEMETRY_FILE.exists():
        TELEMETRY_FILE.write_text("", encoding="utf-8")


def _telemetry_emit(event: Dict[str, Any]) -> None:
    try:
        payload = {
            "schemaVersion": "blueprint.telemetry.v1",
            "eventId": _telemetry_trim(event.get("eventId") or secrets.token_hex(16), 120),
            "eventType": _telemetry_trim(event.get("eventType") or "api.request", 120),
            "source": _telemetry_trim(event.get("source") or "browser_proxy", 80),
            "occurredAt": _telemetry_trim(event.get("occurredAt") or _telemetry_now_iso(), 80),
            "verified": False if event.get("verified") is False else True,
        }
        for field in (
            "routeId",
            "routeRunId",
            "taskId",
            "taskState",
            "widgetId",
            "workspaceId",
            "userId",
            "laneId",
            "tabId",
            "host",
            "url",
            "method",
            "outcome",
            "reason",
            "status",
        ):
            value = _telemetry_trim(event.get(field), 1000 if field == "url" else 240)
            if value:
                payload[field] = value
        for field in ("httpStatus", "durationMs", "sampleSize"):
            try:
                raw = event.get(field)
                if raw is None or raw == "":
                    continue
                num = int(raw)
                if num >= 0:
                    payload[field] = num
            except Exception:
                continue
        meta = _telemetry_safe_json(event.get("meta"))
        if isinstance(meta, dict) and meta:
            payload["meta"] = meta

        _telemetry_ensure_store()
        with TELEMETRY_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        return


def _emit_handler_telemetry(
    handler: http.server.BaseHTTPRequestHandler,
    status: int,
    *,
    content_type: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        started_at = float(getattr(handler, "_blueprint_started_at", time.time()))
    except Exception:
        started_at = time.time()
    try:
        raw_path = str(getattr(handler, "path", "") or "")
    except Exception:
        raw_path = ""
    _telemetry_emit(
        {
            "eventType": "api.request",
            "source": "browser_proxy",
            "routeId": _telemetry_route_id_from_path(raw_path),
            "method": str(getattr(handler, "command", "") or ""),
            "httpStatus": int(status),
            "outcome": "failure" if int(status) >= 400 else "success",
            "durationMs": max(0, int((time.time() - started_at) * 1000)),
            "url": raw_path,
            "meta": {
                "contentType": content_type,
                **(meta or {}),
            },
        }
    )


def _open_api_key() -> str:
    return _first_env("open", "OPEN", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPEN_API_KEY", "OPENAI_KEY", "OPENAI_APIKEY")


def _open_api_key_from_header(handler: http.server.BaseHTTPRequestHandler) -> str:
    try:
        return str(handler.headers.get("X-AgentC-OpenAI-Key") or "").strip()
    except Exception:
        return ""


def _effective_open_api_key(handler: http.server.BaseHTTPRequestHandler) -> str:
    return _open_api_key_from_header(handler) or _open_api_key()


def _gateway_api_key() -> str:
    return _first_env("AI_GATEWAY_API_KEY", "AI_GATEWAY_KEY")


def _gateway_mode_enabled() -> bool:
    return bool(_open_api_key() and _gateway_api_key())

def _looks_like_openai_key(api_key: str) -> bool:
    raw = str(api_key or "").strip()
    if not raw:
        return False
    return bool(re.match(r"^sk-(proj-)?", raw, re.IGNORECASE))


def _open_base_url() -> str:
    return (_first_env("OPEN_BASE_URL", "OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")


def _gateway_base_url() -> str:
    explicit = _first_env("AI_GATEWAY_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    key = _gateway_api_key()
    if _looks_like_openai_key(key):
        return "https://api.openai.com/v1"
    return "https://gateway.ai.vercel.com/v1"


def _open_model() -> str:
    return _first_env("OPEN_MODEL", "OPENAI_MODEL", "AI_MODEL") or "gpt-4o-mini"


def _gateway_model() -> str:
    key = _gateway_api_key()
    explicit = _first_env("AI_GATEWAY_MODEL")
    model = explicit or (_first_env("AI_MODEL") or "gpt-4o-mini")
    if not explicit and key and not _looks_like_openai_key(key) and "/" not in model:
        model = f"openai/{model}"
    return model


def _post_json(url: str, payload: Dict[str, Any], *, headers: Dict[str, str], timeout_s: int) -> Tuple[int, bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    for k, v in (headers or {}).items():
        if v:
            req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=float(timeout_s)) as resp:
            raw = resp.read()
            return int(resp.status), raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        return int(e.code), raw


def _extract_chat_content(payload: Any) -> str:
    try:
        content = payload["choices"][0]["message"]["content"]
    except Exception:
        content = ""
    return str(content or "")


def _normalize_browser_url(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if text.startswith("//"):
        text = "https:" + text
    elif re.match(r"^[a-z0-9.-]+\.[a-z]{2,}(/.*)?$", text, re.IGNORECASE):
        text = "https://" + text
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return parsed.geturl()


def _reader_escape(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _reader_fetch(url: str, timeout_s: float = 12.0, max_bytes: int = 1_500_000) -> Tuple[int, str, str, str]:
    req = urllib.request.Request(url, method="GET")
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    )
    req.add_header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    req.add_header("Accept-Language", "en-US,en;q=0.9")
    req.add_header("Cache-Control", "no-cache")

    try:
        with urllib.request.urlopen(req, timeout=float(timeout_s)) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            final_url = str(getattr(resp, "url", url) or url)
            content_type = str(resp.headers.get("Content-Type") or "")
            raw = resp.read(max_bytes + 1)
    except urllib.error.HTTPError as e:
        status = int(getattr(e, "code", 502) or 502)
        final_url = str(getattr(e, "url", url) or url)
        content_type = str(getattr(e, "headers", {}).get("Content-Type", "") if getattr(e, "headers", None) else "")
        raw = e.read(max_bytes + 1)
    except Exception as e:
        return 502, url, "text/plain; charset=utf-8", f"Could not fetch URL: {e}"

    if len(raw) > max_bytes:
        raw = raw[:max_bytes]
    text = raw.decode("utf-8", errors="replace")
    return status, final_url, content_type, text


def _extract_frame_ancestors_values(csp_values: list[str]) -> list[str]:
    out: list[str] = []
    for csp in csp_values or []:
        for directive in str(csp or "").split(";"):
            item = re.sub(r"\s+", " ", directive.strip())
            if not item:
                continue
            if item.lower().startswith("frame-ancestors"):
                value = item[len("frame-ancestors") :].strip()
                if value:
                    out.append(value)
    return out


def _frame_policy_allows_localhost(xfo_value: str, frame_ancestors_values: list[str]) -> Tuple[bool, str]:
    xfo = str(xfo_value or "").strip().lower()
    if xfo:
        if "deny" in xfo:
            return False, "Blocked by X-Frame-Options: DENY."
        if "sameorigin" in xfo:
            return False, "Blocked by X-Frame-Options: SAMEORIGIN."
        if xfo.startswith("allow-from"):
            if ("localhost" not in xfo) and ("127.0.0.1" not in xfo) and ("::1" not in xfo):
                return False, "Blocked by X-Frame-Options ALLOW-FROM policy."

    if frame_ancestors_values:
        for value in frame_ancestors_values:
            tokens = [tok.strip().strip(",") for tok in re.split(r"\s+", str(value or "").strip()) if tok.strip()]
            low_tokens = [tok.lower() for tok in tokens]
            if not low_tokens:
                continue
            if "'none'" in low_tokens:
                return False, "Blocked by CSP frame-ancestors 'none'."
            if "*" in low_tokens:
                return True, "Allowed by CSP frame-ancestors *."
            for tok in low_tokens:
                token = tok.strip("'\"")
                if token in {"http:", "https:"}:
                    return True, "Allowed by CSP scheme source."
                if ("localhost" in token) or ("127.0.0.1" in token) or ("::1" in token):
                    return True, "CSP frame-ancestors allows localhost."
        return False, "Blocked by CSP frame-ancestors."

    return True, "No explicit frame restrictions detected."


def _browser_probe(url: str, timeout_s: float = 10.0) -> Dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    )
    req.add_header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    req.add_header("Accept-Language", "en-US,en;q=0.9")
    req.add_header("Cache-Control", "no-cache")

    status = 0
    final_url = url
    content_type = ""
    xfo_value = ""
    csp_values: list[str] = []
    error_msg = ""

    try:
        with urllib.request.urlopen(req, timeout=float(timeout_s)) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            final_url = str(getattr(resp, "url", url) or url)
            content_type = str(resp.headers.get("Content-Type") or "")
            xfo_value = str(resp.headers.get("X-Frame-Options") or "")
            try:
                csp_values = [str(v).strip() for v in (resp.headers.get_all("Content-Security-Policy") or []) if str(v).strip()]
            except Exception:
                csp_values = []
            if not csp_values:
                single = str(resp.headers.get("Content-Security-Policy") or "").strip()
                if single:
                    csp_values = [single]
            _ = resp.read(4096)
    except urllib.error.HTTPError as e:
        status = int(getattr(e, "code", 502) or 502)
        final_url = str(getattr(e, "url", url) or url)
        headers = getattr(e, "headers", None)
        content_type = str(headers.get("Content-Type") if headers else "") or ""
        xfo_value = str(headers.get("X-Frame-Options") if headers else "") or ""
        try:
            csp_values = [str(v).strip() for v in (headers.get_all("Content-Security-Policy") or []) if str(v).strip()] if headers else []
        except Exception:
            csp_values = []
        if not csp_values:
            single = str(headers.get("Content-Security-Policy") if headers else "") or ""
            if single.strip():
                csp_values = [single.strip()]
        try:
            _ = e.read(2048)
        except Exception:
            pass
    except Exception as e:
        error_msg = f"Could not reach URL: {e}"

    frame_ancestors_values = _extract_frame_ancestors_values(csp_values)
    frame_allowed, reason = _frame_policy_allows_localhost(xfo_value, frame_ancestors_values)

    if error_msg:
        return {
            "ok": False,
            "url": url,
            "final_url": final_url,
            "status": int(status or 0),
            "content_type": content_type,
            "frame_allowed": False,
            "reason": error_msg,
            "x_frame_options": xfo_value,
            "frame_ancestors": " | ".join(frame_ancestors_values),
            "error": error_msg,
        }

    if int(status or 0) >= 400:
        frame_allowed = False
        reason = f"HTTP {int(status)} returned by site."

    return {
        "ok": True,
        "url": url,
        "final_url": final_url,
        "status": int(status or 0),
        "content_type": content_type,
        "frame_allowed": bool(frame_allowed),
        "reason": reason,
        "x_frame_options": xfo_value,
        "frame_ancestors": " | ".join(frame_ancestors_values),
        "error": "",
    }


def _open_url_external(url: str, target: str = "default") -> Tuple[bool, str]:
    target_norm = str(target or "default").strip().lower()
    cmd: list[str]
    if target_norm == "safari":
        cmd = ["open", "-a", "Safari", str(url)]
    else:
        cmd = ["open", str(url)]
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        label = "Safari" if target_norm == "safari" else "default browser"
        return True, f"Opened in {label}."
    except Exception as e:
        return False, f"Could not open URL: {e}"


def _reader_extract_title(html_text: str) -> str:
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html_text or "", re.IGNORECASE)
    if not m:
        return ""
    title = re.sub(r"\s+", " ", m.group(1) or "").strip()
    return title[:240]


def _reader_extract_text(html_text: str) -> str:
    text = str(html_text or "")
    text = re.sub(r"(?is)<script\b[^>]*>[\s\S]*?</script>", " ", text)
    text = re.sub(r"(?is)<style\b[^>]*>[\s\S]*?</style>", " ", text)
    text = re.sub(r"(?is)<noscript\b[^>]*>[\s\S]*?</noscript>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|section|article|h1|h2|h3|h4|h5|h6|li|tr)>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = text.strip()
    return text[:60_000]


def _reader_extract_links(html_text: str, base_url: str, max_links: int = 60) -> list[Tuple[str, str]]:
    out: list[Tuple[str, str]] = []
    seen: set[str] = set()
    for m in re.finditer(r'(?is)<a\b[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', html_text or ""):
        href = str(m.group(1) or "").strip()
        if not href or href.startswith("#") or href.lower().startswith(("javascript:", "mailto:", "tel:")):
            continue
        try:
            full = urljoin(base_url, href)
        except Exception:
            continue
        full = _normalize_browser_url(full)
        if not full or full in seen:
            continue
        label_raw = re.sub(r"(?is)<[^>]+>", " ", str(m.group(2) or ""))
        label = re.sub(r"\s+", " ", label_raw).strip()
        if not label:
            label = full
        label = label[:180]
        seen.add(full)
        out.append((label, full))
        if len(out) >= max_links:
            break
    return out


def _reader_render_html(src_url: str, status: int, final_url: str, content_type: str, raw_html: str) -> str:
    title = _reader_extract_title(raw_html) or final_url or src_url
    summary = _reader_extract_text(raw_html)
    links = _reader_extract_links(raw_html, final_url or src_url)

    links_html = ""
    if links:
        parts = []
        for label, link in links:
            q = quote(link, safe="")
            parts.append(
                f'<li><a href="/browser/read?url={q}" target="_self">{_reader_escape(label)}</a>'
                f'<span class="u">{_reader_escape(link)}</span></li>'
            )
        links_html = "<h3>Links</h3><ul>" + "".join(parts) + "</ul>"

    body = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reader: {_reader_escape(title)}</title>
  <style>
    :root {{
      --bg: #071c33;
      --panel: #0b2746;
      --ink: #d8f1ff;
      --muted: #8db9d7;
      --line: rgba(127, 202, 248, 0.28);
      --accent: #7de4ff;
    }}
    html, body {{ margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    .wrap {{ max-width: 980px; margin: 0 auto; padding: 14px; }}
    .card {{ border: 1px solid var(--line); border-radius: 12px; background: var(--panel); padding: 12px; }}
    h1 {{ margin: 0 0 8px; font-size: 20px; line-height: 1.25; }}
    h3 {{ margin: 16px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }}
    .meta {{ color: var(--muted); font-size: 12px; margin-bottom: 10px; }}
    .txt {{ white-space: pre-wrap; line-height: 1.55; font-size: 14px; }}
    ul {{ margin: 0; padding-left: 18px; display: grid; gap: 8px; }}
    a {{ color: var(--accent); word-break: break-all; }}
    .u {{ display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }}
    .warn {{ margin-top: 8px; color: #ffd88b; font-size: 12px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>{_reader_escape(title)}</h1>
      <div class="meta">Source: {_reader_escape(final_url or src_url)} | HTTP {status} | Content-Type: {_reader_escape(content_type or "unknown")}</div>
      <div class="txt">{_reader_escape(summary or "No readable content extracted.")}</div>
      {links_html}
      <div class="warn">Reader mode strips active scripts for reliability. For full app behavior, use Open External.</div>
    </div>
  </div>
</body>
</html>"""
    return body


def _mirror_rewrite_links(html_text: str, base_url: str, *, allow_scripts: bool = False) -> str:
    source = str(html_text or "")

    def _rewrite_anchor_tag(match: re.Match[str]) -> str:
        tag = str(match.group(0) or "")

        def _rewrite_href(attr_match: re.Match[str]) -> str:
            quote_char = str(attr_match.group(1) or '"')
            raw_href = str(attr_match.group(2) or "").strip()
            if not raw_href or raw_href.startswith("#") or raw_href.lower().startswith(("javascript:", "mailto:", "tel:")):
                return str(attr_match.group(0) or "")
            try:
                full = urljoin(base_url, raw_href)
            except Exception:
                return str(attr_match.group(0) or "")
            norm = _normalize_browser_url(full)
            if not norm:
                return str(attr_match.group(0) or "")
            scripts_flag = "1" if allow_scripts else "0"
            proxy_href = f"/browser/mirror?url={quote(norm, safe='')}&scripts={scripts_flag}"
            return f"href={quote_char}{proxy_href}{quote_char}"

        rewritten = re.sub(r'(?is)\bhref\s*=\s*(["\'])(.*?)\1', _rewrite_href, tag, count=1)
        rewritten = re.sub(r'(?is)\btarget\s*=\s*(["\']).*?\1', "", rewritten)
        return rewritten

    return re.sub(r"(?is)<a\b[^>]*>", _rewrite_anchor_tag, source)


def _mirror_render_html(
    src_url: str, status: int, final_url: str, content_type: str, raw_html: str, *, allow_scripts: bool = False
) -> str:
    target = final_url or src_url
    if not target:
        target = src_url
    target = _normalize_browser_url(target) or src_url
    if not target:
        return _reader_render_html(src_url, status, final_url, content_type, raw_html)

    html_text = str(raw_html or "")
    if "<html" not in html_text.lower():
        fallback = _reader_render_html(src_url, status, final_url, content_type, raw_html)
        return fallback

    # In lite mode we remove active scripts to maximize reliability.
    if not allow_scripts:
        html_text = re.sub(r"(?is)<script\b[^>]*>[\s\S]*?</script>", "", html_text)
        html_text = re.sub(r"(?is)<script\b[^>]*/\s*>", "", html_text)
    html_text = re.sub(r'(?is)<meta[^>]+http-equiv\s*=\s*["\']content-security-policy["\'][^>]*>', "", html_text)
    html_text = _mirror_rewrite_links(html_text, target, allow_scripts=allow_scripts)

    scripts_flag = "1" if allow_scripts else "0"
    toggle_flag = "0" if allow_scripts else "1"
    toggle_label = "Mirror Lite" if allow_scripts else "Mirror Interactive"
    mode_label = "Mirror Interactive" if allow_scripts else "Mirror Mode"

    toolbar = (
        '<div id="agentc-mirror-toolbar">'
        f"<strong>{mode_label}</strong>"
        f'<span class="meta">Source: <a href="{_reader_escape(target)}" target="_blank" rel="noopener noreferrer">{_reader_escape(target)}</a> | HTTP {int(status)} | {_reader_escape(content_type or "unknown")}</span>'
        '<span class="actions">'
        f'<a href="/browser/mirror?url={quote(target, safe="")}&scripts={toggle_flag}" target="_self">{toggle_label}</a>'
        f'<a href="/browser/read?url={quote(target, safe="")}" target="_self">Reader</a>'
        f'<a href="{_reader_escape(target)}" target="_blank" rel="noopener noreferrer">Open Site</a>'
        "</span>"
        "</div>"
    )
    style_block = """
<style id="agentc-mirror-style">
  #agentc-mirror-toolbar{position:sticky;top:0;z-index:2147483647;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 12px;background:#071c33;color:#d8f1ff;border-bottom:1px solid rgba(127,202,248,.28);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #agentc-mirror-toolbar .meta{opacity:.9}
  #agentc-mirror-toolbar a{color:#7de4ff;text-decoration:none}
  #agentc-mirror-toolbar a:hover{text-decoration:underline}
  #agentc-mirror-toolbar .actions{margin-left:auto;display:inline-flex;gap:10px}
</style>
"""
    mode_hint = (
        "Interactive keeps site scripts enabled for fuller rendering."
        if allow_scripts
        else "Lite mode strips scripts for reliability if interactive rendering fails."
    )
    mode_hint_block = (
        f'<div id="agentc-mirror-mode-hint" data-agentc-mirror-scripts="{scripts_flag}" '
        'style="font:11px/1.35 -apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif;'
        'color:#8db9d7;background:rgba(7,28,51,.88);padding:6px 12px;border-bottom:1px solid rgba(127,202,248,.2)">'
        f"{_reader_escape(mode_hint)}"
        "</div>"
    )

    if re.search(r"(?is)<head\b", html_text):
        html_text = re.sub(r"(?is)<head\b[^>]*>", lambda m: str(m.group(0)) + f'<base href="{_reader_escape(target)}" />' + style_block, html_text, count=1)
    else:
        html_text = f"<head><base href=\"{_reader_escape(target)}\" />{style_block}</head>" + html_text

    if re.search(r"(?is)<body\b", html_text):
        html_text = re.sub(r"(?is)<body\b[^>]*>", lambda m: str(m.group(0)) + toolbar + mode_hint_block, html_text, count=1)
    else:
        html_text += toolbar + mode_hint_block

    return html_text


def _browser_context_payload(target_url: str, max_chars: int = 12_000) -> Dict[str, Any]:
    status, final_url, content_type, raw_html = _reader_fetch(target_url, max_bytes=2_000_000)
    title = _reader_extract_title(raw_html)
    text = _reader_extract_text(raw_html)
    excerpt = str(text or "").strip()[: int(max(800, min(50_000, max_chars)))]
    if not excerpt:
        excerpt = str(raw_html or "").strip()[:2000]
    err = ""
    if int(status or 0) >= 400:
        err = f"Source returned HTTP {int(status)}."
    if (str(content_type or "").lower().startswith("text/plain")) and str(raw_html or "").lower().startswith("could not fetch url:"):
        err = str(raw_html or "").strip()
    return {
        "ok": not bool(err),
        "url": str(target_url),
        "final_url": str(final_url or target_url),
        "status": int(status or 0),
        "content_type": str(content_type or ""),
        "title": str(title or ""),
        "text": excerpt,
        "error": err,
    }


def _handle_gateway_chat(handler: http.server.BaseHTTPRequestHandler, body: bytes, open_key: str = "") -> None:
    open_key = str(open_key or _effective_open_api_key(handler)).strip()
    gateway_key = _gateway_api_key()
    if not open_key:
        _json_response(handler, 500, {"error": "Missing OpenAI key (set `open`/`OPENAI_API_KEY` or send `X-AgentC-OpenAI-Key`)."})
        return
    if not gateway_key:
        _json_response(handler, 500, {"error": "Missing AI_GATEWAY_API_KEY."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        _json_response(handler, 400, {"error": "Missing messages[]"})
        return

    options = payload.get("options") if isinstance(payload, dict) else None
    temperature = 0.2
    max_tokens = None
    if isinstance(options, dict):
        if isinstance(options.get("temperature"), (int, float)):
            temperature = float(options.get("temperature"))
        if isinstance(options.get("num_predict"), int):
            max_tokens = int(options.get("num_predict"))

    requested_model = str(payload.get("model") or "").strip()
    open_model = requested_model or _open_model()

    timeout_s = int(os.getenv("OPEN_TIMEOUT_S") or "30")

    open_url = _open_base_url() + "/chat/completions"
    open_status, open_raw = _post_json(
        open_url,
        {
            "model": open_model,
            "messages": messages,
            "temperature": temperature,
            **({"max_tokens": max_tokens} if isinstance(max_tokens, int) and max_tokens > 0 else {}),
        },
        headers={"Authorization": f"Bearer {open_key}"},
        timeout_s=timeout_s,
    )
    try:
        open_json = json.loads(open_raw.decode("utf-8") if open_raw else "{}")
    except Exception:
        open_json = {}
    if open_status < 200 or open_status >= 300:
        _json_response(handler, int(open_status), {"error": "OpenAI upstream error", "details": open_json})
        return

    open_text = _extract_chat_content(open_json)

    gateway_model = _gateway_model()
    gateway_url = _gateway_base_url() + "/chat/completions"
    gateway_status, gateway_raw = _post_json(
        gateway_url,
        {
            "model": gateway_model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are AI Gateway. Evaluate the candidate assistant response for correctness, safety, and "
                        "usefulness; then provide a best-possible final answer. Output plain text only in this exact "
                        "format:\nEVAL:\n- <bullets>\n\nFINAL:\n<answer>"
                    ),
                },
                {
                    "role": "user",
                    "content": f"Conversation messages:\n{json.dumps(messages, ensure_ascii=False, indent=2)}\n\n"
                    f"Candidate assistant response:\n{open_text}",
                },
            ],
            "temperature": 0.2,
        },
        headers={"Authorization": f"Bearer {gateway_key}"},
        timeout_s=timeout_s,
    )
    try:
        gateway_json = json.loads(gateway_raw.decode("utf-8") if gateway_raw else "{}")
    except Exception:
        gateway_json = {}
    if gateway_status < 200 or gateway_status >= 300:
        # Fail-open: return the OpenAI candidate if the evaluator is misconfigured or down.
        _json_response(
            handler,
            200,
            {
                "message": {"role": "assistant", "content": open_text},
                "open": {"model": open_model, "content": open_text},
                "gateway_error": {"status": int(gateway_status), "details": gateway_json},
            },
        )
        return

    gateway_text = _extract_chat_content(gateway_json)
    _json_response(
        handler,
        200,
        {
            "message": {"role": "assistant", "content": gateway_text},
            "open": {"model": open_model, "content": open_text},
            "gateway": {"model": gateway_model, "content": gateway_text},
        },
    )


def _handle_open_chat(handler: http.server.BaseHTTPRequestHandler, body: bytes, open_key: str = "") -> None:
    open_key = str(open_key or _effective_open_api_key(handler)).strip()
    if not open_key:
        _json_response(handler, 500, {"error": "Missing OpenAI key (set `open`/`OPENAI_API_KEY` or send `X-AgentC-OpenAI-Key`)."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    messages = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(messages, list) or not messages:
        _json_response(handler, 400, {"error": "Missing messages[]"})
        return

    options = payload.get("options") if isinstance(payload, dict) else None
    temperature = 0.2
    max_tokens = None
    if isinstance(options, dict):
        if isinstance(options.get("temperature"), (int, float)):
            temperature = float(options.get("temperature"))
        if isinstance(options.get("num_predict"), int):
            max_tokens = int(options.get("num_predict"))

    requested_model = str(payload.get("model") or "").strip() if isinstance(payload, dict) else ""
    open_model = requested_model or _open_model()
    timeout_s = int(os.getenv("OPEN_TIMEOUT_S") or "30")

    open_url = _open_base_url() + "/chat/completions"
    open_status, open_raw = _post_json(
        open_url,
        {
            "model": open_model,
            "messages": messages,
            "temperature": temperature,
            **({"max_tokens": max_tokens} if isinstance(max_tokens, int) and max_tokens > 0 else {}),
        },
        headers={"Authorization": f"Bearer {open_key}"},
        timeout_s=timeout_s,
    )
    try:
        open_json = json.loads(open_raw.decode("utf-8") if open_raw else "{}")
    except Exception:
        open_json = {}
    if open_status < 200 or open_status >= 300:
        _json_response(handler, int(open_status), {"error": "OpenAI upstream error", "details": open_json})
        return

    open_text = _extract_chat_content(open_json)
    _json_response(
        handler,
        200,
        {"message": {"role": "assistant", "content": open_text}, "open": {"model": open_model, "content": open_text}},
    )


def _handle_gateway_tags(handler: http.server.BaseHTTPRequestHandler) -> None:
    model = _open_model()
    _json_response(
        handler,
        200,
        {
            "models": [
                {
                    "name": model,
                    "model": model,
                    "size": 0,
                    "details": {"families": []},
                }
            ]
        },
    )


def _handle_gateway_prompt(handler: http.server.BaseHTTPRequestHandler, body: bytes, open_key: str = "") -> None:
    open_key = str(open_key or _effective_open_api_key(handler)).strip()
    gateway_key = _gateway_api_key()
    if not open_key:
        _json_response(handler, 500, {"error": "Missing OpenAI key (set `open`/`OPENAI_API_KEY` or send `X-AgentC-OpenAI-Key`)."})
        return
    if not gateway_key:
        _json_response(handler, 500, {"error": "Missing AI_GATEWAY_API_KEY."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not isinstance(prompt, str) or not prompt.strip():
        _json_response(handler, 400, {"error": "Missing prompt"})
        return

    timeout_s = int(os.getenv("OPEN_TIMEOUT_S") or "30")
    open_model = _open_model()

    open_url = _open_base_url() + "/chat/completions"
    open_status, open_raw = _post_json(
        open_url,
        {
            "model": open_model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a concise assistant. Return a short, direct answer with no markdown unless asked.",
                },
                {"role": "user", "content": prompt.strip()},
            ],
            "temperature": 0.2,
        },
        headers={"Authorization": f"Bearer {open_key}"},
        timeout_s=timeout_s,
    )
    try:
        open_json = json.loads(open_raw.decode("utf-8") if open_raw else "{}")
    except Exception:
        open_json = {}
    if open_status < 200 or open_status >= 300:
        _json_response(handler, int(open_status), {"error": "OpenAI upstream error", "details": open_json})
        return

    open_text = _extract_chat_content(open_json)

    gateway_model = _gateway_model()
    gateway_url = _gateway_base_url() + "/chat/completions"
    gateway_status, gateway_raw = _post_json(
        gateway_url,
        {
            "model": gateway_model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are AI Gateway. Evaluate the candidate assistant response for correctness, safety, and "
                        "usefulness; then provide a best-possible final answer. Output plain text only in this exact "
                        "format:\nEVAL:\n- <bullets>\n\nFINAL:\n<answer>"
                    ),
                },
                {
                    "role": "user",
                    "content": f"User prompt:\n{prompt.strip()}\n\nCandidate assistant response:\n{open_text}",
                },
            ],
            "temperature": 0.2,
        },
        headers={"Authorization": f"Bearer {gateway_key}"},
        timeout_s=timeout_s,
    )
    try:
        gateway_json = json.loads(gateway_raw.decode("utf-8") if gateway_raw else "{}")
    except Exception:
        gateway_json = {}
    if gateway_status < 200 or gateway_status >= 300:
        # Fail-open: return the OpenAI candidate if the evaluator is misconfigured or down.
        _json_response(
            handler,
            200,
            {
                "text": open_text,
                "open_text": open_text,
                "gateway_error": {"status": int(gateway_status), "details": gateway_json},
            },
        )
        return

    gateway_text = _extract_chat_content(gateway_json)
    _json_response(handler, 200, {"text": gateway_text, "open_text": open_text})


def _handle_open_prompt(handler: http.server.BaseHTTPRequestHandler, body: bytes, open_key: str = "") -> None:
    open_key = str(open_key or _effective_open_api_key(handler)).strip()
    if not open_key:
        _json_response(handler, 500, {"error": "Missing OpenAI key (set `open`/`OPENAI_API_KEY` or send `X-AgentC-OpenAI-Key`)."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not isinstance(prompt, str) or not prompt.strip():
        _json_response(handler, 400, {"error": "Missing prompt"})
        return

    timeout_s = int(os.getenv("OPEN_TIMEOUT_S") or "30")
    open_model = _open_model()
    open_url = _open_base_url() + "/chat/completions"
    open_status, open_raw = _post_json(
        open_url,
        {
            "model": open_model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a concise assistant. Return a short, direct answer with no markdown unless asked.",
                },
                {"role": "user", "content": prompt.strip()},
            ],
            "temperature": 0.2,
        },
        headers={"Authorization": f"Bearer {open_key}"},
        timeout_s=timeout_s,
    )
    try:
        open_json = json.loads(open_raw.decode("utf-8") if open_raw else "{}")
    except Exception:
        open_json = {}
    if open_status < 200 or open_status >= 300:
        _json_response(handler, int(open_status), {"error": "OpenAI upstream error", "details": open_json})
        return

    open_text = _extract_chat_content(open_json)
    _json_response(handler, 200, {"text": open_text, "open_text": open_text})


def _handle_magic_wallet(handler: http.server.BaseHTTPRequestHandler, body: bytes) -> None:
    client_host = ""
    try:
        client_host = str(handler.client_address[0] if handler.client_address else "")
    except Exception:
        client_host = ""
    if not _is_loopback_addr(client_host):
        _json_response(handler, 403, {"error": "Magic wallet endpoint is only available from localhost."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"error": "Invalid JSON body."})
        return

    jwt = payload.get("jwt") if isinstance(payload, dict) else None
    if not isinstance(jwt, str) or not jwt.strip():
        _json_response(handler, 400, {"error": "Missing jwt"})
        return

    magic_secret_key = os.getenv("MAGIC_SECRET_KEY") or os.getenv("X_MAGIC_SECRET_KEY") or ""
    magic_publishable_key = os.getenv("MAGIC_PUBLISHABLE_KEY") or os.getenv("MAGIC_API_KEY") or ""
    if not magic_secret_key and not magic_publishable_key:
        _json_response(handler, 500, {"error": "Missing MAGIC_SECRET_KEY (preferred) or MAGIC_PUBLISHABLE_KEY."})
        return

    provider_id = (
        (payload.get("provider_id") if isinstance(payload, dict) else None)
        or os.getenv("MAGIC_PROVIDER_ID")
        or os.getenv("OIDC_PROVIDER_ID")
        or ""
    )
    provider_id = str(provider_id).strip()
    if not provider_id:
        _json_response(handler, 500, {"error": "Missing MAGIC_PROVIDER_ID (or OIDC_PROVIDER_ID)."})
        return

    chain = str((payload.get("chain") if isinstance(payload, dict) else None) or os.getenv("MAGIC_CHAIN") or "ETH").strip() or "ETH"
    target = "https://tee.express.magiclabs.com/v1/wallet"

    req = urllib.request.Request(target, data=b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("Authorization", f"Bearer {jwt.strip()}")
    if magic_secret_key:
        req.add_header("X-Magic-Secret-Key", str(magic_secret_key).strip())
    else:
        req.add_header("X-Magic-API-Key", str(magic_publishable_key).strip())
    req.add_header("X-OIDC-Provider-ID", provider_id)
    req.add_header("X-Magic-Chain", chain)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except Exception as e:
        _json_response(handler, 502, {"error": str(e)})
        return

    handler.send_response(int(status))
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)


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
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, X-MK-Tool-Token, X-AgentC-OpenAI-Key")
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
    _emit_handler_telemetry(
        handler,
        status,
        content_type="application/json; charset=utf-8",
        meta={"payloadKeys": list(payload.keys())[:20] if isinstance(payload, dict) else []},
    )


def _text_response(handler: http.server.BaseHTTPRequestHandler, status: int, text: str, content_type: str) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)
    _emit_handler_telemetry(handler, status, content_type=content_type)


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
    _emit_handler_telemetry(
        handler,
        status,
        content_type=headers.get("Content-Type", "application/json"),
        meta={"proxied": True, "target": target},
    )


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
    _emit_handler_telemetry(
        handler,
        status,
        content_type=headers.get("Content-Type", "application/json"),
        meta={"proxied": True, "stream": True, "target": target},
    )
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
    if _gateway_mode_enabled():
        _json_response(handler, 200, {"ok": True, "mode": "gateway"})
        return
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
    assigns = [f"window.__MK_TOOL_TOKEN={json.dumps(token)};"]
    magic_pk = os.getenv("MAGIC_PUBLISHABLE_KEY") or os.getenv("MAGIC_API_KEY") or ""
    magic_provider_id = os.getenv("MAGIC_PROVIDER_ID") or os.getenv("OIDC_PROVIDER_ID") or ""
    magic_chain = os.getenv("MAGIC_CHAIN") or ""
    if magic_pk:
        assigns.append(f"window.__MAGIC_PUBLISHABLE_KEY={json.dumps(str(magic_pk).strip())};")
    if magic_provider_id:
        assigns.append(f"window.__MAGIC_PROVIDER_ID={json.dumps(str(magic_provider_id).strip())};")
    if magic_chain:
        assigns.append(f"window.__MAGIC_CHAIN={json.dumps(str(magic_chain).strip())};")
    injection = f'<script>{"".join(assigns)}</script>'
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


def _handle_blueprint_stove_session(handler: http.server.BaseHTTPRequestHandler, tool_token: str, body: bytes) -> None:
    client_host = ""
    try:
        client_host = str(handler.client_address[0] if handler.client_address else "")
    except Exception:
        client_host = ""
    if not _is_loopback_addr(client_host):
        _json_response(handler, 403, {"ok": False, "error": "Stove compile is only available from this machine."})
        return

    if not _require_tool_token(handler, tool_token):
        return

    node_script = (APP_ROOT / "lib" / "blueprint" / "bin" / "compile_widget_session.js").resolve()
    if not node_script.is_file():
        _json_response(handler, 404, {"ok": False, "error": "Local Stove compiler is unavailable."})
        return

    try:
        payload = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        _json_response(handler, 400, {"ok": False, "error": "Invalid JSON body."})
        return

    try:
        proc = subprocess.run(
            [_node_bin(), str(node_script)],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            cwd=str(APP_ROOT),
        )
    except subprocess.TimeoutExpired:
        _json_response(handler, 504, {"ok": False, "error": "Local Stove compile timed out."})
        return
    except FileNotFoundError:
        _json_response(handler, 500, {"ok": False, "error": "Node runtime is unavailable for Stove compile."})
        return

    raw = proc.stdout.decode("utf-8", "replace").strip()
    try:
        result = json.loads(raw or "{}")
    except Exception:
        stderr_text = proc.stderr.decode("utf-8", "replace").strip()
        _json_response(
            handler,
            500,
            {
                "ok": False,
                "error": "Invalid Stove compiler response.",
                "details": stderr_text[:800],
            },
        )
        return

    status = int(result.get("status") or (200 if result.get("ok") else 500))
    if proc.returncode != 0 and status < 400:
        status = 500
    _json_response(handler, status, result)


def _handle_local_node_api(handler: http.server.BaseHTTPRequestHandler, *, body: bytes, method: str) -> bool:
    node_script = (APP_ROOT / "lib" / "blueprint" / "bin" / "invoke_api_route.js").resolve()
    if not node_script.is_file():
        return False

    try:
        body_text = body.decode("utf-8", "replace") if body else ""
    except Exception:
        body_text = ""

    content_type = ""
    try:
        content_type = str(handler.headers.get("Content-Type") or "").strip().lower()
    except Exception:
        content_type = ""

    parsed_body: Any = None
    if body_text:
        if content_type.startswith("application/json"):
            try:
                parsed_body = json.loads(body_text)
            except Exception:
                parsed_body = None
        else:
            parsed_body = body_text

    payload = {
        "method": str(method or "GET").upper(),
        "path": str(handler.path.split("?", 1)[0] if getattr(handler, "path", "") else ""),
        "url": str(getattr(handler, "path", "") or ""),
        "headers": {str(k).lower(): str(v) for k, v in handler.headers.items()},
        "body": parsed_body,
        "bodyRaw": body_text,
    }

    try:
        proc = subprocess.run(
            [_node_bin(), str(node_script)],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            cwd=str(APP_ROOT),
        )
    except subprocess.TimeoutExpired:
        _json_response(handler, 504, {"ok": False, "error": "Local API route timed out."})
        return True
    except FileNotFoundError:
        _json_response(handler, 500, {"ok": False, "error": "Node runtime is unavailable for local API routes."})
        return True

    raw = proc.stdout.decode("utf-8", "replace").strip()
    try:
        result = json.loads(raw or "{}")
    except Exception:
        _json_response(
            handler,
            500,
            {
                "ok": False,
                "error": "Invalid local API bridge response.",
                "details": proc.stderr.decode("utf-8", "replace").strip()[:800],
            },
        )
        return True

    if not result.get("handled"):
        return False

    status = int(result.get("statusCode") or (200 if result.get("ok") else 500))
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    handler.send_response(status)
    for key, value in headers.items():
        if value is None:
            continue
        header_name = "-".join(part.capitalize() for part in str(key).split("-") if part)
        if isinstance(value, list):
            for item in value:
                handler.send_header(header_name, str(item))
        else:
            handler.send_header(header_name, str(value))
    if "cache-control" not in {str(k).lower() for k in headers.keys()}:
        handler.send_header("Cache-Control", "no-store")
    body_out = result.get("body")
    if body_out is None:
        body_bytes = b""
    elif isinstance(body_out, str):
        body_bytes = body_out.encode("utf-8")
    else:
        body_bytes = json.dumps(body_out, ensure_ascii=False).encode("utf-8")
    if "content-length" not in {str(k).lower() for k in headers.keys()}:
        handler.send_header("Content-Length", str(len(body_bytes)))
    handler.end_headers()
    if body_bytes:
        handler.wfile.write(body_bytes)
    return True


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
            self._blueprint_started_at = time.time()
            parsed = urlparse(self.path)
            path = parsed.path or self.path
            host_header = (self.headers.get("Host") or "").strip()
            host_only = host_header
            if host_only.startswith("[") and "]" in host_only:
                host_only = host_only[1:].split("]", 1)[0]
            else:
                host_only = host_only.split(":", 1)[0]
            if host_only in ("127.0.0.1", "::1") and path in ("/", "/Homepage", "/Homepage.html", "/Contents/Resources/Homepage.html"):
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
            if path in ("/Homepage.html", "/Homepage", "/Contents/Resources/Homepage.html", "/public/Contents/Resources/Homepage.html"):
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

            if path == "/browser/probe":
                params = parse_qs(parsed.query or "")
                raw_url = ""
                try:
                    raw_url = str((params.get("url") or [""])[0] or "").strip()
                except Exception:
                    raw_url = ""
                target_url = _normalize_browser_url(raw_url)
                if not target_url:
                    _json_response(
                        self,
                        400,
                        {
                            "ok": False,
                            "error": "Invalid URL. Use http(s) URL.",
                            "frame_allowed": False,
                        },
                    )
                    return
                _json_response(self, 200, _browser_probe(target_url))
                return

            if path == "/browser/context":
                params = parse_qs(parsed.query or "")
                raw_url = ""
                max_chars = 12_000
                try:
                    raw_url = str((params.get("url") or [""])[0] or "").strip()
                except Exception:
                    raw_url = ""
                try:
                    max_chars = int(str((params.get("max_chars") or ["12000"])[0] or "12000").strip())
                except Exception:
                    max_chars = 12_000
                max_chars = max(800, min(50_000, max_chars))
                target_url = _normalize_browser_url(raw_url)
                if not target_url:
                    _json_response(
                        self,
                        400,
                        {
                            "ok": False,
                            "error": "Invalid URL. Use http(s) URL, for example /browser/context?url=https%3A%2F%2Fexample.com",
                        },
                    )
                    return
                payload = _browser_context_payload(target_url, max_chars=max_chars)
                _json_response(self, 200, payload)
                return

            if path == "/browser/read":
                params = parse_qs(parsed.query or "")
                raw_url = ""
                try:
                    raw_url = str((params.get("url") or [""])[0] or "").strip()
                except Exception:
                    raw_url = ""
                target_url = _normalize_browser_url(raw_url)
                if not target_url:
                    _text_response(
                        self,
                        400,
                        "Invalid URL. Use http(s) URL, for example /browser/read?url=https%3A%2F%2Fexample.com",
                        "text/plain; charset=utf-8",
                    )
                    return
                status, final_url, content_type, raw_html = _reader_fetch(target_url)
                html = _reader_render_html(target_url, status, final_url, content_type, raw_html)
                _text_response(self, 200, html, "text/html; charset=utf-8")
                return

            if path == "/browser/mirror":
                params = parse_qs(parsed.query or "")
                raw_url = ""
                allow_scripts = True
                try:
                    raw_url = str((params.get("url") or [""])[0] or "").strip()
                except Exception:
                    raw_url = ""
                try:
                    raw_scripts = str((params.get("scripts") or ["1"])[0] or "1").strip().lower()
                except Exception:
                    raw_scripts = "1"
                if raw_scripts in {"0", "false", "off", "no"}:
                    allow_scripts = False
                target_url = _normalize_browser_url(raw_url)
                if not target_url:
                    _text_response(
                        self,
                        400,
                        "Invalid URL. Use http(s) URL, for example /browser/mirror?url=https%3A%2F%2Fexample.com",
                        "text/plain; charset=utf-8",
                    )
                    return
                status, final_url, content_type, raw_html = _reader_fetch(target_url, max_bytes=2_500_000)
                html = _mirror_render_html(
                    target_url, status, final_url, content_type, raw_html, allow_scripts=allow_scripts
                )
                _text_response(self, 200, html, "text/html; charset=utf-8")
                return

            if path == "/browser/open":
                client_host = ""
                try:
                    client_host = str(self.client_address[0] if self.client_address else "")
                except Exception:
                    client_host = ""
                if not _is_loopback_addr(client_host):
                    _json_response(self, 403, {"ok": False, "error": "Browser open is only available from localhost."})
                    return

                params = parse_qs(parsed.query or "")
                raw_url = ""
                target = "default"
                try:
                    raw_url = str((params.get("url") or [""])[0] or "").strip()
                except Exception:
                    raw_url = ""
                try:
                    target = str((params.get("target") or ["default"])[0] or "default").strip().lower()
                except Exception:
                    target = "default"
                if target not in {"default", "safari"}:
                    target = "default"

                target_url = _normalize_browser_url(raw_url)
                if not target_url:
                    _json_response(self, 400, {"ok": False, "error": "Invalid URL. Use http(s) URL."})
                    return

                ok, message = _open_url_external(target_url, target=target)
                if not ok:
                    _json_response(self, 500, {"ok": False, "error": message})
                    return
                _json_response(self, 200, {"ok": True, "message": message, "target": target, "url": target_url})
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

            if path == "/api/tags" and _effective_open_api_key(self):
                _handle_gateway_tags(self)
                return

            if path == "/api/version" and _effective_open_api_key(self):
                mode = "gateway" if _gateway_api_key() else "open"
                _json_response(self, 200, {"ok": True, "version": mode})
                return

            if self.path.startswith("/api/"):
                if _handle_local_node_api(self, body=b"", method="GET"):
                    return
                _proxy_request(upstream=upstream, handler=self, method="GET", path=self.path, body=b"", timeout_s=60)
                return

            if self.path == "/favicon.ico":
                self.send_response(204)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return

            # Static passthrough (best-effort) for local assets.
            rel = unquote(self.path.lstrip("/").split("?", 1)[0])
            if rel and not rel.startswith(".") and ".." not in rel:
                candidate = (SITE_ROOT / rel).resolve()
                if str(candidate).startswith(str(SITE_ROOT.resolve()) + os.sep) and candidate.is_file():
                    _serve_file(self, candidate)
                    return

            _text_response(self, 404, "not found\n", "text/plain; charset=utf-8")

        def do_POST(self):  # noqa: N802
            self._blueprint_started_at = time.time()
            body = _read_request_body(self)
            path = self.path.split("?", 1)[0]

            if path == "/server/magic/wallet":
                _handle_magic_wallet(self, body)
                return

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

            if path == "/api/stove/session":
                _handle_blueprint_stove_session(self, tool_token, body)
                return

            if path.startswith("/tool/"):
                tool_name = path.removeprefix("/tool/").strip("/")
                _handle_tool(self, tool_token, tool_name, body)
                return

            open_key_for_request = _effective_open_api_key(self)

            if path == "/api/chat" and open_key_for_request:
                if _gateway_api_key():
                    _handle_gateway_chat(self, body, open_key=open_key_for_request)
                else:
                    _handle_open_chat(self, body, open_key=open_key_for_request)
                return

            if path == "/api/prompt" and open_key_for_request:
                if _gateway_api_key():
                    _handle_gateway_prompt(self, body, open_key=open_key_for_request)
                else:
                    _handle_open_prompt(self, body, open_key=open_key_for_request)
                return

            if path == "/api/pull" and open_key_for_request:
                _json_response(self, 400, {"error": "Model pull is not supported in cloud mode."})
                return

            if path.startswith("/api/"):
                if _handle_local_node_api(self, body=body, method="POST"):
                    return
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
