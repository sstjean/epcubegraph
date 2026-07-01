# Custom domain configuration for staging environments.
# Selected by cd.yml via -var-file for branch deploys.
#
# The dashboard SWA custom domain stays DISABLED for staging: Azure SWA keeps an
# internal domain registry that takes 30+ minutes to release after a destroy,
# which breaks CD recreates. So dashboard_subdomain is intentionally empty.
#
# The API + exporter, however, are fronted by the Application Gateway WAF_v2 edge
# (feature 168). Staging needs a resolvable HTTPS host under the shared wildcard
# cert so the public health smoke tests can hit valid TLS through the edge.
#
# NOTE: these subdomains are branch-scoped to b168. Only one staging branch env
# is active at a time; a concurrent-branch design would derive these from the
# branch/environment name.
custom_domain_zone_name = "devsbx.xyz"
custom_domain_zone_rg   = "devsbx-shared"
dashboard_subdomain     = ""
api_subdomain           = "epcube-api-b168"
exporter_subdomain      = "epcube-debug-b168"

# Enables the App Gateway edge and selects the shared wildcard cert in the
# central devsbx-shared-kv vault (*.devsbx.xyz covers these branch subdomains).
wildcard_certificate_name = "wildcard-devsbx-xyz"
