# Implementation Plan: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-27 | **Spec**: [spec.md](spec.md)  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3) · **User Stories**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)

## Summary

Build and operate a three-tier telemetry ingestion pipeline for EP Cube solar and battery gateways:

1. **Ingestion tier**: `epcube-exporter` polls the EP Cube cloud API, normalizes telemetry, creates schema if needed, and writes directly to PostgreSQL.
2. **Storage tier**: PostgreSQL stores device metadata and time-series readings with deduplication by unique key.
3. **API tier**: ASP.NET Core Minimal API exposes authenticated `/api/v1` endpoints backed by PostgreSQL and returns clean JSON response models.

Azure deployments host the API and exporter in Azure Container Apps and use Azure Database for PostgreSQL Flexible Server for storage. Local development uses Docker Compose with PostgreSQL 17.

## Technical Context

**Language/Version**: C# / .NET 10 for API, Python 3.12 for exporter  
**Primary Dependencies**: ASP.NET Core Minimal API, Microsoft.Identity.Web, Npgsql, prometheus-net.AspNetCore, Swashbuckle.AspNetCore, psycopg2, OpenCV, PyCryptodome  
**Storage**: PostgreSQL 17 locally; Azure Database for PostgreSQL Flexible Server in Azure  
**Testing**: xUnit + coverlet + WebApplicationFactory + Testcontainers.PostgreSql for API, Python exporter tests for the writer and cloud polling logic  
**Target Platform**: Azure Container Apps + Azure Database for PostgreSQL Flexible Server  
**Project Type**: Cloud-deployed ingestion service + web API  
**Performance Goals**: Up to 30 days of API query data returned within 2 seconds  
**Constraints**: 100% coverage gates, authenticated client access, Azure-first deployment, private runtime database path  
**Scale/Scope**: Single-user system, 2–4 devices, continuous long-term retention

## Constitution Check

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Simplicity | ✅ PASS | Direct exporter-to-PostgreSQL writes and a single API data-store implementation keep the system narrow and readable. |
| II | YAGNI | ✅ PASS | No speculative plugin system, multi-tenant model, or alternate storage abstraction. |
| III | TDD | ✅ PASS | API and exporter both have enforced automated tests with coverage gates. |
| — | Platform: Azure | ✅ PASS | Azure runtime uses Container Apps, Key Vault, and managed PostgreSQL. |
| — | Security | ✅ PASS | Entra ID auth on telemetry endpoints, private database networking, secrets in Key Vault. |
| — | DevOps | ✅ PASS | Terraform-managed infra, reproducible Docker images, CI/CD validation. |

## Architecture

### Runtime Flow

1. `epcube-exporter` authenticates with the EP Cube cloud API.
2. The exporter polls device telemetry and converts it into normalized readings.
3. The exporter upserts device metadata into `devices` and readings into `readings`.
4. The API queries PostgreSQL through `IMetricsStore` and `PostgresMetricsStore`.
5. Clients consume `/api/v1` JSON endpoints.

### Storage Design

- `devices` stores metadata and alias information.
- `readings` stores one row per device, metric, and timestamp.
- A unique constraint on `(device_id, metric_name, timestamp)` guarantees deduplication.
- Range queries use bucketed aggregation for requested step sizes.

## Project Structure

```text
specs/001-data-ingestor/
├── plan.md
├── spec.md
├── tasks.md
├── data-model.md
├── quickstart.md
├── research.md
├── research-validation.md
└── contracts/
    └── api-v1.md

api/
├── src/
│   └── EpCubeGraph.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── NoAuthHandler.cs
│       ├── Models/
│       │   └── Models.cs
│       ├── Services/
│       │   ├── IMetricsStore.cs
│       │   └── PostgresMetricsStore.cs
│       ├── Endpoints/
│       │   ├── DevicesEndpoints.cs
│       │   ├── GridEndpoints.cs
│       │   ├── HealthEndpoints.cs
│       │   └── ReadingsEndpoints.cs
│       └── Validate.cs
└── tests/
    └── EpCubeGraph.Api.Tests/

local/
├── epcube-exporter/
│   ├── Dockerfile
│   ├── exporter.py
│   └── test_exporter.py
├── docker-compose.prod-local.yml
└── docker-compose.local.yml

infra/
├── container-apps.tf
├── postgres.tf
├── network.tf
├── keyvault.tf
├── outputs.tf
├── deploy.sh
└── validate-deployment.sh
```

## Operational Decisions

### Authentication and Authorization

- Telemetry endpoints require Entra ID bearer tokens.
- `user_impersonation` is enforced as the default authorization scope.
- `/metrics` and exporter `/health` remain unauthenticated because they expose operational state, not user telemetry.

### Local Development

- Manual local verification uses `docker-compose.prod-local.yml` with real EP Cube cloud credentials.
- The API defaults to a local PostgreSQL connection string unless overridden.
- The exporter creates schema objects automatically on startup.

### Azure Deployment

- API and exporter run in Container Apps.
- PostgreSQL Flexible Server is deployed on a delegated subnet with private DNS.
- Key Vault stores API and exporter connection strings and cloud credentials.

## Complexity Tracking

| Decision | Why It Exists | Simpler Alternative Rejected Because |
|----------|---------------|--------------------------------------|
| Unauthenticated operational endpoints (`/metrics`, exporter `/health`) | They support monitoring and expose no user telemetry | Requiring auth for operational endpoints adds friction without protecting sensitive data paths |
| Exporter remains Python while API is C# | The captcha and cloud-auth implementation already exists and is validated in Python | Rewriting the exporter now would expand scope without improving current functionality |

## Current State

- Core ingestion, storage, API, and Azure deployment paths exist.
- PostgreSQL is the active storage architecture everywhere.
- Remaining work in the broader repo is infrastructure stabilization and downstream client polish, not storage migration.
