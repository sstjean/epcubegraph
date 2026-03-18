# Implementation Plan: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-data-ingestor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a three-tier telemetry ingestion pipeline for EP Cube solar/battery gateways:

1. **Ingestion tier** (Azure Container Apps): epcube-exporter polls EP Cube devices via the cloud API (monitoring-us.epcube.com) and exposes Prometheus metrics; VictoriaMetrics scrapes them directly via `-promscrape.config` within the same Container Apps environment.
2. **Storage tier** (Azure Container Apps): VictoriaMetrics single-node stores time-series with 5-year retention, handles deduplication natively.
3. **API tier** (Azure Container Apps): A C# ASP.NET Core Minimal API service queries VictoriaMetrics via PromQL and exposes a versioned REST API authenticated with Entra ID (OAuth 2.0 JWT) and authorized via `user_impersonation` scope. Also exposes grid energy balance via PromQL (`epcube_grid_import_kwh - epcube_grid_export_kwh`). Emits structured JSON logs and exposes a `/metrics` endpoint for self-monitoring via `prometheus-net`.

## Technical Context

**Language/Version**: C# / .NET 10
**Primary Dependencies**: ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Swashbuckle.AspNetCore (Swagger/OpenAPI)
**Storage**: VictoriaMetrics single-node on Azure Container Apps (Prometheus remote-write ingestion, PromQL queries)
**Testing**: xUnit, coverlet (coverage), Microsoft.AspNetCore.Mvc.Testing (WebApplicationFactory), Testcontainers for .NET (integration tests with VictoriaMetrics)
**Target Platform**: Azure Container Apps (all services: VictoriaMetrics, epcube-exporter, API)
**Project Type**: Web service (API) + cloud-deployed data ingestion
**Performance Goals**: API queries for 30 days of data return within 2 seconds (SC-003), validated by integration test
**Constraints**: Single-user system; VictoriaMetrics single-node; 100% test coverage (constitution)
**Scale/Scope**: 1 user, 2–4 EP Cube devices, ~20 metrics at 1-minute intervals ≈ 28K data points/day

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Uses epcube-exporter (cloud API poller), VictoriaMetrics (no custom TSDB), ASP.NET Core Minimal API (minimal framework). Everything runs in a single Azure Container Apps environment. |
| II | YAGNI | ✅ PASS | No speculative abstractions. Single-node VictoriaMetrics, single-user auth, no plugin system, no multi-tenant support. Every component maps to a current FR. |
| III | TDD | ✅ PASS | xUnit + coverlet enforced at 100%. Acceptance tests via Testcontainers for .NET with real VictoriaMetrics. Red-Green-Refactor mandated. |
| — | Dev Workflow | ✅ PASS | Feature branch `001-data-ingestor`, atomic commits, CI gate with full test suite. |
| — | Performance | ✅ PASS | VictoriaMetrics handles time-range queries efficiently (no full scans). API query <2s for 30 days (SC-003). Validated by integration test. |
| — | Platform: Azure | ✅ PASS | VictoriaMetrics + API on Azure Container Apps. Justified exception: VictoriaMetrics is not Azure-native but spec documents the choice (clarification Q3). |
| — | Platform: Docker | ✅ PASS | All services containerized in Azure Container Apps. Dockerfiles in repo. |
| — | Security: TLS | ✅ PASS | All endpoints HTTPS. Azure Container Apps provides TLS termination. |
| — | Security: Auth | ✅ PASS | API: Entra ID OAuth 2.0 JWT (FR-010). Exporter debug page: OAuth authorization code flow with session cookies. Health/metrics endpoints unauthenticated (no telemetry data). |
| — | Security: Authz | ✅ PASS | `user_impersonation` scope required on all telemetry endpoints (FR-010a). Health and metrics endpoints are unauthenticated but expose no telemetry data. |
| — | Security: Input Validation | ✅ PASS | FR-019 requires param presence/type validation. PromQL passthrough is unrestricted by design (clarification Q9). |
| — | Security: Zero-Trust | ⚠ COMPLEXITY | Internal service communication (API→VM queries, promscrape→exporter /metrics) uses no per-request auth. See Complexity Tracking. |
| — | Security: Secrets | ✅ PASS | Bearer token in Azure Key Vault, injected as Container Apps secret. No secrets in source. |
| — | DevOps: IaC | ✅ PASS | All Azure infrastructure defined in Terraform under `infra/`. No manual portal resource creation. |
| — | DevOps: CI/CD | ✅ PASS | CI gate enforces full test suite before merge. Pipeline deploys on main branch merge. |
| — | DevOps: Reproducible | ✅ PASS | Container images built from Dockerfiles in repo. Azure infra from Terraform with variables. Same commit → same deployment. |
| — | DevOps: Rollback | ✅ PASS | Container Apps uses tagged container images. No `latest` tag in production. Revision-based rollback supported natively. |
| — | DevOps: Local | ✅ PASS | `infra/deploy.sh` builds and deploys everything. Operator only provides `terraform.tfvars` values (environment name, EP Cube credentials). |

### Complexity Tracking — VictoriaMetrics Exception

The constitution requires Azure-native services. VictoriaMetrics is not Azure-native. This is documented as a justified exception per the spec clarification Q3. Azure Monitor Managed Prometheus was evaluated and rejected because VictoriaMetrics is simpler (single container, no Azure-specific config, direct PromQL support, lower cost for single-user scale).

### Complexity Tracking — Internal Service Communication Without Per-Request Auth

