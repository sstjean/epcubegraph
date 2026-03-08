# epcubegraph Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-07

## Active Technologies
- C# / .NET 8 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation), HttpClient (VictoriaMetrics queries, built-in), Azure.Identity, Azure.Security.KeyVault.Secrets (001-data-ingestor)
- VictoriaMetrics single-node on Azure Container Apps (Prometheus remote-write ingestion, PromQL queries) (001-data-ingestor)
- C# / .NET 8 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Azure.Identity, Azure.Security.KeyVault.Secrets (001-data-ingestor)

- Python 3.12 + FastAPI, uvicorn, httpx (VictoriaMetrics queries), python-jose (JWT validation), azure-identity, azure-keyvault-secrets (001-data-ingestor)

## Project Structure

```text
src/
tests/
```

## Commands

cd src [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] pytest [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] ruff check .

## Code Style

Python 3.12: Follow standard conventions

## Recent Changes
- 001-data-ingestor: Added C# / .NET 8 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation + scope enforcement), HttpClient (VictoriaMetrics queries, built-in), prometheus-net.AspNetCore (Prometheus /metrics endpoint), Azure.Identity, Azure.Security.KeyVault.Secrets
- 001-data-ingestor: Added C# / .NET 8 + ASP.NET Core Minimal API, Microsoft.Identity.Web (Entra ID JWT validation), HttpClient (VictoriaMetrics queries, built-in), Azure.Identity, Azure.Security.KeyVault.Secrets

- 001-data-ingestor: Added Python 3.12 + FastAPI, uvicorn, httpx (VictoriaMetrics queries), python-jose (JWT validation), azure-identity, azure-keyvault-secrets

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
