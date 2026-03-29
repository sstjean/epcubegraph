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
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  # Remote state in Azure Blob Storage.
  # Config values loaded from backend.hcl (local) or -backend-config flags (CI/CD).
  # See DEPLOY.md for setup and backend.hcl.example for the template.
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
    # Container Apps creates NSGs on VNet subnets outside Terraform's control.
    # Allow RG deletion to clean up these platform-managed resources.
    resource_group {
      prevent_deletion_if_contains_resources = false
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

