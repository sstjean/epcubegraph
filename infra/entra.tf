# EP Cube Graph — Entra ID App Registration
# Creates the app registration, service principal, and user_impersonation scope

resource "random_uuid" "user_impersonation_scope" {}

resource "azuread_application" "api" {
  display_name = "EP Cube Graph API"

  identifier_uris  = ["api://${var.environment_name}"]
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
}

resource "azuread_service_principal" "api" {
  client_id = azuread_application.api.client_id
  owners    = [data.azuread_client_config.current.object_id]
}
