# EP Cube Graph — Storage and Monitoring

# ── Log Analytics Workspace ──

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.environment_name}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

# ── Storage Account for VictoriaMetrics data ──

resource "azurerm_storage_account" "main" {
  name                            = replace("${var.environment_name}sa", "-", "")
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = true

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
    ip_rules       = var.allowed_ips
  }
}

resource "azurerm_storage_share" "vm_data" {
  name               = "victoria-metrics-data"
  storage_account_id = azurerm_storage_account.main.id
  quota              = 50 # GB
}
