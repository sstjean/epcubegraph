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
  default     = "eastus"
}

variable "victoria_metrics_image" {
  description = "VictoriaMetrics container image"
  type        = string
  default     = "victoriametrics/victoria-metrics:v1.106.1"
}

variable "vmauth_image" {
  description = "vmauth container image"
  type        = string
  default     = "victoriametrics/vmauth:v1.106.1"
}

variable "api_image" {
  description = "API container image (set by deploy.sh after build; leave empty to skip API deployment)"
  type        = string
  default     = ""
}
