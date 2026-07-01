# EP Cube Graph — Custom Domain DNS Records and Bindings
# References the shared devsbx.xyz DNS zone from devsbx-common and creates
# CNAME records + custom domain bindings for the dashboard (SWA) and API
# (Container App). Both use free Azure managed TLS certificates.
#
# Opt-in: set custom_domain_zone_name to enable. Empty string = skip.

# ── Shared DNS Zone (owned by devsbx-common) ──

data "azurerm_dns_zone" "custom" {
  count               = var.custom_domain_zone_name != "" ? 1 : 0
  name                = var.custom_domain_zone_name
  resource_group_name = var.custom_domain_zone_rg
}

# ── Dashboard (SWA) Custom Domain ──

# CNAME: {dashboard_subdomain}.devsbx.xyz → SWA default hostname
resource "azurerm_dns_cname_record" "dashboard" {
  count               = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? 1 : 0
  name                = var.dashboard_subdomain
  zone_name           = data.azurerm_dns_zone.custom[0].name
  resource_group_name = data.azurerm_dns_zone.custom[0].resource_group_name
  ttl                 = var.custom_domain_ttl
  record              = azurerm_static_web_app.dashboard.default_host_name
}

# Azure DNS needs time to propagate CNAME records before domain bindings validate.
# Without this delay, SWA returns 400 "CNAME Record is invalid."
# Split per binding so each delay fires when its own DNS records are created,
# not when the other binding's records are created in a different apply phase.
resource "time_sleep" "dashboard_dns_propagation" {
  count           = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? 1 : 0
  create_duration = "30s"

  depends_on = [azurerm_dns_cname_record.dashboard]
}

# SWA custom domain binding — CNAME validation auto-provisions managed TLS cert
resource "azurerm_static_web_app_custom_domain" "dashboard" {
  count             = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? 1 : 0
  static_web_app_id = azurerm_static_web_app.dashboard.id
  domain_name       = "${var.dashboard_subdomain}.${var.custom_domain_zone_name}"
  validation_type   = "cname-delegation"

  depends_on = [time_sleep.dashboard_dns_propagation]
}

# ── API + Exporter Public DNS (Application Gateway edge) ──
#
# With the internal Container Apps environment fronted by the Application
# Gateway WAF_v2 edge, the public API and exporter host names resolve directly
# to the gateway's single public IP (FR-008). TLS is terminated at the gateway
# with the shared wildcard certificate, so the per-app Container App managed
# certificate + TXT verification + hostname-bind dance is gone (FR-009, D7).

resource "azurerm_dns_a_record" "api" {
  count               = local.appgw_enabled && var.custom_domain_zone_name != "" && var.api_subdomain != "" ? 1 : 0
  name                = var.api_subdomain
  zone_name           = data.azurerm_dns_zone.custom[0].name
  resource_group_name = data.azurerm_dns_zone.custom[0].resource_group_name
  ttl                 = var.custom_domain_ttl
  records             = [azurerm_public_ip.appgw[0].ip_address]
}

resource "azurerm_dns_a_record" "exporter" {
  count               = local.appgw_enabled && var.custom_domain_zone_name != "" && var.exporter_subdomain != "" ? 1 : 0
  name                = var.exporter_subdomain
  zone_name           = data.azurerm_dns_zone.custom[0].name
  resource_group_name = data.azurerm_dns_zone.custom[0].resource_group_name
  ttl                 = var.custom_domain_ttl
  records             = [azurerm_public_ip.appgw[0].ip_address]
}
