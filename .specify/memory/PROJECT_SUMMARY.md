# EpCubeGraph — Project Summary

**Last Updated**: 2026-05-11
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `124-device-discovery`
**Last merged**: PR #136 — Refactor exporter monolith + enforce 100% coverage
**Unpushed commits**: 10 on `124-device-discovery`; plus 5 uncommitted dashboard test files

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-05-11)

### Test Isolation Refactor (IN PROGRESS — C# complete, Dashboard/Python partial)
Full plan stored in Copilot repo memory: `test-isolation-refactor.md`

**Completed phases:**
- **Phase 0** — Preflight: reverted bulk AAA comments, added mock resets, xunit parallel config, vitest clearMocks/unstubEnvs/unstubGlobals, pytest-xdist (commit `f76a96a`)
- **Phase 1** — Split 4 large C# test files into 20 smaller files (commits `cfffac8`→`1a6b0f4`)
- **Phase 2** — Extracted `TestSchema.Ddl` constant + `CreateContainerAsync()` helper (commit `81dd556`)
- **Phase 3** — All 28 C# test files refactored: zero IClassFixture, zero constructor injection, zero IDisposable. Each test constructs its own factory/container inline. 422/422 pass in 29s (commit `b3a7ceb`)
- **Phase 4 (partial)** — 5 dashboard unit test files refactored (beforeEach removed, passing 595/595, uncommitted): auth, errors, polling, retry, telemetry. 7 more unit test files were already self-contained.

**Remaining work:**
- **Phase 4 (remaining)** — 18 dashboard test files still have beforeEach/afterEach:
  - 4 unit: api, useDeviceDiscovery, useVueData, main
  - 14 component: App, CircuitsPage, CurrentReadings, DeviceCard, DeviceMerge, EnergyFlowDiagram, ErrorBoundary, GaugeDial, GridEnergySummary, HistoricalGraph, HistoryView, ReplacementBanner, SettingsPage, TimeRangeSelector
- **Phase 5** — 2 Python setUp methods (TestHTTPHandler line 608, TestHandleCallbackFull line 3915)
- **Phase 6** — Final verification + cleanup (delete unused fixtures if unreferenced)

### Feature 124: Device Discovery (IN PROGRESS — Phase 6 functional + bugfixes)
- **Issue #134** — Automatic device discovery with hourly re-scan and device merge
- **Branch**: `124-device-discovery`
- **Spec**: Complete (4 user stories, 26 FRs, 30 clarifications, 9 edge cases)
- **Plan**: Complete
- **Phase 1–6**: Complete (schema, models, settings, US1 add detection, US2 remove detection, pending replacements, merge UI, banner, cross-cycle alias detection)
- **Next**: Manual end-to-end test against real account, then commit + push

### Session 2026-05-11 — Test isolation refactor (Phases 0–3 + Phase 4 partial)
**Commits made (7 new, all on `124-device-discovery`):**
1. `f76a96a` — Phase 0: revert AAA, add mock resets, parallel config
2. `cfffac8` — Split ValidateTests.cs → 6 files (74 tests)
3. `f34defc` — Split ModelSerializationTests.cs → 4 files (31 tests)
4. `205e215` — Split EndpointTests.cs → 7 files (46 tests: 2+6+11+8+7+8+4)
5. `1a6b0f4` — Split SettingsEndpointTests.cs → 3 files (41 tests: 28+8+5)
6. `81dd556` — Extract TestSchema.Ddl + CreateContainerAsync()
7. `b3a7ceb` — All 28 C# test files → self-contained (zero shared fixtures)

**Key decisions:**
- Copy-paste-portable = no shared fixtures, no constructor injection, no beforeEach/setUp
- Accepted 29s C# runtime (up from 6s) — isolation > speed per constitution
- TestSchema.CreateContainerAsync() is the only shared helper (static, stateless, creates fresh container)
- PostgresFixture seed helpers replaced with static helpers per test class
- vitest.config.ts clearMocks/unstubEnvs/unstubGlobals kept as defense-in-depth

**Test counts (verified):**
- C#: 422/422 (29s)
- Dashboard: 595/595 (2s)
- Python: 323/323 (2s)
- **Total: 1340 tests**

**Uncommitted files:**
- `dashboard/tests/unit/{auth,errors,polling,retry,telemetry}.test.ts` (5 files, beforeEach removed)

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
1. **Complete test isolation refactor** (see `/memories/repo/test-isolation-refactor.md` for full plan):
   - Commit the 5 done dashboard files
   - Refactor 18 remaining dashboard test files (Phase 4)
   - Refactor 2 Python setUp methods (Phase 5)
   - Final verification + cleanup (Phase 6)
2. **Manual end-to-end test against real account** (device discovery):
   - Restart exporter container: `docker compose -f local/docker-compose.prod-local.yml restart epcube-exporter`
   - Verify cross-cycle alias detection inserts pending replacement
   - Verify banner + merge UI work end-to-end
3. Commit + push `124-device-discovery` (10 unpushed commits + working tree)
4. Open PR for review

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
