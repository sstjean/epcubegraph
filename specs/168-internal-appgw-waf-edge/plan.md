# Implementation Plan: Internal Container Apps environments behind Application Gateway WAF_v2 (every environment, no bring-your-own public IP)

**Branch**: `168-internal-appgw-waf-edge` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/168-internal-appgw-waf-edge/spec.md`

## Summary

Make every environment's Azure Container Apps environment **internal** (`internal_load_balancer_enabled = true`, no public IP on compute) and front it with a single **Application Gateway WAF_v2** public edge running the managed OWASP ruleset in **Prevention** mode. This permanently removes the bring-your-own-public-IP (BYOPIP) feature requirement that is currently breaking new (staging/branch) environment creation, satisfies Zero Trust (no compute is directly internet-exposed) and SFI (managed WAF at the edge), and preserves public availability for the API and exporter.

Technical approach: add `internal_load_balancer_enabled = true` to the env, set the API/exporter ingress to `external_enabled = false`, add a dedicated App Gateway subnet and a private DNS zone for the env's auto-generated default domain (wildcard A record → the env's static internal IP), introduce an `application-gateway.tf` (public IP + WAF_v2 + WAF policy + Key Vault-referenced TLS via user-assigned identity + backend pools/probes/listeners/rules for the API and exporter), repoint the `api_fqdn`/`exporter_fqdn` outputs and custom-domain DNS to the gateway, and source TLS from a shared wildcard `*.devsbx.xyz` certificate auto-issued/renewed into Key Vault via an ACME (Let's Encrypt) automation. No application source code changes are required.

## Technical Context

**Language/Version**: Terraform / HCL (`azurerm ~> 4.0`, `azuread ~> 3.0`); Bash (`set -euo pipefail`) for validation/runbook scripts. No application code (C#/Python/TypeScript) changes.
**Primary Dependencies**: Azure Application Gateway WAF_v2; Azure Container Apps (internal env); Azure Key Vault (existing, private endpoint); Azure Private DNS; Azure DNS (existing shared `devsbx.xyz` zone in `devsbx-shared`); user-assigned managed identity; ACME/Let's Encrypt cert automation (KeyVault-Acmebot pattern) for the shared wildcard cert.
**Storage**: PostgreSQL Flexible Server (unchanged, `public_network_access_enabled = false`). No schema changes. No data migration.
**Testing**: `terraform validate` + `terraform plan` (CI `validate-infra`); existing infra Bash unit tests (`infra/tests/test-az-json.sh` pattern, run under shellcheck + `bash -n`); post-deploy `infra/validate-deployment.sh` smoke tests; CD public health smoke tests (`curl https://${API_FQDN}/api/v1/health`).
**Target Platform**: Microsoft Azure (Central US). Container Apps Consumption workload profile, internal LB.
**Project Type**: Infrastructure-as-Code change to an existing Azure web service (Terraform in `infra/`).
**Performance Goals**: Edge adds negligible latency for a low-volume personal dashboard; App Gateway autoscale floor = 1 capacity unit (FR-018). Health smoke tests must pass through the edge (FR-009).
**Constraints**: ZT (exactly one public IP = the WAF edge, Azure-managed, FR-004); SFI (managed OWASP ruleset, Prevention mode, FR-005); cost-optimal (~$340/mo prod, cents/hour ephemeral staging, FR-018); no BYOPIP feature ever (FR-003); near-zero-downtime blue-green prod cutover (FR-015); PostgreSQL stays private (FR-016).
**Scale/Scope**: One production environment (24/7) plus N short-lived ephemeral staging/branch environments, each an identical full replica including its own App Gateway edge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| **I. Simplicity** | App Gateway + internal env is the minimum shape that satisfies ZT + SFI + "no BYOPIP" while keeping public availability. The cheaper internal-only-staging variant was explicitly rejected in the spec (parity). The added moving parts are justified by present, concrete requirements, not speculation. ✅ (one justified complexity — see Complexity Tracking) |
| **II. YAGNI** | No speculative options. The ACME automation and private DNS zone are each required by a current FR (FR-012 TLS, FR-007 resolution). Staging parity is a stated requirement, not a hypothetical. ✅ |
| **III. Single Responsibility** | Terraform split by concern: env stays in `container-apps.tf`; new edge isolated in `application-gateway.tf`; DNS/cert wiring in `dns.tf`/`keyvault.tf`. Any Bash automation (cert bind / ACME trigger) keeps "get state" separate from "decide/act". ✅ |
| **IV. TDD (NON-NEGOTIABLE)** | Pure Terraform resources have no unit-testable branches; coverage applies to **changed scripts** (validation/runbook Bash) which follow the existing `test-az-json.sh` red-green pattern. The acceptance gate is `terraform validate` + `terraform plan` (no BYOPIP error, exactly one public IP) plus the public health smoke tests. Each P1 user story maps to an independently runnable check (see quickstart). ✅ |
| **Platform Constraints** | All resources are Azure-native (App Gateway, Container Apps, Key Vault, Private DNS). Dashboard (SWA) and iOS client contracts unchanged. ✅ |

