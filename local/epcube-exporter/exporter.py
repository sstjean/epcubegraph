"""
EP Cube Cloud Exporter — Bridges EP Cube cloud API to Prometheus metrics.

Polls the EP Cube monitoring API (monitoring-us.epcube.com) and exposes 
Prometheus-compatible metrics on :9250/metrics for VictoriaMetrics to scrape.

Produces the same epcube_* metric names as the mock exporter so the API
and dashboard work without changes.

Authentication: Automatically solves the AJ-Captcha block puzzle and logs in.
Proactively refreshes the JWT before expiry (5-minute margin).  Also detects
the cloud API's silent session expiry (returns 200 with all-zero data instead
of 401) and forces re-authentication.

Required env vars:
  EPCUBE_USERNAME  — EP Cube cloud account email
  EPCUBE_PASSWORD  — EP Cube cloud account password

Optional env vars:
  EPCUBE_PORT      — HTTP port for metrics (default: 9250)
  EPCUBE_INTERVAL  — Poll interval in seconds (default: 60)
"""
import base64
import collections
import hashlib
import hmac
import json
import logging
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
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
__version__ = "1.1.0"
CLOUD_API_BASE = "https://monitoring-us.epcube.com/v1/api"
METRICS_PORT = int(os.environ.get("EPCUBE_PORT", "9250"))
POLL_INTERVAL = int(os.environ.get("EPCUBE_INTERVAL", "60"))
DISABLE_AUTH = os.environ.get("EPCUBE_DISABLE_AUTH", "").lower() == "true"

