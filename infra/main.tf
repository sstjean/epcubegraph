# EP Cube Graph — Azure Infrastructure (Terraform)
# Providers, resource group, managed identity, data sources, locals

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Remote state in Azure Blob Storage — required for CI/CD deployments.
  # The storage account must be pre-created (see DEPLOY.md § CI/CD Setup).
  # For local-only usage, comment this block and state is stored locally.
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "tfstateepcubegraph"
    container_name       = "tfstate"
    key                  = "epcubegraph.tfstate"
    use_oidc             = true
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
  storage_use_azuread = true
}

provider "azuread" {}

# ── Data Sources ──

data "azurerm_client_config" "current" {}
data "azuread_client_config" "current" {}

# ── Resource Group ──

resource "azurerm_resource_group" "main" {
  name     = "${var.environment_name}-rg"
  location = var.location
}

# ── Managed Identity ──

resource "azurerm_user_assigned_identity" "main" {
  name                = "${var.environment_name}-identity"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

# ── Locals ──

locals {
  # vmauth config YAML with env-var placeholder for runtime substitution
  # vmauth resolves %{REMOTE_WRITE_TOKEN} from its own environment at startup
  #
  # unauthorized_user allows the API container app (and external reads) to
  # query VictoriaMetrics through vmauth without a bearer token. Only safe
  # read paths are allowed; writes still require the bearer token.
  vmauth_config = <<-YAML
users:
- bearer_token: "%%{REMOTE_WRITE_TOKEN}"
  url_prefix: "http://localhost:8428/"
unauthorized_user:
  url_map:
  - src_paths:
    - "/api/v1/query.*"
    - "/api/v1/series.*"
    - "/api/v1/labels.*"
    - "/api/v1/label/.+"
    - "/health"
    url_prefix: "http://localhost:8428/"
YAML

  vmauth_config_b64 = base64encode(local.vmauth_config)

  # VictoriaMetrics promscrape config — scrapes epcube-exporter within the
  # Container Apps environment via internal ingress (HTTP port 80 → target 9200)
  promscrape_config = <<-YAML
scrape_configs:
  - job_name: echonet
    static_configs:
      - targets: ["${var.environment_name}-exporter"]
    metrics_path: /metrics
    scrape_interval: 60s
    scrape_timeout: 30s
YAML

  promscrape_config_b64 = base64encode(local.promscrape_config)
}
