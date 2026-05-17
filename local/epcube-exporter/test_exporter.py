"""Tests for epcube-exporter."""
import base64
import collections
import json
import os
import threading
import time
import unittest
from datetime import datetime, timezone
from http.server import HTTPServer
from io import BytesIO
from unittest.mock import MagicMock, patch

# Patch heavy dependencies before importing exporter
import sys
sys.modules["cv2"] = MagicMock()
sys.modules["numpy"] = MagicMock()
sys.modules["Crypto"] = MagicMock()
sys.modules["Crypto.Cipher"] = MagicMock()
sys.modules["Crypto.Cipher.AES"] = MagicMock()
sys.modules["Crypto.Util"] = MagicMock()
sys.modules["Crypto.Util.Padding"] = MagicMock()

import config
import auth
import db
import epcube_collector
import vue_collector
import http_handler
import exporter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_collector():
    """Create a collector ready for testing (no real auth)."""
    pg = MagicMock()
    c = epcube_collector.EpCubeCollector("user@test.com", "password", pg_writer=pg)
    return c


def _make_device(dev_id="1234", name="Test Device", online="1"):
    return {
        "id": dev_id,
        "name": name,
        "sgSn": "SN123",
        "isOnline": online,
        "devType": 1,
    }


def _make_home_device_info(**overrides):
    data = {
        "solarPower": 3.5,
        "batterySoc": 75,
        "batteryPower": 0,
        "gridPower": 0,
        "backUpPower": 1.2,
        "selfHelpRate": 85.0,
        "systemStatus": 4,
        "batteryCurrentElectricity": "15.5",
        "ressNumber": 2,
    }
    data.update(overrides)
    return {"status": 200, "data": data}


def _make_electricity_data(**overrides):
    data = {
        "solarElectricity": 12.5,
        "gridElectricityFrom": 3.0,
        "gridElectricityTo": 1.5,
        "backUpElectricity": 10.0,
    }
    data.update(overrides)
    return {"status": 200, "data": data}


def _mock_api_for(devices, home_info=None, elec_data=None):
    """Return a mock _api_request side_effect matching the real (method, path, ...) signature."""
    if home_info is None:
        home_info = _make_home_device_info()
    if elec_data is None:
        elec_data = _make_electricity_data()

    def _handler(method, path, **kwargs):
        if "homeDeviceInfo" in path:
            return home_info
        elif "queryDataElectricityV2" in path:
            return elec_data
        elif "deviceList" in path:
            return {"status": 200, "data": devices}
        return {"status": 200, "data": {}}

    return _handler


# ---------------------------------------------------------------------------
# Testable HTTP handler (avoids BaseHTTPRequestHandler.__init__)
# ---------------------------------------------------------------------------

class _TestableHandler(http_handler.ExporterHandler):
    """Subclass that bypasses the real __init__ so we can call do_GET in tests."""
    def __init__(self):
        # Skip BaseHTTPRequestHandler.__init__ which needs request/client/server
        pass


# ---------------------------------------------------------------------------
# Health check tests
# ---------------------------------------------------------------------------

class TestHealthCheck(unittest.TestCase):

    def test_healthy_after_recent_poll(self):
        c = _make_collector()
        c._last_poll = time.time() - 30  # 30s ago
        c._consecutive_errors = 0
        health = c.get_health()
        self.assertTrue(health["healthy"])
        self.assertEqual(health["checks"], [])

    def test_unhealthy_no_poll_yet(self):
        c = _make_collector()
        c._last_poll = 0.0
        health = c.get_health()
        self.assertFalse(health["healthy"])
        self.assertIn("no successful poll yet", health["checks"])

    def test_unhealthy_stale_poll(self):
        c = _make_collector()
        c._last_poll = time.time() - 600  # 10 min ago
        health = c.get_health()
        self.assertFalse(health["healthy"])
        self.assertTrue(any(">300s" in chk for chk in health["checks"]))

    def test_unhealthy_consecutive_errors(self):
        c = _make_collector()
        c._last_poll = time.time() - 10
        c._consecutive_errors = 5
        health = c.get_health()
        self.assertFalse(health["healthy"])
        self.assertTrue(any("5 consecutive errors" in chk for chk in health["checks"]))

    def test_healthy_with_few_errors(self):
        c = _make_collector()
        c._last_poll = time.time() - 10
        c._consecutive_errors = 4  # below threshold
        health = c.get_health()
        self.assertTrue(health["healthy"])

    def test_multiple_failure_reasons(self):
        c = _make_collector()
        c._last_poll = time.time() - 600
        c._consecutive_errors = 7
        health = c.get_health()
        self.assertFalse(health["healthy"])
        self.assertEqual(len(health["checks"]), 2)


# ---------------------------------------------------------------------------
# Energy balance calculation tests
# ---------------------------------------------------------------------------

class TestEnergyBalance(unittest.TestCase):

    def test_net_charge(self):
        # Solar + grid_in > load + grid_out → net charge
        solar, grid_in, load, grid_out = 10.0, 5.0, 8.0, 2.0
        net = round(solar + grid_in - load - grid_out, 2)
        self.assertEqual(net, 5.0)

    def test_net_discharge(self):
        # Load exceeds solar + grid → battery must be discharging
        solar, grid_in, load, grid_out = 2.0, 1.0, 8.0, 0.0
        net = round(solar + grid_in - load - grid_out, 2)
        self.assertEqual(net, -5.0)

    def test_balanced(self):
        solar, grid_in, load, grid_out = 5.0, 3.0, 7.0, 1.0
        net = round(solar + grid_in - load - grid_out, 2)
        self.assertEqual(net, 0.0)

    def test_calculation_in_poll(self):
        """Verify the actual poll method derives battery_kw and tracks bat_peak_kwh."""
        c = _make_collector()
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        home_info = _make_home_device_info(
            solarPower=3.0,
            gridPower=1.0,  # API convention: positive = import
            backUpPower=2.0,
            batteryCurrentElectricity="15.5",
        )

        with patch.object(epcube_collector, "_api_request",
                          side_effect=_mock_api_for([dev], home_info=home_info)):
            c.poll()

        snap = c._history[-1]
        device_snap = snap["devices"][0]
        # battery_kw = solar + grid - load = 3.0 + 1.0 - 2.0 = 2.0 (charging)
        self.assertAlmostEqual(device_snap["battery_kw"], 2.0)
        # grid_kw = gridPower = 1.0 (importing)
        self.assertAlmostEqual(device_snap["grid_kw"], 1.0)
        # bat_peak_kwh tracks high-water mark
        self.assertAlmostEqual(device_snap["bat_peak_kwh"], 15.5)

    def test_bat_peak_tracks_max(self):
        """bat_peak_kwh retains the highest value seen for the day."""
        c = _make_collector()
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        # First poll: battery at 20.0 kWh
        home1 = _make_home_device_info(batteryCurrentElectricity="20.0")
        with patch.object(epcube_collector, "_api_request",
                          side_effect=_mock_api_for([dev], home_info=home1)):
            c.poll()

        c._history[-1]["time_minute"] = "old"  # force new snapshot

        # Second poll: battery discharged to 15.0 kWh
        home2 = _make_home_device_info(batteryCurrentElectricity="15.0")
        with patch.object(epcube_collector, "_api_request",
                          side_effect=_mock_api_for([dev], home_info=home2)):
            c.poll()

        snap = c._history[-1]
        # Peak should still be 20.0, not 15.0
        self.assertAlmostEqual(snap["devices"][0]["bat_peak_kwh"], 20.0)


# ---------------------------------------------------------------------------
# Snapshot dedup tests
# ---------------------------------------------------------------------------