**Result**: PASS (with one documented complexity for the blue-green prod migration).

## Project Structure

### Documentation (this feature)

```text
specs/168-internal-appgw-waf-edge/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (infra resource/entity model)
├── quickstart.md        # Phase 1 output (validation + cutover runbook)
├── contracts/
│   └── public-edge.md   # Phase 1 output (edge routing + outputs contract)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
infra/
├── container-apps.tf        # MODIFY: env → internal_load_balancer_enabled = true;
│                            #         API/exporter ingress external_enabled = false
├── network.tf               # MODIFY: add dedicated App Gateway subnet;
│                            #         add private DNS zone for env default domain (+ VNet link, wildcard A record)
├── application-gateway.tf    # NEW: public IP + WAF_v2 + WAF policy (OWASP, Prevention) +
│                            #      KV-referenced TLS via user-assigned identity +
│                            #      backend pools/probes/listeners/routing for API + exporter
├── dns.tf                   # MODIFY: repoint custom-domain CNAMEs to the App Gateway public address;
│                            #         remove Container App managed-cert binding path (no longer reachable)
├── keyvault.tf              # MODIFY: grant the gateway identity certificate/secret get on the vault;
│                            #         wire the shared wildcard cert reference
├── outputs.tf               # MODIFY: api_fqdn / exporter_fqdn → App Gateway public hostname
├── variables.tf             # MODIFY: add appgw subnet prefix, autoscale min/max, wildcard cert name, staging subdomain vars
├── custom-domains-*.tfvars  # MODIFY: assign API/exporter subdomains (incl. ephemeral staging branch subdomains)
└── tests/                   # MODIFY/ADD: Bash unit tests for any new validation/cutover script logic

.github/workflows/cd.yml      # VERIFY: api_fqdn output now resolves to the gateway; smoke commands unchanged
```

**Structure Decision**: This is an infrastructure-only change confined to `infra/` (plus a verification pass on `.github/workflows/cd.yml`). The new public edge is isolated in a new `application-gateway.tf` to keep single-responsibility; the internal-env flip and ingress changes stay in `container-apps.tf`; DNS/cert repointing stays in `dns.tf`/`keyvault.tf`. No `api/`, `dashboard/`, or `local/` source changes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Blue-green production migration (temporary parallel env + DNS cutover, a multi-phase apply/runbook rather than a single declarative apply) | `internal_load_balancer_enabled` is a ForceNew property; a single in-place apply would destroy+recreate the prod env, causing an API/exporter outage. The spec (Q1/FR-015) chose near-zero-downtime blue-green. | An in-place recreate (Option B in clarify) is simpler but was explicitly rejected for causing a downtime window. Leaving prod on the grandfathered external env (Option C) was rejected because it breaks parity (US5) and leaves prod non-ZT. |
| App Gateway WAF_v2 added in front of every env (extra subnet, public IP, WAF policy, cert automation) | Required to keep public availability while making compute internal (ZT) and to enforce a managed OWASP ruleset (SFI) without BYOPIP. | A plain internal env with no edge removes public access (breaks availability). A custom-rules-only edge / Front Door Standard fails the managed-OWASP SFI bar. Front Door Premium meets the bar but costs ~$70/mo more (rejected on cost). |
