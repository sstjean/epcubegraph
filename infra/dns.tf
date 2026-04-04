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

# Azure DNS needs time to propagate CNAME records before SWA can validate them.
# Without this delay, SWA returns 400 "CNAME Record is invalid."
resource "time_sleep" "dns_propagation" {
  count           = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? 1 : 0
  create_duration = "30s"

  depends_on = [
    azurerm_dns_cname_record.dashboard,
    azurerm_dns_cname_record.api,
    azurerm_dns_txt_record.api_verification,
  ]
}

# SWA custom domain binding — CNAME validation auto-provisions managed TLS cert
resource "azurerm_static_web_app_custom_domain" "dashboard" {
  count             = var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? 1 : 0
  static_web_app_id = azurerm_static_web_app.dashboard.id
  domain_name       = "${var.dashboard_subdomain}.${var.custom_domain_zone_name}"
  validation_type   = "cname-delegation"

  depends_on = [time_sleep.dns_propagation]
}

# ── API (Container App) Custom Domain ──

# TXT verification record: asuid.{api_subdomain} → Container App domain verification ID
# Required for Azure managed certificate provisioning on Container Apps.
resource "azurerm_dns_txt_record" "api_verification" {
  count               = var.custom_domain_zone_name != "" && var.api_subdomain != "" && var.api_image != "" ? 1 : 0
  name                = "asuid.${var.api_subdomain}"
  zone_name           = data.azurerm_dns_zone.custom[0].name
  resource_group_name = data.azurerm_dns_zone.custom[0].resource_group_name
  ttl                 = var.custom_domain_ttl

  record {
    value = azurerm_container_app.api[0].custom_domain_verification_id
  }
}

# CNAME: {api_subdomain}.devsbx.xyz → API Container App FQDN
resource "azurerm_dns_cname_record" "api" {
  count               = var.custom_domain_zone_name != "" && var.api_subdomain != "" && var.api_image != "" ? 1 : 0
  name                = var.api_subdomain
  zone_name           = data.azurerm_dns_zone.custom[0].name
  resource_group_name = data.azurerm_dns_zone.custom[0].resource_group_name
  ttl                 = var.custom_domain_ttl
  record              = azurerm_container_app.api[0].ingress[0].fqdn
}

# Container App custom domain with Azure managed certificate.
# cert fields are populated asynchronously by Azure after TXT + CNAME validation,
# so ignore_changes prevents Terraform from recreating the resource on subsequent applies.
resource "azurerm_container_app_custom_domain" "api" {
  count            = var.custom_domain_zone_name != "" && var.api_subdomain != "" && var.api_image != "" ? 1 : 0
  name             = "${var.api_subdomain}.${var.custom_domain_zone_name}"
  container_app_id = azurerm_container_app.api[0].id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [time_sleep.dns_propagation]
}

# Azure provisions managed certs asynchronously after the custom domain is created,
# but doesn't auto-bind them via the Terraform API. Wait for cert provisioning,
# then explicitly bind with az CLI. Retries up to 5 times with 15s between
# attempts to handle eventual consistency delays.
resource "time_sleep" "api_cert_provisioning" {
  count           = var.custom_domain_zone_name != "" && var.api_subdomain != "" && var.api_image != "" ? 1 : 0
  create_duration = "60s"
  depends_on      = [azurerm_container_app_custom_domain.api]
}

resource "terraform_data" "api_cert_bind" {
  count            = var.custom_domain_zone_name != "" && var.api_subdomain != "" && var.api_image != "" ? 1 : 0
  triggers_replace = [azurerm_container_app_custom_domain.api[0].id]

  provisioner "local-exec" {
    command = "for i in 1 2 3 4 5; do az containerapp hostname bind --hostname ${var.api_subdomain}.${var.custom_domain_zone_name} --name ${azurerm_container_app.api[0].name} --resource-group ${azurerm_resource_group.main.name} --environment ${azurerm_container_app_environment.main.name} --validation-method CNAME && break || echo \"Attempt $i failed, retrying in 15s...\" && sleep 15; done"
  }

  depends_on = [time_sleep.api_cert_provisioning]
}
