# Implementation Plan: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-data-ingestor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a three-tier telemetry ingestion pipeline for EP Cube solar/battery gateways:

1. **Local tier** (Docker Compose on LAN): echonet-exporter polls EP Cube devices over ECHONET Lite (UDP 3610) and exposes Prometheus metrics; vmagent scrapes them and remote-writes to Azure over HTTPS with bearer-token auth.
2. **Storage tier** (Azure Container Apps): VictoriaMetrics single-node receives remote-write data, stores time-series with 5-year retention, handles deduplication natively.
3. **API tier** (Azure Container Apps): A C# ASP.NET Core Minimal API service queries VictoriaMetrics via PromQL and exposes a versioned REST API authenticated with Entra ID (OAuth 2.0 JWT) and authorized via `user_impersonation` scope. Also computes derived grid metrics. Emits structured JSON logs and exposes a `/metrics` endpoint for self-monitoring via `prometheus-net`.

## Technical Context

**Language/Version**: C# / .NET 8
**Primary Dependencies**: ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Azure.Identity, Azure.Security.KeyVault.Secrets
**Storage**: VictoriaMetrics single-node on Azure Container Apps (Prometheus remote-write ingestion, PromQL queries)
**Testing**: xUnit, coverlet (coverage), Microsoft.AspNetCore.Mvc.Testing (WebApplicationFactory), Testcontainers for .NET (integration tests with VictoriaMetrics)
**Target Platform**: Azure Container Apps (API + VictoriaMetrics); Docker on Linux ARM64/AMD64 (local ingestion stack)
**Project Type**: Web service (API) + Docker Compose orchestration (local stack)
**Performance Goals**: API queries for 30 days of data return within 2 seconds (SC-003), validated by integration test
**Constraints**: Single-user system; VictoriaMetrics single-node; 100% test coverage (constitution)
**Scale/Scope**: 1 user, 2–4 EP Cube devices, ~20 metrics at 1-minute intervals ≈ 28K data points/day

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Uses existing echonet-exporter (no custom protocol code), VictoriaMetrics (no custom TSDB), ASP.NET Core Minimal API (minimal framework). Fewest moving parts for the pipeline. |
| II | YAGNI | ✅ PASS | No speculative abstractions. Single-node VictoriaMetrics, single-user auth, no plugin system, no multi-tenant support. Every component maps to a current FR. |
| III | TDD | ✅ PASS | xUnit + coverlet enforced at 100%. Acceptance tests via Testcontainers for .NET with real VictoriaMetrics. Red-Green-Refactor mandated. |
| — | Dev Workflow | ✅ PASS | Feature branch `001-data-ingestor`, atomic commits, CI gate with full test suite. |
| — | Performance | ✅ PASS | VictoriaMetrics handles time-range queries efficiently (no full scans). API query <2s for 30 days (SC-003). Validated by integration test. |
| — | Platform: Azure | ✅ PASS | VictoriaMetrics + API on Azure Container Apps. Justified exception: VictoriaMetrics is not Azure-native but spec documents the choice (clarification Q3). |
| — | Platform: Docker | ✅ PASS | Local stack fully containerized (FR-015 through FR-018). Dockerfiles in repo. |
| — | Security: TLS | ✅ PASS | All endpoints HTTPS. Azure Container Apps provides TLS termination. |
| — | Security: Auth | ✅ PASS | Remote-write: bearer token from Key Vault (FR-012). API: Entra ID OAuth 2.0 JWT (FR-010). |
| — | Security: Authz | ✅ PASS | `user_impersonation` scope required on all telemetry endpoints (FR-010a). Health and metrics endpoints are unauthenticated but expose no telemetry data. |
| — | Security: Input Validation | ✅ PASS | FR-019 requires param presence/type validation. PromQL passthrough is unrestricted by design (clarification Q9). |
| — | Security: Zero-Trust | ✅ PASS | Every request authenticated regardless of origin. No implicit trust between tiers. Least privilege via managed identities. |
| — | Security: Secrets | ✅ PASS | Bearer token in Azure Key Vault, injected as Container Apps secret. No secrets in source. |
| — | Security: Tokens | ⚠ COMPLEXITY | Remote-write uses a pre-shared bearer token (FR-012) — technically a long-lived static token. Constitution prohibits long-lived static tokens. See Complexity Tracking. |
| — | DevOps: IaC | ✅ PASS | All Azure infrastructure defined in Bicep templates under `infra/`. No manual portal resource creation. |
| — | DevOps: CI/CD | ✅ PASS | CI gate enforces full test suite before merge. Pipeline deploys on main branch merge. |
| — | DevOps: Reproducible | ✅ PASS | Container images built from Dockerfiles in repo. Azure infra from Bicep with parameters. Same commit → same deployment. |
| — | DevOps: Rollback | ✅ PASS | Container Apps uses tagged container images. No `latest` tag in production. Revision-based rollback supported natively. |
| — | DevOps: Local | ✅ PASS | `docker compose up -d` builds and starts all local services. Operator only provides `.env` values (device IPs, remote-write URL, token). |

