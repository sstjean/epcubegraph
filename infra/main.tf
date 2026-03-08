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

  # Uncomment to use remote state in Azure Blob Storage:
  # backend "azurerm" {
  #   resource_group_name  = "tfstate-rg"
  #   storage_account_name = "tfstateepcubegraph"
  #   container_name       = "tfstate"
  #   key                  = "epcubegraph.tfstate"
  # }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
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
  vmauth_config = <<-YAML
users:
- bearer_token: "%%{REMOTE_WRITE_TOKEN}"
  url_prefix: "http://localhost:8428/"
YAML

  vmauth_config_b64 = base64encode(local.vmauth_config)
}
