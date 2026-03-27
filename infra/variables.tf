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

variable "postgres_image" {
  description = "Legacy PostgreSQL container image (unused after managed PostgreSQL migration)"
  type        = string
  default     = "postgres:17-alpine"
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
