# EP Cube Graph — Outputs

output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.main.name
}

output "postgres_fqdn" {
  description = "Private FQDN of the managed PostgreSQL server"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "api_fqdn" {
  description = "FQDN of the API container app"
  value       = var.api_image != "" ? azurerm_container_app.api[0].ingress[0].fqdn : ""
}

output "exporter_fqdn" {
  description = "FQDN of the epcube-exporter container app"
  value       = var.epcube_image != "" ? azurerm_container_app.exporter[0].ingress[0].fqdn : ""
}

output "acr_login_server" {
  description = "ACR login server URL"
  value       = azurerm_container_registry.main.login_server
}

output "acr_name" {
  description = "ACR name"
  value       = azurerm_container_registry.main.name
}

output "entra_app_client_id" {
  description = "Entra ID application (client) ID"
  value       = azuread_application.api.client_id
}

output "entra_tenant_id" {
  description = "Entra ID tenant ID"
  value       = data.azurerm_client_config.current.tenant_id
}

output "key_vault_name" {
  description = "Key Vault name"
  value       = azurerm_key_vault.main.name
}

output "managed_identity_client_id" {
  description = "Managed identity client ID"
  value       = azurerm_user_assigned_identity.main.client_id
}

output "api_image" {
  description = "Current API container image (empty if not deployed)"
  value       = var.api_image
}

output "exporter_image" {
  description = "Current exporter container image (empty if not deployed)"
  value       = var.epcube_image
}

output "swa_default_hostname" {
  description = "Default hostname for the Static Web App"
  value       = azurerm_static_web_app.dashboard.default_host_name
}

output "swa_api_key" {
  description = "Deployment token for the Static Web App"
  value       = azurerm_static_web_app.dashboard.api_key
  sensitive   = true
}

output "dashboard_client_id" {
  description = "Entra ID client ID for the dashboard SPA"
  value       = azuread_application.dashboard.client_id
}

# ── Custom Domain Outputs ──

output "dashboard_custom_url" {
  description = "Dashboard URL via custom domain (empty if not configured)"
  value       = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? "https://${var.dashboard_subdomain}.${var.custom_domain_zone_name}" : ""
}

output "api_custom_url" {
  description = "API URL via custom domain (empty if not configured)"
  value       = var.custom_domain_zone_name != "" && var.api_subdomain != "" ? "https://${var.api_subdomain}.${var.custom_domain_zone_name}" : ""
}

output "exporter_custom_url" {
  description = "Exporter debug page URL via custom domain (empty if not configured)"
  value       = var.custom_domain_zone_name != "" && var.exporter_subdomain != "" ? "https://${var.exporter_subdomain}.${var.custom_domain_zone_name}" : ""
}
