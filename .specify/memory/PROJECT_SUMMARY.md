# EpCubeGraph — Project Summary

**Last Updated**: 2026-05-10
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `124-device-discovery`
**Last merged**: PR #136 — Refactor exporter monolith + enforce 100% coverage
**Unpushed commits**: 3 on `124-device-discovery` (spec + Phase 1+2 + docs); plus large uncommitted working tree

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-05-10)

### Feature 124: Device Discovery (IN PROGRESS — Phase 6 functional + bugfixes)
- **Issue #134** — Automatic device discovery with hourly re-scan and device merge
- **Branch**: `124-device-discovery`
- **Spec**: Complete (4 user stories, 26 FRs, 30 clarifications, 9 edge cases)
- **Plan**: Complete
- **Phase 1–6**: Complete (schema, models, settings, US1 add detection, US2 remove detection, pending replacements, merge UI, banner, cross-cycle alias detection)
- **Next**: Manual end-to-end test against real account, then commit + push

### Session 2026-05-10 — Multi-bug fixes + isolation refactor
**Bugs fixed**
1. Merge SQL: `vue_device_mapping` update used invalid `::text` cast on jsonb column AND wrong column name `updated_at` (actual: `last_modified`). Fixed in `PostgresMetricsStore.ExecuteMergeAsync`.
2. Merge semantics: cutoff approach (`>= MIN(new_device_timestamp)`) — drop old rows after the new device starts reporting; transfer everything if no overlap. CTE-based implementation with 3 new integration tests in `MergeStoreCutoffTests.cs`.
3. Merge target dropdown showed every active device. Fixed by filtering to `pendingMatches` from `pending_replacements` (falls back to all activeGroups when no pending exist).
4. Auto-select fired for fallback path. Fixed: only when `pendingMatches.length === 1 && suggestedTargets.length === 1`.
5. Banner not appearing on Current page first load: same-cycle add+remove never fired because real-world replacement spanned multiple discovery cycles.
   - **Fix (Option 1)**: Cross-cycle alias-based detection. New `PostgresWriter.find_replacement_candidate(old_raw_cloud_id)` queries removed device's alias + `created_at`, finds most recent active `epcubeN_battery` device sharing alias registered later. `_discover_devices` tracks `same_cycle_pairs`; for any removed device not paired in-cycle, calls `find_replacement_candidate` and inserts pending row when found.
6. **Test isolation violation** (caught + fixed): `TestConfigPsycopg2Import.test_psycopg2_imported_when_available` reloaded `config`, which rebound `_sessions`/`_pending_auth`/`_auth_lock`. `http_handler` retained references to the *original* objects, so subsequent session tests wrote to a different dict than the handler read. Caused `test_session_cookie_grants_access` to fail (401) only when run after that reload test.
   - **Fix**: Moved session state (`_SESSION_MAX_AGE`, `_pending_auth`, `_sessions`, `_auth_lock`) from `config.py` to `http_handler.py` where it's used; removed `threading` import from `config.py`.
   - **Isolation refactor**: All session/pending tests now `patch.object(http_handler, "_sessions", {})` etc. so each test owns its own dict + lock — every test fully self-contained, copy-paste portable.

**New end-to-end UX additions**
- `created_at` field exposed via API (`DeviceInfo`) and dashboard (`Device.created_at`)
- DeviceMerge UI shows "(id={cloudId}, added {date})" in both source and target dropdowns
- Pending replacements fetched alongside devices; auto-selects target when there's exactly one pending match

**Test results (post-isolation refactor)**
- Exporter: **323 tests, 100% coverage** (all 7 modules)
- API: 422/422 (prior to today's session — needs re-run of integration tests with current schema)
- Dashboard: 593/593 (prior to today's session)

**Files touched (uncommitted)**
- `api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs` (ILogger injection earlier)
- `api/src/EpCubeGraph.Api/Models/Models.cs` (added `CreatedAt`)
- `api/src/EpCubeGraph.Api/Services/IMetricsStore.cs`, `PostgresMetricsStore.cs` (cutoff merge, SQL bug fixes, created_at)
- `api/tests/EpCubeGraph.Api.Tests/Fixtures/MockableTestFactory.cs`, `PostgresFixture.cs` (status column, pending_replacements table, ClearDataAsync)
- `api/tests/EpCubeGraph.Api.Tests/Integration/MergeEndpointTests.cs`, `MergeStoreCutoffTests.cs`, `PendingReplacementEndpointTests.cs` (new)
- `dashboard/src/{App.tsx,api.ts,types.ts,components/{SettingsPage.tsx,DeviceMerge.tsx,ReplacementBanner.tsx},hooks/useDeviceDiscovery.ts}` (UI integration)
- `dashboard/tests/{component/{App,SettingsPage,DeviceMerge,ReplacementBanner}.test.tsx,unit/{api,useDeviceDiscovery}.test.ts}` (coverage)
- `local/epcube-exporter/{config.py,db.py,epcube_collector.py,http_handler.py,test_exporter.py}` (cross-cycle detection + session state move)

### PR #136 — Exporter Refactor (MERGED ✅)
- Issue #135 closed — see prior session entry below.

### Production Outage — PostgreSQL Auto-Stop (UNRESOLVED)
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
1. **Manual end-to-end test against real account**:
   - Restart exporter container: `docker compose -f local/docker-compose.prod-local.yml restart epcube-exporter`
   - On next discovery cycle, cross-cycle alias detection should insert pending row for old EP Cube → new EP Cube (alias "Steve St Jean 3")
   - Or short-circuit: `INSERT INTO pending_replacements (old_device_id, new_device_id) VALUES ('5488', '5840');`
   - Verify banner appears on Current page first load; verify merge dropdown shows only the pending target with `(added <date>)`
2. Re-run API integration tests (`dotnet test`) and dashboard tests (`npm run test:coverage`) to confirm no regressions from today's changes
3. Commit + push `124-device-discovery` (3 unpushed commits + large working tree)
4. Open PR for review
5. Then resume remaining Phase 7 polish tasks per `specs/124-device-discovery/tasks.md`

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
