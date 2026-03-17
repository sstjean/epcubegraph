"""Mock epcube-exporter: generates realistic EP Cube Prometheus metrics.

Simulates 2 gateways (EP Cube 1.0 battery + solar, EP Cube 2.0 battery + solar)
with time-varying values:
  - Solar generation follows a bell curve peaking at noon JST
  - Battery SoC oscillates between 10-90%
  - Charge/discharge power tracks solar availability
  - Cumulative counters increase monotonically
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
        "battery_capacity_wh": 9900,
    },
    {
        "battery": {"device": "epcube2_battery", "ip": "192.168.1.11", "class": "storage_battery"},
        "solar": {"device": "epcube2_solar", "ip": "192.168.1.11", "class": "home_solar"},
        "manufacturer": "Canadian Solar",
        "product_code": "EP Cube 2.0",
        "uid": "MOCK002",
        "peak_solar_w": 6000,
        "battery_capacity_wh": 12000,
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

        lines.append(f"# HELP echonet_solar_instantaneous_generation_watts Current solar generation")
        lines.append(f"# TYPE echonet_solar_instantaneous_generation_watts gauge")
        lines.append(f"echonet_solar_instantaneous_generation_watts{{{sl}}} {solar_w}")

        lines.append(f"# HELP echonet_solar_cumulative_generation_kwh Total energy generated")
        lines.append(f"# TYPE echonet_solar_cumulative_generation_kwh counter")
        lines.append(f"echonet_solar_cumulative_generation_kwh{{{sl}}} {solar_cum_kwh}")

        # ── Battery metrics ──
        # SoC follows solar: charges during day, discharges at night
        hour = now.hour + now.minute / 60.0
        soc_base = 50 + 40 * math.sin((hour - 6) * math.pi / 12) if 6 <= hour <= 18 else 20 + 10 * math.sin(elapsed / 300 + phase)
        soc = max(5, min(98, soc_base + 3 * math.sin(elapsed / 60 + phase)))
        soc = round(soc, 1)

        # Charge/discharge power: positive=charging (during solar), negative=discharging
        if solar_w > 500:
            charge_w = round(min(solar_w * 0.6, 3000 + 200 * math.sin(elapsed / 45 + phase)), 1)
        elif solar_w > 0:
            charge_w = round(solar_w * 0.3, 1)
        else:
            charge_w = round(-800 - 400 * abs(math.sin(elapsed / 120 + phase)), 1)

        remaining_wh = round(dev["battery_capacity_wh"] * soc / 100, 1)
        chargeable_wh = round(dev["battery_capacity_wh"] * (100 - soc) / 100, 1)
        dischargeable_wh = round(remaining_wh * 0.95, 1)  # 5% reserve

        # Working operation state: 0x42=Charging, 0x43=Discharging, 0x44=Standby
        if charge_w > 50:
            op_state = 0x42
        elif charge_w < -50:
            op_state = 0x43
        else:
            op_state = 0x44

        # Cumulative charge/discharge
        cum_charge_key = f"cum_charge_{i}"
        cum_discharge_key = f"cum_discharge_{i}"
        prev_charge = _cumulative.get(cum_charge_key, 1000.0)
        prev_discharge = _cumulative.get(cum_discharge_key, 800.0)
        if charge_w > 0:
            _cumulative[cum_charge_key] = prev_charge + abs(charge_w) * (60 / 3600)
        else:
            _cumulative[cum_discharge_key] = prev_discharge + abs(charge_w) * (60 / 3600)

        lines.append(f"# HELP echonet_battery_state_of_capacity_percent Battery SoC")
        lines.append(f"# TYPE echonet_battery_state_of_capacity_percent gauge")
        lines.append(f"echonet_battery_state_of_capacity_percent{{{bl}}} {soc}")

        lines.append(f"# HELP echonet_battery_charge_discharge_power_watts Charge/discharge power")
        lines.append(f"# TYPE echonet_battery_charge_discharge_power_watts gauge")
        lines.append(f"echonet_battery_charge_discharge_power_watts{{{bl}}} {charge_w}")

        lines.append(f"# HELP echonet_battery_remaining_capacity_wh Remaining stored energy")
        lines.append(f"# TYPE echonet_battery_remaining_capacity_wh gauge")
        lines.append(f"echonet_battery_remaining_capacity_wh{{{bl}}} {remaining_wh}")

        lines.append(f"# HELP echonet_battery_chargeable_capacity_wh Max chargeable capacity")
        lines.append(f"# TYPE echonet_battery_chargeable_capacity_wh gauge")
        lines.append(f"echonet_battery_chargeable_capacity_wh{{{bl}}} {chargeable_wh}")

        lines.append(f"# HELP echonet_battery_dischargeable_capacity_wh Max dischargeable capacity")
        lines.append(f"# TYPE echonet_battery_dischargeable_capacity_wh gauge")
        lines.append(f"echonet_battery_dischargeable_capacity_wh{{{bl}}} {dischargeable_wh}")

        lines.append(f"# HELP echonet_battery_cumulative_charge_wh Cumulative energy charged")
        lines.append(f"# TYPE echonet_battery_cumulative_charge_wh counter")
        lines.append(f"echonet_battery_cumulative_charge_wh{{{bl}}} {round(_cumulative.get(cum_charge_key, 1000.0), 1)}")

        lines.append(f"# HELP echonet_battery_cumulative_discharge_wh Cumulative energy discharged")
        lines.append(f"# TYPE echonet_battery_cumulative_discharge_wh counter")
        lines.append(f"echonet_battery_cumulative_discharge_wh{{{bl}}} {round(_cumulative.get(cum_discharge_key, 800.0), 1)}")

        lines.append(f"# HELP echonet_battery_working_operation_state Operation state code")
        lines.append(f"# TYPE echonet_battery_working_operation_state gauge")
        lines.append(f"echonet_battery_working_operation_state{{{bl}}} {op_state}")

        # ── Scrape health metrics ──
        for d_labels in [bat, sol]:
            dl = _labels(d_labels)
            lines.append(f"echonet_scrape_success{{{dl}}} 1")
            lines.append(f"echonet_scrape_duration_seconds{{{dl}}} {round(0.05 + 0.02 * math.sin(elapsed / 20), 4)}")
            lines.append(f"echonet_last_scrape_timestamp_seconds{{{dl}}} {int(time.time())}")

        # ── Device info (constant=1 with metadata labels) ──
        for d_labels, d_class_name in [(bat, "storage_battery"), (sol, "home_solar")]:
            info_labels = {
                **d_labels,
                "manufacturer": dev["manufacturer"],
                "product_code": dev["product_code"],
                "uid": dev["uid"],
            }
            il = _labels(info_labels)
            lines.append(f"echonet_device_info{{{il}}} 1")

    lines.append("")
    return "\n".join(lines)


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
    server = HTTPServer(("0.0.0.0", port), MetricsHandler)
    print(f"Mock echonet-exporter serving metrics on :{port}/metrics", flush=True)
    server.serve_forever()
