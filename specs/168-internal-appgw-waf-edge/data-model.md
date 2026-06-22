# Data Model: Internal Container Apps env + Application Gateway WAF_v2 edge

**Feature**: 168-internal-appgw-waf-edge | **Date**: 2026-06-21 | **Phase**: 1

This feature has **no application data model and no database schema changes** (PostgreSQL is untouched — FR-016). The "entities" here are the infrastructure resources and their relationships. This document maps the spec's Key Entities to concrete Terraform resources, their key attributes, validation rules, and lifecycle/state transitions.

## Entity / Resource map

### E1 — Container Apps environment (internal)

- **Terraform**: `azurerm_container_app_environment.main` (MODIFY)
- **Key attributes**:
  - `internal_load_balancer_enabled = true` (**NEW**, ForceNew)
  - `infrastructure_subnet_id` (existing → `azurerm_subnet.infrastructure.id`)
  - `static_ip_address` (computed; internal LB IP — consumed by E4)
  - `default_domain` (computed; private domain — consumed by E4/E5)
- **Validation rules**: no public inbound IP after apply (SC-002); env must provision on a BYOPIP-unregistered subscription (FR-002).
- **Lifecycle**: `internal_load_balancer_enabled` is ForceNew → changing it replaces the env (drives blue-green, E-migration). `lifecycle.ignore_changes` retains `infrastructure_resource_group_name`, `workload_profile`.

### E2 — API & exporter Container Apps (internal ingress)

- **Terraform**: `azurerm_container_app.api`, `azurerm_container_app.exporter` (MODIFY)
- **Key attributes**: `ingress.external_enabled = false` (**CHANGED** from `true`); `target_port`, `transport = "http"` unchanged.
- **Validation rules**: not directly reachable from the public internet; reachable only via the VNet / edge (FR-006, SC-002 "zero compute resources directly reachable").
- **Lifecycle**: flipping `external_enabled` updates ingress in place (not ForceNew on the app); FQDN remains `<env>-api.<default_domain>` resolvable only via private DNS (E5).

### E3 — WAF public edge (Application Gateway)

- **Terraform**: `azurerm_application_gateway.main` (NEW) + `azurerm_public_ip.appgw` (NEW)
- **Key attributes**:
  - SKU `WAF_v2`; `autoscale_configuration { min_capacity = 1, max_capacity = 3 }` (FR-018)
  - `azurerm_public_ip`: `Standard` / `Static` / Azure-managed (FR-004 — the **only** public IP in the env)
  - `identity { type = "UserAssigned" }` → E7 (for KV cert access)
  - `ssl_certificate { key_vault_secret_id = <wildcard cert> }` → E6
  - `firewall_policy_id` → E8
  - backend pools / probes / http settings / listeners / routing rules per D5
- **Validation rules**: exactly one public IP per env (SC-002); listeners terminate TLS using E6; routing reaches E2 over the private path (FR-008).
- **Lifecycle**: created additively during blue-green; destroyed on ephemeral teardown (FR-014).

### E4 — Private DNS zone for env default domain

- **Terraform**: `azurerm_private_dns_zone.env_domain` (NEW) + `azurerm_private_dns_zone_virtual_network_link.env_domain` (NEW) + `azurerm_private_dns_a_record.env_wildcard` (NEW)
- **Key attributes**: zone `name = azurerm_container_app_environment.main.default_domain`; VNet link → `azurerm_virtual_network.main`; A record name `*` → `azurerm_container_app_environment.main.static_ip_address`.
- **Validation rules**: app FQDNs resolve to the internal LB inside the VNet (FR-007); required for E3 probe + self-hosted runner resolution.
- **Lifecycle**: depends on E1 being created first (needs computed `default_domain` + `static_ip_address`).

### E5 — App Gateway subnet

- **Terraform**: `azurerm_subnet.appgw` (NEW)
- **Key attributes**: dedicated `/24` (recommended) in `azurerm_virtual_network.main`; no delegation; App Gateway-only; `default_outbound_access_enabled = false` (SFI subnet constraint).
- **Validation rules**: must not be shared with other resources (App Gateway v2 constraint); ≥ `/26`; `default_outbound_access_enabled = false` to match SFI enforcement (constitution §Security SFI).

