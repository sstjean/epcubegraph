# EP Cube Graph — Container Apps Environment and Applications

# ── Container Apps Environment ──

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.environment_name}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.infrastructure.id

  # Azure auto-populates these; ignore to prevent unnecessary force-replacement or drift.
  lifecycle {
    ignore_changes = [
      infrastructure_resource_group_name,
      workload_profile,
    ]
  }
}

# ── API Container App ──

resource "azurerm_container_app" "api" {
  count = var.api_image != "" ? 1 : 0

  name                         = "${var.environment_name}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "api-connection-string"
    key_vault_secret_id = azurerm_key_vault_secret.api_connection_string.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  ingress {
    external_enabled = true
    target_port      = var.api_port
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.api_min_replicas
    max_replicas = var.api_max_replicas

    container {
      name   = "api"
      image  = var.api_image
      cpu    = var.api_cpu
      memory = var.api_memory

      env {
        name  = "AzureAd__Instance"
        value = "https://login.microsoftonline.com/"
      }

      env {
        name  = "AzureAd__TenantId"
        value = data.azurerm_client_config.current.tenant_id
      }

      env {
        name  = "AzureAd__ClientId"
        value = azuread_application.api.client_id
      }

      env {
        name  = "AzureAd__Audience"
        value = "api://${azuread_application.api.client_id}"
      }

      env {
        name        = "ConnectionStrings__DefaultConnection"
        secret_name = "api-connection-string"
      }

      env {
        name  = "Cors__AllowedOrigin"
        value = "https://${azurerm_static_web_app.dashboard.default_host_name}"
      }
    }
  }
}

# ── epcube-exporter Container App ──

resource "azurerm_container_app" "exporter" {
  count = var.epcube_image != "" ? 1 : 0

  name                         = "${var.environment_name}-exporter"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "exporter-postgres-dsn"
    key_vault_secret_id = azurerm_key_vault_secret.exporter_postgres_dsn.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "epcube-username"
    key_vault_secret_id = azurerm_key_vault_secret.epcube_username.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "epcube-password"
    key_vault_secret_id = azurerm_key_vault_secret.epcube_password.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  secret {
    name                = "exporter-oauth-secret"
    key_vault_secret_id = azurerm_key_vault_secret.exporter_oauth_secret.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  # External ingress — debug page requires JWT auth in code
  # /metrics and /health remain unauthenticated for vmagent scraping
  ingress {
    external_enabled = true
    target_port      = var.exporter_port
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.exporter_min_replicas
    max_replicas = var.exporter_max_replicas

    container {
      name   = "epcube-exporter"
      image  = var.epcube_image
      cpu    = var.exporter_cpu
      memory = var.exporter_memory

      env {
        name        = "EPCUBE_USERNAME"
        secret_name = "epcube-username"
      }

      env {
        name        = "EPCUBE_PASSWORD"
        secret_name = "epcube-password"
      }

      env {
        name  = "EPCUBE_PORT"
        value = tostring(var.exporter_port)
      }

      env {
        name  = "EPCUBE_INTERVAL"
        value = tostring(var.exporter_poll_interval)
      }

      env {
        name        = "POSTGRES_DSN"
        secret_name = "exporter-postgres-dsn"
      }

      env {
        name  = "AZURE_TENANT_ID"
        value = data.azuread_client_config.current.tenant_id
      }

      env {
        name  = "AZURE_CLIENT_ID"
        value = azuread_application.api.client_id
      }

      env {
        name  = "AZURE_AUDIENCE"
        value = "api://${azuread_application.api.client_id}"
      }

      env {
        name        = "AZURE_CLIENT_SECRET"
        secret_name = "exporter-oauth-secret"
      }

      env {
        name  = "AZURE_REDIRECT_URI"
        value = "https://${var.environment_name}-exporter.${azurerm_container_app_environment.main.default_domain}/.auth/callback"
      }
    }
  }
}
