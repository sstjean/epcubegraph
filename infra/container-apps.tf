# EP Cube Graph — Container Apps Environment and Applications

# ── Container Apps Environment ──

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.environment_name}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.infrastructure.id

  # Azure auto-populates these; ignore to prevent unnecessary force-replacement.
  lifecycle {
    ignore_changes = [
      infrastructure_resource_group_name,
    ]
  }
}

# ── Mount Azure File Share for VictoriaMetrics persistent storage ──

resource "azurerm_container_app_environment_storage" "vm" {
  name                         = "vmstorage"
  container_app_environment_id = azurerm_container_app_environment.main.id
  account_name                 = azurerm_storage_account.main.name
  share_name                   = azurerm_storage_share.vm_data.name
  access_key                   = azurerm_storage_account.main.primary_access_key
  access_mode                  = "ReadWrite"
}

# ── VictoriaMetrics Container App (internal-only) ──

resource "azurerm_container_app" "vm" {
  name                         = "${var.environment_name}-vm"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  # Internal-only ingress — accessible only to other apps in the environment.
  # No external traffic; vmauth removed (no internet-facing reads/writes).
  ingress {
    external_enabled = false
    target_port      = 8428
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    # Init container writes promscrape config to shared EmptyDir volume.
    init_container {
      name   = "config-init"
      image  = "busybox:1.36"
      cpu    = 0.25
      memory = "0.5Gi"

      command = ["/bin/sh", "-c", "echo '${local.promscrape_config_b64}' | base64 -d > /etc/promscrape/config.yml"]

      volume_mounts {
        name = "promscrape-config"
        path = "/etc/promscrape"
      }
    }

    container {
      name   = "victoria-metrics"
      image  = var.victoria_metrics_image
      cpu    = 0.5
      memory = "1Gi"

      args = [
        "-retentionPeriod=5y",
        "-dedup.minScrapeInterval=1m",
        "-storageDataPath=/victoria-metrics-data",
        "-httpListenAddr=:8428",
        "-promscrape.config=/etc/promscrape/config.yml",
      ]

      volume_mounts {
        name = "vm-data"
        path = "/victoria-metrics-data"
      }

      volume_mounts {
        name = "promscrape-config"
        path = "/etc/promscrape"
      }
    }

    volume {
      name         = "vm-data"
      storage_name = azurerm_container_app_environment_storage.vm.name
      storage_type = "AzureFile"
    }

    volume {
      name         = "promscrape-config"
      storage_type = "EmptyDir"
    }
  }
}

# ── API Container App ──

resource "azurerm_container_app" "api" {
  count = var.api_image != "" ? 1 : 0

  name                         = "${var.environment_name}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.main.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.25
      memory = "0.5Gi"

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
        name = "VictoriaMetrics__Url"
        # Container Apps inter-app communication uses internal ingress on port 80.
        # VictoriaMetrics runs internal-only (targetPort 8428), reachable via app name.
        value = "http://${azurerm_container_app.vm.name}"
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

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.main.id
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
    target_port      = 9200
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "epcube-exporter"
      image  = var.epcube_image
      cpu    = 0.25
      memory = "0.5Gi"

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
        value = "9200"
      }

      env {
        name  = "EPCUBE_INTERVAL"
        value = "60"
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
