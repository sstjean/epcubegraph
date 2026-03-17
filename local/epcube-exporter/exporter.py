"""
EP Cube Cloud Exporter — Bridges EP Cube cloud API to Prometheus metrics.

Polls the EP Cube monitoring API (monitoring-us.epcube.com) and exposes 
Prometheus-compatible metrics on :9200/metrics for VictoriaMetrics to scrape.

Produces the same epcube_* metric names as the mock exporter so the API
and dashboard work without changes.

Authentication: Automatically solves the AJ-Captcha block puzzle and logs in.
Re-authenticates when the token expires (HTTP 401).

Required env vars:
  EPCUBE_USERNAME  — EP Cube cloud account email
  EPCUBE_PASSWORD  — EP Cube cloud account password

Optional env vars:
  EPCUBE_PORT      — HTTP port for metrics (default: 9200)
  EPCUBE_INTERVAL  — Poll interval in seconds (default: 60)
"""
import base64
import collections
import json
import logging
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

_TZ = ZoneInfo("America/New_York")
from http.server import HTTPServer, BaseHTTPRequestHandler
from io import BytesIO

import cv2
import numpy as np
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CLOUD_API_BASE = "https://monitoring-us.epcube.com/v1/api"
METRICS_PORT = int(os.environ.get("EPCUBE_PORT", "9200"))
POLL_INTERVAL = int(os.environ.get("EPCUBE_INTERVAL", "60"))
DISABLE_AUTH = os.environ.get("EPCUBE_DISABLE_AUTH", "").lower() == "true"

# Entra ID JWT validation config (only used when auth is enabled)
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_AUDIENCE = os.environ.get("AZURE_AUDIENCE", "")

log = logging.getLogger("epcube-exporter")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# ---------------------------------------------------------------------------
# Cloud API helpers
# ---------------------------------------------------------------------------

def _api_request(method, path, data=None, token=None):
    """Make an HTTP request to the EP Cube cloud API."""
    url = f"{CLOUD_API_BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise AuthExpiredError("Token expired (401)")
        raise


class AuthExpiredError(Exception):
    pass


# ---------------------------------------------------------------------------
# Captcha solver
# ---------------------------------------------------------------------------

def _aes_encrypt(text, key):
    """AES-ECB encrypt with PKCS7 padding → base64."""
    cipher = AES.new(key.encode("utf-8"), AES.MODE_ECB)
    encrypted = cipher.encrypt(pad(text.encode("utf-8"), AES.block_size))
    return base64.b64encode(encrypted).decode()


def _decode_image(b64_str):
    """Decode base64 PNG → numpy array."""
    nparr = np.frombuffer(base64.b64decode(b64_str), np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)


