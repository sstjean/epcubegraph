# Custom domain configuration for staging environments.
# Selected by cd.yml via -var-file for branch deploys.
#
# Staging uses auto-generated Azure hostnames — custom domains are disabled.
# Azure SWA maintains an internal domain registry that takes 30+ minutes to
# release after a staging destroy, causing repeated CD failures on recreate.
# Production custom domains are configured in custom-domains-production.tfvars.
custom_domain_zone_name = ""
custom_domain_zone_rg   = ""
dashboard_subdomain     = ""
api_subdomain           = ""
exporter_subdomain      = ""
