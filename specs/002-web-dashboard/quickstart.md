# Quickstart: Web Dashboard for Energy Telemetry

**Branch**: `002-web-dashboard` | **Date**: 2026-03-16

---

## Prerequisites

- Node.js 22 LTS (`node --version`)
- npm 10+ (`npm --version`)
- Feature 001 API running (locally or on Azure) — see [001 quickstart](../001-data-ingestor/quickstart.md)
- An Entra ID tenant with the API app registration from Feature 001
- A dashboard app registration (public client, SPA) with delegated `user_impersonation` permission

---

## 1. Clone and Install

```bash
git clone <repo-url> epcubegraph
cd epcubegraph/dashboard

npm install
```

### Runtime Dependencies

| Package | Purpose |
|---------|---------|
| `preact` | 3KB UI framework (JSX + hooks) |
| `preact-router` | Client-side routing |
| `@azure/msal-browser` | Entra ID OAuth 2.0 PKCE auth for SPAs |
| `uplot` | Canvas-based time-series charting |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `vite` | Build tool + dev server |
| `typescript` | Type checking |
| `vitest` | Test runner |
| `happy-dom` | DOM environment for tests |
| `@testing-library/preact` | Component testing utilities |
| `@testing-library/jest-dom` | DOM assertion matchers |
| `@testing-library/user-event` | User interaction simulation |
| `@vitest/coverage-v8` | V8-based code coverage |

---

## 2. Configure Environment

Create `dashboard/.env.local`:

```bash
# Feature 001 API base URL (no trailing slash)
VITE_API_BASE_URL=http://localhost:8080/api/v1

# Dashboard Entra ID app registration (public client)
VITE_ENTRA_CLIENT_ID=<dashboard-app-client-id>
VITE_ENTRA_TENANT_ID=<your-entra-tenant-id>

# API scope (matches the API app registration from Feature 001)
VITE_ENTRA_API_SCOPE=api://<api-app-client-id>/user_impersonation
```

> **Note**: These are not secrets. The client ID and tenant ID are public identifiers. No client secret is needed for SPAs (PKCE flow).

---

## 3. Run Development Server

```bash
cd dashboard
npm run dev
```

Opens at `http://localhost:5173`. Vite provides hot module replacement (HMR) — changes reflect instantly.

The first visit will redirect to the Entra ID login page. After authentication, you'll be redirected back to the dashboard.

---

## 4. Run Tests

```bash
cd dashboard

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage (100% threshold enforced)
npm run test:coverage
```

### Coverage Enforcement

Coverage thresholds are configured in `vitest.config.ts`:

```
✓ Branches:   100%
✓ Functions:  100%
✓ Lines:      100%
✓ Statements: 100%
```

The CI pipeline runs `npm run test:coverage` and fails the build if any threshold drops below 100%.

---

## 5. Build for Production

```bash
cd dashboard
npm run build
```

Output: `dashboard/dist/` — static files ready for deployment to Azure Static Web Apps.

Build artifacts:
```
dist/
├── index.html          # SPA entry point
├── assets/
│   ├── index-<hash>.js  # Bundled + minified JS (~75KB gzip)
│   └── index-<hash>.css # Bundled + minified CSS
└── staticwebapp.config.json  # SWA routing config
```

---

## 6. Deploy to Azure

### Infrastructure (first time)

```bash
cd infra

# Initialize Terraform
terraform init

# Plan and apply (adds Static Web App + Grafana to existing infra)
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars

# Get the deployment token for GitHub Actions
terraform output -raw swa_deployment_token
```

### SPA Deployment (CI/CD)

The GitHub Actions workflow builds and deploys the dashboard automatically on push to `main`:

```yaml
- uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOYMENT_TOKEN }}
    app_location: 'dashboard'
    output_location: 'dist'
```

### Manual Deployment (optional)

```bash
# Install SWA CLI
npm install -g @azure/static-web-apps-cli

# Deploy built assets
cd dashboard
swa deploy dist --deployment-token <token>
```

