# Implementation Plan: Dashboard Vue Circuit Display

**Branch**: `007-dashboard-vue-circuits` | **Date**: 2026-04-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-dashboard-vue-circuits/spec.md`

## Summary

Display Emporia Vue circuit-level power data in the EP Cube dashboard: (1) active circuits inline on flow diagram cards mapped to each EP Cube via a configurable `vue_device_mapping` setting, (2) a dedicated Circuits page showing all circuits grouped by panel with current watts and daily kWh, (3) a Settings page mapping editor for assigning Vue panels to EP Cube devices. Requires new `vue_readings_daily` table written by the exporter, two new bulk API endpoints, and Settings API allowlist extension.

## Technical Context

**Language/Version**: TypeScript 5.8 / Preact 10.x (dashboard), C# / .NET 10 (API), Python 3.12 (exporter)
**Primary Dependencies**: Preact, preact-router, uPlot (dashboard); ASP.NET Core Minimal API, Npgsql (API); PyEmVue, psycopg2 (exporter)
**Storage**: PostgreSQL 17 — existing `epcubegraph` database. New table: `vue_readings_daily`. New settings keys: `vue_device_mapping`, `vue_daily_poll_interval_seconds`
**Testing**: Vitest + @testing-library/preact (dashboard, 100% coverage), xUnit + PostgreSQL test container (API, 100% coverage), pytest (exporter, 100% coverage)
**Target Platform**: Web browser (dashboard SPA), Azure Container Apps (API + exporter)
**Project Type**: Full-stack web application (SPA + REST API + data exporter)
**Performance Goals**: Flow card circuit list renders within 2s of page load (SC-001). Circuits page renders within 2s (SC-006). 1-second Vue data refresh cadence.
**Constraints**: 100% test coverage CI gate. TDD required. No suppression flags.
**Scale/Scope**: ~4 Vue devices, ~64 channels, 1 new page, 1 component enhancement, 2 new API endpoints, 1 new DB table, Settings page extension

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ PASS | Flat circuit lists, no nested UI, no abstractions beyond what's needed |
| II. YAGNI | ✅ PASS | Only implements what the spec requires — no pagination, no charts, no grouping in flow cards |
| III. TDD | ✅ PASS | TDD for all new components, API endpoints, and exporter changes. 100% coverage enforced. |
| III. AAA pattern | ✅ PASS | All tests follow Arrange-Act-Assert |
| III. Test data separation | ✅ PASS | Mock/synthetic data in tests. Live data for manual verification only. |
| III. 100% coverage | ✅ PASS | Dashboard (Vitest), API (xUnit + coverlet), Exporter (pytest + coverage) |
| Development Workflow | ✅ PASS | Feature branch `007-dashboard-vue-circuits`, atomic commits |
| Local Type-Checking Parity | ✅ PASS | `npm run typecheck` (dashboard), `dotnet build` (API) |
| Performance: 2s render | ✅ PASS | Bulk endpoints minimize round trips. Single call for all Vue current data. |
| Performance: 500ms responsiveness | ✅ PASS | Async polling, no blocking. Vue data on separate 1s interval. |
| Platform: Azure hosting | ✅ PASS | No new infrastructure — uses existing Container Apps + PostgreSQL |
| Security: Auth required | ✅ PASS | All new API endpoints behind existing RequireAuthorization() |
| Security: Input validation | ✅ PASS | `vue_device_mapping` validated server-side (JSON structure, no duplicate GIDs) |
| DevOps: CI gate | ✅ PASS | All tests run in CI, 100% coverage enforced |

### Post-Design Re-check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ PASS | `vue_readings_daily` is one flat table. Bulk endpoints return simple arrays. No new abstractions. |
| II. YAGNI | ✅ PASS | Daily kWh table only — no hourly aggregations, no chart endpoints. Mapping editor is simple dropdowns. |
| III. TDD | ✅ PASS | Test plan covers all components across 3 codebases |
| Security: `vue_device_mapping` | ✅ PASS | Server validates JSON structure and detects duplicate GID assignments |

## Project Structure

### Documentation (this feature)

```text
specs/007-dashboard-vue-circuits/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-v1-vue-circuits.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (changes to existing structure)

```text
api/
├── src/EpCubeGraph.Api/
│   ├── Endpoints/
│   │   ├── VueEndpoints.cs          # Add bulk current + daily endpoints
│   │   └── SettingsEndpoints.cs     # Extend allowlist with vue_device_mapping
│   ├── Models/
│   │   └── Vue.cs                   # Add bulk response + daily response models
│   └── Services/
│       ├── IVueStore.cs             # Add bulk current + daily interface methods
│       └── PostgresVueStore.cs      # Add bulk current + daily implementations
└── tests/EpCubeGraph.Api.Tests/     # Tests for new endpoints

dashboard/
├── src/
│   ├── types.ts                     # Add Vue dashboard types
│   ├── api.ts                       # Add fetchVueCurrentReadings, fetchVueDailyReadings
│   ├── App.tsx                      # Add /circuits route, update nav
│   ├── components/
│   │   ├── EnergyFlowDiagram.tsx    # Add circuit list overlay
│   │   ├── CircuitsPage.tsx         # NEW — dedicated circuits-by-panel page
│   │   ├── CurrentReadings.tsx      # Add Vue data polling loop
│   │   └── SettingsPage.tsx         # Add mapping editor section
│   └── utils/
│       └── circuits.ts              # NEW — circuit sorting/filtering helpers
└── tests/
    ├── component/                   # Component tests for CircuitsPage, flow overlay
    └── unit/                        # Unit tests for circuit utils

local/epcube-exporter/
├── exporter.py                      # Add daily poll loop, vue_readings_daily writes
└── test_exporter.py                 # Tests for daily poll
```

**Structure Decision**: Existing multi-component structure (API + dashboard + exporter). All changes extend existing files and directories. One new page component (`CircuitsPage.tsx`), one new util (`circuits.ts`). No new projects or top-level directories.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
