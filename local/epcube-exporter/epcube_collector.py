"""EP Cube cloud API data collection and polling."""
import collections
import threading
import time
from datetime import datetime, timezone

from config import _safe_float, _nz, _TZ, DEFAULT_POLL_INTERVAL, DEFAULT_DISCOVERY_INTERVAL, POSTGRES_DSN, __version__, log
from auth import _api_request, authenticate, AuthExpiredError, _jwt_exp


def parse_device_metrics(data):
    """Extract structured metrics from EP Cube API homeDeviceInfo response.

    Pure function — no side effects, no I/O.
    """
    solar_kw = _nz(_safe_float(data.get("solarPower", 0)))
    grid_kw = _nz(_safe_float(data.get("gridPower", 0)))
    backup_kw = _nz(_safe_float(data.get("backUpPower", 0)))
    battery_kw = _nz(round(solar_kw + grid_kw - backup_kw, 2))
    return {
        "solar_kw": solar_kw,
        "solar_w": _nz(round(solar_kw * 1000, 1)),
        "soc": _nz(_safe_float(data.get("batterySoc", 0))),
        "grid_kw": grid_kw,
        "grid_w": _nz(round(grid_kw * 1000, 1)),
        "backup_kw": backup_kw,
        "backup_w": _nz(round(backup_kw * 1000, 1)),
        "battery_kw": battery_kw,
        "battery_w": _nz(round(battery_kw * 1000, 1)),
        "self_sufficiency": _nz(_safe_float(data.get("selfHelpRate", 0))),
        "bat_stored_kwh": _nz(_safe_float(data.get("batteryCurrentElectricity", 0))),
        "system_status_raw": data.get("systemStatus", "?"),
        "ress_count": data.get("ressNumber", "?"),
    }


def build_postgres_readings(dev_id, timestamp, metrics):
    """Build PostgreSQL reading tuples from structured metrics.

    Pure function — no side effects, no I/O.
    Returns list of (device_id, metric_name, timestamp, value).
    """
    bat = f"{dev_id}_battery"
    sol = f"{dev_id}_solar"
    return [
        (sol, "solar_instantaneous_generation_watts", timestamp, metrics["solar_w"]),
        (bat, "battery_state_of_capacity_percent", timestamp, metrics["soc"]),
        (bat, "grid_power_watts", timestamp, metrics["grid_w"]),
        (bat, "home_load_power_watts", timestamp, metrics["backup_w"]),
        (bat, "battery_power_watts", timestamp, metrics["battery_w"]),
        (bat, "self_sufficiency_rate", timestamp, metrics["self_sufficiency"]),
        (bat, "battery_stored_kwh", timestamp, metrics["bat_stored_kwh"]),
        (bat, "battery_peak_stored_kwh", timestamp, metrics.get("bat_peak_kwh", 0)),
    ]


def update_battery_peak(bat_peak, dev_id, bat_stored_kwh, today_str):
    """Track daily peak battery stored energy. Pure — mutates bat_peak dict.

    Returns the current peak value.
    """
    entry = bat_peak.get(dev_id)
    if entry and entry["date"] == today_str:
        entry["peak"] = max(entry["peak"], bat_stored_kwh)
    else:
        bat_peak[dev_id] = {"date": today_str, "peak": bat_stored_kwh}
    return bat_peak[dev_id]["peak"]


# ---------------------------------------------------------------------------
# Data collection
# ---------------------------------------------------------------------------

