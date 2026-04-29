````chatagent
# epcubegraph Development Guidelines

Updated: 2026-03-28

## ⛔ NON-NEGOTIABLE: Verification Protocol

These rules override all other behavior. Violating any of them is a critical failure.
1. **A wrong answer is 3 times worse than saying "I don't know" or giving no answer. If you haven't verified it, say so. Silence beats speculation. Every time.
2. **NEVER state something as fact without verification.** If you haven't read the file, run the command, or checked the logs — say "I haven't verified this." No exceptions.
3. **Start from the failing system.** CI/CD failure? Read the actual logs first. Not local code. Not grep for keywords. The full step-by-step output.
4. **No pattern-matching from grep.** Grep results show matching lines, not execution flow. Read the sequential log or don't make claims about what happened.
5. **Root cause only.** Never mask, restart, or work around symptoms.
6. **No silent error swallowing.** No `|| true` on critical paths, no empty catches, no suppression flags.
7. **Document before fix.** Paper trail first, code second.
8. **The User must be allowed to manually test every change locally** before declaring it done.
9. **Never push without permission.** Commits are fine. Pushes require explicit approval.
10. **Preview in a formatted way before external writes so the user can read the content without horizontal scrolling.** Show exactly what will be sent to GitHub and wait for approval.

## Active Technologies
- C# / .NET 10 + ASP.NET Core Minimal API for the API in `api/`
- Microsoft.Identity.Web for Entra ID JWT validation and `user_impersonation` scope enforcement
- Npgsql for PostgreSQL access from the API
- Python 3.12 for `local/epcube-exporter/`
- psycopg2 for exporter PostgreSQL writes
- Terraform (`azurerm ~>4.0`, `azuread ~>3.0`) for Azure infrastructure in `infra/`
- Azure Container Apps for API and exporter runtime
- Azure Database for PostgreSQL Flexible Server for Azure telemetry storage
- Docker Compose for local runtime and test orchestration in `local/`
- TypeScript 5.8 / Preact 10.x / Vite / MSAL.js / uPlot for the dashboard in `dashboard/`
- `@microsoft/applicationinsights-web` for dashboard telemetry
- Python 3.12 (exporter), C# / .NET 10 (API), TypeScript 5.8 / Preact 10.x (dashboard) + PyEmVue (exporter), Npgsql (API), uPlot (dashboard), psycopg2 (exporter) (005-emporia-vue)
- PostgreSQL 17 (existing instance — same `epcubegraph` database) (005-emporia-vue)
- TypeScript 5.8 / Preact 10.x (dashboard), C# / .NET 10 (API), Python 3.12 (exporter) + Preact, preact-router, uPlot (dashboard); ASP.NET Core Minimal API, Npgsql (API); PyEmVue, psycopg2 (exporter) (007-dashboard-vue-circuits)
- PostgreSQL 17 — existing `epcubegraph` database. New table: `vue_readings_daily`. New settings keys: `vue_device_mapping`, `vue_daily_poll_interval_seconds` (007-dashboard-vue-circuits)
- TypeScript 5.8 (dashboard), C# / .NET 10 (API) + Preact 10.x, Vitest 4.x (dashboard); ASP.NET Core Minimal API, Npgsql (API) (010-simplify-vue-mapping)
- PostgreSQL 17 — existing `settings` table, `vue_device_mapping` key (jsonb value) (010-simplify-vue-mapping)
- Python 3.12 (exporter), C# / .NET 10 (API), Bash (scripts), HCL (Terraform) + psycopg2 (exporter), Npgsql (API), unittest (exporter tests), xUnit (API tests) (093-remove-vestigial-metrics)
- PostgreSQL 17 — no schema changes, data flow unchanged (093-remove-vestigial-metrics)

## Project Structure

```text
api/                    # .NET 10 API (src/ + tests/)
  src/EpCubeGraph.Api/  # Minimal API with PostgreSQL-backed telemetry endpoints
  tests/                # xUnit tests (Unit/ + Integration/ with PostgreSQL test coverage)
dashboard/              # Preact SPA
infra/                  # Terraform IaC (Container Apps, PostgreSQL, Key Vault, ACR, Entra ID)
local/                  # Exporter source and Docker Compose stacks
specs/                  # Feature specifications
scripts/                # Setup and validation scripts
```

## Commands

```bash
cd api && dotnet build EpCubeGraph.sln
cd api && dotnet test EpCubeGraph.sln
cd dashboard && npm run typecheck
cd dashboard && npm run test:coverage
cd infra && terraform validate
cd local && docker compose -f docker-compose.prod-local.yml up -d
```

## Code Style

- C# 13 / .NET 10: Minimal API pattern, nullable reference types enabled
- TypeScript strict mode enabled in the dashboard
- 100% line coverage enforced by project policy
- TDD required: tests before implementation
- No `:latest` container tags in production
- Python background threads: wrap entire loop body in try/except with logging, log thread startup, no code outside try block

## Engineering Principles

### Holistic Thinking
Before writing any code, trace the impact through the full stack:
- exporter → PostgreSQL → API → dashboard → tests → docs → infra
- verify contract alignment against the current implementation, not historical assumptions
- update docs and issue state whenever architecture or contract reality changes

### Senior Developer Mindset
- Act like a senior developer / tech lead, not a checklist executor
- Audit every diff as if you were the reviewer
- Anticipate edge cases and contract mismatches before they land
- Flag design tension and drift explicitly

### Root Cause Only
- Fix root causes rather than masking symptoms
- If a restart hides the issue, the issue is not understood yet

### Document Before Fix
- Create or update the paper trail before implementing the change
- Keep specs, docs, and issues synchronized with the actual architecture

## Session Procedures

When the user says **"Start up"** or **"Shutdown"**, follow the procedures in `.specify/memory/session-procedures.md`. Read that file immediately and execute the steps.
````

## Recent Changes
- 093-remove-vestigial-metrics: Added Python 3.12 (exporter), C# / .NET 10 (API), Bash (scripts), HCL (Terraform) + psycopg2 (exporter), Npgsql (API), unittest (exporter tests), xUnit (API tests)
- 010-simplify-vue-mapping: Added TypeScript 5.8 (dashboard), C# / .NET 10 (API) + Preact 10.x, Vitest 4.x (dashboard); ASP.NET Core Minimal API, Npgsql (API)
- 007-dashboard-vue-circuits: Added TypeScript 5.8 / Preact 10.x (dashboard), C# / .NET 10 (API), Python 3.12 (exporter) + Preact, preact-router, uPlot (dashboard); ASP.NET Core Minimal API, Npgsql (API); PyEmVue, psycopg2 (exporter)
