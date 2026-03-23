# EP Cube Graph — Virtual Network and Private Endpoints
#
# VNet integration for Container Apps + private endpoints for Key Vault and Storage.
# Container Apps access KV secrets and Storage file shares via the private network,
# keeping all data-plane firewalls at default_action = "Deny".
#
# Traffic flow:
#   Container Apps → (VNet) → Private Endpoint → Key Vault / Storage
#   Deployer (CD runner) → (public internet) → ip_rules whitelist → KV / Storage

# ── Virtual Network ──

resource "azurerm_virtual_network" "main" {
  name                = "${var.environment_name}-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]
}

# ── Subnets ──

# Container Apps infrastructure subnet (/23 minimum for Consumption workload profile)
resource "azurerm_subnet" "infrastructure" {
  name                            = "infrastructure"
  resource_group_name             = azurerm_resource_group.main.name
  virtual_network_name            = azurerm_virtual_network.main.name
  address_prefixes                = ["10.0.0.0/23"]
  default_outbound_access_enabled = false

  # Service endpoint required for Container Apps to mount Azure File Shares
  # through the storage account firewall (private endpoints alone are insufficient
  # because the kubelet's SMB mount may not resolve via private DNS zones).
  service_endpoints = ["Microsoft.Storage"]

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
  address_prefixes                = ["10.0.2.0/24"]
  default_outbound_access_enabled = false
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

# ── Storage Private Endpoint (Azure File Share for VictoriaMetrics) ──

resource "azurerm_private_endpoint" "storage_file" {
  name                = "${var.environment_name}-sa-file-pe"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "${var.environment_name}-sa-file-psc"
    private_connection_resource_id = azurerm_storage_account.main.id
    is_manual_connection           = false
    subresource_names              = ["file"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.storage_file.id]
  }
}

resource "azurerm_private_dns_zone" "storage_file" {
  name                = "privatelink.file.core.windows.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "storage_file" {
  name                  = "${var.environment_name}-sa-file-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.storage_file.name
  virtual_network_id    = azurerm_virtual_network.main.id
}
