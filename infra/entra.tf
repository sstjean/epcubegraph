# EP Cube Graph — Entra ID App Registration
# Creates the app registration, service principal, and user_impersonation scope

resource "random_uuid" "user_impersonation_scope" {}

resource "azuread_application" "api" {
  display_name = "EP Cube Graph API (${var.environment_name})"

  sign_in_audience = "AzureADMyOrg"

  api {
    oauth2_permission_scope {
      admin_consent_description  = "Access EP Cube Graph API"
      admin_consent_display_name = "Access EP Cube Graph API"
      id                         = random_uuid.user_impersonation_scope.result
      enabled                    = true
      type                       = "User"
      user_consent_description   = "Access EP Cube Graph API on your behalf"
      user_consent_display_name  = "Access EP Cube Graph API"
      value                      = "user_impersonation"
    }
  }

  web {
    redirect_uris = [
      "https://${var.environment_name}-exporter.${azurerm_container_app_environment.main.default_domain}/.auth/callback",
    ]
  }

  owners = [data.azuread_client_config.current.object_id]

  lifecycle {
    ignore_changes = [identifier_uris]
  }
}

# Set identifier URI after app creation (requires the app's own client_id)
resource "azuread_application_identifier_uri" "api" {
  application_id = azuread_application.api.id
  identifier_uri = "api://${azuread_application.api.client_id}"
}

resource "azuread_service_principal" "api" {
  client_id = azuread_application.api.client_id
  owners    = [data.azuread_client_config.current.object_id]
}

# ── Client secret for OAuth authorization code flow (exporter debug page) ──

resource "azuread_application_password" "exporter_oauth" {
  application_id = azuread_application.api.id
  display_name   = "exporter-oauth-secret"
  end_date       = timeadd(plantimestamp(), "8760h") # 1 year from creation

  lifecycle {
    ignore_changes = [end_date]
  }
}

# ── Dashboard SPA App Registration (public client — PKCE, no secret) ──

resource "azuread_application" "dashboard" {
  display_name = "EP Cube Graph Dashboard (${var.environment_name})"

  sign_in_audience = "AzureADMyOrg"

  single_page_application {
    redirect_uris = concat(
      [
        "https://${azurerm_static_web_app.dashboard.default_host_name}/",
        "http://localhost:5173/",
      ],
      var.custom_domain_zone_name != "" && var.dashboard_subdomain != "" ? [
        "https://${var.dashboard_subdomain}.${var.custom_domain_zone_name}/",
      ] : [],
    )
  }

  required_resource_access {
    resource_app_id = azuread_application.api.client_id

    resource_access {
      id   = random_uuid.user_impersonation_scope.result
      type = "Scope"
    }
  }

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "dashboard" {
  client_id = azuread_application.dashboard.client_id
  owners    = [data.azuread_client_config.current.object_id]
}
