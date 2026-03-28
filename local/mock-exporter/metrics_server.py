"""Mock epcube-exporter: generates realistic EP Cube Prometheus metrics.

Simulates 2 gateways (EP Cube 1.0 battery + solar, EP Cube 2.0 battery + solar)
with time-varying values:
  - Solar generation follows a bell curve peaking at noon JST
  - Battery SoC oscillates between 10-90%
  - Battery net kWh derived from energy balance
  - Home load and grid import/export track solar availability
  - Self-sufficiency rate varies with solar output
"""

import math
import time
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler

JST = timezone(timedelta(hours=9))

# Simulated device configs (mirrors real epcube-exporter labels)
DEVICES = [
    {
        "battery": {"device": "epcube1_battery", "ip": "192.168.1.10", "class": "storage_battery"},
        "solar": {"device": "epcube1_solar", "ip": "192.168.1.10", "class": "home_solar"},
        "manufacturer": "Canadian Solar",
        "product_code": "EP Cube 1.0",
        "uid": "MOCK001",
        "peak_solar_w": 5500,
    },
    {
        "battery": {"device": "epcube2_battery", "ip": "192.168.1.11", "class": "storage_battery"},
        "solar": {"device": "epcube2_solar", "ip": "192.168.1.11", "class": "home_solar"},
        "manufacturer": "Canadian Solar",
        "product_code": "EP Cube 2.0",
        "uid": "MOCK002",
        "peak_solar_w": 6000,
    },
]

# Track cumulative counters across scrapes
_cumulative = {}
_start_time = time.time()


def _solar_factor(now_jst: datetime) -> float:
    """Bell curve peaking at noon JST, zero at night."""
    hour = now_jst.hour + now_jst.minute / 60.0
    # Sunrise ~6, sunset ~18: Gaussian centered at 12 with sigma=3
    if hour < 5 or hour > 19:
        return 0.0
    return max(0.0, math.exp(-((hour - 12) ** 2) / (2 * 3**2)))


def _labels(d: dict) -> str:
    return ",".join(f'{k}="{v}"' for k, v in d.items())


