# Implementation Plan: Automatic Device Discovery

**Branch**: `124-device-discovery` | **Date**: 2026-05-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/124-device-discovery/spec.md`
**Issue**: [#134](https://github.com/sstjean/epcubegraph/issues/134)

## Summary

Add hourly EP Cube device re-discovery to the exporter, with database-backed pending replacement prompts, a merge API, dashboard banner notifications, and a Settings page manual merge UI. When a mainboard is swapped, the system detects the device change, prompts the user to confirm the replacement, and merges historical readings into the new device for a seamless timeline.

## Technical Context

**Language/Version**: Python 3.12 (exporter), C# / .NET 10 (API), TypeScript 5.8 / Preact 10.x (dashboard)
**Primary Dependencies**: psycopg2 (exporter), Npgsql (API), Preact + uPlot (dashboard), MSAL.js (auth)
**Storage**: PostgreSQL 17 — existing `epcubegraph` database. Schema changes: `devices` table (add `status` column), new `pending_replacements` table. New settings key: `discovery_interval_seconds`.
**Testing**: unittest (exporter), xUnit + Testcontainers.PostgreSql (API), Vitest (dashboard)
**Target Platform**: Azure Container Apps (exporter + API), Azure Static Web Apps (dashboard)
**Project Type**: Full-stack feature across exporter, API, and dashboard
**Performance Goals**: Merge transaction completes in seconds (rare operation, <100K readings per device). Discovery adds <1s overhead per poll cycle.
**Constraints**: Merge must be a single atomic transaction. Discovery must not block polling.
**Scale/Scope**: 1-2 EP Cube devices per account. Merges happen ~once per year.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Simplicity — PASS

- Discovery reuses the existing poll loop (no new thread)
- Merge uses a single API endpoint for both banner and Settings page (SRP)
- Device status tracked via a column on the existing `devices` table (no new table for state)
- Toggle visibility uses localStorage (no server round-trip)
- One new table (`pending_replacements`) justified by need to survive restarts and be API-readable

### II. YAGNI — PASS

- Every feature maps directly to an FR in the spec
- No plugin system, no provider abstraction, no multi-tenant support
- Cross-cycle replacement matching explicitly deferred to Settings page manual merge (not built)
- No separate discovery thread (the simpler poll-loop approach is sufficient)
- Configurable interval justified by existing pattern (`poll_interval_seconds`) and explicit user request

### III. Single Responsibility Principle — PASS

- Exporter: discovery (detect changes), not merge (data management)
- API: merge logic (data management), not discovery (ingestion)
- Dashboard: prompt display and user input, not business logic
- Discovery function: compare device lists and report changes. Separate from polling function.
- Merge function: re-attribute readings. Separate from pending replacement management.

### IV. Test-Driven Development — PASS (requirements)

- All new exporter logic (discovery comparison, backoff retry, empty-list guard) will be unit-tested with mocks
- API merge endpoint: integration tests with Testcontainers.PostgreSql
- Dashboard: component tests for banner prompt, Settings page merge UI, toggle
- 100% coverage required, AAA pattern, mock/synthetic data only
- Each user story has acceptance scenarios that map to test cases

## Project Structure

### Documentation (this feature)

```text
specs/124-device-discovery/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
local/epcube-exporter/
├── exporter.py          # Discovery logic added to EpCubeCollector
└── test_exporter.py     # New discovery/backoff/empty-list tests

api/src/EpCubeGraph.Api/
├── Endpoints/
│   └── DevicesEndpoints.cs    # Modified: merge, preview, pending-replacements, devices-by-status
├── Services/
│   └── PostgresMetricsStore.cs  # Modified: filter by status, merge transaction
└── Models/
    └── Models.cs                # Modified: Device status, merge request/response records

api/tests/EpCubeGraph.Api.Tests/
├── Unit/                # New merge logic unit tests
└── Integration/         # New merge/preview/pending integration tests

dashboard/src/
├── components/
│   ├── ReplacementBanner.tsx    # New: banner prompt component
│   └── DeviceMerge.tsx          # New: Settings page merge section
├── hooks/
│   └── useDeviceDiscovery.ts    # New: pending replacements polling hook
└── utils/                       # Toggle persistence helpers

dashboard/tests/
├── component/           # New component tests for banner, merge UI
└── unit/                # New unit tests for toggle, merge helpers
```

**Structure Decision**: Follows existing project layout. No new top-level directories. Exporter changes are in-place. API gets new endpoint file for device operations. Dashboard gets new components for banner and merge UI.

## Complexity Tracking

No constitution violations. Table intentionally left empty.
