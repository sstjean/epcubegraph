"""Tests for epcube-exporter."""
import collections
import json
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
        """Verify the actual poll method calculates bat_net_kwh correctly."""
        c = _make_collector()
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        elec_data = _make_electricity_data(
            solarElectricity=10.0,
            gridElectricityFrom=5.0,
            gridElectricityTo=2.0,
            backUpElectricity=8.0,
        )

        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for([dev], elec_data=elec_data)):
            c.poll()

        # bat_net = 10 + 5 - 8 - 2 = 5.0
        snap = c._history[-1]
        device_snap = snap["devices"][0]
        self.assertEqual(device_snap["bat_net_kwh"], 5.0)

    def test_period_delta_second_poll(self):
        """Second poll updates bat_net_kwh to reflect new cumulative total."""
        c = _make_collector()
        dev = _make_device()
        c._devices = [dev]
        c._token = "fake-token"

        # First poll: bat_net = 10 + 5 - 8 - 2 = 5.0
        elec1 = _make_electricity_data(
            solarElectricity=10.0,
            gridElectricityFrom=5.0,
            gridElectricityTo=2.0,
            backUpElectricity=8.0,
        )
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for([dev], elec_data=elec1)):
            c.poll()

        c._history[-1]["time_minute"] = "old"  # force new snapshot

        # Second poll: bat_net = 12 + 6 - 9 - 2 = 7.0
        elec2 = _make_electricity_data(
            solarElectricity=12.0,
            gridElectricityFrom=6.0,
            gridElectricityTo=2.0,
            backUpElectricity=9.0,
        )
        with patch.object(exporter, "_api_request",
                          side_effect=_mock_api_for([dev], elec_data=elec2)):
            c.poll()

        snap = c._history[-1]
        self.assertEqual(snap["devices"][0]["bat_net_kwh"], 7.0)


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
                "ress_count": 2,
                "solar_kwh": 12.5,
                "grid_import_kwh": 3.0,
                "grid_export_kwh": 1.5,
                "backup_kwh": 10.0,
                "bat_net_kwh": 4.0,
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
        self.assertIn("Instantaneous", html)
        self.assertIn("Daily Totals", html)
        self.assertIn("section-instant", html)
        self.assertIn("section-daily", html)

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

    def test_auto_refresh_meta(self):
        html = exporter._render_status_page(self._make_status(), self._make_health())
        self.assertIn('http-equiv="refresh"', html)

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
                "backup_kwh": 0, "bat_net_kwh": 0,
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
        self.assertAlmostEqual(d["battery_kw"], 0)
        self.assertAlmostEqual(d["grid_kw"], 0)
        self.assertAlmostEqual(d["self_sufficiency"], 90.0)
        self.assertIn("Self-Use", d["system_status"])
        self.assertAlmostEqual(d["bat_stored_kwh"], 12.0)
        self.assertEqual(d["ress_count"], 1)
        # Daily totals
        self.assertAlmostEqual(d["solar_kwh"], 8.0)
        self.assertAlmostEqual(d["grid_import_kwh"], 2.0)
        self.assertAlmostEqual(d["grid_export_kwh"], 0.5)
        self.assertAlmostEqual(d["backup_kwh"], 6.0)
        # bat_net total = 8.0 + 2.0 - 6.0 - 0.5 = 3.5
        self.assertAlmostEqual(d["bat_net_kwh"], 3.5)

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
            "epcube_battery_net_kwh",
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


if __name__ == "__main__":
    unittest.main()
