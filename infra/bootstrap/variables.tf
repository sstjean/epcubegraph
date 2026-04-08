variable "environment_name" {
  description = "Environment name prefix for all resources (e.g., 'epcubegraph' for production)"
  type        = string
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "centralus"
}

variable "keyvault_soft_delete_days" {
  description = "Number of days to retain soft-deleted Key Vault secrets"
  type        = number
  default     = 7
}
