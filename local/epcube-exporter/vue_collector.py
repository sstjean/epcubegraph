"""Emporia Vue energy monitor data collection."""
import threading
import time
from datetime import datetime, timezone

from config import POSTGRES_DSN, log, psycopg2

# Import PyEmVue (optional — only needed when Vue credentials are set)
PyEmVue = None
try:
    from pyemvue import PyEmVue
    from pyemvue.enums import Scale, Unit
except ImportError:
    pass

DEFAULT_VUE_POLL_INTERVAL = 1  # seconds
DEFAULT_VUE_DEVICE_REFRESH_INTERVAL = 1800  # 30 minutes
DEFAULT_VUE_DAILY_POLL_INTERVAL = 300  # seconds (5 minutes)

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


def _read_vue_device_refresh_interval_from_db():
    """Read vue_device_refresh_interval_seconds from settings table. Returns default on any error."""
    if not POSTGRES_DSN:
        return DEFAULT_VUE_DEVICE_REFRESH_INTERVAL
    try:
        import psycopg2 as _pg
        conn = _pg.connect(POSTGRES_DSN)
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = 'vue_device_refresh_interval_seconds'")
            row = cur.fetchone()
            if row:
                val = int(str(row[0]).strip('"'))
                if 60 <= val <= 86400:
                    return val
        finally:
            conn.close()
    except Exception:
        log.debug("Could not read Vue device refresh interval from DB, using default %ds", DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
    return DEFAULT_VUE_DEVICE_REFRESH_INTERVAL


def _read_vue_daily_poll_interval_from_db():
    """Read vue_daily_poll_interval_seconds from settings table. Returns default on any error."""
    if not POSTGRES_DSN:
        return DEFAULT_VUE_DAILY_POLL_INTERVAL
    try:
        conn = psycopg2.connect(POSTGRES_DSN)
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = 'vue_daily_poll_interval_seconds'")
            row = cur.fetchone()
            if row:
                val = int(str(row[0]).strip('"'))
                if 1 <= val <= 3600:
                    return val
        finally:
            conn.close()
    except Exception:
        log.debug("Could not read Vue daily poll interval from DB, using default %ds", DEFAULT_VUE_DAILY_POLL_INTERVAL)
    return DEFAULT_VUE_DAILY_POLL_INTERVAL


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
        self._had_successful_poll = False
        self._poll_interval = DEFAULT_VUE_POLL_INTERVAL
        self._next_poll_at = 0.0
        self._last_device_refresh = 0.0
        self._start_time = time.time()
        self._last_readings = {}  # {(device_gid, channel_num): watts}
        self._channel_names = {}  # {(device_gid, channel_num): name}
        self._polling = False

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
            device_gids = [info["device"].device_gid for info in devices]
            device_count = len(devices)
            circuit_count = sum(len(info["channels"]) for info in devices)
            devices_info = []
            for info in devices:
                d = info["device"]
                channels = info["channels"]
                devices_info.append({
                    "device_gid": d.device_gid,
                    "name": d.device_name,
                    "connected": d.connected,
                    "channels": len(channels),
                })
                log.info("Vue:   Device: %s (gid=%d, channels=%d, online=%s)",
                         d.device_name, d.device_gid, len(channels), d.connected)

                # Persist device and channel metadata
                channel_names = {}
                for ch in channels:
                    channel_names[(ch.device_gid, ch.channel_num)] = ch.name or ""
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

            with self._lock:
                self._device_gids = device_gids
                self._device_count = device_count
                self._circuit_count = circuit_count
                self._devices_info = devices_info
                self._channel_names.update(channel_names)
            self._last_device_refresh = time.time()
            log.info("Vue: discovered %d device(s), %d circuit(s)", device_count, circuit_count)
        except Exception:
            log.exception("Vue: device discovery failed")

    def poll(self):
        """Fetch usage data from all Vue devices and write to PostgreSQL."""
        with self._lock:
            if self._polling:
                log.warning("Vue poll already in progress, skipping")
                return
            self._polling = True
        try:
            self._poll_inner()
        finally:
            with self._lock:
                self._polling = False

    def _poll_inner(self):
        """Internal poll implementation."""
        # Retry login if not authenticated
        if not self._authenticated:
            self._login()
            if not self._authenticated:
                with self._lock:
                    self._poll_errors += 1
                    self._consecutive_errors += 1
                return

        # Periodic device/channel refresh
        refresh_interval = _read_vue_device_refresh_interval_from_db()
        if time.time() - self._last_device_refresh > refresh_interval:
            self._discover_devices()

        if not self._device_gids:
            return

        multiplier = _SCALE_WATTS_MULTIPLIER.get(self._current_scale, 3_600_000)
        all_none = True
        readings = []
        last_readings_update = {}

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
                        last_readings_update[(device_gid, ch_num)] = watts
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
        if readings:
            self._pg_writer.write_readings(readings)

        with self._lock:
            self._last_poll = time.time()
            self._last_readings.update(last_readings_update)
            if readings:
                self._consecutive_errors = 0

        # Rate limit handling: only degrade if we previously had data (not just all devices offline)
        if all_none and self._device_gids and self._had_successful_poll:
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

        if not all_none:
            self._had_successful_poll = True

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

    def poll_daily(self):
        """Fetch daily kWh totals from Vue API and write to PostgreSQL."""
        log.info("Vue daily: starting poll")
        if not self._authenticated:
            return
        if not self._device_gids:
            return

        try:
            usage = self._vue.get_device_list_usage(
                deviceGids=self._device_gids,
                instant=datetime.now(timezone.utc),
                scale="1D",
                unit="KilowattHours",
                max_retry_attempts=1,
            )

            today = datetime.now().strftime("%Y-%m-%d")
            readings = []
            for device_gid, device_usage in usage.items():
                for ch_num, ch_usage in device_usage.channels.items():
                    if ch_usage.usage is None:
                        continue
                    readings.append((device_gid, ch_num, today, ch_usage.usage))

            log.info("Vue daily: collected %d readings for %s", len(readings), today)
            if readings:
                self._pg_writer.upsert_daily_readings(readings)
                log.info("Vue daily: wrote %d readings for %s", len(readings), today)

        except Exception:
            log.exception("Vue daily poll failed")


def vue_poll_loop(collector):
    """Background thread: polls Vue API on schedule."""
    log.info("Vue poll thread started")
    while True:
        try:
            current_interval = _read_vue_poll_interval_from_db()
            with collector._lock:
                collector._poll_interval = current_interval
                collector._next_poll_at = time.time() + current_interval
            time.sleep(current_interval)
            collector.poll()
        except Exception:
            log.exception("Vue poll loop error")
            with collector._lock:
                collector._poll_errors += 1
                collector._consecutive_errors += 1


def vue_daily_poll_loop(collector):
    """Background thread: polls Vue API for daily kWh on schedule."""
    log.info("Vue daily poll thread started")
    while True:
        try:
            current_interval = _read_vue_daily_poll_interval_from_db()
            time.sleep(current_interval)
            collector.poll_daily()
        except Exception:
            log.exception("Vue daily poll loop error")
