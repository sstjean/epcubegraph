# Contract: Public Edge (Application Gateway WAF_v2)

**Feature**: 168-internal-appgw-waf-edge | **Date**: 2026-06-21 | **Phase**: 1

The "external interface" this feature exposes is the **public edge contract**: the hostnames, TLS, routing, health behavior, security posture, and Terraform output surface that downstream consumers (the dashboard browser, the Emporia OAuth provider, the CD smoke tests, and security reviewers) depend on. This document is the verifiable contract; each clause maps to FRs/SCs and is checkable by inspection or smoke test.

## C1 — Public ingress surface

| Property | Contract |
|----------|----------|
| Public IPs per environment | **Exactly one** — the App Gateway public IP (Standard, Static, **Azure-managed**, not BYO). (FR-004, SC-002) |
| Compute public exposure | **None.** API & exporter `ingress.external_enabled = false`; env is internal. (FR-006, SC-002) |
| BYOPIP feature | **Never required or registered.** (FR-003, SC-007) |

## C2 — Hostnames & TLS

| Property | Contract |
|----------|----------|
| API public hostname | `<api_subdomain>.<zone>` (prod: `epcube-api.devsbx.xyz`); CNAME → App Gateway public address. (FR-012) |
| Exporter public hostname | `<exporter_subdomain>.<zone>` (prod: `epcube-debug.devsbx.xyz`); CNAME → App Gateway public address. (FR-012) |
| Staging hostnames | Branch-scoped subdomains under `devsbx.xyz`, covered by the wildcard cert. (FR-011) |
| TLS termination | At the edge (App Gateway HTTPS:443 listener). (FR-012) |
| Certificate | Shared wildcard `*.devsbx.xyz`, Key Vault-referenced via user-assigned managed identity, ACME (Let's Encrypt) auto-issued/renewed. No secret material in Terraform state. (FR-012, Q2) |
| HTTP:80 | Optional redirect → HTTPS:443. |

## C3 — Routing & backends

| Property | Contract |
|----------|----------|
| Routing model | Host-based: API hostname → API backend pool; exporter hostname → exporter backend pool. (D5) |
| Backend addresses | App FQDNs `<env>-api.<default_domain>` / `<env>-exporter.<default_domain>`, resolved via the private DNS zone for the env default domain. (FR-007) |
| Backend transport | HTTPS to the Container Apps ingress; Host/SNI = app FQDN. |
| Health probe — API | Path `GET /api/v1/health`; host = API app FQDN; backend considered healthy on 2xx. (FR-008) |
| Health probe — exporter | Path `GET /health` (the exporter's actual health path); host = exporter app FQDN; backend considered healthy on 2xx. (FR-008) |
| Backend reachability | Private path only (VNet); never traverses the public internet. (FR-006) |

## C4 — Security posture (WAF)

| Property | Contract |
|----------|----------|
| Ruleset | Vendor-**managed OWASP** ruleset (e.g., 3.2), attached and enabled. (FR-005, SC-003) |
| Mode | **Prevention** (actively blocks matched requests) in **every** environment. (FR-005, Q3) |
| False positives | Handled via targeted rule exclusions; mode is **not** weakened to Detection. (FR-005) |
| Parity | Identical WAF policy across prod and staging. (FR-011, SC-005) |
| Observability | Access + firewall logs routed to the env's per-env Log Analytics / Application Insights, queryable for WAF block events. (FR-019, SC-010, D10) |

## C5 — Terraform output surface (consumed by CD)

| Output | Before | After (this feature) |
|--------|--------|----------------------|
| `api_fqdn` | API Container App ingress FQDN | **App Gateway public hostname** (API custom-domain FQDN). (FR-009) |
| `exporter_fqdn` | Exporter Container App ingress FQDN | **App Gateway public hostname** (exporter custom-domain FQDN). (FR-009) |
| `postgres_fqdn` | private PG FQDN | **unchanged** (FR-016) |

**Smoke-test invariant**: the CD commands `curl -fsS "https://${API_FQDN}/api/v1/health"` and the exporter health curl remain **byte-for-byte unchanged**; only the resolved value of `api_fqdn`/`exporter_fqdn` changes. (FR-010)

## C6 — Application-behavior continuity

| Property | Contract |
|----------|----------|
| OAuth callback | `AZURE_REDIRECT_URI` continues to use the exporter public custom-domain (`https://<exporter_subdomain>.<zone>/.auth/callback`), now served via the edge. Must remain valid. (FR-013) |
| Dashboard CORS | API `Cors__AllowedOrigin` continues to be the dashboard public origin; unchanged by the edge. (FR-013) |
| Dashboard hosting | Static Web App + its own edge — **unchanged**. (FR-016) |
| PostgreSQL | Private, no public network access — **unchanged**. (FR-016) |

## C7 — Lifecycle contract

| Property | Contract |
|----------|----------|
| Ephemeral staging | Full edge created per env; **fully destroyed** on teardown (`destroy=true`), leaving no residual edge/cost. (FR-014, SC-006) |
| Production migration | Blue-green: additive new internal env + edge → validate → CNAME cutover → decommission old external env. Near-zero downtime, reversible, PG untouched. (FR-015, Q1) |
| Infra validation | `terraform validate` clean; `terraform plan` shows no BYOPIP-class error; changed scripts meet test-first + 100% coverage. (FR-017, SC-009) |

## Contract acceptance checks (maps to Success Criteria)

1. `terraform plan` on a BYOPIP-unregistered subscription → no `SubscriptionNotRegisteredForFeature`; env shows internal LB. → **SC-001**
2. Enumerate env resources → exactly one public IP (the gateway); zero compute public IPs. → **SC-002**
3. Inspect WAF policy → managed OWASP ruleset attached, enabled, Prevention. → **SC-003**
4. CD smoke tests (API + exporter health) pass through the gateway in staging and prod. → **SC-004**
5. Diff staging vs prod topology → identical internal-env + edge + private-DNS shape. → **SC-005**
6. Run a staging create/validate/teardown cycle → zero residual resources after destroy. → **SC-006**
7. `az feature show` for BYOPIP → unregistered; never required by any apply. → **SC-007**
8. Post-cutover: dashboard loads, OAuth login works, existing hostnames serve. → **SC-008**
9. `terraform validate` clean; changed-script coverage 100%. → **SC-009**
