# Implementation Plan: Dashboard Settings Page

**Branch**: `006-settings-page` | **Date**: 2026-04-05 | **Spec**: [spec.md](spec.md)
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
├── spec.md              # Feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown
└── checklists/          # Requirement validation
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

Organized as vertical slices by user story — each phase delivers a testable increment across the full stack (DB → API → dashboard).

### Phase 1: Setup (Shared Infrastructure)

Create data models and TypeScript types shared across all user stories.

- C# models in `api/src/EpCubeGraph.Api/Models/Settings.cs`
- TypeScript types in `dashboard/src/types.ts`

**Deliverable:** Models and types compile. No runtime behavior yet.

### Phase 2: US1 — Polling Intervals (#82)

Full-stack delivery of polling interval management.

- **API**: SettingsService with `settings` table (auto-created), GET/PUT endpoints
- **Dashboard**: SettingsPage with polling intervals section, /settings route, nav link
- **Exporter**: EP Cube exporter reads interval from DB, falls back to 30s default
- Vue polling input shown as disabled/"Coming in Feature 005"

**Deliverable:** Change EP Cube polling interval from the dashboard. Exporter picks it up on next cycle.

### Phase 3: US2 — Panel Hierarchy (#83)

Add panel hierarchy management to the Settings page.

- **API**: Hierarchy methods in SettingsService, `panel_hierarchy` table (auto-created), endpoints with cycle detection
- **Dashboard**: Hierarchy section in SettingsPage — parent-child list, add/remove, validation

**Deliverable:** Panel hierarchy configurable from the dashboard. API returns hierarchy for deduplication queries.

### Phase 4: US3 — Display Names (#84)

Add device/circuit renaming to the Settings page.

- **API**: Display name methods in SettingsService, `display_name_overrides` table (auto-created), endpoints
- **Dashboard**: Display names section in SettingsPage — device/circuit list, edit, clear to revert

**Deliverable:** Custom display names configurable from the dashboard. API responses use overrides.

### Phase 5: Polish + Validation

- Accessibility: keyboard navigation, ARIA, focus styles, touch targets (44px minimum)
- Error handling: API errors shown inline per section, network failure recovery
- Full test suite: 100% coverage on all new code
- Build + validate: `npm run build`, `terraform validate`, `terraform fmt -check`

**Deliverable:** All tests pass, 100% coverage, accessibility validated.
