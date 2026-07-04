# Implementation Plan: Show grid-down state on the Current diagram per system

**Branch**: `181-grid-down-state` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/181-grid-down-state/spec.md`
**Parent Feature Issue**: [#181](https://github.com/sstjean/epcubegraph/issues/181) · **User Stories**: [#186](https://github.com/sstjean/epcubegraph/issues/186) (US1, P1), [#187](https://github.com/sstjean/epcubegraph/issues/187) (US2, P2)

## Summary

Surface each EP Cube system's grid-down state on the dashboard **Current** diagram as one
end-to-end vertical slice. Grid-down is `systemStatus ∈ {2 (Backup), 3 (Off-Grid)}`. The
signal is already parsed by the exporter (`system_status_raw`) but is only rendered on the
exporter debug page today — it is not persisted, exposed, or displayed.

**Technical approach**: persist the raw `systemStatus` integer per poll as a new numeric
reading metric `grid_status_code` on the existing `{dev_id}_battery` device via the existing
`readings` pipeline (no schema change; reuses the `#182` covering index). The API needs **no
code change** — the generic `/api/v1/readings/current?metric=grid_status_code` endpoint already
serves any metric per device. The dashboard fetches `grid_status_code` alongside the other
current metrics, derives a per-system `gridDown` boolean via the `{2,3}` rule, and the Current
diagram (`EnergyFlowDiagram.tsx`) turns that system's **Grid symbol red** and shows the text
**"Grid Down"** directly beneath it. Stale/missing/offline → no indicator (FR-008).

## Technical Context

**Language/Version**: Python 3.12 (exporter), C# 13 / .NET 10 (API), TypeScript 5.8 / Preact 10.x (dashboard)
**Primary Dependencies**: psycopg2 (exporter); ASP.NET Core Minimal API + Npgsql (API); Preact + inline SVG (dashboard)
**Storage**: PostgreSQL 17 — existing `epcubegraph` database, existing `readings` table `(device_id, metric_name, timestamp, value)`. **No schema change.** New metric name `grid_status_code`.
**Testing**: unittest (`local/epcube-exporter/test_exporter.py`); xUnit (`api/tests`); Vitest (`dashboard/tests`)
**Target Platform**: Azure Container Apps (API + exporter runtime); Static Web App (dashboard); local Docker Compose for manual verification
**Project Type**: Web application — exporter (ingest) + API (backend) + dashboard (frontend)
**Performance Goals**: current-readings surface unaffected — one extra `fetchCurrentReadings` call reusing the existing top-1-per-device LATERAL index lookup; indicator visible within one refresh/poll cycle (SC-001)
**Constraints**: TDD + 100% line coverage on all changed code (FR-009); timestamps in America/New_York (FR-007); no `:latest` tags; features ship as one vertical slice across all tiers
**Scale/Scope**: personal telemetry, a handful of EP Cube systems; three changed files with new tests, plus one shared type field

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ PASS | Reuses the existing `readings` metric pipeline and the generic `/readings/current` endpoint. No new table, no new API endpoint, no new API code. Grid-down derivation is a one-line `{2,3}` membership test in the dashboard. |
| II. YAGNI | ✅ PASS | No "unknown" state, no last-known retention, no Fault/Upgrading styling, no alerting — all explicitly out of scope. Only `{2,3}` triggers the indicator. |
| III. Single Responsibility | ✅ PASS | Exporter keeps parse (pure) → build-readings (pure) → write (I/O) separation. Dashboard adds a pure `deriveGridDown` mapping distinct from rendering. |
| IV. TDD + 100% coverage | ✅ PLANNED | Red-Green-Refactor per tier; AAA tests; exporter/dashboard changes carry new tests. API tier is unchanged code → covered by existing generic tests (see Complexity Tracking note). |
| Platform / Security | ✅ PASS | No infra, auth, or transport changes. Same authenticated `/readings/current` surface. No secrets. |
| DevOps / Issue Discipline | ✅ PASS | Parent #181 + user stories #186/#187 exist; PR must close #181 (FR-010). |

**Result**: PASS. No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/181-grid-down-state/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── grid-status-current.md   # Contract for grid_status_code on /readings/current
└── checklists/          # (pre-existing)
```

### Source Code (repository root)

```text
local/epcube-exporter/
├── epcube_collector.py          # CHANGE: build_postgres_readings() appends grid_status_code
│                                 #         when systemStatus is a valid int; add parse helper
└── test_exporter.py             # CHANGE: new tests for grid_status_code tuple + omission

api/src/EpCubeGraph.Api/
└── (no code change)             # /readings/current?metric=grid_status_code already works

dashboard/src/
├── api.ts                       # (no change) reuse fetchCurrentReadings('grid_status_code')
├── components/
│   ├── DeviceCard.tsx           # CHANGE: add `gridDown: boolean` to DeviceCardMetrics
│   ├── CurrentReadings.tsx      # CHANGE: fetch grid_status_code, derive gridDown per group
│   └── EnergyFlowDiagram.tsx    # CHANGE: red Grid symbol + "Grid Down" label when gridDown
└── utils/                       # CHANGE (optional): pure deriveGridDown({2,3}) helper + tests

dashboard/tests/                 # CHANGE: unit test deriveGridDown; component test red symbol/label
```

**Structure Decision**: Web-application layout (exporter + API + dashboard) already present in
the repo. This feature touches the exporter (persist) and dashboard (fetch + derive + render)
tiers; the API tier requires **no code change** because its current-readings endpoint is
metric-agnostic. The vertical slice is therefore exporter → PostgreSQL → (unchanged) API →
dashboard.

## Complexity Tracking

> No constitution violations. This note documents the one design decision that could look like a gap.

| Item | Decision | Why the simpler alternative was chosen |
|------|----------|-----------------------------------------|
| API tier has no new code | Serve `grid_status_code` through the **existing** generic `/readings/current` endpoint and derive grid-down in the dashboard | Adding a dedicated boolean field/endpoint on the API would duplicate the `{2,3}` rule server-side, widen the contract, and add code + tests for zero user-visible benefit. The endpoint is already metric-agnostic and index-optimized. Deriving grid-down where it is rendered keeps one source of truth for the rule. 100% coverage still holds: no changed API code means no new API coverage obligation, and the metric path is already exercised by existing generic-endpoint tests. |