### E6 — Shared wildcard TLS certificate

- **Terraform**: `azurerm_key_vault_certificate` reference (cert auto-issued by the ACME automation, **not** authored inline) consumed via `key_vault_secret_id`.
- **Key attributes**: subject `*.devsbx.xyz`; auto-renew via ACME DNS-01 against the `devsbx.xyz` Azure DNS zone; stored in the existing private Key Vault.
- **Validation rules**: present in Key Vault before the gateway listener is applied (sequencing risk in research D6); covers every env's API/exporter subdomain (one label level).
- **Lifecycle**: issued/renewed out-of-band by the ACME automation; gateway reads the latest version via versionless secret id.

### E7 — Gateway user-assigned managed identity

- **Terraform**: a **dedicated** `azurerm_user_assigned_identity.appgw` (least-privilege per ZT — not the shared `main` identity); plus a Key Vault access grant (`certificates/get`, `secrets/get`).
- **Key attributes**: assigned to E3; granted read on E6 in the vault.
- **Validation rules**: least-privilege (cert/secret get only); no secret material in Terraform state (ZT — Q2).

### E8 — WAF policy

- **Terraform**: `azurerm_web_application_firewall_policy.main` (NEW)
- **Key attributes**: managed OWASP ruleset (e.g., 3.2); `policy_settings { mode = "Prevention", enabled = true }`; documented `exclusion` list for known false positives.
- **Validation rules**: managed ruleset attached + enabled, Prevention mode, identical across envs (FR-005, FR-011, SC-003).

### E9 — Public FQDN / address outputs

- **Terraform**: `output "api_fqdn"`, `output "exporter_fqdn"` (MODIFY)
- **Key attributes**: now resolve to the App Gateway public hostname (API/exporter custom-domain FQDN) instead of the Container App default FQDN.
- **Validation rules**: CD smoke tests consume these unchanged; the curl commands must remain byte-identical (FR-010).

### E10 — Custom-domain DNS records

- **Terraform**: `azurerm_dns_cname_record.api` (+ exporter) in `dns.tf` (MODIFY); remove `azurerm_container_app_custom_domain.api`, `terraform_data.api_cert_bind`, related `time_sleep`s.
- **Key attributes**: CNAME `<api_subdomain>.devsbx.xyz` → App Gateway public address; staging branch subdomains added (E-staging).
- **Validation rules**: existing public hostnames preserved where configured (FR-012); TLS terminates at the edge via E6.

### E-migration — Production blue-green transition

- **Not a standing resource** — a runbook state transition (quickstart.md).
- **State transitions**:
  1. `external env (live)` → `external env (live) + new internal env + edge (additive)`
  2. validate new edge → `repoint CNAME to new edge`
  3. confirm traffic on edge → `destroy old external env`
- **Validation rules**: near-zero downtime, reversible at step 2, PostgreSQL untouched (FR-015).

### E-staging — Ephemeral staging environment

- **Composite**: a full replica of E1–E10 with a branch-scoped `environment_name` and branch subdomains.
- **Validation rules**: created from scratch with no BYOPIP error (FR-002); fully removed on teardown so no residual edge/cost (FR-014, SC-006).

## Relationship summary

```text
azurerm_public_ip.appgw ─┐
                         ├─> azurerm_application_gateway.main (E3, WAF_v2)
azurerm_subnet.appgw ────┘        │   ├─ identity ──> uami (E7) ──get──> KV wildcard cert (E6)
                                  │   ├─ firewall_policy ──> WAF policy (E8, OWASP/Prevention)
                                  │   └─ backend FQDN ──resolve via──> private DNS zone (E4)
                                  │                                       └─ * A ──> env.static_ip (E1 internal LB)
                                  └─ routes ──> Container Apps (E2, external_enabled=false)
outputs api_fqdn/exporter_fqdn (E9) ──> App Gateway public hostname ──> CNAME (E10) in devsbx.xyz
PostgreSQL (unchanged, private) ── no edge relationship (FR-016)
```
