# Tasks: Internal Container Apps environments behind Application Gateway WAF_v2 (every environment, no bring-your-own public IP)

**Input**: Design documents from `/specs/168-internal-appgw-waf-edge/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-edge.md, quickstart.md
**Feature Issue**: #173 | **User Stories**: #174 (US1), #175 (US2), #176 (US3), #177 (US4), #178 (US5), #179 (US6)

**Tests**: This is an infrastructure-only change. Per plan.md, pure Terraform resources have no unit-testable branches, so the acceptance gate is `terraform validate` + `terraform plan` plus the public health smoke tests. Test-first (TDD) applies to **changed Bash script logic** only (`infra/validate-deployment.sh` assertion helpers), exercised via the existing `infra/tests/test-az-json.sh` + `stub-az` red-green pattern (FR-017).

**Organization**: Tasks are grouped by user story. Because this is shared infrastructure, the App Gateway edge is built incrementally across the P1 stories (US2 = gateway + routing, US3 = WAF policy, US4 = outputs/probes), each delivering an independently verifiable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- All paths are relative to the repository root.

## Path Conventions

Infrastructure-as-Code change confined to `infra/` (plus a verification pass on `.github/workflows/cd.yml`). No `api/`, `dashboard/`, or `local/` source changes (plan.md Structure Decision).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Variables, shared certificate prerequisite, and a clean validation baseline before any change.

- [x] T001 [P] Add new input variables in [infra/variables.tf](infra/variables.tf): `appgw_subnet_prefix`, `appgw_autoscale_min` (default 1), `appgw_autoscale_max` (default 3), `wildcard_certificate_name` (`*.devsbx.xyz`), and API/exporter staging branch subdomain vars (FR-018, D2/D3/D6).
- [ ] T002 [P] Provision and confirm the shared wildcard `*.devsbx.xyz` ACME automation (KeyVault-Acmebot pattern, deployed once in the shared scope) and **gate** that the issued cert is present in the existing Key Vault as a hard prerequisite **before** the first gateway apply (T013/T014); record the provisioning steps + sequencing in [specs/168-internal-appgw-waf-edge/quickstart.md](specs/168-internal-appgw-waf-edge/quickstart.md) Prerequisites (FR-012, research D6 sequencing risk).
- [ ] T003 Capture a clean baseline: run `cd infra && terraform fmt -check && terraform validate` and record current `api_fqdn`/`exporter_fqdn` output values for blue-green rollback reference (D8).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared edge scaffolding that the gateway stories (US2–US4) all depend on and that has no dependency on the internal-env flip — staged first.

**⚠️ CRITICAL**: The App Gateway in US2–US4 cannot be applied until the dedicated subnet, managed identity, and Key Vault grant exist.

- [x] T004 Add a dedicated `/24` App Gateway subnet `azurerm_subnet.appgw` (no delegation, App Gateway-only, `default_outbound_access_enabled = false` to satisfy the SFI subnet constraint) in [infra/network.tf](infra/network.tf) (E5, research D3, constitution §Security SFI).
- [x] T005 Add a **dedicated** least-privilege user-assigned managed identity `azurerm_user_assigned_identity.appgw` for the gateway (not the shared `main` identity — ZT least-privilege) and grant it only `certificates/get` + `secrets/get` on the existing Key Vault in [infra/keyvault.tf](infra/keyvault.tf) (E7, Q2 — no secret material in state).
- [x] T006 Run `cd infra && terraform validate` to confirm the foundational subnet + identity + KV-grant additions parse cleanly.

**Checkpoint**: Edge scaffolding ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Ephemeral staging/branch environments can be created again (Priority: P1) 🎯 MVP

**Goal**: Flip the Container Apps environment to internal so a brand-new environment provisions with no `SubscriptionNotRegisteredForFeature` (BYOPIP) error and the apps resolve privately.

**Independent Test**: On a BYOPIP-unregistered subscription, `terraform plan`/`apply` a fresh environment — provisioning completes with zero BYOPIP-class errors and `az feature show ... AllowBringYourOwnPublicIpAddress` stays `NotRegistered` (SC-001, SC-007).

### Implementation for User Story 1

- [x] T007 [US1] Set `internal_load_balancer_enabled = true` on `azurerm_container_app_environment.main` in [infra/container-apps.tf](infra/container-apps.tf) (E1, ForceNew, FR-001/002/003).
- [x] T008 [US1] Set `ingress.external_enabled = false` on `azurerm_container_app.api` and `azurerm_container_app.exporter` in [infra/container-apps.tf](infra/container-apps.tf) (E2, FR-006).
- [x] T009 [US1] Add the private DNS zone for the env `default_domain` + VNet link + wildcard `*` A record → env `static_ip_address` in [infra/network.tf](infra/network.tf), with `depends_on` the internal env (computed attrs) (E4, FR-007, research D4).
- [x] T010 [US1] Grep `infra/` to confirm zero `AllowBringYourOwnPublicIpAddress` / BYOPIP feature references remain anywhere (FR-003).
- [ ] T011 [US1] Run `cd infra && terraform fmt -check && terraform validate && terraform plan`; confirm no `SubscriptionNotRegisteredForFeature` and the env shows an internal LB (SC-001, quickstart US1 check).

**Checkpoint**: A fresh environment provisions internally with no BYOPIP gate. MVP delivered.

---

## Phase 4: User Story 2 - No compute resource is directly exposed to the public internet (Priority: P1)

**Goal**: Stand up the single App Gateway public edge so exactly one Azure-managed public IP exists (the edge) and all compute is private (ZT).

**Independent Test**: Enumerate environment resources — exactly one public IP (the gateway), env `internal = true`, API/exporter `ingress.external = false` (SC-002).

### Tests for User Story 2 ⚠️

> Write FIRST and confirm RED before implementing the assertion helpers (FR-017).

- [x] T012 [P] [US2] Add red-phase cases (following the constitution's `# Arrange / # Act / # Assert` structure) for `assert_single_public_ip` and `assert_env_internal` (parsing `az` JSON via `stub-az`) in [infra/tests/test-az-json.sh](infra/tests/test-az-json.sh); confirm they FAIL before the helpers exist.

