# Custom domain configuration for this environment.
# Terraform auto-loads *.auto.tfvars from the working directory.
#
# Branch deploys use the values checked out from the branch.
# Production deploys use the values from main.
# Update these values when merging to main for production domains.
custom_domain_zone_name = "devsbx.xyz"
custom_domain_zone_rg   = "devsbx-shared"
dashboard_subdomain     = "epcube-staging"
api_subdomain           = "epcube-api-staging"
