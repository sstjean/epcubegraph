# Implementation Plan: Emporia Vue Energy Monitoring Integration

**Branch**: `005-emporia-vue` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-emporia-vue/spec.md`

## Summary

Integrate Emporia Vue energy monitors into EpCubeGraph to provide circuit-level power visibility across a split-phase 300A service. The exporter gains a second polling loop (PyEmVue → PostgreSQL, requesting Watts directly), the API gains Vue-specific endpoints with query-time deduplication and smart auto-resolution (8 tiers targeting ~2K points per channel). Dashboard visualization is handled by Feature 007. Data is stored as raw watts in new `vue_readings` and `vue_channels` tables alongside `vue_devices`, using the same PostgreSQL instance. Credentials are flexible — the exporter runs whichever collector(s) have credentials configured.

## Technical Context

**Language/Version**: Python 3.12 (exporter), C# / .NET 10 (API), TypeScript 5.8 / Preact 10.x (dashboard)
**Primary Dependencies**: PyEmVue (exporter), Npgsql (API), uPlot (dashboard), psycopg2 (exporter)
**Storage**: PostgreSQL 17 (existing instance — same `epcubegraph` database)
**Testing**: pytest (exporter — 100 tests), xUnit + Testcontainers (API — 215 tests), Vitest (dashboard — 328 tests)
**Target Platform**: Azure Container Apps (exporter + API), Azure Static Web Apps (dashboard)
**Project Type**: Full-stack feature addition across exporter / API / dashboard
**Performance Goals**: API <500ms for current readings, <2s for 30-day historical; 1-second poll interval for Vue data
**Constraints**: Single API call per poll cycle (`get_device_list_usage`), `max_retry_attempts=1` to avoid blocking 1s loop, request Watts directly (no kWh conversion)
**Scale/Scope**: ~4 Vue devices (split-phase 300A, no single device at entry), ~60 circuits, 1-second data for 7 days then downsampled to 1-minute averages. Total home = sum of top-level panel mains.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Post-Design | Notes |
|-----------|--------|-------------|-------|
| Simplicity | ✅ PASS | ✅ PASS | Extends existing exporter/API/dashboard — no new services. 4 new tables follow existing patterns. |
| YAGNI | ✅ PASS | ✅ PASS | Vue-specific retention/downsampling. No TimescaleDB, no pg_cron, no 1-hour aggregation tier (anticipated optimization deferred). |
| TDD (100% coverage) | ✅ PASS | ✅ PASS | All new code requires tests first; CI gate enforced |
| Branching (`005-emporia-vue`) | ✅ PASS | ✅ PASS | Branch exists |
| CI Gate | ✅ PASS | ✅ PASS | Existing pipeline covers all components |
| Local Type-Checking Parity | ✅ PASS | ✅ PASS | `npm run typecheck`, `dotnet build` already exist |
| Test Data Separation | ✅ PASS | ✅ PASS | Tests use mocks/synthetic; live data for manual testing only |
| Azure-first | ✅ PASS | ✅ PASS | All deployment targets Azure services |
| Zero-trust / Auth | ✅ PASS | ✅ PASS | Vue endpoints under `/api/v1/vue/*` use same Entra ID auth |
| Secrets Management | ✅ PASS | ✅ PASS | Vue credentials via Key Vault secrets → Container App env vars |
| IaC | ✅ PASS | ✅ PASS | Terraform updates for Vue secrets, env vars in Container App |
| Environment Parity | ✅ PASS | ✅ PASS | Same arch in staging/production; Docker Compose mirrors Azure |
| Containerization | ✅ PASS | ✅ PASS | Vue polling adds to existing exporter container (second thread) |
| Storage Efficiency | ✅ PASS | ✅ PASS | Time-keyed indexes on `vue_readings`, 7-day retention + downsampling prevents unbounded growth |
| Performance (API <500ms) | ✅ PASS | ✅ PASS | Indexes support efficient latest-reading and range queries |

**GATE RESULT: PASS** — No violations pre- or post-design.

## Project Structure

### Documentation (this feature)

```text
specs/005-emporia-vue/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-v1-vue.md    # Vue-specific API endpoints
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
local/epcube-exporter/
├── exporter.py              # Add Vue polling loop (PyEmVue integration)
├── test_exporter.py         # Add Vue-specific tests
├── Dockerfile               # Add pyemvue dependency
└── requirements.txt         # New — pin all dependencies

api/src/EpCubeGraph.Api/
├── Endpoints/
│   └── VueEndpoints.cs      # New — Vue device/circuit/readings endpoints
├── Services/
│   ├── IVueStore.cs          # New — Vue data access interface
│   └── PostgresVueStore.cs   # New — Vue PostgreSQL queries + deduplication
├── Models/
│   └── Vue.cs                # New — Vue request/response models

api/tests/EpCubeGraph.Api.Tests/
├── Unit/
│   └── VueEndpointsTests.cs  # New — Vue endpoint unit tests
└── Integration/
    └── VueStoreTests.cs      # New — Vue store integration tests (Testcontainers)

infra/
└── container-apps.tf         # Add Vue env vars to exporter container
```

**Structure Decision**: This feature extends the exporter and API in their established locations. No new top-level directories or services. The Vue exporter shares the existing epcube-exporter process (single container, second thread). Dashboard visualization is handled by Feature 007 (Dashboard Vue Circuit Display). Credentials are flexible — either or both collector credential sets may be provided.

## Complexity Tracking

No constitution violations to justify.
