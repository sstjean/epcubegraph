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
__version__ = "2.0.0"
CLOUD_API_BASE = "https://monitoring-us.epcube.com/v1/api"
METRICS_PORT = int(os.environ.get("EPCUBE_PORT", "9250"))
POLL_INTERVAL = int(os.environ.get("EPCUBE_INTERVAL", "60"))
DEFAULT_POLL_INTERVAL = POLL_INTERVAL  # Fallback when DB has no setting
DISABLE_AUTH = os.environ.get("EPCUBE_DISABLE_AUTH", "").lower() == "true"
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "")

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
# PostgreSQL writer (optional — enabled via POSTGRES_DSN)
# ---------------------------------------------------------------------------

from typing import Any

psycopg2: Any = None

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    pass


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    device_class TEXT NOT NULL,
    alias TEXT,
    manufacturer TEXT,
    product_code TEXT,
    uid TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS readings (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    UNIQUE (device_id, metric_name, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_readings_device_metric_time
    ON readings (device_id, metric_name, timestamp DESC);
"""


class PostgresWriter:
    """Writes telemetry readings and device info to PostgreSQL."""

    def __init__(self, dsn):
        self._dsn = dsn
        self._conn = None
        self._ensure_schema()

    def _get_conn(self):
        """Get or re-establish the database connection."""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn)
            self._conn.autocommit = False
        return self._conn

    def _ensure_schema(self):
        """Create tables and indexes if they don't exist."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_SQL)
        conn.commit()
        log.info("PostgreSQL schema verified")

    def upsert_device(self, device_id, device_class, alias=None,
                      manufacturer=None, product_code=None, uid=None):
        """Insert or update a device record."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO devices (device_id, device_class, alias, manufacturer, product_code, uid)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (device_id) DO UPDATE SET
                       device_class = EXCLUDED.device_class,
                       alias = EXCLUDED.alias,
                       manufacturer = EXCLUDED.manufacturer,
                       product_code = EXCLUDED.product_code,
                       uid = EXCLUDED.uid,
                       updated_at = NOW()""",
                (device_id, device_class, alias, manufacturer, product_code, uid),
            )
        conn.commit()

    def write_readings(self, readings):
        """Batch-insert readings. Each reading is (device_id, metric_name, timestamp, value).

        Uses ON CONFLICT to deduplicate (same device + metric + timestamp).
        """
        if not readings:
            return
        conn = self._get_conn()
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO readings (device_id, metric_name, timestamp, value)
                   VALUES %s
                   ON CONFLICT (device_id, metric_name, timestamp) DO UPDATE SET
                       value = EXCLUDED.value""",
                readings,
                template="(%s, %s, %s, %s)",
            )
        conn.commit()

    def close(self):
        """Close the database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()


# ---------------------------------------------------------------------------
# Vue PostgreSQL writer
# ---------------------------------------------------------------------------

_VUE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS vue_devices (
    device_gid BIGINT PRIMARY KEY,
    device_name TEXT,
    model TEXT,
    firmware TEXT,
    connected BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vue_channels (
    id SERIAL PRIMARY KEY,
    device_gid BIGINT NOT NULL REFERENCES vue_devices(device_gid),
    channel_num TEXT NOT NULL,
    name TEXT,
    channel_multiplier DOUBLE PRECISION,
    channel_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_gid, channel_num)
);

CREATE TABLE IF NOT EXISTS vue_readings (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    UNIQUE (device_gid, channel_num, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_vue_readings_device_channel_time
    ON vue_readings (device_gid, channel_num, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_vue_readings_time
    ON vue_readings (timestamp);

CREATE TABLE IF NOT EXISTS vue_readings_1min (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    UNIQUE (device_gid, channel_num, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_vue_readings_1min_device_channel_time
    ON vue_readings_1min (device_gid, channel_num, timestamp DESC);
"""


class VuePostgresWriter:
    """Writes Vue energy readings and device info to PostgreSQL."""

    def __init__(self, dsn):
        self._dsn = dsn
        self._conn = None
        self._ensure_schema()

    def _get_conn(self):
        """Get or re-establish the database connection."""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn)
            self._conn.autocommit = False
        return self._conn

    def _ensure_schema(self):
        """Create Vue tables and indexes if they don't exist."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(_VUE_SCHEMA_SQL)
        conn.commit()
        log.info("Vue PostgreSQL schema verified")

    def upsert_device(self, device_gid, device_name=None, model=None,
                      firmware=None, connected=True):
        """Insert or update a Vue device record."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO vue_devices (device_gid, device_name, model, firmware, connected, last_seen)
                   VALUES (%s, %s, %s, %s, %s, NOW())
                   ON CONFLICT (device_gid) DO UPDATE SET
                       device_name = EXCLUDED.device_name,
                       model = EXCLUDED.model,
                       firmware = EXCLUDED.firmware,
                       connected = EXCLUDED.connected,
                       last_seen = NOW(),
                       updated_at = NOW()""",
                (device_gid, device_name, model, firmware, connected),
            )
        conn.commit()

    def upsert_channel(self, device_gid, channel_num, name=None,
                       channel_multiplier=None, channel_type=None):
        """Insert or update a Vue channel record."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO vue_channels (device_gid, channel_num, name, channel_multiplier, channel_type)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (device_gid, channel_num) DO UPDATE SET
                       name = EXCLUDED.name,
                       channel_multiplier = EXCLUDED.channel_multiplier,
                       channel_type = EXCLUDED.channel_type,
                       updated_at = NOW()""",
                (device_gid, channel_num, name, channel_multiplier, channel_type),
            )
        conn.commit()

    def write_readings(self, readings):
        """Batch-insert Vue readings. Each reading is (device_gid, channel_num, timestamp, value).

        Uses ON CONFLICT to deduplicate (same device + channel + timestamp).
        """
        if not readings:
            return
        conn = self._get_conn()
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO vue_readings (device_gid, channel_num, timestamp, value)
                   VALUES %s
                   ON CONFLICT (device_gid, channel_num, timestamp) DO UPDATE SET
                       value = EXCLUDED.value""",
                readings,
                template="(%s, %s, %s, %s)",
            )
        conn.commit()

    def close(self):
        """Close the database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()


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

    def __init__(self, username, password, pg_writer=None):
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
        self._poll_interval = DEFAULT_POLL_INTERVAL
        self._next_poll_at = 0.0
        self._pg = pg_writer

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
        pg_readings = []  # (device_id, metric_name, timestamp, value)
        pg_devices = []   # (device_id, class, alias, manufacturer, product_code, uid)
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

            # ── Accumulate Postgres readings ──
            if self._pg:
                bat_device_id = bat_labels["device"]
                sol_device_id = sol_labels["device"]
                pg_devices.append((bat_device_id, "storage_battery", dev_name,
                                   "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn))
                pg_devices.append((sol_device_id, "home_solar", dev_name,
                                   "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn))
                ts = now_utc
                pg_readings.extend([
                    (sol_device_id, "solar_instantaneous_generation_watts", ts, solar_w),
                    (bat_device_id, "battery_state_of_capacity_percent", ts, soc),
                    (bat_device_id, "grid_power_watts", ts, grid_w),
                    (bat_device_id, "home_load_power_watts", ts, backup_w),
                    (bat_device_id, "battery_power_watts", ts, battery_w),
                    (bat_device_id, "self_sufficiency_rate", ts, self_help),
                    (bat_device_id, "battery_stored_kwh", ts, bat_stored_kwh),
                    (bat_device_id, "battery_peak_stored_kwh", ts, bat_peak_kwh),
                ])

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

                # Accumulate daily totals for Postgres
                if self._pg:
                    bat_dev_id = f"epcube{dev['id']}_battery"
                    sol_dev_id = f"epcube{dev['id']}_solar"
                    pg_readings.extend([
                        (sol_dev_id, "solar_cumulative_generation_kwh", now_utc, solar_kwh),
                        (bat_dev_id, "grid_import_kwh", now_utc, grid_from),
                        (bat_dev_id, "grid_export_kwh", now_utc, grid_to),
                        (bat_dev_id, "home_supply_cumulative_kwh", now_utc, backup_kwh),
                    ])

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

        # ── Write to PostgreSQL (if configured) ──
        if self._pg and (pg_devices or pg_readings):
            try:
                for d in pg_devices:
                    self._pg.upsert_device(*d)
                self._pg.write_readings(pg_readings)
                log.info("Postgres: wrote %d readings for %d devices", len(pg_readings), len(pg_devices) // 2)
            except Exception as e:
                log.error("Postgres write failed: %s", e)

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
                "poll_interval": self._poll_interval,
                "next_poll_at": self._next_poll_at,
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
    poll_interval = status.get("poll_interval", DEFAULT_POLL_INTERVAL)
    next_poll_at = status.get("next_poll_at", 0)
    next_in = max(0, int(next_poll_at - time.time())) if next_poll_at else None
    next_str = f"{next_in}s" if next_in is not None else "waiting"

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
  <span>Poll interval: <b>{poll_interval}s</b></span>
  <span>Next poll in: <b id="countdown" data-next="{next_poll_at}">{next_str}</b></span>
</div>
{tables_html}
<script>
function convertTimes() {{
  document.querySelectorAll('.utctime').forEach(el => {{
    const d = new Date(el.dataset.utc);
    el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', hour12: true}});
  }});
}}
convertTimes();

// Countdown timer — ticks every second, reads target from data-next attribute
// so it survives innerHTML replacement from auto-refresh.
setInterval(() => {{
  const el = document.getElementById('countdown');
  if (!el) return;
  const nextAt = parseFloat(el.dataset.next);
  if (!nextAt) return;
  const left = Math.max(0, Math.round(nextAt - Date.now() / 1000));
  el.textContent = left + 's';
}}, 1000);

// Background auto-refresh: fetches new HTML and swaps body content in-place.
// No full page reload = no focus stealing.
setInterval(async () => {{
  try {{
    const resp = await fetch(location.href);
    if (!resp.ok) return;
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    convertTimes();
  }} catch (e) {{}}
}}, {poll_interval * 1000});
</script>
<div class="footer">Auto-refreshes every {poll_interval}s &middot; Last 10 polls (~10 min) &middot;
  <a href="/vue" style="color:#00d4aa">Emporia Vue</a> &middot;
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
    collector = None  # Set by main (EpCubeCollector or None)
    vue_collector = None  # Set by main (VueCollector or None)
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
            if self.collector:
                body = self.collector.get_metrics().encode()
            else:
                body = b"# No EP Cube collector configured\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/health":
            if self.collector:
                health = self.collector.get_health()
            else:
                health = {"healthy": True, "checks": []}
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
            if self.collector:
                status = self.collector.get_status()
                health = self.collector.get_health()
                body = _render_status_page(status, health).encode()
            else:
                body = b"""<!DOCTYPE html><html><head><meta charset="utf-8">
                <title>epcube-exporter status</title>
                <style>body { font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }
                a { color: #00d4aa; }</style>
                </head><body>
                <h1>epcube-exporter</h1>
                <p>EP Cube collector: disabled</p>
                <p><a href="/vue">Emporia Vue Status</a></p>
                </body></html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/vue":
            if not self._check_auth():
                return
            vue_status = self.vue_collector.get_status() if self.vue_collector else None
            body = _render_vue_debug_page(vue_status).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress per-request logging


# ---------------------------------------------------------------------------
# Vue downsampling and retention
# ---------------------------------------------------------------------------

def downsample_vue_readings(writer):
    """Aggregate raw 1-second Vue readings into 1-minute averages.

    Processes data from the last complete hour. Idempotent — uses
    ON CONFLICT to update existing rows.
    """
    conn = writer._get_conn()
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO vue_readings_1min (device_gid, channel_num, timestamp, value, sample_count)
            SELECT device_gid, channel_num,
                   date_trunc('minute', timestamp) AS minute_ts,
                   avg(value),
                   count(*)
            FROM vue_readings
            WHERE timestamp < date_trunc('hour', NOW())
              AND timestamp >= date_trunc('hour', NOW()) - INTERVAL '1 hour'
            GROUP BY device_gid, channel_num, date_trunc('minute', timestamp)
            ON CONFLICT (device_gid, channel_num, timestamp) DO UPDATE SET
                value = EXCLUDED.value,
                sample_count = EXCLUDED.sample_count
        """)
    conn.commit()
    log.info("Vue: downsampled readings for the last complete hour")


def cleanup_old_vue_readings(writer):
    """Delete raw Vue readings older than 7 days.

    Does NOT touch vue_readings_1min (retained indefinitely).
    Returns the number of rows deleted.
    """
    conn = writer._get_conn()
    with conn.cursor() as cur:
        cur.execute("""
            DELETE FROM vue_readings
            WHERE timestamp < NOW() - INTERVAL '7 days'
        """)
        deleted = cur.rowcount
    conn.commit()
    if deleted > 0:
        log.info("Vue: cleaned up %d raw readings older than 7 days", deleted)
    return deleted


def downsampling_loop(writer, interval_seconds=3600):
    """Background thread: runs downsampling + cleanup periodically."""
    while True:
        try:
            downsample_vue_readings(writer)
            cleanup_old_vue_readings(writer)
        except Exception:
            log.exception("Vue downsampling/cleanup failed")
        time.sleep(interval_seconds)


# ---------------------------------------------------------------------------
# Vue collector
# ---------------------------------------------------------------------------

# Import PyEmVue (optional — only needed when Vue credentials are set)
PyEmVue = None
try:
    from pyemvue import PyEmVue
    from pyemvue.enums import Scale, Unit
except ImportError:
    pass

DEFAULT_VUE_POLL_INTERVAL = 1  # seconds
DEFAULT_VUE_DEVICE_REFRESH_INTERVAL = 1800  # 30 minutes

# kWh-to-watts multiplier per scale
_SCALE_WATTS_MULTIPLIER = {
    "1S": 3_600_000,    # 1 second: kWh * 3,600,000
    "1MIN": 60_000,     # 1 minute: kWh * 60,000
}


def _read_vue_poll_interval_from_db():
    """Read vue_poll_interval_seconds from settings table. Returns default on any error."""
    if not POSTGRES_DSN:
        return DEFAULT_VUE_POLL_INTERVAL
    try:
        import psycopg2 as _pg
        conn = _pg.connect(POSTGRES_DSN)
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = 'vue_poll_interval_seconds'")
            row = cur.fetchone()
            if row:
                val = int(str(row[0]).strip('"'))
                if 1 <= val <= 3600:
                    return val
        finally:
            conn.close()
    except Exception:
        log.debug("Could not read Vue poll interval from DB, using default %ds", DEFAULT_VUE_POLL_INTERVAL)
    return DEFAULT_VUE_POLL_INTERVAL


class VueCollector:
    """Collects power data from Emporia Vue devices via PyEmVue."""

    RECOVERY_THRESHOLD = 10  # successful polls at 1MIN before trying 1S again

    def __init__(self, username, password, pg_writer=None):
        self._username = username
        self._password = password
        self._pg_writer = pg_writer
        self._vue = None
        self._authenticated = False
        self._lock = threading.Lock()
        self._last_poll = 0.0
        self._poll_errors = 0
        self._consecutive_errors = 0
        self._device_count = 0
        self._circuit_count = 0
        self._device_gids = []
        self._devices_info = []  # list of device status dicts for debug page
        self._current_scale = "1S"
        self._recovery_count = 0
        self._poll_interval = DEFAULT_VUE_POLL_INTERVAL
        self._next_poll_at = 0.0
        self._last_device_refresh = 0.0
        self._start_time = time.time()
        self._last_readings = {}  # {(device_gid, channel_num): watts}
        self._channel_names = {}  # {(device_gid, channel_num): name}

        self._login()

    def _login(self):
        """Authenticate with the Emporia API via PyEmVue."""
        try:
            self._vue = PyEmVue()
            self._vue.login(username=self._username, password=self._password)
            self._authenticated = True
            log.info("Vue: authenticated as %s", self._username)
            self._discover_devices()
        except Exception:
            log.exception("Vue: authentication failed")
            self._authenticated = False

    def _discover_devices(self):
        """Discover Vue devices and channels from the Emporia API."""
        try:
            raw_devices = self._vue.get_devices()
            # PyEmVue returns multiple entries per device_gid (VUE003 hub +
            # WAT001 CT module).  Merge them: take name/connected from the first
            # entry with a name, merge channels from all entries.
            merged = {}  # gid -> merged device info
            for d in raw_devices:
                gid = d.device_gid
                if gid not in merged:
                    merged[gid] = {
                        "device": d,
                        "channels": list(d.channels),
                    }
                else:
                    # Merge: prefer named entry for device metadata
                    if d.device_name and not merged[gid]["device"].device_name:
                        merged[gid]["device"] = d
                    # Add any new channels (avoid dups by channel_num)
                    existing_nums = {ch.channel_num for ch in merged[gid]["channels"]}
                    for ch in d.channels:
                        if ch.channel_num not in existing_nums:
                            merged[gid]["channels"].append(ch)
                            existing_nums.add(ch.channel_num)

            devices = list(merged.values())
            self._device_gids = [info["device"].device_gid for info in devices]
            self._device_count = len(devices)
            self._circuit_count = sum(len(info["channels"]) for info in devices)
            self._devices_info = []
            for info in devices:
                d = info["device"]
                channels = info["channels"]
                self._devices_info.append({
                    "device_gid": d.device_gid,
                    "name": d.device_name,
                    "connected": d.connected,
                    "channels": len(channels),
                })
                log.info("Vue:   Device: %s (gid=%d, channels=%d, online=%s)",
                         d.device_name, d.device_gid, len(channels), d.connected)

                # Persist device and channel metadata
                for ch in channels:
                    self._channel_names[(ch.device_gid, ch.channel_num)] = ch.name or ""
                if self._pg_writer:
                    self._pg_writer.upsert_device(
                        device_gid=d.device_gid, device_name=d.device_name,
                        model=getattr(d, "model", None),
                        firmware=getattr(d, "firmware", None),
                        connected=d.connected,
                    )
                    for ch in channels:
                        self._pg_writer.upsert_channel(
                            device_gid=ch.device_gid, channel_num=ch.channel_num,
                            name=ch.name,
                            channel_multiplier=getattr(ch, "channel_multiplier", None),
                            channel_type=getattr(ch, "channel_type_gid", None),
                        )

            self._last_device_refresh = time.time()
            log.info("Vue: discovered %d device(s), %d circuit(s)", self._device_count, self._circuit_count)
        except Exception:
            log.exception("Vue: device discovery failed")

    def poll(self):
        """Fetch usage data from all Vue devices and write to PostgreSQL."""
        # Retry login if not authenticated
        if not self._authenticated:
            self._login()
            if not self._authenticated:
                with self._lock:
                    self._poll_errors += 1
                    self._consecutive_errors += 1
                return

        # Periodic device/channel refresh
        refresh_interval = DEFAULT_VUE_DEVICE_REFRESH_INTERVAL
        if time.time() - self._last_device_refresh > refresh_interval:
            self._discover_devices()

        if not self._device_gids:
            return

        multiplier = _SCALE_WATTS_MULTIPLIER.get(self._current_scale, 3_600_000)
        all_none = True
        readings = []

        try:
            usage = self._vue.get_device_list_usage(
                deviceGids=self._device_gids,
                instant=datetime.now(timezone.utc),
                scale=self._current_scale,
                unit="KilowattHours",
                max_retry_attempts=1,
            )

            for device_gid, device_usage in usage.items():
                try:
                    ts = device_usage.timestamp
                    if ts and ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    for ch_num, ch_usage in device_usage.channels.items():
                        if ch_usage.usage is None:
                            continue
                        all_none = False
                        watts = ch_usage.usage * multiplier
                        readings.append((device_gid, ch_num, ts, watts))
                        self._last_readings[(device_gid, ch_num)] = watts
                except Exception:
                    log.exception("Vue: error processing device %d", device_gid)
                    with self._lock:
                        self._poll_errors += 1

        except Exception:
            log.exception("Vue: API call failed")
            with self._lock:
                self._poll_errors += 1
                self._consecutive_errors += 1
            return

        # Write readings to PostgreSQL
        if readings and self._pg_writer:
            self._pg_writer.write_readings(readings)

        with self._lock:
            self._last_poll = time.time()
            if readings:
                self._consecutive_errors = 0

        # Rate limit handling: if all channels returned None, degrade scale
        if all_none and self._device_gids:
            if self._current_scale == "1S":
                self._current_scale = "1MIN"
                self._recovery_count = 0
                log.warning("Vue: rate limited — degrading to 1MIN scale")
        elif self._current_scale == "1MIN" and not all_none:
            self._recovery_count += 1
            if self._recovery_count >= self.RECOVERY_THRESHOLD:
                self._current_scale = "1S"
                self._recovery_count = 0
                log.info("Vue: recovered — returning to 1S scale")

    def get_status(self):
        """Return current Vue collector status for the debug page."""
        with self._lock:
            return {
                "device_count": self._device_count,
                "circuit_count": self._circuit_count,
                "last_poll": self._last_poll,
                "poll_errors": self._poll_errors,
                "consecutive_errors": self._consecutive_errors,
                "current_scale": self._current_scale,
                "poll_interval": self._poll_interval,
                "next_poll_at": self._next_poll_at,
                "authenticated": self._authenticated,
                "devices": list(self._devices_info),
                "uptime_s": int(time.time() - self._start_time),
                "last_readings": dict(self._last_readings),
                "channel_names": dict(self._channel_names),
            }


def _render_vue_debug_page(vue_status):
    """Render a full HTML debug page for Vue collector status with per-circuit data."""
    if not vue_status:
        return """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Emporia Vue — not configured</title>
<style>body { font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }
a { color: #00d4aa; }</style>
</head><body>
<h1>Emporia Vue</h1>
<p>Vue polling is not configured. Set EMPORIA_USERNAME and EMPORIA_PASSWORD to enable.</p>
<p><a href="/status">&larr; EP Cube Status</a></p>
</body></html>"""

    last_poll = vue_status["last_poll"]
    if last_poll > 0:
        last_poll_ts = last_poll * 1000  # JS timestamp in ms
        last_poll_str = f'<span class="localtime" data-ts="{last_poll_ts}">loading...</span>'
        ago = int(time.time() - last_poll)
        last_poll_str += f" ({ago}s ago)"
    else:
        last_poll_str = "never"

    next_poll_at = vue_status.get("next_poll_at", 0)
    next_in = max(0, int(next_poll_at - time.time())) if next_poll_at else None
    next_str = f"{next_in}s" if next_in is not None else "waiting"

    # Build per-device sections with circuit tables
    readings = vue_status.get("last_readings", {})
    channel_names = vue_status.get("channel_names", {})
    devices_html = ""

    for dev in vue_status.get("devices", []):
        gid = dev["device_gid"]
        status_cls = "val-pos" if dev.get("connected") else "val-neg"
        status_txt = "online" if dev.get("connected") else "offline"

        # Gather circuits for this device, sorted by channel_num
        circuits = []
        for (d_gid, ch_num), watts in readings.items():
            if d_gid == gid:
                name = channel_names.get((d_gid, ch_num), "")
                circuits.append((ch_num, name, watts))

        # Sort: mains first, then numeric channels, then text channels
        def _sort_key(c):
            ch = c[0]
            if ch == "1,2,3":
                return (0, "")
            if ch == "Balance":
                return (2, "")
            try:
                return (1, int(ch))
            except ValueError:
                return (1, 999)
        circuits.sort(key=_sort_key)

        rows = ""
        for ch_num, name, watts in circuits:
            display_name = name if name else ch_num
            if watts >= 1000:
                watts_str = f"{watts / 1000:.1f} kW"
            else:
                watts_str = f"{watts:.0f} W"
            row_cls = ' class="val-pos"' if watts > 0 else ""
            rows += f"<tr><td>{ch_num}</td><td>{display_name}</td><td style='text-align:right'{row_cls}>{watts_str}</td></tr>\n"

        if not rows:
            rows = '<tr><td colspan="3" style="color:#888">No readings yet</td></tr>'

        devices_html += f"""
        <div style="margin-bottom:1.5em">
        <h3>{dev['name']} <span class="badge {status_cls}">{status_txt}</span>
            <span class="badge" style="color:#888">GID: {gid}</span></h3>
        <table>
        <tr><th>Channel</th><th>Circuit</th><th style="text-align:right">Power</th></tr>
        {rows}
        </table>
        </div>
        """

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Emporia Vue — debug status</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }}
  h1 {{ color: #00d4aa; font-size: 1.3em; }}
  h3 {{ color: #e0e0e0; margin-bottom: 0.3em; }}
  a {{ color: #00d4aa; }}
  .info {{ display: flex; gap: 2em; margin-bottom: 1.5em; font-size: 0.9em; flex-wrap: wrap; }}
  .info span {{ background: #16213e; padding: 0.4em 0.8em; border-radius: 4px; }}
  .badge {{ font-size: 0.75em; background: #16213e; padding: 0.2em 0.6em; border-radius: 4px; margin-left: 0.5em; vertical-align: middle; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.85em; margin-bottom: 0.5em; }}
  th, td {{ padding: 0.4em 0.8em; border: 1px solid #2a2a4a; }}
  th {{ background: #16213e; text-align: left; }}
  tr:hover {{ background: #16213e; }}
  .val-pos {{ color: #00d4aa; }}
  .val-neg {{ color: #e74c3c; }}
  .footer {{ margin-top: 1.5em; font-size: 0.8em; color: #666; }}
</style>
</head><body>
<h1>&#9889; Emporia Vue — debug status</h1>
<div class="info">
  <span>Devices: <b>{vue_status["device_count"]}</b></span>
  <span>Circuits: <b>{vue_status["circuit_count"]}</b></span>
  <span>Scale: <b>{vue_status["current_scale"]}</b></span>
  <span>Poll interval: <b>{vue_status["poll_interval"]}s</b></span>
  <span>Last poll: <b>{last_poll_str}</b></span>
  <span>Next poll in: <b id="countdown" data-next="{next_poll_at}">{next_str}</b></span>
  <span>Errors: <b>{vue_status["poll_errors"]}</b> total, <b>{vue_status["consecutive_errors"]}</b> consecutive</span>
</div>
{devices_html}
<script>
// Convert timestamps to local time
document.querySelectorAll('.localtime').forEach(el => {{
  const ts = parseFloat(el.dataset.ts);
  if (!ts) return;
  const d = new Date(ts);
  el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true}});
}});

// Countdown timer
setInterval(() => {{
  const el = document.getElementById('countdown');
  if (!el) return;
  const nextAt = parseFloat(el.dataset.next);
  if (!nextAt) return;
  const left = Math.max(0, Math.round(nextAt - Date.now() / 1000));
  el.textContent = left + 's';
}}, 1000);

// Auto-refresh every 5 seconds (Vue polls at 1s, page refreshes at 5s)
setInterval(async () => {{
  try {{
    const resp = await fetch(location.href);
    if (!resp.ok) return;
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    document.querySelectorAll('.localtime').forEach(el => {{
      const ts = parseFloat(el.dataset.ts);
      if (!ts) return;
      const d = new Date(ts);
      el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true}});
    }});
  }} catch (e) {{}}
}}, 5000);
</script>
<div class="footer">
  Auto-refreshes every 5s &middot;
  <a href="/status">EP Cube Status</a> &middot;
  <a href="/health">/health</a>
</div>
</body></html>"""


def vue_poll_loop(collector):
    """Background thread: polls Vue API on schedule."""
    while True:
        current_interval = _read_vue_poll_interval_from_db()
        with collector._lock:
            collector._poll_interval = current_interval
            collector._next_poll_at = time.time() + current_interval
        time.sleep(current_interval)
        try:
            collector.poll()
        except Exception:
            log.exception("Vue poll failed")
            with collector._lock:
                collector._poll_errors += 1
                collector._consecutive_errors += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _read_poll_interval_from_db():
    """Read epcube_poll_interval_seconds from settings table. Returns default on any error."""
    if not POSTGRES_DSN:
        return DEFAULT_POLL_INTERVAL
    try:
        import psycopg2
        conn = psycopg2.connect(POSTGRES_DSN)
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = 'epcube_poll_interval_seconds'")
            row = cur.fetchone()
            if row:
                val = int(str(row[0]).strip('"'))
                if 1 <= val <= 3600:
                    return val
        finally:
            conn.close()
    except Exception:
        log.debug("Could not read poll interval from DB, using default %ds", DEFAULT_POLL_INTERVAL)
    return DEFAULT_POLL_INTERVAL


def poll_loop(collector):
    """Background thread: polls API on schedule. Reads interval from DB each cycle."""
    while True:
        current_interval = _read_poll_interval_from_db()
        with collector._lock:
            collector._poll_interval = current_interval
            collector._next_poll_at = time.time() + current_interval
        time.sleep(current_interval)
        try:
            collector.poll()
        except Exception:
            log.exception("Poll failed")
            with collector._lock:
                collector._poll_errors += 1
                collector._consecutive_errors += 1


def main():
    epcube_username = os.environ.get("EPCUBE_USERNAME")
    epcube_password = os.environ.get("EPCUBE_PASSWORD")
    emporia_username = os.environ.get("EMPORIA_USERNAME")
    emporia_password = os.environ.get("EMPORIA_PASSWORD")

    has_epcube = bool(epcube_username and epcube_password)
    has_emporia = bool(emporia_username and emporia_password)

    if not has_epcube and not has_emporia:
        log.error("At least one credential set required: EPCUBE_USERNAME/PASSWORD or EMPORIA_USERNAME/PASSWORD")
        sys.exit(1)

    # Initialize Postgres writer if configured
    pg_writer = None
    vue_pg_writer = None
    if POSTGRES_DSN:
        if psycopg2 is None:
            log.error("POSTGRES_DSN is set but psycopg2 is not installed")
            sys.exit(1)
        pg_writer = PostgresWriter(POSTGRES_DSN)
        vue_pg_writer = VuePostgresWriter(POSTGRES_DSN)
        log.info("PostgreSQL storage enabled: %s", POSTGRES_DSN.split("@")[-1] if "@" in POSTGRES_DSN else "(DSN)")

    # Start EP Cube collector if credentials are configured
    collector = None
    if has_epcube:
        collector = EpCubeCollector(epcube_username, epcube_password, pg_writer=pg_writer)
        collector.poll()
        poll_thread = threading.Thread(target=poll_loop, args=(collector,), daemon=True)
        poll_thread.start()
    else:
        log.warning("EPCUBE_USERNAME/PASSWORD not set — EP Cube collector disabled")

    # Start Vue collector if credentials are configured
    vue_collector = None
    if has_emporia:
        vue_collector = VueCollector(emporia_username, emporia_password, pg_writer=vue_pg_writer)
        vue_poll_thread = threading.Thread(target=vue_poll_loop, args=(vue_collector,), daemon=True)
        vue_poll_thread.start()
        # Start downsampling loop if PostgreSQL is configured
        if vue_pg_writer:
            ds_thread = threading.Thread(target=downsampling_loop, args=(vue_pg_writer,), daemon=True)
            ds_thread.start()
    else:
        log.warning("EMPORIA_USERNAME/PASSWORD not set — Vue collector disabled")

    # Start HTTP server
    MetricsHandler.collector = collector
    MetricsHandler.vue_collector = vue_collector
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
