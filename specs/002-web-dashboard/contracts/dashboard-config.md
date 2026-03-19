# Dashboard Configuration Contract

**Version**: 1.1.0 | **Branch**: `002-web-dashboard` | **Date**: 2026-03-16

---

## Overview

The web dashboard is a stateless SPA that does not expose its own API. Its external contracts are:

1. **API dependency**: Consumes Feature 001's API — contract defined in [api-v1.md](../../001-data-ingestor/contracts/api-v1.md)
2. **Configuration**: Environment variables provided at build time via Vite
3. **SWA routing**: `staticwebapp.config.json` for Azure Static Web Apps hosting

This document defines contracts #2 and #3.

---

## Build-Time Environment Variables

The SPA is configured via Vite environment variables (prefixed with `VITE_`). These are embedded at build time — not runtime secrets.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_BASE_URL` | yes | Base URL of the Feature 001 API (no trailing slash) | `https://epcubegraph-api.azurecontainerapps.io/api/v1` |
| `VITE_ENTRA_CLIENT_ID` | yes | Entra ID application (client) ID for the dashboard app registration | `12345678-1234-1234-1234-123456789abc` |
| `VITE_ENTRA_TENANT_ID` | yes | Entra ID tenant ID | `12345678-1234-1234-1234-123456789abc` |
| `VITE_ENTRA_API_SCOPE` | yes | The API scope to request in the access token | `api://epcubegraph/user_impersonation` |

**Security note**: None of these values are secrets. The client ID and tenant ID are public identifiers for a public client (SPA). The API scope is a well-known identifier. No client secret is used (PKCE flow).

### Local Development (`.env.local`)

```bash
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_ENTRA_CLIENT_ID=<dashboard-app-client-id>
VITE_ENTRA_TENANT_ID=<your-tenant-id>
VITE_ENTRA_API_SCOPE=api://<api-app-client-id>/user_impersonation
```

### CI/CD (GitHub Actions)

Environment variables are set in the GitHub Actions workflow via repository secrets or variables (not secret values, but variable values for the deployment environment):

```yaml
env:
  VITE_API_BASE_URL: ${{ vars.API_BASE_URL }}
  VITE_ENTRA_CLIENT_ID: ${{ vars.ENTRA_DASHBOARD_CLIENT_ID }}
  VITE_ENTRA_TENANT_ID: ${{ vars.ENTRA_TENANT_ID }}
  VITE_ENTRA_API_SCOPE: ${{ vars.ENTRA_API_SCOPE }}
```

---

## Azure Static Web Apps Configuration

### `staticwebapp.config.json`

Placed in the `dashboard/` root (alongside `index.html`). Controls SWA routing behaviour:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/*.ico", "/*.png", "/*.svg"]
  },
  "responseOverrides": {
    "404": {
      "rewrite": "/index.html"
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://login.microsoftonline.com https://*.azurecontainerapps.io; img-src 'self' data:; font-src 'self'"
  }
}
```

**Key design decisions**:
- **Navigation fallback**: All non-asset paths rewrite to `index.html` for client-side routing
- **CSP header**: Restricts script/style sources to self, allows `connect-src` to Entra ID login endpoint and the API on Azure Container Apps
- **No SWA built-in auth**: Auth is handled entirely by MSAL.js client-side. SWA's auth features are not used.

---

## Grafana Data Source Configuration

Grafana connects to the Feature 001 REST API via the **Infinity plugin** (generic JSON/REST data source). This uses the same versioned API that the native dashboard consumes, maintaining a single data access path.

### Infinity Plugin Data Source

Configured via Grafana provisioning YAML:

```yaml
apiVersion: 1
datasources:
  - name: EP Cube Graph API
    type: yesoreyeram-infinity-datasource
    access: proxy
    url: https://<api-container-app-fqdn>/api/v1
    isDefault: true
    editable: true
    jsonData:
      oauthPassThru: false
      auth_method: oauth2
      oauth2_client_id: <grafana-service-principal-client-id>
      oauth2_token_url: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
      oauth2_scopes: api://<api-app-client-id>/.default
    secureJsonData:
      oauth2_client_secret: <from-key-vault>
```

### Query Examples

**Instant query (current readings)**:
- URL: `/query?query=echonet_battery_state_of_capacity_percent`
- Parser: JSONata or UQL to extract `data.result[0].value[1]`

**Range query (time series)**:
- URL: `/query_range?query=echonet_solar_instantaneous_generation_watts&start=$__from&end=$__to&step=1m`
- Parser: Extract `data.result[0].values` as time-series

### Required Grafana Plugin

The Infinity plugin must be installed in the Grafana container. Add to the Grafana container environment:

```hcl
env {
  name  = "GF_INSTALL_PLUGINS"
  value = "yesoreyeram-infinity-datasource"
}
```