### Implementation for User Story 2

- [x] T013 [US2] Create `infra/application-gateway.tf` (NEW): `azurerm_public_ip.appgw` (Standard/Static/Azure-managed — the only public IP, FR-004) + `azurerm_application_gateway.main` shell (SKU `WAF_v2`, `autoscale_configuration` referencing the T001 vars, `identity { type = "UserAssigned" }` → T005 identity) (E3, research D2).
- [x] T014 [US2] In `infra/application-gateway.tf`: add API + exporter backend pools (app FQDNs `<env>-api.<default_domain>` / `<env>-exporter.<default_domain>`, resolved via the T009 private DNS), HTTPS backend settings (Host/SNI = app FQDN), HTTPS:443 listeners using the KV-referenced wildcard cert (T005 identity), host-based routing rules, and an optional HTTP:80→443 redirect (FR-008, research D5).
- [x] T015 [US2] Implement `assert_single_public_ip` + `assert_env_internal` in [infra/validate-deployment.sh](infra/validate-deployment.sh) to make T012 GREEN.
- [x] T016 [US2] Run `terraform validate`; verify (quickstart US2 check) exactly one public IP (the gateway), env internal, apps `external=false`, and PostgreSQL still private (SC-002, FR-016).

**Checkpoint**: Public edge live; compute is private with a single Azure-managed public IP.

---

## Phase 5: User Story 3 - The public edge enforces a managed OWASP WAF ruleset (Priority: P1)

**Goal**: Attach a vendor-managed OWASP ruleset in Prevention mode to the edge (SFI).

**Independent Test**: Inspect the edge WAF policy — managed OWASP ruleset attached, enabled, mode `Prevention` (SC-003).

### Tests for User Story 3 ⚠️

- [x] T017 [P] [US3] Add a red-phase case (following the `# Arrange / # Act / # Assert` structure) for `assert_waf_prevention_owasp` (parsing WAF-policy `az` JSON via `stub-az`) in [infra/tests/test-az-json.sh](infra/tests/test-az-json.sh); confirm it FAILS first.

### Implementation for User Story 3

- [x] T018 [US3] Add `azurerm_web_application_firewall_policy.main` (managed OWASP ruleset e.g. 3.2, `policy_settings { mode = "Prevention", enabled = true }`, documented `exclusion` list) and associate it via `firewall_policy_id` on the gateway in [infra/application-gateway.tf](infra/application-gateway.tf) (E8, FR-005, research D7).
- [x] T019 [US3] Route App Gateway access + firewall diagnostic logs to the per-env Log Analytics / Application Insights so WAF block events are queryable for exclusion tuning (FR-019, SC-010, research D10).
- [x] T020 [US3] Implement `assert_waf_prevention_owasp` in [infra/validate-deployment.sh](infra/validate-deployment.sh) to make T017 GREEN.
- [x] T021 [US3] Run `terraform validate`; verify the WAF policy is attached, enabled, and in Prevention mode (quickstart US3 check, SC-003).

