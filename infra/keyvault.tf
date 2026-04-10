# EP Cube Graph — Key Vault Secrets and Runtime Access Policy
#
# Key Vault itself is created by infra/bootstrap/ (separate state).
# This module adds the managed identity access policy and writes secrets.
# The runner PE already exists (bootstrap), so KV is reachable via private endpoint.

# ── Managed Identity Access Policy (runtime read-only) ──

resource "azurerm_key_vault_access_policy" "runtime" {
  key_vault_id = data.azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_user_assigned_identity.main.principal_id

  secret_permissions = ["Get", "List"]
}

# ── EP Cube cloud credentials ──

resource "azurerm_key_vault_secret" "epcube_username" {
  name         = "epcube-username"
  value        = var.epcube_username
  key_vault_id = data.azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "epcube_password" {
  name         = "epcube-password"
  value        = var.epcube_password
  key_vault_id = data.azurerm_key_vault.main.id
}

# ── Emporia Vue credentials ──

resource "azurerm_key_vault_secret" "emporia_username" {
  name         = "emporia-username"
  value        = var.emporia_username
  key_vault_id = data.azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "emporia_password" {
  name         = "emporia-password"
  value        = var.emporia_password
  key_vault_id = data.azurerm_key_vault.main.id
}

# ── Exporter OAuth client secret (for browser login flow) ──

resource "azurerm_key_vault_secret" "exporter_oauth_secret" {
  name         = "exporter-oauth-secret"
  value        = azuread_application_password.exporter_oauth.value
  key_vault_id = data.azurerm_key_vault.main.id
}

# ── PostgreSQL runtime secrets ──

resource "random_password" "postgres_password" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "postgres_password" {
  name         = "postgres-password"
  value        = random_password.postgres_password.result
  key_vault_id = data.azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "api_connection_string" {
  name         = "api-connection-string"
  value        = "Host=${azurerm_postgresql_flexible_server.main.fqdn};Port=5432;Database=${var.postgres_database_name};Username=${var.postgres_admin_login};Password=${random_password.postgres_password.result};SSL Mode=VerifyFull"
  key_vault_id = data.azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "exporter_postgres_dsn" {
  name         = "exporter-postgres-dsn"
  value        = "postgresql://${var.postgres_admin_login}:${random_password.postgres_password.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${var.postgres_database_name}?sslmode=require"
  key_vault_id = data.azurerm_key_vault.main.id
}
