#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (or with sudo)." >&2
  exit 1
fi

TOKEN="${AGENTC_MONITOR_TOKEN:-}"
PORT="${AGENTC_MONITOR_PORT:-9870}"
BIND_ADDR="${AGENTC_MONITOR_BIND:-0.0.0.0}"
PRIMARY_DOMAINS="${PRIMARY_DOMAINS:-}"

if [[ -z "${TOKEN}" ]]; then
  echo "Missing AGENTC_MONITOR_TOKEN. Example:" >&2
  echo "  AGENTC_MONITOR_TOKEN='replace-with-strong-token' bash $0" >&2
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || [[ "${PORT}" -lt 1 ]] || [[ "${PORT}" -gt 65535 ]]; then
  echo "AGENTC_MONITOR_PORT must be an integer between 1 and 65535." >&2
  exit 1
fi

INSTALL_DIR="/opt/agentc-monitor"
ENV_FILE="/etc/agentc-plesk-monitor.env"
SERVICE_FILE="/etc/systemd/system/agentc-plesk-monitor.service"
AGENT_FILE="${INSTALL_DIR}/agent.py"

mkdir -p "${INSTALL_DIR}"

cat > "${AGENT_FILE}" <<'PY'
#!/usr/bin/env python3
import json
import os
import shutil
import socket
import ssl
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("AGENTC_MONITOR_TOKEN", "").strip()
PORT = int(os.environ.get("AGENTC_MONITOR_PORT", "9870") or "9870")
BIND = os.environ.get("AGENTC_MONITOR_BIND", "0.0.0.0").strip() or "0.0.0.0"
PRIMARY_DOMAINS = [
    d.strip().lower()
    for d in os.environ.get("PRIMARY_DOMAINS", "").replace(";", ",").replace("\n", ",").split(",")
    if d.strip()
]

SAMPLE_INTERVAL_SECONDS = 15
CPU_RAM_WINDOW_SECONDS = 300
MAINT_CACHE_SECONDS = 300
SSL_CACHE_SECONDS = 600

STATE_LOCK = threading.Lock()
CPU_PREV = None
CPU_RAM_SAMPLES = []
MAINT_CACHE = {"at": 0, "pending": None, "plesk": None}
SSL_CACHE = {"at": 0, "rows": []}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clamp(value, min_value, max_value):
    try:
        number = float(value)
    except Exception:
        return min_value
    return max(min_value, min(max_value, number))


def read_cpu_percent():
    global CPU_PREV
    try:
        with open("/proc/stat", "r", encoding="utf-8") as fh:
            first = fh.readline().strip()
        parts = first.split()
        if len(parts) < 8 or parts[0] != "cpu":
            return None
        vals = [int(x) for x in parts[1:8]]
        idle = vals[3] + vals[4]
        total = sum(vals)
        if CPU_PREV is None:
            CPU_PREV = (idle, total)
            return 0.0
        prev_idle, prev_total = CPU_PREV
        idle_delta = idle - prev_idle
        total_delta = total - prev_total
        CPU_PREV = (idle, total)
        if total_delta <= 0:
            return 0.0
        usage = (1.0 - (idle_delta / float(total_delta))) * 100.0
        return round(clamp(usage, 0.0, 100.0), 2)
    except Exception:
        return None


def read_ram_percent():
    try:
        fields = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                parts = value.strip().split()
                if not parts:
                    continue
                fields[key.strip()] = int(parts[0])
        total = float(fields.get("MemTotal", 0))
        available = float(fields.get("MemAvailable", 0))
        if total <= 0:
            return None
        if available <= 0:
            available = float(fields.get("MemFree", 0)) + float(fields.get("Buffers", 0)) + float(fields.get("Cached", 0))
        used = max(0.0, total - max(0.0, available))
        usage = (used / total) * 100.0
        return round(clamp(usage, 0.0, 100.0), 2)
    except Exception:
        return None


