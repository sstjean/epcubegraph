# Quickstart: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07

---

## Prerequisites

- .NET 10 SDK
- Docker Desktop (or Docker Engine)
- Azure CLI (`az`) — for infrastructure deployment
- Terraform 1.5+
- An Azure subscription with Entra ID tenant
- EP Cube cloud account credentials (monitoring-us.epcube.com)

---

## 1. Clone and Set Up the API Service

```bash
git clone <repo-url> epcubegraph
cd epcubegraph

# Restore and build
dotnet restore api/EpCubeGraph.sln
dotnet build api/EpCubeGraph.sln
```

### API Dependencies (`EpCubeGraph.Api.csproj`)

| Package | Purpose |
|---------|---------|
| `Microsoft.Identity.Web` | Entra ID JWT validation + scope enforcement |
| `prometheus-net.AspNetCore` | Prometheus `/metrics` endpoint + HTTP metrics |
| `Azure.Identity` | Managed identity / DefaultAzureCredential |
| `Azure.Security.KeyVault.Secrets` | Key Vault access |
| `Swashbuckle.AspNetCore` | Swagger / OpenAPI docs |

All other dependencies (`HttpClient`, `System.Text.Json`, `IConfiguration`) are built into .NET 10.

### Test Dependencies (`EpCubeGraph.Api.Tests.csproj`)

| Package | Purpose |
|---------|---------|
| `xunit` | Test framework |
| `coverlet.collector` | Coverage reporting (100% required) |
| `Microsoft.AspNetCore.Mvc.Testing` | WebApplicationFactory for integration tests |
| `Testcontainers` | VictoriaMetrics integration tests |

---

## 2. Configure Environment Variables

### API Service

Create `api/src/EpCubeGraph.Api/appsettings.Development.json`:

```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<your-entra-tenant-id>",
    "ClientId": "<your-entra-app-client-id>",
    "Audience": "api://<your-entra-app-client-id>"
  },
  "VictoriaMetrics": {
    "Url": "http://localhost:8428"
  }
}
```

### Local Development Stack

For local development with mock data, create `local/.env`:

```bash
# Only needed for local testing with real cloud data
EPCUBE_USERNAME=your-email@example.com
EPCUBE_PASSWORD=your-epcube-password
```

For production, credentials are configured in `infra/terraform.tfvars`.

---

## 3. Run Tests

```bash
cd api

# Run all tests with coverage
dotnet test EpCubeGraph.sln --collect:"XPlat Code Coverage" -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura

# Run unit tests only
dotnet test tests/EpCubeGraph.Api.Tests --filter "Category=Unit"

# Run integration tests (requires Docker for Testcontainers)
dotnet test tests/EpCubeGraph.Api.Tests --filter "Category=Integration"

# View coverage report (requires reportgenerator tool)
dotnet tool install -g dotnet-reportgenerator-globaltool
reportgenerator -reports:"**/coverage.cobertura.xml" -targetdir:"coveragereport" -reporttypes:Html
```

Coverage must be 100% — enforced in CI.

---

## 4. Run the API Locally

```bash
cd api/src/EpCubeGraph.Api
dotnet run
```

API docs available at `https://localhost:5001/swagger` (Swagger UI with Entra ID auth flow).

Prometheus self-monitoring metrics available at `http://localhost:5000/metrics` (unauthenticated).

Or with hot reload:
```bash
dotnet watch run
```

---

## 5. Deploy to Azure

A single command deploys everything (VictoriaMetrics, epcube-exporter, API):

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with environment name and EP Cube credentials

./deploy.sh
```

### Verify Data Flow

After 2 scrape cycles (~2 minutes):

```bash
# Query via the API
API_FQDN=$(cd infra && terraform output -raw api_fqdn)
curl "https://$API_FQDN/api/v1/health"
```

### Local Development Stack (Optional)

For local development with mock data:

```bash
cd local
docker compose -f docker-compose.local.yml up -d
cd ../api/src/EpCubeGraph.Api && dotnet run
```

---

## 6. Deploy Azure Infrastructure

```bash
cd infra

# Login to Azure
az login

# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Apply infrastructure
terraform apply
```

Or use the provided deploy script for a two-phase deployment (infra first, then build/push API container and re-apply):

```bash
cd infra
./deploy.sh
```

This deploys:
- **Azure Container Apps Environment** — hosting for VictoriaMetrics + vmauth + API
- **VictoriaMetrics container** — time-series storage (`-retentionPeriod=5y`)
- **vmauth sidecar** — bearer token authentication for remote-write
- **API container** — ASP.NET Core service with Entra ID auth
- **Azure Key Vault** — stores remote-write bearer token
- **Entra ID App Registration** — OAuth 2.0 for API authentication

---

## Project Structure

```
epcubegraph/
├── api/                              # C# ASP.NET Core API service
│   ├── src/
│   │   └── EpCubeGraph.Api/
│   │       ├── Program.cs             # App entry, DI, auth, middleware
│   │       ├── appsettings.json       # Base configuration
│   │       ├── appsettings.Development.json
│   │       ├── EpCubeGraph.Api.csproj
│   │       ├── Models/                # Response records (DeviceInfo, ErrorResponse)
│   │       ├── Services/              # VictoriaMetrics client, grid calc
│   │       ├── Validate.cs            # Input validation helpers (FR-019)
│   │       └── Endpoints/             # Minimal API route groups
│   ├── tests/
│   │   └── EpCubeGraph.Api.Tests/
│   │       ├── Unit/                  # Pure unit tests (mocked HttpClient)
│   │       ├── Integration/           # Testcontainers + WebApplicationFactory + SC-003 latency
│   │       └── Fixtures/              # Shared test fixtures
│   ├── Dockerfile
│   └── EpCubeGraph.sln
├── local/                            # Local development + exporter source
│   ├── epcube-exporter/
│   │   ├── Dockerfile                # Python cloud API poller (built by deploy.sh)
│   │   └── exporter.py               # Cloud API → Prometheus metrics
│   ├── mock-exporter/                # Mock data for local dev
│   ├── docker-compose.local.yml      # Local dev stack (mock data)
│   └── docker-compose.prod-local.yml # Local dev stack (real cloud data)
├── infra/                            # Azure infrastructure (Terraform)
│   ├── main.tf                    # Providers, resource group, managed identity
│   ├── variables.tf               # Input variables with validation
│   ├── outputs.tf                 # Deployment outputs (FQDNs, IDs, URLs)
│   ├── entra.tf                   # Entra ID app registration
│   ├── acr.tf                     # Azure Container Registry
│   ├── keyvault.tf                # Key Vault for bearer token
│   ├── storage.tf                 # Log Analytics + storage
│   ├── container-apps.tf          # Container Apps environment
│   ├── deploy.sh                  # Two-phase deployment script
│   └── terraform.tfvars.example   # Variable values template
└── specs/                            # Specifications (this folder)
```

---

## Development Workflow

1. **Write a failing test** (TDD per constitution)
2. **Implement the minimum code** to pass it
3. **Refactor** if needed
4. **Run full test suite** — must pass with 100% coverage
5. **Commit** to feature branch `001-data-ingestor`
