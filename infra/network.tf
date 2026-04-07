# EP Cube Graph — Virtual Network and Private Endpoints
#
# VNet integration for Container Apps, Key Vault, and managed PostgreSQL.
# Runner VNet (in tfstate-rg) provides private endpoint access for CD pipeline.
#
# Traffic flow:
#   Container Apps → (env VNet) → Private Endpoint → Key Vault
#   Container Apps → (env VNet) → delegated subnet → PostgreSQL Flexible Server
#   CD runner → (runner VNet) → Private Endpoint → Key Vault (no public access needed)

# ── Runner VNet (persistent, in tfstate-rg — created by setup-self-hosted-runner.sh) ──

data "azurerm_subnet" "runner_endpoints" {
  name                 = "endpoints"
  virtual_network_name = "github-runner-vnet"
  resource_group_name  = "tfstate-rg"
}

data "azurerm_private_dns_zone" "runner_vault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = "tfstate-rg"
}

# ── Virtual Network ──

resource "azurerm_virtual_network" "main" {
  name                = "${var.environment_name}-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = var.vnet_address_space
}

# ── Subnets ──

# Container Apps infrastructure subnet (/23 minimum for Consumption workload profile)
resource "azurerm_subnet" "infrastructure" {
  name                            = "infrastructure"
  resource_group_name             = azurerm_resource_group.main.name
  virtual_network_name            = azurerm_virtual_network.main.name
  address_prefixes                = var.subnet_infrastructure_prefix
  default_outbound_access_enabled = false

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Private endpoints subnet
resource "azurerm_subnet" "endpoints" {
  name                            = "endpoints"
  resource_group_name             = azurerm_resource_group.main.name
  virtual_network_name            = azurerm_virtual_network.main.name
  address_prefixes                = var.subnet_endpoints_prefix
  default_outbound_access_enabled = false
}

resource "azurerm_subnet" "postgres" {
  name                 = "postgres"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = var.subnet_postgres_prefix

  delegation {
    name = "postgres-flexible-server"
    service_delegation {
      name = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
      ]
    }
  }
}

# ── Key Vault Private Endpoint ──

resource "azurerm_private_endpoint" "keyvault" {
  name                = "${var.environment_name}-kv-pe"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "${var.environment_name}-kv-psc"
    private_connection_resource_id = azurerm_key_vault.main.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.keyvault.id]
  }
}

resource "azurerm_private_dns_zone" "keyvault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "keyvault" {
  name                  = "${var.environment_name}-kv-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.keyvault.name
  virtual_network_id    = azurerm_virtual_network.main.id
}

# ── Key Vault Private Endpoint in Runner VNet (for CD pipeline access) ──

resource "azurerm_private_endpoint" "keyvault_runner" {
  name                = "${var.environment_name}-kv-runner-pe"
  location            = "centralus" # Runner VNet is in centralus (tfstate-rg)
  resource_group_name = azurerm_resource_group.main.name
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
