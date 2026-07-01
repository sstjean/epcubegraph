# Research: Internal Container Apps env + Application Gateway WAF_v2 edge

**Feature**: 168-internal-appgw-waf-edge | **Date**: 2026-06-21 | **Phase**: 0

All Technical Context items were resolved during `/speckit.clarify` (4 questions) and the prior architecture investigation. No open `NEEDS CLARIFICATION` remain. This document records the design decisions, rationale, and rejected alternatives that ground Phase 1.

---

## D1 — Make the Container Apps environment internal

- **Decision**: Set `internal_load_balancer_enabled = true` on `azurerm_container_app_environment.main`. The env keeps `infrastructure_subnet_id`. The env then exposes only an **internal** load-balancer IP (`static_ip_address`), no public inbound IP.
- **Rationale**: An external + custom-infrastructure-subnet env is the exact shape that provisions an Azure-managed inbound public IP through the path now gated behind the `Microsoft.Network/AllowBringYourOwnPublicIpAddress` (BYOPIP) feature. An **internal** env provisions only an internal LB, so that gate is never reached (FR-001, FR-002, FR-003). It also satisfies ZT — no compute has a public IP (FR-006).
- **Critical property**: `internal_load_balancer_enabled` is **ForceNew** — it cannot be flipped in place; Terraform replaces the environment. This is the root reason the production migration must be blue-green (see D8).
- **Alternatives rejected**:
  - Register the BYOPIP feature (R1 bridge) — fastest unblock but leaves a BYOIP-class feature enabled subscription-wide; rejected by the owner on ZT/SFI grounds.
  - Remove VNet integration to go back to a plain external env — loses the private Key Vault / PostgreSQL path; not acceptable.

## D2 — App Gateway WAF_v2 as the single public edge

- **Decision**: Add `application-gateway.tf` with `azurerm_application_gateway` SKU `WAF_v2`, autoscale **min = 1**, **max = 3** capacity units, fronted by one `azurerm_public_ip` (Standard, Static, Azure-managed — **not** BYO).
- **Rationale**: Cheapest option meeting the managed-OWASP-WAF (SFI) bar with a private origin and an Azure-managed IP (FR-004, FR-005). Verified live retail pricing: WAF_v2 ≈ $323.39/mo fixed + ~$10–21/mo capacity + ~$4/mo IP ≈ **$340/mo** prod; ephemeral staging ≈ $0.46/hr. Min=1 honors FR-018 (cost-optimal floor); max=3 absorbs spikes.
- **Alternatives rejected**: Front Door Premium (~$412.50/mo, ~$70/mo more); Front Door Standard / custom-rules-only edge (no managed OWASP ruleset → fails SFI); plain internal LB (no public access).

## D3 — Dedicated App Gateway subnet

