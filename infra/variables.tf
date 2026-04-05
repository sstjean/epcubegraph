# EP Cube Graph — Input Variables

variable "environment_name" {
  description = "Name prefix for all Azure resources (e.g., 'epcubegraph')"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.environment_name))
    error_message = "environment_name must be 3-21 lowercase alphanumeric characters or hyphens, starting with a letter."
  }
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "centralus"
}

variable "api_image" {
  description = "API container image (set by deploy.sh after build; leave empty to skip API deployment)"
  type        = string
  default     = ""
}

variable "epcube_image" {
  description = "epcube-exporter container image (set by deploy.sh after build; leave empty to skip exporter deployment)"
  type        = string
  default     = ""
}

variable "epcube_username" {
  description = "EP Cube cloud account email (monitoring-us.epcube.com)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "epcube_password" {
  description = "EP Cube cloud account password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "allowed_ips" {
  description = "IP addresses allowed to access Key Vault and storage data plane. Populated automatically: CD pipeline detects runner IP, deploy.sh detects your public IP."
  type        = list(string)
  default     = []
}

variable "keyvault_public_access" {
  description = "Enable public network access on Key Vault during deploys. Defaults to false (SFI compliance). CD pipeline passes true to allow Terraform to write secrets."
  type        = bool
  default     = false
}

# ── Custom Domains ──

variable "custom_domain_zone_name" {
  description = "DNS zone name for custom domains (e.g., 'devsbx.xyz'). Empty string disables custom domains."
  type        = string
  default     = ""
}

variable "custom_domain_zone_rg" {
  description = "Resource group containing the shared DNS zone"
  type        = string
  default     = "devsbx-shared"
}

variable "dashboard_subdomain" {
  description = "Subdomain for the dashboard SWA (e.g., 'epcube' → epcube.devsbx.xyz). Empty string disables."
  type        = string
  default     = ""
}

variable "api_subdomain" {
  description = "Subdomain for the API Container App (e.g., 'epcube-api' → epcube-api.devsbx.xyz). Empty string disables."
  type        = string
  default     = ""
}

variable "custom_domain_ttl" {
  description = "TTL in seconds for custom domain DNS records"
  type        = number
  default     = 300
}

variable "exporter_subdomain" {
  description = "Subdomain for the exporter debug page (e.g., 'epcube-debug' → epcube-debug.devsbx.xyz). Empty string disables."
  type        = string
  default     = ""
}

# ── PostgreSQL ──

variable "postgres_version" {
  description = "PostgreSQL major version"
  type        = string
  default     = "17"
}

variable "postgres_admin_login" {
  description = "PostgreSQL administrator login name"
  type        = string
  default     = "epcubeadmin"
}

variable "postgres_sku" {
  description = "PostgreSQL Flexible Server SKU (e.g., B_Standard_B1ms, GP_Standard_D2s_v3)"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage size in MB"
  type        = number
  default     = 32768
}

variable "postgres_backup_retention_days" {
  description = "PostgreSQL backup retention in days (7-35)"
  type        = number
  default     = 7
}

variable "postgres_database_name" {
  description = "Name of the application database"
  type        = string
  default     = "epcubegraph"
}

# ── Container Apps — API ──

variable "api_port" {
  description = "Port the API container listens on"
  type        = number
  default     = 8080
}

variable "api_cpu" {
  description = "API container CPU cores"
  type        = number
  default     = 0.25
}

variable "api_memory" {
  description = "API container memory (e.g., 0.5Gi, 1Gi)"
  type        = string
  default     = "0.5Gi"
}

variable "api_min_replicas" {
  description = "API minimum replica count"
  type        = number
  default     = 1
}

variable "api_max_replicas" {
  description = "API maximum replica count"
  type        = number
  default     = 3
}

# ── Container Apps — Exporter ──

variable "exporter_port" {
  description = "Port the epcube-exporter listens on"
  type        = number
  default     = 9250
}

variable "exporter_poll_interval" {
  description = "Exporter poll interval in seconds"
  type        = number
  default     = 60
}

variable "exporter_cpu" {
  description = "Exporter container CPU cores"
  type        = number
  default     = 0.25
}

variable "exporter_memory" {
  description = "Exporter container memory (e.g., 0.5Gi, 1Gi)"
  type        = string
  default     = "0.5Gi"
}

variable "exporter_min_replicas" {
  description = "Exporter minimum replica count"
  type        = number
  default     = 1
}

variable "exporter_max_replicas" {
  description = "Exporter maximum replica count"
  type        = number
  default     = 1
}

# ── Networking ──

variable "vnet_address_space" {
  description = "Virtual network address space"
  type        = list(string)
  default     = ["10.0.0.0/16"]
}

variable "subnet_infrastructure_prefix" {
  description = "Container Apps infrastructure subnet (/23 minimum)"
  type        = list(string)
  default     = ["10.0.0.0/23"]
}

variable "subnet_endpoints_prefix" {
  description = "Private endpoints subnet prefix"
  type        = list(string)
  default     = ["10.0.2.0/24"]
}

variable "subnet_postgres_prefix" {
  description = "PostgreSQL delegated subnet prefix"
  type        = list(string)
  default     = ["10.0.3.0/24"]
}

# ── Supporting Services ──

variable "acr_sku" {
  description = "Azure Container Registry SKU (Basic, Standard, Premium)"
  type        = string
  default     = "Basic"
}

variable "keyvault_soft_delete_days" {
  description = "Key Vault soft-delete retention in days (7-90)"
  type        = number
  default     = 7
}

variable "log_retention_days" {
  description = "Log Analytics workspace retention in days"
  type        = number
  default     = 30
}
