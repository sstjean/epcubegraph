# Research: Remove Vestigial /metrics Endpoint

**Feature**: 093-remove-vestigial-metrics
**Date**: 2026-04-29

## Research Summary

This is a code removal / tech-debt cleanup task. No new technologies, libraries, or architectural decisions are needed. All research items below were resolved by reading the existing codebase.

## Findings

### 1. Who consumes /metrics?

- **Decision**: Nobody. The endpoint has zero consumers.
- **Rationale**: VictoriaMetrics and vmagent were removed from the stack. No monitoring system scrapes `/metrics`. The validation scripts (`validate-deployment.sh`, `deploy.sh`) check the endpoint exists but don't consume the data — they are self-referential validation of dead code.
- **Alternatives considered**: Keep `/metrics` for future monitoring → rejected per Constitution §II YAGNI.

### 2. What does the mock-exporter's /metrics serve?

- **Decision**: Remove it. The mock-exporter's only real purpose is `_pg_write_loop()` writing synthetic data to PostgreSQL. The `_generate_metrics()` function (~130 lines) and `/metrics` handler are dead code.
- **Rationale**: No service in `docker-compose.local.yml` scrapes the mock-exporter's `/metrics`. Constitution §II: "Code that exists without a covering requirement MUST be removed."
- **Alternatives considered**: Keep mock `/metrics` for debugging → rejected; debug data is in PostgreSQL and the debug UI.

### 3. Is deploy-local.sh used?

- **Decision**: Delete it. The file only references itself (self-documenting usage comments). No CI workflow, script, or documentation references it. Its `--query` and `--seed` commands call VictoriaMetrics APIs that no longer exist in the compose stack.
- **Rationale**: Dead code with no consumer, references removed services.
- **Alternatives considered**: Rewrite to work with PostgreSQL → rejected per §II YAGNI; `deploy.sh` already handles the prod-local stack.

### 4. Should METRICS_PORT be renamed?

- **Decision**: Rename to `HTTP_PORT`. The port serves `/health`, `/status`, `/vue` — not metrics.
- **Rationale**: The name "METRICS_PORT" implies Prometheus metrics serving. Constitution §I Simplicity — naming should reflect actual purpose.
- **Alternatives considered**: Keep the name → misleads future readers about the port's purpose.

### 5. Scope of Prometheus/VictoriaMetrics reference purge

- **Decision**: Full purge across all file types. 16 files identified by `grep -ri` across `.py`, `.sh`, `.tf`, `.cs`, `.yml`, `.md`.
- **Rationale**: Partial removal leaves confusing references that imply the system still uses monitoring tools it doesn't.
- **Alternatives considered**: Only purge code files, leave specs as historical record → rejected; specs should reflect current architecture reality.
