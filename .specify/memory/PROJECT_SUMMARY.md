# EpCubeGraph — Project Summary

**Last Updated**: 2026-05-03
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `main`
**Last merged**: PR #132 — Defense-in-depth: NaN/HTML/concurrency + _tablesCreated race + SWA config fix
**Unpushed commits**: none

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-05-03)

### PR #132 — Defense-in-Depth (MERGED ✅)
- **Issue #123 closed** — NaN/HTML/concurrency hardening across exporter and API
- Exporter: `_safe_float()` rejects NaN/Infinity → 0; used in metric parsing + stale detection
- Exporter: HTML-escapes device names in status page (XSS prevention)
- Exporter: lock-guarded `_polling` flag prevents overlapping polls (both EpCube and Vue collectors)
- API: `SemaphoreSlim` + double-check locking on `EnsureTablesAsync` prevents concurrent DDL
- API: `PostgresSettingsStore` implements `IDisposable` to dispose the `SemaphoreSlim`
- API: integration tests split into self-contained per-concern files (no shared state between test classes)
- Dashboard: moved `staticwebapp.config.json` to `public/` so Vite includes it in `dist/` — fixes 404 on SPA route refresh
- TDD: 17 new exporter tests (185 total), 1 new API integration test (392 total)
- Net: 19 files changed, 1462 insertions, 967 deletions

### Production Outage — PostgreSQL Auto-Stop (UNRESOLVED)
- **2026-04-15 05:11 UTC**: `MCAPSGov-AutomationApp` stopped PostgreSQL while exporter was actively writing
- See Copilot repo memory `postgres-auto-stop-runbook.md` for debugging steps
- **Open**: recurrence unknown, no exemption mechanism identified yet

### Tests
- Dashboard: 544 tests, 100% all metrics (stmts/branches/funcs/lines)
- API: 392 tests, 100% line + 100% branch
- Exporter: 185 tests
- **Total: 1121 tests**

### Open Issues
| # | Title | Label |
|---|-------|-------|
| 115 | Separate Application Insights per environment | enhancement |
| 74 | Custom domains on devsbx.xyz | — |
| 66 | Calendar-aware time range selector | enhancement |
| 52 | Port exporter Python→C# | enhancement |
| 6 | iPad App | feature (spec only) |
| 5 | iPhone App | feature (spec only) |

