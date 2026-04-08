# EP Cube Graph — Application Insights
# Client-side telemetry for the dashboard SPA (FR-020).
# Linked to the existing Log Analytics workspace.

resource "azurerm_application_insights" "dashboard" {
  name                = "${var.environment_name}-appinsights"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
}
