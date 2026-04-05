# Implementation Plan: Dashboard Settings Page

**Branch**: `005-emporia-vue` | **Date**: 2026-04-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-settings-page/spec.md`
**GitHub Issue**: #81

## Summary

Build a Settings page in the dashboard that allows runtime modification of system configuration without redeployment. Three sections: polling intervals, panel hierarchy, and device/circuit display names. Stored in typed PostgreSQL tables, exposed through authenticated API endpoints. Exporters read settings directly from the database.

## Technical Context

**Language/Version**: TypeScript 5.8 / Preact 10.x (dashboard), C# 13 / .NET 10 (API), Python 3.12 (exporter)
**Primary Dependencies**: Preact, Vite, Npgsql (API), psycopg2 (exporter)
**Storage**: PostgreSQL 17 — three new tables: `settings`, `panel_hierarchy`, `display_name_overrides`
**Testing**: Vitest (dashboard), xUnit + Testcontainers (API), pytest (exporter)
**Target Platform**: Azure Container Apps (API/exporter), Azure Static Web Apps (dashboard)
**Project Type**: Full-stack feature spanning dashboard SPA, REST API, and Python exporter
**Performance Goals**: Settings page load < 500ms, save < 500ms (SC-002)
**Constraints**: 100% test coverage, Entra ID auth on all endpoints
**Scale/Scope**: Single-user system, ~10 settings, ~4 panel hierarchy entries, ~80 display name overrides

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ | Typed tables, no ORM, direct SQL. No over-abstraction. |
| II. YAGNI | ✅ | Only settings needed for Feature 005. No plugin system. |
| III. TDD | ✅ | Tests before implementation, 100% coverage. |
| IV. Semantic Architecture | ✅ | New tables follow existing naming conventions. |
| V. Zero Warnings | ✅ | CI enforces this. |
| VI. Local Type-Checking | ✅ | `npm run typecheck` + `dotnet build` + `pytest`. |

## Project Structure

### Documentation (this feature)

```text
specs/006-settings-page/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contract)
└── tasks.md             # Phase 2 output
```

### Source Code Changes

```text
dashboard/src/
├── components/
│   └── SettingsPage.tsx       # New — Settings page with 3 sections
├── api.ts                     # Modified — add settings API calls
├── App.tsx                    # Modified — add /settings route + nav link
└── types.ts                   # Modified — add settings types

api/src/EpCubeGraph.Api/
├── Endpoints/
│   └── SettingsEndpoints.cs   # New — GET/PUT for settings, hierarchy, names
├── Services/
│   └── SettingsService.cs     # New — DB access for settings tables
└── Models/
    └── Settings.cs            # New — request/response models

local/epcube-exporter/
└── exporter.py                # Modified — read poll interval from DB

infra/
└── (no changes — tables created by API/exporter on first use)
```

## Implementation Phases

### Phase 1: Database Schema + API Endpoints

Create the three PostgreSQL tables and expose them through the API. No dashboard UI yet — API-testable via curl.

**Tables:**
- `settings` — key (text PK), value (jsonb), last_modified (timestamptz)
- `panel_hierarchy` — id (serial PK), parent_device_gid (bigint), child_device_gid (bigint), unique constraint on parent+child
- `display_name_overrides` — id (serial PK), device_gid (bigint), channel_number (text, nullable), display_name (text), unique constraint on device_gid+channel_number

**API Endpoints:**
- `GET /api/v1/settings` — returns all settings as key-value pairs
- `PUT /api/v1/settings/{key}` — update a single setting (validates value)
- `GET /api/v1/settings/hierarchy` — returns panel hierarchy entries
- `PUT /api/v1/settings/hierarchy` — replace entire hierarchy (validates no cycles)
- `GET /api/v1/settings/display-names` — returns all display name overrides
- `PUT /api/v1/settings/display-names/{device_gid}` — update display names for a device
- `DELETE /api/v1/settings/display-names/{device_gid}/{channel_number}` — clear override

All endpoints require Entra ID auth with `user_impersonation` scope.

**Deliverable:** API integration tests pass. Tables exist. Settings can be read/written via API.

### Phase 2: Exporter Integration

Modify the EP Cube exporter to read its polling interval from the `settings` table instead of using a hardcoded value. Fall back to the hardcoded default when no row exists.

**Changes:**
- `exporter.py`: On each poll cycle, query `SELECT value FROM settings WHERE key = 'epcube_poll_interval_seconds'`. If no row or error, use default (30s).
- No Vue exporter changes yet (Vue exporter doesn't exist — that's Feature 005).

**Deliverable:** EP Cube exporter polling interval is changeable via the database. Exporter tests cover DB-read path and fallback.

### Phase 3: Dashboard Settings Page

Build the Preact Settings page with three independently-saveable sections.

**Components:**
- `SettingsPage.tsx` — main page with three collapsible/tabbed sections
- Polling intervals section: number inputs per data source, Save button, validation
- Panel hierarchy section: tree/list view, add/remove, Save button, cycle validation
- Display names section: device/circuit list with editable name fields, Save per device, clear button

**Integration:**
- `App.tsx`: add `/settings` route, gear icon + "Settings" in nav
- `api.ts`: add `fetchSettings`, `updateSetting`, `fetchHierarchy`, `updateHierarchy`, `fetchDisplayNames`, `updateDisplayName`, `clearDisplayName`

**Deliverable:** Settings page loads, displays current values, saves changes, shows success messages. All 3 sections work independently.

### Phase 4: Polish + Validation

- Accessibility: keyboard navigation, ARIA, focus styles on new elements
- Touch targets: 44px minimum on all buttons/inputs
- Error handling: API errors shown in-page, network failures handled gracefully
- Full test suite: 100% coverage on all new code
- `terraform validate` + `terraform fmt -check` (no infra changes expected)

**Deliverable:** All tests pass, 100% coverage, accessibility validated.
