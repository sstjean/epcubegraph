"""Shared configuration, constants, and utilities for the exporter."""
import logging
import math
import os
import threading
from typing import Any
from zoneinfo import ZoneInfo

_TZ = ZoneInfo("America/New_York")

# Azure Monitor telemetry (optional — only when connection string is set)
_azure_monitor_configure = None
try:
    from azure.monitor.opentelemetry import configure_azure_monitor as _azure_monitor_configure
except ImportError:
    pass


def _configure_azure_monitor():
    """Enable Azure Monitor telemetry if APPLICATIONINSIGHTS_CONNECTION_STRING is set."""
    conn_str = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
    if not conn_str or _azure_monitor_configure is None:
        return
    _azure_monitor_configure(logger_name="exporter")
    log.info("Azure Monitor telemetry enabled")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
__version__ = "2.0.0"
CLOUD_API_BASE = "https://monitoring-us.epcube.com/v1/api"
HTTP_PORT = int(os.environ.get("EPCUBE_PORT", "9250"))
POLL_INTERVAL = int(os.environ.get("EPCUBE_INTERVAL", "60"))
DEFAULT_POLL_INTERVAL = POLL_INTERVAL  # Fallback when DB has no setting
DEFAULT_DISCOVERY_INTERVAL = 3600  # Seconds between device list re-queries
DISABLE_AUTH = os.environ.get("EPCUBE_DISABLE_AUTH", "").lower() == "true"
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "")

# Entra ID auth config (only used when auth is enabled)
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_AUDIENCE = os.environ.get("AZURE_AUDIENCE", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")
AZURE_REDIRECT_URI = os.environ.get("AZURE_REDIRECT_URI", "")

# OAuth session management
_SESSION_MAX_AGE = 3600  # 1 hour
_pending_auth = {}  # state -> {code_verifier, timestamp}
_sessions = {}  # session_id -> {expires, user}
_auth_lock = threading.Lock()

log = logging.getLogger("epcube-exporter")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# ---------------------------------------------------------------------------
# PostgreSQL driver (optional)
# ---------------------------------------------------------------------------
psycopg2: Any = None

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    pass


def _safe_float(v, default=0.0):
    """Convert to float, rejecting NaN/Infinity. Returns default on failure."""
    try:
        f = float(v)
    except (ValueError, TypeError):
        return float(default)
    if math.isnan(f) or math.isinf(f):
        return float(default)
    return f


def _nz(v):
    """Normalize negative zero to positive zero."""
    return 0.0 if v == 0 else v
