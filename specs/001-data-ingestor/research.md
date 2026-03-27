# Research Notes: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-27

Historical pre-current-architecture research was removed from this active document. Git history remains the source of truth for retired design exploration.

## Topic 1: Storage Architecture

### Decision

Use PostgreSQL as the telemetry store in all environments.

### Rationale

- One storage model locally and in Azure
- Relational schema fits device metadata plus time-series readings cleanly
- Simple deduplication through unique constraints and upserts
- Straightforward query path from API to storage through Npgsql

### Current Shape

- Local: PostgreSQL 17 via Docker Compose
- Azure: Azure Database for PostgreSQL Flexible Server
- Runtime writes: exporter writes directly to PostgreSQL
- Runtime reads: API queries PostgreSQL directly

## Topic 2: API Contract Design

### Decision

Expose a JSON REST contract under `/api/v1` rather than a storage-native query surface.

### Rationale

- Downstream clients are first-party and benefit from stable typed payloads
- Clean response models are easier to test and document than storage-shaped payloads
- Validation stays narrow: metric name, timestamps, and step values

### Current Endpoints

- `GET /api/v1/health`
- `GET /api/v1/readings/current`
- `GET /api/v1/readings/range`
- `GET /api/v1/readings/grid`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{device}/metrics`
- `GET /api/v1/grid`

## Topic 3: Authentication and Authorization

### Decision

Protect telemetry endpoints with Microsoft Entra ID bearer-token authentication and `user_impersonation` scope enforcement.

### Rationale

- Matches the project-wide identity model
- Keeps authorization logic centralized in ASP.NET Core
- Avoids custom auth mechanisms for first-party clients

### Current Shape

- Telemetry endpoints require auth
- `/metrics` and exporter `/health` stay unauthenticated because they expose operational state only
- Exporter debug pages use browser auth in Azure and a development-only bypass locally

## Topic 4: Exporter-to-Database Write Path

### Decision

The exporter owns schema verification and uses direct PostgreSQL writes.

### Rationale

- Removes an unnecessary intermediary layer
- Keeps ingestion logic close to the source data normalization logic
- Makes failure handling and deduplication explicit in one place

### Current Shape

- `devices` upsert for metadata
- `readings` batch insert with `ON CONFLICT`
- Schema bootstrap on exporter startup

## Topic 5: Observability

### Decision

Expose operational health and metrics without exposing user telemetry.

### Rationale

- Operators need simple liveness and request telemetry checks
- The API and exporter already have clear runtime boundaries for these endpoints

### Current Shape

- API `/metrics` via `prometheus-net`
- API structured JSON logging
- Exporter `/health`
- Exporter authenticated status pages for runtime inspection
