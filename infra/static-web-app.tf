# EP Cube Graph — Azure Static Web App (Dashboard SPA)
# Free tier, SPA fallback configured in dashboard/staticwebapp.config.json
# SWA Free tier not available in eastus — eastus2 is nearest supported region.
# SWA is a global CDN; the region only affects the management plane.

resource "azurerm_static_web_app" "dashboard" {
  name                = "${var.environment_name}-dashboard"
  location            = "eastus2"
  resource_group_name = azurerm_resource_group.main.name
  sku_tier            = "Free"
  sku_size            = "Free"
}
