# Deployment Guide

**Project**: EP Cube Graph
**Updated**: 2026-04-08

---

## Architecture Overview

All deployments run through GitHub Actions CD on a self-hosted runner VM. No local deployments to Azure.

```
GitHub Actions (CI)              GitHub Actions (CD)
  ubuntu-latest                    self-hosted runner (Azure VM)
  ┌─────────────┐                 ┌──────────────────────────────┐
  │ Build + Test │─workflow_run──►│ Bootstrap: RG + KV + PE      │
  │ 100% coverage│                │ Main: Infra + Apps + Secrets  │
  └─────────────┘                │ Build + Push Docker images    │
                                  │ Deploy SWA dashboard          │
                                  │ Validate deployment           │
                                  └──────────────────────────────┘
                                           │
                                           ▼
                                  Azure (centralus)
                                  ┌──────────────────────────────┐
                                  │ {env}-bootstrap-rg            │
                                  │   Key Vault (private EP only) │
                                  │   Runner PE                   │
                                  │                               │
                                  │ {env}-rg                      │
                                  │   Container Apps (API+Exporter)│
                                  │   PostgreSQL Flexible Server   │
                                  │   ACR, SWA, VNet, DNS         │
                                  └──────────────────────────────┘
```

> **First time?** Set up your development environment first — see [DEVELOP.md](DEVELOP.md).

---

## How Deployment Works

### Two Terraform Modules

Terraform is split into two root modules with separate state files to solve a Key Vault private endpoint ordering dependency:

| Module | Directory | State key | Creates |
|--------|-----------|-----------|---------|
| Bootstrap | `infra/bootstrap/` | `{env}-bootstrap.tfstate` | Resource group, Key Vault, runner private endpoint, DNS propagation wait |
| Main | `infra/` | `{env}.tfstate` | Everything else: VNet, PostgreSQL, Container Apps, ACR, SWA, KV secrets, DNS, Entra ID |

Bootstrap runs first. Main runs after the KV is reachable via private endpoint.

### CD Pipeline Flow

1. **CI** passes on `ubuntu-latest` (build, test, Docker build, Terraform validate)
2. **CD** triggers on the self-hosted runner:
   - Bootstrap init + apply (KV + PE)
   - Main init + apply (infra + secrets)
   - Docker build + push to ACR
   - Main apply again (container apps with images)
   - Dashboard build + deploy to SWA
   - Deployment validation
3. **Destroy** (manual dispatch or cleanup-branch):
   - Main destroy first (secrets, apps)
   - Bootstrap destroy second (KV, RG)

### Branch Behavior

| Branch | Environment | After merge |
|--------|-------------|-------------|
| Feature branches | Staging (`{env}-rg`) | Auto-destroyed by `cleanup-branch` job |
| `main` | Production (`epcubegraph-rg`) | Kept running |

---

## Initial Setup

### 1. Azure OIDC + Terraform State

Run the one-time setup script:

```bash
./scripts/setup-azure-cd.sh --github
```

This creates the OIDC app registration, Terraform state storage, and configures GitHub secrets.

### 2. Self-Hosted Runner

```bash
./scripts/create-runner.sh --pat <GITHUB_PAT>
```

Creates the runner VM (B2s, Ubuntu 24.04) with:
- VNet + private endpoints for tfstate storage and Key Vault
- No public IP, NSG denies all inbound (zero trust)
- Azure CLI, Terraform, .NET 10, Node 22, Docker, GitHub runner agent

To rebuild: `./scripts/teardown-runner.sh --pat <PAT>` then `./scripts/create-runner.sh --pat <PAT>`

### 3. GitHub Secrets

| Secret | Value |
|--------|-------|
| `AZURE_CLIENT_ID` | OIDC app registration client ID |
| `AZURE_TENANT_ID` | Entra ID tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `EPCUBE_USERNAME` | EP Cube cloud account email |
| `EPCUBE_PASSWORD` | EP Cube cloud account password |

### 4. GitHub Environments

| Environment | Protection |
|-------------|------------|
| `staging` | None (auto-deploy) |
| `production` | Required reviewers (recommended) |

---

## Manual Operations

### Deploy Production

Push to `main` — CI triggers CD automatically.

Or manual dispatch:
```bash
gh workflow run cd.yml --ref main -f environment=production
```

### Destroy an Environment

```bash
gh workflow run cd.yml --ref main -f environment=production -f destroy=true
```

### Emergency Cleanup

Deletes ALL epcubegraph Azure resources (RGs, DNS, state, KVs, Entra apps):

```bash
./scripts/scorched-earth.sh
```

### Validate Deployment

```bash
./infra/validate-deployment.sh --rg epcubegraph-rg
```

---

## What Gets Created

| Resource | RG | Purpose |
|----------|----|---------|
| Key Vault | bootstrap-rg | Stores credentials (private endpoint only) |
| Runner PE | bootstrap-rg | CD pipeline access to KV |
| Resource Group | main-rg | Container for app resources |
| Container Apps Environment | main-rg | Hosting platform |
| PostgreSQL Flexible Server | main-rg | Time-series DB (private) |
| epcube-exporter Container App | main-rg | Polls EP Cube cloud, writes to PG |
| API Container App | main-rg | ASP.NET Core, Entra ID auth |
| Container Registry | main-rg | Docker images |
| Static Web App | main-rg | Preact dashboard SPA |
| Entra ID App Registrations | (global) | OAuth 2.0 + user_impersonation |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| CD waiting for runner | `gh api repos/sstjean/epcubegraph/actions/runners` — runner should be `online` |
| Bootstrap fails | Check `az vm run-command` on runner for connectivity issues |
| KV secret write 403 | Runner PE DNS not propagated — bootstrap time_sleep may need increasing |
| State locked | `az vm run-command` to break lease on the blob (see `scripts/break-state-lock.sh`) |
| Orphaned DNS after destroy | Known issue #91 — manually delete CNAME/TXT records in `devsbx-shared` |
| Exporter no data | Check Container App logs for login errors; verify EP Cube credentials |
| Dashboard 404 on custom domain | SWA managed cert takes ~5 min to provision; try the default SWA URL first |
  