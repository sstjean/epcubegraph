"""EP Cube Cloud Exporter entry point."""
import os
import sys
import threading
from http.server import HTTPServer

from config import (
    log, HTTP_PORT, POLL_INTERVAL, POSTGRES_DSN, DISABLE_AUTH,
    AZURE_TENANT_ID, _configure_azure_monitor, psycopg2, __version__,
)
from db import PostgresWriter, VuePostgresWriter, downsampling_loop
from epcube_collector import EpCubeCollector, poll_loop
from vue_collector import VueCollector, vue_poll_loop, vue_daily_poll_loop
from http_handler import ExporterHandler


def main():
    _configure_azure_monitor()

    epcube_username = os.environ.get("EPCUBE_USERNAME")
    epcube_password = os.environ.get("EPCUBE_PASSWORD")
    emporia_username = os.environ.get("EMPORIA_USERNAME")
    emporia_password = os.environ.get("EMPORIA_PASSWORD")

    has_epcube = bool(epcube_username and epcube_password)
    has_emporia = bool(emporia_username and emporia_password)

    if not has_epcube and not has_emporia:
        log.error("At least one credential set required: EPCUBE_USERNAME/PASSWORD or EMPORIA_USERNAME/PASSWORD")
        sys.exit(1)

    if not POSTGRES_DSN:
        log.error("POSTGRES_DSN is required — all telemetry is written to PostgreSQL")
        sys.exit(1)

    # Initialize Postgres writers
    if psycopg2 is None:
        log.error("psycopg2 is not installed")
        sys.exit(1)
    pg_writer = PostgresWriter(POSTGRES_DSN)
    vue_pg_writer = VuePostgresWriter(POSTGRES_DSN)
    log.info("PostgreSQL storage enabled: %s", POSTGRES_DSN.split("@")[-1] if "@" in POSTGRES_DSN else "(DSN)")

    # Start EP Cube collector if credentials are configured
    collector = None
    if has_epcube:
        collector = EpCubeCollector(epcube_username, epcube_password, pg_writer=pg_writer)
        collector.poll()
        poll_thread = threading.Thread(target=poll_loop, args=(collector,), daemon=True)
        poll_thread.start()
    else:
        log.warning("EPCUBE_USERNAME/PASSWORD not set — EP Cube collector disabled")

    # Start Vue collector if credentials are configured
    vue_collector = None
    if has_emporia:
        vue_collector = VueCollector(emporia_username, emporia_password, pg_writer=vue_pg_writer)
        vue_poll_thread = threading.Thread(target=vue_poll_loop, args=(vue_collector,), daemon=True)
        vue_poll_thread.start()
        ds_thread = threading.Thread(target=downsampling_loop, args=(vue_pg_writer,), daemon=True)
        ds_thread.start()
        daily_thread = threading.Thread(target=vue_daily_poll_loop, args=(vue_collector,), daemon=True)
        daily_thread.start()
    else:
        log.warning("EMPORIA_USERNAME/PASSWORD not set — Vue collector disabled")

    # Start HTTP server
    ExporterHandler.collector = collector
    ExporterHandler.vue_collector = vue_collector
    server = HTTPServer(("0.0.0.0", HTTP_PORT), ExporterHandler)
    log.info("Serving on :%d (poll interval: %ds)", HTTP_PORT, POLL_INTERVAL)
    if DISABLE_AUTH:
        log.info("Auth DISABLED — debug page is unauthenticated (local dev mode)")
    else:
        log.info("Auth ENABLED — debug page requires Entra ID JWT (tenant=%s)", AZURE_TENANT_ID)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")


if __name__ == "__main__":
    main()