---

## 7. Grafana Setup

After infrastructure deployment, Grafana is accessible at:
```
https://<environment-name>-grafana.<region>.azurecontainerapps.io
```

1. Log in with admin credentials (password from Key Vault: `grafana-admin-password`)
2. The Infinity data source is auto-provisioned (connects to the REST API with OAuth2) — verify at Settings → Data Sources
3. Create a new dashboard → Add panel → Select "EP Cube Graph API" data source
4. Set URL to `/query_range?query=echonet_battery_state_of_capacity_percent&start=$__from&end=$__to&step=1m`
5. Configure the parser to extract `data.result[0].values` as time-series data

---

## Project Structure

```
dashboard/
├── index.html               # SPA entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── staticwebapp.config.json  # Azure SWA routing
├── .env.local                # Local dev config (git-ignored)
├── src/
│   ├── main.tsx             # Entry: MSAL init + router mount
│   ├── App.tsx              # Nav header + preact-router routes
│   ├── auth.ts              # MSAL configuration + token acquisition
│   ├── api.ts               # Typed API client (fetch wrapper)
│   ├── types.ts             # TypeScript interfaces for API responses
│   ├── vite-env.d.ts        # Vite client type declarations
│   ├── components/
│   │   ├── CurrentReadings.tsx
│   │   ├── HistoricalGraph.tsx
│   │   ├── HistoryView.tsx
│   │   ├── DeviceCard.tsx
│   │   ├── TimeRangeSelector.tsx
│   │   └── ErrorBoundary.tsx
│   └── utils/
│       ├── formatting.ts
│       └── polling.ts
├── tests/
│   ├── unit/
│   │   ├── api.test.ts
│   │   ├── auth.test.ts
│   │   ├── formatting.test.ts
│   │   ├── main.test.tsx
│   │   └── polling.test.ts
│   └── component/
│       ├── App.test.tsx
│       ├── CurrentReadings.test.tsx
│       ├── HistoricalGraph.test.tsx
│       ├── HistoryView.test.tsx
│       ├── DeviceCard.test.tsx
│       └── TimeRangeSelector.test.tsx
└── public/
    └── favicon.ico
```

---

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Start dev server with HMR |
| `build` | `tsc && vite build` | Type-check + production build |
| `preview` | `vite preview` | Preview production build locally |
| `test` | `vitest run` | Run all tests once |
| `test:watch` | `vitest` | Run tests in watch mode |
| `test:coverage` | `vitest run --coverage` | Run tests with 100% coverage enforcement |

---

## Performance Validation (SC-001 / SC-002)

Automated timing assertions in happy-dom are not meaningful — real-browser performance depends on canvas GPU acceleration (uPlot) and network latency. Validate the two performance success criteria manually:

### SC-001: Current readings displayed within 2 seconds

1. Open Chrome DevTools → **Performance** tab
2. Navigate to `http://localhost:5173/` (or the deployed SWA URL)
3. Click **Record**, then hard-refresh the page (Cmd+Shift+R)
4. Stop recording after the dashboard renders
5. Verify the **DOMContentLoaded → Last Paint** span is under 2 seconds
6. Check the **Network** tab — the `/api/v1/devices` + instant query calls should complete within ~500ms

### SC-002: 30-day historical graph renders within 2 seconds

1. Open Chrome DevTools → **Performance** tab
2. Navigate to the **Historical Graphs** view (`/history`)
3. Click **Record**, then select the **30d** time range preset
4. Stop recording after the chart renders
5. Verify the total render time (from range selection to chart paint) is under 2 seconds
6. With ~8,640 data points (30 days × 5-min intervals), uPlot's canvas rendering should complete in <100ms

> **Note**: These targets assume the Feature 001 API returns 30-day range query results within ~1 second (validated by API performance tests in `api/tests/EpCubeGraph.Api.Tests/Integration/PerformanceTests.cs`).
