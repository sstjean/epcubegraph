output "postgres_fqdn" {
  description = "FQDN that the runner can now resolve and connect to"
  value       = "${var.environment_name}-postgres.postgres.database.azure.com"
}

output "runner_to_env_peering_state" {
  value = azurerm_virtual_network_peering.runner_to_env.id
}

output "env_to_runner_peering_state" {
  value = azurerm_virtual_network_peering.env_to_runner.id
}

output "dns_zone_link_id" {
  value = azurerm_private_dns_zone_virtual_network_link.runner_postgres.id
}
