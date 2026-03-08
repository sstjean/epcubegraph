# Quickstart: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07

---

## Prerequisites

- .NET 10 SDK
- Docker Desktop (or Docker Engine + Docker Compose v2)
- Azure CLI (`az`) — for infrastructure deployment
- An Azure subscription with Entra ID tenant
- EP Cube gateway device(s) on the local network

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

### Local Ingestion Stack

Create `local/.env`:

```bash
# echonet-exporter device configuration
EPCUBE_BATTERY_IP=192.168.1.10
EPCUBE_SOLAR_IP=192.168.1.10

# Remote-write target (Azure-hosted VictoriaMetrics via vmauth)
REMOTE_WRITE_URL=https://epcubegraph-vm.<region>.azurecontainerapps.io/api/v1/write
REMOTE_WRITE_TOKEN=<token-from-azure-key-vault>
```

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

## 5. Deploy the Local Ingestion Stack

On a LAN-connected device (e.g., Raspberry Pi, NAS):

```bash
cd local

# Configure devices and remote-write target
cp .env.example .env
# Edit .env with your device IPs, remote-write URL, and bearer token

# Build and start
docker compose up -d

# Verify containers are running
docker compose ps

# Check echonet-exporter metrics
curl http://localhost:9191/metrics

# View vmagent logs (confirm remote-write is succeeding)
docker compose logs vmagent --tail=20
```

### Verify Data Flow

After 2 scrape cycles (~2 minutes):

```bash
# Query VictoriaMetrics directly (from a machine that can reach the Azure endpoint)
curl -H "Authorization: Bearer <token>" \
  "https://epcubegraph-vm.<region>.azurecontainerapps.io/api/v1/query?query=echonet_battery_state_of_capacity_percent"
```

---

## 6. Deploy Azure Infrastructure

```bash
cd infra

# Login to Azure
az login

# Deploy Bicep templates
az deployment group create \
  --resource-group epcubegraph-rg \
  --template-file main.bicep \
  --parameters parameters.json
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
│   │       ├── Integration/           # Testcontainers + WebApplicationFactory
│   │       ├── Performance/           # SC-003 latency tests (Testcontainers)
│   │       └── Fixtures/              # Shared test fixtures
│   ├── Dockerfile
│   └── EpCubeGraph.sln
├── local/                            # Local ingestion stack
│   ├── docker-compose.yml            # echonet-exporter + vmagent
│   ├── .env.example                  # Template for local config
│   ├── echonet-exporter/
│   │   └── Dockerfile                # Multi-arch Go build
│   └── vmagent/
│       └── scrape.yml                # Prometheus scrape config
├── infra/                            # Azure infrastructure
│   ├── main.bicep                    # Container Apps + Key Vault
│   ├── keyvault.bicep                # Key Vault module
│   └── parameters.json               # Deployment parameters
└── specs/                            # Specifications (this folder)
```

---

## Development Workflow

1. **Write a failing test** (TDD per constitution)
2. **Implement the minimum code** to pass it
3. **Refactor** if needed
4. **Run full test suite** — must pass with 100% coverage
5. **Commit** to feature branch `001-data-ingestor`
