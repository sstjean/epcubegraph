"""
EP Cube Cloud Exporter — Bridges EP Cube cloud API to Prometheus metrics.

Polls the EP Cube monitoring API (monitoring-us.epcube.com) and exposes 
Prometheus-compatible metrics on :9200/metrics for VictoriaMetrics to scrape.

Produces the same echonet_* metric names as the mock exporter so the API
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
import json
import logging
import os
import sys
import threading
import time
import urllib.error
import urllib.request
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

    def __init__(self, username, password):
        self._username = username
        self._password = password
        self._token = None
        self._devices = []
        self._lock = threading.Lock()
        self._metrics_text = ""
        self._last_poll = 0.0

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

            lines.append("# HELP echonet_solar_instantaneous_generation_watts Current solar generation")
            lines.append("# TYPE echonet_solar_instantaneous_generation_watts gauge")
            lines.append(f"echonet_solar_instantaneous_generation_watts{{{sl}}} {solar_w}")

            # ── Battery metrics ──
            soc = float(data.get("batterySoc", 0))
            battery_kw = float(data.get("batteryPower", 0))
            battery_w = round(battery_kw * 1000, 1)

            lines.append("# HELP echonet_battery_state_of_capacity_percent Battery SoC")
            lines.append("# TYPE echonet_battery_state_of_capacity_percent gauge")
            lines.append(f"echonet_battery_state_of_capacity_percent{{{bl}}} {soc}")

            lines.append("# HELP echonet_battery_charge_discharge_power_watts Charge/discharge power")
            lines.append("# TYPE echonet_battery_charge_discharge_power_watts gauge")
            lines.append(f"echonet_battery_charge_discharge_power_watts{{{bl}}} {battery_w}")

            # Working operation state
            if battery_w > 50:
                op_state = 0x42  # Charging
            elif battery_w < -50:
                op_state = 0x43  # Discharging
            else:
                op_state = 0x44  # Standby

            lines.append("# HELP echonet_battery_working_operation_state Operation state code")
            lines.append("# TYPE echonet_battery_working_operation_state gauge")
            lines.append(f"echonet_battery_working_operation_state{{{bl}}} {op_state}")

            # ── Grid metrics ──
            grid_kw = float(data.get("gridPower", 0))
            grid_w = round(grid_kw * 1000, 1)

            lines.append("# HELP echonet_grid_power_watts Grid import/export power")
            lines.append("# TYPE echonet_grid_power_watts gauge")
            lines.append(f"echonet_grid_power_watts{{{bl}}} {grid_w}")

            # ── Backup/home load metrics ──
            backup_kw = float(data.get("backUpPower", 0))
            backup_w = round(backup_kw * 1000, 1)

            lines.append("# HELP echonet_home_load_power_watts Home load power consumption")
            lines.append("# TYPE echonet_home_load_power_watts gauge")
            lines.append(f"echonet_home_load_power_watts{{{bl}}} {backup_w}")

            # ── Self-sufficiency rate ──
            self_help = float(data.get("selfHelpRate", 0))
            lines.append("# HELP echonet_self_sufficiency_rate Self-sufficiency percentage")
            lines.append("# TYPE echonet_self_sufficiency_rate gauge")
            lines.append(f"echonet_self_sufficiency_rate{{{bl}}} {self_help}")

            # ── Scrape health ──
            now_ts = int(time.time())
            for d_labels in [bat_labels, sol_labels]:
                dl = ",".join(f'{k}="{v}"' for k, v in d_labels.items())
                lines.append(f"echonet_scrape_success{{{dl}}} 1")
                lines.append(f"echonet_last_scrape_timestamp_seconds{{{dl}}} {now_ts}")

            # ── Device info ──
            for d_labels, d_class in [(bat_labels, "storage_battery"), (sol_labels, "home_solar")]:
                info_labels = {
                    **d_labels,
                    "manufacturer": "Canadian Solar",
                    "product_code": f"EP Cube (devType={dev_type})",
                    "uid": sg_sn,
                }
                il = ",".join(f'{k}="{v}"' for k, v in info_labels.items())
                lines.append(f"echonet_device_info{{{il}}} 1")

        # Also try to get daily energy totals
        for dev in self._devices:
            if dev.get("isOnline") != "1":
                continue
            try:
                from datetime import datetime
                today = datetime.now().strftime("%Y-%m-%d")
                elec = self._api(f"/home/queryDataElectricityV2?devId={dev['id']}&scopeType=1&queryDateStr={today}")
                edata = elec.get("data", {})

                bl = f'device="epcube{dev["id"]}_battery",ip="cloud",class="storage_battery"'

                solar_kwh = float(edata.get("solarElectricity", 0))
                lines.append("# HELP echonet_solar_cumulative_generation_kwh Total energy generated today")
                lines.append("# TYPE echonet_solar_cumulative_generation_kwh gauge")
                lines.append(f"echonet_solar_cumulative_generation_kwh{{{bl}}} {solar_kwh}")

                grid_from = float(edata.get("gridElectricityFrom", 0))
                grid_to = float(edata.get("gridElectricityTo", 0))
                lines.append("# HELP echonet_grid_import_kwh Grid energy imported today")
                lines.append("# TYPE echonet_grid_import_kwh gauge")
                lines.append(f"echonet_grid_import_kwh{{{bl}}} {grid_from}")
                lines.append("# HELP echonet_grid_export_kwh Grid energy exported today")
                lines.append("# TYPE echonet_grid_export_kwh gauge")
                lines.append(f"echonet_grid_export_kwh{{{bl}}} {grid_to}")

                bat_charge = float(edata.get("batteryElectricityImported", 0))
                bat_discharge = float(edata.get("batteryElectricityExported", 0))
                lines.append("# HELP echonet_battery_cumulative_charge_kwh Battery energy charged today")
                lines.append("# TYPE echonet_battery_cumulative_charge_kwh gauge")
                lines.append(f"echonet_battery_cumulative_charge_kwh{{{bl}}} {bat_charge}")
                lines.append("# HELP echonet_battery_cumulative_discharge_kwh Battery energy discharged today")
                lines.append("# TYPE echonet_battery_cumulative_discharge_kwh gauge")
                lines.append(f"echonet_battery_cumulative_discharge_kwh{{{bl}}} {bat_discharge}")

            except Exception as e:
                log.warning("Failed to fetch daily energy for device %s: %s", dev.get("name"), e)

        lines.append("")
        with self._lock:
            self._metrics_text = "\n".join(lines)
            self._last_poll = time.time()

        log.info("Poll complete: %d metric lines for %d device(s)", len(lines), len(self._devices))

    def get_metrics(self):
        with self._lock:
            return self._metrics_text


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class MetricsHandler(BaseHTTPRequestHandler):
    collector = None  # Set by main

    def do_GET(self):
        if self.path == "/metrics":
            body = self.collector.get_metrics().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
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
        try:
            collector.poll()
        except Exception:
            log.exception("Poll failed")
        time.sleep(interval)


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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")


if __name__ == "__main__":
    main()
