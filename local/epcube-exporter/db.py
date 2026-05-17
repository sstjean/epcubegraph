"""PostgreSQL writers for EP Cube and Vue telemetry data."""
import time

from config import psycopg2, log, POSTGRES_DSN


def read_setting_int_from_db(key, default, min_val, max_val):
    """Read an integer setting from the settings table.

    Standalone function for use outside a writer context (e.g., Vue poll loops).
    Returns *default* on any error or when the value is outside [min_val, max_val].
    """
    if not POSTGRES_DSN:
        return default
    try:
        conn = psycopg2.connect(POSTGRES_DSN)
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
            row = cur.fetchone()
            if row:
                val = int(str(row[0]).strip('"'))
                if min_val <= val <= max_val:
                    return val
        finally:
            conn.close()
    except Exception:
        log.warning("Could not read %s from DB, using default %d", key, default, exc_info=True)
    return default


# ---------------------------------------------------------------------------
# EP Cube PostgreSQL writer
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    device_class TEXT NOT NULL,
    alias TEXT,
    manufacturer TEXT,
    product_code TEXT,
    uid TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

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

CREATE TABLE IF NOT EXISTS pending_replacements (
    id SERIAL PRIMARY KEY,
    old_device_id TEXT NOT NULL,
    new_device_id TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (old_device_id, new_device_id)
);
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

    def _rollback_safe(self):
        """Roll back the current transaction so the connection is reusable.

        psycopg2 leaves a connection in an aborted-transaction state after
        any failed query; subsequent queries on the same connection then
        raise InFailedSqlTransaction. Call this in every except-block that
        swallows a query exception. If rollback itself fails, drop the
        connection so the next _get_conn() reconnects from scratch.
        """
        try:
            if self._conn is not None and not self._conn.closed:
                self._conn.rollback()
        except Exception:
            log.warning("Connection rollback failed; dropping connection", exc_info=True)
            self._conn = None

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
                       status = 'active',
                       updated_at = NOW()""",
                (device_id, device_class, alias, manufacturer, product_code, uid),
            )
        conn.commit()

    def update_device_status(self, raw_cloud_id, status):
        """Update status for both _battery and _solar sub-devices of an EP Cube device."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            bat_id = f"epcube{raw_cloud_id}_battery"
            sol_id = f"epcube{raw_cloud_id}_solar"
            cur.execute(
                "UPDATE devices SET status = %s, updated_at = NOW() WHERE device_id IN (%s, %s)",
                (status, bat_id, sol_id),
            )
        conn.commit()

    def insert_pending_replacement(self, old_device_id, new_device_id):
        """Record a pending replacement prompt for a same-cycle add+remove pair.

        Both IDs are the raw cloud API device IDs (not the ``epcube{id}_battery`` form).
        Idempotent: re-inserting the same pair is a no-op.
        """
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO pending_replacements (old_device_id, new_device_id)
                   VALUES (%s, %s)
                   ON CONFLICT (old_device_id, new_device_id) DO NOTHING""",
                (old_device_id, new_device_id),
            )
        conn.commit()

    def find_replacement_candidate(self, old_raw_cloud_id):
        """Find the raw cloud id of an active device that appears to be a replacement
        for ``old_raw_cloud_id`` (which has just been marked ``removed``).

        A candidate is an *active* device whose ``alias`` matches the removed
        device's alias and whose ``created_at`` is strictly later than the
        removed device's ``created_at``. If multiple candidates exist, the most
        recently created one is returned. Returns ``None`` if no match is found
        or if the removed device has no alias.
        """
        conn = self._get_conn()
        old_battery_id = f"epcube{old_raw_cloud_id}_battery"
        with conn.cursor() as cur:
            cur.execute(
                """SELECT alias, created_at FROM devices WHERE device_id = %s""",
                (old_battery_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            alias, old_created = row
            if not alias:
                return None
            cur.execute(
                """SELECT device_id FROM devices
                   WHERE alias = %s
                     AND status = 'active'
                     AND device_id LIKE 'epcube%%_battery'
                     AND created_at > %s
                   ORDER BY created_at DESC
                   LIMIT 1""",
                (alias, old_created),
            )
            cand = cur.fetchone()
        if not cand:
            return None
        # Strip "epcube" prefix and "_battery" suffix to recover the raw cloud id.
        cand_dev_id = cand[0]
        if not cand_dev_id.startswith("epcube") or not cand_dev_id.endswith("_battery"):
            return None
        return cand_dev_id[len("epcube"):-len("_battery")]

    def find_removed_predecessor(self, new_raw_cloud_id):
        """Find the raw cloud id of a removed device that appears to be the
        predecessor of ``new_raw_cloud_id``.

        A predecessor is a device with ``status='removed'`` whose ``alias``
        matches the new device's alias and whose ``created_at`` is strictly
        earlier than the new device's ``created_at``.  If multiple candidates
        exist, the most recently created one is returned.  Returns ``None`` if
        no match is found or if the new device has no alias.
        """
        conn = self._get_conn()
        new_battery_id = f"epcube{new_raw_cloud_id}_battery"
        with conn.cursor() as cur:
            cur.execute(
                """SELECT alias, created_at FROM devices WHERE device_id = %s""",
                (new_battery_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            alias, new_created = row
            if not alias:
                return None
            cur.execute(
                """SELECT device_id FROM devices
                   WHERE alias = %s
                     AND status = 'removed'
                     AND device_id LIKE 'epcube%%_battery'
                     AND created_at < %s
                   ORDER BY created_at DESC
                   LIMIT 1""",
                (alias, new_created),
            )
            cand = cur.fetchone()
        if not cand:
            return None
        cand_dev_id = cand[0]
        if not cand_dev_id.startswith("epcube") or not cand_dev_id.endswith("_battery"):
            return None
        return cand_dev_id[len("epcube"):-len("_battery")]

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

    def read_active_epcube_ids(self):
        """Read active EP Cube device IDs from the database.

        Returns set of raw cloud device IDs (extracted from epcube{id}_* pattern).
        """
        try:
            conn = self._get_conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT device_id FROM devices WHERE status = 'active' AND device_id LIKE 'epcube%'"
                )
                rows = cur.fetchall()
                ids = set()
                for (device_id,) in rows:
                    raw = device_id.replace("epcube", "").rsplit("_", 1)[0]
                    ids.add(raw)
                return ids
        except Exception:
            log.warning("Could not read device IDs from DB", exc_info=True)
            self._rollback_safe()
            return set()

    def read_setting_int(self, key, default, min_val, max_val):
        """Read an integer setting from the settings table. Returns default on any error."""
        try:
            conn = self._get_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
                row = cur.fetchone()
                if row:
                    val = int(str(row[0]).strip('"'))
                    if min_val <= val <= max_val:
                        return val
        except Exception:
            log.warning("Could not read %s from DB, using default %d", key, default, exc_info=True)
            self._rollback_safe()
        return default


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

CREATE TABLE IF NOT EXISTS vue_readings_daily (
    device_gid BIGINT NOT NULL,
    channel_num TEXT NOT NULL,
    date DATE NOT NULL,
    kwh DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_gid, channel_num, date)
);

CREATE INDEX IF NOT EXISTS idx_vue_readings_daily_device_date
    ON vue_readings_daily (device_gid, date);
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

    def _rollback_safe(self):
        """Roll back the current transaction so the connection is reusable.

        psycopg2 leaves a connection in an aborted-transaction state after
        any failed query; subsequent queries on the same connection then
        raise InFailedSqlTransaction. Call this in every write method's
        except-block. If rollback itself fails, drop the connection so the
        next _get_conn() reconnects from scratch.
        """
        try:
            if self._conn is not None and not self._conn.closed:
                self._conn.rollback()
        except Exception:
            log.warning("Vue connection rollback failed; dropping connection", exc_info=True)
            self._conn = None

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
        try:
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
        except Exception:
            self._rollback_safe()
            raise

    def upsert_channel(self, device_gid, channel_num, name=None,
                       channel_multiplier=None, channel_type=None):
        """Insert or update a Vue channel record."""
        conn = self._get_conn()
        try:
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
        except Exception:
            self._rollback_safe()
            raise

    def write_readings(self, readings):
        """Batch-insert Vue readings. Each reading is (device_gid, channel_num, timestamp, value).

        Uses ON CONFLICT to deduplicate (same device + channel + timestamp).
        """
        if not readings:
            return
        conn = self._get_conn()
        try:
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
        except Exception:
            self._rollback_safe()
            raise

    def close(self):
        """Close the database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()

    def upsert_daily_readings(self, readings):
        """Batch-upsert daily readings. Each reading is (device_gid, channel_num, date, kwh).

        Uses ON CONFLICT to update kwh if row already exists for same device+channel+date.
        """
        if not readings:
            return
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """INSERT INTO vue_readings_daily (device_gid, channel_num, date, kwh)
                       VALUES %s
                       ON CONFLICT (device_gid, channel_num, date) DO UPDATE SET
                           kwh = EXCLUDED.kwh,
                           updated_at = NOW()""",
                    readings,
                    template="(%s, %s, %s, %s)",
                )
            conn.commit()
        except Exception:
            self._rollback_safe()
            raise


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
    log.info("Vue downsampling thread started (interval=%ds)", interval_seconds)
    while True:
        try:
            downsample_vue_readings(writer)
            cleanup_old_vue_readings(writer)
        except Exception:
            log.exception("Vue downsampling/cleanup failed")
        try:
            time.sleep(interval_seconds)
        except Exception:
            log.exception("Vue downsampling sleep interrupted")