class EpCubeCollector:
    """Polls the EP Cube cloud API and writes telemetry to PostgreSQL."""

    # Keep last 10 minutes of snapshots (at 60s interval = ~10 entries)
    HISTORY_MAX = 10

    def __init__(self, username, password, pg_writer=None):
        self._username = username
        self._password = password
        self._token = None
        self._token_exp = 0  # JWT expiry timestamp
        self._devices = []
        self._lock = threading.Lock()
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
        self._polling = False

    def _ensure_auth(self):
        if not self._token or self._token_expiring_soon():
            if self._token:
                log.info("Token expiring within 5 min, proactively re-authenticating...")
            self._token = authenticate(self._username, self._password)
            self._token_exp = _jwt_exp(self._token)
            if self._token_exp:
                remaining = self._token_exp - time.time()
                log.info("Token expires in %.0f min", remaining / 60)

    def _token_expiring_soon(self):
        """Return True if token expires within 5 minutes."""
        if not self._token_exp:
            return False
        return time.time() > (self._token_exp - 300)

    def _reauth(self):
        log.info("Re-authenticating...")
        self._token = authenticate(self._username, self._password)
        self._token_exp = _jwt_exp(self._token)

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
        return all(_safe_float(data.get(f, 0)) == 0 for f in _FIELDS)

    def _api(self, path):
        try:
            return _api_request("GET", path, token=self._token)
        except AuthExpiredError:
            self._reauth()
            return _api_request("GET", path, token=self._token)

    def _discover_devices(self):
        self._ensure_auth()
        result = _api_request("GET", "/home/deviceList", token=self._token)
        if result.get("status") != 200:
            # Raise so retry_with_backoff actually retries on transient cloud
            # failures (e.g., 5xx, auth expiry). Silently returning here caused
            # the caller to treat the failure as success and advance
            # last_discovery_time, delaying the next discovery by a full
            # interval. (PR #137 review)
            raise RuntimeError(
                f"Cloud /home/deviceList returned status={result.get('status')}: "
                f"{result.get('message', 'no message')}"
            )

        cloud_devices = result["data"]

        # FR-007: Empty list guard
        if not cloud_devices:
            log.warning("Cloud returned empty device list — retaining current devices")
            return

        # Compare cloud list against known DB devices
        known_ids = self._pg.read_active_epcube_ids()
        cloud_ids = {str(d["id"]) for d in cloud_devices}
        added, removed, unchanged = compare_device_lists(known_ids, cloud_ids)

        # Register new devices in DB
        for dev_id in added:
            dev = next(d for d in cloud_devices if str(d["id"]) == dev_id)
            dev_name = dev.get("name", "unknown")
            sg_sn = dev.get("sgSn", "")
            dev_type = dev.get("devType", 0)
            base_id = f"epcube{dev_id}"
            self._pg.upsert_device(f"{base_id}_battery", "storage_battery", dev_name,
                                   "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn)
            self._pg.upsert_device(f"{base_id}_solar", "home_solar", dev_name,
                                   "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn)
            log.info("New device discovered: %s (id=%s, sn=%s)", dev_name, dev_id, sg_sn)

        # Mark removed devices in DB and log (FR-003, FR-004, FR-005)
        for dev_id in removed:
            self._pg.update_device_status(dev_id, "removed")
            log.warning("Device removed from cloud account: id=%s", dev_id)

        self._detect_replacements(added, removed)

        # Update device list for polling
        self._devices = cloud_devices
        log.info("Device discovery complete: %d device(s) (%d new, %d removed, %d unchanged)",
                 len(cloud_devices), len(added), len(removed), len(unchanged))

    def _detect_replacements(self, added, removed):
        """FR-010: Record pending replacement prompts.

        For each newly added device, look for any removed device with the same
        alias (covers both same-cycle and cross-cycle replacements).  For each
        removed device not already paired, look for an existing active device
        with the same alias.
        """
        paired_old = set()

        # Added devices: look for a removed predecessor by alias
        for new_id in added:
            old_id = self._pg.find_removed_predecessor(new_id)
            if old_id:
                self._pg.insert_pending_replacement(old_id, new_id)
                paired_old.add(old_id)
                log.info("Pending replacement recorded: old=%s new=%s", old_id, new_id)

        # Removed devices not already paired: look for an active replacement by alias
        for old_id in removed:
            if old_id in paired_old:
                continue
            new_id = self._pg.find_replacement_candidate(old_id)
            if new_id:
                self._pg.insert_pending_replacement(old_id, new_id)
                log.info("Cross-cycle pending replacement recorded: old=%s new=%s", old_id, new_id)

    def poll(self):
        """Fetch data from all devices and write to PostgreSQL."""
        with self._lock:
            if self._polling:
                log.warning("Poll already in progress, skipping")
                return
            self._polling = True
        try:
            self._poll_inner()
        finally:
            with self._lock:
                self._polling = False

    def _poll_inner(self):
        """Internal poll implementation."""
        self._ensure_auth()

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

            # ── Parse metrics from API response (pure function) ──
            m = parse_device_metrics(data)

            # ── Capture snapshot for debug UI ──
            _STATUS_MAP = {
                0: "Standby", 1: "Self-Use", 2: "Backup",
                3: "Off-Grid", 4: "Normal", 5: "Fault", 6: "Upgrading",
            }
            system_status = f"{_STATUS_MAP.get(m['system_status_raw'], m['system_status_raw'])} ({m['system_status_raw']})"

            # Track peak battery stored for the day (pure function)
            today_str = datetime.now(_TZ).strftime("%Y-%m-%d")
            bat_peak_kwh = update_battery_peak(self._bat_peak, dev_id, m["bat_stored_kwh"], today_str)
            m["bat_peak_kwh"] = bat_peak_kwh

            snapshot["devices"].append({
                "name": dev_name,
                "id": dev_id,
                "solar_kw": m["solar_kw"],
                "battery_soc": m["soc"],
                "battery_kw": m["battery_kw"],
                "grid_kw": m["grid_kw"],
                "backup_kw": m["backup_kw"],
                "self_sufficiency": m["self_sufficiency"],
                "system_status": system_status,
                "bat_stored_kwh": m["bat_stored_kwh"],
                "bat_peak_kwh": bat_peak_kwh,
                "ress_count": m["ress_count"],
                # daily totals filled in below
                "solar_kwh": 0.0,
                "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0,
                "backup_kwh": 0.0,
            })

            # ── Accumulate Postgres readings (pure function) ──
            base_id = f"epcube{dev_id}"
            pg_devices.append((f"{base_id}_battery", "storage_battery", dev_name,
                               "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn))
            pg_devices.append((f"{base_id}_solar", "home_solar", dev_name,
                               "Canadian Solar", f"EP Cube (devType={dev_type})", sg_sn))
            pg_readings.extend(build_postgres_readings(base_id, now_utc, m))

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

                solar_kwh = _nz(_safe_float(edata.get("solarElectricity", 0)))

                grid_from = _nz(_safe_float(edata.get("gridElectricityFrom", 0)))
                grid_to = _nz(_safe_float(edata.get("gridElectricityTo", 0)))

                backup_kwh = _nz(_safe_float(edata.get("backUpElectricity", 0)))

                # Merge daily totals into snapshot
                snap_dev = snap_by_id.get(dev["id"])
                if snap_dev:
                    snap_dev["solar_kwh"] = solar_kwh
                    snap_dev["grid_import_kwh"] = grid_from
                    snap_dev["grid_export_kwh"] = grid_to
                    snap_dev["backup_kwh"] = backup_kwh

                # Accumulate daily totals for Postgres
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

        with self._lock:
            self._last_poll = time.time()
            self._poll_count += 1
            self._consecutive_errors = 0
            # Replace last entry if same minute (avoid duplicates)
            if self._history and self._history[-1]["time_minute"] == snapshot["time_minute"]:
                self._history[-1] = snapshot
            else:
                self._history.append(snapshot)

        log.info("Poll complete: %d device(s)", len(self._devices))

        # ── Write to PostgreSQL ──
        if pg_devices or pg_readings:
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

    def run_poll_loop(self):
        """Background thread: polls API on schedule. Reads interval from DB each cycle."""
        log.info("EP Cube poll thread started")
        last_discovery_time = 0.0
        while True:
            try:
                current_interval = self._pg.read_setting_int(
                    "epcube_poll_interval_seconds", DEFAULT_POLL_INTERVAL, 1, 3600)
                discovery_interval = self._pg.read_setting_int(
                    "discovery_interval_seconds", DEFAULT_DISCOVERY_INTERVAL, 60, 86400)
                with self._lock:
                    self._poll_interval = current_interval
                    self._next_poll_at = time.time() + current_interval

                # Check if discovery is due (FR-008: fixed schedule, checked each poll cycle)
                now = time.time()
                if now - last_discovery_time >= discovery_interval:
                    try:
                        retry_with_backoff(self._discover_devices)
                        last_discovery_time = time.time()
                    except Exception:
                        log.exception("Device discovery failed after retries")

                # Poll BEFORE sleeping so newly-discovered devices begin emitting
                # telemetry on this cycle instead of after a full interval delay.
                self.poll()
                time.sleep(current_interval)
            except Exception:
                log.exception("EP Cube poll loop error")
                with self._lock:
                    self._poll_errors += 1
                    self._consecutive_errors += 1


def compare_device_lists(known_ids, cloud_devices):
    """Compare known device IDs with cloud device list.

    Returns (added, removed, unchanged) where each is a set of device IDs.
    """
    cloud_ids = set(cloud_devices)
    known_set = set(known_ids)
    added = cloud_ids - known_set
    removed = known_set - cloud_ids
    unchanged = known_set & cloud_ids
    return added, removed, unchanged


def retry_with_backoff(fn, max_retries=5, base_delay=30):
    """Retry a function with exponential backoff. Raises the last exception on failure."""
    last_exc = None
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                log.warning("Attempt %d/%d failed: %s — retrying in %ds",
                            attempt + 1, max_retries, e, delay)
                time.sleep(delay)
    raise last_exc