**Checkpoint**: Managed OWASP WAF enforced in Prevention mode at the edge.

---

## Phase 6: User Story 4 - Public health smoke tests still pass through the new edge (Priority: P1)

**Goal**: Repoint the public outputs and custom-domain DNS to the edge and align backend health probes so the existing CD smoke commands pass unchanged.

**Independent Test**: `terraform output -raw api_fqdn` resolves to the gateway; the byte-identical `curl -fsS https://${API_FQDN}/api/v1/health` (and exporter health) succeed through the edge (SC-004, FR-010).

### Tests for User Story 4 ⚠️

- [x] T022 [P] [US4] Add a red-phase case (following the `# Arrange / # Act / # Assert` structure) for `assert_edge_health` (probe/health JSON via `stub-az`) and an assertion that `api_fqdn` resolves to the gateway hostname in [infra/tests/test-az-json.sh](infra/tests/test-az-json.sh); confirm RED first.

### Implementation for User Story 4

- [x] T023 [US4] Repoint `output "api_fqdn"` and `output "exporter_fqdn"` to the App Gateway public hostname (the API/exporter custom-domain FQDN) in [infra/outputs.tf](infra/outputs.tf) (E9, FR-009).
- [x] T024 [US4] Repoint the custom-domain CNAMEs (api/exporter) to the gateway public address and remove the now-unreachable `azurerm_container_app_custom_domain.api`, `terraform_data.api_cert_bind`, and related `time_sleep`s in [infra/dns.tf](infra/dns.tf) (E10, FR-012, research D9).
- [x] T025 [US4] Add/align health probes in [infra/application-gateway.tf](infra/application-gateway.tf) — API probe `GET /api/v1/health`, exporter probe `GET /health` (the exporter's actual health path, `http_handler.py`), probe host = app FQDN (FR-008, matches the CD smoke paths).
- [x] T026 [US4] Implement `assert_edge_health` in [infra/validate-deployment.sh](infra/validate-deployment.sh) (T022 GREEN) and confirm the existing CD `curl` smoke commands remain byte-for-byte unchanged (FR-010).
- [ ] T027 [US4] Run `terraform validate`; run the CD public health smoke tests (API + exporter) and confirm both pass through the gateway (quickstart US4 check, SC-004).

**Checkpoint**: All four P1 stories independently verifiable; the edge serves validated public traffic.

---

## Phase 7: User Story 5 - Production and staging are architecturally identical (Priority: P2)

**Goal**: Give staging branch environments the same internal-env + edge + private-DNS topology (including wildcard-covered subdomains) so a green staging validation is meaningful for prod.

**Independent Test**: Diff staging vs production topology — both show internal Container Apps env + WAF edge + private DNS for the env domain; no internal-only staging variant adopted (SC-005).

### Implementation for User Story 5

- [ ] T028 [US5] Assign API/exporter subdomains — including ephemeral branch subdomains under `*.devsbx.xyz` — in [infra/custom-domains-staging.tfvars](infra/custom-domains-staging.tfvars) and confirm parity in [infra/custom-domains-production.tfvars](infra/custom-domains-production.tfvars) (FR-011, research D9).
- [ ] T029 [US5] Confirm the staging plan applies the identical internal-env + edge + private-DNS shape (explicitly NOT a cheaper internal-only variant); note the parity decision in [specs/168-internal-appgw-waf-edge/quickstart.md](specs/168-internal-appgw-waf-edge/quickstart.md).
- [ ] T030 [US5] Run a staging-vs-prod topology diff check and confirm identical network/edge shapes (quickstart, SC-005).

**Checkpoint**: Staging genuinely mirrors production.

---

## Phase 8: User Story 6 - Cost stays predictable and ephemeral for staging (Priority: P3)

**Goal**: Pin the edge to a minimal autoscale floor and confirm ephemeral teardown removes it so staging cost is bounded to the cycle.

**Independent Test**: Prod carries the edge continuously; a staging create/validate/teardown cycle leaves zero residual edge/env resources (SC-006).

### Implementation for User Story 6

- [x] T031 [US6] Set `autoscale_configuration { min_capacity = var.appgw_autoscale_min /*1*/, max_capacity = var.appgw_autoscale_max }` on the gateway in [infra/application-gateway.tf](infra/application-gateway.tf) (FR-018, ~$340/mo prod floor).
- [ ] T032 [US6] Run an ephemeral staging cycle and `gh workflow run cd.yml -f environment=staging -f branch=<branch> -f destroy=true`; verify zero residual edge/env resources after teardown (FR-014, SC-006, quickstart teardown check).

**Checkpoint**: Edge cost is minimal in prod and fully ephemeral in staging.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: CD verification, production blue-green cutover, and the final DoD gate.

- [ ] T033 [P] Verify [.github/workflows/cd.yml](.github/workflows/cd.yml): the `api_fqdn`/`exporter_fqdn` outputs now resolve to the gateway and the smoke commands are unchanged (FR-010).
- [ ] T034 Finalize the production blue-green cutover runbook (additive provision → validate → CNAME cutover → confirm → decommission → rollback) in [specs/168-internal-appgw-waf-edge/quickstart.md](specs/168-internal-appgw-waf-edge/quickstart.md) (FR-015, research D8).
- [ ] T035 Execute the production blue-green cutover after staging is green: stand up new internal env + edge additively, validate, repoint custom-domain CNAMEs, confirm dashboard load + OAuth login (FR-013, SC-008), then decommission the old external env — PostgreSQL untouched (FR-016).
- [x] T036 [P] Run `shellcheck infra/*.sh infra/tests/*` and `bash -n infra/validate-deployment.sh`; confirm 100% coverage on the new `validate-deployment.sh` assertion helpers (FR-017, SC-009).
- [ ] T037 Run the full [specs/168-internal-appgw-waf-edge/quickstart.md](specs/168-internal-appgw-waf-edge/quickstart.md) Definition-of-Done checklist and confirm `terraform validate` clean (SC-009).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Provides the subnet/identity/KV-grant that the gateway stories (US2–US4) require.
- **US1 (Phase 3)**: Depends on Setup only (the internal-env flip). Its private DNS (T009) needs the internal env's computed `default_domain`/`static_ip_address`. **MVP.**
- **US2 (Phase 4)**: Depends on Foundational (subnet/identity) **and** US1 (private DNS + internal env, for backend resolution).
- **US3 (Phase 5)**: Depends on US2 (the gateway must exist to attach the WAF policy).
- **US4 (Phase 6)**: Depends on US2 (gateway + listeners/backends) for the outputs/probes/DNS repoint.
- **US5 (Phase 7)**: Depends on US1–US4 (the full edge pattern must exist to replicate for staging).
- **US6 (Phase 8)**: Depends on US2 (the gateway resource to set autoscale on).
- **Polish (Phase 9)**: Depends on all desired user stories. The prod cutover (T035) runs only after staging proves green.

### Critical Path

`Setup → Foundational → US1 (internal env + private DNS) → US2 (gateway) → US3 (WAF) ∥ US4 (outputs/probes) → US5 (staging parity) → US6 (cost) → Polish (prod cutover + DoD)`

### Within Each Story

- Changed Bash logic: write the `test-az-json.sh` case (RED) before the `validate-deployment.sh` helper (GREEN).
- Terraform resource definitions before their `terraform validate`/check task.
- `application-gateway.tf` shell (T013) before its routing (T014), WAF (T018), probes (T025), and autoscale (T031) additions.

### Parallel Opportunities

- Setup: T001 and T002 are `[P]` (different files).
- Red-phase test tasks T012, T017, T022 are `[P]` (independent `stub-az` fixtures) — but each precedes its own story's GREEN helper.
- Polish: T033 and T036 are `[P]`.
- US3 and US4 implementation can largely proceed in parallel once US2 lands (different files: WAF policy/diagnostics vs outputs.tf/dns.tf), serializing only on shared edits to `application-gateway.tf` (T018 WAF vs T025 probes).

---

## Implementation Strategy

### MVP First (US1 only)

Deliver **US1** (Phase 1 → 2 → 3): the internal-env flip + private DNS. This alone restores the blocked capability — fresh environments provision with no BYOPIP error (SC-001/SC-007) — and is independently verifiable, even before the public edge exists.

### Incremental Delivery

1. **US1** → environments can be created again (MVP).
2. **US2** → single Azure-managed public IP at the edge; compute private (ZT).
3. **US3** → managed OWASP WAF in Prevention (SFI).
4. **US4** → CD smoke tests pass through the edge (the automated gate).
5. **US5** → staging mirrors prod (test-like-prod confidence).
6. **US6** → minimal autoscale floor + ephemeral teardown (cost).
7. **Polish** → prod blue-green cutover + full DoD.

Each increment is shippable and independently testable per the quickstart per-story checks.
