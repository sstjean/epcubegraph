# Quickstart: Internal env + App Gateway WAF_v2 edge

**Feature**: 168-internal-appgw-waf-edge | **Date**: 2026-06-21 | **Phase**: 1

How to build, validate, and cut over the new edge. Local `az` cannot reach `epcubegraph-rg` (sandbox tenant) — Azure-touching steps run in CD or on the self-hosted VNet runner. Local steps are limited to `terraform validate`/`plan` and Bash unit tests.

## Prerequisites

- Shared wildcard cert `*.devsbx.xyz` issued into the Key Vault by the ACME automation **before** the first gateway apply (research D6 sequencing risk).
- VNet has address space for a dedicated `/24` App Gateway subnet (E5).
- Self-hosted runner can resolve the env private DNS zone (E4) over the VNet.

## Local validation (no Azure access needed)

```bash
cd infra
terraform fmt -check
terraform validate
# Any new/changed Bash (cutover/validation helpers) — red-green unit tests + lint:
bash tests/test-az-json.sh          # existing pattern; add cases for new logic
shellcheck infra/*.sh infra/tests/*  # style/lint
bash -n infra/validate-deployment.sh
```

## Per-user-story acceptance checks

Each P1 story is independently verifiable (constitution: every user story has an executable check).

### US1 — Ephemeral env creates with no BYOPIP error

```bash
# In CD (self-hosted runner), on a BYOPIP-unregistered subscription:
terraform plan   # MUST NOT show SubscriptionNotRegisteredForFeature
terraform apply  # new internal env + edge provision cleanly
az feature show --namespace Microsoft.Network \
  --name AllowBringYourOwnPublicIpAddress --query properties.state -o tsv
# Expect: NotRegistered  (SC-007)
```

### US2 — No compute has a public IP (ZT)

```bash
RG=epcubegraph-rg   # or the ephemeral env RG
# Exactly one public IP, and it belongs to the App Gateway:
az network public-ip list -g "$RG" --query "[].{name:name,ip:ipAddress}" -o table
# Env is internal (no public static IP; has an internal LB IP):
az containerapp env show -n "<env>-env" -g "$RG" \
  --query "properties.vnetConfiguration.internal" -o tsv   # Expect: true
# API/exporter ingress is internal:
az containerapp show -n "<env>-api" -g "$RG" \
  --query "properties.configuration.ingress.external" -o tsv  # Expect: false
```

### US3 — Managed OWASP WAF in Prevention

```bash
az network application-gateway waf-policy show -n "<env>-waf" -g "$RG" \
  --query "{mode:policySettings.mode, enabled:policySettings.state, managed:managedRules.managedRuleSets[].ruleSetType}" -o json
# Expect: mode=Prevention, enabled=Enabled, managed includes OWASP
```

### US4 — Public health smoke tests pass through the edge

```bash
API_FQDN=$(terraform output -raw api_fqdn)        # now the gateway hostname
curl -fsS "https://${API_FQDN}/api/v1/health"     # 200 via WAF edge (unchanged command)
EXP_FQDN=$(terraform output -raw exporter_fqdn)
curl -fsS "https://${EXP_FQDN}/health"            # exporter health via edge
```

## Production blue-green cutover runbook (US5/FR-015)

> Run after the pattern is proven green in a staging env. PostgreSQL is a separate private resource and is never touched.

1. **Additive provision** — deploy the new internal env + App Gateway alongside the live external env (no destroy yet). Validate with the US1–US4 checks against the new gateway's public IP (use a temporary host override or the gateway IP directly).
2. **Cutover DNS** — repoint the custom-domain CNAMEs in the shared `devsbx.xyz` zone (`devsbx-shared` RG) from the old Container App FQDN to the new App Gateway public address. Wait for TTL/propagation.
3. **Confirm** — re-run US4 smoke tests against `https://epcube-api.devsbx.xyz/...`; verify dashboard load + OAuth login (FR-013, SC-008).
4. **Decommission** — remove the old external env. Verify only one public IP remains (US2) and BYOPIP is still unregistered (US1).
5. **Rollback (if needed at step 2/3)** — point the CNAMEs back to the old Container App FQDN; the old env is still live until step 4.

## Ephemeral staging teardown (FR-014/SC-006)

```bash
gh workflow run cd.yml -f environment=staging -f branch=<branch> -f destroy=true
# Verify zero residual edge/env resources afterward:
az resource list -g "<ephemeral-rg>" -o table   # Expect: empty / RG gone
```

## Definition of done (gate)

- [ ] `terraform validate` + `terraform fmt -check` clean; `terraform plan` shows no BYOPIP error.
- [ ] US1–US4 checks pass in a staging env (created from scratch).
- [ ] WAF policy = managed OWASP, Prevention, identical in staging & prod (SC-005).
- [ ] CD smoke commands unchanged; `api_fqdn`/`exporter_fqdn` resolve to the gateway (FR-010).
- [ ] Changed Bash scripts: red-green tests + 100% coverage + shellcheck clean.
- [ ] Staging teardown leaves zero residual resources (SC-006).
- [ ] Prod cutover runbook executed with no downtime window; dashboard + OAuth verified (SC-008).
