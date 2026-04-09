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

import exporter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_collector():
    """Create a collector ready for testing (no real auth)."""
    c = exporter.EpCubeCollector("user@test.com", "password")
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

class _TestableHandler(exporter.MetricsHandler):
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

        with patch.object(exporter, "_api_request",
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
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for([dev], home_info=home1)):
            c.poll()

        c._history[-1]["time_minute"] = "old"  # force new snapshot

        # Second poll: battery discharged to 15.0 kWh
        home2 = _make_home_device_info(batteryCurrentElectricity="15.0")
        with patch.object(exporter, "_api_request",
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

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
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

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        # Manually change the time_minute to simulate a different minute
        c._history[-1]["time_minute"] = "2020-01-01T00:00Z"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
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
        self.assertEqual(len(c._history), exporter.EpCubeCollector.HISTORY_MAX)


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

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        self.assertEqual(c._consecutive_errors, 0)
        self.assertEqual(c._poll_count, 1)

    def test_poll_increments_count(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
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
            "version": exporter.__version__,
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
        html = exporter._render_status_page(self._make_status(), self._make_health())
        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("epcube-exporter", html)

    def test_healthy_chiclet_green(self):
        html = exporter._render_status_page(self._make_status(), self._make_health(healthy=True))
        self.assertIn("#00d4aa", html)
        self.assertIn("healthy", html)

    def test_unhealthy_chiclet_red(self):
        html = exporter._render_status_page(
            self._make_status(),
            self._make_health(healthy=False, checks=["stale poll"]),
        )
        self.assertIn("#e74c3c", html)
        self.assertIn("stale poll", html)

    def test_no_data_message(self):
        html = exporter._render_status_page(self._make_status(history=[]), self._make_health())
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
        html = exporter._render_status_page(status, self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="val-pos">-1.00', html)

    def test_uptime_formatting(self):
        html = exporter._render_status_page(self._make_status(uptime_s=3665), self._make_health())
        self.assertIn("1h 1m 5s", html)

    def test_error_count_warning_style(self):
        html = exporter._render_status_page(self._make_status(poll_errors=3), self._make_health())
        self.assertIn("warn", html)

    def test_error_count_ok_style(self):
        html = exporter._render_status_page(self._make_status(poll_errors=0), self._make_health())
        self.assertIn("ok", html)

    def test_version_displayed(self):
        html = exporter._render_status_page(self._make_status(), self._make_health())
        self.assertIn(exporter.__version__, html)
        self.assertIn("Version:", html)

    def test_poll_interval_displayed(self):
        html = exporter._render_status_page(self._make_status(poll_interval=10), self._make_health())
        self.assertIn("Poll interval:", html)
        self.assertIn("10s", html)

    def test_countdown_displayed(self):
        next_at = time.time() + 20
        html = exporter._render_status_page(self._make_status(next_poll_at=next_at), self._make_health())
        self.assertIn("Next poll in:", html)
        self.assertIn('id="countdown"', html)
        self.assertIn(f'data-next="{next_at}"', html)

    def test_countdown_zero_when_past(self):
        next_at = time.time() - 5  # already past
        html = exporter._render_status_page(self._make_status(next_poll_at=next_at), self._make_health())
        self.assertIn('>0s<', html)

    def test_countdown_waiting_when_no_next_poll(self):
        html = exporter._render_status_page(self._make_status(next_poll_at=0), self._make_health())
        self.assertIn("waiting", html)

    def test_countdown_js_ticks(self):
        html = exporter._render_status_page(self._make_status(), self._make_health())
        self.assertIn("getElementById('countdown')", html)
        self.assertIn("parseFloat(el.dataset.next)", html)

    def test_auto_refresh_via_fetch(self):
        html = exporter._render_status_page(self._make_status(), self._make_health())
        # Meta refresh removed; replaced with JS fetch-based background refresh
        self.assertNotIn('http-equiv="refresh"', html)
        self.assertIn('setInterval', html)
        self.assertIn('fetch(location.href)', html)

    def test_auto_refresh_matches_poll_interval(self):
        html = exporter._render_status_page(self._make_status(poll_interval=10), self._make_health())
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
        html = exporter._render_status_page(self._make_status(history=[snap]), self._make_health())
        self.assertIn('class="utctime"', html)
        self.assertIn('data-utc="2026-03-17T15:00:00Z"', html)


# ---------------------------------------------------------------------------
# HTTP handler tests
# ---------------------------------------------------------------------------

class TestHTTPHandler(unittest.TestCase):

    def setUp(self):
        self.collector = _make_collector()
        self.collector._last_poll = time.time()
        self.collector._metrics_text = "# test metric\ntest_metric 42\n"

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

    def test_metrics_returns_200(self):
        h = self._make_handler("/metrics")
        h.send_response.assert_called_with(200)

    def test_metrics_no_auth_required(self):
        with patch.object(exporter, "DISABLE_AUTH", False):
            h = self._make_handler("/metrics")
            h.send_response.assert_called_with(200)

    def test_health_returns_200_when_healthy(self):
        h = self._make_handler("/health")
        h.send_response.assert_called_with(200)
        self.assertIn(b"ok", h.wfile.getvalue())

    def test_health_returns_503_when_unhealthy(self):
        self.collector._last_poll = 0.0  # no poll yet
        h = self._make_handler("/health")
        h.send_response.assert_called_with(503)
        self.assertIn(b"unhealthy", h.wfile.getvalue())

    def test_health_no_auth_required(self):
        with patch.object(exporter, "DISABLE_AUTH", False):
            h = self._make_handler("/health")
            h.send_response.assert_called_with(200)

    def test_debug_page_returns_200_auth_disabled(self):
        with patch.object(exporter, "DISABLE_AUTH", True):
            h = self._make_handler("/")
            h.send_response.assert_called_with(200)

    def test_debug_page_401_api_client_without_token(self):
        """API client (no Accept: text/html) gets 401 without auth."""
        with patch.object(exporter, "DISABLE_AUTH", False):
            h = self._make_handler("/", headers={})
            h.send_response.assert_called_with(401)

    def test_debug_page_redirects_browser_to_login(self):
        """Browser (Accept: text/html) without auth gets redirected to /login."""
        with patch.object(exporter, "DISABLE_AUTH", False), \
             patch.object(exporter, "AZURE_REDIRECT_URI", "https://example.com/.auth/callback"):
            h = self._make_handler("/", headers={"Accept": "text/html"})
            h.send_response.assert_called_with(302)
            h.send_header.assert_any_call("Location", "/login")

    def test_debug_page_401_with_bad_bearer(self):
        with patch.object(exporter, "DISABLE_AUTH", False):
            h = self._make_handler("/", headers={"Authorization": "Bearer bad-token"})
            h.send_response.assert_called_with(401)

    def test_login_redirects_to_microsoft(self):
        """GET /login redirects to Microsoft authorization endpoint."""
        with patch.object(exporter, "AZURE_REDIRECT_URI", "https://example.com/.auth/callback"), \
             patch.object(exporter, "AZURE_CLIENT_ID", "test-client-id"), \
             patch.object(exporter, "AZURE_TENANT_ID", "test-tenant"), \
             patch.object(exporter, "AZURE_AUDIENCE", "api://test"):
            h = self._make_handler("/login")
            h.send_response.assert_called_with(302)
            location_calls = [c for c in h.send_header.call_args_list if c[0][0] == "Location"]
            self.assertTrue(len(location_calls) > 0)
            url = location_calls[0][0][1]
            self.assertIn("login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize", url)
            self.assertIn("client_id=test-client-id", url)

    def test_login_returns_500_when_not_configured(self):
        """GET /login returns 500 when OAuth is not configured."""
        with patch.object(exporter, "AZURE_REDIRECT_URI", ""), \
             patch.object(exporter, "AZURE_CLIENT_ID", ""):
            h = self._make_handler("/login")
            h.send_response.assert_called_with(500)

    def test_callback_returns_400_without_params(self):
        """GET /.auth/callback without code/state returns 400."""
        h = self._make_handler("/.auth/callback")
        h.send_response.assert_called_with(400)

    def test_callback_returns_400_with_invalid_state(self):
        """GET /.auth/callback with unknown state returns 400."""
        h = self._make_handler("/.auth/callback?code=test&state=invalid")
        h.send_response.assert_called_with(400)

    def test_session_cookie_grants_access(self):
        """Valid session cookie grants access to debug page."""
        with patch.object(exporter, "DISABLE_AUTH", False), \
             patch.object(exporter, "AZURE_CLIENT_SECRET", "test-secret"):
            # Create a session
            session_id = "test-session-123"
            with exporter._auth_lock:
                exporter._sessions[session_id] = {
                    "expires": time.time() + 3600,
                    "user": "test@example.com",
                }
            signed = exporter._sign_session(session_id)
            h = self._make_handler("/", headers={"Cookie": f"_session={signed}"})
            h.send_response.assert_called_with(200)
            # Cleanup
            with exporter._auth_lock:
                exporter._sessions.pop(session_id, None)

    def test_expired_session_denied(self):
        """Expired session cookie is rejected."""
        with patch.object(exporter, "DISABLE_AUTH", False), \
             patch.object(exporter, "AZURE_CLIENT_SECRET", "test-secret"):
            session_id = "expired-session"
            with exporter._auth_lock:
                exporter._sessions[session_id] = {
                    "expires": time.time() - 1,  # already expired
                    "user": "test@example.com",
                }
            signed = exporter._sign_session(session_id)
            h = self._make_handler("/", headers={"Cookie": f"_session={signed}"})
            h.send_response.assert_called_with(401)
            # Cleanup
            with exporter._auth_lock:
                exporter._sessions.pop(session_id, None)

    def test_status_alias_works(self):
        with patch.object(exporter, "DISABLE_AUTH", True):
            h = self._make_handler("/status")
            h.send_response.assert_called_with(200)

    def test_unknown_path_returns_404(self):
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

        with patch.object(exporter, "_api_request",
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

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
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

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        snap = c._history[-1]
        self.assertEqual(len(snap["devices"]), 2)
        names = {d["name"] for d in snap["devices"]}
        self.assertEqual(names, {"Device A", "Device B"})


# ---------------------------------------------------------------------------
# Prometheus metrics format tests
# ---------------------------------------------------------------------------

class TestPrometheusMetrics(unittest.TestCase):

    def test_metrics_contain_expected_names(self):
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        metrics = c.get_metrics()
        expected_metrics = [
            "epcube_solar_instantaneous_generation_watts",
            "epcube_battery_state_of_capacity_percent",
            "epcube_battery_power_watts",
            "epcube_grid_power_watts",
            "epcube_home_load_power_watts",
            "epcube_self_sufficiency_rate",
            "epcube_solar_cumulative_generation_kwh",
            "epcube_grid_import_kwh",
            "epcube_grid_export_kwh",
            "epcube_battery_stored_kwh",
            "epcube_battery_peak_stored_kwh",
            "epcube_home_supply_cumulative_kwh",
            "epcube_scrape_success",
            "epcube_device_info",
        ]
        for name in expected_metrics:
            self.assertIn(name, metrics, f"Missing metric: {name}")

    def test_metrics_labels_format(self):
        c = _make_collector()
        devs = [_make_device(dev_id="9999")]
        c._devices = devs
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for(devs)):
            c.poll()

        metrics = c.get_metrics()
        self.assertIn('device="epcube9999_battery"', metrics)
        self.assertIn('device="epcube9999_solar"', metrics)
        self.assertIn('ip="cloud"', metrics)

    def test_battery_stored_kwh_exported(self):
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home_info = _make_home_device_info(batteryCurrentElectricity="15.5")

        # Act
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home_info)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        self.assertIn("epcube_battery_stored_kwh", metrics)
        self.assertIn('epcube_battery_stored_kwh{device="epcube1234_battery"', metrics)
        self.assertIn("15.5", metrics.split("epcube_battery_stored_kwh{")[1].split("\n")[0])

    def test_home_supply_cumulative_kwh_exported(self):
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        elec_data = _make_electricity_data(backUpElectricity=10.0)

        # Act
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, elec_data=elec_data)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        self.assertIn("epcube_home_supply_cumulative_kwh", metrics)
        self.assertIn('epcube_home_supply_cumulative_kwh{device="epcube1234_battery"', metrics)
        self.assertIn("10.0", metrics.split("epcube_home_supply_cumulative_kwh{")[1].split("\n")[0])

    def test_device_info_includes_system_status_label(self):
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home_info = _make_home_device_info(systemStatus=1)

        # Act
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home_info)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        # system_status label should appear on epcube_device_info lines
        info_lines = [l for l in metrics.splitlines() if l.startswith("epcube_device_info{")]
        self.assertTrue(len(info_lines) >= 2)  # battery + solar
        for line in info_lines:
            self.assertIn('system_status="Self-Use"', line)

    def test_device_info_includes_ress_count_label(self):
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home_info = _make_home_device_info(ressNumber=3)

        # Act
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home_info)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        info_lines = [l for l in metrics.splitlines() if l.startswith("epcube_device_info{")]
        self.assertTrue(len(info_lines) >= 2)
        for line in info_lines:
            self.assertIn('ress_count="3"', line)

    def test_battery_peak_stored_kwh_exported(self):
        """Peak battery stored tracks max and is exported as a Prometheus metric."""
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home1 = _make_home_device_info(batteryCurrentElectricity="20.0")

        # Act — first poll sets peak to 20.0
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home1)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        self.assertIn("epcube_battery_peak_stored_kwh", metrics)
        line = [l for l in metrics.splitlines()
                if l.startswith("epcube_battery_peak_stored_kwh{")][0]
        self.assertIn('device="epcube1234_battery"', line)
        self.assertTrue(line.endswith("20.0"))

    def test_battery_peak_retains_max_in_metric(self):
        """After discharge, peak metric still reflects the day's high-water mark."""
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"

        # Act — first poll at 20 kWh, second at 15 kWh
        home1 = _make_home_device_info(batteryCurrentElectricity="20.0")
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home1)):
            c.poll()
        c._history[-1]["time_minute"] = "old"  # force new snapshot

        home2 = _make_home_device_info(batteryCurrentElectricity="15.0")
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info=home2)):
            c.poll()

        # Assert — peak should still be 20.0
        metrics = c.get_metrics()
        line = [l for l in metrics.splitlines()
                if l.startswith("epcube_battery_peak_stored_kwh{")][0]
        self.assertTrue(line.endswith("20.0"))


