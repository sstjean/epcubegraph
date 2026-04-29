# EpCubeGraph — Project Summary

**Last Updated**: 2026-04-28
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `main`
**Last merged**: PR #127 — Session procedures + NuGet updates + CI fix
**Unpushed commits**: none

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## ⚡ Current State (2026-04-28)

### PR #127 — Session Procedures + NuGet + CI Fix (MERGED ✅)
- New: `.specify/memory/session-procedures.md` — Start Up / Shutdown procedures
- New: `.specify/memory/PROJECT_SUMMARY.md` — moved from Copilot memory to repo for portability
- Updated: `.github/agents/copilot-instructions.md` — references session-procedures.md
- CI fix: moved `paths-ignore` from workflow-level to job-level using `dorny/paths-filter@v3`
  - Fixes docs-only PRs being blocked by required status checks (github.com/orgs/community/discussions/13690)
- NuGet packages updated to latest:
  - API: Microsoft.Identity.Web 4.8.0, Npgsql 10.0.2, Swashbuckle.AspNetCore 10.1.7
  - API: Pin OpenTelemetry.Api 1.15.3 (GHSA-g94r-2vxg-569j)
  - Tests: Microsoft.AspNetCore.Mvc.Testing 10.0.7, Microsoft.NET.Test.Sdk 18.5.1
  - Tests: Testcontainers 4.11.0, xunit.runner.visualstudio 3.1.5
  - Tests: Pin Microsoft.AspNetCore.DataProtection 10.0.7 (GHSA-9mv3-2cwr-p262)
  - Tests: coverlet.collector pinned to 8.0.1 (10.0.0 has async state machine coverage regression — coverlet-coverage/coverlet#1337, #1767, fix in PR #1904)
- PostgresFixture: adapted to Testcontainers 4.11.0 constructor change
- Zero NuGet vulnerabilities, 391 API tests pass, 100% coverage

### PR #126 — Entra ID Destroy Race Fix (MERGED ✅)
- `depends_on = [azuread_service_principal.api]` added to `azuread_application_identifier_uri.api`
- Fixes known azuread provider destroy ordering issue (hashicorp/terraform-provider-azuread#428)
- No state surgery needed — production state doesn't track this resource

### PR #125 — Public Repo Readiness (MERGED ✅)
- MIT license added
- README.md full rewrite (Mermaid architecture diagram, security, dev setup)
- Staging custom domains disabled (eliminates SWA domain lock on destroy/recreate)
- Postgres subnet `default_outbound_access_enabled = false` for SFI compliance

### Feature 010 — Simplify Vue Mapping (COMPLETE ✅, PR #124 merged)
- Mapping format: `Record<string, VuePanelMapping[]>` → `Record<string, VuePanelMapping>`
- Settings UI: multi-panel add/remove → single `<select>` dropdown
- Type guard, input validation, migration guard for old format
- SRP extractions: buildDeviceGroups, resolvePanelsFromMapping, resolveAuthHeaders, etc.
- Constitution §III SRP added (v1.19.0)
- CI/CD: PR trigger, fork protection, runner fixes, destroy error masking removed
- 544 dashboard + 391 API + 177 exporter = 1112 tests, 100% coverage

### Production Outage — PostgreSQL Auto-Stop (RESOLVED)
- **2026-04-15 05:11 UTC**: `MCAPSGov-AutomationApp` stopped PostgreSQL while exporter was actively writing
- See Copilot repo memory `postgres-auto-stop-runbook.md` for debugging steps
- **Open**: recurrence unknown, no exemption mechanism identified yet

### Feature 007 — COMPLETE (all 7 phases, merged to main, deployed to prod)
- **#108** Feature issue created and closed
- Circuits page with panel grouping, daily kWh, Balance dedup
- Flow diagram circuit overlay with Unmonitored rename + panel prefix
- Exporter daily kWh poll loop wired up (scale=1D)
- Graceful empty states with 10-failure stale data threshold
- Settings page: all polling intervals enabled
- useVueData hook, errors.ts utilities, derivePanelPrefix
- Background thread safety pattern enforced (all 4 loops)
- API Startup.GetRequiredConnectionString extracted for testability

### Tests
- Dashboard: 544 tests, 100% all metrics (stmts/branches/funcs/lines)
- API: 391 tests, 100% line + 100% branch (112/112)
- Exporter: 177 tests
- **Total: 1112 tests**

### Open Issues
| # | Title | Label |
|---|-------|-------|
| 123 | Defense-in-depth: exporter NaN/HTML/concurrency + _tablesCreated | tech-debt |
| 120 | Feature 010: Simplify Vue Device Mapping | enhancement (should be closed — PR #124 merged) |
| 115 | Separate Application Insights per environment | enhancement |
| 93 | Remove vestigial /metrics endpoint | tech-debt |
| 74 | Custom domains on devsbx.xyz | — |
| 66 | Calendar-aware time range selector | enhancement |
| 52 | Port exporter Python→C# | enhancement |
| 5 | iPhone App | feature (spec only) |
| 6 | iPad App | feature (spec only) |

### What's Next
1. Close #120 (Feature 010 merged — still open)
2. #123 Defense-in-depth: exporter NaN/HTML/concurrency + _tablesCreated
3. #93 Remove vestigial /metrics endpoint + exporter SRP (Prometheus removal)
4. #113 Panel Hierarchy UI editor
5. Monitor coverlet-coverage/coverlet#1904 — upgrade coverlet to 10.x when fix ships

### Pending
- Staging destroy running (run 25086514154) — tearing down epcubegraph-session-* resources
- Dependabot PR opened: `dependabot/npm_and_yarn/dashboard/npm_and_yarn-5f44a83626`

### Decisions Made This Session
- "Start Up" / "Shutdown" = session context procedures, not Docker
- Canonical session state lives in repo (`.specify/memory/`), not Copilot memory
- Copilot repo memory files are pointers only to in-repo canonical files
- CI `paths-ignore` moved to job-level `dorny/paths-filter` to fix docs-only PR merge blocks
- coverlet.collector pinned to 8.0.1 due to 10.0.0 async state machine regression

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
