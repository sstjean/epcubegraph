# EP Cube Graph — Bootstrap Infrastructure
#
# Creates the resource group, Key Vault, and runner private endpoint BEFORE
# the main infra module runs. This separation ensures the runner can access
# KV via private endpoint before any secrets are written.
#
# Managed as a separate Terraform state file:
#   {env}-bootstrap.tfstate (e.g., epcubegraph-bootstrap.tfstate)

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  backend "azurerm" {
    resource_group_name  = ""
    storage_account_name = ""
    container_name       = ""
    key                  = ""
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
  storage_use_azuread = true
}

# ── Data Sources ──

data "azurerm_client_config" "current" {}

data "azurerm_subnet" "runner_endpoints" {
  name                 = "endpoints"
  virtual_network_name = "github-runner-vnet"
  resource_group_name  = "tfstate-rg"
}

data "azurerm_private_dns_zone" "runner_vault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = "tfstate-rg"
}

# ── Resource Group ──

resource "azurerm_resource_group" "bootstrap" {
  name     = "${var.environment_name}-bootstrap-rg"
  location = var.location
}

# ── Key Vault (no secrets — those are in the main module) ──

resource "azurerm_key_vault" "main" {
  name                          = "${var.environment_name}-kv"
  location                      = azurerm_resource_group.bootstrap.location
  resource_group_name           = azurerm_resource_group.bootstrap.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = false
  soft_delete_retention_days    = var.keyvault_soft_delete_days
  purge_protection_enabled      = false
  public_network_access_enabled = false # SFI: permanently disabled

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  # Deploying user — full secret management (for Terraform to write secrets)
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
  }
}

# ── Runner Private Endpoint (for CD pipeline access to KV) ──

resource "azurerm_private_endpoint" "keyvault_runner" {
  name                = "${var.environment_name}-kv-runner-pe"
  location            = "centralus" # Runner VNet is in centralus (tfstate-rg)
  resource_group_name = azurerm_resource_group.bootstrap.name
  subnet_id           = data.azurerm_subnet.runner_endpoints.id

  private_service_connection {
    name                           = "${var.environment_name}-kv-runner-psc"
    private_connection_resource_id = azurerm_key_vault.main.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [data.azurerm_private_dns_zone.runner_vault.id]
  }
}

# Wait for KV + PE DNS propagation before the main module writes secrets
resource "time_sleep" "kv_propagation" {
  depends_on = [
    azurerm_key_vault.main,
    azurerm_private_endpoint.keyvault_runner,
  ]
  create_duration = "60s"
}
