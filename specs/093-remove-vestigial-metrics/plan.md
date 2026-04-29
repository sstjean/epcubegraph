# Implementation Plan: Remove Vestigial /metrics Endpoint

**Branch**: `093-remove-vestigial-metrics` | **Date**: 2026-04-29 | **Spec**: [spec.md](spec.md)
**GitHub Issue**: [#93](https://github.com/sstjean/epcubegraph/issues/93)

## Summary

Remove the vestigial Prometheus `/metrics` endpoint from the epcube-exporter and mock-exporter, delete all Prometheus text format generation code, and purge every reference to Prometheus, VictoriaMetrics, vmagent, and scrape-as-monitoring-terminology from the entire codebase. All data flows through PostgreSQL — the `/metrics` endpoint has no consumer.

## Technical Context

**Language/Version**: Python 3.12 (exporter), C# / .NET 10 (API), Bash (scripts), HCL (Terraform)
**Primary Dependencies**: psycopg2 (exporter), Npgsql (API), unittest (exporter tests), xUnit (API tests)
**Storage**: PostgreSQL 17 — no schema changes, data flow unchanged
**Testing**: `pytest` (exporter, 177 tests), `dotnet test` (API, 391 tests), `npm run test:coverage` (dashboard, 544 tests)
**Target Platform**: Docker container (Linux), Azure Container Apps
**Project Type**: Code removal / tech-debt cleanup
**Performance Goals**: N/A — removing code, no new runtime behavior
**Constraints**: 100% test coverage must be maintained across all components
**Scale/Scope**: ~400 lines removed across 16 files, net reduction ~370 lines

## Constitution Check (Pre-Design)

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| §I Simplicity | Does the change add unnecessary complexity? | ✅ PASS — Removing code, reducing complexity |
| §II YAGNI | Does dead code without a covering requirement exist? | ✅ PASS — This feature removes that dead code |
| §III SRP | Does any unit have multiple reasons to change? | ✅ PASS — `poll()` currently mixes Prometheus text + PostgreSQL + snapshots; removing one concern |
| §IV TDD | Are tests written before implementation? | ✅ PASS — Plan requires failing tests before code removal |
| §IV Coverage | Will 100% coverage be maintained? | ✅ PASS — Obsolete tests removed, new tests added for 404 behavior |
| DevOps: CI Zero Warnings | Will CI pass cleanly? | ✅ PASS — No new warnings; removing dead validation checks |
| DevOps: Tool Sync | Are tools.json / setup scripts affected? | ✅ PASS — No tools added or removed |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/093-remove-vestigial-metrics/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0: N/A — no unknowns to research
├── tasks.md             # Phase 2 output (/speckit.tasks)
└── checklists/
    └── requirements.md
```

### Files Modified (repository root)

```text
local/
├── epcube-exporter/
│   ├── exporter.py              # Remove /metrics handler, Prometheus text gen, get_metrics(), _metrics_text
│   └── test_exporter.py         # Remove TestPrometheusMetrics, update assertions
├── mock-exporter/
│   └── metrics_server.py        # Remove _generate_metrics(), _labels(), update handler
├── deploy.sh                    # Replace /metrics check with /health
├── deploy-local.sh              # DELETE (dead file)
├── docker-compose.prod-local.yml # Update comment
└── docker-compose.local.yml     # Update comment

api/
├── src/EpCubeGraph.Api/Models/Models.cs  # Remove Prometheus comment
└── tests/.../ValidateTests.cs            # Rename test method

infra/
├── container-apps.tf            # Update comment
└── validate-deployment.sh       # Remove /metrics validation block

specs/
├── 001-data-ingestor/plan.md       # Remove prometheus-net dependency
├── 001-data-ingestor/research.md   # Remove prometheus-net reference
├── 002-web-dashboard/spec.md       # Remove Prometheus mentions
├── 002-web-dashboard/data-model.md # Remove scrape_success reference
└── 002-web-dashboard/research.md   # Remove Prometheus mentions
```