def read_disk():
    try:
        usage = shutil.disk_usage("/")
        total = float(usage.total)
        free = float(usage.free)
        used = max(0.0, total - free)
        used_percent = round((used / total) * 100.0, 2) if total > 0 else None
        return {
            "usedPercent": used_percent,
            "freeGb": round(free / (1024.0 ** 3), 2),
            "totalGb": round(total / (1024.0 ** 3), 2),
        }
    except Exception:
        return {"usedPercent": None, "freeGb": None, "totalGb": None}


def read_uptime_seconds():
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as fh:
            return float(fh.read().split()[0])
    except Exception:
        return None


def read_last_reboot_at():
    try:
        with open("/proc/stat", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("btime "):
                    sec = int(line.split()[1])
                    return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    return None


def avg_for_window(values):
    nums = [v for v in values if isinstance(v, (int, float))]
    if not nums:
        return None
    return round(sum(nums) / float(len(nums)), 2)


def sample_cpu_ram_loop():
    while True:
        now = time.time()
        cpu = read_cpu_percent()
        ram = read_ram_percent()
        with STATE_LOCK:
            CPU_RAM_SAMPLES.append({"ts": now, "cpu": cpu, "ram": ram})
            cutoff = now - CPU_RAM_WINDOW_SECONDS
            while CPU_RAM_SAMPLES and CPU_RAM_SAMPLES[0]["ts"] < cutoff:
                CPU_RAM_SAMPLES.pop(0)
        time.sleep(SAMPLE_INTERVAL_SECONDS)


def run_cmd(command, timeout_seconds=20):
    try:
        completed = subprocess.run(
            ["bash", "-lc", command],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        return stdout if stdout else stderr
    except Exception:
        return ""


def pending_os_updates_count():
    output = run_cmd("apt-get -s upgrade 2>/dev/null | awk '/^Inst /{c++} END {print c+0}'", timeout_seconds=25)
    if not output:
        return None
    try:
        return max(0, int(output.splitlines()[-1].strip()))
    except Exception:
        return None


def plesk_updates_available():
    if shutil.which("plesk") is None:
        return None
    output = run_cmd("timeout 25s plesk installer --check-updates 2>/dev/null || true", timeout_seconds=35)
    low = output.lower()
    if not low.strip():
        return None
    if "no updates available" in low or "up to date" in low:
        return False
    if "updates available" in low or "update available" in low or "will be installed" in low:
        return True
    return None


def check_ssl_domain(domain):
    name = str(domain or "").strip().lower()
    if not name:
        return {"domain": name, "status": "unknown", "expiresAt": None, "daysRemaining": None, "error": "invalid_domain"}
    try:
        context = ssl.create_default_context()
        with socket.create_connection((name, 443), timeout=8) as sock:
            with context.wrap_socket(sock, server_hostname=name) as tls_sock:
                cert = tls_sock.getpeercert()
        not_after = cert.get("notAfter") if isinstance(cert, dict) else None
        if not not_after:
            return {"domain": name, "status": "unknown", "expiresAt": None, "daysRemaining": None, "error": "missing_notAfter"}
        expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        delta_days = int((expiry - datetime.now(timezone.utc)).total_seconds() // 86400)
        if delta_days < 0:
            status = "expired"
        elif delta_days <= 30:
            status = "expiring"
        else:
            status = "valid"
        return {
            "domain": name,
            "status": status,
            "expiresAt": expiry.isoformat().replace("+00:00", "Z"),
            "daysRemaining": delta_days,
        }
    except Exception as exc:
        return {
            "domain": name,
            "status": "unknown",
            "expiresAt": None,
            "daysRemaining": None,
            "error": str(exc),
        }


def get_maintenance_values():
    now = time.time()
    with STATE_LOCK:
        cached_at = float(MAINT_CACHE.get("at") or 0)
        if (now - cached_at) < MAINT_CACHE_SECONDS:
            return MAINT_CACHE.get("pending"), MAINT_CACHE.get("plesk")

    pending = pending_os_updates_count()
    plesk = plesk_updates_available()

    with STATE_LOCK:
        MAINT_CACHE["at"] = now
        MAINT_CACHE["pending"] = pending
        MAINT_CACHE["plesk"] = plesk

    return pending, plesk


def get_ssl_values():
    if not PRIMARY_DOMAINS:
        return []

    now = time.time()
    with STATE_LOCK:
        cached_at = float(SSL_CACHE.get("at") or 0)
        cached_rows = SSL_CACHE.get("rows") or []
        if (now - cached_at) < SSL_CACHE_SECONDS and isinstance(cached_rows, list):
            return cached_rows

    rows = [check_ssl_domain(domain) for domain in PRIMARY_DOMAINS]
    with STATE_LOCK:
        SSL_CACHE["at"] = now
        SSL_CACHE["rows"] = rows

    return rows


def build_health_payload():
    now = time.time()
    with STATE_LOCK:
        cutoff = now - CPU_RAM_WINDOW_SECONDS
        relevant = [row for row in CPU_RAM_SAMPLES if row.get("ts", 0) >= cutoff]
        cpu_values = [row.get("cpu") for row in relevant]
        ram_values = [row.get("ram") for row in relevant]
        latest_cpu = cpu_values[-1] if cpu_values else read_cpu_percent()
        latest_ram = ram_values[-1] if ram_values else read_ram_percent()

    cpu_avg = avg_for_window(cpu_values)
    ram_avg = avg_for_window(ram_values)

    disk = read_disk()
    pending_updates, plesk_updates = get_maintenance_values()
    ssl_rows = get_ssl_values()

    return {
        "ok": True,
        "generatedAt": utc_now_iso(),
        "host": {
            "hostname": socket.gethostname(),
            "os": "Ubuntu",
            "controlPanel": "Plesk/WebPros",
        },
        "signals": {
            "cpu": {
                "percent": latest_cpu,
                "avg5mPercent": cpu_avg,
            },
            "ram": {
                "percent": latest_ram,
                "avg5mPercent": ram_avg,
            },
            "disk": disk,
            "uptime": {
                "seconds": read_uptime_seconds(),
                "lastRebootAt": read_last_reboot_at(),
            },
        },
        "maintenance": {
            "pendingOsUpdates": pending_updates,
            "pleskUpdatesAvailable": plesk_updates,
            "ssl": ssl_rows,
        },
    }


def auth_ok(handler):
    if not TOKEN:
        return True
    auth = handler.headers.get("Authorization", "")
    token_header = handler.headers.get("x-agentc-monitor-token", "")
    candidate = ""
    if auth.lower().startswith("bearer "):
        candidate = auth[7:].strip()
    elif token_header:
        candidate = token_header.strip()
    return candidate == TOKEN


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not auth_ok(self):
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return

        path = (self.path or "/").split("?", 1)[0]
        if path == "/ready":
            self._send_json(200, {
                "ok": True,
                "service": "agentc-plesk-monitor",
                "generatedAt": utc_now_iso(),
            })
            return

        if path == "/health":
            self._send_json(200, build_health_payload())
            return

        self._send_json(404, {"ok": False, "error": "not_found"})

    def log_message(self, format, *args):  # noqa: A003
        return


def main():
    thread = threading.Thread(target=sample_cpu_ram_loop, daemon=True)
    thread.start()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
PY

chmod 0755 "${AGENT_FILE}"

{
  printf 'AGENTC_MONITOR_TOKEN=%q\n' "${TOKEN}"
  printf 'AGENTC_MONITOR_PORT=%q\n' "${PORT}"
  printf 'AGENTC_MONITOR_BIND=%q\n' "${BIND_ADDR}"
  printf 'PRIMARY_DOMAINS=%q\n' "${PRIMARY_DOMAINS}"
} > "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

cat > "${SERVICE_FILE}" <<'SERVICE'
[Unit]
Description=AgentC Plesk/WebPros Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/agentc-plesk-monitor.env
ExecStart=/usr/bin/python3 /opt/agentc-monitor/agent.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now agentc-plesk-monitor.service

echo "Installed: agentc-plesk-monitor.service"
echo "Health endpoint: http://${BIND_ADDR}:${PORT}/health"
