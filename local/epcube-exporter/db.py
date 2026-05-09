"""PostgreSQL writers for EP Cube and Vue telemetry data."""
import time

from config import psycopg2, log


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

    def upsert_daily_readings(self, readings):
        """Batch-upsert daily readings. Each reading is (device_gid, channel_num, date, kwh).

        Uses ON CONFLICT to update kwh if row already exists for same device+channel+date.
        """
        if not readings:
            return
        conn = self._get_conn()
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