- **Decision**: Add a dedicated subnet (e.g., `appgw`, a `/24`) in the existing `azurerm_virtual_network.main`, used **only** by the App Gateway. No delegation. `default_outbound_access_enabled = false` to match the SFI subnet constraint (constitution §Security SFI), consistent with the other subnets.
- **Rationale**: App Gateway v2 requires its own dedicated subnet (cannot share with other resources). `/24` is the Azure-recommended size for v2 autoscale headroom; `/26` is the hard minimum. The existing VNet has room alongside `infrastructure`, `endpoints`, `postgres`.
- **Alternatives rejected**: Reusing `infrastructure` (forbidden — it's delegated to `Microsoft.App/environments`); `/26` (works but leaves no autoscale headroom).

## D4 — Private DNS for the internal env default domain

- **Decision**: Add `azurerm_private_dns_zone` named after the env's auto-generated `default_domain` (e.g., `<unique>.<region>.azurecontainerapps.io`), a VNet link to `main`, and a **wildcard A record** (`*`) pointing at `azurerm_container_app_environment.main.static_ip_address`.
- **Rationale**: An internal env's app FQDNs (`<env>-api.<default_domain>`, `<env>-exporter.<default_domain>`) resolve to the internal LB only via a private DNS zone linked to the VNet. Without it, the App Gateway backend health probe and the self-hosted VNet runner cannot resolve the origin (FR-007). The `static_ip_address` attribute is populated by Azure after the (internal) env is created.
- **Alternatives rejected**: Hosts-file / hardcoded IP backend (brittle, breaks on env recreate); public DNS (defeats internal-only).

## D5 — Backend pools, health probes, listeners, routing

- **Decision**: In `application-gateway.tf`:
  - **Backend pools**: API → `<env>-api.<default_domain>`; exporter → `<env>-exporter.<default_domain>` (FQDN-based; resolved via D4 private DNS).
  - **Backend HTTP settings**: HTTPS to the apps (Container Apps ingress terminates TLS internally), `pick_host_name_from_backend_address = true` (or explicit host header = app FQDN) so SNI/Host match the app's ingress.
  - **Health probes**: API probe path `/api/v1/health` (matches the CD smoke test and `azurerm_container_app` ingress); exporter probe path = its health endpoint. Probe host = app FQDN.
  - **Listeners**: HTTPS:443 listeners per public hostname (API subdomain, exporter subdomain) using the KV-referenced wildcard cert (D6); optional HTTP:80 → HTTPS redirect.
  - **Routing rules**: host-based routing → correct backend pool per hostname.
- **Rationale**: Reflects each origin's real health endpoint (FR-008) so the edge only serves healthy backends; host-based routing supports both the API and exporter behind one gateway.
- **Alternatives rejected**: Path-based single-hostname routing (would change public URLs and break OAuth callback host); IP-based backend (breaks on env recreate).

## D6 — TLS: Key Vault-referenced wildcard cert via ACME (Let's Encrypt)

- **Decision**: A single **wildcard `*.devsbx.xyz`** certificate is auto-issued and auto-renewed into the existing Key Vault by an ACME (Let's Encrypt) automation using the **DNS-01** challenge against the existing Azure DNS zone (`devsbx.xyz` in `devsbx-shared`). The App Gateway references the cert from Key Vault via a **user-assigned managed identity** granted `certificates/get` + `secrets/get`. The standard implementation is the **KeyVault-Acmebot** Azure Functions app (or equivalent) deployed once in a shared scope.
- **Rationale**: App Gateway WAF_v2 cannot use the free Azure-managed certs that Container Apps/SWA get via CNAME validation (that mechanism requires the app to be publicly reachable, which dies when the env goes internal). A KV-referenced cert keeps secret material out of Terraform state (ZT-clean) and is consumed via managed identity; ACME makes it free and auto-renewing (FR-012). A **single wildcard** reused across every environment's gateway avoids per-env issuance and covers ephemeral branch subdomains (`epcube-api-<branch>.devsbx.xyz`) since `*.devsbx.xyz` matches one label level.
- **Alternatives rejected**: Per-env per-domain issuance (more moving parts, slower ephemeral spin-up); manual/purchased cert (manual renewal toil — Q2 option B); PFX uploaded to the listener (secret in state — weaker ZT, Q2 option C); switching to Front Door for free managed certs (rejected on cost in D2).

## D7 — WAF policy: managed OWASP ruleset, Prevention mode

- **Decision**: `azurerm_web_application_firewall_policy` with a **managed OWASP** ruleset (e.g., OWASP 3.2) in **Prevention** mode, associated to the gateway. Start with a small, documented exclusion list for known dashboard/API false positives; tune exclusions rather than dropping to Detection.
- **Rationale**: SFI and US3 acceptance scenario require the WAF to actually inspect **and act** (block), which Detection (log-only) does not satisfy (FR-005, Q3). Identical policy in every env preserves parity (FR-011).
- **Alternatives rejected**: Detection-first-then-flip (drift vs parity, leaves a window non-compliant); custom rules only (not a managed ruleset → fails SFI).

## D8 — Production blue-green cutover

- **Decision**: Because the env replace is ForceNew (D1), production migrates via a **blue-green parallel cutover** runbook (see quickstart.md):
  1. Stand up the new **internal** env + App Gateway as additive resources (no destroy of the live external env yet).
  2. Validate the new stack end-to-end (health smoke tests against the new gateway).
  3. Repoint the custom-domain CNAMEs in the shared `devsbx.xyz` zone from the old Container App FQDN to the new App Gateway public address; let DNS propagate.
  4. Decommission the old external env once traffic is confirmed on the new edge.
- **Rationale**: Near-zero downtime, reversible, and the private PostgreSQL data is never touched (separate resource) (FR-015, Q1). Staging proves the exact pattern first (parity), de-risking the prod step.
- **Alternatives rejected**: Single in-place `terraform apply` (destroy+recreate → outage window — Q1 option B); deferring prod indefinitely (breaks parity/ZT — Q1 option C).

## D9 — Make app ingress internal; repoint outputs and custom domains

- **Decision**:
  - Set `external_enabled = false` on the API and exporter `ingress` blocks so the apps are reachable only within the VNet / via the gateway (FR-006).
  - Repoint `output "api_fqdn"` / `output "exporter_fqdn"` to the **App Gateway public hostname** (the API/exporter custom-domain FQDN) so the CD smoke tests (`curl https://${API_FQDN}/...`) resolve to the edge with no command change (FR-009, FR-010).
  - Repoint the custom-domain CNAMEs (`dns.tf`) to the App Gateway public address; remove the now-unreachable Container App managed-cert binding path (`azurerm_container_app_custom_domain.api`, `terraform_data.api_cert_bind`, related `time_sleep`s).
  - Assign API/exporter subdomains for **staging** branch envs (`custom-domains-staging.tfvars`) so staging has a resolvable HTTPS endpoint under the wildcard cert — required for parity and for the smoke tests to hit valid TLS.
- **Rationale**: The smoke commands stay byte-for-byte identical; only the value of the `api_fqdn` output changes (Q-assumption). Staging currently has no custom domain; parity + valid-TLS smoke testing require giving it a branch subdomain covered by the wildcard.
- **Alternatives rejected**: Keeping the Container App managed cert (impossible once internal); curl `-k` against the gateway IP for staging (defeats TLS validation, diverges from prod).

## D10 — Observability for the edge (carried from clarify "deferred")

- **Decision**: Route App Gateway + WAF diagnostic logs (access, firewall) to the environment's existing Log Analytics workspace / per-env Application Insights (issue #115). Plan-level detail; no spec ambiguity.
- **Rationale**: WAF block events must be queryable to tune exclusions (D7) and to verify SC-003. Reuses existing per-env telemetry isolation.
- **Alternatives rejected**: No diagnostics (can't verify or tune the WAF).

---

## Open risks / watch-items (for tasks + review)

- **Cert dependency ordering**: the App Gateway listener needs the wildcard cert present in Key Vault before apply; the ACME automation must run (or the cert be pre-seeded) ahead of the first gateway creation. Sequence in tasks.
- **Env `default_domain` / `static_ip_address` timing**: both are computed after the internal env exists; the private DNS zone + wildcard A record + gateway backend depend on them (`depends_on` / two-phase apply may be needed).
- **Ephemeral staging cost discipline**: each staging env now creates a real App Gateway; teardown (`gh workflow run cd.yml ... destroy=true`) must remove it to honor FR-014/SC-006.
- **WAF false positives**: first deploy may block legitimate dashboard/API calls; D10 diagnostics + D7 exclusions are the mitigation.
