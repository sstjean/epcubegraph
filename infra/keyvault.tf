# EP Cube Graph — Key Vault and Secrets

# ── Key Vault ──

resource "azurerm_key_vault" "main" {
  name                          = "${var.environment_name}-kv"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = false
  soft_delete_retention_days    = 7
  purge_protection_enabled      = false
  public_network_access_enabled = true

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.allowed_ips
  }

  # Deploying user — full secret management
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
  }

  # Managed identity — read-only access for runtime
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = azurerm_user_assigned_identity.main.principal_id

    secret_permissions = ["Get", "List"]
  }
}

# ── EP Cube cloud credentials ──

resource "azurerm_key_vault_secret" "epcube_username" {
  name         = "epcube-username"
  value        = var.epcube_username
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "epcube_password" {
  name         = "epcube-password"
  value        = var.epcube_password
  key_vault_id = azurerm_key_vault.main.id
}

# ── Exporter OAuth client secret (for browser login flow) ──

resource "azurerm_key_vault_secret" "exporter_oauth_secret" {
  name         = "exporter-oauth-secret"
  value        = azuread_application_password.exporter_oauth.value
  key_vault_id = azurerm_key_vault.main.id
}
