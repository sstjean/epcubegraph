# EpCubeGraph — Project Summary

**Last Updated**: 2026-05-15
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `124-device-discovery`
**Last merged**: PR #136 — Refactor exporter monolith + enforce 100% coverage
**Open PR**: #137 — Test isolation refactor: every test self-contained (Phases 0–5)

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-05-15)

### Test Isolation Refactor (COMPLETE ✅)
Full history in Copilot repo memory: `test-isolation-refactor.md`

All 1,340 tests across C#, TypeScript, and Python are fully self-contained.
Zero shared fixtures, zero beforeEach/setUp, zero constructor injection.

- **Phase 0** — Preflight (commit `f76a96a`)
- **Phase 1** — Split 4 large C# test files into 20 (commits `cfffac8`→`1a6b0f4`)
- **Phase 2** — Schema extraction (commit `81dd556`)
- **Phase 3** — All 28 C# tests self-contained (commit `b3a7ceb`)
- **Phase 4** — All 30 dashboard tests self-contained (commits `f1c3b3a`, `cf868d8`)
  - Global `afterEach(cleanup)` added to `tests/setup.ts`
  - `setupMocks()` helpers in DeviceMerge, HistoricalGraph, SettingsPage
- **Phase 5** — All 115 Python tests self-contained (commit `c82fd57`)

### Feature 124: Device Discovery (IN PROGRESS — Core flow done, polish remaining)
- **Issue #134** — Automatic device discovery with hourly re-scan and device merge
- **Branch**: `124-device-discovery` (pushed, PR #137 open)
- **Spec**: Complete (4 user stories, 26 FRs, 30 clarifications, 9 edge cases)
- **Plan**: Complete
- **Tasks done**: T001–T053 plus T055–T057
- **Tasks remaining**: T054, T058, T059, T060 (removed-device toggle polish + quickstart validation)
- **Next**: Finish Phase 7 polish and run quickstart validation

### Session 2026-05-15 — Feature 124 audit + removed-device toggle progress
**Work completed:**
- Performed startup procedure and full status audit against specs/tasks/code.
- Verified test state end-to-end:
  - Exporter: 323/323 pass, `epcube_collector.py` 100% coverage
  - API: 422/422 pass (after starting Docker Desktop)
  - Dashboard: 595/595 pass, 100% coverage
- Audited `specs/124-device-discovery/tasks.md` against implementation and updated stale checkboxes:
  - Marked T015–T053 and T055–T057 complete
  - Left T054, T058, T059, T060 open
- Implemented removed-device visibility feature work in dashboard:
  - Added removed-device toggle and persistence via localStorage (`showRemovedDevices`)
  - Added removed-device rendering/styling (`device-removed`, `removed-toggle`)
  - Fetched removed devices via `fetchDevicesByStatus('removed')`
- Added/updated component tests for removed-device toggle behavior and hardened selectors to avoid ambiguous label matches.
- Verified `CurrentReadings` component suite: 34/34 passing.

**Working tree at shutdown (uncommitted):**
- `dashboard/src/app.css`
- `dashboard/src/components/CurrentReadings.tsx`
- `dashboard/tests/component/CurrentReadings.test.tsx`
- `specs/124-device-discovery/tasks.md`

### Session 2026-05-12 — Test isolation refactor complete + push + PR
**Commits made (3 new, all on `124-device-discovery`):**
1. `f1c3b3a` — Commit 5 previously-done dashboard unit test files
2. `cf868d8` — Phase 4 complete: remove all beforeEach/afterEach from 18 dashboard files
3. `c82fd57` — Phase 5 complete: inline setUp into 115 Python test methods

**Key decisions:**
- `@testing-library/preact` does NOT auto-cleanup — added global `afterEach(cleanup)` in `tests/setup.ts`
- Complex mock setup extracted to `setupMocks()` helpers (DeviceMerge, HistoricalGraph, SettingsPage)
- Python setUp inlined via script for 115 methods across 2 classes

**Branch pushed + PR opened:**
- PR #137 — Test isolation refactor: every test self-contained (Phases 0–5)
- 15 commits total on `124-device-discovery`, all pushed

### PR #136 — Exporter Refactor (MERGED ✅)
- Issue #135 closed — see prior session entry below.

### Production Outage — PostgreSQL Auto-Stop (UNRESOLVED)
- See Copilot repo memory `postgres-auto-stop-runbook.md`

### Staging Environments
- `b123-def`: Destroy workflow triggered (run #25572637307) — verify completion
- `b093-exp`: Destroy workflow triggered (run #25588799137) — verify completion

### Tests
- Dashboard: 595 tests, 100% all metrics
- API: 422 tests, 100% line + 100% branch (self-contained; Testcontainers per test)
- Exporter: 323 tests, 100% coverage
- **Total: 1340 tests**

### Open Issues
| # | Title | Label | Status |
|---|-------|-------|--------|
| 134 | Automatic device discovery | feature | In progress (PR #137 open, Phases 1–2 done) |
| 115 | Separate Application Insights per environment | enhancement | Open |
| 66 | Calendar-aware time range selector | enhancement | Open |
| 52 | Port exporter Python→C# | enhancement | Open |
| 6 | iPad App | feature | Spec only |
| 5 | iPhone App | feature | Spec only |

### What's Next
1. **Merge PR #137** after CI passes
2. **Complete remaining Feature 124 polish** — T054/T058/T059 and validate T060
3. **Run full dashboard suite after final polish** (`npm run test:coverage`) and re-run API/exporter checks if needed
4. **Manual end-to-end test against real account** (device discovery):
   - Restart exporter container: `docker compose -f local/docker-compose.prod-local.yml restart epcube-exporter`
   - Verify cross-cycle alias detection inserts pending replacement
  - Verify banner + merge UI work end-to-end
  - Verify removed-device toggle behavior and persistence

### Pending
- PR #137 — awaiting CI + review
- Staging destroy for b123-def (run #25572637307) — check completion
- Staging destroy for b093-exp (run #25588799137) — check completion
- Local uncommitted dashboard/spec changes from 2026-05-15 session (toggle + tasks sync)

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
