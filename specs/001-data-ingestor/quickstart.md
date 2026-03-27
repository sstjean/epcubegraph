# Quickstart: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-27

## Prerequisites

- .NET 10 SDK
- Docker Desktop or Docker Engine with Compose
- Terraform 1.5+
- Azure CLI (`az`)
- An Azure subscription with Entra ID tenant access
- EP Cube cloud credentials for manual local verification or Azure deployment

## 1. Clone and Build

```bash
git clone <repo-url> epcubegraph
cd epcubegraph
dotnet restore api/EpCubeGraph.sln
dotnet build api/EpCubeGraph.sln
```

## 2. Configure Local Development

Create `api/src/EpCubeGraph.Api/appsettings.Development.json`:

```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<your-entra-tenant-id>",
    "ClientId": "<your-entra-app-client-id>",
    "Audience": "api://<your-entra-app-client-id>"
  },
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Port=5432;Database=epcubegraph;Username=epcube;Password=epcube_local"
  }
}
```

Create `local/.env` for manual local verification:

```bash
EPCUBE_USERNAME=your-email@example.com
EPCUBE_PASSWORD=your-epcube-password
```

## 3. Start the Local Stack

Manual local verification uses the real-data compose file:

```bash
cd local
docker compose -f docker-compose.prod-local.yml up -d
```

`docker-compose.local.yml` is reserved for automated test scenarios and is not part of the manual quickstart flow.

## 4. Run the API Locally

```bash
cd api/src/EpCubeGraph.Api
dotnet run
```

Useful local endpoints:

- Swagger UI: `http://localhost:5062/swagger`
- API health: `http://localhost:5062/api/v1/health`
- API metrics: `http://localhost:5062/metrics`

## 5. Run Tests

```bash
cd api
dotnet test EpCubeGraph.sln --collect:"XPlat Code Coverage" -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura
```

Coverage must remain at 100%.

## 6. Smoke-Test the Local API

After the exporter has written data:

```bash
curl -sf "http://localhost:5062/api/v1/health"
curl -sf "http://localhost:5062/api/v1/devices"
curl -sf "http://localhost:5062/api/v1/readings/current?metric=grid_power_watts"
```

## 7. Deploy to Azure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Fill in environment_name, location, epcube_username, epcube_password
./deploy.sh
```

The Azure deployment creates:

- Azure Container Apps Environment
- API Container App
- epcube-exporter Container App
- Azure Database for PostgreSQL Flexible Server
- Key Vault
- Container Registry
- Supporting network resources and outputs

## 8. Verify the Azure Stack

```bash
cd infra
./deploy.sh --output
API_FQDN=$(terraform output -raw api_fqdn)
curl -sf "https://$API_FQDN/api/v1/health"
```

Telemetry should begin appearing within a few minutes of deployment completion.
