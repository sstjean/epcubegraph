variable "environment_name" {
  description = "Target environment name (e.g., 'epcubegraph' for prod, 'epcubegraph-b124-dev' for staging)"
  type        = string

  validation {
    condition     = length(var.environment_name) > 0 && length(var.environment_name) < 64
    error_message = "environment_name must be a non-empty string under 64 characters."
  }
}
