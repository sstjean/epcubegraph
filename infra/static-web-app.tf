# EP Cube Graph — Azure Static Web App (Dashboard SPA)
# Free tier, SPA fallback configured in dashboard/staticwebapp.config.json

resource "azurerm_static_web_app" "dashboard" {
  name                = "${var.environment_name}-dashboard"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku_tier            = "Free"
  sku_size            = "Free"
}
