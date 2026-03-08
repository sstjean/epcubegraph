# EP Cube Graph — Outputs

output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.main.name
}

output "vm_fqdn" {
  description = "FQDN of the VictoriaMetrics container app (remote-write endpoint)"
  value       = azurerm_container_app.vm.ingress[0].fqdn
}

output "api_fqdn" {
  description = "FQDN of the API container app"
  value       = var.api_image != "" ? azurerm_container_app.api[0].ingress[0].fqdn : ""
}

output "acr_login_server" {
  description = "ACR login server URL"
  value       = azurerm_container_registry.main.login_server
}

output "acr_name" {
  description = "ACR name"
  value       = azurerm_container_registry.main.name
}

output "remote_write_url" {
  description = "Full remote-write URL for local vmagent .env"
  value       = "https://${azurerm_container_app.vm.ingress[0].fqdn}/api/v1/write"
}

output "remote_write_token" {
  description = "Remote-write bearer token (for local .env)"
  value       = random_password.remote_write_token.result
  sensitive   = true
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