# Entra ID auth config (only used when auth is enabled)
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_AUDIENCE = os.environ.get("AZURE_AUDIENCE", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")
AZURE_REDIRECT_URI = os.environ.get("AZURE_REDIRECT_URI", "")

# OAuth session management
_SESSION_MAX_AGE = 3600  # 1 hour
_pending_auth = {}  # state -> {code_verifier, timestamp}
_sessions = {}  # session_id -> {expires, user}
_auth_lock = threading.Lock()

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


def _jwt_exp(token):
    """Decode JWT expiry (exp claim) without external libraries."""
    try:
        payload = token.split(".")[1]
        # Add padding for base64
        payload += "=" * (4 - len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return claims.get("exp", 0)
    except Exception:
        return 0


def _nz(v):
    """Normalize negative zero to positive zero."""
    return 0.0 if v == 0 else v


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

        # Human-like delay before submitting the solved puzzle
        delay = 1.9 + (secrets.randbelow(1500) - 500) / 1000  # 1.4–2.9s
        time.sleep(delay)

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
        self._token_exp = 0  # JWT expiry timestamp
        self._devices = []
        self._lock = threading.Lock()
        self._metrics_text = ""
        self._last_poll = 0.0
        self._history = collections.deque(maxlen=self.HISTORY_MAX)
        self._poll_count = 0
        self._poll_errors = 0
        self._consecutive_errors = 0
        self._bat_peak = {}  # device_id → {date: str, peak: float}
        self._start_time = time.time()

    def _ensure_auth(self):
        if not self._token or self._token_expiring_soon():
            if self._token:
                log.info("Token expiring within 5 min, proactively re-authenticating...")
            self._token = authenticate(self._username, self._password)
            self._token_exp = _jwt_exp(self._token)
            if self._token_exp:
                remaining = self._token_exp - time.time()
                log.info("Token expires in %.0f min", remaining / 60)
            self._discover_devices()

    def _token_expiring_soon(self):
        """Return True if token expires within 5 minutes."""
        if not self._token_exp:
            return False
        return time.time() > (self._token_exp - 300)

    def _reauth(self):
        log.info("Re-authenticating...")
        self._token = authenticate(self._username, self._password)
        self._token_exp = _jwt_exp(self._token)
        self._discover_devices()

    @staticmethod
    def _data_looks_stale(data):
        """Detect EP Cube cloud's silent session expiry.

        When the JWT expires, the cloud API returns HTTP 200 with all operational
        fields set to zero (or "0.00") instead of returning 401. This method
        checks the key fields that should virtually never ALL be zero on a live
        system: solarPower, gridPower, backUpPower, batterySoc, and
        batteryCurrentElectricity.
        """
        if not data:
            return True
        _FIELDS = ("solarPower", "gridPower", "backUpPower", "batterySoc", "batteryCurrentElectricity")
        return all(float(data.get(f, 0)) == 0 for f in _FIELDS)

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

                # Stale-session detection: EP Cube cloud returns 200 with all-zero
                # data when the JWT has silently expired, instead of a 401.
                # If every operational field is zero, force re-auth and retry once.
                if self._data_looks_stale(data):
                    log.warning("Stale data detected for %s — all operational fields zero, forcing re-auth", dev_name)
                    self._reauth()
                    info = self._api(f"/home/homeDeviceInfo?sgSn={sg_sn}")
                    data = info.get("data", {})
                    if self._data_looks_stale(data):
                        log.warning("Still zero after re-auth for %s — device may genuinely be idle", dev_name)
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
            solar_kw = _nz(float(data.get("solarPower", 0)))
            solar_w = _nz(round(solar_kw * 1000, 1))

            lines.append("# HELP epcube_solar_instantaneous_generation_watts Current solar generation")
            lines.append("# TYPE epcube_solar_instantaneous_generation_watts gauge")
            lines.append(f"epcube_solar_instantaneous_generation_watts{{{sl}}} {solar_w}")

            # ── Battery metrics ──
            soc = _nz(float(data.get("batterySoc", 0)))

            lines.append("# HELP epcube_battery_state_of_capacity_percent Battery SoC")
            lines.append("# TYPE epcube_battery_state_of_capacity_percent gauge")
            lines.append(f"epcube_battery_state_of_capacity_percent{{{bl}}} {soc}")

            # ── Grid metrics ── (API already uses positive=import, negative=export)
            grid_kw = _nz(float(data.get("gridPower", 0)))
            grid_w = _nz(round(grid_kw * 1000, 1))
            lines.append("# HELP epcube_grid_power_watts Grid power (positive=import, negative=export)")
            lines.append("# TYPE epcube_grid_power_watts gauge")
            lines.append(f"epcube_grid_power_watts{{{bl}}} {grid_w}")

            # ── Backup/home load metrics ──
            backup_kw = _nz(float(data.get("backUpPower", 0)))
            backup_w = _nz(round(backup_kw * 1000, 1))

            lines.append("# HELP epcube_home_load_power_watts Home load power consumption")
            lines.append("# TYPE epcube_home_load_power_watts gauge")
            lines.append(f"epcube_home_load_power_watts{{{bl}}} {backup_w}")

            # ── Battery power (derived from energy balance — API batteryPower is unreliable) ──
            # positive = charging, negative = discharging
            battery_kw = _nz(round(solar_kw + grid_kw - backup_kw, 2))
            battery_w = _nz(round(battery_kw * 1000, 1))
            lines.append("# HELP epcube_battery_power_watts Battery power (positive=charge, negative=discharge)")
            lines.append("# TYPE epcube_battery_power_watts gauge")
            lines.append(f"epcube_battery_power_watts{{{bl}}} {battery_w}")

            # ── Self-sufficiency rate ──
            self_help = _nz(float(data.get("selfHelpRate", 0)))
            lines.append("# HELP epcube_self_sufficiency_rate Self-sufficiency percentage")
            lines.append("# TYPE epcube_self_sufficiency_rate gauge")
            lines.append(f"epcube_self_sufficiency_rate{{{bl}}} {self_help}")

            # ── Battery stored energy ──
            bat_stored_kwh = _nz(float(data.get("batteryCurrentElectricity", 0)))
            lines.append("# HELP epcube_battery_stored_kwh Current battery energy level")
            lines.append("# TYPE epcube_battery_stored_kwh gauge")
            lines.append(f"epcube_battery_stored_kwh{{{bl}}} {bat_stored_kwh}")

            # ── Capture snapshot for debug UI ──
            _STATUS_MAP = {
                0: "Standby", 1: "Self-Use", 2: "Backup",
                3: "Off-Grid", 4: "Normal", 5: "Fault", 6: "Upgrading",
            }
            raw_status = data.get("systemStatus", "?")
            system_status = f"{_STATUS_MAP.get(raw_status, raw_status)} ({raw_status})"
            # Track peak battery stored for the day (resets at midnight)
            today_str = datetime.now(_TZ).strftime("%Y-%m-%d")
            peak_entry = self._bat_peak.get(dev_id)
            if peak_entry and peak_entry["date"] == today_str:
                peak_entry["peak"] = max(peak_entry["peak"], bat_stored_kwh)
            else:
                self._bat_peak[dev_id] = {"date": today_str, "peak": bat_stored_kwh}
            bat_peak_kwh = self._bat_peak[dev_id]["peak"]
            lines.append("# HELP epcube_battery_peak_stored_kwh Peak battery energy level today")
            lines.append("# TYPE epcube_battery_peak_stored_kwh gauge")
            lines.append(f"epcube_battery_peak_stored_kwh{{{bl}}} {bat_peak_kwh}")
            ress_count = data.get("ressNumber", "?")
            snapshot["devices"].append({
                "name": dev_name,
                "id": dev_id,
                "solar_kw": solar_kw,
                "battery_soc": soc,
                "battery_kw": battery_kw,
                "grid_kw": grid_kw,
                "backup_kw": backup_kw,
                "self_sufficiency": self_help,
                "system_status": system_status,
                "bat_stored_kwh": bat_stored_kwh,
                "bat_peak_kwh": bat_peak_kwh,
                "ress_count": ress_count,
                # daily totals filled in below
                "solar_kwh": 0.0,
                "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0,
                "backup_kwh": 0.0,
            })

            # ── Scrape health ──
            now_ts = int(time.time())
            for d_labels in [bat_labels, sol_labels]:
                dl = ",".join(f'{k}="{v}"' for k, v in d_labels.items())
                lines.append(f"epcube_scrape_success{{{dl}}} 1")
                lines.append(f"epcube_last_scrape_timestamp_seconds{{{dl}}} {now_ts}")

            # ── Device info ──
            status_label = _STATUS_MAP.get(raw_status, str(raw_status))
            for dl in [bat_labels, sol_labels]:
                info_labels = {
                    **dl,
                    "manufacturer": "Canadian Solar",
                    "product_code": f"EP Cube (devType={dev_type})",
                    "uid": sg_sn,
                    "system_status": status_label,
                    "ress_count": str(ress_count),
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

                solar_kwh = _nz(float(edata.get("solarElectricity", 0)))
                lines.append("# HELP epcube_solar_cumulative_generation_kwh Total energy generated today")
                lines.append("# TYPE epcube_solar_cumulative_generation_kwh gauge")
                lines.append(f"epcube_solar_cumulative_generation_kwh{{{bl}}} {solar_kwh}")

                grid_from = _nz(float(edata.get("gridElectricityFrom", 0)))
                grid_to = _nz(float(edata.get("gridElectricityTo", 0)))
                lines.append("# HELP epcube_grid_import_kwh Grid energy imported today")
                lines.append("# TYPE epcube_grid_import_kwh gauge")
                lines.append(f"epcube_grid_import_kwh{{{bl}}} {grid_from}")
                lines.append("# HELP epcube_grid_export_kwh Grid energy exported today")
                lines.append("# TYPE epcube_grid_export_kwh gauge")
                lines.append(f"epcube_grid_export_kwh{{{bl}}} {grid_to}")

                backup_kwh = _nz(float(edata.get("backUpElectricity", 0)))
                lines.append("# HELP epcube_home_supply_cumulative_kwh Daily cumulative home supply")
                lines.append("# TYPE epcube_home_supply_cumulative_kwh gauge")
                lines.append(f"epcube_home_supply_cumulative_kwh{{{bl}}} {backup_kwh}")

                # Merge daily totals into snapshot
                snap_dev = snap_by_id.get(dev["id"])
                if snap_dev:
                    snap_dev["solar_kwh"] = solar_kwh
                    snap_dev["grid_import_kwh"] = grid_from
                    snap_dev["grid_export_kwh"] = grid_to
                    snap_dev["backup_kwh"] = backup_kwh

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
                "version": __version__,
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
                    battery_kw = _nz(float(dev.get("battery_kw", 0)))
                    grid_kw = _nz(float(dev.get("grid_kw", 0)))
                    solar_kw = _nz(float(dev["solar_kw"]))
                    load = _nz(float(dev["backup_kw"]))
                    expected_battery = solar_kw + grid_kw - load
                    imbalance = abs(expected_battery - battery_kw)
                    row_cls = ' class="imbalance"' if load > 0 and imbalance > 0.5 else ''
                    warn_td = f' title="Expected battery {expected_battery:+.2f} kW ≠ Actual {battery_kw:+.2f} kW"' if load > 0 and imbalance > 0.5 else ''
                    fmt_bat = f"{battery_kw:+.2f}" if battery_kw != 0 else "0.00"
                    fmt_grid = f"{grid_kw:+.2f}" if grid_kw != 0 else "0.00"
                    # Battery: green=charging(+), red=discharging(-)
                    bat_cls = ' class="val-pos"' if battery_kw > 0 else (' class="val-neg"' if battery_kw < 0 else '')
                    # Grid: green=export(-), red=import(+)
                    grid_cls = ' class="val-neg"' if grid_kw > 0 else (' class="val-pos"' if grid_kw < 0 else '')
                    rows.append(
                        f'<tr{row_cls}>'
                        f'<td class="utctime" data-utc="{snap["time"]}">{snap["time"]}</td>'
                        f'<td style="text-align:right">{solar_kw:.2f}</td>'
                        f'<td style="text-align:right"{bat_cls}>{fmt_bat}</td>'
                        f'<td style="text-align:right"{grid_cls}>{fmt_grid}</td>'
                        f'<td style="text-align:right"{warn_td}>{load:.2f}{" ⚠" if row_cls else ""}</td>'
                        f'<td style="text-align:right">{dev["battery_soc"]:.0f}%</td>'
                        f'<td style="text-align:right">{dev.get("self_sufficiency", 0):.0f}%</td>'
                        f'<td class="section-divider" style="text-align:right">{dev.get("solar_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_import_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_export_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("bat_peak_kwh", dev.get("bat_stored_kwh", 0)):.1f}</td>'
                        f'</tr>'
                    )
            row_html = "\n".join(rows) if rows else '<tr><td colspan="11" style="text-align:center;color:#888">No data</td></tr>'
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
                f'<table>\n'
                f'<tr class="section-header">'
                f'<th></th>'
                f'<th colspan="6" class="section-instant">Current Activity</th>'
                f'<th colspan="4" class="section-daily section-divider">Daily Totals</th>'
                f'</tr>\n<tr>'
                f'<th>Time</th><th>Solar kW</th><th>Battery kW</th><th>Grid kW</th>'
                f'<th>Load kW</th><th>SoC</th><th>Self-Suff</th>'
                f'<th class="section-divider">Solar kWh</th><th>Grid In kWh</th><th>Grid Out kWh</th><th>Bat Peak kWh</th>'
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
  .section-header th {{ text-align: center; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 2px solid #2a2a4a; }}
  .section-instant {{ color: #00d4aa; }}
  .section-daily {{ color: #ffc107; }}
  .section-divider {{ border-left: 3px solid #444; }}
  tr.imbalance {{ background: #3a2000; }}
  tr.imbalance:hover {{ background: #4a2800; }}
  tr:hover {{ background: #16213e; }}
  .val-pos {{ color: #00d4aa; }}
  .val-neg {{ color: #e74c3c; }}
  .footer {{ margin-top: 1.5em; font-size: 0.8em; color: #666; }}
</style>
</head><body>
<h1>&#9889; epcube-exporter — debug status
<span style="font-size:0.6em;background:{'#00d4aa' if health['healthy'] else '#e74c3c'};color:#fff;padding:0.2em 0.7em;border-radius:12px;margin-left:0.8em;vertical-align:middle">{'&#10003; healthy' if health['healthy'] else '&#10007; ' + ', '.join(health['checks'])}</span>
</h1>
<div class="info">
  <span>Version: <b>{status["version"]}</b></span>
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


def _sign_session(session_id):
    """HMAC-sign a session ID using the client secret."""
    sig = hmac.new(AZURE_CLIENT_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    return f"{session_id}.{sig}"


def _verify_session_cookie(cookie_value):
    """Verify and return session_id from a signed cookie, or None."""
    if not cookie_value or "." not in cookie_value:
        return None
    session_id, sig = cookie_value.rsplit(".", 1)
    expected = hmac.new(AZURE_CLIENT_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    with _auth_lock:
        session = _sessions.get(session_id)
    if not session or session["expires"] < time.time():
        return None
    return session_id


def _cleanup_expired():
    """Remove expired sessions and stale auth states."""
    now = time.time()
    with _auth_lock:
        for sid in [k for k, v in _sessions.items() if v["expires"] < now]:
            del _sessions[sid]
        for st in [k for k, v in _pending_auth.items() if v["timestamp"] < now - 600]:
            del _pending_auth[st]


class MetricsHandler(BaseHTTPRequestHandler):
    collector = None  # Set by main
    _jwks_client = None  # Lazily initialized

    def _get_cookie(self, name):
        """Extract a named cookie value from the Cookie header."""
        cookie_header = self.headers.get("Cookie", "")
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith(f"{name}="):
                return part[len(name) + 1:]
        return None

    def _is_browser(self):
        """Heuristic: request came from a browser (Accept contains text/html)."""
        accept = self.headers.get("Accept", "")
        return "text/html" in accept

    def _check_auth(self):
        """Validate auth via session cookie or JWT Bearer token.

        For browser requests without auth, redirects to /login.
        For API requests without auth, returns 401 JSON.
        Returns True if authorized, False if rejected (response already sent).
        """
        if DISABLE_AUTH:
            return True

        # Check session cookie first (browser flow)
        session_cookie = self._get_cookie("_session")
        if _verify_session_cookie(session_cookie):
            return True

        # Check Bearer token (API flow)
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
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

        # No valid auth — redirect browsers to login, return 401 for API clients
        if self._is_browser() and AZURE_REDIRECT_URI:
            self.send_response(302)
            self.send_header("Location", "/login")
            self.end_headers()
            return False

        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Bearer realm="epcube-exporter"')
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Missing or invalid Authorization header"}).encode())
        return False

    def _handle_login(self):
        """Start OAuth 2.0 Authorization Code flow with PKCE."""
        if not AZURE_REDIRECT_URI or not AZURE_CLIENT_ID:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OAuth not configured")
            return

        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        ).rstrip(b"=").decode()

        _cleanup_expired()
        with _auth_lock:
            _pending_auth[state] = {
                "code_verifier": code_verifier,
                "timestamp": time.time(),
            }

        params = urllib.parse.urlencode({
            "client_id": AZURE_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": AZURE_REDIRECT_URI,
            "scope": f"{AZURE_AUDIENCE}/user_impersonation openid",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        })
        authorize_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/authorize?{params}"

        self.send_response(302)
        self.send_header("Location", authorize_url)
        self.end_headers()

    def _handle_callback(self):
        """Handle OAuth 2.0 callback — exchange code for tokens, create session."""
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        error = qs.get("error", [None])[0]
        if error:
            desc = qs.get("error_description", [error])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Authentication failed: {desc}".encode())
            return

        code = qs.get("code", [None])[0]
        state = qs.get("state", [None])[0]
        if not code or not state:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Missing code or state parameter")
            return

        with _auth_lock:
            pending = _pending_auth.pop(state, None)
        if not pending:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Invalid or expired state parameter")
            return

        # Exchange authorization code for tokens
        token_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token"
        token_data = urllib.parse.urlencode({
            "client_id": AZURE_CLIENT_ID,
            "client_secret": AZURE_CLIENT_SECRET,
            "code": code,
            "redirect_uri": AZURE_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": pending["code_verifier"],
        }).encode()

        try:
            req = urllib.request.Request(token_url, data=token_data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(req, timeout=10) as resp:
                token_resp = json.loads(resp.read())
        except Exception as e:
            log.error("Token exchange failed: %s", e)
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Token exchange failed")
            return

        # Validate the access token (proves the user is authorized)
        access_token = token_resp.get("access_token", "")
        try:
            import jwt as pyjwt
            if MetricsHandler._jwks_client is None:
                jwks_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
                MetricsHandler._jwks_client = pyjwt.PyJWKClient(jwks_url, cache_keys=True)

            signing_key = MetricsHandler._jwks_client.get_signing_key_from_jwt(access_token)
            claims = pyjwt.decode(
                access_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=AZURE_AUDIENCE,
                issuer=f"https://sts.windows.net/{AZURE_TENANT_ID}/",
            )
            user = claims.get("preferred_username", claims.get("sub", "unknown"))
        except Exception as e:
            log.warning("Access token validation failed: %s", e)
            self.send_response(401)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Access token validation failed")
            return

        # Create session
        session_id = secrets.token_urlsafe(32)
        with _auth_lock:
            _sessions[session_id] = {
                "expires": time.time() + _SESSION_MAX_AGE,
                "user": user,
            }

        signed = _sign_session(session_id)
        self.send_response(302)
        self.send_header("Set-Cookie", f"_session={signed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={_SESSION_MAX_AGE}")
        self.send_header("Location", "/status")
        self.end_headers()

    def do_GET(self):
        if self.path == "/login":
            self._handle_login()
            return
        if self.path.startswith("/.auth/callback"):
            self._handle_callback()
            return
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