def _find_gap_x(bg_b64, piece_b64):
    """
    Find the gap x-position by matching the piece's alpha contour
    against the background's edge image.
    """
    bg = _decode_image(bg_b64)
    piece = _decode_image(piece_b64)

    piece_alpha = piece[:, :, 3] if piece.shape[2] == 4 else np.ones(piece.shape[:2], np.uint8) * 255
    piece_outline = cv2.Canny(piece_alpha, 100, 200)
    kernel = np.ones((3, 3), np.uint8)
    piece_outline = cv2.dilate(piece_outline, kernel, iterations=1)

    bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGRA2GRAY) if bg.shape[2] == 4 else cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)

    candidates = []
    for low, high in [(50, 150), (80, 200), (100, 250), (30, 100)]:
        bg_edges = cv2.Canny(bg_gray, low, high)
        bg_edges = cv2.dilate(bg_edges, kernel, iterations=1)
        result = cv2.matchTemplate(bg_edges, piece_outline, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        candidates.append((max_loc[0], max_val))

    # Sobel
    sx = cv2.Sobel(bg_gray, cv2.CV_64F, 1, 0, ksize=3)
    sy = cv2.Sobel(bg_gray, cv2.CV_64F, 0, 1, ksize=3)
    sobel_mag = np.uint8(np.clip(np.sqrt(sx**2 + sy**2), 0, 255))
    result_s = cv2.matchTemplate(sobel_mag, piece_outline, cv2.TM_CCOEFF_NORMED)
    _, max_val_s, _, max_loc_s = cv2.minMaxLoc(result_s)
    candidates.append((max_loc_s[0], max_val_s))

    # Cluster by proximity (±5px) and pick majority
    candidates.sort(key=lambda c: c[0])
    clusters = []
    for x, conf in candidates:
        added = False
        for cluster in clusters:
            if abs(cluster[0] - x) <= 5:
                cluster[1].append((x, conf))
                added = True
                break
        if not added:
            clusters.append([x, [(x, conf)]])
    clusters.sort(key=lambda c: (-len(c[1]), -max(r[1] for r in c[1])))
    return int(round(np.mean([r[0] for r in clusters[0][1]])))


def _solve_captcha(max_attempts=5):
    """Solve AJ-Captcha block puzzle. Returns (token, secret_key, point_json)."""
    for attempt in range(1, max_attempts + 1):
        if attempt > 1:
            time.sleep(1)

        captcha = _api_request("POST", "/common/captcha/get", {"captchaType": "blockPuzzle"})["data"]
        secret_key = captcha["secretKey"]
        token = captcha["token"]

        x_pos = _find_gap_x(captcha["originalImageBase64"], captcha["jigsawImageBase64"])
        point_json = json.dumps({"x": x_pos, "y": 5}, separators=(",", ":"))
        encrypted_point = _aes_encrypt(point_json, secret_key)

        result = _api_request("POST", "/common/captcha/check", {
            "captchaType": "blockPuzzle",
            "pointJson": encrypted_point,
            "token": token,
        })

        if result.get("status") == 200:
            return token, secret_key, point_json

        log.warning("Captcha attempt %d failed (x=%d)", attempt, x_pos)

    raise RuntimeError(f"Failed to solve captcha after {max_attempts} attempts")


def authenticate(username, password):
    """Full login: solve captcha + login → JWT token."""
    log.info("Authenticating as %s ...", username)
    token, secret_key, point_json = _solve_captcha()
    captcha_verification = _aes_encrypt(token + "---" + point_json, secret_key)

    result = _api_request("POST", "/common/login", {
        "userName": username,
        "password": password,
        "captchaVerification": captcha_verification,
    })

    if result.get("status") != 200:
        raise RuntimeError(f"Login failed: {result.get('message', 'unknown error')}")

    jwt = result["data"]["token"]
    if jwt.startswith("Bearer "):
        jwt = jwt[7:]
    log.info("Authentication successful")
    return jwt


# ---------------------------------------------------------------------------
# Data collection
# ---------------------------------------------------------------------------

class EpCubeCollector:
    """Polls the EP Cube cloud API and produces Prometheus metrics."""

    # Keep last 10 minutes of snapshots (at 60s interval = ~10 entries)
    HISTORY_MAX = 10

    def __init__(self, username, password):
        self._username = username
        self._password = password
        self._token = None
        self._devices = []
        self._lock = threading.Lock()
        self._metrics_text = ""
        self._last_poll = 0.0
        self._history = collections.deque(maxlen=self.HISTORY_MAX)
        self._poll_count = 0
        self._poll_errors = 0
        self._consecutive_errors = 0
        self._prev_bat_net = {}  # device_id → previous bat_net_kwh total
        self._start_time = time.time()

    def _ensure_auth(self):
        if not self._token:
            self._token = authenticate(self._username, self._password)
            self._discover_devices()

    def _reauth(self):
        log.info("Re-authenticating...")
        self._token = authenticate(self._username, self._password)
        self._discover_devices()

    def _api(self, path):
        try:
            return _api_request("GET", path, token=self._token)
        except AuthExpiredError:
            self._reauth()
            return _api_request("GET", path, token=self._token)

    def _discover_devices(self):
        result = _api_request("GET", "/home/deviceList", token=self._token)
        if result.get("status") == 200:
            self._devices = result["data"]
            for d in self._devices:
                log.info("  Device: %s (id=%s, sn=%s, online=%s)",
                         d.get("name", "?"), d["id"], d.get("sgSn", "?"), d.get("isOnline", "?"))

    def poll(self):
        """Fetch data from all devices and update metrics text."""
        self._ensure_auth()

        lines = []
        now_utc = datetime.now(timezone.utc)
        snapshot = {
            "time": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "time_minute": now_utc.strftime("%Y-%m-%dT%H:%MZ"),
            "devices": [],
        }
        for dev in self._devices:
            dev_id = dev["id"]
            sg_sn = dev.get("sgSn", "")
            dev_name = dev.get("name", "unknown")
            is_online = dev.get("isOnline", "0")
            dev_type = dev.get("devType", 0)

            if is_online != "1":
                log.warning("Device %s (%s) is offline, skipping", dev_name, dev_id)
                continue

            try:
                info = self._api(f"/home/homeDeviceInfo?sgSn={sg_sn}")
                data = info.get("data", {})
            except Exception as e:
                log.error("Failed to fetch data for %s: %s", dev_name, e)
                self._poll_errors += 1
                continue

            # Build Prometheus labels matching mock exporter format
            bat_labels = {
                "device": f"epcube{dev_id}_battery",
                "ip": "cloud",
                "class": "storage_battery",
            }
            sol_labels = {
                "device": f"epcube{dev_id}_solar",
                "ip": "cloud",
                "class": "home_solar",
            }

            bl = ",".join(f'{k}="{v}"' for k, v in bat_labels.items())
            sl = ",".join(f'{k}="{v}"' for k, v in sol_labels.items())

            # ── Solar metrics ──
            solar_kw = float(data.get("solarPower", 0))
            solar_w = round(solar_kw * 1000, 1)

            lines.append("# HELP epcube_solar_instantaneous_generation_watts Current solar generation")
            lines.append("# TYPE epcube_solar_instantaneous_generation_watts gauge")
            lines.append(f"epcube_solar_instantaneous_generation_watts{{{sl}}} {solar_w}")

            # ── Battery metrics ──
            soc = float(data.get("batterySoc", 0))

            lines.append("# HELP epcube_battery_state_of_capacity_percent Battery SoC")
            lines.append("# TYPE epcube_battery_state_of_capacity_percent gauge")
            lines.append(f"epcube_battery_state_of_capacity_percent{{{bl}}} {soc}")

            # ── Backup/home load metrics ──
            backup_kw = float(data.get("backUpPower", 0))
            backup_w = round(backup_kw * 1000, 1)

            lines.append("# HELP epcube_home_load_power_watts Home load power consumption")
            lines.append("# TYPE epcube_home_load_power_watts gauge")
            lines.append(f"epcube_home_load_power_watts{{{bl}}} {backup_w}")

            # ── Self-sufficiency rate ──
            self_help = float(data.get("selfHelpRate", 0))
            lines.append("# HELP epcube_self_sufficiency_rate Self-sufficiency percentage")
            lines.append("# TYPE epcube_self_sufficiency_rate gauge")
            lines.append(f"epcube_self_sufficiency_rate{{{bl}}} {self_help}")

            # ── Capture snapshot for debug UI ──
            _STATUS_MAP = {
                0: "Standby", 1: "Self-Use", 2: "Backup",
                3: "Off-Grid", 4: "Normal", 5: "Fault", 6: "Upgrading",
            }
            raw_status = data.get("systemStatus", "?")
            system_status = f"{_STATUS_MAP.get(raw_status, raw_status)} ({raw_status})"
            bat_stored_kwh = float(data.get("batteryCurrentElectricity", 0))
            ress_count = data.get("ressNumber", "?")
            snapshot["devices"].append({
                "name": dev_name,
                "id": dev_id,
                "solar_kw": solar_kw,
                "battery_soc": soc,
                "backup_kw": backup_kw,
                "self_sufficiency": self_help,
                "system_status": system_status,
                "bat_stored_kwh": bat_stored_kwh,
                "ress_count": ress_count,
                # daily totals filled in below
                "solar_kwh": 0.0,
                "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0,
                "backup_kwh": 0.0,
                "bat_current_kwh": 0.0,
            })

            # ── Scrape health ──
            now_ts = int(time.time())
            for d_labels in [bat_labels, sol_labels]:
                dl = ",".join(f'{k}="{v}"' for k, v in d_labels.items())
                lines.append(f"epcube_scrape_success{{{dl}}} 1")
                lines.append(f"epcube_last_scrape_timestamp_seconds{{{dl}}} {now_ts}")

            # ── Device info ──
            for dl in [bat_labels, sol_labels]:
                info_labels = {
                    **dl,
                    "manufacturer": "Canadian Solar",
                    "product_code": f"EP Cube (devType={dev_type})",
                    "uid": sg_sn,
                }
                il = ",".join(f'{k}="{v}"' for k, v in info_labels.items())
                lines.append(f"epcube_device_info{{{il}}} 1")

        # Also try to get daily energy totals
        # Build a lookup from device id to snapshot entry for merging
        snap_by_id = {d["id"]: d for d in snapshot["devices"]}
        for dev in self._devices:
            if dev.get("isOnline") != "1":
                continue
            try:
                today = datetime.now(_TZ).strftime("%Y-%m-%d")
                elec = self._api(f"/home/queryDataElectricityV2?devId={dev['id']}&scopeType=1&queryDateStr={today}")
                edata = elec.get("data", {})
                bl = f'device="epcube{dev["id"]}_battery",ip="cloud",class="storage_battery"'

                solar_kwh = float(edata.get("solarElectricity", 0))
                lines.append("# HELP epcube_solar_cumulative_generation_kwh Total energy generated today")
                lines.append("# TYPE epcube_solar_cumulative_generation_kwh gauge")
                lines.append(f"epcube_solar_cumulative_generation_kwh{{{bl}}} {solar_kwh}")

                grid_from = float(edata.get("gridElectricityFrom", 0))
                grid_to = float(edata.get("gridElectricityTo", 0))
                lines.append("# HELP epcube_grid_import_kwh Grid energy imported today")
                lines.append("# TYPE epcube_grid_import_kwh gauge")
                lines.append(f"epcube_grid_import_kwh{{{bl}}} {grid_from}")
                lines.append("# HELP epcube_grid_export_kwh Grid energy exported today")
                lines.append("# TYPE epcube_grid_export_kwh gauge")
                lines.append(f"epcube_grid_export_kwh{{{bl}}} {grid_to}")

                backup_kwh = float(edata.get("backUpElectricity", 0))

                # Calculate battery net from energy balance:
                # Solar + Grid Import = House Load + Grid Export + Net Battery Charge
                bat_net_kwh = round(solar_kwh + grid_from - backup_kwh - grid_to, 2)
                lines.append("# HELP epcube_battery_net_kwh Net battery energy today (positive=charge, negative=discharge)")
                lines.append("# TYPE epcube_battery_net_kwh gauge")
                lines.append(f"epcube_battery_net_kwh{{{bl}}} {bat_net_kwh}")

                # Period delta: change since last poll
                dev_id_key = dev["id"]
                prev = self._prev_bat_net.get(dev_id_key)
                bat_current_kwh = round(bat_net_kwh - prev, 2) if prev is not None else 0.0
                self._prev_bat_net[dev_id_key] = bat_net_kwh

                # Merge daily totals into snapshot
                snap_dev = snap_by_id.get(dev["id"])
                if snap_dev:
                    snap_dev["solar_kwh"] = solar_kwh
                    snap_dev["grid_import_kwh"] = grid_from
                    snap_dev["grid_export_kwh"] = grid_to
                    snap_dev["backup_kwh"] = backup_kwh
                    snap_dev["bat_current_kwh"] = bat_current_kwh

            except Exception as e:
                log.warning("Failed to fetch daily energy for device %s: %s", dev.get("name"), e)

        lines.append("")
        with self._lock:
            self._metrics_text = "\n".join(lines)
            self._last_poll = time.time()
            self._poll_count += 1
            self._consecutive_errors = 0
            # Replace last entry if same minute (avoid duplicates)
            if self._history and self._history[-1]["time_minute"] == snapshot["time_minute"]:
                self._history[-1] = snapshot
            else:
                self._history.append(snapshot)

        log.info("Poll complete: %d metric lines for %d device(s)", len(lines), len(self._devices))

    def get_health(self):
        """Return health status. Unhealthy if no poll in 5 min or 5+ consecutive errors."""
        with self._lock:
            checks = []
            # Check last successful poll was within 5 minutes
            if self._last_poll:
                age = time.time() - self._last_poll
                if age > 300:
                    checks.append(f"last poll {int(age)}s ago (>300s)")
            else:
                checks.append("no successful poll yet")
            # Check consecutive errors
            if self._consecutive_errors >= 5:
                checks.append(f"{self._consecutive_errors} consecutive errors")
            return {"healthy": len(checks) == 0, "checks": checks}

    def get_metrics(self):
        with self._lock:
            return self._metrics_text

    def get_status(self):
        """Return debug status dict for the web UI."""
        with self._lock:
            uptime = time.time() - self._start_time
            return {
                "uptime_s": int(uptime),
                "poll_count": self._poll_count,
                "poll_errors": self._poll_errors,
                "last_poll": self._last_poll,
                "devices": len(self._devices),
                "history": list(self._history),
            }


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

def _render_status_page(status, health):
    """Render a minimal HTML debug page showing last 10 minutes of values."""
    uptime_m = status["uptime_s"] // 60
    uptime_h = uptime_m // 60
    uptime_str = f"{uptime_h}h {uptime_m % 60}m {status['uptime_s'] % 60}s"
    last_ago = int(time.time() - status["last_poll"]) if status["last_poll"] else None
    last_str = f"{last_ago}s ago" if last_ago is not None else "never"

    # Build per-device tables from history
    history = status["history"]

    # Collect all unique device names/ids seen across history
    device_order = []
    device_seen = set()
    for snap in history:
        for dev in snap["devices"]:
            key = dev["id"]
            if key not in device_seen:
                device_seen.add(key)
                device_order.append((key, dev["name"]))
    device_order.sort(key=lambda d: d[0])

    if not history or not device_order:
        tables_html = '<p style="color:#888">No data yet — waiting for first poll</p>'
    else:
        tables = []
        for dev_id, dev_name in device_order:
            rows = []
            for snap in history:  # oldest first
                for dev in snap["devices"]:
                    if dev["id"] != dev_id:
                        continue
                    rows.append(
                        f'<tr>'
                        f'<td class="utctime" data-utc="{snap["time"]}">{snap["time"]}</td>'
                        f'<td style="text-align:right">{dev["solar_kw"]:.2f}</td>'
                        f'<td style="text-align:right">{dev["battery_soc"]:.0f}%</td>'
                        f'<td style="text-align:right">{dev["backup_kw"]:.2f}</td>'
                        f'<td style="text-align:right">{dev.get("self_sufficiency", 0):.0f}%</td>'
                        f'<td style="text-align:right">{dev.get("solar_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_import_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_export_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("bat_current_kwh", 0):+.1f}</td>'
                        f'</tr>'
                    )
            row_html = "\n".join(rows) if rows else '<tr><td colspan="9" style="text-align:center;color:#888">No data</td></tr>'
            # Get latest snapshot values for this device
            latest_status = "?"
            latest_backup_kwh = 0.0
            latest_bat_stored = 0.0
            latest_ress = "?"
            for snap in reversed(history):
                for dev in snap["devices"]:
                    if dev["id"] == dev_id:
                        latest_status = dev.get("system_status", "?")
                        latest_backup_kwh = dev.get("backup_kwh", 0.0)
                        latest_bat_stored = dev.get("bat_stored_kwh", 0.0)
                        latest_ress = dev.get("ress_count", "?")
                        break
                else:
                    continue
                break
            tables.append(
                f'<h2 style="color:#00d4aa;font-size:1em;margin:1.5em 0 0.5em">{dev_name}'
                f' <span class="badge">EP Cube &middot; {latest_ress}x</span>'
                f' <span class="badge">Status: {latest_status}</span>'
                f' <span class="badge">Battery level: {latest_bat_stored:.1f} kWh</span>'
                f' <span class="badge">Home Supply (total): {latest_backup_kwh:.1f} kWh</span>'
                f'</h2>\n'
                f'<table>\n<tr>'
                f'<th>Time</th><th>Solar kW</th><th>Battery SoC</th>'
                f'<th>Load kW</th><th>Self-Suff</th>'
                f'<th>Solar kWh</th><th>Grid In kWh</th><th>Grid Out kWh</th><th>Bat Current kWh</th>'
                f'</tr>\n{row_html}\n</table>'
            )
        tables_html = "\n".join(tables)

    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="30">
<title>epcube-exporter status</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }}
  h1 {{ color: #00d4aa; font-size: 1.3em; }}
  .info {{ display: flex; gap: 2em; margin-bottom: 1.5em; font-size: 0.9em; }}
  .info span {{ background: #16213e; padding: 0.4em 0.8em; border-radius: 4px; }}
  .info .ok {{ color: #00d4aa; }}
  .info .warn {{ color: #ffc107; }}
  .badge {{ font-size: 0.75em; background: #16213e; color: #aaa; padding: 0.2em 0.6em; border-radius: 4px; margin-left: 1.2em; vertical-align: middle; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.85em; margin-bottom: 0.5em; }}
  th, td {{ padding: 0.5em 0.8em; border: 1px solid #2a2a4a; }}
  th {{ background: #16213e; text-align: left; position: sticky; top: 0; }}
  tr:hover {{ background: #16213e; }}
  .footer {{ margin-top: 1.5em; font-size: 0.8em; color: #666; }}
</style>
</head><body>
<h1>&#9889; epcube-exporter — debug status
<span style="font-size:0.6em;background:{'#00d4aa' if health['healthy'] else '#e74c3c'};color:#fff;padding:0.2em 0.7em;border-radius:12px;margin-left:0.8em;vertical-align:middle">{'&#10003; healthy' if health['healthy'] else '&#10007; ' + ', '.join(health['checks'])}</span>
</h1>
<div class="info">
  <span>Uptime: <b>{uptime_str}</b></span>
  <span>Polls: <b>{status["poll_count"]}</b></span>
  <span class="{'warn' if status['poll_errors'] else 'ok'}">Errors: <b>{status["poll_errors"]}</b></span>
  <span>Devices: <b>{status["devices"]}</b></span>
  <span>Last poll: <b>{last_str}</b></span>
</div>
{tables_html}
<script>
document.querySelectorAll('.utctime').forEach(el => {{
  const d = new Date(el.dataset.utc);
  el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', hour12: true}});
}});
</script>
<div class="footer">Auto-refreshes every 30s &middot; Last 10 polls (~10 min) &middot;
  <a href="/metrics" style="color:#00d4aa">/metrics</a> &middot;
  <a href="/health" style="color:#00d4aa">/health</a>
</div>
</body></html>"""


class MetricsHandler(BaseHTTPRequestHandler):
    collector = None  # Set by main
    _jwks_client = None  # Lazily initialized

    def _check_auth(self):
        """Validate JWT token. Returns True if authorized, False if rejected."""
        if DISABLE_AUTH:
            return True

        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Bearer realm="epcube-exporter"')
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing or invalid Authorization header"}).encode())
            return False

        token = auth_header[7:]
        try:
            import jwt
            if MetricsHandler._jwks_client is None:
                jwks_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
                MetricsHandler._jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True)

            signing_key = MetricsHandler._jwks_client.get_signing_key_from_jwt(token)
            jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=AZURE_AUDIENCE,
                issuer=f"https://sts.windows.net/{AZURE_TENANT_ID}/",
            )
            return True
        except Exception as e:
            log.warning("JWT validation failed: %s", e)
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Bearer realm="epcube-exporter", error="invalid_token"')
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid or expired token"}).encode())
            return False

    def do_GET(self):
        if self.path == "/metrics":
            body = self.collector.get_metrics().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/health":
            health = self.collector.get_health()
            if health["healthy"]:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode())
            else:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "unhealthy", "reasons": health["checks"]}).encode())
        elif self.path == "/" or self.path == "/status":
            if not self._check_auth():
                return
            status = self.collector.get_status()
            health = self.collector.get_health()
            body = _render_status_page(status, health).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress per-request logging


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def poll_loop(collector, interval):
    """Background thread: polls API on schedule."""
    while True:
        time.sleep(interval)
        try:
            collector.poll()
        except Exception:
            log.exception("Poll failed")
            with collector._lock:
                collector._poll_errors += 1
                collector._consecutive_errors += 1


def main():
    username = os.environ.get("EPCUBE_USERNAME")
    password = os.environ.get("EPCUBE_PASSWORD")

    if not username or not password:
        log.error("EPCUBE_USERNAME and EPCUBE_PASSWORD environment variables required")
        sys.exit(1)

    collector = EpCubeCollector(username, password)

    # Initial poll (blocks until first data is available)
    collector.poll()

    # Start background polling
    poll_thread = threading.Thread(target=poll_loop, args=(collector, POLL_INTERVAL), daemon=True)
    poll_thread.start()

    # Start HTTP server
    MetricsHandler.collector = collector
    server = HTTPServer(("0.0.0.0", METRICS_PORT), MetricsHandler)
    log.info("Serving metrics on :%d/metrics (poll interval: %ds)", METRICS_PORT, POLL_INTERVAL)
    if DISABLE_AUTH:
        log.info("Auth DISABLED — debug page is unauthenticated (local dev mode)")
    else:
        log.info("Auth ENABLED — debug page requires Entra ID JWT (tenant=%s)", AZURE_TENANT_ID)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")


if __name__ == "__main__":
    main()
