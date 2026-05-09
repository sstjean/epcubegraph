"""HTTP request handler and debug page rendering for the exporter."""
import base64
import hashlib
import hmac
import html
import json
import secrets
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

from config import (
    DISABLE_AUTH, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_AUDIENCE,
    AZURE_CLIENT_SECRET, AZURE_REDIRECT_URI,
    _SESSION_MAX_AGE, _pending_auth, _sessions, _auth_lock,
    DEFAULT_POLL_INTERVAL, log, __version__, _nz,
)


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

def _sign_session(session_id):
    """HMAC-sign a session ID using the client secret."""
    sig = hmac.new(AZURE_CLIENT_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    return f"{session_id}.{sig}"


def _verify_session_cookie(cookie_value):
    """Verify and return session_id from a signed cookie, or None."""
    if not cookie_value or "." not in cookie_value:
        return None
    session_id, sig = cookie_value.rsplit(".", 1)
    expected = hmac.new(AZURE_CLIENT_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    with _auth_lock:
        session = _sessions.get(session_id)
    if not session or session["expires"] < time.time():
        return None
    return session_id


def _cleanup_expired():
    """Remove expired sessions and stale auth states."""
    now = time.time()
    with _auth_lock:
        for sid in [k for k, v in _sessions.items() if v["expires"] < now]:
            del _sessions[sid]
        for st in [k for k, v in _pending_auth.items() if v["timestamp"] < now - 600]:
            del _pending_auth[st]


# ---------------------------------------------------------------------------
# Debug page rendering
# ---------------------------------------------------------------------------

def _render_status_page(status, health):
    """Render a minimal HTML debug page showing last 10 minutes of values."""
    uptime_m = status["uptime_s"] // 60
    uptime_h = uptime_m // 60
    uptime_str = f"{uptime_h}h {uptime_m % 60}m {status['uptime_s'] % 60}s"
    poll_interval = status.get("poll_interval", DEFAULT_POLL_INTERVAL)
    next_poll_at = status.get("next_poll_at", 0)
    next_in = max(0, int(next_poll_at - time.time())) if next_poll_at else None
    next_str = f"{next_in}s" if next_in is not None else "waiting"

    # Build per-device tables from history
    history = status["history"]

    # Collect all unique device names/ids seen across history
    device_order = []
    device_seen = set()
    for snap in history:
        for dev in snap["devices"]:
            key = dev["id"]
            if key not in device_seen:
                device_seen.add(key)
                device_order.append((key, html.escape(dev["name"])))
    device_order.sort(key=lambda d: d[0])

    if not history or not device_order:
        tables_html = '<p style="color:#888">No data yet — waiting for first poll</p>'
    else:
        tables = []
        for dev_id, dev_name in device_order:
            rows = []
            for snap in history:  # oldest first
                for dev in snap["devices"]:
                    if dev["id"] != dev_id:
                        continue
                    battery_kw = _nz(float(dev.get("battery_kw", 0)))
                    grid_kw = _nz(float(dev.get("grid_kw", 0)))
                    solar_kw = _nz(float(dev["solar_kw"]))
                    load = _nz(float(dev["backup_kw"]))
                    expected_battery = solar_kw + grid_kw - load
                    imbalance = abs(expected_battery - battery_kw)
                    row_cls = ' class="imbalance"' if load > 0 and imbalance > 0.5 else ''
                    warn_td = f' title="Expected battery {expected_battery:+.2f} kW ≠ Actual {battery_kw:+.2f} kW"' if load > 0 and imbalance > 0.5 else ''
                    fmt_bat = f"{battery_kw:+.2f}" if battery_kw != 0 else "0.00"
                    fmt_grid = f"{grid_kw:+.2f}" if grid_kw != 0 else "0.00"
                    # Battery: green=charging(+), red=discharging(-)
                    bat_cls = ' class="val-pos"' if battery_kw > 0 else (' class="val-neg"' if battery_kw < 0 else '')
                    # Grid: green=export(-), red=import(+)
                    grid_cls = ' class="val-neg"' if grid_kw > 0 else (' class="val-pos"' if grid_kw < 0 else '')
                    rows.append(
                        f'<tr{row_cls}>'
                        f'<td class="utctime" data-utc="{snap["time"]}">{snap["time"]}</td>'
                        f'<td style="text-align:right">{solar_kw:.2f}</td>'
                        f'<td style="text-align:right"{bat_cls}>{fmt_bat}</td>'
                        f'<td style="text-align:right"{grid_cls}>{fmt_grid}</td>'
                        f'<td style="text-align:right"{warn_td}>{load:.2f}{" ⚠" if row_cls else ""}</td>'
                        f'<td style="text-align:right">{dev["battery_soc"]:.0f}%</td>'
                        f'<td style="text-align:right">{dev.get("self_sufficiency", 0):.0f}%</td>'
                        f'<td class="section-divider" style="text-align:right">{dev.get("solar_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_import_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("grid_export_kwh", 0):.1f}</td>'
                        f'<td style="text-align:right">{dev.get("bat_peak_kwh", dev.get("bat_stored_kwh", 0)):.1f}</td>'
                        f'</tr>'
                    )
            row_html = "\n".join(rows) if rows else '<tr><td colspan="11" style="text-align:center;color:#888">No data</td></tr>'
            # Get latest snapshot values for this device
            latest_status = "?"
            latest_backup_kwh = 0.0
            latest_bat_stored = 0.0
            latest_ress = "?"
            for snap in reversed(history):
                for dev in snap["devices"]:
                    if dev["id"] == dev_id:
                        latest_status = dev.get("system_status", "?")
                        latest_backup_kwh = dev.get("backup_kwh", 0.0)
                        latest_bat_stored = dev.get("bat_stored_kwh", 0.0)
                        latest_ress = dev.get("ress_count", "?")
                        break
                else:
                    continue
                break
            tables.append(
                f'<h2 style="color:#00d4aa;font-size:1em;margin:1.5em 0 0.5em">{dev_name}'
                f' <span class="badge">EP Cube &middot; {latest_ress}x</span>'
                f' <span class="badge">Status: {latest_status}</span>'
                f' <span class="badge">Battery level: {latest_bat_stored:.1f} kWh</span>'
                f' <span class="badge">Home Supply (total): {latest_backup_kwh:.1f} kWh</span>'
                f'</h2>\n'
                f'<table>\n'
                f'<tr class="section-header">'
                f'<th></th>'
                f'<th colspan="6" class="section-instant">Current Activity</th>'
                f'<th colspan="4" class="section-daily section-divider">Daily Totals</th>'
                f'</tr>\n<tr>'
                f'<th>Time</th><th>Solar kW</th><th>Battery kW</th><th>Grid kW</th>'
                f'<th>Load kW</th><th>SoC</th><th>Self-Suff</th>'
                f'<th class="section-divider">Solar kWh</th><th>Grid In kWh</th><th>Grid Out kWh</th><th>Bat Peak kWh</th>'
                f'</tr>\n{row_html}\n</table>'
            )
        tables_html = "\n".join(tables)

    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>epcube-exporter status</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }}
  h1 {{ color: #00d4aa; font-size: 1.3em; }}
  .info {{ display: flex; gap: 2em; margin-bottom: 1.5em; font-size: 0.9em; }}
  .info span {{ background: #16213e; padding: 0.4em 0.8em; border-radius: 4px; }}
  .info .ok {{ color: #00d4aa; }}
  .info .warn {{ color: #ffc107; }}
  .badge {{ font-size: 0.75em; background: #16213e; color: #aaa; padding: 0.2em 0.6em; border-radius: 4px; margin-left: 1.2em; vertical-align: middle; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.85em; margin-bottom: 0.5em; }}
  th, td {{ padding: 0.5em 0.8em; border: 1px solid #2a2a4a; }}
  th {{ background: #16213e; text-align: left; position: sticky; top: 0; }}
  .section-header th {{ text-align: center; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 2px solid #2a2a4a; }}
  .section-instant {{ color: #00d4aa; }}
  .section-daily {{ color: #ffc107; }}
  .section-divider {{ border-left: 3px solid #444; }}
  tr.imbalance {{ background: #3a2000; }}
  tr.imbalance:hover {{ background: #4a2800; }}
  tr:hover {{ background: #16213e; }}
  .val-pos {{ color: #00d4aa; }}
  .val-neg {{ color: #e74c3c; }}
  .footer {{ margin-top: 1.5em; font-size: 0.8em; color: #666; }}
  .nav {{ font-size: 0.85em; margin-bottom: 0.5em; color: #666; }}
  .nav a {{ color: #00d4aa; text-decoration: none; }}
  .nav a:hover {{ text-decoration: underline; }}
</style>
</head><body>
<div class="nav"><a href="/vue">Emporia Vue</a> &middot; <a href="/health">/health</a></div>
<h1>&#9889; epcube-exporter — debug status
<span style="font-size:0.6em;background:{'#00d4aa' if health['healthy'] else '#e74c3c'};color:#fff;padding:0.2em 0.7em;border-radius:12px;margin-left:0.8em;vertical-align:middle">{'&#10003; healthy' if health['healthy'] else '&#10007; ' + ', '.join(health['checks'])}</span>
</h1>
<div class="info">
  <span>Version: <b>{status["version"]}</b></span>
  <span>Uptime: <b>{uptime_str}</b></span>
  <span>Polls: <b>{status["poll_count"]}</b></span>
  <span class="{'warn' if status['poll_errors'] else 'ok'}">Errors: <b>{status["poll_errors"]}</b></span>
  <span>Devices: <b>{status["devices"]}</b></span>
  <span>Poll interval: <b>{poll_interval}s</b></span>
  <span>Next poll in: <b id="countdown" data-next="{next_poll_at}">{next_str}</b></span>
</div>
{tables_html}
<script>
function convertTimes() {{
  document.querySelectorAll('.utctime').forEach(el => {{
    const d = new Date(el.dataset.utc);
    el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', hour12: true}});
  }});
}}
convertTimes();

// Countdown timer — ticks every second, reads target from data-next attribute
// so it survives innerHTML replacement from auto-refresh.
setInterval(() => {{
  const el = document.getElementById('countdown');
  if (!el) return;
  const nextAt = parseFloat(el.dataset.next);
  if (!nextAt) return;
  const left = Math.max(0, Math.round(nextAt - Date.now() / 1000));
  el.textContent = left + 's';
}}, 1000);

// Background auto-refresh: fetches new HTML and swaps body content in-place.
// No full page reload = no focus stealing.
setInterval(async () => {{
  try {{
    const resp = await fetch(location.href);
    if (!resp.ok) return;
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    convertTimes();
  }} catch (e) {{}}
}}, {poll_interval * 1000});
</script>
<div class="footer">Auto-refreshes every {poll_interval}s &middot; Last 10 polls (~10 min)</div>
</body></html>"""


def _render_vue_debug_page(vue_status):
    """Render a full HTML debug page for Vue collector status with per-circuit data."""
    if not vue_status:
        return """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Emporia Vue — not configured</title>
<style>body { font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }
a { color: #00d4aa; }</style>
</head><body>
<p><a href="/status">&larr; EP Cube Status</a></p>
<h1>Emporia Vue</h1>
<p>Vue polling is not configured. Set EMPORIA_USERNAME and EMPORIA_PASSWORD to enable.</p>
</body></html>"""

    last_poll = vue_status["last_poll"]
    if last_poll > 0:
        last_poll_ts = last_poll * 1000  # JS timestamp in ms
        last_poll_str = f'<span class="localtime" data-ts="{last_poll_ts}">loading...</span>'
        ago = int(time.time() - last_poll)
        last_poll_str += f" ({ago}s ago)"
    else:
        last_poll_str = "never"

    next_poll_at = vue_status.get("next_poll_at", 0)
    next_in = max(0, int(next_poll_at - time.time())) if next_poll_at else None
    next_str = f"{next_in}s" if next_in is not None else "waiting"

    # Build per-device sections with circuit tables
    readings = vue_status.get("last_readings", {})
    channel_names = vue_status.get("channel_names", {})
    devices_html = ""

    for dev in vue_status.get("devices", []):
        gid = dev["device_gid"]
        status_cls = "val-pos" if dev.get("connected") else "val-neg"
        status_txt = "online" if dev.get("connected") else "offline"

        # Gather circuits for this device, sorted by channel_num
        circuits = []
        for (d_gid, ch_num), watts in readings.items():
            if d_gid == gid:
                name = channel_names.get((d_gid, ch_num), "")
                circuits.append((ch_num, name, watts))

        # Sort: mains first, then numeric channels, then text channels
        def _sort_key(c):
            ch = c[0]
            if ch == "1,2,3":
                return (0, "")
            if ch == "Balance":
                return (2, "")
            try:
                return (1, int(ch))
            except ValueError:
                return (1, 999)
        circuits.sort(key=_sort_key)

        rows = ""
        for ch_num, name, watts in circuits:
            display_name = html.escape(name if name else ch_num)
            ch_num_escaped = html.escape(str(ch_num))
            if watts >= 1000:
                watts_str = f"{watts / 1000:.1f} kW"
            else:
                watts_str = f"{watts:.0f} W"
            row_cls = ' class="val-pos"' if watts > 0 else ""
            rows += f"<tr><td>{ch_num_escaped}</td><td>{display_name}</td><td style='text-align:right'{row_cls}>{watts_str}</td></tr>\n"

        if not rows:
            rows = '<tr><td colspan="3" style="color:#888">No readings yet</td></tr>'

        dev_name_escaped = html.escape(dev['name'])
        devices_html += f"""
        <div style="margin-bottom:1.5em">
        <h3>{dev_name_escaped} <span class="badge {status_cls}">{status_txt}</span>
            <span class="badge" style="color:#888">GID: {gid}</span></h3>
        <table>
        <tr><th>Channel</th><th>Circuit</th><th style="text-align:right">Power</th></tr>
        {rows}
        </table>
        </div>
        """

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Emporia Vue — debug status</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }}
  h1 {{ color: #00d4aa; font-size: 1.3em; }}
  h3 {{ color: #e0e0e0; margin-bottom: 0.3em; }}
  a {{ color: #00d4aa; }}
  .info {{ display: flex; gap: 2em; margin-bottom: 1.5em; font-size: 0.9em; flex-wrap: wrap; }}
  .info span {{ background: #16213e; padding: 0.4em 0.8em; border-radius: 4px; }}
  .badge {{ font-size: 0.75em; background: #16213e; padding: 0.2em 0.6em; border-radius: 4px; margin-left: 0.5em; vertical-align: middle; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.85em; margin-bottom: 0.5em; }}
  th, td {{ padding: 0.4em 0.8em; border: 1px solid #2a2a4a; }}
  th {{ background: #16213e; text-align: left; }}
  tr:hover {{ background: #16213e; }}
  .val-pos {{ color: #00d4aa; }}
  .val-neg {{ color: #e74c3c; }}
  .footer {{ margin-top: 1.5em; font-size: 0.8em; color: #666; }}
  .nav {{ font-size: 0.85em; margin-bottom: 0.5em; color: #666; }}
  .nav a {{ color: #00d4aa; text-decoration: none; }}
  .nav a:hover {{ text-decoration: underline; }}
</style>
</head><body>
<div class="nav"><a href="/status">&larr; EP Cube Status</a> &middot; <a href="/health">/health</a></div>
<h1>&#9889; Emporia Vue — debug status</h1>
<div class="info">
  <span>Devices: <b>{vue_status["device_count"]}</b></span>
  <span>Circuits: <b>{vue_status["circuit_count"]}</b></span>
  <span>Scale: <b>{vue_status["current_scale"]}</b></span>
  <span>Poll interval: <b>{vue_status["poll_interval"]}s</b></span>
  <span>Last poll: <b>{last_poll_str}</b></span>
  <span>Next poll in: <b id="countdown" data-next="{next_poll_at}">{next_str}</b></span>
  <span>Errors: <b>{vue_status["poll_errors"]}</b> total, <b>{vue_status["consecutive_errors"]}</b> consecutive</span>
</div>
{devices_html}
<script>
// Convert timestamps to local time
document.querySelectorAll('.localtime').forEach(el => {{
  const ts = parseFloat(el.dataset.ts);
  if (!ts) return;
  const d = new Date(ts);
  el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true}});
}});

// Countdown timer
setInterval(() => {{
  const el = document.getElementById('countdown');
  if (!el) return;
  const nextAt = parseFloat(el.dataset.next);
  if (!nextAt) return;
  const left = Math.max(0, Math.round(nextAt - Date.now() / 1000));
  el.textContent = left + 's';
}}, 1000);

// Auto-refresh every 5 seconds (Vue polls at 1s, page refreshes at 5s)
setInterval(async () => {{
  try {{
    const resp = await fetch(location.href);
    if (!resp.ok) return;
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    document.querySelectorAll('.localtime').forEach(el => {{
      const ts = parseFloat(el.dataset.ts);
      if (!ts) return;
      const d = new Date(ts);
      el.textContent = d.toLocaleDateString([], {{month: 'short', day: 'numeric'}}) + ' ' + d.toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true}});
    }});
  }} catch (e) {{}}
}}, 5000);
</script>
<div class="footer">Auto-refreshes every 5s</div>
</body></html>"""


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class ExporterHandler(BaseHTTPRequestHandler):
    collector = None  # Set by main (EpCubeCollector or None)
    vue_collector = None  # Set by main (VueCollector or None)
    _jwks_client = None  # Lazily initialized

    def _get_cookie(self, name):
        """Extract a named cookie value from the Cookie header."""
        cookie_header = self.headers.get("Cookie", "")
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith(f"{name}="):
                return part[len(name) + 1:]
        return None

    def _is_browser(self):
        """Heuristic: request came from a browser (Accept contains text/html)."""
        accept = self.headers.get("Accept", "")
        return "text/html" in accept

    def _check_auth(self):
        """Validate auth via session cookie or JWT Bearer token.

        For browser requests without auth, redirects to /login.
        For API requests without auth, returns 401 JSON.
        Returns True if authorized, False if rejected (response already sent).
        """
        if DISABLE_AUTH:
            return True

        # Check session cookie first (browser flow)
        session_cookie = self._get_cookie("_session")
        if _verify_session_cookie(session_cookie):
            return True

        # Check Bearer token (API flow)
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                import jwt
                if ExporterHandler._jwks_client is None:
                    jwks_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
                    ExporterHandler._jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True)

                signing_key = ExporterHandler._jwks_client.get_signing_key_from_jwt(token)
                jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    audience=AZURE_AUDIENCE,
                    issuer=f"https://sts.windows.net/{AZURE_TENANT_ID}/",
                )
                return True
            except Exception as e:
                log.warning("JWT validation failed: %s", e)
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Bearer realm="epcube-exporter", error="invalid_token"')
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Invalid or expired token"}).encode())
                return False

        # No valid auth — redirect browsers to login, return 401 for API clients
        if self._is_browser() and AZURE_REDIRECT_URI:
            self.send_response(302)
            self.send_header("Location", "/login")
            self.end_headers()
            return False

        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Bearer realm="epcube-exporter"')
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Missing or invalid Authorization header"}).encode())
        return False

    def _handle_login(self):
        """Start OAuth 2.0 Authorization Code flow with PKCE."""
        if not AZURE_REDIRECT_URI or not AZURE_CLIENT_ID:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OAuth not configured")
            return

        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        ).rstrip(b"=").decode()

        _cleanup_expired()
        with _auth_lock:
            _pending_auth[state] = {
                "code_verifier": code_verifier,
                "timestamp": time.time(),
            }

        params = urllib.parse.urlencode({
            "client_id": AZURE_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": AZURE_REDIRECT_URI,
            "scope": f"{AZURE_AUDIENCE}/user_impersonation openid",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        })
        authorize_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/authorize?{params}"

        self.send_response(302)
        self.send_header("Location", authorize_url)
        self.end_headers()

    def _handle_callback(self):
        """Handle OAuth 2.0 callback — exchange code for tokens, create session."""
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        error = qs.get("error", [None])[0]
        if error:
            desc = qs.get("error_description", [error])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Authentication failed: {desc}".encode())
            return

        code = qs.get("code", [None])[0]
        state = qs.get("state", [None])[0]
        if not code or not state:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Missing code or state parameter")
            return

        with _auth_lock:
            pending = _pending_auth.pop(state, None)
        if not pending:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Invalid or expired state parameter")
            return

        # Exchange authorization code for tokens
        token_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token"
        token_data = urllib.parse.urlencode({
            "client_id": AZURE_CLIENT_ID,
            "client_secret": AZURE_CLIENT_SECRET,
            "code": code,
            "redirect_uri": AZURE_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": pending["code_verifier"],
        }).encode()

        try:
            req = urllib.request.Request(token_url, data=token_data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(req, timeout=10) as resp:
                token_resp = json.loads(resp.read())
        except Exception as e:
            log.error("Token exchange failed: %s", e)
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Token exchange failed")
            return

        # Validate the access token (proves the user is authorized)
        access_token = token_resp.get("access_token", "")
        try:
            import jwt as pyjwt
            if ExporterHandler._jwks_client is None:
                jwks_url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
                ExporterHandler._jwks_client = pyjwt.PyJWKClient(jwks_url, cache_keys=True)

            signing_key = ExporterHandler._jwks_client.get_signing_key_from_jwt(access_token)
            claims = pyjwt.decode(
                access_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=AZURE_AUDIENCE,
                issuer=f"https://sts.windows.net/{AZURE_TENANT_ID}/",
            )
            user = claims.get("preferred_username", claims.get("sub", "unknown"))
        except Exception as e:
            log.warning("Access token validation failed: %s", e)
            self.send_response(401)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Access token validation failed")
            return

        # Create session
        session_id = secrets.token_urlsafe(32)
        with _auth_lock:
            _sessions[session_id] = {
                "expires": time.time() + _SESSION_MAX_AGE,
                "user": user,
            }

        signed = _sign_session(session_id)
        self.send_response(302)
        self.send_header("Set-Cookie", f"_session={signed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={_SESSION_MAX_AGE}")
        self.send_header("Location", "/status")
        self.end_headers()

    def do_GET(self):
        if self.path == "/login":
            self._handle_login()
            return
        if self.path.startswith("/.auth/callback"):
            self._handle_callback()
            return
        if self.path == "/health":
            if self.collector:
                health = self.collector.get_health()
            else:
                health = {"healthy": True, "checks": []}
            if health["healthy"]:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode())
            else:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "unhealthy", "reasons": health["checks"]}).encode())
        elif self.path == "/" or self.path == "/status":
            if not self._check_auth():
                return
            if self.collector:
                status = self.collector.get_status()
                health = self.collector.get_health()
                body = _render_status_page(status, health).encode()
            else:
                body = b"""<!DOCTYPE html><html><head><meta charset="utf-8">
                <title>epcube-exporter status</title>
                <style>body { font-family: -apple-system, system-ui, sans-serif; margin: 2em; background: #1a1a2e; color: #e0e0e0; }
                a { color: #00d4aa; }</style>
                </head><body>
                <p><a href="/vue">Emporia Vue Status</a></p>
                <h1>epcube-exporter</h1>
                <p>EP Cube collector: disabled</p>
                </body></html>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/vue":
            if not self._check_auth():
                return
            vue_status = self.vue_collector.get_status() if self.vue_collector else None
            body = _render_vue_debug_page(vue_status).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress per-request logging