def _generate_metrics() -> str:
    now = datetime.now(JST)
    elapsed = time.time() - _start_time
    solar_f = _solar_factor(now)

    lines: list[str] = []

    for i, dev in enumerate(DEVICES):
        bat = dev["battery"]
        sol = dev["solar"]
        bl = _labels(bat)
        sl = _labels(sol)

        # Add slight per-device variation using device index
        phase = i * 0.3

        # ── Solar metrics ──
        solar_w = dev["peak_solar_w"] * solar_f * (0.9 + 0.1 * math.sin(elapsed / 30 + phase))
        solar_w = max(0, round(solar_w, 1))

        cum_key = f"solar_kwh_{i}"
        prev_kwh = _cumulative.get(cum_key, 0.0)
        # Increment by power×time (assume 60s scrape interval converted to hours)
        _cumulative[cum_key] = prev_kwh + solar_w / 1000 * (60 / 3600)
        solar_cum_kwh = round(_cumulative[cum_key], 3)

        lines.append(f"# HELP epcube_solar_instantaneous_generation_watts Current solar generation")
        lines.append(f"# TYPE epcube_solar_instantaneous_generation_watts gauge")
        lines.append(f"epcube_solar_instantaneous_generation_watts{{{sl}}} {solar_w}")

        lines.append(f"# HELP epcube_solar_cumulative_generation_kwh Total energy generated")
        lines.append(f"# TYPE epcube_solar_cumulative_generation_kwh counter")
        lines.append(f"epcube_solar_cumulative_generation_kwh{{{sl}}} {solar_cum_kwh}")

        # ── Battery metrics ──
        # SoC follows solar: charges during day, discharges at night
        hour = now.hour + now.minute / 60.0
        soc_base = 50 + 40 * math.sin((hour - 6) * math.pi / 12) if 6 <= hour <= 18 else 20 + 10 * math.sin(elapsed / 300 + phase)
        soc = max(5, min(98, soc_base + 3 * math.sin(elapsed / 60 + phase)))
        soc = round(soc, 1)

        # Home load: base ~800W, higher when solar is low (evening cooking etc.)
        home_load_w = round(800 + 400 * abs(math.sin(elapsed / 90 + phase)) + (300 if solar_w < 100 else 0), 1)

        # Grid power: positive=import, negative=export. When solar exceeds load, export.
        net_power = solar_w - home_load_w
        grid_power_w = round(-net_power * 0.6, 1) if abs(net_power) > 50 else 0.0

        # Battery power: positive=charging, negative=discharging (derived: solar + grid - home)
        battery_power_w = round(solar_w + grid_power_w - home_load_w, 1)

        # Battery stored kWh: derived from SoC (assume 10 kWh capacity per system)
        bat_capacity_kwh = 10.0
        bat_stored_kwh = round(soc / 100 * bat_capacity_kwh, 2)

        # Grid import/export cumulative kWh
        grid_import_key = f"grid_import_{i}"
        grid_export_key = f"grid_export_{i}"
        prev_import = _cumulative.get(grid_import_key, 0.0)
        prev_export = _cumulative.get(grid_export_key, 0.0)
        if grid_power_w > 0:
            _cumulative[grid_import_key] = prev_import + grid_power_w / 1000 * (60 / 3600)
        elif grid_power_w < 0:
            _cumulative[grid_export_key] = prev_export + abs(grid_power_w) / 1000 * (60 / 3600)
        grid_import_kwh = round(_cumulative.get(grid_import_key, 0.0), 3)
        grid_export_kwh = round(_cumulative.get(grid_export_key, 0.0), 3)

        # Self-sufficiency rate: higher when solar covers more of the load
        self_sufficiency = min(100.0, max(0.0, round(min(solar_w, home_load_w) / max(home_load_w, 1) * 100, 1)))

        # Peak battery stored kWh for the day
        peak_key = f"bat_peak_{i}"
        prev_peak = _cumulative.get(peak_key, 0.0)
        _cumulative[peak_key] = max(prev_peak, bat_stored_kwh)
        bat_peak_kwh = round(_cumulative[peak_key], 2)

        lines.append(f"# HELP epcube_battery_state_of_capacity_percent Battery SoC")
        lines.append(f"# TYPE epcube_battery_state_of_capacity_percent gauge")
        lines.append(f"epcube_battery_state_of_capacity_percent{{{bl}}} {soc}")

        lines.append(f"# HELP epcube_battery_power_watts Battery power (positive=charge, negative=discharge)")
        lines.append(f"# TYPE epcube_battery_power_watts gauge")
        lines.append(f"epcube_battery_power_watts{{{bl}}} {battery_power_w}")

        lines.append(f"# HELP epcube_battery_stored_kwh Current battery energy level")
        lines.append(f"# TYPE epcube_battery_stored_kwh gauge")
        lines.append(f"epcube_battery_stored_kwh{{{bl}}} {bat_stored_kwh}")

        lines.append(f"# HELP epcube_battery_peak_stored_kwh Peak battery energy level today")
        lines.append(f"# TYPE epcube_battery_peak_stored_kwh gauge")
        lines.append(f"epcube_battery_peak_stored_kwh{{{bl}}} {bat_peak_kwh}")

        lines.append(f"# HELP epcube_grid_power_watts Grid power (positive=import, negative=export)")
        lines.append(f"# TYPE epcube_grid_power_watts gauge")
        lines.append(f"epcube_grid_power_watts{{{bl}}} {grid_power_w}")

        lines.append(f"# HELP epcube_home_load_power_watts Home load power consumption")
        lines.append(f"# TYPE epcube_home_load_power_watts gauge")
        lines.append(f"epcube_home_load_power_watts{{{bl}}} {home_load_w}")

        lines.append(f"# HELP epcube_self_sufficiency_rate Self-sufficiency rate")
        lines.append(f"# TYPE epcube_self_sufficiency_rate gauge")
        lines.append(f"epcube_self_sufficiency_rate{{{bl}}} {self_sufficiency}")

        lines.append(f"# HELP epcube_grid_import_kwh Grid energy imported today")
        lines.append(f"# TYPE epcube_grid_import_kwh gauge")
        lines.append(f"epcube_grid_import_kwh{{{bl}}} {grid_import_kwh}")

        lines.append(f"# HELP epcube_grid_export_kwh Grid energy exported today")
        lines.append(f"# TYPE epcube_grid_export_kwh gauge")
        lines.append(f"epcube_grid_export_kwh{{{bl}}} {grid_export_kwh}")

        # ── Scrape health metrics ──
        for d_labels in [bat, sol]:
            dl = _labels(d_labels)
            lines.append(f"epcube_scrape_success{{{dl}}} 1")
            lines.append(f"epcube_last_scrape_timestamp_seconds{{{dl}}} {int(time.time())}")

        # ── Device info (constant=1 with metadata labels) ──
        for d_labels, d_class_name in [(bat, "storage_battery"), (sol, "home_solar")]:
            info_labels = {
                **d_labels,
                "manufacturer": dev["manufacturer"],
                "product_code": dev["product_code"],
                "uid": dev["uid"],
            }
            il = _labels(info_labels)
            lines.append(f"epcube_device_info{{{il}}} 1")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# PostgreSQL writer (optional — enabled via POSTGRES_DSN env var)
# ---------------------------------------------------------------------------

import os
import threading
from datetime import datetime as _dt, timezone as _tz

from typing import Any

psycopg2: Any = None

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    pass

_POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "")

