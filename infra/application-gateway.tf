# EP Cube Graph — Public Edge: Application Gateway WAF_v2
#
# The ONLY public ingress for the environment (FR-004). The Container Apps
# environment is internal (no public compute IP); this gateway terminates TLS
# with the shared wildcard certificate, runs the managed OWASP ruleset in
# Prevention mode (FR-013), and forwards to the internal app FQDNs over HTTPS.
#
# Gated on var.wildcard_certificate_name: the edge cannot stand up without the
# ACME-issued wildcard cert already present in Key Vault (FR-014, D1).

locals {
  appgw_enabled = var.wildcard_certificate_name != ""

  env_default_domain = azurerm_container_app_environment.main.default_domain

  # Internal app FQDNs (resolve to the env internal LB via the private DNS zone).
  api_backend_fqdn      = "${var.environment_name}-api.${local.env_default_domain}"
  exporter_backend_fqdn = "${var.environment_name}-exporter.${local.env_default_domain}"

  # Public host names the edge fronts.
  api_public_host      = "${var.api_subdomain}.${var.custom_domain_zone_name}"
  exporter_public_host = "${var.exporter_subdomain}.${var.custom_domain_zone_name}"
}

# The shared wildcard cert lives in the central devsbx-common Key Vault
# (issued + auto-renewed once by KeyVault-Acmebot), NOT the per-env vault — a
# single `*.devsbx.xyz` cert serves every environment's gateway (feature 168,
# design C). Only the vault's control-plane metadata is read here (Contributor
# suffices); no cert/secret data-plane read, so the CD principal needs no KV
# data role. The gateway pulls the cert at runtime via its own managed identity
# using the versionless secret id, which also auto-rotates on Acmebot renewal.
data "azurerm_key_vault" "shared_cert" {
  count               = local.appgw_enabled ? 1 : 0
  name                = var.shared_cert_key_vault_name
  resource_group_name = var.shared_cert_key_vault_rg
}

# ── Single public IP (the env's only public IP — FR-004) ──
resource "azurerm_public_ip" "appgw" {
  count               = local.appgw_enabled ? 1 : 0
  name                = "${var.environment_name}-appgw-pip"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]

  lifecycle {
    # This sandbox tenant auto-injects a FirstPartyUsage "/Unprivileged" ip_tag
    # on public IPs. It is not part of our config, so Terraform would try to
    # strip it — a ForceNew replace that deadlocks because the IP is already
    # attached to the gateway frontend. Ignore the platform-injected tag.
    ignore_changes = [ip_tags]
  }
}

# ── WAF policy: managed OWASP 3.2 in Prevention mode (FR-013) ──
resource "azurerm_web_application_firewall_policy" "main" {
  count               = local.appgw_enabled ? 1 : 0
  name                = "${var.environment_name}-waf-policy"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  policy_settings {
    enabled                     = true
    mode                        = "Prevention"
    request_body_check          = true
    max_request_body_size_in_kb = 128
    file_upload_limit_in_mb     = 100
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"
    }
  }
}

