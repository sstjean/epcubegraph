# Quickstart: Verify Per-Environment Application Insights

**Feature**: `115-appinsights-per-environment` | **Date**: 2026-06-01

This runbook is the **end-to-end evidence** for FR-009 / SC-005: a full
deploy-then-destroy cycle proving (a) staging gets its own Application Insights
resource, (b) its connection string differs from production's, and (c) teardown
removes the staging monitoring resources while production is untouched. Everything
here runs from the repository alone — no portal steps.

## Prerequisites

- `az login` to the target subscription.
- `gh` authenticated (for `workflow_dispatch`), or use the Actions UI.
- Run from repo root unless noted.

## Step 1 — Deploy a staging environment

```bash
gh workflow run cd.yml \
  -f environment=staging \
  -f branch_name=115-appinsights-per-environment \
  -f destroy=false
```

Wait for the deploy job to complete. The env name is
`epcubegraph-115-appi` (branch slug, ≤8 chars), so resources are
`epcubegraph-115-appi-appinsights`, `epcubegraph-115-appi-logs`, etc.

## Step 2 — Run the post-deploy validator (R1–R3)

```bash
cd infra
./validate-deployment.sh --rg epcubegraph-115-appi-rg
```

Expect the new **Application Insights** section to PASS:
- `${ENV}-appinsights` exists,
- it is linked to `${ENV}-logs`,
- the API exposes `APPLICATIONINSIGHTS_CONNECTION_STRING` → secret ref
  `appinsights-connection-string`.

## Step 3 — Confirm distinct resource + distinct connection string (R4 / SC-002)

```bash
STAGING_CS=$(az monitor app-insights component show \
  --app epcubegraph-115-appi-appinsights -g epcubegraph-115-appi-rg \
  --query connectionString -o tsv)
PROD_CS=$(az monitor app-insights component show \
  --app epcubegraph-appinsights -g epcubegraph-rg \
  --query connectionString -o tsv)

[ "$STAGING_CS" != "$PROD_CS" ] && echo "PASS: distinct connection strings" \
  || echo "FAIL: staging and production share a connection string"
```

## Step 4 — (SC-001 / FR-002) Confirm production map is clean

Generate traffic + a deliberate error in staging, then open the **production**
Application Insights (`epcubegraph-appinsights`) Application Map / Failures.
Because production's map is computed from production's resource only, no staging
component or exception can appear there. Confirm zero staging telemetry.

## Step 5 — Destroy the staging environment (R5 / SC-003)

```bash
gh workflow run cd.yml \
  -f environment=staging \
  -f branch_name=115-appinsights-per-environment \
  -f destroy=true
```

## Step 6 — Confirm teardown removed monitoring; production intact (SC-003 / SC-004)

```bash
# Staging monitoring resources gone:
az monitor app-insights component show \
  --app epcubegraph-115-appi-appinsights -g epcubegraph-115-appi-rg 2>/dev/null \
  && echo "FAIL: staging AppInsights still exists" \
  || echo "PASS: staging AppInsights removed"

az monitor log-analytics workspace show \
  --workspace-name epcubegraph-115-appi-logs -g epcubegraph-115-appi-rg 2>/dev/null \
  && echo "FAIL: staging Log Analytics still exists" \
  || echo "PASS: staging Log Analytics removed"

# Production untouched:
az monitor app-insights component show \
  --app epcubegraph-appinsights -g epcubegraph-rg \
  --query name -o tsv \
  && echo "PASS: production AppInsights intact"
```

## Step 7 — (SC-006) Two concurrent staging environments (optional)

Repeat Step 1 with a second `branch_name`. Each resolves to its own
`${env}-appinsights` by `environment_name`, so their telemetry cannot commingle.
Confirm via Step 3 that all three connection strings (two staging + production)
are pairwise distinct.

## Success criteria mapping

| Step | Proves |
|------|--------|
| 2 | FR-009 (R1–R3 enforceable from repo) |
| 3 | SC-002 (distinct resources + connection strings) |
| 4 | SC-001 / FR-002 (production map free of staging) |
| 5–6 | SC-003 / SC-004 (teardown removes staging monitoring; production intact) |
| 7 | SC-006 (multiple staging envs isolated) |
