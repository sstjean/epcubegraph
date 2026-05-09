# EpCubeGraph — Project Summary

**Last Updated**: 2026-05-08
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `124-device-discovery`
**Last merged**: PR #136 — Refactor exporter monolith + enforce 100% coverage
**Unpushed commits**: 2 on `124-device-discovery` (spec + Phase 1+2)

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-05-08)

### Feature 124: Device Discovery (IN PROGRESS 🔧)
- **Issue #134** — Automatic device discovery with hourly re-scan and device merge
- **Branch**: `124-device-discovery` (2 commits ahead of main)
- **Spec**: Complete (4 user stories, 26 FRs, 30 clarifications, 9 edge cases)
- **Plan**: Complete (research, data model, contracts, quickstart, 60 tasks)
- **Phase 1+2**: Complete (schema, models, settings, compare_device_lists, retry_with_backoff, status filter)
- **Next**: Phase 3: T015–T022 (US1 MVP — automatic new device detection)

### PR #136 — Exporter Refactor (MERGED ✅)
- **Issue #135 closed** — Refactor exporter monolith + enforce 100% coverage
- Split 2083-line `exporter.py` into 7 focused modules (config, auth, db, epcube_collector, vue_collector, http_handler, exporter)
- 262 tests, 100% coverage (was 185 tests, 79%)
- Added `pytest-cov --cov-fail-under=100` to CI
- Fixed XSS in Vue debug page (device names + circuit names)
- Fixed thread safety: `_lock` for shared state in `_discover_devices()` and `_poll_inner()`
- Dockerfile: explicit file list (excludes test_exporter.py from prod image)
- `.coveragerc`: project-wide exclusions for `if __name__` and `except ImportError`

### PR #132 — Defense-in-Depth (MERGED ✅)
- **Issue #123 closed** — NaN/HTML/concurrency hardening

### Production Outage — PostgreSQL Auto-Stop (UNRESOLVED)
- **2026-04-15 05:11 UTC**: `MCAPSGov-AutomationApp` stopped PostgreSQL
- See Copilot repo memory `postgres-auto-stop-runbook.md`

### Staging Environments
- `b123-def`: Destroy workflow triggered (run #25572637307) — verify completion
- `b093-exp`: Destroy workflow triggered (run #25588799137) — verify completion

### Tests
- Dashboard: 544 tests, 100% all metrics
- API: 401+ tests, 100% line + 100% branch (mock-based; Testcontainers need Docker)
- Exporter: 282 tests, 100% coverage
- **Total: 1227+ tests**

### Open Issues
| # | Title | Label | Status |
|---|-------|-------|--------|
| 134 | Automatic device discovery | feature | In progress (Phase 3 next) |
| 135 | Refactor exporter + coverage | enhancement | Closed (PR #136 merged) |
| 115 | Separate Application Insights per environment | enhancement | Open |
| 66 | Calendar-aware time range selector | enhancement | Open |
| 52 | Port exporter Python→C# | enhancement | Open |
| 6 | iPad App | feature | Spec only |
| 5 | iPhone App | feature | Spec only |

### Closed This Session
| # | Title | Reason |
|---|-------|--------|
| 135 | Refactor exporter + coverage | completed (PR #136 merged) |
| 74 | Custom domains on devsbx.xyz | closed (resolved before this session) |

### What's Next
1. Verify staging destroy workflows completed for b123-def and b093-exp
2. Continue feature 124 Phase 3: T015–T022 (US1 MVP — new device detection)
3. Phase 4: T023–T026 (US2 — removed device detection)
4. Phase 5–7: replacement prompts, merge, polish
5. #115 Separate Application Insights per environment
6. Monitor coverlet-coverage/coverlet#1904 — upgrade coverlet to 10.x when fix ships

### Pending
- Staging destroy for b123-def (run #25572637307) — check completion
- Staging destroy for b093-exp (run #25588799137) — check completion
- Feature branch `124-device-discovery` not yet pushed

### Decisions Made This Session
- Exporter refactored from monolith (2083 lines) to 7 modules — simplicity over facade patterns
- `if __name__ == "__main__"` excluded from coverage via `.coveragerc` (standard Python practice per coverage.py author)
- `except ImportError` excluded from coverage via `.coveragerc` (environment-dependent import paths)
- Tests import from actual modules, patch at point of use — no facade, no star imports
- XSS: all user-controlled text in debug pages must use `html.escape()` — Vue device/circuit names added
- Thread safety: all shared state mutations must hold `_lock` — _discover_devices and _poll_inner fixed
- Dockerfile: explicit file list prevents test code in production images

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