### Complexity Tracking — VictoriaMetrics Exception

The constitution requires Azure-native services. VictoriaMetrics is not Azure-native. This is documented as a justified exception per the spec clarification Q3. Azure Monitor Managed Prometheus was evaluated and rejected because VictoriaMetrics is simpler (single container, no Azure-specific config, direct PromQL support, lower cost for single-user scale).

### Complexity Tracking — Remote-Write Bearer Token

The constitution prohibits long-lived static tokens. The remote-write bearer token (FR-012) is a pre-shared secret with no expiry mechanism from vmagent's side. This is justified because: (1) vmagent has no built-in OAuth client-credentials flow; (2) the token is stored in Key Vault and can be rotated manually; (3) the simpler alternative (no auth) was rejected as it violates zero-trust. Mitigations: periodic manual rotation via Key Vault policy, and the token scope is limited to write-only on a single VictoriaMetrics instance.

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
│       ├── appsettings.Development.json
│       ├── EpCubeGraph.Api.csproj
│       ├── Models/
│       │   ├── DeviceInfo.cs         # Device response record
│       │   ├── HealthResponse.cs     # Health check record
│       │   ├── DeviceMetricsResponse.cs
│       │   └── ErrorResponse.cs      # Error envelope (Prometheus-compatible)
│       ├── Services/
│       │   ├── IVictoriaMetricsClient.cs  # PromQL query interface
│       │   ├── VictoriaMetricsClient.cs   # HttpClient-based implementation
│       │   └── GridCalculator.cs          # Derived grid calculation
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
│       │   └── VictoriaMetricsClientTests.cs
│       ├── Integration/
│       │   ├── ApiIntegrationTests.cs
│       │   ├── VictoriaMetricsIntegrationTests.cs
│       │   └── PerformanceTests.cs        # SC-003 latency validation
│       └── Fixtures/
│           └── VictoriaMetricsFixture.cs  # Testcontainers setup
├── Dockerfile
└── EpCubeGraph.sln

# Local ingestion stack (Docker Compose on LAN)
local/
├── docker-compose.yml       # Orchestrates echonet-exporter + vmagent
├── .env.example             # Template for device IPs, remote-write URL, token
├── echonet-exporter/
│   └── Dockerfile           # Builds echonet-exporter from source
└── vmagent/
    └── scrape.yml           # Prometheus scrape config for echonet-exporter

# Azure infrastructure
infra/
├── main.bicep               # Container Apps environment, VictoriaMetrics, API
├── keyvault.bicep            # Key Vault for bearer token + managed identity
└── parameters.json
```

**Structure Decision**: Two top-level directories (`api/` and `local/`) reflecting the two deployment targets: Azure Container Apps and LAN Docker host. Infrastructure-as-code in `infra/`. This mirrors the physical architecture (local → Azure) and keeps concerns separated without unnecessary abstraction. The API follows standard .NET solution layout with `src/` and `tests/` under `api/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| VictoriaMetrics (non-Azure-native) | Direct Prometheus remote-write compatibility, PromQL, simple single-container deployment | Azure Monitor Managed Prometheus: more complex config, higher cost at single-user scale, less direct PromQL control |
| Pre-shared bearer token for remote-write (long-lived) | vmagent has no built-in OAuth client-credentials flow | No auth: violates zero-trust. Mitigated by Key Vault storage and manual rotation policy |
