# Implementation Plan: Simplify Vue Device Mapping

**Branch**: `010-simplify-vue-mapping` | **Date**: 2026-04-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-simplify-vue-mapping/spec.md`

## Summary

Change the `vue_device_mapping` setting format from an array of Vue panel objects per EP Cube (`Record<string, VuePanelMapping[]>`) to a single parent device per EP Cube (`Record<string, VuePanelMapping>`). Add a migration guard that detects old array-format mappings and prompts reconfiguration. All other Vue-related behavior (hierarchy resolution, Balance dedup, panel prefixes, circuit ordering) is already implemented and requires no changes.

## Technical Context

**Language/Version**: TypeScript 5.8 (dashboard), C# / .NET 10 (API)
**Primary Dependencies**: Preact 10.x, Vitest 4.x (dashboard); ASP.NET Core Minimal API, Npgsql (API)
**Storage**: PostgreSQL 17 — existing `settings` table, `vue_device_mapping` key (jsonb value)
**Testing**: Vitest (dashboard, 100% coverage gate), xUnit + Testcontainers (API, 100% coverage gate)
**Target Platform**: Azure Static Web Apps (dashboard), Azure Container Apps (API)
**Project Type**: Web application (SPA + API)
**Performance Goals**: N/A — this is a format change with no performance implications
**Constraints**: Must not break existing hierarchy resolution, Balance dedup, or circuit display
**Scale/Scope**: ~10 files touched across dashboard + API. No infra or exporter changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ PASS | Removing array wrapper is strictly simpler — fewer moving parts |
| II. YAGNI | ✅ PASS | Single-device mapping eliminates unused multi-panel assignment capability |
| III. TDD | ✅ PASS | All changes will follow red-green-refactor. 100% coverage gates enforced. |
| Dev Workflow — Branching | ✅ PASS | Feature branch `010-simplify-vue-mapping` |
| Dev Workflow — Type-check parity | ✅ PASS | `npm run typecheck` + `dotnet build` both available locally |
| Performance Standards | ✅ PASS | Format change only — no performance impact |
| Platform Constraints | ✅ PASS | No new infra. Same Azure services. |
| Security — Input Validation | ✅ PASS | Server-side validation updated to match new format |
| Security — Zero-Trust | ✅ PASS | No auth/networking changes |
| DevOps — CI Coverage Gate | ✅ PASS | 100% coverage maintained |
| DevOps — Environment Parity | ✅ PASS | No infra changes |

No violations. No complexity justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/010-simplify-vue-mapping/
├── spec.md              # Feature specification (updated 2026-04-17)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (settings API contract change)
├── checklists/          # Requirements checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (affected files)

```text
dashboard/
├── src/
│   ├── types.ts                      # VueDeviceMapping type: [] → single object
│   ├── api.ts                        # Save mapping format change
│   ├── components/
│   │   ├── SettingsPage.tsx           # Editor UI: multi-panel → single select
│   │   ├── EnergyFlowDiagram.tsx      # Parse new mapping format
│   │   └── CircuitsPage.tsx           # Parse new mapping format
│   └── hooks/
│       └── useVueData.ts             # Parse + validate mapping format
└── tests/
    ├── component/                     # Updated component tests
    └── unit/                          # Updated utility tests

api/
├── src/EpCubeGraph.Api/
│   └── Endpoints/SettingsEndpoints.cs # Server-side validation for new format
└── tests/EpCubeGraph.Api.Tests/       # Updated API tests
```

**Structure Decision**: No new files or directories. This is a format change across existing files.

## Complexity Tracking

No constitution violations. No complexity justification needed.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
