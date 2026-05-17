# EP Cube Graph — Ephemeral Runner ↔ Environment Postgres Access
#
# Creates a temporary network path from the self-hosted runner VNet to a target
# environment's PostgreSQL Flexible Server. Designed to be applied locally for
# a brief operational window (e.g., prod→staging DB mirror) and destroyed
# immediately afterward.
#
# Resources created (per environment):
#   - VNet peering runner→env (in tfstate-rg)
#   - VNet peering env→runner (in {env}-rg)
#   - Private DNS zone link of {env}.postgres.database.azure.com into the
#     runner VNet (so the runner can resolve the Postgres FQDN)
#
# State: local — kept under a caller-supplied directory so the orchestrator
# script can wipe everything in a `trap EXIT` handler if the run aborts.
#
# Safety:
#   - When NOT applied, the runner has zero network path to env Postgres.
#   - All resources are tagged Purpose=ephemeral-mirror for orphan recovery.
#   - terraform destroy removes everything; no permanent infra footprint.

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Local state — backend intentionally not configured to remote storage so the
  # orchestrator script can run from a developer laptop without needing access
  # to the private tfstate storage account.
}

provider "azurerm" {
  features {}
}

# ── Inputs (data sources) ──

data "azurerm_virtual_network" "env" {
  name                = "${var.environment_name}-vnet"
  resource_group_name = "${var.environment_name}-rg"
}

data "azurerm_virtual_network" "runner" {
  name                = "github-runner-vnet"
  resource_group_name = "tfstate-rg"
}

data "azurerm_private_dns_zone" "env_postgres" {
  name                = "${var.environment_name}.postgres.database.azure.com"
  resource_group_name = "${var.environment_name}-rg"
}

# ── VNet peering (bidirectional, required for traffic to flow) ──

resource "azurerm_virtual_network_peering" "runner_to_env" {
  name                         = "runner-to-${var.environment_name}"
  resource_group_name          = "tfstate-rg"
  virtual_network_name         = data.azurerm_virtual_network.runner.name
  remote_virtual_network_id    = data.azurerm_virtual_network.env.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = false
  allow_gateway_transit        = false
  use_remote_gateways          = false
}

resource "azurerm_virtual_network_peering" "env_to_runner" {
  name                         = "${var.environment_name}-to-runner"
  resource_group_name          = "${var.environment_name}-rg"
  virtual_network_name         = data.azurerm_virtual_network.env.name
  remote_virtual_network_id    = data.azurerm_virtual_network.runner.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = false
  allow_gateway_transit        = false
  use_remote_gateways          = false
}

# ── DNS: link env's Postgres private zone to runner VNet ──

resource "azurerm_private_dns_zone_virtual_network_link" "runner_postgres" {
  name                  = "runner-mirror-${var.environment_name}"
  resource_group_name   = "${var.environment_name}-rg"
  private_dns_zone_name = data.azurerm_private_dns_zone.env_postgres.name
  virtual_network_id    = data.azurerm_virtual_network.runner.id
  registration_enabled  = false

  tags = {
    Purpose = "ephemeral-mirror"
  }
}