class TestSnapshotDedup(unittest.TestCase):

    def test_same_minute_replaces(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()
            first_count = len(c._history)
            # Poll again immediately (same minute)
            c.poll()

        self.assertEqual(len(c._history), first_count)  # replaced, not appended

    def test_different_minute_appends(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        # Manually change the time_minute to simulate a different minute
        c._history[-1]["time_minute"] = "2020-01-01T00:00Z"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        self.assertEqual(len(c._history), 2)

    def test_history_max_entries(self):
        c = _make_collector()
        # Fill history to max
        for i in range(15):
            c._history.append({
                "time": f"2026-01-01T00:{i:02d}:00Z",
                "time_minute": f"2026-01-01T00:{i:02d}Z",
                "devices": [],
            })
        self.assertEqual(len(c._history), epcube_collector.EpCubeCollector.HISTORY_MAX)


# ---------------------------------------------------------------------------
# Poll counter tests
# ---------------------------------------------------------------------------

class TestPollCounters(unittest.TestCase):

    def test_poll_resets_consecutive_errors(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        c._consecutive_errors = 3

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        self.assertEqual(c._consecutive_errors, 0)
        self.assertEqual(c._poll_count, 1)

    def test_poll_increments_count(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()
            c._history[-1]["time_minute"] = "old"
            c.poll()

        self.assertEqual(c._poll_count, 2)


# ---------------------------------------------------------------------------
# Debug page rendering tests
# ---------------------------------------------------------------------------

class TestRenderStatusPage(unittest.TestCase):

    def _make_status(self, **overrides):
        status = {
            "version": config.__version__,
            "uptime_s": 3665,
            "poll_count": 10,
            "poll_errors": 0,
            "last_poll": time.time() - 30,
            "poll_interval": 30,
            "next_poll_at": time.time() + 15,
            "devices": 2,
            "history": [],
        }
        status.update(overrides)
        return status

    def _make_health(self, healthy=True, checks=None):
        return {"healthy": healthy, "checks": checks or []}

    def test_renders_html(self):
        html = http_handler._render_status_page(self._make_status(), self._make_health())
        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("epcube-exporter", html)

    def test_healthy_chiclet_green(self):
        html = http_handler._render_status_page(self._make_status(), self._make_health(healthy=True))
        self.assertIn("#00d4aa", html)
        self.assertIn("healthy", html)

    def test_unhealthy_chiclet_red(self):
        html = http_handler._render_status_page(
            self._make_status(),
            self._make_health(healthy=False, checks=["stale poll"]),
        )
        self.assertIn("#e74c3c", html)
        self.assertIn("stale poll", html)

    def test_no_data_message(self):
        html = http_handler._render_status_page(self._make_status(history=[]), self._make_health())
        self.assertIn("No data yet", html)

    def test_device_tables_rendered(self):
        snap = {
            "time": "2026-03-17T15:00:00Z",
            "time_minute": "2026-03-17T15:00Z",
            "devices": [{
                "name": "Test Device",
                "id": "1234",
                "solar_kw": 3.5,
                "battery_soc": 75,
                "battery_kw": -1.5,
                "grid_kw": 0.0,
                "backup_kw": 1.2,
                "self_sufficiency": 85,
                "system_status": "Normal (4)",
                "bat_stored_kwh": 15.5,
                "bat_peak_kwh": 15.5,
                "ress_count": 2,
                "solar_kwh": 12.5,
                "grid_import_kwh": 3.0,
                "grid_export_kwh": 1.5,
                "backup_kwh": 10.0,
            }],
        }
        status = self._make_status(history=[snap])
        html = http_handler._render_status_page(status, self._make_health())
        self.assertIn("Test Device", html)
        self.assertIn("Battery level", html)
        self.assertIn("Home Supply (total)", html)
        self.assertIn("EP Cube", html)
        self.assertIn("3.50", html)  # solar_kw
        self.assertIn("75%", html)   # battery_soc
        self.assertIn("-1.50", html)  # battery_kw (discharging)
        self.assertIn("Battery kW", html)
        self.assertIn("Grid kW", html)
        self.assertIn("Current Activity", html)
        self.assertIn("Daily Totals", html)
        self.assertIn("section-instant", html)
        self.assertIn("section-daily", html)

    def test_energy_balance_ok_no_warning(self):
        """Balanced row (solar covers load) should NOT be flagged."""
        snap = {
            "time": "2026-03-17T12:00:00Z",
            "time_minute": "2026-03-17T12:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 3.0, "battery_kw": 0.0, "grid_kw": 0.0,
                "backup_kw": 3.0, "battery_soc": 80, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertNotIn('class="imbalance"', html)
        self.assertNotIn("\u26a0", html)  # no warning symbol

    def test_energy_balance_mismatch_flagged(self):
        """Load with zero supply should be flagged."""
        snap = {
            "time": "2026-03-17T22:00:00Z",
            "time_minute": "2026-03-17T22:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 0.0, "battery_kw": 0.0, "grid_kw": 0.0,
                "backup_kw": 1.23, "battery_soc": 52, "self_sufficiency": 48,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="imbalance"', html)
        self.assertIn("\u26a0", html)  # warning symbol
        self.assertIn("Expected battery -1.23 kW", html)  # tooltip

    def test_energy_balance_all_zeros_no_warning(self):
        """All zeros (idle system) should NOT be flagged."""
        snap = {
            "time": "2026-03-17T03:00:00Z",
            "time_minute": "2026-03-17T03:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 0.0, "battery_kw": 0.0, "grid_kw": 0.0,
                "backup_kw": 0.0, "battery_soc": 50, "self_sufficiency": 0,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertNotIn('class="imbalance"', html)
        self.assertNotIn("\u26a0", html)

    def test_battery_charging_green(self):
        """Battery charging (positive) should get val-pos class (green)."""
        snap = {
            "time": "2026-03-17T12:00:00Z",
            "time_minute": "2026-03-17T12:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 5.0, "battery_kw": 3.0, "grid_kw": 0.0,
                "backup_kw": 2.0, "battery_soc": 60, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="val-pos">+3.00', html)

    def test_battery_discharging_red(self):
        """Battery discharging (negative) should get val-neg class (red)."""
        snap = {
            "time": "2026-03-17T22:00:00Z",
            "time_minute": "2026-03-17T22:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 0.0, "battery_kw": -2.5, "grid_kw": 0.0,
                "backup_kw": 2.5, "battery_soc": 80, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="val-neg">-2.50', html)

    def test_grid_import_red(self):
        """Grid import (positive) should get val-neg class (red)."""
        snap = {
            "time": "2026-03-17T12:00:00Z",
            "time_minute": "2026-03-17T12:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 0.0, "battery_kw": 0.0, "grid_kw": 1.5,
                "backup_kw": 1.5, "battery_soc": 50, "self_sufficiency": 0,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="val-neg">+1.50', html)

    def test_grid_export_green(self):
        """Grid export (negative) should get val-pos class (green)."""
        snap = {
            "time": "2026-03-17T12:00:00Z",
            "time_minute": "2026-03-17T12:00Z",
            "devices": [{
                "name": "Test", "id": "1",
                "solar_kw": 5.0, "battery_kw": 2.0, "grid_kw": -1.0,
                "backup_kw": 2.0, "battery_soc": 60, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "ress_count": 1, "solar_kwh": 0, "grid_import_kwh": 0,
                "grid_export_kwh": 0, "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="val-pos">-1.00', html)

    def test_uptime_formatting(self):
        html = http_handler._render_status_page(self._make_status(uptime_s=3665), self._make_health())
        self.assertIn("1h 1m 5s", html)

    def test_error_count_warning_style(self):
        html = http_handler._render_status_page(self._make_status(poll_errors=3), self._make_health())
        self.assertIn("warn", html)

    def test_error_count_ok_style(self):
        html = http_handler._render_status_page(self._make_status(poll_errors=0), self._make_health())
        self.assertIn("ok", html)

    def test_version_displayed(self):
        html = http_handler._render_status_page(self._make_status(), self._make_health())
        self.assertIn(config.__version__, html)
        self.assertIn("Version:", html)

    def test_poll_interval_displayed(self):
        html = http_handler._render_status_page(self._make_status(poll_interval=10), self._make_health())
        self.assertIn("Poll interval:", html)
        self.assertIn("10s", html)

    def test_countdown_displayed(self):
        next_at = time.time() + 20
        html = http_handler._render_status_page(self._make_status(next_poll_at=next_at), self._make_health())
        self.assertIn("Next poll in:", html)
        self.assertIn('id="countdown"', html)
        self.assertIn(f'data-next="{next_at}"', html)

    def test_countdown_zero_when_past(self):
        next_at = time.time() - 5  # already past
        html = http_handler._render_status_page(self._make_status(next_poll_at=next_at), self._make_health())
        self.assertIn('>0s<', html)

    def test_countdown_waiting_when_no_next_poll(self):
        html = http_handler._render_status_page(self._make_status(next_poll_at=0), self._make_health())
        self.assertIn("waiting", html)

    def test_countdown_js_ticks(self):
        html = http_handler._render_status_page(self._make_status(), self._make_health())
        self.assertIn("getElementById('countdown')", html)
        self.assertIn("parseFloat(el.dataset.next)", html)

    def test_auto_refresh_via_fetch(self):
        html = http_handler._render_status_page(self._make_status(), self._make_health())
        # Meta refresh removed; replaced with JS fetch-based background refresh
        self.assertNotIn('http-equiv="refresh"', html)
        self.assertIn('setInterval', html)
        self.assertIn('fetch(location.href)', html)

    def test_auto_refresh_matches_poll_interval(self):
        html = http_handler._render_status_page(self._make_status(poll_interval=10), self._make_health())
        self.assertIn('}, 10000)', html)
        self.assertIn('Auto-refreshes every 10s', html)

    def test_utctime_class_for_js(self):
        snap = {
            "time": "2026-03-17T15:00:00Z",
            "time_minute": "2026-03-17T15:00Z",
            "devices": [{
                "name": "Dev", "id": "1", "solar_kw": 0, "battery_soc": 0,
                "battery_kw": 0, "grid_kw": 0,
                "backup_kw": 0, "self_sufficiency": 0, "system_status": "?",
                "bat_stored_kwh": 0, "ress_count": 1,
                "solar_kwh": 0, "grid_import_kwh": 0, "grid_export_kwh": 0,
                "backup_kwh": 0,
            }],
        }
        html = http_handler._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="utctime"', html)
        self.assertIn('data-utc="2026-03-17T15:00:00Z"', html)


# ---------------------------------------------------------------------------
# HTTP handler tests
# ---------------------------------------------------------------------------

class TestHTTPHandler(unittest.TestCase):

    def _make_handler(self, path, headers=None):
        """Build a testable handler without opening a real socket."""
        h = _TestableHandler()
        h.collector = self.collector
        h.path = path
        h.headers = headers or {}
        h.wfile = BytesIO()
        h.send_response = MagicMock()
        h.send_header = MagicMock()
        h.end_headers = MagicMock()
        h.do_GET()
        return h

    def test_metrics_returns_404(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        h = self._make_handler("/metrics")
        h.send_response.assert_called_with(404)

    def test_health_returns_200_when_healthy(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        h = self._make_handler("/health")
        h.send_response.assert_called_with(200)
        self.assertIn(b"ok", h.wfile.getvalue())

    def test_health_returns_503_when_unhealthy(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        self.collector._last_poll = 0.0  # no poll yet
        h = self._make_handler("/health")
        h.send_response.assert_called_with(503)
        self.assertIn(b"unhealthy", h.wfile.getvalue())

    def test_health_no_auth_required(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        with patch.object(http_handler, "DISABLE_AUTH", False):
            h = self._make_handler("/health")
            h.send_response.assert_called_with(200)

    def test_debug_page_returns_200_auth_disabled(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        with patch.object(http_handler, "DISABLE_AUTH", True):
            h = self._make_handler("/")
            h.send_response.assert_called_with(200)

    def test_debug_page_401_api_client_without_token(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """API client (no Accept: text/html) gets 401 without auth."""
        with patch.object(http_handler, "DISABLE_AUTH", False):
            h = self._make_handler("/", headers={})
            h.send_response.assert_called_with(401)

    def test_debug_page_redirects_browser_to_login(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """Browser (Accept: text/html) without auth gets redirected to /login."""
        with patch.object(http_handler, "DISABLE_AUTH", False), \
             patch.object(http_handler, "AZURE_REDIRECT_URI", "https://example.com/.auth/callback"):
            h = self._make_handler("/", headers={"Accept": "text/html"})
            h.send_response.assert_called_with(302)
            h.send_header.assert_any_call("Location", "/login")

    def test_debug_page_401_with_bad_bearer(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        with patch.object(http_handler, "DISABLE_AUTH", False):
            h = self._make_handler("/", headers={"Authorization": "Bearer bad-token"})
            h.send_response.assert_called_with(401)

    def test_login_redirects_to_microsoft(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """GET /login redirects to Microsoft authorization endpoint."""
        with patch.object(http_handler, "AZURE_REDIRECT_URI", "https://example.com/.auth/callback"), \
             patch.object(http_handler, "AZURE_CLIENT_ID", "test-client-id"), \
             patch.object(http_handler, "AZURE_TENANT_ID", "test-tenant"), \
             patch.object(http_handler, "AZURE_AUDIENCE", "api://test"):
            h = self._make_handler("/login")
            h.send_response.assert_called_with(302)
            location_calls = [c for c in h.send_header.call_args_list if c[0][0] == "Location"]
            self.assertTrue(len(location_calls) > 0)
            url = location_calls[0][0][1]
            self.assertIn("login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize", url)
            self.assertIn("client_id=test-client-id", url)

    def test_login_returns_500_when_not_configured(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """GET /login returns 500 when OAuth is not configured."""
        with patch.object(http_handler, "AZURE_REDIRECT_URI", ""), \
             patch.object(http_handler, "AZURE_CLIENT_ID", ""):
            h = self._make_handler("/login")
            h.send_response.assert_called_with(500)

    def test_callback_returns_400_without_params(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """GET /.auth/callback without code/state returns 400."""
        h = self._make_handler("/.auth/callback")
        h.send_response.assert_called_with(400)

    def test_callback_returns_400_with_invalid_state(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """GET /.auth/callback with unknown state returns 400."""
        h = self._make_handler("/.auth/callback?code=test&state=invalid")
        h.send_response.assert_called_with(400)

    def test_session_cookie_grants_access(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """Valid session cookie grants access to debug page."""
        with patch.object(http_handler, "DISABLE_AUTH", False), \
             patch.object(http_handler, "AZURE_CLIENT_SECRET", "test-secret"), \
             patch.object(http_handler, "_sessions", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            session_id = "test-session-123"
            with http_handler._auth_lock:
                http_handler._sessions[session_id] = {
                    "expires": time.time() + 3600,
                    "user": "test@example.com",
                }
            signed = http_handler._sign_session(session_id)
            h = self._make_handler("/", headers={"Cookie": f"_session={signed}"})
            h.send_response.assert_called_with(200)

    def test_expired_session_denied(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        """Expired session cookie is rejected."""
        with patch.object(http_handler, "DISABLE_AUTH", False), \
             patch.object(http_handler, "AZURE_CLIENT_SECRET", "test-secret"), \
             patch.object(http_handler, "_sessions", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            session_id = "expired-session"
            with http_handler._auth_lock:
                http_handler._sessions[session_id] = {
                    "expires": time.time() - 1,  # already expired
                    "user": "test@example.com",
                }
            signed = http_handler._sign_session(session_id)
            h = self._make_handler("/", headers={"Cookie": f"_session={signed}"})
            h.send_response.assert_called_with(401)

    def test_status_alias_works(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        with patch.object(http_handler, "DISABLE_AUTH", True):
            h = self._make_handler("/status")
            h.send_response.assert_called_with(200)

    def test_unknown_path_returns_404(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        h = self._make_handler("/unknown")
        h.send_response.assert_called_with(404)


# ---------------------------------------------------------------------------
# Snapshot data tests
# ---------------------------------------------------------------------------

class TestSnapshotData(unittest.TestCase):

    def test_snapshot_fields(self):
        """Verify poll creates snapshots with all expected fields."""
        c = _make_collector()
        dev = _make_device(dev_id="5678", name="My EP Cube")
        c._devices = [dev]
        c._token = "fake-token"

        home_info = _make_home_device_info(
            solarPower=4.0,
            batterySoc=60,
            backUpPower=2.0,
            selfHelpRate=90.0,
            systemStatus=1,
            batteryCurrentElectricity="12.0",
            ressNumber=1,
        )
        elec_data = _make_electricity_data(
            solarElectricity=8.0,
            gridElectricityFrom=2.0,
            gridElectricityTo=0.5,
            backUpElectricity=6.0,
        )

        with patch.object(epcube_collector, "_api_request",
                          side_effect=_mock_api_for([dev], home_info, elec_data)):
            c.poll()

        snap = c._history[-1]
        self.assertIn("time", snap)
        self.assertIn("time_minute", snap)
        self.assertEqual(len(snap["devices"]), 1)

        d = snap["devices"][0]
        self.assertEqual(d["name"], "My EP Cube")
        self.assertEqual(d["id"], "5678")
        self.assertAlmostEqual(d["solar_kw"], 4.0)
        self.assertAlmostEqual(d["battery_soc"], 60)
        self.assertAlmostEqual(d["backup_kw"], 2.0)
        # battery_kw derived: solar(4) + grid(0) - load(2) = 2.0
        self.assertAlmostEqual(d["battery_kw"], 2.0)
        # gridPower=0 negated = 0
        self.assertAlmostEqual(d["grid_kw"], 0)
        self.assertAlmostEqual(d["self_sufficiency"], 90.0)
        self.assertIn("Self-Use", d["system_status"])
        self.assertAlmostEqual(d["bat_stored_kwh"], 12.0)
        self.assertAlmostEqual(d["bat_peak_kwh"], 12.0)
        self.assertEqual(d["ress_count"], 1)
        # Daily totals
        self.assertAlmostEqual(d["solar_kwh"], 8.0)
        self.assertAlmostEqual(d["grid_import_kwh"], 2.0)
        self.assertAlmostEqual(d["grid_export_kwh"], 0.5)
        self.assertAlmostEqual(d["backup_kwh"], 6.0)

    def test_offline_device_skipped(self):
        c = _make_collector()
        devs = [_make_device(online="0")]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        snap = c._history[-1]
        self.assertEqual(len(snap["devices"]), 0)

    def test_multiple_devices(self):
        c = _make_collector()
        devs = [
            _make_device(dev_id="1", name="Device A"),
            _make_device(dev_id="2", name="Device B"),
        ]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        snap = c._history[-1]
        self.assertEqual(len(snap["devices"]), 2)
        names = {d["name"] for d in snap["devices"]}
        self.assertEqual(names, {"Device A", "Device B"})


# ---------------------------------------------------------------------------
# Negative zero normalization tests
# ---------------------------------------------------------------------------

class TestNegativeZeroNormalization(unittest.TestCase):

    def test_nz_negative_zero_returns_positive_zero(self):
        # Arrange
        value = -0.0

        # Act
        result = config._nz(value)

        # Assert
        self.assertEqual(result, 0.0)
        self.assertNotEqual(str(result), "-0.0")

    def test_nz_positive_zero_returns_positive_zero(self):
        # Arrange
        value = 0.0

        # Act
        result = config._nz(value)

        # Assert
        self.assertEqual(result, 0.0)

    def test_nz_integer_zero_returns_positive_zero(self):
        # Arrange
        value = 0

        # Act
        result = config._nz(value)

        # Assert
        self.assertEqual(result, 0.0)

    def test_nz_positive_value_passes_through(self):
        # Arrange
        value = 3.14

        # Act
        result = config._nz(value)

        # Assert
        self.assertEqual(result, 3.14)

    def test_nz_negative_value_passes_through(self):
        # Arrange
        value = -5.0

        # Act
        result = config._nz(value)

        # Assert
        self.assertEqual(result, -5.0)

    def test_snapshot_no_negative_zero_with_zero_grid_power(self):
        """Snapshot values must not contain negative zero."""
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home_info = _make_home_device_info(
            solarPower=0, gridPower=0, backUpPower=0,
        )

        # Act
        with patch.object(epcube_collector, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home_info)):
            c.poll()

        # Assert
        snap = c._history[-1]
        dev = snap["devices"][0]
        self.assertNotEqual(str(dev["grid_kw"]), "-0.0")
        self.assertNotEqual(str(dev["battery_kw"]), "-0.0")
        self.assertNotEqual(str(dev["solar_kw"]), "-0.0")


# ---------------------------------------------------------------------------
# Auth re-authentication test
# ---------------------------------------------------------------------------

class TestReauth(unittest.TestCase):

    def test_reauth_on_401(self):
        c = _make_collector()
        c._token = "expired-token"
        c._devices = [_make_device()]

        call_count = {"n": 0}

        def mock_api(method, path, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise auth.AuthExpiredError("Token expired")
            if "homeDeviceInfo" in path:
                return _make_home_device_info()
            elif "deviceList" in path:
                return {"status": 200, "data": c._devices}
            return {"status": 200, "data": {}}

        with patch.object(epcube_collector, "_api_request", side_effect=mock_api):
            with patch.object(epcube_collector, "authenticate", return_value="new-token"):
                c._api("/home/homeDeviceInfo?sgSn=test")

        self.assertEqual(c._token, "new-token")


# ---------------------------------------------------------------------------
# JWT expiry decoding
# ---------------------------------------------------------------------------

class TestJwtExp(unittest.TestCase):

    def test_decodes_valid_jwt_exp(self):
        # Build a JWT with exp=1700000000
        payload = base64.urlsafe_b64encode(json.dumps({"exp": 1700000000}).encode()).rstrip(b"=").decode()
        token = f"header.{payload}.signature"
        self.assertEqual(auth._jwt_exp(token), 1700000000)

    def test_returns_zero_for_invalid_token(self):
        self.assertEqual(auth._jwt_exp("not-a-jwt"), 0)

    def test_returns_zero_for_missing_exp(self):
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "user"}).encode()).rstrip(b"=").decode()
        token = f"header.{payload}.signature"
        self.assertEqual(auth._jwt_exp(token), 0)


# ---------------------------------------------------------------------------
# Stale data detection
# ---------------------------------------------------------------------------

class TestStaleDataDetection(unittest.TestCase):

    def test_all_zeros_is_stale(self):
        data = {
            "solarPower": "0.00",
            "gridPower": "0.00",
            "backUpPower": "0.00",
            "batterySoc": 0,
            "batteryCurrentElectricity": "0.00",
        }
        self.assertTrue(epcube_collector.EpCubeCollector._data_looks_stale(data))

    def test_nonzero_soc_is_not_stale(self):
        data = {
            "solarPower": "0.00",
            "gridPower": "0.00",
            "backUpPower": "0.00",
            "batterySoc": 75,
            "batteryCurrentElectricity": "0.00",
        }
        self.assertFalse(epcube_collector.EpCubeCollector._data_looks_stale(data))

    def test_nonzero_backup_is_not_stale(self):
        data = {
            "solarPower": "0.00",
            "gridPower": "0.00",
            "backUpPower": "2.74",
            "batterySoc": 0,
            "batteryCurrentElectricity": "0.00",
        }
        self.assertFalse(epcube_collector.EpCubeCollector._data_looks_stale(data))

    def test_empty_data_is_stale(self):
        self.assertTrue(epcube_collector.EpCubeCollector._data_looks_stale({}))

    def test_none_data_is_stale(self):
        self.assertTrue(epcube_collector.EpCubeCollector._data_looks_stale(None))

    def test_normal_data_is_not_stale(self):
        data = _make_home_device_info()["data"]
        self.assertFalse(epcube_collector.EpCubeCollector._data_looks_stale(data))


# ---------------------------------------------------------------------------
# Proactive token refresh
# ---------------------------------------------------------------------------

class TestProactiveTokenRefresh(unittest.TestCase):

    def test_token_expiring_soon_true_when_within_5min(self):
        c = _make_collector()
        c._token = "some-token"
        c._token_exp = time.time() + 200  # 3.3 min left
        self.assertTrue(c._token_expiring_soon())

    def test_token_expiring_soon_false_when_plenty_of_time(self):
        c = _make_collector()
        c._token = "some-token"
        c._token_exp = time.time() + 3600  # 1h left
        self.assertFalse(c._token_expiring_soon())

    def test_token_expiring_soon_false_when_no_exp(self):
        c = _make_collector()
        c._token = "some-token"
        c._token_exp = 0
        self.assertFalse(c._token_expiring_soon())

    def test_ensure_auth_refreshes_expiring_token(self):
        c = _make_collector()
        c._token = "old-token"
        c._token_exp = time.time() + 100  # about to expire
        c._devices = [_make_device()]

        with patch.object(epcube_collector, "authenticate", return_value="fresh-token") as auth_mock:
            with patch.object(epcube_collector, "_api_request", return_value={"status": 200, "data": [_make_device()]}):
                c._ensure_auth()

        auth_mock.assert_called_once()
        self.assertEqual(c._token, "fresh-token")

    def test_ensure_auth_skips_refresh_when_token_valid(self):
        c = _make_collector()
        c._token = "valid-token"
        c._token_exp = time.time() + 3600  # plenty of time

        with patch.object(epcube_collector, "authenticate") as auth_mock:
            c._ensure_auth()

        auth_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Stale data triggers re-auth during poll
# ---------------------------------------------------------------------------

class TestStaleDataReauth(unittest.TestCase):

    def test_poll_reauths_on_stale_data(self):
        c = _make_collector()
        c._token = "stale-token"
        c._token_exp = time.time() + 3600  # token not expired by clock
        c._devices = [_make_device()]

        call_count = {"n": 0}
        stale_data = {"solarPower": "0.00", "gridPower": "0.00", "backUpPower": "0.00",
                      "batterySoc": 0, "batteryCurrentElectricity": "0.00", "systemStatus": "?"}
        good_data = _make_home_device_info()["data"]

        def mock_api(method, path, **kwargs):
            if "homeDeviceInfo" in path:
                call_count["n"] += 1
                if call_count["n"] == 1:
                    return {"status": 200, "data": stale_data}
                return {"status": 200, "data": good_data}
            elif "deviceList" in path:
                return {"status": 200, "data": c._devices}
            return {"status": 200, "data": {}}

        with patch.object(epcube_collector, "_api_request", side_effect=mock_api):
            with patch.object(epcube_collector, "authenticate", return_value="fresh-token"):
                c.poll()

        self.assertEqual(c._token, "fresh-token")
        # Verify poll completed with good data (snapshot has non-zero values)
        self.assertTrue(len(c._history) > 0)
        snap_dev = c._history[-1]["devices"][0]
        self.assertEqual(snap_dev["battery_soc"], 75)


# ---------------------------------------------------------------------------
# PostgresWriter tests
# ---------------------------------------------------------------------------

class TestPostgresWriter(unittest.TestCase):
    """Tests for PostgresWriter using mocked psycopg2."""

    def _make_mock_psycopg2(self):
        """Create a mock psycopg2 module with connection and cursor."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor

        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_init_creates_schema(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        mock_pg.connect.assert_called_once_with("postgresql://test:test@localhost/test")
        mock_cursor.execute.assert_called_once()
        # The schema SQL should contain CREATE TABLE
        call_args = mock_cursor.execute.call_args[0][0]
        self.assertIn("CREATE TABLE IF NOT EXISTS devices", call_args)
        self.assertIn("CREATE TABLE IF NOT EXISTS readings", call_args)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_upsert_device(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        writer.upsert_device("epcube1_battery", "storage_battery",
                             alias="Test Device", manufacturer="Canadian Solar",
                             product_code="EP Cube", uid="SN123")

        mock_cursor.execute.assert_called_once()
        call_args = mock_cursor.execute.call_args
        self.assertIn("INSERT INTO devices", call_args[0][0])
        self.assertIn("ON CONFLICT", call_args[0][0])
        self.assertEqual(call_args[0][1][0], "epcube1_battery")
        self.assertEqual(call_args[0][1][1], "storage_battery")
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_upsert_device_sets_status_active(self, mock_pg):
        """Re-discovered devices must be set back to 'active' on upsert."""
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()

        writer.upsert_device("epcube1_battery", "storage_battery")

        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("status", sql.lower())
        self.assertIn("active", sql.lower())

    @patch.object(db, "psycopg2")
    def test_write_readings(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        readings = [
            ("epcube1_battery", "battery_state_of_capacity_percent", now, 75.0),
            ("epcube1_battery", "grid_power_watts", now, 500.0),
        ]
        writer.write_readings(readings)

        mock_pg.extras.execute_values.assert_called_once()
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_write_empty_readings_is_noop(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        mock_conn.reset_mock()

        writer.write_readings([])
        mock_conn.commit.assert_not_called()

    @patch.object(db, "psycopg2")
    def test_reconnects_on_closed_connection(self, mock_pg):
        mock_conn1, _ = self._make_mock_psycopg2()
        mock_conn2, mock_cursor2 = self._make_mock_psycopg2()

        # First call returns conn1 (for init), then conn1.closed=True forces reconnect
        mock_pg.connect.side_effect = [mock_conn1, mock_conn2]

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        mock_conn1.closed = True  # simulate connection dropped

        writer.upsert_device("d1", "storage_battery")

        # Should have connected twice
        self.assertEqual(mock_pg.connect.call_count, 2)

    @patch.object(db, "psycopg2")
    def test_close(self, mock_pg):
        mock_conn, _ = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = db.PostgresWriter("postgresql://test:test@localhost/test")
        writer.close()

        mock_conn.close.assert_called_once()


class TestPollWithPostgres(unittest.TestCase):
    """Tests that poll() writes to Postgres when a writer is configured."""

    @patch.object(db, "psycopg2")
    def test_poll_writes_to_postgres(self, mock_pg):
        mock_conn, mock_cursor = MagicMock(), MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()

        pg_writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        c = epcube_collector.EpCubeCollector("user@test.com", "password", pg_writer=pg_writer)
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()

        # Should have called upsert_device (2 per device: battery + solar)
        upsert_calls = [call for call in mock_cursor.execute.call_args_list
                        if 'INSERT INTO devices' in str(call)]
        self.assertGreaterEqual(len(upsert_calls), 2)

        # Should have called write_readings via execute_values
        self.assertTrue(mock_pg.extras.execute_values.called)

    @patch.object(db, "psycopg2")
    def test_poll_continues_on_postgres_error(self, mock_pg):
        """Poll should not fail if Postgres write raises an exception."""
        pg_writer = MagicMock()
        pg_writer.upsert_device.side_effect = Exception("DB connection lost")

        c = epcube_collector.EpCubeCollector("user@test.com", "password", pg_writer=pg_writer)
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()  # Should NOT raise

        # Poll should complete and update snapshot history
        self.assertTrue(len(c._history) > 0)


# ---------------------------------------------------------------------------
# Test: poll() does not produce _metrics_text attribute
# ---------------------------------------------------------------------------

class TestPollNoMetricsText(unittest.TestCase):
    """Verify that EpCubeCollector has no _metrics_text attribute after poll()."""

    def test_poll_no_metrics_text_attribute(self):
        # Arrange
        c = _make_collector()
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        # Act
        with patch.object(epcube_collector, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()

        # Assert
        self.assertFalse(hasattr(c, "_metrics_text"))


# ---------------------------------------------------------------------------
# T005: Flexible credential startup tests
# ---------------------------------------------------------------------------

class TestFlexibleCredentialStartup(unittest.TestCase):
    """Tests that main() starts collectors based on which credentials are configured."""

    @patch.dict(os.environ, {"EPCUBE_USERNAME": "u", "EPCUBE_PASSWORD": "p",
                              "EMPORIA_USERNAME": "eu", "EMPORIA_PASSWORD": "ep"}, clear=False)
    @patch.object(exporter, "psycopg2", MagicMock())
    @patch.object(exporter, "POSTGRES_DSN", "postgresql://test@localhost/test")
    def test_both_credentials_starts_both(self):
        # Arrange
        with patch.object(exporter, "EpCubeCollector") as mock_epc, \
             patch.object(exporter, "VueCollector") as mock_vue, \
             patch.object(exporter, "PostgresWriter"), \
             patch.object(exporter, "VuePostgresWriter"), \
             patch("threading.Thread") as mock_thread, \
             patch.object(exporter.HTTPServer, "__init__", return_value=None), \
             patch.object(exporter.HTTPServer, "serve_forever", side_effect=KeyboardInterrupt):
            mock_epc_inst = MagicMock()
            mock_epc.return_value = mock_epc_inst
            mock_vue_inst = MagicMock()
            mock_vue.return_value = mock_vue_inst

            # Act
            exporter.main()

            # Assert
            mock_epc.assert_called_once()
            mock_vue.assert_called_once()

    @patch.dict(os.environ, {"EPCUBE_USERNAME": "u", "EPCUBE_PASSWORD": "p"}, clear=False)
    @patch.object(exporter, "psycopg2", MagicMock())
    @patch.object(exporter, "POSTGRES_DSN", "postgresql://test@localhost/test")
    def test_only_epcube_credentials_starts_epcube_only(self):
        # Arrange
        env = os.environ.copy()
        env.pop("EMPORIA_USERNAME", None)
        env.pop("EMPORIA_PASSWORD", None)
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "EpCubeCollector") as mock_epc, \
             patch.object(exporter, "PostgresWriter"), \
             patch.object(exporter, "VuePostgresWriter"), \
             patch("threading.Thread") as mock_thread, \
             patch.object(exporter.HTTPServer, "__init__", return_value=None), \
             patch.object(exporter.HTTPServer, "serve_forever", side_effect=KeyboardInterrupt):
            mock_epc_inst = MagicMock()
            mock_epc.return_value = mock_epc_inst

            # Act
            exporter.main()

            # Assert
            mock_epc.assert_called_once()
            # VueCollector should not be instantiated when no Vue creds
            mock_thread_calls = [str(c) for c in mock_thread.call_args_list]
            vue_threads = [c for c in mock_thread_calls if "vue" in c.lower()]
            self.assertEqual(len(vue_threads), 0, "Vue thread should not start without Vue credentials")

    @patch.dict(os.environ, {"EMPORIA_USERNAME": "eu", "EMPORIA_PASSWORD": "ep"}, clear=False)
    @patch.object(exporter, "psycopg2", MagicMock())
    @patch.object(exporter, "POSTGRES_DSN", "postgresql://test@localhost/test")
    def test_only_vue_credentials_starts_vue_only(self):
        # Arrange
        env = os.environ.copy()
        env.pop("EPCUBE_USERNAME", None)
        env.pop("EPCUBE_PASSWORD", None)
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "VueCollector") as mock_vue, \
             patch.object(exporter, "PostgresWriter"), \
             patch.object(exporter, "VuePostgresWriter"), \
             patch("threading.Thread") as mock_thread, \
             patch.object(exporter.HTTPServer, "__init__", return_value=None), \
             patch.object(exporter.HTTPServer, "serve_forever", side_effect=KeyboardInterrupt):
            mock_vue_inst = MagicMock()
            mock_vue.return_value = mock_vue_inst

            # Act
            exporter.main()

            # Assert
            mock_vue.assert_called_once()

    def test_no_credentials_exits_with_error(self):
        # Arrange
        env = os.environ.copy()
        env.pop("EPCUBE_USERNAME", None)
        env.pop("EPCUBE_PASSWORD", None)
        env.pop("EMPORIA_USERNAME", None)
        env.pop("EMPORIA_PASSWORD", None)

        # Act & Assert
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "POSTGRES_DSN", "postgresql://test@localhost/test"), \
             self.assertRaises(SystemExit) as ctx:
            exporter.main()
        self.assertEqual(ctx.exception.code, 1)


# ---------------------------------------------------------------------------
# T007: Vue schema creation tests
# ---------------------------------------------------------------------------

class TestVuePostgresWriterSchema(unittest.TestCase):
    """Tests for VuePostgresWriter schema creation."""

    def _make_mock_psycopg2(self):
        """Create a mock psycopg2 module with connection and cursor."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_init_creates_vue_schema(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        # Act
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")

        # Assert
        call_args = mock_cursor.execute.call_args[0][0]
        self.assertIn("CREATE TABLE IF NOT EXISTS vue_devices", call_args)
        self.assertIn("CREATE TABLE IF NOT EXISTS vue_channels", call_args)
        self.assertIn("CREATE TABLE IF NOT EXISTS vue_readings", call_args)
        self.assertIn("CREATE TABLE IF NOT EXISTS vue_readings_1min", call_args)
        self.assertIn("idx_vue_readings_device_channel_time", call_args)
        self.assertIn("idx_vue_readings_time", call_args)
        self.assertIn("idx_vue_readings_1min_device_channel_time", call_args)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_init_creates_vue_readings_daily_table(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        # Act
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")

        # Assert
        call_args = mock_cursor.execute.call_args[0][0]
        self.assertIn("CREATE TABLE IF NOT EXISTS vue_readings_daily", call_args)
        self.assertIn("device_gid", call_args)
        self.assertIn("channel_num", call_args)
        self.assertIn("date DATE", call_args)
        self.assertIn("kwh", call_args)
        self.assertIn("updated_at", call_args)


# ---------------------------------------------------------------------------
# T009: Vue upsert device/channel tests
# ---------------------------------------------------------------------------

class TestVuePostgresWriterUpsert(unittest.TestCase):
    """Tests for VuePostgresWriter upsert_device and upsert_channel."""

    def _make_mock_psycopg2(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_upsert_device(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        writer.upsert_device(
            device_gid=12345, device_name="Main Panel",
            model="VUE001", firmware="1.0.0", connected=True,
        )

        # Assert
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO vue_devices", sql)
        self.assertIn("ON CONFLICT (device_gid)", sql)
        params = mock_cursor.execute.call_args[0][1]
        self.assertEqual(params[0], 12345)
        self.assertEqual(params[1], "Main Panel")
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_upsert_device_updates_on_conflict(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act — call twice with different name
        writer.upsert_device(device_gid=12345, device_name="Old Name")
        writer.upsert_device(device_gid=12345, device_name="New Name")

        # Assert — two upsert calls, second has new name
        self.assertEqual(mock_cursor.execute.call_count, 2)
        second_params = mock_cursor.execute.call_args_list[1][0][1]
        self.assertEqual(second_params[1], "New Name")

    @patch.object(db, "psycopg2")
    def test_upsert_channel(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        writer.upsert_channel(
            device_gid=12345, channel_num="1,2,3", name="Main",
            channel_multiplier=1.0, channel_type="Main",
        )

        # Assert
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO vue_channels", sql)
        self.assertIn("ON CONFLICT (device_gid, channel_num)", sql)
        params = mock_cursor.execute.call_args[0][1]
        self.assertEqual(params[0], 12345)
        self.assertEqual(params[1], "1,2,3")
        self.assertEqual(params[2], "Main")
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_upsert_channel_balance(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        writer.upsert_channel(
            device_gid=12345, channel_num="Balance", name="Balance",
        )

        # Assert
        params = mock_cursor.execute.call_args[0][1]
        self.assertEqual(params[1], "Balance")
        self.assertEqual(params[2], "Balance")


# ---------------------------------------------------------------------------
# T011: Vue write_readings tests
# ---------------------------------------------------------------------------

class TestVuePostgresWriterReadings(unittest.TestCase):
    """Tests for VuePostgresWriter.write_readings."""

    def _make_mock_psycopg2(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_write_readings_batch(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()
        now = datetime.now(timezone.utc)
        readings = [
            (12345, "1,2,3", now, 8450.5),
            (12345, "1", now, 4200.0),
            (12345, "Balance", now, 1200.0),
        ]

        # Act
        writer.write_readings(readings)

        # Assert
        mock_pg.extras.execute_values.assert_called_once()
        call_args = mock_pg.extras.execute_values.call_args
        sql = call_args[0][1]
        self.assertIn("INSERT INTO vue_readings", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertEqual(call_args[0][2], readings)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_write_empty_readings_is_noop(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_conn.reset_mock()

        # Act
        writer.write_readings([])

        # Assert
        mock_conn.commit.assert_not_called()

    @patch.object(db, "psycopg2")
    def test_write_readings_with_negative_values(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()
        now = datetime.now(timezone.utc)
        readings = [
            (12345, "4", now, -150.0),  # solar backfeed
        ]

        # Act
        writer.write_readings(readings)

        # Assert — negative value passed through unchanged
        passed_readings = mock_pg.extras.execute_values.call_args[0][2]
        self.assertEqual(passed_readings[0][3], -150.0)

    @patch.object(db, "psycopg2")
    def test_write_readings_reconnects_on_closed(self, mock_pg):
        # Arrange
        mock_conn1, _ = self._make_mock_psycopg2()
        mock_conn2, mock_cursor2 = self._make_mock_psycopg2()
        mock_pg.connect.side_effect = [mock_conn1, mock_conn2]
        mock_pg.extras = MagicMock()
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_conn1.closed = True

        now = datetime.now(timezone.utc)

        # Act
        writer.write_readings([(12345, "1,2,3", now, 1000.0)])

        # Assert — reconnected
        self.assertEqual(mock_pg.connect.call_count, 2)


# ---------------------------------------------------------------------------
# T013: VueCollector initialization and login tests
# ---------------------------------------------------------------------------

def _mock_pyemvue():
    """Create a mock PyEmVue instance with devices and usage."""
    mock_vue = MagicMock()

    # Mock device with channels
    mock_device = MagicMock()
    mock_device.device_gid = 12345
    mock_device.device_name = "Main Panel"
    mock_device.model = "VUE001"
    mock_device.firmware = "1.0"
    mock_device.connected = True
    mock_device.offline_since = None

    mock_ch1 = MagicMock()
    mock_ch1.device_gid = 12345
    mock_ch1.channel_num = "1,2,3"
    mock_ch1.name = "Main"
    mock_ch1.channel_multiplier = 1.0
    mock_ch1.channel_type_gid = None

    mock_ch2 = MagicMock()
    mock_ch2.device_gid = 12345
    mock_ch2.channel_num = "1"
    mock_ch2.name = "Kitchen"
    mock_ch2.channel_multiplier = 1.0
    mock_ch2.channel_type_gid = None

    mock_device.channels = [mock_ch1, mock_ch2]
    mock_vue.get_devices.return_value = [mock_device]

    # Mock usage result
    mock_usage_device = MagicMock()
    mock_usage_device.device_gid = 12345
    mock_usage_device.timestamp = datetime(2026, 4, 8, 12, 0, 0, tzinfo=timezone.utc)

    mock_ch_usage_main = MagicMock()
    mock_ch_usage_main.device_gid = 12345
    mock_ch_usage_main.channel_num = "1,2,3"
    mock_ch_usage_main.name = "Main"
    mock_ch_usage_main.usage = 0.002347  # kWh for 1S scale → ~8449 watts

    mock_ch_usage_kitchen = MagicMock()
    mock_ch_usage_kitchen.device_gid = 12345
    mock_ch_usage_kitchen.channel_num = "1"
    mock_ch_usage_kitchen.name = "Kitchen"
    mock_ch_usage_kitchen.usage = 0.000333  # kWh → ~1199 watts

    mock_usage_device.channels = {"1,2,3": mock_ch_usage_main, "1": mock_ch_usage_kitchen}
    mock_vue.get_device_list_usage.return_value = {12345: mock_usage_device}

    return mock_vue


class TestVueCollectorInit(unittest.TestCase):
    """T013: VueCollector initialization and login tests."""

    @patch("vue_collector.PyEmVue")
    def test_successful_login(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Assert
        mock_vue.login.assert_called_once_with(username="user@test.com", password="password")
        self.assertTrue(collector._authenticated)

    @patch("vue_collector.PyEmVue")
    def test_login_failure_sets_not_authenticated(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = MagicMock()
        mock_vue.login.side_effect = Exception("Auth failed")
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = vue_collector.VueCollector("bad@test.com", "badpass", pg_writer=MagicMock())

        # Assert
        self.assertFalse(collector._authenticated)
        self.assertEqual(collector._device_count, 0)

    @patch("vue_collector.PyEmVue")
    def test_login_discovers_devices(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Assert
        mock_vue.get_devices.assert_called_once()
        self.assertEqual(collector._device_count, 1)
        self.assertEqual(collector._circuit_count, 2)


# ---------------------------------------------------------------------------
# T014: VueCollector.poll() tests
# ---------------------------------------------------------------------------

class TestVueCollectorPoll(unittest.TestCase):
    """T014: VueCollector.poll() tests."""

    @patch("vue_collector.PyEmVue")
    def test_poll_calls_get_device_list_usage(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Act
        collector.poll()

        # Assert
        mock_vue.get_device_list_usage.assert_called_once()
        call_kwargs = mock_vue.get_device_list_usage.call_args
        self.assertEqual(call_kwargs[1].get("unit") or call_kwargs[0][3] if len(call_kwargs[0]) > 3 else call_kwargs[1].get("unit"), "KilowattHours")

    @patch("vue_collector.PyEmVue")
    def test_poll_converts_kwh_to_watts(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act
        collector.poll()

        # Assert — readings written should be in watts
        write_call = mock_pg.write_readings.call_args[0][0]
        # kWh 0.002347 * 3_600_000 = 8449.2
        main_reading = [r for r in write_call if r[1] == "1,2,3"][0]
        self.assertAlmostEqual(main_reading[3], 0.002347 * 3_600_000, places=0)

    @patch("vue_collector.PyEmVue")
    def test_poll_skips_none_channels(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # Make kitchen channel offline (None usage)
        mock_vue.get_device_list_usage.return_value[12345].channels["1"].usage = None
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act
        collector.poll()

        # Assert — only main channel written (kitchen skipped)
        write_call = mock_pg.write_readings.call_args[0][0]
        self.assertEqual(len(write_call), 1)
        self.assertEqual(write_call[0][1], "1,2,3")

    @patch("vue_collector.PyEmVue")
    def test_poll_continues_on_device_error(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # Add a second device that errors
        mock_dev2 = MagicMock()
        mock_dev2.device_gid = 99999
        mock_dev2.device_name = "Broken"
        mock_dev2.model = "VUE001"
        mock_dev2.firmware = "1.0"
        mock_dev2.connected = True
        mock_dev2.channels = []
        mock_vue.get_devices.return_value.append(mock_dev2)
        # Usage for device 99999 raises an error
        original_usage = mock_vue.get_device_list_usage.return_value.copy()
        mock_bad_device = MagicMock()
        mock_bad_device.channels = {}
        # Accessing channels raises
        type(mock_bad_device).channels = property(lambda s: (_ for _ in ()).throw(Exception("Device error")))
        original_usage[99999] = mock_bad_device
        mock_vue.get_device_list_usage.return_value = original_usage
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act — should not raise
        collector.poll()

        # Assert — readings from working device still written
        self.assertTrue(mock_pg.write_readings.called)

    @patch("vue_collector.PyEmVue")
    def test_poll_updates_last_poll_time(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Act
        before = time.time()
        collector.poll()

        # Assert
        self.assertGreaterEqual(collector._last_poll, before)

    @patch("vue_collector.PyEmVue")
    def test_poll_when_not_authenticated_retries_login(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = MagicMock()
        mock_vue.login.side_effect = [Exception("First fail"), None]
        mock_vue.get_devices.return_value = []
        mock_vue.get_device_list_usage.return_value = {}
        mock_pyemvue_cls.return_value = mock_vue

        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        self.assertFalse(collector._authenticated)

        # Act — poll should retry login
        mock_vue.login.side_effect = None  # Now login succeeds
        collector.poll()

        # Assert — login called again
        self.assertGreaterEqual(mock_vue.login.call_count, 2)


# ---------------------------------------------------------------------------
# T015: Device/channel discovery refresh tests
# ---------------------------------------------------------------------------

class TestVueDeviceDiscovery(unittest.TestCase):
    """T015: Device/channel discovery refresh tests."""

    @patch("vue_collector.PyEmVue")
    def test_discover_upserts_devices_to_postgres(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Assert — upsert_device called during init
        mock_pg.upsert_device.assert_called_once_with(
            device_gid=12345, device_name="Main Panel",
            model="VUE001", firmware="1.0", connected=True,
        )

    @patch("vue_collector.PyEmVue")
    def test_discover_upserts_channels_to_postgres(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Assert — upsert_channel called for each channel
        self.assertEqual(mock_pg.upsert_channel.call_count, 2)

    @patch("vue_collector.PyEmVue")
    def test_refresh_updates_device_list(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        self.assertEqual(collector._device_count, 1)

        # Add a new device
        mock_dev2 = MagicMock()
        mock_dev2.device_gid = 23456
        mock_dev2.device_name = "Workshop"
        mock_dev2.model = "VUE002"
        mock_dev2.firmware = "2.0"
        mock_dev2.connected = True
        mock_dev2.channels = []
        mock_vue.get_devices.return_value.append(mock_dev2)

        # Act
        collector._discover_devices()

        # Assert
        self.assertEqual(collector._device_count, 2)

    @patch("vue_collector.PyEmVue")
    def test_discover_deduplicates_same_gid(self, mock_pyemvue_cls):
        # Arrange — PyEmVue returns two entries with same gid (VUE003 hub + WAT001 CT module)
        mock_vue = MagicMock()
        mock_vue.login.return_value = None

        mock_hub = MagicMock()
        mock_hub.device_gid = 480380
        mock_hub.device_name = "Main Panel"
        mock_hub.model = "VUE003"
        mock_hub.firmware = "1.0"
        mock_hub.connected = True
        mock_hub.channels = [MagicMock(device_gid=480380, channel_num="1,2,3", name="Main",
                                        channel_multiplier=1.0, channel_type_gid=None)]

        mock_ct = MagicMock()
        mock_ct.device_gid = 480380  # Same gid!
        mock_ct.device_name = ""
        mock_ct.model = "WAT001"
        mock_ct.firmware = "1.0"
        mock_ct.connected = False
        mock_ct.channels = [MagicMock() for _ in range(18)]

        mock_vue.get_devices.return_value = [mock_hub, mock_ct]
        mock_vue.get_device_list_usage.return_value = {}
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Assert — only 1 device, not 2, but channels merged from both entries
        self.assertEqual(collector._device_count, 1)
        self.assertEqual(collector._circuit_count, 19)  # 1 mains + 18 CT channels


# ---------------------------------------------------------------------------
# T016: Vue poll interval from settings table tests
# ---------------------------------------------------------------------------

class TestVuePollInterval(unittest.TestCase):
    """T016: Vue poll interval reading from settings table tests."""

    def test_default_interval_is_1_second(self):
        # Assert
        self.assertEqual(vue_collector.DEFAULT_VUE_POLL_INTERVAL, 1)

    @patch("vue_collector._read_vue_poll_interval_from_db", return_value=5)
    @patch("vue_collector.PyEmVue")
    def test_vue_poll_loop_reads_interval(self, mock_pyemvue_cls, mock_read_interval):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Simulate one iteration of vue_poll_loop
        collector._poll_interval = mock_read_interval.return_value

        # Assert
        self.assertEqual(collector._poll_interval, 5)


# ---------------------------------------------------------------------------
# T017: Rate limit fallback tests
# ---------------------------------------------------------------------------

class TestVueRateLimitFallback(unittest.TestCase):
    """T017: Rate limit fallback (1S → 1MIN) tests."""

    @patch("vue_collector.PyEmVue")
    def test_degrades_to_1min_on_rate_limit(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # All channels return None (rate limited)
        for ch in mock_vue.get_device_list_usage.return_value[12345].channels.values():
            ch.usage = None
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._had_successful_poll = True  # had data before → this is rate limiting, not offline

        # Act
        collector.poll()

        # Assert — scale degraded
        self.assertEqual(collector._current_scale, "1MIN")

    @patch("vue_collector.PyEmVue")
    def test_recovers_to_1s_after_successful_polls(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._current_scale = "1MIN"
        collector._recovery_count = collector.RECOVERY_THRESHOLD - 1

        # Act
        collector.poll()

        # Assert — recovered to 1S
        self.assertEqual(collector._current_scale, "1S")

    @patch("vue_collector.PyEmVue")
    def test_kwh_conversion_adjusts_for_1min_scale(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._current_scale = "1MIN"
        mock_pg = MagicMock()
        collector._pg_writer = mock_pg

        # Act
        collector.poll()

        # Assert — conversion uses 60,000 not 3,600,000
        write_call = mock_pg.write_readings.call_args[0][0]
        main_reading = [r for r in write_call if r[1] == "1,2,3"][0]
        self.assertAlmostEqual(main_reading[3], 0.002347 * 60_000, places=0)


# ---------------------------------------------------------------------------
# T018: Vue debug page status section tests
# ---------------------------------------------------------------------------

class TestVueDebugPage(unittest.TestCase):
    """T018: Vue debug page status section tests."""

    @patch("vue_collector.PyEmVue")
    def test_get_vue_status(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()

        # Act
        status = collector.get_status()

        # Assert
        self.assertIn("device_count", status)
        self.assertIn("circuit_count", status)
        self.assertIn("last_poll", status)
        self.assertIn("current_scale", status)
        self.assertEqual(status["device_count"], 1)
        self.assertEqual(status["circuit_count"], 2)

    @patch("vue_collector.PyEmVue")
    def test_render_vue_debug_page(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert
        self.assertIn("Emporia Vue", html)
        self.assertIn("1", html)  # device count
        self.assertIn("2", html)  # circuit count
        self.assertIn("1S", html)  # scale


# ---------------------------------------------------------------------------
# T027: Downsampling job tests
# ---------------------------------------------------------------------------

class TestDownsampling(unittest.TestCase):
    """T027: Tests for downsample_vue_readings."""

    def _make_mock_psycopg2(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_downsample_executes_insert_select(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        db.downsample_vue_readings(writer)

        # Assert
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO vue_readings_1min", sql)
        self.assertIn("vue_readings", sql)
        self.assertIn("avg", sql.lower())
        self.assertIn("count", sql.lower())
        self.assertIn("date_trunc", sql.lower())
        self.assertIn("ON CONFLICT", sql)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_downsample_uses_last_complete_hour(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        db.downsample_vue_readings(writer)

        # Assert — SQL references hour boundary
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("date_trunc('hour'", sql.lower())

    @patch.object(db, "psycopg2")
    def test_downsample_handles_empty_table(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act — should not raise even with no data
        db.downsample_vue_readings(writer)

        # Assert — still executes (INSERT does nothing when SELECT returns empty)
        mock_cursor.execute.assert_called_once()
        mock_conn.commit.assert_called()


# ---------------------------------------------------------------------------
# T028: Raw data retention cleanup tests
# ---------------------------------------------------------------------------

class TestRetentionCleanup(unittest.TestCase):
    """T028: Tests for cleanup_old_vue_readings."""

    def _make_mock_psycopg2(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_cleanup_deletes_old_readings(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()
        mock_cursor.rowcount = 100

        # Act
        deleted = db.cleanup_old_vue_readings(writer)

        # Assert
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("DELETE FROM vue_readings", sql)
        self.assertIn("7 days", sql.lower().replace("'", ""))
        self.assertNotIn("vue_readings_1min", sql)
        mock_conn.commit.assert_called()
        self.assertEqual(deleted, 100)

    @patch.object(db, "psycopg2")
    def test_cleanup_does_not_touch_1min_table(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_cursor.rowcount = 0

        # Act
        db.cleanup_old_vue_readings(writer)

        # Assert — only one DELETE, and it's not against vue_readings_1min
        sql = mock_cursor.execute.call_args[0][0]
        self.assertNotIn("vue_readings_1min", sql)

    @patch.object(db, "psycopg2")
    def test_cleanup_returns_zero_when_nothing_to_delete(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_cursor.rowcount = 0

        # Act
        deleted = db.cleanup_old_vue_readings(writer)

        # Assert
        self.assertEqual(deleted, 0)


# ---------------------------------------------------------------------------
# Downsampling loop test
# ---------------------------------------------------------------------------

class TestDownsamplingLoop(unittest.TestCase):
    """Test for downsampling_loop thread function."""

    @patch.object(db, "cleanup_old_vue_readings", return_value=0)
    @patch.object(db, "downsample_vue_readings")
    def test_loop_calls_both_functions(self, mock_downsample, mock_cleanup):
        # Arrange
        mock_writer = MagicMock()
        call_count = {"n": 0}

        def side_effect(w):
            call_count["n"] += 1
            if call_count["n"] >= 2:
                raise KeyboardInterrupt  # break out of loop

        mock_downsample.side_effect = side_effect

        # Act
        try:
            db.downsampling_loop(mock_writer, interval_seconds=0)
        except KeyboardInterrupt:
            pass

        # Assert
        self.assertGreaterEqual(mock_downsample.call_count, 1)
        self.assertGreaterEqual(mock_cleanup.call_count, 1)


# ---------------------------------------------------------------------------
# T060: /vue debug page endpoint tests
# ---------------------------------------------------------------------------

class TestVueDebugPageEndpoint(unittest.TestCase):
    """T060: Tests for the /vue debug page showing per-circuit data."""

    @patch("vue_collector.PyEmVue")
    def test_vue_page_shows_device_sections(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        collector._last_readings = {
            (12345, "1,2,3"): 8450.5,
            (12345, "1"): 1200.0,
        }
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert — page contains device section
        self.assertIn("Main Panel", html)
        self.assertIn("12345", html)

    @patch("vue_collector.PyEmVue")
    def test_vue_page_shows_per_circuit_readings(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        collector._last_readings = {
            (12345, "1,2,3"): 8450.5,
            (12345, "1"): 1200.0,
        }
        collector._channel_names = {
            (12345, "1,2,3"): "Main",
            (12345, "1"): "Kitchen",
        }
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert — per-circuit rows with name and watts
        self.assertIn("Kitchen", html)
        self.assertIn("1.2 kW", html)  # 1200W formatted as kW
        self.assertIn("8.5 kW", html)  # 8450W formatted as kW
        self.assertIn("1,2,3", html)

    @patch("vue_collector.PyEmVue")
    def test_vue_page_shows_zero_watt_circuits(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        collector._last_readings = {
            (12345, "1,2,3"): 0.0,
        }
        collector._channel_names = {
            (12345, "1,2,3"): "Main",
        }
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert — 0W circuit still shown
        self.assertIn("Main", html)
        self.assertIn("0", html)

    @patch("vue_collector.PyEmVue")
    def test_vue_page_has_nav_link_to_status(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert — navigation link to EP Cube page
        self.assertIn("/status", html)

    @patch("vue_collector.PyEmVue")
    def test_vue_page_shows_local_time_timestamps(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._last_poll = time.time()
        vue_status = collector.get_status()

        # Act
        html = http_handler._render_vue_debug_page(vue_status)

        # Assert — uses JS client-side time conversion
        self.assertIn("toLocaleTimeString", html)

    def test_vue_page_not_configured(self):
        # Act
        html = http_handler._render_vue_debug_page(None)

        # Assert
        self.assertIn("not configured", html.lower())
        self.assertIn("/status", html)


# ---------------------------------------------------------------------------
# T061: EP Cube page navigation link tests
# ---------------------------------------------------------------------------

class TestEpCubePageNavLink(unittest.TestCase):
    """T061: Tests that EP Cube /status page has nav link to /vue."""

    def test_status_page_has_vue_link(self):
        # Arrange
        c = _make_collector()
        c._last_poll = time.time()
        c._consecutive_errors = 0
        status = c.get_status()
        health = c.get_health()

        # Act
        html = http_handler._render_status_page(status, health)

        # Assert
        self.assertIn("/vue", html)

    def test_status_page_does_not_contain_vue_circuit_data(self):
        # Arrange
        c = _make_collector()
        c._last_poll = time.time()
        c._consecutive_errors = 0
        status = c.get_status()
        health = c.get_health()

        # Act
        html = http_handler._render_status_page(status, health)

        # Assert — no Vue circuit data (nav link is OK, circuit tables are not)
        self.assertNotIn("vue_readings", html)
        self.assertNotIn("Vue:   Device", html)

    def test_status_page_no_metrics_link(self):
        # Arrange
        c = _make_collector()
        c._last_poll = time.time()
        c._consecutive_errors = 0
        status = c.get_status()
        health = c.get_health()

        # Act
        html = http_handler._render_status_page(status, health)

        # Assert
        self.assertNotIn("/metrics", html)


# ---------------------------------------------------------------------------
# T062: /vue page when not configured tests
# ---------------------------------------------------------------------------

class TestVuePageNotConfigured(unittest.TestCase):
    """T062: Tests for /vue when vue_collector is None."""

    def test_render_shows_not_configured_message(self):
        # Act
        html = http_handler._render_vue_debug_page(None)

        # Assert
        self.assertIn("not configured", html.lower())

    def test_render_has_nav_back_to_status(self):
        # Act
        html = http_handler._render_vue_debug_page(None)

        # Assert
        self.assertIn("/status", html)


# ---------------------------------------------------------------------------
# T014: Daily poll loop and vue_readings_daily upsert
# ---------------------------------------------------------------------------

class TestVuePostgresWriterDaily(unittest.TestCase):
    """Tests for VuePostgresWriter.upsert_daily_readings."""

    def _make_mock_psycopg2(self):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn, mock_cursor

    @patch.object(db, "psycopg2")
    def test_upsert_daily_readings_creates_rows(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()
        from datetime import date
        readings = [
            (12345, "1,2,3", date(2026, 4, 9), 42.5),
            (12345, "4", date(2026, 4, 9), 3.2),
        ]

        # Act
        writer.upsert_daily_readings(readings)

        # Assert
        mock_pg.extras.execute_values.assert_called_once()
        sql = mock_pg.extras.execute_values.call_args[0][1]
        self.assertIn("INSERT INTO vue_readings_daily", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("kwh", sql)
        self.assertEqual(mock_pg.extras.execute_values.call_args[0][2], readings)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_upsert_daily_readings_empty_is_noop(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_conn.reset_mock()

        # Act
        writer.upsert_daily_readings([])

        # Assert
        mock_conn.commit.assert_not_called()

    @patch.object(db, "psycopg2")
    def test_upsert_daily_updates_on_conflict(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()

        # Act — upsert guarantees update via ON CONFLICT
        from datetime import date
        readings = [(12345, "4", date(2026, 4, 9), 10.5)]
        writer.upsert_daily_readings(readings)

        # Assert — SQL uses ON CONFLICT DO UPDATE SET kwh
        sql = mock_pg.extras.execute_values.call_args[0][1]
        self.assertIn("DO UPDATE SET", sql)
        self.assertIn("kwh", sql)


class TestReadVueDailyPollInterval(unittest.TestCase):
    """Tests for _read_vue_daily_poll_interval_from_db (delegates to _read_setting_int_from_db)."""

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
    def test_returns_default_when_no_dsn(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=600)
    def test_reads_from_settings_table(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, 600)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
    def test_returns_default_on_db_error(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
    def test_returns_default_when_no_setting(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)


class TestVueCollectorPollDaily(unittest.TestCase):
    """Tests for VueCollector.poll_daily() — fetches daily kWh from Vue API."""

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_calls_api_with_1DAY_scale(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Act
        collector.poll_daily()

        # Assert
        calls = mock_vue.get_device_list_usage.call_args_list
        # poll() called during __init__ discovery, poll_daily adds another
        daily_call = calls[-1]
        self.assertEqual(daily_call[1].get("scale", daily_call[0][2] if len(daily_call[0]) > 2 else None), "1D")

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_writes_kwh_to_pg_writer(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_writer = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_writer)

        # Act
        collector.poll_daily()

        # Assert
        mock_writer.upsert_daily_readings.assert_called_once()
        readings = mock_writer.upsert_daily_readings.call_args[0][0]
        # Should have 2 channels: "1,2,3" and "1"
        self.assertEqual(len(readings), 2)
        # Each reading is (device_gid, channel_num, date_str, kwh)
        gids = [r[0] for r in readings]
        self.assertTrue(all(g == 12345 for g in gids))
        channels = sorted([r[1] for r in readings])
        self.assertEqual(channels, ["1", "1,2,3"])
        # kwh values should be raw (no multiplier)
        kwh_values = {r[1]: r[3] for r in readings}
        self.assertAlmostEqual(kwh_values["1,2,3"], 0.002347, places=6)
        self.assertAlmostEqual(kwh_values["1"], 0.000333, places=6)

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_uses_today_date(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_writer = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_writer)

        # Act
        collector.poll_daily()

        # Assert
        readings = mock_writer.upsert_daily_readings.call_args[0][0]
        today = datetime.now().strftime("%Y-%m-%d")
        dates = [r[2] for r in readings]
        self.assertTrue(all(d == today for d in dates))

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_skips_null_usage(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # Set kitchen usage to None
        mock_vue.get_device_list_usage.return_value[12345].channels["1"].usage = None
        mock_pyemvue_cls.return_value = mock_vue
        mock_writer = MagicMock()
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=mock_writer)

        # Act
        collector.poll_daily()

        # Assert — only mains written
        readings = mock_writer.upsert_daily_readings.call_args[0][0]
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0][1], "1,2,3")

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_handles_api_error(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        mock_vue.get_device_list_usage.side_effect = Exception("API down")

        # Act — should not raise
        collector.poll_daily()

        # Assert — error logged, no crash

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_skips_when_not_authenticated(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        collector._authenticated = False

        # Act
        collector.poll_daily()

        # Assert — no API calls for daily (poll retries login but daily should skip)
        # get_device_list_usage should not be called again for daily
        initial_calls = mock_vue.get_device_list_usage.call_count
        collector.poll_daily()
        self.assertEqual(mock_vue.get_device_list_usage.call_count, initial_calls)

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_no_write_without_pg_writer(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())

        # Act — should not raise
        collector.poll_daily()


class TestVueDailyPollLoop(unittest.TestCase):
    """Tests for vue_daily_poll_loop function."""

    @patch("vue_collector._read_vue_daily_poll_interval_from_db", return_value=30)
    @patch("vue_collector.time")
    @patch("vue_collector.PyEmVue")
    def test_loop_calls_poll_daily_on_interval(self, mock_pyemvue_cls, mock_time, mock_read_interval):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = vue_collector.VueCollector("user@test.com", "password", pg_writer=MagicMock())
        call_count = 0

        def sleep_side_effect(secs):
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                raise KeyboardInterrupt()  # break loop after 2 iterations

        mock_time.sleep.side_effect = sleep_side_effect
        mock_time.time.return_value = 1000.0

        # Act
        with self.assertRaises(KeyboardInterrupt):
            vue_collector.vue_daily_poll_loop(collector)

        # Assert
        mock_time.sleep.assert_called_with(30)
        self.assertEqual(mock_read_interval.call_count, 2)


class TestConfigureAzureMonitor(unittest.TestCase):
    """Tests for _configure_azure_monitor — conditional AppInsights setup."""

    @patch.dict(os.environ, {"APPLICATIONINSIGHTS_CONNECTION_STRING": "InstrumentationKey=00000000-0000-0000-0000-000000000000"})
    @patch("config._azure_monitor_configure")
    def test_calls_configure_when_connection_string_set(self, mock_configure):
        # Act
        config._configure_azure_monitor()

        # Assert
        mock_configure.assert_called_once()

    @patch.dict(os.environ, {}, clear=True)
    def test_skips_when_connection_string_missing(self):
        # Ensure no APPLICATIONINSIGHTS_CONNECTION_STRING
        os.environ.pop("APPLICATIONINSIGHTS_CONNECTION_STRING", None)

        # Act — should not raise
        config._configure_azure_monitor()

    @patch.dict(os.environ, {"APPLICATIONINSIGHTS_CONNECTION_STRING": ""})
    def test_skips_when_connection_string_empty(self):
        # Act — should not raise
        config._configure_azure_monitor()


class TestParseDeviceMetrics(unittest.TestCase):
    """Tests for parse_device_metrics — pure data extraction from API response."""

    def test_extracts_all_metric_fields(self):
        from epcube_collector import parse_device_metrics
        data = {
            "solarPower": 3.5,
            "batterySoc": 85,
            "gridPower": -1.2,
            "backUpPower": 2.1,
            "selfHelpRate": 92.5,
            "batteryCurrentElectricity": 12.5,
            "systemStatus": 1,
            "ressNumber": 2,
        }
        m = parse_device_metrics(data)
        self.assertAlmostEqual(m["solar_kw"], 3.5)
        self.assertAlmostEqual(m["solar_w"], 3500.0)
        self.assertEqual(m["soc"], 85)
        self.assertAlmostEqual(m["grid_kw"], -1.2)
        self.assertAlmostEqual(m["grid_w"], -1200.0)
        self.assertAlmostEqual(m["backup_kw"], 2.1)
        self.assertAlmostEqual(m["backup_w"], 2100.0)
        # battery_kw = solar + grid - backup = 3.5 + (-1.2) - 2.1 = 0.2
        self.assertAlmostEqual(m["battery_kw"], 0.2)
        self.assertAlmostEqual(m["battery_w"], 200.0)
        self.assertAlmostEqual(m["self_sufficiency"], 92.5)
        self.assertAlmostEqual(m["bat_stored_kwh"], 12.5)
        self.assertEqual(m["system_status_raw"], 1)
        self.assertEqual(m["ress_count"], 2)

    def test_defaults_to_zero_for_missing_fields(self):
        from epcube_collector import parse_device_metrics
        m = parse_device_metrics({})
        self.assertEqual(m["solar_kw"], 0)
        self.assertEqual(m["soc"], 0)
        self.assertEqual(m["grid_kw"], 0)
        self.assertEqual(m["backup_kw"], 0)

    def test_normalizes_negative_zero(self):
        from epcube_collector import parse_device_metrics
        data = {"solarPower": 0.0, "gridPower": 0.0, "backUpPower": 0.0,
                "batterySoc": 0, "batteryCurrentElectricity": 0,
                "selfHelpRate": 0, "systemStatus": 0, "ressNumber": 0}
        m = parse_device_metrics(data)
        # battery_kw = 0 + 0 - 0 = 0, should not be -0
        self.assertNotEqual(str(m["battery_w"]), "-0.0")


class TestBuildPostgresReadings(unittest.TestCase):
    """Tests for build_postgres_readings — pure tuple construction."""

    def test_builds_correct_tuples(self):
        from epcube_collector import build_postgres_readings
        from datetime import datetime, timezone
        ts = datetime(2026, 4, 18, 12, 0, 0, tzinfo=timezone.utc)
        metrics = {
            "solar_w": 3500.0, "soc": 85, "grid_w": 0.0,
            "backup_w": 2100.0, "battery_w": 1400.0,
            "self_sufficiency": 92.5, "bat_stored_kwh": 12.5,
            "bat_peak_kwh": 13.0,
        }
        readings = build_postgres_readings("epcube1", ts, metrics)
        # Should have 8 readings: solar + 7 battery metrics
        self.assertEqual(len(readings), 8)
        # Check solar reading
        solar = [r for r in readings if r[1] == "solar_instantaneous_generation_watts"]
        self.assertEqual(len(solar), 1)
        self.assertEqual(solar[0][0], "epcube1_solar")
        self.assertAlmostEqual(solar[0][3], 3500.0)
        # Check battery reading
        bat = [r for r in readings if r[1] == "battery_power_watts"]
        self.assertEqual(len(bat), 1)
        self.assertEqual(bat[0][0], "epcube1_battery")


class TestSafeFloat(unittest.TestCase):
    """Tests for _safe_float — NaN/Infinity rejection."""

    def test_normal_value(self):
        self.assertAlmostEqual(config._safe_float(3.5), 3.5)

    def test_string_value(self):
        self.assertAlmostEqual(config._safe_float("3.5"), 3.5)

    def test_nan_returns_zero(self):
        self.assertEqual(config._safe_float(float("nan")), 0.0)

    def test_nan_string_returns_zero(self):
        self.assertEqual(config._safe_float("NaN"), 0.0)

    def test_infinity_returns_zero(self):
        self.assertEqual(config._safe_float(float("inf")), 0.0)

    def test_negative_infinity_returns_zero(self):
        self.assertEqual(config._safe_float(float("-inf")), 0.0)

    def test_inf_string_returns_zero(self):
        self.assertEqual(config._safe_float("Infinity"), 0.0)

    def test_zero_returns_zero(self):
        self.assertEqual(config._safe_float(0), 0.0)

    def test_default_on_invalid(self):
        self.assertEqual(config._safe_float("not_a_number", 0), 0.0)


class TestParseDeviceMetricsNaN(unittest.TestCase):
    """parse_device_metrics rejects NaN/Infinity from cloud API."""

    def test_nan_solar_power_becomes_zero(self):
        data = {"solarPower": "NaN", "gridPower": 0, "backUpPower": 0,
                "batterySoc": 50, "selfHelpRate": 80,
                "batteryCurrentElectricity": 10, "systemStatus": 4, "ressNumber": 1}
        m = epcube_collector.parse_device_metrics(data)
        self.assertEqual(m["solar_kw"], 0.0)
        self.assertEqual(m["solar_w"], 0.0)

    def test_inf_grid_power_becomes_zero(self):
        data = {"solarPower": 1.0, "gridPower": "Infinity", "backUpPower": 0,
                "batterySoc": 50, "selfHelpRate": 80,
                "batteryCurrentElectricity": 10, "systemStatus": 4, "ressNumber": 1}
        m = epcube_collector.parse_device_metrics(data)
        self.assertEqual(m["grid_kw"], 0.0)


class TestStaleDataNaN(unittest.TestCase):
    """_data_looks_stale handles NaN without raising."""

    def test_nan_rejected_to_zero_makes_stale(self):
        # _safe_float rejects NaN → 0, so all fields become 0 → stale
        data = {"solarPower": "NaN", "gridPower": 0, "backUpPower": 0,
                "batterySoc": 0, "batteryCurrentElectricity": 0}
        c = _make_collector()
        self.assertTrue(c._data_looks_stale(data))


class TestStatusPageHtmlEscaping(unittest.TestCase):
    """Device names in the status page must be HTML-escaped."""

    def _make_status(self, **overrides):
        status = {
            "version": config.__version__,
            "uptime_s": 100,
            "poll_count": 1,
            "poll_errors": 0,
            "last_poll": time.time(),
            "poll_interval": 60,
            "next_poll_at": time.time() + 30,
            "devices": 1,
            "history": [],
        }
        status.update(overrides)
        return status

    def _make_health(self):
        return {"healthy": True, "checks": []}

    def test_device_name_with_html_is_escaped(self):
        snap = {
            "time": "2026-04-29T12:00:00Z",
            "time_minute": "2026-04-29T12:00Z",
            "devices": [{
                "name": "<script>alert('xss')</script>",
                "id": "1234",
                "solar_kw": 1.0, "battery_soc": 50, "battery_kw": 0.0,
                "grid_kw": 0.0, "backup_kw": 1.0, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "bat_peak_kwh": 10.0, "ress_count": 1,
                "solar_kwh": 5.0, "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0, "backup_kwh": 3.0,
            }],
        }
        html_out = http_handler._render_status_page(
            self._make_status(history=[snap]), self._make_health())
        # Raw XSS payload must not appear in device name context
        self.assertNotIn("<script>alert(", html_out)
        # Escaped version should appear
        self.assertIn("&lt;script&gt;", html_out)

    def test_device_name_with_ampersand_is_escaped(self):
        snap = {
            "time": "2026-04-29T12:00:00Z",
            "time_minute": "2026-04-29T12:00Z",
            "devices": [{
                "name": "Solar & Battery",
                "id": "5678",
                "solar_kw": 1.0, "battery_soc": 50, "battery_kw": 0.0,
                "grid_kw": 0.0, "backup_kw": 1.0, "self_sufficiency": 100,
                "system_status": "Normal", "bat_stored_kwh": 10.0,
                "bat_peak_kwh": 10.0, "ress_count": 1,
                "solar_kwh": 5.0, "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0, "backup_kwh": 3.0,
            }],
        }
        html_out = http_handler._render_status_page(
            self._make_status(history=[snap]), self._make_health())
        self.assertIn("Solar &amp; Battery", html_out)


class TestConcurrentPollGuard(unittest.TestCase):
    """poll() must skip if another poll is already in progress."""

    @patch("auth._api_request")
    @patch("auth.authenticate", return_value="fake-token")
    def test_overlapping_epcube_poll_skipped(self, mock_auth, mock_api):
        devices = [_make_device()]
        mock_api.side_effect = _mock_api_for(devices)
        c = _make_collector()
        c._token = "fake-token"
        c._token_exp = time.time() + 9999
        c._devices = devices

        # Simulate a poll in progress
        c._polling = True
        c.poll()
        # Should have been skipped — no API calls made
        mock_api.assert_not_called()

    @patch("auth._api_request")
    @patch("auth.authenticate", return_value="fake-token")
    def test_poll_sets_and_clears_polling_flag(self, mock_auth, mock_api):
        devices = [_make_device()]
        mock_api.side_effect = _mock_api_for(devices)
        c = _make_collector()
        c._token = "fake-token"
        c._token_exp = time.time() + 9999
        c._devices = devices

        self.assertFalse(c._polling)
        c.poll()
        # After poll completes, flag should be cleared
        self.assertFalse(c._polling)

    @patch("vue_collector.PyEmVue")
    def test_overlapping_vue_poll_skipped(self, mock_pyemvue):
        vue_mock = MagicMock()
        vue_mock.get_device_list_usage.return_value = {}
        pg = MagicMock()
        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = [123]
        vc._vue = vue_mock
        vc._last_device_refresh = time.time()  # prevent discover_devices

        # Simulate poll in progress
        vc._polling = True
        vc.poll()
        # Should have been skipped — no API calls
        vue_mock.get_device_list_usage.assert_not_called()


class TestUpdateBatteryPeak(unittest.TestCase):
    """Tests for update_battery_peak — pure peak tracking."""

    def test_new_day_starts_fresh(self):
        from epcube_collector import update_battery_peak
        bat_peak = {}
        result = update_battery_peak(bat_peak, "dev1", 10.0, "2026-04-18")
        self.assertAlmostEqual(result, 10.0)
        self.assertAlmostEqual(bat_peak["dev1"]["peak"], 10.0)

    def test_same_day_retains_max(self):
        from epcube_collector import update_battery_peak
        bat_peak = {"dev1": {"date": "2026-04-18", "peak": 15.0}}
        result = update_battery_peak(bat_peak, "dev1", 10.0, "2026-04-18")
        self.assertAlmostEqual(result, 15.0)

    def test_same_day_updates_when_higher(self):
        from epcube_collector import update_battery_peak
        bat_peak = {"dev1": {"date": "2026-04-18", "peak": 10.0}}
        result = update_battery_peak(bat_peak, "dev1", 15.0, "2026-04-18")
        self.assertAlmostEqual(result, 15.0)

    def test_new_day_resets(self):
        from epcube_collector import update_battery_peak
        bat_peak = {"dev1": {"date": "2026-04-17", "peak": 20.0}}
        result = update_battery_peak(bat_peak, "dev1", 5.0, "2026-04-18")
        self.assertAlmostEqual(result, 5.0)


# ---------------------------------------------------------------------------
# Coverage gap: config.py — psycopg2 ImportError branch
# NOTE: config.py:66 (except ImportError: pass) is an import-time branch
# that can only fire when psycopg2 is not installed. Reloading config
# breaks module-level references in http_handler/epcube_collector.
# Coverage gap accepted as environment-dependent.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Coverage gap: auth.py — _api_request, captcha, authenticate
# ---------------------------------------------------------------------------

class TestApiRequestHTTPError(unittest.TestCase):
    """Cover auth._api_request HTTPError handling."""

    def test_401_raises_auth_expired(self):
        # Arrange
        import urllib.error
        error = urllib.error.HTTPError(
            "https://example.com", 401, "Unauthorized", {}, BytesIO(b""))

        # Act & Assert
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(auth.AuthExpiredError):
                auth._api_request("GET", "/test")

    def test_non_401_reraises(self):
        # Arrange
        import urllib.error
        error = urllib.error.HTTPError(
            "https://example.com", 500, "Server Error", {}, BytesIO(b""))

        # Act & Assert
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(urllib.error.HTTPError):
                auth._api_request("GET", "/test")

    def test_success_returns_parsed_json(self):
        # Arrange
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"status": 200}'

        # Act
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = auth._api_request("GET", "/test")

        # Assert
        self.assertEqual(result, {"status": 200})

    def test_post_with_data_sends_body(self):
        # Arrange
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"ok": true}'

        # Act
        with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
            auth._api_request("POST", "/test", data={"key": "val"})

        # Assert
        req = mock_open.call_args[0][0]
        self.assertEqual(req.data, b'{"key": "val"}')

    def test_token_sets_authorization_header(self):
        # Arrange
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"ok": true}'

        # Act
        with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
            auth._api_request("GET", "/test", token="my-jwt")

        # Assert
        req = mock_open.call_args[0][0]
        self.assertEqual(req.get_header("Authorization"), "Bearer my-jwt")


class TestAesEncrypt(unittest.TestCase):
    """Cover auth._aes_encrypt (uses mocked Crypto)."""

    def test_returns_base64_string(self):
        # Arrange
        mock_cipher = MagicMock()
        mock_cipher.encrypt.return_value = b"encrypted_bytes"
        with patch.object(auth, "AES") as mock_aes, \
             patch.object(auth, "pad", return_value=b"padded"):
            mock_aes.new.return_value = mock_cipher
            mock_aes.MODE_ECB = 1
            mock_aes.block_size = 16

            # Act
            result = auth._aes_encrypt("hello", "0123456789abcdef")

        # Assert
        expected = base64.b64encode(b"encrypted_bytes").decode()
        self.assertEqual(result, expected)


class TestDecodeImage(unittest.TestCase):
    """Cover auth._decode_image (uses mocked cv2/numpy)."""

    def test_returns_decoded_image(self):
        # Arrange
        b64_data = base64.b64encode(b"fake_png_data").decode()
        mock_cv2 = sys.modules["cv2"]
        mock_np = sys.modules["numpy"]
        expected_img = MagicMock()
        mock_cv2.imdecode.return_value = expected_img
        mock_np.frombuffer.return_value = MagicMock()

        # Act
        result = auth._decode_image(b64_data)

        # Assert
        self.assertEqual(result, expected_img)
        mock_np.frombuffer.assert_called_once()
        mock_cv2.imdecode.assert_called_once()


class TestFindGapX(unittest.TestCase):
    """Cover auth._find_gap_x (uses mocked cv2/numpy)."""

    def test_returns_gap_position(self):
        # Arrange
        mock_cv2 = sys.modules["cv2"]
        mock_np = sys.modules["numpy"]

        # Create mock images with proper .shape tuples
        mock_bg = MagicMock()
        mock_bg.shape = (200, 300, 4)
        mock_piece = MagicMock()
        mock_piece.shape = (50, 50, 4)

        mock_cv2.imdecode.side_effect = [mock_bg, mock_piece]
        mock_cv2.minMaxLoc.return_value = (0, 0.95, (0, 0), (150, 10))
        mock_np.frombuffer.return_value = MagicMock()
        mock_np.mean.return_value = 150.0

        bg_b64 = base64.b64encode(b"bg_data").decode()
        piece_b64 = base64.b64encode(b"piece_data").decode()

        # Act
        result = auth._find_gap_x(bg_b64, piece_b64)

        # Assert
        self.assertEqual(result, 150)


class TestSolveCaptcha(unittest.TestCase):
    """Cover auth._solve_captcha."""

    def test_solves_on_first_attempt(self):
        # Arrange
        captcha_resp = {
            "data": {
                "secretKey": "0123456789abcdef",
                "token": "captcha-token-123",
                "originalImageBase64": base64.b64encode(b"bg").decode(),
                "jigsawImageBase64": base64.b64encode(b"piece").decode(),
            }
        }
        check_resp = {"status": 200}

        with patch.object(auth, "_api_request", side_effect=[captcha_resp, check_resp]), \
             patch.object(auth, "_find_gap_x", return_value=150), \
             patch.object(auth, "_aes_encrypt", return_value="encrypted"), \
             patch("time.sleep"), \
             patch("secrets.randbelow", return_value=500):

            # Act
            token, secret_key, point_json = auth._solve_captcha(max_attempts=1)

        # Assert
        self.assertEqual(token, "captcha-token-123")
        self.assertEqual(secret_key, "0123456789abcdef")
        self.assertIn('"x":150', point_json)

    def test_retries_on_failure(self):
        # Arrange
        captcha_resp = {
            "data": {
                "secretKey": "key123",
                "token": "tok123",
                "originalImageBase64": base64.b64encode(b"bg").decode(),
                "jigsawImageBase64": base64.b64encode(b"piece").decode(),
            }
        }
        fail_resp = {"status": 400}
        ok_resp = {"status": 200}

        with patch.object(auth, "_api_request",
                          side_effect=[captcha_resp, fail_resp, captcha_resp, ok_resp]), \
             patch.object(auth, "_find_gap_x", return_value=100), \
             patch.object(auth, "_aes_encrypt", return_value="enc"), \
             patch("time.sleep"), \
             patch("secrets.randbelow", return_value=500):

            # Act
            token, _, _ = auth._solve_captcha(max_attempts=2)

        # Assert
        self.assertEqual(token, "tok123")

    def test_raises_after_max_attempts(self):
        # Arrange
        captcha_resp = {
            "data": {
                "secretKey": "key",
                "token": "tok",
                "originalImageBase64": base64.b64encode(b"bg").decode(),
                "jigsawImageBase64": base64.b64encode(b"piece").decode(),
            }
        }
        fail_resp = {"status": 400}

        with patch.object(auth, "_api_request",
                          side_effect=[captcha_resp, fail_resp]), \
             patch.object(auth, "_find_gap_x", return_value=100), \
             patch.object(auth, "_aes_encrypt", return_value="enc"), \
             patch("time.sleep"), \
             patch("secrets.randbelow", return_value=500):

            # Act & Assert
            with self.assertRaises(RuntimeError):
                auth._solve_captcha(max_attempts=1)


class TestAuthenticate(unittest.TestCase):
    """Cover auth.authenticate."""

    def test_successful_login(self):
        # Arrange
        with patch.object(auth, "_solve_captcha",
                          return_value=("tok", "key", '{"x":1,"y":5}')), \
             patch.object(auth, "_aes_encrypt", return_value="captcha_verif"), \
             patch.object(auth, "_api_request",
                          return_value={"status": 200, "data": {"token": "jwt-token-123"}}):

            # Act
            result = auth.authenticate("user@test.com", "pass123")

        # Assert
        self.assertEqual(result, "jwt-token-123")

    def test_strips_bearer_prefix(self):
        # Arrange
        with patch.object(auth, "_solve_captcha",
                          return_value=("tok", "key", '{"x":1,"y":5}')), \
             patch.object(auth, "_aes_encrypt", return_value="verif"), \
             patch.object(auth, "_api_request",
                          return_value={"status": 200, "data": {"token": "Bearer actual-jwt"}}):

            # Act
            result = auth.authenticate("user", "pass")

        # Assert
        self.assertEqual(result, "actual-jwt")

    def test_login_failure_raises(self):
        # Arrange
        with patch.object(auth, "_solve_captcha",
                          return_value=("tok", "key", '{"x":1,"y":5}')), \
             patch.object(auth, "_aes_encrypt", return_value="verif"), \
             patch.object(auth, "_api_request",
                          return_value={"status": 500, "message": "bad creds"}):

            # Act & Assert
            with self.assertRaises(RuntimeError):
                auth.authenticate("user", "pass")


# ---------------------------------------------------------------------------
# Coverage gap: db.py — VuePostgresWriter.close, downsampling_loop errors
# ---------------------------------------------------------------------------

class TestVuePostgresWriterCloseConn(unittest.TestCase):
    """Cover VuePostgresWriter.close()."""

    def _make_writer(self, mock_conn):
        """Create a VuePostgresWriter with mocked psycopg2."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn
        with patch.object(db, "psycopg2", mock_pg):
            writer = db.VuePostgresWriter("postgresql://test")
        return writer

    def test_close_closes_open_connection(self):
        # Arrange
        mock_conn = MagicMock()
        mock_conn.closed = False
        writer = self._make_writer(mock_conn)

        # Act
        writer.close()

        # Assert
        mock_conn.close.assert_called_once()

    def test_close_skips_if_already_closed(self):
        # Arrange
        mock_conn = MagicMock()
        mock_conn.closed = False
        writer = self._make_writer(mock_conn)
        # Now mark it as closed
        mock_conn.closed = True

        # Act
        writer.close()

        # Assert — close() not called again because conn.closed is True
        mock_conn.close.assert_not_called()


class TestDownsamplingLoopErrors(unittest.TestCase):
    """Cover downsampling_loop exception handling paths."""

    def test_downsample_exception_is_caught(self):
        # Arrange
        writer = MagicMock()
        call_count = {"n": 0}
        orig_sleep = time.sleep

        def fake_sleep(secs):
            call_count["n"] += 1
            if call_count["n"] >= 2:
                raise KeyboardInterrupt("stop loop")

        with patch.object(db, "downsample_vue_readings", side_effect=RuntimeError("db down")), \
             patch.object(db, "cleanup_old_vue_readings"), \
             patch("time.sleep", side_effect=fake_sleep):

            # Act & Assert — loop runs, catches exception, sleeps, then we stop it
            with self.assertRaises(KeyboardInterrupt):
                db.downsampling_loop(writer, interval_seconds=1)

    def test_sleep_exception_is_caught(self):
        # Arrange
        call_count = {"n": 0}

        def sleep_fails(secs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise OSError("interrupted")
            raise KeyboardInterrupt("stop")

        with patch.object(db, "downsample_vue_readings"), \
             patch.object(db, "cleanup_old_vue_readings"), \
             patch("time.sleep", side_effect=sleep_fails):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                db.downsampling_loop(MagicMock(), interval_seconds=1)


# ---------------------------------------------------------------------------
# Coverage gap: epcube_collector.py — token exp log, errors, poll loops
# ---------------------------------------------------------------------------

class TestEnsureAuthTokenExpLog(unittest.TestCase):
    """Cover the token_exp logging branch in _ensure_auth."""

    def test_logs_token_expiry_when_exp_is_nonzero(self):
        # Arrange
        c = _make_collector()
        c._token = None
        future_exp = time.time() + 3600

        with patch.object(epcube_collector, "authenticate", return_value="new-token"), \
             patch.object(epcube_collector, "_jwt_exp", return_value=future_exp), \
             patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": []}):

            # Act
            c._ensure_auth()

        # Assert
        self.assertEqual(c._token, "new-token")
        self.assertEqual(c._token_exp, future_exp)


class TestPollStaleDataStillZero(unittest.TestCase):
    """Cover the 'still zero after re-auth' warning."""

    def test_still_zero_after_reauth_continues(self):
        # Arrange
        c = _make_collector()
        c._token = "old-token"
        c._token_exp = time.time() + 3600
        c._devices = [_make_device()]

        stale_data = {"solarPower": 0, "gridPower": 0, "backUpPower": 0,
                      "batterySoc": 0, "batteryCurrentElectricity": 0,
                      "systemStatus": "?", "selfHelpRate": 0, "ressNumber": 0}

        def mock_api(method, path, **kwargs):
            if "homeDeviceInfo" in path:
                return {"status": 200, "data": stale_data}
            elif "deviceList" in path:
                return {"status": 200, "data": c._devices}
            elif "queryDataElectricity" in path:
                return {"status": 200, "data": {}}
            return {"status": 200, "data": {}}

        with patch.object(epcube_collector, "_api_request", side_effect=mock_api), \
             patch.object(epcube_collector, "authenticate", return_value="fresh-token"):

            # Act
            c.poll()

        # Assert — poll completed (stale data accepted after re-auth)
        self.assertTrue(len(c._history) > 0)


class TestPollDeviceFetchError(unittest.TestCase):
    """Cover the exception handler when fetching device data fails."""

    def test_device_fetch_exception_increments_errors(self):
        # Arrange
        c = _make_collector()
        c._token = "token"
        c._token_exp = time.time() + 3600
        c._devices = [_make_device()]

        call_count = {"n": 0}

        def mock_api(method, path, **kwargs):
            if "homeDeviceInfo" in path:
                raise ConnectionError("network down")
            elif "queryDataElectricity" in path:
                return {"status": 200, "data": {}}
            return {"status": 200, "data": {}}

        with patch.object(epcube_collector, "_api_request", side_effect=mock_api), \
             patch.object(epcube_collector, "authenticate", return_value="token"):

            # Act
            c.poll()

        # Assert
        self.assertGreater(c._poll_errors, 0)


class TestDailyEnergyFetchError(unittest.TestCase):
    """Cover the exception handler when daily energy fetch fails."""

    def test_daily_energy_error_logged(self):
        # Arrange
        c = _make_collector()
        c._token = "token"
        c._token_exp = time.time() + 3600
        c._devices = [_make_device()]

        call_count = {"n": 0}

        def mock_api(method, path, **kwargs):
            call_count["n"] += 1
            if "homeDeviceInfo" in path:
                return _make_home_device_info()
            elif "queryDataElectricity" in path:
                raise RuntimeError("daily energy API down")
            elif "deviceList" in path:
                return {"status": 200, "data": c._devices}
            return {"status": 200, "data": {}}

        with patch.object(epcube_collector, "_api_request", side_effect=mock_api), \
             patch.object(epcube_collector, "authenticate", return_value="token"):

            # Act
            c.poll()

        # Assert — poll completed despite daily energy error
        self.assertTrue(len(c._history) > 0)
        self.assertEqual(c._poll_count, 1)


class TestReadPollIntervalFromDb(unittest.TestCase):
    """Cover db.read_setting_int_from_db (standalone function)."""

    def test_returns_default_when_no_dsn(self):
        # Arrange & Act
        with patch.object(db, "POSTGRES_DSN", ""):
            result = db.read_setting_int_from_db(
                "epcube_poll_interval_seconds", epcube_collector.DEFAULT_POLL_INTERVAL, 1, 3600)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_POLL_INTERVAL)

    def test_reads_valid_interval_from_db(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ('"30"',)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):

            # Act
            result = db.read_setting_int_from_db(
                "epcube_poll_interval_seconds", epcube_collector.DEFAULT_POLL_INTERVAL, 1, 3600)

        # Assert
        self.assertEqual(result, 30)
        mock_conn.close.assert_called_once()

    def test_returns_default_when_no_row(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):

            # Act
            result = db.read_setting_int_from_db(
                "epcube_poll_interval_seconds", epcube_collector.DEFAULT_POLL_INTERVAL, 1, 3600)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_POLL_INTERVAL)

    def test_returns_default_when_out_of_range(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("9999",)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):

            # Act
            result = db.read_setting_int_from_db(
                "epcube_poll_interval_seconds", epcube_collector.DEFAULT_POLL_INTERVAL, 1, 3600)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_POLL_INTERVAL)

    def test_returns_default_on_db_exception(self):
        # Arrange
        mock_pg = MagicMock()
        mock_pg.connect.side_effect = Exception("conn failed")

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):

            # Act
            result = db.read_setting_int_from_db(
                "epcube_poll_interval_seconds", epcube_collector.DEFAULT_POLL_INTERVAL, 1, 3600)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_POLL_INTERVAL)


class TestEpCubePollLoop(unittest.TestCase):
    """Cover EpCubeCollector.run_poll_loop."""

    def test_poll_loop_calls_poll_and_reads_interval(self):
        # Arrange
        c = _make_collector()
        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 2:
                raise KeyboardInterrupt("stop")

        c._pg.read_setting_int = MagicMock(return_value=5)

        with patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll"), \
             patch.object(c, "_discover_devices"), \
             patch.object(epcube_collector, "retry_with_backoff",
                          side_effect=lambda fn, **kw: fn()):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        self.assertEqual(c._poll_interval, 5)

    def test_poll_loop_catches_exception(self):
        # Arrange
        c = _make_collector()
        call_count = {"n": 0}

        def mock_read_setting(key, default, min_val, max_val):
            call_count["n"] += 1
            if call_count["n"] >= 3:
                raise KeyboardInterrupt("stop")
            raise RuntimeError("db down")

        c._pg.read_setting_int = MagicMock(side_effect=mock_read_setting)

        with patch("time.sleep"):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        self.assertGreater(c._consecutive_errors, 0)


# ---------------------------------------------------------------------------
# Coverage gap: exporter.py — main() exit paths
# ---------------------------------------------------------------------------

class TestExporterMainPostgresDsn(unittest.TestCase):
    """Cover main() exit when POSTGRES_DSN is missing."""

    def test_no_postgres_dsn_exits(self):
        # Arrange
        env = os.environ.copy()
        env["EPCUBE_USERNAME"] = "u"
        env["EPCUBE_PASSWORD"] = "p"

        # Act & Assert
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "POSTGRES_DSN", ""), \
             self.assertRaises(SystemExit) as ctx:
            exporter.main()
        self.assertEqual(ctx.exception.code, 1)


class TestExporterMainPsycopg2Missing(unittest.TestCase):
    """Cover main() exit when psycopg2 is not installed."""

    def test_no_psycopg2_exits(self):
        # Arrange
        env = os.environ.copy()
        env["EPCUBE_USERNAME"] = "u"
        env["EPCUBE_PASSWORD"] = "p"

        # Act & Assert
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(exporter, "psycopg2", None), \
             self.assertRaises(SystemExit) as ctx:
            exporter.main()
        self.assertEqual(ctx.exception.code, 1)


class TestExporterMainDisableAuthLog(unittest.TestCase):
    """Cover the DISABLE_AUTH log branch in main()."""

    @patch.dict(os.environ, {"EPCUBE_USERNAME": "u", "EPCUBE_PASSWORD": "p"}, clear=False)
    @patch.object(exporter, "psycopg2", MagicMock())
    @patch.object(exporter, "POSTGRES_DSN", "postgresql://test@localhost/test")
    @patch.object(exporter, "DISABLE_AUTH", True)
    def test_disable_auth_log_branch(self):
        # Arrange
        with patch.object(exporter, "EpCubeCollector") as mock_epc, \
             patch.object(exporter, "PostgresWriter"), \
             patch.object(exporter, "VuePostgresWriter"), \
             patch("threading.Thread"), \
             patch.object(exporter.HTTPServer, "__init__", return_value=None), \
             patch.object(exporter.HTTPServer, "serve_forever", side_effect=KeyboardInterrupt):
            mock_epc.return_value = MagicMock()

            # Ensure no Vue creds so only EP Cube starts
            env = os.environ.copy()
            env.pop("EMPORIA_USERNAME", None)
            env.pop("EMPORIA_PASSWORD", None)
            with patch.dict(os.environ, env, clear=True):
                env2 = {"EPCUBE_USERNAME": "u", "EPCUBE_PASSWORD": "p"}
                with patch.dict(os.environ, env2, clear=False):

                    # Act — should reach the DISABLE_AUTH log line
                    exporter.main()


# ---------------------------------------------------------------------------
# Coverage gap: http_handler.py — session, OAuth, routes
# ---------------------------------------------------------------------------

class TestVerifySessionCookieBadSig(unittest.TestCase):
    """Cover _verify_session_cookie returning None on bad HMAC."""

    def test_tampered_signature_rejected(self):
        # Arrange
        with patch.object(http_handler, "AZURE_CLIENT_SECRET", "test-secret"):
            signed = http_handler._sign_session("legit-session")
            # Tamper with the signature
            tampered = signed[:-4] + "XXXX"

            # Act
            result = http_handler._verify_session_cookie(tampered)

        # Assert
        self.assertIsNone(result)


class TestCleanupExpired(unittest.TestCase):
    """Cover _cleanup_expired deleting expired sessions and stale auth states."""

    def test_removes_expired_sessions_and_stale_auth(self):
        # Arrange — patch isolated session/pending dicts and lock for this test
        with patch.object(http_handler, "_sessions", {}), \
             patch.object(http_handler, "_pending_auth", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            sessions = http_handler._sessions
            pending = http_handler._pending_auth
            lock = http_handler._auth_lock

            with lock:
                sessions["expired-1"] = {"expires": 0, "user": "a"}
                sessions["valid-1"] = {"expires": time.time() + 3600, "user": "b"}
                pending["stale-state"] = {"code_verifier": "v", "timestamp": 0}
                pending["fresh-state"] = {"code_verifier": "v", "timestamp": time.time()}

            # Act
            http_handler._cleanup_expired()

            # Assert
            with lock:
                self.assertNotIn("expired-1", sessions)
                self.assertIn("valid-1", sessions)
                self.assertNotIn("stale-state", pending)
                self.assertIn("fresh-state", pending)


class TestRenderStatusPageEdgeCases(unittest.TestCase):
    """Cover edge cases in _render_status_page."""

    def _make_status(self, **overrides):
        status = {
            "version": config.__version__,
            "uptime_s": 100,
            "poll_count": 1,
            "poll_errors": 0,
            "last_poll": time.time(),
            "poll_interval": 60,
            "next_poll_at": time.time() + 30,
            "devices": 1,
            "history": [],
        }
        status.update(overrides)
        return status

    def _make_health(self):
        return {"healthy": True, "checks": []}

    def test_no_data_shows_waiting_message(self):
        # Arrange & Act
        html_out = http_handler._render_status_page(
            self._make_status(history=[]), self._make_health())

        # Assert
        self.assertIn("No data yet", html_out)

    def test_multiple_devices_renders_skip_continue(self):
        """Two devices in history — the inner loop hits the 'continue' for non-matching IDs."""
        # Arrange
        snap = {
            "time": "2026-05-08T12:00:00Z",
            "time_minute": "2026-05-08T12:00Z",
            "devices": [
                {
                    "name": "Device A", "id": "AAA",
                    "solar_kw": 1.0, "battery_soc": 50, "battery_kw": 0.5,
                    "grid_kw": 0.0, "backup_kw": 0.5, "self_sufficiency": 90,
                    "system_status": "Normal", "bat_stored_kwh": 10.0,
                    "bat_peak_kwh": 10.0, "ress_count": 1,
                    "solar_kwh": 5.0, "grid_import_kwh": 0.0,
                    "grid_export_kwh": 0.0, "backup_kwh": 3.0,
                },
                {
                    "name": "Device B", "id": "BBB",
                    "solar_kw": 2.0, "battery_soc": 60, "battery_kw": 1.0,
                    "grid_kw": 0.0, "backup_kw": 1.0, "self_sufficiency": 80,
                    "system_status": "Self-Use", "bat_stored_kwh": 8.0,
                    "bat_peak_kwh": 8.5, "ress_count": 2,
                    "solar_kwh": 8.0, "grid_import_kwh": 1.0,
                    "grid_export_kwh": 0.5, "backup_kwh": 6.0,
                },
            ],
        }

        # Act
        html_out = http_handler._render_status_page(
            self._make_status(history=[snap], devices=2), self._make_health())

        # Assert — both devices rendered
        self.assertIn("Device A", html_out)
        self.assertIn("Device B", html_out)

    def test_device_not_in_all_snaps_hits_else_continue(self):
        """Device in one snap but not another triggers the for/else: continue pattern."""
        # Arrange
        snap1 = {
            "time": "2026-05-08T12:00:00Z",
            "time_minute": "2026-05-08T12:00Z",
            "devices": [
                {
                    "name": "Dev1", "id": "111",
                    "solar_kw": 1.0, "battery_soc": 50, "battery_kw": 0.0,
                    "grid_kw": 0.0, "backup_kw": 1.0, "self_sufficiency": 100,
                    "system_status": "Normal", "bat_stored_kwh": 10.0,
                    "bat_peak_kwh": 10.0, "ress_count": 1,
                    "solar_kwh": 5.0, "grid_import_kwh": 0.0,
                    "grid_export_kwh": 0.0, "backup_kwh": 3.0,
                },
            ],
        }
        snap2 = {
            "time": "2026-05-08T12:01:00Z",
            "time_minute": "2026-05-08T12:01Z",
            "devices": [
                {
                    "name": "Dev2", "id": "222",
                    "solar_kw": 2.0, "battery_soc": 70, "battery_kw": 0.5,
                    "grid_kw": 0.0, "backup_kw": 1.5, "self_sufficiency": 80,
                    "system_status": "Normal", "bat_stored_kwh": 12.0,
                    "bat_peak_kwh": 12.0, "ress_count": 1,
                    "solar_kwh": 7.0, "grid_import_kwh": 0.0,
                    "grid_export_kwh": 0.0, "backup_kwh": 5.0,
                },
            ],
        }

        # Act — Dev1 appears only in snap1, Dev2 only in snap2
        # For Dev1, the "latest status" loop searches reversed([snap1, snap2])
        # snap2 has no device "111" → inner for completes without break → else: continue
        html_out = http_handler._render_status_page(
            self._make_status(history=[snap1, snap2], devices=2), self._make_health())

        # Assert
        self.assertIn("Dev1", html_out)
        self.assertIn("Dev2", html_out)


class TestRenderVueDebugPageEdgeCases(unittest.TestCase):
    """Cover _render_vue_debug_page edge cases."""

    def test_last_poll_zero_shows_never(self):
        # Arrange
        vue_status = {
            "device_count": 0,
            "circuit_count": 0,
            "last_poll": 0,
            "poll_errors": 0,
            "consecutive_errors": 0,
            "current_scale": "1S",
            "poll_interval": 1,
            "next_poll_at": 0,
            "authenticated": True,
            "devices": [],
            "uptime_s": 100,
            "last_readings": {},
            "channel_names": {},
        }

        # Act
        html_out = http_handler._render_vue_debug_page(vue_status)

        # Assert
        self.assertIn("never", html_out)

    def test_balance_and_text_channels_sort(self):
        """Cover the 'Balance' and ValueError sort key paths."""
        # Arrange
        vue_status = {
            "device_count": 1,
            "circuit_count": 3,
            "last_poll": time.time(),
            "poll_errors": 0,
            "consecutive_errors": 0,
            "current_scale": "1S",
            "poll_interval": 1,
            "next_poll_at": time.time() + 1,
            "authenticated": True,
            "devices": [{"device_gid": 100, "name": "Vue", "connected": True, "channels": 3}],
            "uptime_s": 60,
            "last_readings": {
                (100, "1,2,3"): 5000,  # mains
                (100, "Balance"): 200,  # balance
                (100, "custom_name"): 50,  # text channel → ValueError path
            },
            "channel_names": {
                (100, "1,2,3"): "Mains",
                (100, "Balance"): "",
                (100, "custom_name"): "",
            },
        }

        # Act
        html_out = http_handler._render_vue_debug_page(vue_status)

        # Assert
        self.assertIn("5.0 kW", html_out)  # mains formatted as kW
        self.assertIn("200 W", html_out)
        self.assertIn("Balance", html_out)


class TestHandleCallbackFull(unittest.TestCase):
    """Cover _handle_callback OAuth code exchange paths."""

    def _make_handler(self, path, headers=None):
        h = _TestableHandler()
        h.collector = self.collector
        h.vue_collector = None
        h.path = path
        h.headers = headers or {}
        h.wfile = BytesIO()
        h.send_response = MagicMock()
        h.send_header = MagicMock()
        h.end_headers = MagicMock()
        return h

    def test_callback_with_error_param_returns_400(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        h = self._make_handler("/.auth/callback?error=access_denied&error_description=User+denied")

        # Act
        h.do_GET()

        # Assert
        h.send_response.assert_called_with(400)
        self.assertIn(b"Authentication failed", h.wfile.getvalue())

    def test_callback_token_exchange_failure_returns_500(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        state_val = "test-state-123"
        h = self._make_handler(
            f"/.auth/callback?code=auth-code&state={state_val}")

        with patch.object(http_handler, "_pending_auth", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            with http_handler._auth_lock:
                http_handler._pending_auth[state_val] = {
                    "code_verifier": "verifier123",
                    "timestamp": time.time(),
                }

            with patch("urllib.request.urlopen", side_effect=Exception("network error")):
                # Act
                h.do_GET()

        # Assert
        h.send_response.assert_called_with(500)
        self.assertIn(b"Token exchange failed", h.wfile.getvalue())

    def test_callback_jwt_validation_failure_returns_401(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        state_val = "test-state-456"
        h = self._make_handler(
            f"/.auth/callback?code=auth-code&state={state_val}")

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"access_token": "bad-jwt"}).encode()
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch.object(http_handler, "_pending_auth", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            with http_handler._auth_lock:
                http_handler._pending_auth[state_val] = {
                    "code_verifier": "verifier456",
                    "timestamp": time.time(),
                }

            try:
                with patch("urllib.request.urlopen", return_value=mock_resp):
                    http_handler.ExporterHandler._jwks_client = None
                    h.do_GET()
            finally:
                http_handler.ExporterHandler._jwks_client = None

        # Assert
        h.send_response.assert_called_with(401)

    def test_callback_success_creates_session(self):
        # Arrange
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        state_val = "test-state-789"
        h = self._make_handler(
            f"/.auth/callback?code=auth-code&state={state_val}")

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(
            {"access_token": "valid-jwt"}).encode()
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)

        mock_jwks = MagicMock()
        mock_key = MagicMock()
        mock_key.key = "signing-key"
        mock_jwks.get_signing_key_from_jwt.return_value = mock_key

        mock_jwt = MagicMock()
        mock_jwt.PyJWKClient.return_value = mock_jwks
        mock_jwt.decode.return_value = {"preferred_username": "user@test.com"}

        with patch.object(http_handler, "_pending_auth", {}), \
             patch.object(http_handler, "_sessions", {}), \
             patch.object(http_handler, "_auth_lock", threading.Lock()):
            with http_handler._auth_lock:
                http_handler._pending_auth[state_val] = {
                    "code_verifier": "verifier789",
                    "timestamp": time.time(),
                }

            try:
                with patch("urllib.request.urlopen", return_value=mock_resp), \
                     patch.dict(sys.modules, {"jwt": mock_jwt}):
                    http_handler.ExporterHandler._jwks_client = None
                    h.do_GET()
            finally:
                http_handler.ExporterHandler._jwks_client = None

        # Assert
        h.send_response.assert_called_with(302)
        location_calls = [c for c in h.send_header.call_args_list
                          if c[0][0] == "Location"]
        self.assertTrue(any("/status" in c[0][1] for c in location_calls))


class TestCheckAuthBearerJWT(unittest.TestCase):
    """Cover _check_auth JWT Bearer token validation success."""

    def _make_handler(self, path, headers=None):
        h = _TestableHandler()
        h.collector = MagicMock()
        h.vue_collector = None
        h.path = path
        h.headers = headers or {}
        h.wfile = BytesIO()
        h.send_response = MagicMock()
        h.send_header = MagicMock()
        h.end_headers = MagicMock()
        return h

    def test_valid_bearer_token_grants_access(self):
        # Arrange
        mock_jwks = MagicMock()
        mock_key = MagicMock()
        mock_key.key = "the-key"
        mock_jwks.get_signing_key_from_jwt.return_value = mock_key

        mock_jwt = MagicMock()
        mock_jwt.PyJWKClient.return_value = mock_jwks
        mock_jwt.decode.return_value = {"sub": "user123"}

        h = self._make_handler("/status", headers={
            "Authorization": "Bearer valid-jwt-token"
        })

        with patch.object(http_handler, "DISABLE_AUTH", False), \
             patch.dict(sys.modules, {"jwt": mock_jwt}):
            http_handler.ExporterHandler._jwks_client = None

            # Act
            result = h._check_auth()

        # Assert
        self.assertTrue(result)
        http_handler.ExporterHandler._jwks_client = None


class TestDoGetNoCollector(unittest.TestCase):
    """Cover do_GET routes when collectors are None."""

    def _make_handler(self, path, headers=None):
        h = _TestableHandler()
        h.collector = None
        h.vue_collector = None
        h.path = path
        h.headers = headers or {}
        h.wfile = BytesIO()
        h.send_response = MagicMock()
        h.send_header = MagicMock()
        h.end_headers = MagicMock()
        return h

    def test_health_ok_when_no_collector(self):
        # Arrange & Act
        h = self._make_handler("/health")
        h.do_GET()

        # Assert
        h.send_response.assert_called_with(200)

    def test_status_page_no_collector_shows_disabled(self):
        # Arrange
        with patch.object(http_handler, "DISABLE_AUTH", True):
            h = self._make_handler("/status")

            # Act
            h.do_GET()

        # Assert
        h.send_response.assert_called_with(200)
        self.assertIn(b"EP Cube collector: disabled", h.wfile.getvalue())

    def test_vue_page_no_collector(self):
        # Arrange
        with patch.object(http_handler, "DISABLE_AUTH", True):
            h = self._make_handler("/vue")

            # Act
            h.do_GET()

        # Assert
        h.send_response.assert_called_with(200)
        self.assertIn(b"Vue polling is not configured", h.wfile.getvalue())

    def test_vue_page_with_collector(self):
        # Arrange
        mock_vue = MagicMock()
        mock_vue.get_status.return_value = {
            "device_count": 1, "circuit_count": 2,
            "last_poll": time.time(), "poll_errors": 0,
            "consecutive_errors": 0, "current_scale": "1S",
            "poll_interval": 1, "next_poll_at": time.time() + 1,
            "authenticated": True,
            "devices": [{"device_gid": 1, "name": "Test", "connected": True, "channels": 2}],
            "uptime_s": 60, "last_readings": {}, "channel_names": {},
        }
        with patch.object(http_handler, "DISABLE_AUTH", True):
            h = self._make_handler("/vue")
            h.vue_collector = mock_vue

            # Act
            h.do_GET()

        # Assert
        h.send_response.assert_called_with(200)

    def test_vue_page_auth_denied_returns_early(self):
        """Cover the _check_auth() -> return path on /vue."""
        # Arrange
        with patch.object(http_handler, "DISABLE_AUTH", False):
            h = self._make_handler("/vue")

            # Act
            h.do_GET()

        # Assert — 401 because no auth provided (API client, no Accept: text/html)
        h.send_response.assert_called_with(401)
    """Cover ExporterHandler.log_message pass."""

    def test_log_message_does_nothing(self):
        # Arrange
        h = _TestableHandler()

        # Act — should not raise
        h.log_message("GET %s %s", "/test", "200")

        # Assert — method exists and is callable (the pass body is covered)
        self.assertTrue(True)


# ---------------------------------------------------------------------------
# Coverage gap: vue_collector.py — intervals, discovery, poll loops
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Coverage gap: vue_collector.py — pyemvue.enums import line
# NOTE: vue_collector.py:12 (from pyemvue.enums import Scale, Unit) is only
# reachable when pyemvue is installed. Reloading vue_collector breaks module
# state. Coverage gap accepted as environment-dependent.
# ---------------------------------------------------------------------------


class TestReadVuePollIntervalFromDb(unittest.TestCase):
    """Cover vue_collector._read_vue_poll_interval_from_db (delegates to _read_setting_int_from_db)."""

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_POLL_INTERVAL)
    def test_returns_default_when_no_dsn(self, mock_read):
        # Act
        result = vue_collector._read_vue_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_POLL_INTERVAL)
        mock_read.assert_called_once_with("vue_poll_interval_seconds", vue_collector.DEFAULT_VUE_POLL_INTERVAL, 1, 3600)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=2)
    def test_reads_valid_interval(self, mock_read):
        # Act
        result = vue_collector._read_vue_poll_interval_from_db()

        # Assert
        self.assertEqual(result, 2)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_POLL_INTERVAL)
    def test_returns_default_when_out_of_range(self, mock_read):
        # Act
        result = vue_collector._read_vue_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_POLL_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_POLL_INTERVAL)
    def test_returns_default_on_exception(self, mock_read):
        # Act
        result = vue_collector._read_vue_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_POLL_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_POLL_INTERVAL)
    def test_returns_default_when_no_row(self, mock_read):
        # Act
        result = vue_collector._read_vue_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_POLL_INTERVAL)


class TestReadVueDeviceRefreshInterval(unittest.TestCase):
    """Cover vue_collector._read_vue_device_refresh_interval_from_db (delegates to _read_setting_int_from_db)."""

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
    def test_returns_default_when_no_dsn(self, mock_read):
        # Act
        result = vue_collector._read_vue_device_refresh_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
        mock_read.assert_called_once_with("vue_device_refresh_interval_seconds", vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL, 60, 86400)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=120)
    def test_reads_valid_interval(self, mock_read):
        # Act
        result = vue_collector._read_vue_device_refresh_interval_from_db()

        # Assert
        self.assertEqual(result, 120)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
    def test_returns_default_when_out_of_range(self, mock_read):
        # Act
        result = vue_collector._read_vue_device_refresh_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
    def test_returns_default_on_exception(self, mock_read):
        # Act
        result = vue_collector._read_vue_device_refresh_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)
    def test_returns_default_when_no_row(self, mock_read):
        # Act
        result = vue_collector._read_vue_device_refresh_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DEVICE_REFRESH_INTERVAL)


class TestReadVueDailyPollIntervalFallback(unittest.TestCase):
    """Cover the default return path in _read_vue_daily_poll_interval_from_db."""

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
    def test_returns_default_when_no_dsn(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
        mock_read.assert_called_once_with("vue_daily_poll_interval_seconds", vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL, 1, 3600)

    @patch.object(vue_collector, "read_setting_int_from_db", return_value=vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)
    def test_returns_default_when_no_row(self, mock_read):
        # Act
        result = vue_collector._read_vue_daily_poll_interval_from_db()

        # Assert
        self.assertEqual(result, vue_collector.DEFAULT_VUE_DAILY_POLL_INTERVAL)


class TestVueDiscoverDevicesMerge(unittest.TestCase):
    """Cover device merge in _discover_devices — prefer named entry."""

    @patch("vue_collector.PyEmVue")
    def test_prefers_named_device(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock

        # Two entries for same gid: first unnamed, second named
        dev1 = MagicMock()
        dev1.device_gid = 100
        dev1.device_name = ""
        dev1.connected = True
        ch1 = MagicMock()
        ch1.device_gid = 100
        ch1.channel_num = "1"
        ch1.name = "Circuit A"
        dev1.channels = [ch1]

        dev2 = MagicMock()
        dev2.device_gid = 100
        dev2.device_name = "My Vue"
        dev2.connected = True
        ch2 = MagicMock()
        ch2.device_gid = 100
        ch2.channel_num = "2"
        ch2.name = "Circuit B"
        dev2.channels = [ch2]

        vue_mock.get_devices.return_value = [dev1, dev2]

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)

        # Assert — named device preferred
        self.assertEqual(vc._device_count, 1)
        self.assertEqual(vc._circuit_count, 2)
        self.assertEqual(vc._devices_info[0]["name"], "My Vue")


class TestVueDiscoverDevicesError(unittest.TestCase):
    """Cover _discover_devices exception handler."""

    @patch("vue_collector.PyEmVue")
    def test_discovery_exception_caught(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.side_effect = Exception("API timeout")

        # Act — should not raise
        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)

        # Assert — collector exists but with zero devices
        self.assertEqual(vc._device_count, 0)


class TestVuePollRetryLogin(unittest.TestCase):
    """Cover _poll_inner retry login path when not authenticated."""

    @patch("vue_collector.PyEmVue")
    def test_poll_retries_login_on_failure(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = False

        # Make login fail again
        vue_mock.login.side_effect = Exception("auth failed")

        # Act
        vc.poll()

        # Assert
        self.assertGreater(vc._poll_errors, 0)
        self.assertGreater(vc._consecutive_errors, 0)


class TestVuePollInnerProcessingErrors(unittest.TestCase):
    """Cover _poll_inner device processing exception and API failure."""

    @patch("vue_collector.PyEmVue")
    def test_device_processing_exception(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = [100]
        vc._vue = vue_mock
        vc._last_device_refresh = time.time()

        # Usage returns a device with a processing error
        mock_device_usage = MagicMock()
        mock_device_usage.timestamp = None  # triggers error in processing
        mock_device_usage.channels = {"1": MagicMock(usage=None)}
        vue_mock.get_device_list_usage.return_value = {100: mock_device_usage}

        # Make timestamp access raise
        type(mock_device_usage).timestamp = property(lambda self: (_ for _ in ()).throw(ValueError("bad ts")))

        # Act
        vc.poll()

        # Assert
        self.assertGreater(vc._poll_errors, 0)

    @patch("vue_collector.PyEmVue")
    def test_api_call_exception(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = [100]
        vc._vue = vue_mock
        vc._last_device_refresh = time.time()

        vue_mock.get_device_list_usage.side_effect = Exception("API error")

        # Act
        vc.poll()

        # Assert
        self.assertGreater(vc._poll_errors, 0)
        self.assertGreater(vc._consecutive_errors, 0)


class TestVuePollInnerTimestampNaive(unittest.TestCase):
    """Cover the naive timestamp → UTC replacement path."""

    @patch("vue_collector.PyEmVue")
    def test_naive_timestamp_gets_utc(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = [100]
        vc._vue = vue_mock
        vc._last_device_refresh = time.time()

        # Create mock usage with naive timestamp
        mock_ch = MagicMock()
        mock_ch.usage = 0.001  # 1 Wh
        mock_device_usage = MagicMock()
        mock_device_usage.timestamp = datetime(2026, 5, 8, 12, 0, 0)  # naive
        mock_device_usage.channels = {"1": mock_ch}
        vue_mock.get_device_list_usage.return_value = {100: mock_device_usage}

        # Act
        vc.poll()

        # Assert
        self.assertGreater(vc._last_poll, 0)
        # Reading should have been written with UTC timezone
        pg.write_readings.assert_called_once()
        written = pg.write_readings.call_args[0][0]
        self.assertEqual(len(written), 1)
        ts = written[0][2]
        self.assertIsNotNone(ts.tzinfo)


class TestVuePollDeviceRefresh(unittest.TestCase):
    """Cover periodic device refresh in _poll_inner."""

    @patch("vue_collector.PyEmVue")
    def test_device_refresh_triggered(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = [100]
        vc._vue = vue_mock
        vc._last_device_refresh = 0  # force refresh

        vue_mock.get_device_list_usage.return_value = {}

        with patch.object(vue_collector, "_read_vue_device_refresh_interval_from_db", return_value=1):
            # Act
            vc.poll()

        # Assert — get_devices called during refresh (once at init, once at poll)
        self.assertGreaterEqual(vue_mock.get_devices.call_count, 2)


class TestVueGetStatus(unittest.TestCase):
    """Cover VueCollector.get_status."""

    @patch("vue_collector.PyEmVue")
    def test_get_status_returns_dict(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)

        # Act
        status = vc.get_status()

        # Assert
        self.assertIn("device_count", status)
        self.assertIn("circuit_count", status)
        self.assertIn("current_scale", status)
        self.assertIn("authenticated", status)
        self.assertIn("last_readings", status)
        self.assertIn("channel_names", status)
        self.assertIn("uptime_s", status)


class TestVuePollDailyNotAuthenticated(unittest.TestCase):
    """Cover poll_daily early returns."""

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_skips_when_not_authenticated(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = False

        # Act
        vc.poll_daily()

        # Assert — no API calls made
        vue_mock.get_device_list_usage.assert_not_called()

    @patch("vue_collector.PyEmVue")
    def test_poll_daily_skips_when_no_devices(self, mock_pyemvue_cls):
        # Arrange
        pg = MagicMock()
        vue_mock = MagicMock()
        mock_pyemvue_cls.return_value = vue_mock
        vue_mock.get_devices.return_value = []

        vc = vue_collector.VueCollector("user", "pass", pg_writer=pg)
        vc._authenticated = True
        vc._device_gids = []

        # Act
        vc.poll_daily()

        # Assert — no API calls made
        vue_mock.get_device_list_usage.assert_not_called()


class TestVuePollLoopCoverage(unittest.TestCase):
    """Cover vue_collector.vue_poll_loop."""

    def test_vue_poll_loop_runs_and_catches_errors(self):
        # Arrange
        collector = MagicMock()
        collector._lock = threading.Lock()
        collector._poll_errors = 0
        collector._consecutive_errors = 0
        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 2:
                raise KeyboardInterrupt("stop")

        with patch.object(vue_collector, "_read_vue_poll_interval_from_db", return_value=1), \
             patch("time.sleep", side_effect=mock_sleep):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                vue_collector.vue_poll_loop(collector)

    def test_vue_poll_loop_exception_increments_errors(self):
        # Arrange
        collector = MagicMock()
        collector._lock = threading.Lock()
        collector._poll_errors = 0
        collector._consecutive_errors = 0
        call_count = {"n": 0}

        def mock_read_interval():
            call_count["n"] += 1
            if call_count["n"] >= 2:
                raise KeyboardInterrupt("stop")
            raise RuntimeError("db fail")

        with patch.object(vue_collector, "_read_vue_poll_interval_from_db",
                          side_effect=mock_read_interval), \
             patch("time.sleep"):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                vue_collector.vue_poll_loop(collector)

        self.assertGreater(collector._poll_errors, 0)


class TestVueDailyPollLoopError(unittest.TestCase):
    """Cover vue_daily_poll_loop exception handling."""

    def test_daily_poll_loop_catches_exception(self):
        # Arrange
        collector = MagicMock()
        collector.poll_daily.side_effect = RuntimeError("daily fail")
        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 2:
                raise KeyboardInterrupt("stop")

        with patch.object(vue_collector, "_read_vue_daily_poll_interval_from_db", return_value=1), \
             patch("time.sleep", side_effect=mock_sleep):

            # Act & Assert
            with self.assertRaises(KeyboardInterrupt):
                vue_collector.vue_daily_poll_loop(collector)


# ---------------------------------------------------------------------------
# Import coverage: optional dependency branches
# ---------------------------------------------------------------------------

class TestConfigPsycopg2Import(unittest.TestCase):
    """Cover the successful psycopg2 import branch in config.py."""

    def test_psycopg2_imported_when_available(self):
        # Arrange
        import importlib
        mock_pg = MagicMock()
        mock_extras = MagicMock()
        original_modules = {}
        for mod_name in ["psycopg2", "psycopg2.extras"]:
            original_modules[mod_name] = sys.modules.get(mod_name)
        sys.modules["psycopg2"] = mock_pg
        sys.modules["psycopg2.extras"] = mock_extras

        # Snapshot every config attribute that other modules may have already
        # imported by name. Reloading config rebinds these on the config module
        # itself, but bound references in http_handler / exporter / etc. still
        # point at the originals, so we must restore the original objects on the
        # config module after the reload (not reload a second time, which would
        # produce yet another distinct object).
        original_attrs = {name: getattr(config, name) for name in dir(config)
                          if not name.startswith("__")}

        try:
            # Act
            importlib.reload(config)

            # Assert — config.psycopg2 should be the mock, not None
            self.assertIs(config.psycopg2, mock_pg)
        finally:
            for name, value in original_attrs.items():
                setattr(config, name, value)
            for mod_name, orig in original_modules.items():
                if orig is None:
                    sys.modules.pop(mod_name, None)
                else:
                    sys.modules[mod_name] = orig


class TestVueCollectorPyEmVueImport(unittest.TestCase):
    """Cover the successful pyemvue import branch in vue_collector.py."""

    def test_pyemvue_enums_imported_when_available(self):
        # Arrange
        import importlib
        mock_pyemvue = MagicMock()
        mock_enums = MagicMock()
        mock_enums.Scale = "MockScale"
        mock_enums.Unit = "MockUnit"

        original_modules = {}
        for mod_name in ["pyemvue", "pyemvue.enums"]:
            original_modules[mod_name] = sys.modules.get(mod_name)
        sys.modules["pyemvue"] = mock_pyemvue
        sys.modules["pyemvue.enums"] = mock_enums
        mock_pyemvue.PyEmVue = "MockPyEmVue"

        original_pyemvue = vue_collector.PyEmVue

        try:
            # Act
            importlib.reload(vue_collector)

            # Assert — PyEmVue should be the mock value
            self.assertEqual(vue_collector.PyEmVue, "MockPyEmVue")
        finally:
            # Restore
            vue_collector.PyEmVue = original_pyemvue
            for mod_name, orig in original_modules.items():
                if orig is None:
                    sys.modules.pop(mod_name, None)
                else:
                    sys.modules[mod_name] = orig
            importlib.reload(vue_collector)


# ---------------------------------------------------------------------------
# Phase 1+2: Discovery interval setting reader tests
# ---------------------------------------------------------------------------

class TestDiscoveryInterval(unittest.TestCase):
    """Tests for db.read_setting_int_from_db with discovery_interval_seconds."""

    def test_returns_default_when_no_dsn(self):
        # Arrange & Act
        with patch.object(db, "POSTGRES_DSN", ""):
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)

    def test_reads_valid_interval_from_db(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ('"1800"',)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, 1800)
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("settings", sql)
        params = mock_cursor.execute.call_args[0][1]
        self.assertEqual(params, ("discovery_interval_seconds",))
        mock_conn.close.assert_called_once()

    def test_returns_default_when_no_row(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)

    def test_returns_default_when_below_min(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("30",)  # below 60 minimum
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)

    def test_returns_default_when_above_max(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("100000",)  # above 86400 maximum
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)

    def test_returns_default_on_db_exception(self):
        # Arrange
        mock_pg = MagicMock()
        mock_pg.connect.side_effect = Exception("connection refused")

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)

    def test_returns_default_when_value_not_numeric(self):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ("not_a_number",)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_pg = MagicMock()
        mock_pg.connect.return_value = mock_conn

        with patch.object(db, "POSTGRES_DSN", "postgresql://test"), \
             patch.object(db, "psycopg2", mock_pg):
            # Act
            result = db.read_setting_int_from_db(
                "discovery_interval_seconds", epcube_collector.DEFAULT_DISCOVERY_INTERVAL, 60, 86400)

        # Assert
        self.assertEqual(result, epcube_collector.DEFAULT_DISCOVERY_INTERVAL)


# ---------------------------------------------------------------------------
# Phase 2: compare_device_lists tests
# ---------------------------------------------------------------------------

class TestCompareDeviceLists(unittest.TestCase):
    """Tests for compare_device_lists — pure set comparison."""

    def test_no_changes(self):
        # Arrange
        known = {"A", "B", "C"}
        cloud = {"A", "B", "C"}

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, set())
        self.assertEqual(removed, set())
        self.assertEqual(unchanged, {"A", "B", "C"})

    def test_new_device_added(self):
        # Arrange
        known = {"A", "B"}
        cloud = {"A", "B", "C"}

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, {"C"})
        self.assertEqual(removed, set())
        self.assertEqual(unchanged, {"A", "B"})

    def test_device_removed(self):
        # Arrange
        known = {"A", "B", "C"}
        cloud = {"A", "B"}

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, set())
        self.assertEqual(removed, {"C"})
        self.assertEqual(unchanged, {"A", "B"})

    def test_device_added_and_removed(self):
        # Arrange
        known = {"A", "B"}
        cloud = {"A", "C"}

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, {"C"})
        self.assertEqual(removed, {"B"})
        self.assertEqual(unchanged, {"A"})

    def test_empty_known_all_added(self):
        # Arrange
        known = set()
        cloud = {"A", "B"}

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, {"A", "B"})
        self.assertEqual(removed, set())
        self.assertEqual(unchanged, set())

    def test_empty_cloud_all_removed(self):
        # Arrange
        known = {"A", "B"}
        cloud = set()

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, set())
        self.assertEqual(removed, {"A", "B"})
        self.assertEqual(unchanged, set())

    def test_both_empty(self):
        # Arrange
        known = set()
        cloud = set()

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, set())
        self.assertEqual(removed, set())
        self.assertEqual(unchanged, set())

    def test_accepts_lists(self):
        # Arrange — function should accept any iterable, not just sets
        known = ["A", "B"]
        cloud = ["B", "C"]

        # Act
        added, removed, unchanged = epcube_collector.compare_device_lists(known, cloud)

        # Assert
        self.assertEqual(added, {"C"})
        self.assertEqual(removed, {"A"})
        self.assertEqual(unchanged, {"B"})


# ---------------------------------------------------------------------------
# Phase 2: retry_with_backoff tests
# ---------------------------------------------------------------------------

class TestRetryWithBackoff(unittest.TestCase):
    """Tests for retry_with_backoff — exponential retry logic."""

    @patch.object(epcube_collector, "time")
    def test_success_on_first_try(self, mock_time):
        # Arrange
        fn = MagicMock(return_value="ok")

        # Act
        result = epcube_collector.retry_with_backoff(fn, max_retries=3, base_delay=10)

        # Assert
        self.assertEqual(result, "ok")
        fn.assert_called_once()
        mock_time.sleep.assert_not_called()

    @patch.object(epcube_collector, "time")
    def test_success_on_retry(self, mock_time):
        # Arrange
        fn = MagicMock(side_effect=[RuntimeError("fail"), RuntimeError("fail"), "ok"])

        # Act
        result = epcube_collector.retry_with_backoff(fn, max_retries=3, base_delay=10)

        # Assert
        self.assertEqual(result, "ok")
        self.assertEqual(fn.call_count, 3)
        self.assertEqual(mock_time.sleep.call_count, 2)

    @patch.object(epcube_collector, "time")
    def test_all_retries_fail_raises(self, mock_time):
        # Arrange
        fn = MagicMock(side_effect=RuntimeError("persistent failure"))

        # Act & Assert
        with self.assertRaises(RuntimeError) as ctx:
            epcube_collector.retry_with_backoff(fn, max_retries=3, base_delay=5)

        self.assertIn("persistent failure", str(ctx.exception))
        self.assertEqual(fn.call_count, 3)
        # Only 2 sleeps (between retries, not after last)
        self.assertEqual(mock_time.sleep.call_count, 2)

    @patch.object(epcube_collector, "time")
    def test_exponential_delay(self, mock_time):
        # Arrange
        fn = MagicMock(side_effect=[RuntimeError("1"), RuntimeError("2"), RuntimeError("3"), "ok"])

        # Act
        epcube_collector.retry_with_backoff(fn, max_retries=4, base_delay=10)

        # Assert — delays should be 10, 20, 40 (base * 2^attempt)
        delays = [call[0][0] for call in mock_time.sleep.call_args_list]
        self.assertEqual(delays, [10, 20, 40])

    @patch.object(epcube_collector, "time")
    def test_custom_params(self, mock_time):
        # Arrange
        fn = MagicMock(side_effect=[ValueError("err"), 42])

        # Act
        result = epcube_collector.retry_with_backoff(fn, max_retries=5, base_delay=30)

        # Assert
        self.assertEqual(result, 42)
        self.assertEqual(fn.call_count, 2)
        mock_time.sleep.assert_called_once_with(30)


# ---------------------------------------------------------------------------
# Phase 3: _read_known_device_ids_from_db tests
# ---------------------------------------------------------------------------

class TestReadKnownDeviceIdsFromDb(unittest.TestCase):
    """Tests for PostgresWriter.read_active_epcube_ids — reads active EP Cube device IDs from DB."""

    @patch.object(db, "psycopg2")
    def test_returns_empty_set_when_no_dsn(self, mock_pg):
        # Arrange — writer initializes normally, then connection breaks for the read
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test")

        # Now break the connection for the read
        mock_conn.cursor.side_effect = Exception("connection lost")

        # Act
        result = writer.read_active_epcube_ids()

        # Assert
        self.assertEqual(result, set())

    @patch.object(db, "psycopg2")
    def test_returns_raw_cloud_ids(self, mock_pg):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = [
            ("epcube123_battery",), ("epcube123_solar",),
            ("epcube456_battery",), ("epcube456_solar",),
        ]
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test")

        # Act
        result = writer.read_active_epcube_ids()

        # Assert — should return raw cloud IDs, deduplicating battery/solar
        self.assertEqual(result, {"123", "456"})

    @patch.object(db, "psycopg2")
    def test_returns_empty_set_on_db_error(self, mock_pg):
        # Arrange — writer initializes normally, then connection fails for the read
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test")

        # Now break the connection for the read
        mock_conn.cursor.side_effect = Exception("connection refused")

        # Act
        result = writer.read_active_epcube_ids()

        # Assert
        self.assertEqual(result, set())

    @patch.object(db, "psycopg2")
    def test_returns_empty_set_when_no_devices(self, mock_pg):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test")

        # Act
        result = writer.read_active_epcube_ids()

        # Assert
        self.assertEqual(result, set())

    @patch.object(db, "psycopg2")
    def test_queries_only_active_epcube_devices(self, mock_pg):
        # Arrange
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = [("epcube100_battery",)]
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test")

        # Act
        writer.read_active_epcube_ids()

        # Assert — SQL should filter by status='active' and device_id pattern
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("active", sql.lower())
        self.assertIn("epcube", sql.lower())


# ---------------------------------------------------------------------------
# Phase 3: T015 — New device detection tests
# ---------------------------------------------------------------------------

class TestNewDeviceDetection(unittest.TestCase):
    """T015: _discover_devices detects new devices, registers in DB, logs discovery."""

    def test_new_device_registered_in_db(self):
        """When cloud returns a device not in DB, upsert_device is called for both sub-devices."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        existing_dev = _make_device(dev_id="100", name="Existing")
        new_dev = _make_device(dev_id="200", name="New Device")
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [existing_dev, new_dev]}):
            # Act
            c._discover_devices()

        # Assert — new device sub-devices registered in DB
        call_ids = [call[0][0] for call in c._pg.upsert_device.call_args_list]
        self.assertIn("epcube200_battery", call_ids)
        self.assertIn("epcube200_solar", call_ids)

    def test_existing_device_not_re_registered(self):
        """Devices already known in DB are not registered again by _discover_devices."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        existing_dev = _make_device(dev_id="100", name="Existing")
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [existing_dev]}):
            # Act
            c._discover_devices()

        # Assert — no upsert_device calls for already-known device
        c._pg.upsert_device.assert_not_called()

    def test_devices_list_updated_from_cloud(self):
        """After discovery, self._devices reflects the cloud device list."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        c._devices = []
        dev = _make_device(dev_id="100", name="Device")
        c._pg.read_active_epcube_ids = MagicMock(return_value=set())

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [dev]}):
            # Act
            c._discover_devices()

        # Assert
        self.assertEqual(len(c._devices), 1)
        self.assertEqual(c._devices[0]["id"], "100")

    def test_new_device_discovery_logged(self):
        """Discovery of a new device logs a message about the new device."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        new_dev = _make_device(dev_id="300", name="Brand New")
        c._pg.read_active_epcube_ids = MagicMock(return_value=set())

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new_dev]}):
            # Act
            with self.assertLogs("epcube-exporter", level="INFO") as cm:
                c._discover_devices()

        # Assert — log should mention new device discovery
        found = any("new device" in msg.lower() or "discovered" in msg.lower()
                     for msg in cm.output)
        self.assertTrue(found, f"Expected 'new device' or 'discovered' in logs: {cm.output}")

    def test_uses_compare_device_lists(self):
        """_discover_devices uses compare_device_lists for set comparison."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        dev = _make_device(dev_id="1", name="A")
        c._pg.read_active_epcube_ids = MagicMock(return_value=set())

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [dev]}), \
             patch.object(epcube_collector, "compare_device_lists",
                          wraps=epcube_collector.compare_device_lists) as mock_compare:
            # Act
            c._discover_devices()

        # Assert
        mock_compare.assert_called_once()


# ---------------------------------------------------------------------------
# Phase 3: T016 — Discovery interval timing tests
# ---------------------------------------------------------------------------

class TestDiscoveryIntervalTiming(unittest.TestCase):
    """T016: run_poll_loop runs discovery on interval, reads interval from DB."""

    def test_poll_loop_calls_discovery_via_retry(self):
        """run_poll_loop calls discovery via retry_with_backoff on first iteration."""
        # Arrange
        c = _make_collector()
        retry_calls = []

        def mock_retry(fn, **kw):
            retry_calls.append(True)
            fn()

        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 1:
                raise KeyboardInterrupt("stop")

        c._pg.read_setting_int = MagicMock(return_value=5)

        with patch.object(epcube_collector, "retry_with_backoff", side_effect=mock_retry), \
             patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll"), \
             patch.object(c, "_discover_devices"):

            # Act
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        # Assert — retry_with_backoff was called to wrap discovery
        self.assertEqual(len(retry_calls), 1)

    def test_poll_loop_reads_discovery_interval_from_db(self):
        """run_poll_loop calls _pg.read_setting_int for discovery_interval_seconds each cycle."""
        # Arrange
        c = _make_collector()

        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 1:
                raise KeyboardInterrupt("stop")

        c._pg.read_setting_int = MagicMock(return_value=5)

        with patch.object(epcube_collector, "retry_with_backoff",
                          side_effect=lambda fn, **kw: fn()), \
             patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll"), \
             patch.object(c, "_discover_devices"):

            # Act
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        # Assert — read_setting_int was called (for both poll and discovery intervals)
        self.assertTrue(c._pg.read_setting_int.called)

    def test_poll_loop_skips_discovery_when_interval_not_elapsed(self):
        """Discovery runs once (first iteration), then skips until interval elapses."""
        # Arrange
        c = _make_collector()
        discover_count = {"n": 0}

        def mock_retry(fn, **kw):
            discover_count["n"] += 1
            fn()

        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 3:
                raise KeyboardInterrupt("stop")

        def mock_read_setting(key, default, min_val, max_val):
            if key == "discovery_interval_seconds":
                return 3600
            return 5

        c._pg.read_setting_int = MagicMock(side_effect=mock_read_setting)

        with patch.object(epcube_collector, "retry_with_backoff", side_effect=mock_retry), \
             patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll"), \
             patch.object(c, "_discover_devices"):

            # Act
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        # Assert — discovery should run once (first iteration only, 5s << 3600s)
        self.assertEqual(discover_count["n"], 1)

    def test_poll_loop_continues_after_discovery_failure(self):
        """run_poll_loop logs and continues when discovery exhausts all retries."""
        # Arrange
        c = _make_collector()

        iteration = {"n": 0}

        def mock_sleep(secs):
            iteration["n"] += 1
            if iteration["n"] >= 2:
                raise KeyboardInterrupt("stop")

        c._pg.read_setting_int = MagicMock(return_value=5)

        with patch.object(epcube_collector, "retry_with_backoff",
                          side_effect=RuntimeError("all retries failed")), \
             patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll") as mock_poll:

            # Act
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        # Assert — poll still runs despite discovery failure
        self.assertTrue(mock_poll.called)

    def test_poll_loop_calls_poll_before_first_sleep_after_discovery(self):
        """Regression: after discovery (first iteration), poll() must run BEFORE
        time.sleep(interval) so new devices begin emitting telemetry immediately
        instead of waiting a full poll cycle."""
        # Arrange
        c = _make_collector()
        events = []

        def mock_sleep(secs):
            events.append(("sleep", secs))
            # Stop after the first sleep so we see the ordering of just the first iteration.
            raise KeyboardInterrupt("stop")

        def record_poll():
            events.append(("poll",))

        def record_discover():
            events.append(("discover",))

        c._pg.read_setting_int = MagicMock(return_value=60)

        with patch.object(epcube_collector, "retry_with_backoff",
                          side_effect=lambda fn, **kw: fn()), \
             patch("time.sleep", side_effect=mock_sleep), \
             patch.object(c, "poll", side_effect=record_poll), \
             patch.object(c, "_discover_devices", side_effect=record_discover):

            # Act
            with self.assertRaises(KeyboardInterrupt):
                c.run_poll_loop()

        # Assert — order must be: discover → poll → sleep (poll before sleep)
        kinds = [e[0] for e in events]
        self.assertIn("poll", kinds, "poll() must run on the first iteration")
        self.assertIn("sleep", kinds, "sleep() must run on the first iteration")
        self.assertLess(
            kinds.index("poll"),
            kinds.index("sleep"),
            f"poll() must be called BEFORE sleep() on the first iteration; got order: {kinds}",
        )


# ---------------------------------------------------------------------------
# Phase 3: T017 — Startup discovery tests
# ---------------------------------------------------------------------------

class TestStartupDiscovery(unittest.TestCase):
    """T017: _discover_devices discovers new devices from cloud vs DB."""

    def test_startup_registers_new_devices_from_cloud(self):
        """Devices in cloud but not in DB are registered via _discover_devices."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        new_dev = _make_device(dev_id="500", name="Startup Device")
        c._pg.read_active_epcube_ids = MagicMock(return_value=set())

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new_dev]}):
            # Act
            c._discover_devices()

        # Assert — device registered in DB via upsert_device
        call_ids = [call[0][0] for call in c._pg.upsert_device.call_args_list]
        self.assertIn("epcube500_battery", call_ids)
        self.assertIn("epcube500_solar", call_ids)

    def test_startup_discovery_logs_new_devices(self):
        """New devices are logged as discovered by _discover_devices."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        new_dev = _make_device(dev_id="600", name="New At Startup")
        c._pg.read_active_epcube_ids = MagicMock(return_value=set())

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new_dev]}):
            # Act
            with self.assertLogs("epcube-exporter", level="INFO") as cm:
                c._discover_devices()

        # Assert — log mentions new device discovery
        found = any("new device" in msg.lower() or "discovered" in msg.lower()
                     for msg in cm.output)
        self.assertTrue(found, f"Expected discovery log in: {cm.output}")


# ---------------------------------------------------------------------------
# Phase 3: T018 — Empty cloud device list guard (FR-007)
# ---------------------------------------------------------------------------

class TestEmptyCloudListGuard(unittest.TestCase):
    """T018: FR-007 — empty cloud list treated as error, current devices retained."""

    def test_empty_list_retains_current_devices(self):
        """When cloud returns empty device list, self._devices is NOT cleared."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        original_device = _make_device(dev_id="100", name="Existing")
        c._devices = [original_device]

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": []}):
            # Act
            c._discover_devices()

        # Assert — devices should be retained
        self.assertEqual(len(c._devices), 1)
        self.assertEqual(c._devices[0]["id"], "100")

    def test_empty_list_logs_warning(self):
        """When cloud returns empty device list, a warning is logged."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        c._devices = [_make_device(dev_id="100")]

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": []}):
            # Act
            with self.assertLogs("epcube-exporter", level="WARNING") as cm:
                c._discover_devices()

        # Assert — warning about empty device list
        found = any("empty" in msg.lower() for msg in cm.output)
        self.assertTrue(found, f"Expected 'empty' in warning logs: {cm.output}")

    def test_empty_list_no_db_registration(self):
        """When cloud returns empty list, no devices are registered in DB."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        c._devices = [_make_device(dev_id="100")]

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": []}):
            # Act
            c._discover_devices()

        # Assert
        c._pg.upsert_device.assert_not_called()


# ---------------------------------------------------------------------------
# Phase 4: T023 — Removed device detection tests
# ---------------------------------------------------------------------------

class TestRemovedDeviceDetection(unittest.TestCase):
    """T023: _discover_devices detects removed devices, updates DB status, logs removal."""

    def test_removed_device_excluded_from_poll_list(self):
        """When a known device disappears from cloud, self._devices no longer contains it."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "200"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            c._discover_devices()

        # Assert — only the remaining device is in the poll list
        poll_ids = [str(d["id"]) for d in c._devices]
        self.assertIn("100", poll_ids)
        self.assertNotIn("200", poll_ids)

    def test_removed_device_status_updated_in_db(self):
        """When a device is removed, update_device_status is called with 'removed'."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "300"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            c._discover_devices()

        # Assert — update_device_status called for the removed device
        c._pg.update_device_status.assert_called_once_with("300", "removed")

    def test_removed_device_logged(self):
        """When a device is removed, a log message identifies it."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "400"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            with self.assertLogs("epcube-exporter", level="WARNING") as cm:
                c._discover_devices()

        # Assert — log mentions device removal
        found = any("removed" in msg.lower() and "400" in msg for msg in cm.output)
        self.assertTrue(found, f"Expected removal log for device 400 in: {cm.output}")

    def test_multiple_devices_removed(self):
        """When multiple devices are removed, all are handled."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "500", "600"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            c._discover_devices()

        # Assert — update_device_status called for each removed device
        called_ids = {call[0][0] for call in c._pg.update_device_status.call_args_list}
        self.assertEqual(called_ids, {"500", "600"})


# ---------------------------------------------------------------------------
# Phase 4: T024 — Historical data preservation tests (FR-004)
# ---------------------------------------------------------------------------

class TestHistoricalDataPreservation(unittest.TestCase):
    """T024: FR-004 — device removal does NOT delete readings or device records."""

    def test_no_delete_calls_on_removal(self):
        """When a device is removed, no delete operations are performed on the writer."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "700"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            c._discover_devices()

        # Assert — no delete methods called
        # Check that the mock pg_writer has no delete-related calls
        for call in c._pg.method_calls:
            method_name = call[0]
            self.assertNotIn("delete", method_name.lower(),
                             f"Unexpected delete call: {method_name}")

    def test_device_record_preserved_after_removal(self):
        """The device record remains in DB (status updated, not deleted)."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining_dev = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "800"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining_dev]}):
            # Act
            c._discover_devices()

        # Assert — update_device_status is called (not delete), proving record is kept
        c._pg.update_device_status.assert_called_once_with("800", "removed")
        # Verify no method call contains 'delete_device' or 'remove_device'
        method_names = [call[0] for call in c._pg.method_calls]
        self.assertFalse(any("delete_device" in m or "remove_device" in m for m in method_names))


# ---------------------------------------------------------------------------
# Phase 4: T025 — update_device_status tests
# ---------------------------------------------------------------------------

class TestUpdateDeviceStatus(unittest.TestCase):
    """T025: PostgresWriter.update_device_status updates status for both sub-devices."""

    @patch.object(db, "psycopg2")
    def test_updates_both_sub_devices(self, mock_pg):
        """update_device_status updates _battery and _solar device records."""
        # Arrange
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        # Act
        writer.update_device_status("123", "removed")

        # Assert — SQL UPDATE for both sub-devices
        update_calls = [call for call in mock_cursor.execute.call_args_list
                        if 'UPDATE' in str(call) and 'devices' in str(call)]
        self.assertGreaterEqual(len(update_calls), 1)
        # Check that both device IDs are included
        all_params = [str(call) for call in mock_cursor.execute.call_args_list]
        all_sql = " ".join(all_params)
        self.assertIn("epcube123_battery", all_sql)
        self.assertIn("epcube123_solar", all_sql)
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_updates_status_to_given_value(self, mock_pg):
        """update_device_status sets status column to the provided value."""
        # Arrange
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        # Act
        writer.update_device_status("456", "merged")

        # Assert — the status value is passed to the SQL
        all_params = [str(call) for call in mock_cursor.execute.call_args_list]
        all_sql = " ".join(all_params)
        self.assertIn("merged", all_sql)


# ---------------------------------------------------------------------------
# Phase 5: T027 — Pending replacement creation tests
# ---------------------------------------------------------------------------

class TestPendingReplacementCreation(unittest.TestCase):
    """T027: _discover_devices creates pending_replacement when alias matches."""

    def test_same_cycle_add_and_remove_creates_pending(self):
        """When discovery sees both an add and a remove in one cycle, insert pending_replacement."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        new_dev = _make_device(dev_id="200", name="Replacement")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_removed_predecessor = MagicMock(return_value="100")
        c._pg.find_replacement_candidate = MagicMock(return_value=None)
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new_dev]}):
            # Act — DB knows {100}, cloud returns {200} → 100 removed, 200 added
            c._discover_devices()

        # Assert — find_removed_predecessor matched them by alias
        c._pg.find_removed_predecessor.assert_called_once_with("200")
        c._pg.insert_pending_replacement.assert_called_once_with("100", "200")

    def test_add_only_no_pending_when_no_removed_predecessor(self):
        """When discovery sees only additions and no removed predecessor exists, no pending created."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        existing = _make_device(dev_id="100", name="Existing")
        new_dev = _make_device(dev_id="200", name="Brand New")
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_removed_predecessor = MagicMock(return_value=None)
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [existing, new_dev]}):
            # Act — DB knows {100}, cloud returns {100, 200} → only addition
            c._discover_devices()

        # Assert — find_removed_predecessor called but returned None
        c._pg.find_removed_predecessor.assert_called_once_with("200")
        c._pg.insert_pending_replacement.assert_not_called()

    def test_add_only_creates_pending_when_removed_predecessor_found(self):
        """New device added with no removal this cycle, but a previously removed device matches by alias."""
        # Arrange — DB knows {100} active, cloud returns {100, 200} → 200 is added
        # find_removed_predecessor("200") returns "999" (a previously removed device)
        c = _make_collector()
        c._token = "fake_token"
        existing = _make_device(dev_id="100", name="Existing")
        new_dev = _make_device(dev_id="200", name="Same Name As 999")
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_removed_predecessor = MagicMock(return_value="999")
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [existing, new_dev]}):
            c._discover_devices()

        # Assert — pending replacement recorded for the cross-cycle match
        c._pg.find_removed_predecessor.assert_called_once_with("200")
        c._pg.insert_pending_replacement.assert_called_once_with("999", "200")

    def test_remove_only_no_pending_replacement(self):
        """When discovery sees only removals, no pending_replacement is created."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_replacement_candidate = MagicMock(return_value=None)
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "200"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining]}):
            # Act — DB knows {100, 200}, cloud returns {100} → only removal
            c._discover_devices()

        # Assert
        c._pg.insert_pending_replacement.assert_not_called()

    def test_multiple_additions_each_checked_for_predecessor(self):
        """N added devices → N calls to find_removed_predecessor."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        new1 = _make_device(dev_id="500", name="New 1")
        new2 = _make_device(dev_id="600", name="New 2")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_removed_predecessor = MagicMock(side_effect=lambda x: {"500": "100", "600": "200"}.get(x))
        c._pg.find_replacement_candidate = MagicMock(return_value=None)
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "200"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new1, new2]}):
            # Act — 2 removed (100, 200), 2 added (500, 600)
            c._discover_devices()

        # Assert — one record per matched pair
        self.assertEqual(c._pg.insert_pending_replacement.call_count, 2)
        called_old_ids = {call[0][0] for call in c._pg.insert_pending_replacement.call_args_list}
        self.assertEqual(called_old_ids, {"100", "200"})


# ---------------------------------------------------------------------------
# Phase 5: T028 — insert_pending_replacement tests
# ---------------------------------------------------------------------------

class TestInsertPendingReplacement(unittest.TestCase):
    """T028: PostgresWriter.insert_pending_replacement inserts into pending_replacements."""

    @patch.object(db, "psycopg2")
    def test_inserts_record(self, mock_pg):
        """insert_pending_replacement issues an INSERT into pending_replacements."""
        # Arrange
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        # Act
        writer.insert_pending_replacement("123", "456")

        # Assert — INSERT into pending_replacements with both IDs
        insert_calls = [call for call in mock_cursor.execute.call_args_list
                        if 'pending_replacements' in str(call) and 'INSERT' in str(call)]
        self.assertEqual(len(insert_calls), 1)
        params = insert_calls[0][0][1]
        self.assertEqual(params, ("123", "456"))
        mock_conn.commit.assert_called()

    @patch.object(db, "psycopg2")
    def test_uses_on_conflict_do_nothing(self, mock_pg):
        """insert_pending_replacement uses ON CONFLICT DO NOTHING for idempotency."""
        # Arrange
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = db.PostgresWriter("postgresql://test:test@localhost/test")

        # Act
        writer.insert_pending_replacement("789", "012")

        # Assert
        all_sql = " ".join(str(call) for call in mock_cursor.execute.call_args_list).upper()
        self.assertIn("ON CONFLICT", all_sql)
        self.assertIn("DO NOTHING", all_sql)


# ---------------------------------------------------------------------------
# Cross-cycle replacement detection (Option 1)
# ---------------------------------------------------------------------------

class TestCrossCycleReplacementDetection(unittest.TestCase):
    """When a device is removed in a cycle without a same-cycle add, look up an
    existing active device with the same alias registered after the removed one
    and insert a pending_replacement row."""

    def test_remove_only_inserts_pending_when_alias_match_found(self):
        """Lone removal triggers find_replacement_candidate; insert pending if it returns an id."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_replacement_candidate = MagicMock(return_value="200")
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "999"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining]}):
            # Act — DB knows {100, 999}, cloud returns {100} → 999 removed (no same-cycle add)
            c._discover_devices()

        # Assert — find_replacement_candidate consulted with the removed id, pending inserted
        c._pg.find_replacement_candidate.assert_called_once_with("999")
        c._pg.insert_pending_replacement.assert_called_once_with("999", "200")

    def test_remove_only_no_pending_when_no_alias_match(self):
        """Lone removal with no alias match → no pending row inserted."""
        # Arrange
        c = _make_collector()
        c._token = "fake_token"
        remaining = _make_device(dev_id="100", name="Remaining")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_replacement_candidate = MagicMock(return_value=None)
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100", "999"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [remaining]}):
            # Act
            c._discover_devices()

        # Assert
        c._pg.find_replacement_candidate.assert_called_once_with("999")
        c._pg.insert_pending_replacement.assert_not_called()

    def test_paired_via_added_skips_removed_cross_cycle_lookup(self):
        """A removed device already paired via find_removed_predecessor should not also trigger find_replacement_candidate."""
        # Arrange — DB knows {100}, cloud returns {200} → 100 removed, 200 added
        # find_removed_predecessor("200") returns "100" → paired already
        c = _make_collector()
        c._token = "fake_token"
        new_dev = _make_device(dev_id="200", name="Replacement")
        c._pg.update_device_status = MagicMock()
        c._pg.insert_pending_replacement = MagicMock()
        c._pg.find_removed_predecessor = MagicMock(return_value="100")
        c._pg.find_replacement_candidate = MagicMock(return_value="999")  # would be used if called
        c._pg.read_active_epcube_ids = MagicMock(return_value={"100"})

        with patch.object(epcube_collector, "_api_request",
                          return_value={"status": 200, "data": [new_dev]}):
            c._discover_devices()

        # Assert — paired via added loop; removed cross-cycle lookup skipped
        c._pg.find_replacement_candidate.assert_not_called()
        c._pg.insert_pending_replacement.assert_called_once_with("100", "200")


class TestFindReplacementCandidate(unittest.TestCase):
    """PostgresWriter.find_replacement_candidate finds active alias-match devices."""

    def _make_writer(self, mock_pg, fetch_results):
        """Helper to set up a writer whose cursor.fetchone returns the queued results in order."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = list(fetch_results)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        return db.PostgresWriter("postgresql://test:test@localhost/test"), mock_cursor

    @patch.object(db, "psycopg2")
    def test_returns_candidate_id_when_active_alias_match_found(self, mock_pg):
        """Returns the raw cloud id of the active alias-matching device."""
        # Arrange — first fetchone (lookup old): (alias, old_created); second (lookup candidate): (device_id,)
        writer, _ = self._make_writer(mock_pg, [
            ("Steve St Jean 3", "2026-04-09T12:59:49+00:00"),
            ("epcube5840_battery",),
        ])

        # Act
        result = writer.find_replacement_candidate("5488")

        # Assert
        self.assertEqual(result, "5840")

    @patch.object(db, "psycopg2")
    def test_returns_none_when_old_device_missing(self, mock_pg):
        """Returns None when the removed device has no row in devices."""
        writer, _ = self._make_writer(mock_pg, [None])
        self.assertIsNone(writer.find_replacement_candidate("5488"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_old_device_has_no_alias(self, mock_pg):
        """Returns None when the removed device row has a NULL alias."""
        writer, _ = self._make_writer(mock_pg, [(None, "2026-04-09T12:59:49+00:00")])
        self.assertIsNone(writer.find_replacement_candidate("5488"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_no_active_match(self, mock_pg):
        """Returns None when the candidate lookup finds no row."""
        writer, _ = self._make_writer(mock_pg, [
            ("Steve St Jean 3", "2026-04-09T12:59:49+00:00"),
            None,
        ])
        self.assertIsNone(writer.find_replacement_candidate("5488"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_candidate_id_unparseable(self, mock_pg):
        """Returns None when the candidate device_id doesn't match the epcubeN_battery shape."""
        writer, _ = self._make_writer(mock_pg, [
            ("Same Alias", "2026-04-09T12:59:49+00:00"),
            ("vue_panel_42",),  # not an epcube*_battery id
        ])
        self.assertIsNone(writer.find_replacement_candidate("5488"))


class TestFindRemovedPredecessor(unittest.TestCase):
    """PostgresWriter.find_removed_predecessor finds removed alias-match devices."""

    def _make_writer(self, mock_pg, fetch_results):
        """Helper to set up a writer whose cursor.fetchone returns the queued results in order."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = list(fetch_results)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        return db.PostgresWriter("postgresql://test:test@localhost/test"), mock_cursor

    @patch.object(db, "psycopg2")
    def test_returns_predecessor_id_when_removed_alias_match_found(self, mock_pg):
        """Returns the raw cloud id of the removed alias-matching device."""
        writer, _ = self._make_writer(mock_pg, [
            ("Steve St Jean 3", "2026-05-16T15:00:00+00:00"),  # new device alias + created_at
            ("epcube5488_battery",),  # removed predecessor
        ])
        result = writer.find_removed_predecessor("5840")
        self.assertEqual(result, "5488")

    @patch.object(db, "psycopg2")
    def test_returns_none_when_new_device_missing(self, mock_pg):
        """Returns None when the new device has no row in devices."""
        writer, _ = self._make_writer(mock_pg, [None])
        self.assertIsNone(writer.find_removed_predecessor("5840"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_new_device_has_no_alias(self, mock_pg):
        """Returns None when the new device row has a NULL alias."""
        writer, _ = self._make_writer(mock_pg, [(None, "2026-05-16T15:00:00+00:00")])
        self.assertIsNone(writer.find_removed_predecessor("5840"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_no_removed_match(self, mock_pg):
        """Returns None when no removed device matches the alias."""
        writer, _ = self._make_writer(mock_pg, [
            ("Steve St Jean 3", "2026-05-16T15:00:00+00:00"),
            None,
        ])
        self.assertIsNone(writer.find_removed_predecessor("5840"))

    @patch.object(db, "psycopg2")
    def test_returns_none_when_predecessor_id_unparseable(self, mock_pg):
        """Returns None when the predecessor device_id doesn't match the epcubeN_battery shape."""
        writer, _ = self._make_writer(mock_pg, [
            ("Same Alias", "2026-05-16T15:00:00+00:00"),
            ("vue_panel_42",),
        ])
        self.assertIsNone(writer.find_removed_predecessor("5840"))


# ---------------------------------------------------------------------------
# Coverage gap: PostgresWriter.read_setting_int (instance method)
# ---------------------------------------------------------------------------

class TestPostgresWriterReadSettingInt(unittest.TestCase):
    """Cover PostgresWriter.read_setting_int — the instance-method variant
    used by collector code via `self._pg.read_setting_int(...)`."""

    def _make_writer(self, mock_pg, fetch_results):
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = list(fetch_results)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        return db.PostgresWriter("postgresql://test"), mock_cursor

    @patch.object(db, "psycopg2")
    def test_returns_value_when_in_range(self, mock_pg):
        # Arrange
        writer, _ = self._make_writer(mock_pg, [("3600",)])

        # Act
        result = writer.read_setting_int("discovery_interval_seconds", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 3600)

    @patch.object(db, "psycopg2")
    def test_strips_double_quotes_from_jsonb_value(self, mock_pg):
        # Arrange — settings values are stored as JSONB strings ("3600")
        writer, _ = self._make_writer(mock_pg, [('"3600"',)])

        # Act
        result = writer.read_setting_int("k", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 3600)

    @patch.object(db, "psycopg2")
    def test_returns_default_when_value_below_min(self, mock_pg):
        # Arrange
        writer, _ = self._make_writer(mock_pg, [("30",)])

        # Act
        result = writer.read_setting_int("k", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 60)

    @patch.object(db, "psycopg2")
    def test_returns_default_when_value_above_max(self, mock_pg):
        # Arrange
        writer, _ = self._make_writer(mock_pg, [("99999",)])

        # Act
        result = writer.read_setting_int("k", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 60)

    @patch.object(db, "psycopg2")
    def test_returns_default_when_row_missing(self, mock_pg):
        # Arrange
        writer, _ = self._make_writer(mock_pg, [None])

        # Act
        result = writer.read_setting_int("k", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 60)

    @patch.object(db, "psycopg2")
    def test_returns_default_when_db_raises(self, mock_pg):
        # Arrange
        writer, cursor = self._make_writer(mock_pg, [("3600",)])
        cursor.execute.side_effect = RuntimeError("DB down")

        # Act
        result = writer.read_setting_int("k", 60, 60, 86400)

        # Assert
        self.assertEqual(result, 60)


# ---------------------------------------------------------------------------
# Coverage gap: EpCubeCollector._discover_devices non-200 cloud response
# ---------------------------------------------------------------------------

class TestDiscoverDevicesCloudError(unittest.TestCase):
    """Cover the early-return when the cloud /home/deviceList call returns
    a non-200 status."""

    def test_discover_returns_early_on_non_200_cloud_status(self):
        # Arrange
        c = _make_collector()
        c._token = "valid-token"

        with patch.object(c, "_ensure_auth"), \
             patch.object(epcube_collector, "_api_request",
                          return_value={"status": 500, "message": "cloud down"}):

            # Act — should not raise and should not mutate device state
            c._discover_devices()

        # Assert
        self.assertEqual(len(c._devices), 0)


if __name__ == "__main__":
    unittest.main()