_SCHEMA_SQL = """\
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


def _pg_write_loop(interval=60):
    """Background thread: writes generated metrics to Postgres every interval."""
    import time as _time
    conn = psycopg2.connect(_POSTGRES_DSN)
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute(_SCHEMA_SQL)
    conn.commit()
    print(f"Mock exporter: PostgreSQL schema verified", flush=True)

    # Upsert devices once
    with conn.cursor() as cur:
        for dev in DEVICES:
            for key, cls in [("battery", "storage_battery"), ("solar", "home_solar")]:
                cur.execute(
                    """INSERT INTO devices (device_id, device_class, alias, manufacturer, product_code, uid)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()""",
                    (dev[key]["device"], cls, None, dev["manufacturer"], dev["product_code"], dev["uid"]),
                )
    conn.commit()

    while True:
        _time.sleep(interval)
        try:
            now = _dt.now(_tz.utc)
            readings = []
            for i, dev in enumerate(DEVICES):
                # Regenerate the same values as _generate_metrics
                now_jst = _dt.now(JST)
                solar_f = _solar_factor(now_jst)
                elapsed = _time.time() - _start_time
                phase = i * 0.3

                solar_w = dev["peak_solar_w"] * solar_f * (0.9 + 0.1 * math.sin(elapsed / 30 + phase))
                solar_w = max(0, round(solar_w, 1))

                hour = now_jst.hour + now_jst.minute / 60.0
                soc_base = 50 + 40 * math.sin((hour - 6) * math.pi / 12) if 6 <= hour <= 18 else 20 + 10 * math.sin(elapsed / 300 + phase)
                soc = max(5, min(98, soc_base + 3 * math.sin(elapsed / 60 + phase)))
                soc = round(soc, 1)

                home_load_w = round(800 + 400 * abs(math.sin(elapsed / 90 + phase)) + (300 if solar_w < 100 else 0), 1)
                net_power = solar_w - home_load_w
                grid_power_w = round(-net_power * 0.6, 1) if abs(net_power) > 50 else 0.0
                battery_power_w = round(solar_w + grid_power_w - home_load_w, 1)
                bat_stored_kwh = round(soc / 100 * 10.0, 2)
                self_sufficiency = min(100.0, max(0.0, round(min(solar_w, home_load_w) / max(home_load_w, 1) * 100, 1)))

                bat_id = dev["battery"]["device"]
                sol_id = dev["solar"]["device"]
                solar_cum_kwh = round(_cumulative.get(f"solar_kwh_{i}", 0.0), 3)
                grid_import_kwh = round(_cumulative.get(f"grid_import_{i}", 0.0), 3)
                grid_export_kwh = round(_cumulative.get(f"grid_export_{i}", 0.0), 3)
                bat_peak_kwh = round(_cumulative.get(f"bat_peak_{i}", 0.0), 2)

                readings.extend([
                    (sol_id, "solar_instantaneous_generation_watts", now, solar_w),
                    (sol_id, "solar_cumulative_generation_kwh", now, solar_cum_kwh),
                    (bat_id, "battery_state_of_capacity_percent", now, soc),
                    (bat_id, "battery_power_watts", now, battery_power_w),
                    (bat_id, "battery_stored_kwh", now, bat_stored_kwh),
                    (bat_id, "battery_peak_stored_kwh", now, bat_peak_kwh),
                    (bat_id, "grid_power_watts", now, grid_power_w),
                    (bat_id, "home_load_power_watts", now, home_load_w),
                    (bat_id, "self_sufficiency_rate", now, self_sufficiency),
                    (bat_id, "grid_import_kwh", now, grid_import_kwh),
                    (bat_id, "grid_export_kwh", now, grid_export_kwh),
                ])

            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """INSERT INTO readings (device_id, metric_name, timestamp, value)
                       VALUES %s
                       ON CONFLICT (device_id, metric_name, timestamp) DO UPDATE SET value = EXCLUDED.value""",
                    readings,
                    template="(%s, %s, %s, %s)",
                )
            conn.commit()
            print(f"Mock exporter: wrote {len(readings)} readings to Postgres", flush=True)
        except Exception as e:
            print(f"Mock exporter: Postgres write failed: {e}", flush=True)
            try:
                conn.rollback()
            except Exception:
                pass


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/metrics":
            body = _generate_metrics().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress per-request logging noise
        pass


if __name__ == "__main__":
    port = 9191

    # Start Postgres write loop if configured
    if _POSTGRES_DSN and psycopg2:
        pg_thread = threading.Thread(target=_pg_write_loop, args=(60,), daemon=True)
        pg_thread.start()
        print(f"Mock exporter: PostgreSQL writes enabled", flush=True)
    elif _POSTGRES_DSN:
        print(f"Mock exporter: POSTGRES_DSN set but psycopg2 not installed", flush=True)

    server = HTTPServer(("0.0.0.0", port), MetricsHandler)
    print(f"Mock epcube-exporter serving metrics on :{port}/metrics", flush=True)
    server.serve_forever()