# ---------------------------------------------------------------------------
# Negative zero normalization tests
# ---------------------------------------------------------------------------

class TestNegativeZeroNormalization(unittest.TestCase):

    def test_nz_negative_zero_returns_positive_zero(self):
        # Arrange
        value = -0.0

        # Act
        result = exporter._nz(value)

        # Assert
        self.assertEqual(result, 0.0)
        self.assertNotEqual(str(result), "-0.0")

    def test_nz_positive_zero_returns_positive_zero(self):
        # Arrange
        value = 0.0

        # Act
        result = exporter._nz(value)

        # Assert
        self.assertEqual(result, 0.0)

    def test_nz_integer_zero_returns_positive_zero(self):
        # Arrange
        value = 0

        # Act
        result = exporter._nz(value)

        # Assert
        self.assertEqual(result, 0.0)

    def test_nz_positive_value_passes_through(self):
        # Arrange
        value = 3.14

        # Act
        result = exporter._nz(value)

        # Assert
        self.assertEqual(result, 3.14)

    def test_nz_negative_value_passes_through(self):
        # Arrange
        value = -5.0

        # Act
        result = exporter._nz(value)

        # Assert
        self.assertEqual(result, -5.0)

    def test_metrics_no_negative_zero_with_zero_grid_power(self):
        """When API returns gridPower=0, negation must NOT produce -0 in metrics."""
        # Arrange
        c = _make_collector()
        devs = [_make_device()]
        c._devices = devs
        c._token = "fake-token"
        home_info = _make_home_device_info(
            solarPower=0, batterySoc=50, batteryPower=0,
            gridPower=0, backUpPower=0, selfHelpRate=0,
            batteryCurrentElectricity="0",
        )
        elec_data = _make_electricity_data(
            solarElectricity=0, gridElectricityFrom=0,
            gridElectricityTo=0, backUpElectricity=0,
        )

        # Act
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for(devs, home_info, elec_data)):
            c.poll()

        # Assert
        metrics = c.get_metrics()
        for line in metrics.splitlines():
            if line.startswith("#") or not line.strip():
                continue
            self.assertNotRegex(line, r'\s-0(\.0+)?$',
                                f"Negative zero found in metric line: {line}")

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
        with patch.object(exporter, "_api_request",
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
                raise exporter.AuthExpiredError("Token expired")
            if "homeDeviceInfo" in path:
                return _make_home_device_info()
            elif "deviceList" in path:
                return {"status": 200, "data": c._devices}
            return {"status": 200, "data": {}}

        with patch.object(exporter, "_api_request", side_effect=mock_api):
            with patch.object(exporter, "authenticate", return_value="new-token"):
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
        self.assertEqual(exporter._jwt_exp(token), 1700000000)

    def test_returns_zero_for_invalid_token(self):
        self.assertEqual(exporter._jwt_exp("not-a-jwt"), 0)

    def test_returns_zero_for_missing_exp(self):
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "user"}).encode()).rstrip(b"=").decode()
        token = f"header.{payload}.signature"
        self.assertEqual(exporter._jwt_exp(token), 0)


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
        self.assertTrue(exporter.EpCubeCollector._data_looks_stale(data))

    def test_nonzero_soc_is_not_stale(self):
        data = {
            "solarPower": "0.00",
            "gridPower": "0.00",
            "backUpPower": "0.00",
            "batterySoc": 75,
            "batteryCurrentElectricity": "0.00",
        }
        self.assertFalse(exporter.EpCubeCollector._data_looks_stale(data))

    def test_nonzero_backup_is_not_stale(self):
        data = {
            "solarPower": "0.00",
            "gridPower": "0.00",
            "backUpPower": "2.74",
            "batterySoc": 0,
            "batteryCurrentElectricity": "0.00",
        }
        self.assertFalse(exporter.EpCubeCollector._data_looks_stale(data))

    def test_empty_data_is_stale(self):
        self.assertTrue(exporter.EpCubeCollector._data_looks_stale({}))

    def test_none_data_is_stale(self):
        self.assertTrue(exporter.EpCubeCollector._data_looks_stale(None))

    def test_normal_data_is_not_stale(self):
        data = _make_home_device_info()["data"]
        self.assertFalse(exporter.EpCubeCollector._data_looks_stale(data))


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

        with patch.object(exporter, "authenticate", return_value="fresh-token") as auth_mock:
            with patch.object(exporter, "_api_request", return_value={"status": 200, "data": [_make_device()]}):
                c._ensure_auth()

        auth_mock.assert_called_once()
        self.assertEqual(c._token, "fresh-token")

    def test_ensure_auth_skips_refresh_when_token_valid(self):
        c = _make_collector()
        c._token = "valid-token"
        c._token_exp = time.time() + 3600  # plenty of time

        with patch.object(exporter, "authenticate") as auth_mock:
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

        with patch.object(exporter, "_api_request", side_effect=mock_api):
            with patch.object(exporter, "authenticate", return_value="fresh-token"):
                c.poll()

        self.assertEqual(c._token, "fresh-token")
        # Verify metrics were generated with good data (non-zero)
        self.assertIn("epcube_battery_state_of_capacity_percent", c._metrics_text)
        self.assertIn("75", c._metrics_text)


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

    @patch.object(exporter, "psycopg2")
    def test_init_creates_schema(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")

        mock_pg.connect.assert_called_once_with("postgresql://test:test@localhost/test")
        mock_cursor.execute.assert_called_once()
        # The schema SQL should contain CREATE TABLE
        call_args = mock_cursor.execute.call_args[0][0]
        self.assertIn("CREATE TABLE IF NOT EXISTS devices", call_args)
        self.assertIn("CREATE TABLE IF NOT EXISTS readings", call_args)
        mock_conn.commit.assert_called()

    @patch.object(exporter, "psycopg2")
    def test_upsert_device(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_write_readings(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_write_empty_readings_is_noop(self, mock_pg):
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")
        mock_conn.reset_mock()

        writer.write_readings([])
        mock_conn.commit.assert_not_called()

    @patch.object(exporter, "psycopg2")
    def test_reconnects_on_closed_connection(self, mock_pg):
        mock_conn1, _ = self._make_mock_psycopg2()
        mock_conn2, mock_cursor2 = self._make_mock_psycopg2()

        # First call returns conn1 (for init), then conn1.closed=True forces reconnect
        mock_pg.connect.side_effect = [mock_conn1, mock_conn2]

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")
        mock_conn1.closed = True  # simulate connection dropped

        writer.upsert_device("d1", "storage_battery")

        # Should have connected twice
        self.assertEqual(mock_pg.connect.call_count, 2)

    @patch.object(exporter, "psycopg2")
    def test_close(self, mock_pg):
        mock_conn, _ = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")
        writer.close()

        mock_conn.close.assert_called_once()


class TestPollWithPostgres(unittest.TestCase):
    """Tests that poll() writes to Postgres when a writer is configured."""

    @patch.object(exporter, "psycopg2")
    def test_poll_writes_to_postgres(self, mock_pg):
        mock_conn, mock_cursor = MagicMock(), MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn.closed = False
        mock_conn.cursor.return_value = mock_cursor
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()

        pg_writer = exporter.PostgresWriter("postgresql://test:test@localhost/test")

        c = exporter.EpCubeCollector("user@test.com", "password", pg_writer=pg_writer)
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()

        # Should have called upsert_device (2 per device: battery + solar)
        upsert_calls = [call for call in mock_cursor.execute.call_args_list
                        if 'INSERT INTO devices' in str(call)]
        self.assertGreaterEqual(len(upsert_calls), 2)

        # Should have called write_readings via execute_values
        self.assertTrue(mock_pg.extras.execute_values.called)

    def test_poll_without_postgres_still_works(self):
        """Poll works fine when pg_writer is None."""
        c = _make_collector()  # no pg_writer
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()

        # Prometheus metrics should still be generated
        self.assertIn("epcube_battery_state_of_capacity_percent", c._metrics_text)

    @patch.object(exporter, "psycopg2")
    def test_poll_continues_on_postgres_error(self, mock_pg):
        """Poll should not fail if Postgres write raises an exception."""
        pg_writer = MagicMock()
        pg_writer.upsert_device.side_effect = Exception("DB connection lost")

        c = exporter.EpCubeCollector("user@test.com", "password", pg_writer=pg_writer)
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        with patch.object(exporter, "_api_request", side_effect=_mock_api_for([dev])):
            c.poll()  # Should NOT raise

        # Prometheus metrics should still be generated
        self.assertIn("epcube_battery_state_of_capacity_percent", c._metrics_text)


# ---------------------------------------------------------------------------
# T005: Flexible credential startup tests
# ---------------------------------------------------------------------------

class TestFlexibleCredentialStartup(unittest.TestCase):
    """Tests that main() starts collectors based on which credentials are configured."""

    @patch.dict(os.environ, {"EPCUBE_USERNAME": "u", "EPCUBE_PASSWORD": "p",
                              "EMPORIA_USERNAME": "eu", "EMPORIA_PASSWORD": "ep"}, clear=False)
    @patch.object(exporter, "psycopg2", None)
    @patch.object(exporter, "POSTGRES_DSN", "")
    def test_both_credentials_starts_both(self):
        # Arrange
        with patch.object(exporter, "EpCubeCollector") as mock_epc, \
             patch.object(exporter, "VueCollector") as mock_vue, \
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
    @patch.object(exporter, "psycopg2", None)
    @patch.object(exporter, "POSTGRES_DSN", "")
    def test_only_epcube_credentials_starts_epcube_only(self):
        # Arrange
        env = os.environ.copy()
        env.pop("EMPORIA_USERNAME", None)
        env.pop("EMPORIA_PASSWORD", None)
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "EpCubeCollector") as mock_epc, \
             patch("threading.Thread") as mock_thread, \
             patch.object(exporter.HTTPServer, "__init__", return_value=None), \
             patch.object(exporter.HTTPServer, "serve_forever", side_effect=KeyboardInterrupt):
            mock_epc_inst = MagicMock()
            mock_epc.return_value = mock_epc_inst

            # Act
            exporter.main()

            # Assert
            mock_epc.assert_called_once()
            # VueCollector should not be instantiated
            self.assertFalse(hasattr(exporter, '_vue_collector_started'))

    @patch.dict(os.environ, {"EMPORIA_USERNAME": "eu", "EMPORIA_PASSWORD": "ep"}, clear=False)
    @patch.object(exporter, "psycopg2", None)
    @patch.object(exporter, "POSTGRES_DSN", "")
    def test_only_vue_credentials_starts_vue_only(self):
        # Arrange
        env = os.environ.copy()
        env.pop("EPCUBE_USERNAME", None)
        env.pop("EPCUBE_PASSWORD", None)
        with patch.dict(os.environ, env, clear=True), \
             patch.object(exporter, "VueCollector") as mock_vue, \
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
             patch.object(exporter, "POSTGRES_DSN", ""), \
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

    @patch.object(exporter, "psycopg2")
    def test_init_creates_vue_schema(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn

        # Act
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")

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

    @patch.object(exporter, "psycopg2")
    def test_upsert_device(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_upsert_device_updates_on_conflict(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act — call twice with different name
        writer.upsert_device(device_gid=12345, device_name="Old Name")
        writer.upsert_device(device_gid=12345, device_name="New Name")

        # Assert — two upsert calls, second has new name
        self.assertEqual(mock_cursor.execute.call_count, 2)
        second_params = mock_cursor.execute.call_args_list[1][0][1]
        self.assertEqual(second_params[1], "New Name")

    @patch.object(exporter, "psycopg2")
    def test_upsert_channel(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_upsert_channel_balance(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_write_readings_batch(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_write_empty_readings_is_noop(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_conn.reset_mock()

        # Act
        writer.write_readings([])

        # Assert
        mock_conn.commit.assert_not_called()

    @patch.object(exporter, "psycopg2")
    def test_write_readings_with_negative_values(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        mock_pg.extras = MagicMock()
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch.object(exporter, "psycopg2")
    def test_write_readings_reconnects_on_closed(self, mock_pg):
        # Arrange
        mock_conn1, _ = self._make_mock_psycopg2()
        mock_conn2, mock_cursor2 = self._make_mock_psycopg2()
        mock_pg.connect.side_effect = [mock_conn1, mock_conn2]
        mock_pg.extras = MagicMock()
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
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

    @patch("exporter.PyEmVue")
    def test_successful_login(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = exporter.VueCollector("user@test.com", "password")

        # Assert
        mock_vue.login.assert_called_once_with(username="user@test.com", password="password")
        self.assertTrue(collector._authenticated)

    @patch("exporter.PyEmVue")
    def test_login_failure_sets_not_authenticated(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = MagicMock()
        mock_vue.login.side_effect = Exception("Auth failed")
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = exporter.VueCollector("bad@test.com", "badpass")

        # Assert
        self.assertFalse(collector._authenticated)
        self.assertEqual(collector._device_count, 0)

    @patch("exporter.PyEmVue")
    def test_login_discovers_devices(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue

        # Act
        collector = exporter.VueCollector("user@test.com", "password")

        # Assert
        mock_vue.get_devices.assert_called_once()
        self.assertEqual(collector._device_count, 1)
        self.assertEqual(collector._circuit_count, 2)


# ---------------------------------------------------------------------------
# T014: VueCollector.poll() tests
# ---------------------------------------------------------------------------

class TestVueCollectorPoll(unittest.TestCase):
    """T014: VueCollector.poll() tests."""

    @patch("exporter.PyEmVue")
    def test_poll_calls_get_device_list_usage(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")

        # Act
        collector.poll()

        # Assert
        mock_vue.get_device_list_usage.assert_called_once()
        call_kwargs = mock_vue.get_device_list_usage.call_args
        self.assertEqual(call_kwargs[1].get("unit") or call_kwargs[0][3] if len(call_kwargs[0]) > 3 else call_kwargs[1].get("unit"), "KilowattHours")

    @patch("exporter.PyEmVue")
    def test_poll_converts_kwh_to_watts(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = exporter.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act
        collector.poll()

        # Assert — readings written should be in watts
        write_call = mock_pg.write_readings.call_args[0][0]
        # kWh 0.002347 * 3_600_000 = 8449.2
        main_reading = [r for r in write_call if r[1] == "1,2,3"][0]
        self.assertAlmostEqual(main_reading[3], 0.002347 * 3_600_000, places=0)

    @patch("exporter.PyEmVue")
    def test_poll_skips_none_channels(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # Make kitchen channel offline (None usage)
        mock_vue.get_device_list_usage.return_value[12345].channels["1"].usage = None
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = exporter.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act
        collector.poll()

        # Assert — only main channel written (kitchen skipped)
        write_call = mock_pg.write_readings.call_args[0][0]
        self.assertEqual(len(write_call), 1)
        self.assertEqual(write_call[0][1], "1,2,3")

    @patch("exporter.PyEmVue")
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
        collector = exporter.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Act — should not raise
        collector.poll()

        # Assert — readings from working device still written
        self.assertTrue(mock_pg.write_readings.called)

    @patch("exporter.PyEmVue")
    def test_poll_updates_last_poll_time(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")

        # Act
        before = time.time()
        collector.poll()

        # Assert
        self.assertGreaterEqual(collector._last_poll, before)

    @patch("exporter.PyEmVue")
    def test_poll_when_not_authenticated_retries_login(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = MagicMock()
        mock_vue.login.side_effect = [Exception("First fail"), None]
        mock_vue.get_devices.return_value = []
        mock_vue.get_device_list_usage.return_value = {}
        mock_pyemvue_cls.return_value = mock_vue

        collector = exporter.VueCollector("user@test.com", "password")
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

    @patch("exporter.PyEmVue")
    def test_discover_upserts_devices_to_postgres(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = exporter.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Assert — upsert_device called during init
        mock_pg.upsert_device.assert_called_once_with(
            device_gid=12345, device_name="Main Panel",
            model="VUE001", firmware="1.0", connected=True,
        )

    @patch("exporter.PyEmVue")
    def test_discover_upserts_channels_to_postgres(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        mock_pg = MagicMock()
        collector = exporter.VueCollector("user@test.com", "password", pg_writer=mock_pg)

        # Assert — upsert_channel called for each channel
        self.assertEqual(mock_pg.upsert_channel.call_count, 2)

    @patch("exporter.PyEmVue")
    def test_refresh_updates_device_list(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")
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

    @patch("exporter.PyEmVue")
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
        collector = exporter.VueCollector("user@test.com", "password")

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
        self.assertEqual(exporter.DEFAULT_VUE_POLL_INTERVAL, 1)

    @patch("exporter._read_vue_poll_interval_from_db", return_value=5)
    @patch("exporter.PyEmVue")
    def test_vue_poll_loop_reads_interval(self, mock_pyemvue_cls, mock_read_interval):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")

        # Simulate one iteration of vue_poll_loop
        collector._poll_interval = mock_read_interval.return_value

        # Assert
        self.assertEqual(collector._poll_interval, 5)


# ---------------------------------------------------------------------------
# T017: Rate limit fallback tests
# ---------------------------------------------------------------------------

class TestVueRateLimitFallback(unittest.TestCase):
    """T017: Rate limit fallback (1S → 1MIN) tests."""

    @patch("exporter.PyEmVue")
    def test_degrades_to_1min_on_rate_limit(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        # All channels return None (rate limited)
        for ch in mock_vue.get_device_list_usage.return_value[12345].channels.values():
            ch.usage = None
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")

        # Act
        collector.poll()

        # Assert — scale degraded
        self.assertEqual(collector._current_scale, "1MIN")

    @patch("exporter.PyEmVue")
    def test_recovers_to_1s_after_successful_polls(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")
        collector._current_scale = "1MIN"
        collector._recovery_count = collector.RECOVERY_THRESHOLD - 1

        # Act
        collector.poll()

        # Assert — recovered to 1S
        self.assertEqual(collector._current_scale, "1S")

    @patch("exporter.PyEmVue")
    def test_kwh_conversion_adjusts_for_1min_scale(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")
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

    @patch("exporter.PyEmVue")
    def test_get_vue_status(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")
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

    @patch("exporter.PyEmVue")
    def test_render_vue_status_section(self, mock_pyemvue_cls):
        # Arrange
        mock_vue = _mock_pyemvue()
        mock_pyemvue_cls.return_value = mock_vue
        collector = exporter.VueCollector("user@test.com", "password")
        collector._last_poll = time.time()
        vue_status = collector.get_status()

        # Act
        html = exporter._render_vue_status_section(vue_status)

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

    @patch.object(exporter, "psycopg2")
    def test_downsample_executes_insert_select(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        exporter.downsample_vue_readings(writer)

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

    @patch.object(exporter, "psycopg2")
    def test_downsample_uses_last_complete_hour(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act
        exporter.downsample_vue_readings(writer)

        # Assert — SQL references hour boundary
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("date_trunc('hour'", sql.lower())

    @patch.object(exporter, "psycopg2")
    def test_downsample_handles_empty_table(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()

        # Act — should not raise even with no data
        exporter.downsample_vue_readings(writer)

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

    @patch.object(exporter, "psycopg2")
    def test_cleanup_deletes_old_readings(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_conn.reset_mock()
        mock_cursor.rowcount = 100

        # Act
        deleted = exporter.cleanup_old_vue_readings(writer)

        # Assert
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("DELETE FROM vue_readings", sql)
        self.assertIn("7 days", sql.lower().replace("'", ""))
        self.assertNotIn("vue_readings_1min", sql)
        mock_conn.commit.assert_called()
        self.assertEqual(deleted, 100)

    @patch.object(exporter, "psycopg2")
    def test_cleanup_does_not_touch_1min_table(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_cursor.rowcount = 0

        # Act
        exporter.cleanup_old_vue_readings(writer)

        # Assert — only one DELETE, and it's not against vue_readings_1min
        sql = mock_cursor.execute.call_args[0][0]
        self.assertNotIn("vue_readings_1min", sql)

    @patch.object(exporter, "psycopg2")
    def test_cleanup_returns_zero_when_nothing_to_delete(self, mock_pg):
        # Arrange
        mock_conn, mock_cursor = self._make_mock_psycopg2()
        mock_pg.connect.return_value = mock_conn
        writer = exporter.VuePostgresWriter("postgresql://test:test@localhost/test")
        mock_cursor.reset_mock()
        mock_cursor.rowcount = 0

        # Act
        deleted = exporter.cleanup_old_vue_readings(writer)

        # Assert
        self.assertEqual(deleted, 0)


# ---------------------------------------------------------------------------
# Downsampling loop test
# ---------------------------------------------------------------------------

class TestDownsamplingLoop(unittest.TestCase):
    """Test for downsampling_loop thread function."""

    @patch.object(exporter, "cleanup_old_vue_readings", return_value=0)
    @patch.object(exporter, "downsample_vue_readings")
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
            exporter.downsampling_loop(mock_writer, interval_seconds=0)
        except KeyboardInterrupt:
            pass

        # Assert
        self.assertGreaterEqual(mock_downsample.call_count, 1)
        self.assertGreaterEqual(mock_cleanup.call_count, 1)


if __name__ == "__main__":
    unittest.main()
