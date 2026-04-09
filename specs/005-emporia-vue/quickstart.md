# Quickstart: Emporia Vue Energy Monitoring

**Branch**: `005-emporia-vue` | **Date**: 2026-04-08

## Prerequisites

- Docker and Docker Compose installed
- .NET 10 SDK installed
- Emporia Vue account with username/password
- EP Cube cloud account (existing, for the epcube-exporter) — optional if only running Vue

## Environment Setup

### 1. Add Vue Credentials to `.env`

```bash
cd local
# Edit .env (or .env.example → .env if first time)
# Add alongside existing EPCUBE_USERNAME / EPCUBE_PASSWORD:
EMPORIA_USERNAME=your-emporia-email@example.com
EMPORIA_PASSWORD=your-emporia-password
```

**Note**: Either credential set is sufficient — the exporter runs whichever collector has credentials configured. If only Vue creds are set, only the Vue collector starts (and vice versa).

### 2. Start the Local Stack

```bash
cd local
docker compose -f docker-compose.prod-local.yml up -d --build
```

This starts:
- **PostgreSQL 17** on `localhost:5432` (user: `epcube`, db: `epcubegraph`)
- **epcube-exporter** on `localhost:9250` — polls both EP Cube (60s) and Emporia Vue (1s)

### 3. Verify Vue Data Ingestion

```bash
# Check exporter debug page — should show Vue status section
open http://localhost:9250

# Check PostgreSQL for Vue data (after ~10 seconds)
docker exec -it local-postgres-1 psql -U epcube -d epcubegraph \
  -c "SELECT device_gid, channel_num, value, timestamp FROM vue_readings ORDER BY timestamp DESC LIMIT 10;"
```

### 4. Run the API

```bash
cd api/src/EpCubeGraph.Api
EPCUBE_DISABLE_AUTH=true ASPNETCORE_ENVIRONMENT=Development dotnet run
```

API available at `http://localhost:5062/api/v1`

```bash
# Vue devices
curl http://localhost:5062/api/v1/vue/devices | jq

# Current readings for a device
curl http://localhost:5062/api/v1/vue/devices/12345/readings/current | jq

# Panel total (raw + deduplicated)
curl http://localhost:5062/api/v1/vue/panels/12345/total | jq

# Total home (sum of top-level panels)
curl http://localhost:5062/api/v1/vue/home/total | jq
```

## Running Tests

```bash
# All API tests (xUnit + Testcontainers — requires Docker)
cd api && dotnet test EpCubeGraph.sln

# Exporter tests
cd local/epcube-exporter && python -m pytest test_exporter.py -v
```

## Key URLs (Local)

| Service | URL |
|---------|-----|
| Exporter debug page | http://localhost:9250 |
| PostgreSQL | `localhost:5432` (user: `epcube`, pass: `epcube_local`, db: `epcubegraph`) |
| API health | http://localhost:5062/api/v1/health |
| API Vue devices | http://localhost:5062/api/v1/vue/devices |
| API total home | http://localhost:5062/api/v1/vue/home/total |

## Docker Compose Changes

The `docker-compose.prod-local.yml` gains two new environment variables for the epcube-exporter service:

```yaml
epcube-exporter:
  environment:
    # Existing
    - EPCUBE_USERNAME=${EPCUBE_USERNAME}
    - EPCUBE_PASSWORD=${EPCUBE_PASSWORD}
    # New for Feature 005
    - EMPORIA_USERNAME=${EMPORIA_USERNAME}
    - EMPORIA_PASSWORD=${EMPORIA_PASSWORD}
```

## Terraform Changes

The `infra/container-apps.tf` gains two new secrets and environment variable references for the exporter Container App:

```hcl
# Secrets (from Key Vault)
secret {
  name                = "emporia-username"
  key_vault_secret_id = azurerm_key_vault_secret.emporia_username.versionless_id
  identity            = azurerm_user_assigned_identity.main.id
}
secret {
  name                = "emporia-password"
  key_vault_secret_id = azurerm_key_vault_secret.emporia_password.versionless_id
  identity            = azurerm_user_assigned_identity.main.id
}

# Environment variables in container template
env {
  name        = "EMPORIA_USERNAME"
  secret_name = "emporia-username"
}
env {
  name        = "EMPORIA_PASSWORD"
  secret_name = "emporia-password"
}
```

## Troubleshooting

- **No Vue data in PostgreSQL**: Check exporter logs (`docker logs local-epcube-exporter-1`). Look for Vue authentication errors. Verify `EMPORIA_USERNAME` and `EMPORIA_PASSWORD` are set correctly.
- **Only one collector running**: This is expected if only one credential set is configured. Check logs for "Vue credentials not configured, skipping" or similar warning.
- **Rate limiting**: If the debug page shows Vue scale degraded to `1MIN`, the Emporia API is rate-limiting. This is automatic recovery — will try `1S` again after successful polls.
- **Offline device**: Expect `None` readings for offline devices — check the debug page for per-device status.
