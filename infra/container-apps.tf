# EP Cube Graph — Container Apps Environment and Applications

# ── Container Apps Environment ──

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.environment_name}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
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

# ── VictoriaMetrics + vmauth Container App ──

resource "azurerm_container_app" "vm" {
  name                         = "${var.environment_name}-vm"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  secret {
    name                = "remote-write-token"
    key_vault_secret_id = azurerm_key_vault_secret.remote_write_token.versionless_id
    identity            = azurerm_user_assigned_identity.main.id
  }

  ingress {
    external_enabled = true
    target_port      = 8427 # vmauth port
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    # Init container writes vmauth config and promscrape config to shared
    # EmptyDir volumes. vmauth's %{ENV_VAR} syntax is used for the token.
    init_container {
      name   = "config-init"
      image  = "busybox:1.36"
      cpu    = 0.25
      memory = "0.5Gi"

      command = ["/bin/sh", "-c", "echo '${local.vmauth_config_b64}' | base64 -d > /etc/vmauth/config.yml && echo '${local.promscrape_config_b64}' | base64 -d > /etc/promscrape/config.yml"]

      volume_mounts {
        name = "vmauth-config"
        path = "/etc/vmauth"
      }

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

    container {
      name   = "vmauth"
      image  = var.vmauth_image
      cpu    = 0.25
      memory = "0.5Gi"

      args = [
        "-auth.config=/etc/vmauth/config.yml",
        "-httpListenAddr=:8427",
      ]

      env {
        name        = "REMOTE_WRITE_TOKEN"
        secret_name = "remote-write-token"
      }

      volume_mounts {
        name = "vmauth-config"
        path = "/etc/vmauth"
      }
    }

    volume {
      name         = "vm-data"
      storage_name = azurerm_container_app_environment_storage.vm.name
      storage_type = "AzureFile"
    }

    volume {
      name         = "vmauth-config"
      storage_type = "EmptyDir"
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
        value = "api://${var.environment_name}"
      }

      env {
        name = "VictoriaMetrics__Url"
        # Query VictoriaMetrics directly on port 8428 within the Container Apps
        # environment. This bypasses vmauth (which enforces bearer-token auth
        # for external remote-write traffic). Internal traffic between apps in
        # the same environment uses the container app name as hostname.
        value = "http://${azurerm_container_app.vm.name}:8428"
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

  # Internal-only ingress — reachable by VictoriaMetrics within the environment
  ingress {
    external_enabled = false
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
    }
  }
}