### Closed This Session
| # | Title | Reason |
|---|-------|--------|
| 123 | Defense-in-depth: exporter NaN/HTML/concurrency + _tablesCreated race | completed (PR #132 merged) |

### What's Next
1. Check CD deploy to main succeeded — verify production is healthy
2. Destroy staging using the GitHub Actions workflow (resources from PR #132)
3. Delete `123-defense-in-depth` branch (remote + local)
4. #115 Separate Application Insights per environment
5. #113 Panel Hierarchy UI editor
6. Monitor coverlet-coverage/coverlet#1904 — upgrade coverlet to 10.x when fix ships
7. Monitor Terraform 1.15.x — verify empty-string partial backend config continues to work

### Pending
- CD deploy to main running — check status next session

### Decisions Made This Session
- `staticwebapp.config.json` must live in `dashboard/public/` (not `dashboard/`) so Vite copies it to `dist/` during build — without this, SWA navigation fallback is not deployed and SPA route refreshes return 404
- Integration test classes must be fully self-contained — no shared state between test classes

### Production Services
| Service | URL |
|---------|-----|
| Dashboard | https://epcube.devsbx.xyz |
| API | https://epcube-api.devsbx.xyz/api/v1/health |
| Exporter debug | https://epcube-debug.devsbx.xyz |

### Shared Infrastructure
| Resource | Repo |
|----------|------|
| Azure DNS zone (devsbx.xyz) | sstjean/devsbx-common |
| tfstate storage | tfstateepcubegraph in tfstate-rg |

---

## Executive Summary

**EpCubeGraph** is a personal energy monitoring system for Canadian Solar EP Cube solar/battery gateways. Collects telemetry from EP Cube devices via cloud API, stores in PostgreSQL, exposes through a web dashboard and REST API. Constitution mandates TDD (100% coverage), zero warnings in CI/CD, Azure-first deployment, and semantic architecture.

---

## Architecture

### System Flow

1. **Ingest**: epcube-exporter polls EP Cube cloud API (monitoring-us.epcube.com), writes directly to PostgreSQL
2. **Store**: PostgreSQL 17 (local Docker Compose); Azure Database for PostgreSQL Flexible Server (Azure). Indefinite retention.
3. **Serve**: ASP.NET Core Minimal API queries PostgreSQL via Npgsql. Entra ID JWT auth + `user_impersonation` scope. Clean JSON responses.
4. **Visualize**: Preact SPA on Azure Static Web Apps. MSAL.js PKCE auth. uPlot charting.

### Key Design Decisions

- **Background threads**: All daemon thread loops MUST wrap the entire body in try/except with logging. No code outside the try block (including DB reads, `time.sleep()`). Always log thread startup.
- **epcube-exporter**: Python daemon, AJ-Captcha block puzzle solver, polls every 60s, writes to PostgreSQL via psycopg2
- **PostgreSQL**: All time-series storage. Exporter writes directly. API queries via Npgsql + NpgsqlDataSource connection pooling. Integration tests use Testcontainers.PostgreSql.
- **API**: ASP.NET Core Minimal API. Entra ID JWT + `user_impersonation` scope. **Local port: 5062**.
- **Dashboard**: Preact (3KB) + uPlot + MSAL.js (PKCE). Auto-polls API every 30s.

### API Endpoints (`/api/v1`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | No | Datastore health check |
| `GET /readings/current?metric={name}` | Yes | Latest reading per device |
| `GET /readings/range?metric={name}&start=&end=&step=` | Yes | Bucketed time-series |
| `GET /devices` | Yes | Device inventory |
| `GET /devices/{device}/metrics` | Yes | Metrics for one device |
| `GET /grid?start=&end=&step=` | Yes | Grid power time-series |
| `GET /settings` | Yes | All settings key-value pairs |
| `PUT /settings/{key}` | Yes | Update setting (allowlisted keys only) |
| `GET /settings/hierarchy` | Yes | Panel hierarchy entries |
| `PUT /settings/hierarchy` | Yes | Replace hierarchy (cycle detection) |
| `GET /settings/display-names` | Yes | Display name overrides |
| `PUT /settings/display-names/{deviceGid}` | Yes | Update display names for device |
| `DELETE /settings/display-names/{deviceGid}/{channel}` | Yes | Clear display name override |

---

## Feature Status

### Feature 001: Data Ingestor (COMPLETE ✅)
### Feature 002: Web Dashboard (COMPLETE ✅)
### Feature 005: Emporia Vue (COMPLETE ✅, PR #95)
### Feature 006: Dashboard Settings Page (COMPLETE ✅, PR #90)
### Feature 007: Dashboard Vue Circuits (COMPLETE ✅, PR #108)
### Feature 010: Simplify Vue Mapping (COMPLETE ✅, PR #124)
### Feature 003: iPhone App (SPEC ONLY)
### Feature 004: iPad App (SPEC ONLY)

---

## Tech Stack

| Layer | Component | Version |
|-------|-----------|---------|
| Ingestion | epcube-exporter (Python) | 3.12 |
| Storage | PostgreSQL | 17-alpine (local) / Flexible Server (Azure) |
| API | .NET SDK | 10.0 |
| API DB | Npgsql | 9.0.3 |
| Dashboard | Preact | 10.x |
| Build | Vite | 5.x |
| Charting | uPlot | 1.6.32 |
| Auth (browser) | MSAL.js | @azure/msal-browser |
| Auth (API) | Microsoft.Identity.Web | Latest |
| Testing (API) | xUnit + Testcontainers.PostgreSql | 4.3.0 |
| Testing (Dashboard) | Vitest | 3.x |
| Azure | Container Apps, PostgreSQL Flex, SWA, Key Vault, VNet |
| IaC | Terraform | 1.5+ |
| CI/CD | GitHub Actions | — |

---

## Key File Locations

| Purpose | Path |
|---------|------|
| API | `api/src/EpCubeGraph.Api/` |
| API Tests | `api/tests/EpCubeGraph.Api.Tests/` |
| Dashboard | `dashboard/src/` |
| Dashboard Tests | `dashboard/tests/` |
| Exporter | `local/epcube-exporter/` |
| Infrastructure | `infra/` |
| CI/CD | `.github/workflows/` |
| Specs | `specs/` |
| Constitution | `.specify/memory/constitution.md` |
| Session Procedures | `.specify/memory/session-procedures.md` |

---

## References

- **Constitution**: `.specify/memory/constitution.md`
- **Session Procedures**: `.specify/memory/session-procedures.md`
- **Data Model**: `specs/001-data-ingestor/data-model.md`
- **API Contract**: `specs/001-data-ingestor/contracts/api-v1.md`
- **Dashboard Config**: `specs/002-web-dashboard/contracts/dashboard-config.md`
- **Research**: `specs/*/research.md`
- **Quickstarts**: `specs/*/quickstart.md`
