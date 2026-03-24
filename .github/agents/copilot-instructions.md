````chatagent
# epcubegraph Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-06-23

## Active Technologies
- C# / .NET 10 + ASP.NET Core Minimal API (api/)
- Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement)
- HttpClient (VictoriaMetrics PromQL queries, built-in)
- Azure.Identity, Azure.Security.KeyVault.Secrets
- VictoriaMetrics single-node + vmauth on Azure Container Apps
- Terraform (azurerm ~>4.0, azuread ~>3.0) for infrastructure (infra/)
- Docker Compose for local ingestion stack (local/)
- C# / .NET 10 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Swashbuckle.AspNetCore (Swagger/OpenAPI) (001-data-ingestor)
- VictoriaMetrics single-node on Azure Container Apps (Prometheus remote-write ingestion, PromQL queries) (001-data-ingestor)
- TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001) + Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), Vite (build) (002-web-dashboard)
- N/A — stateless SPA; all data fetched from Feature 001 API at runtime (002-web-dashboard)
- TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001) + Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), @microsoft/applicationinsights-web (telemetry), Vite (build) (002-web-dashboard)

## Project Structure

```text
api/                    # .NET 10 API (src/ + tests/)
  src/EpCubeGraph.Api/  # Minimal API with PromQL passthrough + device endpoints
  tests/                # xUnit tests (Unit/ + Integration/ with Testcontainers)
infra/                  # Terraform IaC (Container Apps, Key Vault, ACR, Entra ID)
local/                  # Docker Compose stack (epcube-exporter + vmagent)
specs/                  # Feature specifications
scripts/                # Setup and validation scripts
```

## Commands

```bash
cd api && dotnet build EpCubeGraph.sln             # Build
cd api && dotnet test EpCubeGraph.sln               # Run all tests
cd infra && terraform init && terraform plan        # Validate infrastructure
cd local && docker compose up -d                  # Start local ingestion
```

## Code Style

- C# 13 / .NET 10: Minimal API pattern, file-scoped namespaces, nullable reference types enabled
- 100% line coverage enforced (constitution mandate)
- TDD required: tests before implementation
- No `:latest` container tags in production

## Recent Changes
- 002-web-dashboard: Added TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001) + Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), @microsoft/applicationinsights-web (telemetry), Vite (build)
- 002-web-dashboard: Added TypeScript 5.8 / Preact 10.x (SPA); C# / .NET 10 (API — already exists from Feature 001) + Preact, preact-router, @azure/msal-browser (MSAL.js), uPlot (charting), Vite (build)
- 001-data-ingestor: Added C# / .NET 10 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Swashbuckle.AspNetCore (Swagger/OpenAPI)

<!-- MANUAL ADDITIONS START -->

## ⛔ Engineering Principles (Non-Negotiable)

### Holistic Thinking
Before writing ANY code, trace the impact through the full stack:
- **Data flow**: exporter → data store → API → dashboard → tests → docs → infra
- **Contract alignment**: Does the API actually return what the dashboard expects? Verify against the running system, not assumptions.
- **Test impact**: Will this change break existing tests? Do existing tests need updating?
- **Infra impact**: Does this require Terraform changes, new env vars, or CI/CD updates?
- **Spec drift**: Does the implementation match what's in spec.md, plan.md, and data-model.md?

If you're about to implement a frontend feature, ask: "Does the backend actually support this?" If you're changing a backend contract, ask: "What clients break?"

### Senior Developer Mindset
- Act like a **senior developer / tech lead**, not a junior executing tasks from a checklist
- Own the output: audit every diff as if you were the code reviewer
- Anticipate edge cases, contract mismatches, and semantic errors BEFORE writing code
- Push back and flag design tensions, inconsistencies, or tech debt proactively
- Never code in a vacuum — every change exists in the context of the full system

### Root Cause Only
- Always find and fix the ROOT CAUSE. Never restart services, clear caches, or work around symptoms.
- If a restart makes the problem go away, the root cause is still unknown — keep digging.

### Document Before Fix
- Before fixing any bug, document the problem first (issue, spec, or session notes)
- Before implementing any new feature, document it first
- The paper trail comes FIRST. No exceptions.

<!-- MANUAL ADDITIONS END -->

````
