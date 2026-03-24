# Implementation Plan: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-16 | **Spec**: [spec.md](spec.md)  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3) · **User Stories**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)  
**Input**: Feature specification from `/specs/001-data-ingestor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a three-tier telemetry ingestion pipeline for EP Cube solar/battery gateways:

1. **Ingestion tier** (Azure Container Apps): epcube-exporter polls EP Cube devices via the cloud API (monitoring-us.epcube.com) and exposes Prometheus metrics; the data store scrapes them directly within the same Container Apps environment.
2. **Storage tier** (Azure Container Apps): Time-series data store with indefinite retention, handling deduplication natively. *(Currently VictoriaMetrics — migration to Azure SQL Database planned.)*
3. **API tier** (Azure Container Apps): A C# ASP.NET Core Minimal API service queries the data store and exposes a versioned REST API authenticated with Entra ID (OAuth 2.0 JWT) and authorized via `user_impersonation` scope. Also exposes grid energy balance (import minus export). Emits structured JSON logs and exposes a `/metrics` endpoint for self-monitoring via `prometheus-net`.

## Technical Context

**Language/Version**: C# / .NET 10
**Primary Dependencies**: ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (data store queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint + HTTP metrics), Swashbuckle.AspNetCore (Swagger/OpenAPI)
**Storage**: Time-series data store on Azure Container Apps *(currently VictoriaMetrics — migration to Azure SQL Database planned)*
**Testing**: xUnit, coverlet (coverage), Microsoft.AspNetCore.Mvc.Testing (WebApplicationFactory), Testcontainers for .NET (integration tests with data store)
**Target Platform**: Azure Container Apps (all services: data store, epcube-exporter, API)
**Project Type**: Web service (API) + cloud-deployed data ingestion
**Performance Goals**: API queries for 30 days of data return within 2 seconds (SC-003), validated by integration test
**Constraints**: Single-user system; single-node data store; 100% test coverage (constitution)
**Scale/Scope**: 1 user, 2–4 EP Cube devices, ~20 metrics at 1-minute intervals ≈ 28K data points/day

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Uses epcube-exporter (cloud API poller), single-node data store, ASP.NET Core Minimal API (minimal framework). Everything runs in a single Azure Container Apps environment. |
| II | YAGNI | ✅ PASS | No speculative abstractions. Single-node data store, single-user auth, no plugin system, no multi-tenant support. Every component maps to a current FR. |
| III | TDD | ✅ PASS | xUnit + coverlet enforced at 100%. Acceptance tests via Testcontainers for .NET. Red-Green-Refactor mandated. |
| — | Dev Workflow | ✅ PASS | Feature branch `001-data-ingestor`, atomic commits, CI gate with full test suite. |
| — | Performance | ✅ PASS | Data store handles time-range queries efficiently. API query <2s for 30 days (SC-003). Validated by integration test. |
| — | Platform: Azure | ✅ PASS | Data store + API on Azure Container Apps. Storage backend migration to Azure SQL Database planned. |
| — | Platform: Docker | ✅ PASS | All services containerized in Azure Container Apps. Dockerfiles in repo. |
| — | Security: TLS | ✅ PASS | All endpoints HTTPS. Azure Container Apps provides TLS termination. |
| — | Security: Auth | ✅ PASS | API: Entra ID OAuth 2.0 JWT (FR-010). Exporter debug page: OAuth authorization code flow with session cookies. Health/metrics endpoints unauthenticated (no telemetry data). |
| — | Security: Authz | ✅ PASS | `user_impersonation` scope required on all telemetry endpoints (FR-010a). Health and metrics endpoints are unauthenticated but expose no telemetry data. |
| — | Security: Input Validation | ✅ PASS | FR-019 requires param presence/type validation. Query passthrough is unrestricted by design (clarification Q9). |
| — | Security: Zero-Trust | ⚠ COMPLEXITY | Internal service communication (API→data store queries, scraper→exporter /metrics) uses no per-request auth. See Complexity Tracking. |
| — | Security: Secrets | ✅ PASS | Bearer token in Azure Key Vault, injected as Container Apps secret. No secrets in source. |
| — | DevOps: IaC | ✅ PASS | All Azure infrastructure defined in Terraform under `infra/`. No manual portal resource creation. |
| — | DevOps: CI/CD | ✅ PASS | CI gate enforces full test suite before merge. Pipeline deploys on main branch merge. |
| — | DevOps: Reproducible | ✅ PASS | Container images built from Dockerfiles in repo. Azure infra from Terraform with variables. Same commit → same deployment. |
| — | DevOps: Rollback | ✅ PASS | Container Apps uses tagged container images. No `latest` tag in production. Revision-based rollback supported natively. |
| — | DevOps: Local | ✅ PASS | `infra/deploy.sh` builds and deploys everything. Operator only provides `terraform.tfvars` values (environment name, EP Cube credentials). |

### Complexity Tracking — Storage Backend Exception

The constitution requires Azure-native services. The current storage backend (VictoriaMetrics) is not Azure-native. Migration to Azure SQL Database (serverless) is planned, which will resolve this exception.

### Complexity Tracking — Internal Service Communication Without Per-Request Auth

The constitution's zero-trust principle requires "internal services MUST NOT trust each other without explicit, per-request credential verification" and "Network location MUST NOT be treated as proof of trust." Two internal communication paths have no per-request authentication: (1) API queries the data store via HTTP over the Container Apps internal network, and (2) the data store scrapes epcube-exporter's `/metrics` endpoint. This is justified because: (1) the data store is internal-only (no external ingress) — unreachable from the internet; (2) `/metrics` and `/health` endpoints expose only operational counters and process metrics, never telemetry data (FR-021, FR-022); (3) the Container Apps environment provides network isolation at the platform level. Alternative rejected: mTLS between all containers adds certificate lifecycle management complexity disproportionate to the threat model of a single-user system with no multi-tenant data.

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
       │   ├── IVictoriaMetricsClient.cs  # Data store query interface (name pending rename)
       │   ├── VictoriaMetricsClient.cs   # HttpClient-based implementation (name pending rename)
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
       │   └── VictoriaMetricsClientTests.cs  # Data store client tests (name pending rename)
       ├── Integration/
       │   ├── ApiIntegrationTests.cs
       │   ├── EndpointTests.cs
       │   ├── SecurityTests.cs
       │   ├── ProgramMiddlewareTests.cs
       │   ├── VictoriaMetricsIntegrationTests.cs  # Data store integration tests (name pending rename)
       │   └── PerformanceTests.cs        # SC-003 latency validation
       └── Fixtures/
           ├── VictoriaMetricsFixture.cs  # Testcontainers setup (name pending rename)
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
├── docker-compose.local.yml       # Local dev stack (mock data)
├── docker-compose.prod-local.yml  # Local dev stack (real cloud data)
└── vmagent/
    ├── scrape-local.yml           # Scrape config for local mock-exporter
    └── scrape-prod-local.yml      # Scrape config for local data store

# Azure infrastructure (Terraform)
infra/
├── main.tf                  # Providers, resource group, managed identity
├── variables.tf             # Input variables with validation
├── outputs.tf               # Deployment outputs (FQDNs, IDs, URLs)
├── entra.tf                 # Entra ID app registration + service principal
├── acr.tf                   # Azure Container Registry + AcrPull role
├── keyvault.tf              # Key Vault for EP Cube creds + OAuth client secret
├── storage.tf               # Log Analytics + storage account + file share
├── network.tf               # VNet, subnets, private endpoints + DNS for KV and Storage
├── container-apps.tf        # Container Apps (VNet-integrated): data store, API, exporter
├── deploy.sh                # Single-command deployment script
├── validate-deployment.sh   # Post-deployment resource validation (deploy.sh --validate)
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
| Non-Azure-native storage backend (pending migration) | Currently VictoriaMetrics; migration to Azure SQL Database planned | Azure Monitor Managed Prometheus was evaluated and rejected. Azure SQL migration will resolve this exception. |
| Internal service communication without per-request auth (zero-trust) | API→data store and scraper→exporter use unauthenticated HTTP within Container Apps internal network | mTLS between all containers: adds certificate lifecycle management disproportionate to single-user threat model. Endpoints expose no telemetry data. |
| VNet + Private Endpoints for KV and Storage | Container Apps must access Key Vault secrets via managed identity through private network; data-plane firewalls stay at Deny. Also required for Storage file share mount. | Passing secrets as direct Terraform values: violates constitution (secrets MUST use Key Vault). Adding Container Apps outbound IPs to firewall: unreliable — Consumption plan IPs are dynamic and shared. |
| Storage file share access_key (zero-trust: Explicit Verification) | `azurerm_container_app_environment_storage` requires `access_key` — Azure Container Apps has no managed identity option for file share mounts. This is an Azure platform limitation. Private endpoint ensures traffic stays on private network; access_key provides authentication (not identity-based). | No alternative exists. Tracked for remediation when Azure adds identity-based file mount support. Will be revisited during Azure SQL migration. |
| API dev auth bypass (`NoAuthHandler.cs`) | Enables local development without Entra ID configuration (`Authentication:DisableAuth` setting) | Requiring Entra ID for local dev adds friction without security benefit (bypass only activates in Development environment) |
| Single environment (Environment Parity deferral) | Only one Azure environment exists during 001-data-ingestor. Constitution's Environment Parity (NON-NEGOTIABLE) is trivially satisfied with one environment but requires staging/production parity when multi-environment support is added. | Deferred to Phase 8 / Issue [#12](https://github.com/sstjean/epcubegraph/issues/12). Adding a second environment before the initial feature is complete adds scope without benefit. |
