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
  end_date_relative = "8760h" # 1 year
}

resource "azuread_application_redirect_uris" "exporter" {
  application_id = azuread_application.api.id
  type           = "Web"

  redirect_uris = [
    "https://${azurerm_container_app.exporter[0].ingress[0].fqdn}/.auth/callback",
  ]
}
