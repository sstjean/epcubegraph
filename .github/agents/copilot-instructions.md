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

## Project Structure

```text
api/                    # .NET 10 API (src/ + tests/)
  src/EpCubeGraph.Api/  # Minimal API with PromQL passthrough + device endpoints
  tests/                # xUnit tests (Unit/ + Integration/ with Testcontainers)
infra/                  # Terraform IaC (Container Apps, Key Vault, ACR, Entra ID)
local/                  # Docker Compose stack (echonet-exporter + vmagent)
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
- 001-data-ingestor: Added C# / .NET 10 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Swashbuckle.AspNetCore (Swagger/OpenAPI)
- 001-data-ingestor: C# / .NET 10 Minimal API with PromQL passthrough endpoints, device discovery, VictoriaMetrics time-series backend, Terraform IaC on Azure Container Apps

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

````