The constitution's zero-trust principle requires "internal services MUST NOT trust each other without explicit, per-request credential verification" and "Network location MUST NOT be treated as proof of trust." Two internal communication paths have no per-request authentication: (1) API queries VictoriaMetrics via HTTP over the Container Apps internal network, and (2) VictoriaMetrics promscrape scrapes epcube-exporter's `/metrics` endpoint. This is justified because: (1) VictoriaMetrics is internal-only (no external ingress) — unreachable from the internet; (2) `/metrics` and `/health` endpoints expose only operational counters and process metrics, never telemetry data (FR-021, FR-022); (3) the Container Apps environment provides network isolation at the platform level. Alternative rejected: mTLS between all containers adds certificate lifecycle management complexity disproportionate to the threat model of a single-user system with no multi-tenant data.

## Project Structure

### Documentation (this feature)

```text
specs/001-data-ingestor/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contract)
│   └── api-v1.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
# API service (C# / ASP.NET Core — runs on Azure Container Apps)
api/
├── src/
│   └── EpCubeGraph.Api/
│       ├── Program.cs               # App entry point, DI, middleware, auth
│       ├── appsettings.json         # Configuration (base)
│       ├── NoAuthHandler.cs         # Dev-only auth bypass
│       ├── EpCubeGraph.Api.csproj
│       ├── Models/
│       │   ├── DeviceInfo.cs         # Device response record
│       │   ├── DeviceListResponse.cs
│       │   ├── DeviceMetricsResponse.cs
│       │   ├── HealthResponse.cs     # Health check record
│       │   └── ErrorResponse.cs      # Error envelope (Prometheus-compatible)
│       ├── Services/
│       │   ├── IVictoriaMetricsClient.cs  # PromQL query interface
│       │   ├── VictoriaMetricsClient.cs   # HttpClient-based implementation
│       │   └── GridCalculator.cs          # Grid energy balance query
│       ├── Validate.cs              # Input validation helpers (FR-019)
│       └── Endpoints/
│           ├── DevicesEndpoints.cs   # /devices routes
│           ├── QueryEndpoints.cs     # /query, /query_range routes
│           ├── GridEndpoints.cs      # /grid route
│           └── HealthEndpoints.cs    # /health route
├── tests/
│   └── EpCubeGraph.Api.Tests/
│       ├── EpCubeGraph.Api.Tests.csproj
│       ├── Unit/
│       │   ├── GridCalculatorTests.cs
│       │   ├── DeviceInfoTests.cs
│       │   ├── ValidateTests.cs
│       │   ├── ModelSerializationTests.cs
│       │   └── VictoriaMetricsClientTests.cs
│       ├── Integration/
│       │   ├── ApiIntegrationTests.cs
│       │   ├── EndpointTests.cs
│       │   ├── SecurityTests.cs
│       │   ├── ProgramMiddlewareTests.cs
│       │   ├── VictoriaMetricsIntegrationTests.cs
│       │   └── PerformanceTests.cs        # SC-003 latency validation
│       └── Fixtures/
│           ├── VictoriaMetricsFixture.cs  # Testcontainers setup
│           ├── TestWebApplicationFactory.cs
│           └── MockableTestFactory.cs
├── Dockerfile
└── EpCubeGraph.sln

# epcube-exporter (Python — deployed as Azure Container App)
local/
├── epcube-exporter/
│   ├── Dockerfile           # Built and pushed to ACR by deploy.sh
│   ├── exporter.py          # Cloud API poller + Prometheus metrics server
│   └── test_exporter.py     # Python test suite (49 tests)
├── mock-exporter/           # Mock data for local development
├── docker-compose.yml             # Legacy local dev stack
├── docker-compose.local.yml       # Local dev stack (mock data + VictoriaMetrics)
├── docker-compose.prod-local.yml  # Local dev stack (real cloud data)
└── vmagent/
    ├── scrape.yml                 # Scrape config for remote-write to Azure
    └── scrape-prod-local.yml      # Scrape config for local VictoriaMetrics

# Azure infrastructure (Terraform)
infra/
├── main.tf                  # Providers, resource group, managed identity
├── variables.tf             # Input variables with validation
├── outputs.tf               # Deployment outputs (FQDNs, IDs, URLs)
├── entra.tf                 # Entra ID app registration + service principal
├── acr.tf                   # Azure Container Registry + AcrPull role
├── keyvault.tf              # Key Vault for EP Cube creds + OAuth client secret
├── storage.tf               # Log Analytics + storage account + file share
├── container-apps.tf        # Container Apps: VictoriaMetrics (internal), API, epcube-exporter
├── deploy.sh                # Single-command deployment script
├── terraform.tfvars.example # Variable values template
└── .gitignore               # Excludes .terraform/, state files

# CI/CD
.github/
└── workflows/
    ├── ci.yml               # Build, test (100% coverage), Docker, Terraform validate
    └── cd.yml               # Deploy to Azure, validate, optional teardown
```

**Structure Decision**: Two top-level directories (`api/` and `local/`) reflecting the code organization: the API service and the data exporter. Infrastructure-as-code in `infra/`. All services deploy to the same Azure Container Apps environment. The API follows standard .NET solution layout with `src/` and `tests/` under `api/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| VictoriaMetrics (non-Azure-native) | Direct Prometheus remote-write compatibility, PromQL, simple single-container deployment | Azure Monitor Managed Prometheus: more complex config, higher cost at single-user scale, less direct PromQL control |
| Internal service communication without per-request auth (zero-trust) | API→VM and promscrape→exporter use unauthenticated HTTP within Container Apps internal network | mTLS between all containers: adds certificate lifecycle management disproportionate to single-user threat model. Endpoints expose no telemetry data. |
| API dev auth bypass (`NoAuthHandler.cs`) | Enables local development without Entra ID configuration (`Authentication:DisableAuth` setting) | Requiring Entra ID for local dev adds friction without security benefit (bypass only activates in Development environment) |