# ── Application Gateway WAF_v2 ──
resource "azurerm_application_gateway" "main" {
  count               = local.appgw_enabled ? 1 : 0
  name                = "${var.environment_name}-appgw"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku {
    name = "WAF_v2"
    tier = "WAF_v2"
    # capacity is governed by autoscale_configuration below (FR-018).
  }

  autoscale_configuration {
    min_capacity = var.appgw_autoscale_min
    max_capacity = var.appgw_autoscale_max
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.appgw.id]
  }

  firewall_policy_id = azurerm_web_application_firewall_policy.main[0].id

  gateway_ip_configuration {
    name      = "appgw-ipcfg"
    subnet_id = azurerm_subnet.appgw.id
  }

  frontend_ip_configuration {
    name                 = "appgw-feip"
    public_ip_address_id = azurerm_public_ip.appgw[0].id
  }

  frontend_port {
    name = "https"
    port = 443
  }

  frontend_port {
    name = "http"
    port = 80
  }

  ssl_certificate {
    name = var.wildcard_certificate_name
    # Versionless secret id in the shared vault — App Gateway resolves + auto-
    # rotates it via its managed identity (granted Secret User in keyvault.tf).
    key_vault_secret_id = "${data.azurerm_key_vault.shared_cert[0].vault_uri}secrets/${var.wildcard_certificate_name}"
  }

  # ── API backend (HTTPS to the internal app FQDN) ──
  backend_address_pool {
    name  = "api-pool"
    fqdns = [local.api_backend_fqdn]
  }

  probe {
    name                                      = "api-probe"
    protocol                                  = "Https"
    path                                      = "/api/v1/health"
    interval                                  = 30
    timeout                                   = 30
    unhealthy_threshold                       = 3
    pick_host_name_from_backend_http_settings = true

    match {
      status_code = ["200-399"]
    }
  }

  backend_http_settings {
    name                                = "api-https"
    cookie_based_affinity               = "Disabled"
    protocol                            = "Https"
    port                                = 443
    request_timeout                     = 30
    pick_host_name_from_backend_address = true
    probe_name                          = "api-probe"
  }

  http_listener {
    name                           = "api-https-listener"
    frontend_ip_configuration_name = "appgw-feip"
    frontend_port_name             = "https"
    protocol                       = "Https"
    ssl_certificate_name           = var.wildcard_certificate_name
    host_name                      = local.api_public_host
  }

  request_routing_rule {
    name                       = "api-route"
    rule_type                  = "Basic"
    priority                   = 100
    http_listener_name         = "api-https-listener"
    backend_address_pool_name  = "api-pool"
    backend_http_settings_name = "api-https"
  }

  # ── Exporter backend (HTTPS to the internal app FQDN) ──
  backend_address_pool {
    name  = "exporter-pool"
    fqdns = [local.exporter_backend_fqdn]
  }

  probe {
    name                                      = "exporter-probe"
    protocol                                  = "Https"
    path                                      = "/health"
    interval                                  = 30
    timeout                                   = 30
    unhealthy_threshold                       = 3
    pick_host_name_from_backend_http_settings = true

    match {
      status_code = ["200-399"]
    }
  }

  backend_http_settings {
    name                                = "exporter-https"
    cookie_based_affinity               = "Disabled"
    protocol                            = "Https"
    port                                = 443
    request_timeout                     = 30
    pick_host_name_from_backend_address = true
    probe_name                          = "exporter-probe"
  }

  http_listener {
    name                           = "exporter-https-listener"
    frontend_ip_configuration_name = "appgw-feip"
    frontend_port_name             = "https"
    protocol                       = "Https"
    ssl_certificate_name           = var.wildcard_certificate_name
    host_name                      = local.exporter_public_host
  }

  request_routing_rule {
    name                       = "exporter-route"
    rule_type                  = "Basic"
    priority                   = 110
    http_listener_name         = "exporter-https-listener"
    backend_address_pool_name  = "exporter-pool"
    backend_http_settings_name = "exporter-https"
  }

  # ── HTTP → HTTPS permanent redirect (per host) ──
  http_listener {
    name                           = "api-http-listener"
    frontend_ip_configuration_name = "appgw-feip"
    frontend_port_name             = "http"
    protocol                       = "Http"
    host_name                      = local.api_public_host
  }

  http_listener {
    name                           = "exporter-http-listener"
    frontend_ip_configuration_name = "appgw-feip"
    frontend_port_name             = "http"
    protocol                       = "Http"
    host_name                      = local.exporter_public_host
  }

  redirect_configuration {
    name                 = "api-http-to-https"
    redirect_type        = "Permanent"
    target_listener_name = "api-https-listener"
    include_path         = true
    include_query_string = true
  }

  redirect_configuration {
    name                 = "exporter-http-to-https"
    redirect_type        = "Permanent"
    target_listener_name = "exporter-https-listener"
    include_path         = true
    include_query_string = true
  }

  request_routing_rule {
    name                        = "api-http-redirect"
    rule_type                   = "Basic"
    priority                    = 120
    http_listener_name          = "api-http-listener"
    redirect_configuration_name = "api-http-to-https"
  }

  request_routing_rule {
    name                        = "exporter-http-redirect"
    rule_type                   = "Basic"
    priority                    = 130
    http_listener_name          = "exporter-http-listener"
    redirect_configuration_name = "exporter-http-to-https"
  }

  # The shared-vault cert grants (gateway identity) and the internal DNS record
  # must exist before the gateway provisions, or TLS load and backend health both
  # fail (D1, D4). RBAC role assignments also need propagation time.
  depends_on = [
    azurerm_role_assignment.appgw_cert_user,
    azurerm_role_assignment.appgw_secret_user,
    azurerm_private_dns_a_record.env_wildcard,
  ]
}

# ── Diagnostics: stream WAF + access logs to the per-env Log Analytics
#    workspace so blocked/matched requests are queryable (FR-019, SC-010). ──
resource "azurerm_monitor_diagnostic_setting" "appgw" {
  count                      = local.appgw_enabled ? 1 : 0
  name                       = "${var.environment_name}-appgw-diag"
  target_resource_id         = azurerm_application_gateway.main[0].id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "ApplicationGatewayAccessLog"
  }

  enabled_log {
    category = "ApplicationGatewayFirewallLog"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
