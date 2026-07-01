# Feature Specification: Internal Container Apps environments behind Application Gateway WAF_v2 (every environment, no bring-your-own public IP)

**Feature Branch**: `168-internal-appgw-waf-edge`  
**Feature Issue**: #173  
**User Stories**: #174, #175, #176, #177, #178, #179  
**Created**: 2026-06-21  
**Status**: Draft  
**Input**: User description: "Internal Container Apps environments behind App Gateway WAF_v2 in every environment with no bring-your-own public IP"

## Overview

The platform's public edge currently sits directly on the Azure Container Apps environment, which is configured as **external** (public ingress) while also VNet-integrated through a custom infrastructure subnet. For that shape, Azure provisions the inbound public IP through a path that is now gated behind a subscription feature in the bring-your-own-public-IP (BYOPIP) family. Since mid-June 2026, creating a **new** environment fails with `SubscriptionNotRegisteredForFeature` for that feature, blocking ephemeral staging/branch deploys. Production is unaffected only because continuous deployment re-applies against the existing (grandfathered) environment and never recreates it.

The repository owner has rejected enabling any BYO-public-IP feature on Zero Trust (ZT) and Secure Future Initiative (SFI) grounds, while requiring the site to remain reachable from the public internet (it is a user-facing dashboard, API, and OAuth callback). This feature changes the architecture so that **every** environment — production and every ephemeral staging/branch environment — is identical: the Container Apps environment becomes **internal** (no public IP on compute), and a single managed public edge enforcing a managed OWASP web-application-firewall ruleset fronts it. This permanently removes the BYOPIP feature requirement, satisfies ZT (no compute is directly internet-exposed) and SFI (managed WAF at the edge), and preserves public availability.

## Clarifications

### Session 2026-06-21

- Q: How should production cut over to the internal env, given the internal/external property is fixed at environment creation? → A: Blue-green parallel cutover — stand up the new internal env + App Gateway in parallel, validate, repoint custom-domain DNS to the new edge, then delete the old external env (near-zero downtime, reversible, PostgreSQL untouched).
- Q: How should the App Gateway edge's TLS certificate be sourced, given free Azure-managed certs are unavailable for App Gateway? → A: Key Vault-referenced certificate auto-issued/renewed via ACME (Let's Encrypt) into the existing private Key Vault; App Gateway reads it through a user-assigned managed identity (free, auto-renew, ZT-clean).
- Q: Should the managed OWASP WAF ruleset run in Detection (log only) or Prevention (actively blocks) mode? → A: Prevention mode in every environment (identical config for parity); false positives handled via targeted rule exclusions rather than weakening the mode.
- Q: What App Gateway WAF_v2 autoscale capacity floor should be used, given "cost optimal" and low-volume dashboard traffic? → A: Minimal floor — autoscale min = 1 capacity unit with a small max (e.g., 2–3) for burst headroom; keeps production near the ~$340/mo estimate and ephemeral staging at cents/hour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ephemeral staging/branch environments can be created again (Priority: P1)

A maintainer pushes a branch (or triggers the staging deploy workflow). The continuous-deployment pipeline provisions a brand-new, short-lived environment from scratch, runs validation, and tears it down. Today this fails during provisioning because the new environment's public IP requires the BYOPIP subscription feature. After this change, the new environment is created with no public IP on the compute layer, so the BYOPIP gate is never reached and provisioning succeeds.

**Why this priority**: This is the regression that is actively blocking work. Without it, no new environment can be stood up, which breaks the entire deploy/validate/teardown discipline the project relies on.

**Independent Test**: Trigger a fresh staging/branch deploy on a subscription where the BYOPIP feature is NOT registered. The environment provisions successfully end to end and the public health smoke tests pass, with no `SubscriptionNotRegisteredForFeature` error at any step.

**Acceptance Scenarios**:

1. **Given** a subscription with the BYOPIP feature unregistered, **When** a new staging/branch environment is provisioned from scratch, **Then** provisioning completes without any BYOPIP-class feature error.
2. **Given** a freshly provisioned environment, **When** the public health checks for the API and exporter run, **Then** they return success over the public edge.
3. **Given** the staging deploy completes, **When** teardown runs, **Then** the entire ephemeral environment (including its public edge) is removed and incurs no ongoing cost.

---

### User Story 2 - No compute resource is directly exposed to the public internet (Priority: P1)

A security reviewer audits the environment to confirm Zero Trust posture. Every compute workload (API, exporter, and the Container Apps environment itself) must be private, with the only public ingress being the managed WAF edge.

**Why this priority**: Zero Trust is a hard, non-negotiable requirement and the primary security motivation for the change. It is co-equal with restoring environment creation.

**Independent Test**: Inspect any provisioned environment and confirm the Container Apps environment has no public inbound IP and that the only resource with a public IP is the managed WAF edge.

**Acceptance Scenarios**:

1. **Given** a provisioned environment, **When** the Container Apps environment's network exposure is inspected, **Then** it has no public inbound IP and is reachable only from within the virtual network.
2. **Given** a provisioned environment, **When** all resources are enumerated, **Then** exactly one resource (the WAF edge) holds a public IP, and that IP is Azure-managed rather than bring-your-own.
3. **Given** the API and exporter applications, **When** their network reachability is inspected, **Then** they are reachable only through the internal environment / the WAF edge and never directly from the public internet.

---

### User Story 3 - The public edge enforces a managed OWASP WAF ruleset (Priority: P1)

A security reviewer confirms the Secure Future Initiative bar: the single public entry point must apply a vendor-managed OWASP web-application-firewall ruleset, not merely hand-written custom rules.

**Why this priority**: SFI compliance is the second hard security requirement and the reason a plain load balancer or custom-rule-only edge is insufficient.

**Independent Test**: Inspect the public edge's WAF policy and confirm a managed OWASP ruleset is attached and active.

**Acceptance Scenarios**:

1. **Given** the public edge, **When** its WAF configuration is inspected, **Then** a managed OWASP ruleset is attached and enabled.
2. **Given** a request that matches a known OWASP attack signature, **When** it reaches the edge, **Then** the WAF inspects and acts on it according to the managed ruleset.
3. **Given** the edge's public IP, **When** its provenance is inspected, **Then** it is Azure-managed and does not depend on the BYOPIP feature.

---

### User Story 4 - Public health smoke tests still pass through the new edge (Priority: P1)

The continuous-deployment pipeline runs public smoke tests from a hosted runner that curls the API health endpoint and the exporter health endpoint over the public internet. After the edge changes, the public address those tests target must resolve to the WAF edge and the checks must continue to pass without modifying the runner logic beyond where the public address is sourced.

**Why this priority**: These smoke tests are the automated gate that proves an environment is actually serving traffic. If they cannot reach the new edge, deploys cannot be validated.

**Independent Test**: Run the existing post-deploy validation against an environment built with the new edge; the health checks succeed against the public WAF address.

**Acceptance Scenarios**:

1. **Given** a deployed environment, **When** the validation job resolves the public API address, **Then** that address is the WAF edge's public address (not the Container Apps default address).
2. **Given** the public API and exporter health endpoints, **When** the validation job curls them over the public internet, **Then** both return a successful health response through the WAF edge.
3. **Given** the change to where the public address is sourced, **When** the validation job runs, **Then** no other runner logic change is required for the checks to pass.

---

### User Story 5 - Production and staging are architecturally identical (Priority: P2)

A maintainer wants confidence that staging genuinely tests what production does ("test like prod"). Both environments must use the same internal-environment + WAF-edge topology so that a successful staging validation is meaningful for production.

**Why this priority**: Parity is a deliberate design choice that improves confidence, but it follows from correctly implementing the P1 stories rather than being a separate user-visible capability.

**Independent Test**: Compare the resource topology of a staging environment and production; the network/edge shape (internal environment, WAF edge, private DNS for the environment domain) matches.

**Acceptance Scenarios**:

1. **Given** a staging environment and production, **When** their network topologies are compared, **Then** both use an internal Container Apps environment fronted by a WAF edge.
2. **Given** the chosen parity model, **When** a cheaper internal-only staging variant is considered, **Then** it is explicitly NOT adopted in favor of full parity.

---

### User Story 6 - Cost stays predictable and ephemeral for staging (Priority: P3)

The repository owner wants the public edge to be cost-optimal: production runs it continuously, while staging environments only incur edge cost for the brief duration of a deploy/validate/teardown cycle.

**Why this priority**: Cost is a meaningful constraint that shaped the edge technology choice, but it is a property of the operating model rather than a blocking capability.

**Independent Test**: Confirm production carries the edge continuously and that a staging cycle creates and then removes the edge, so staging edge cost is bounded to the cycle duration.

**Acceptance Scenarios**:

1. **Given** production, **When** its public edge is inspected over time, **Then** the edge runs continuously.
2. **Given** a staging deploy/validate/teardown cycle, **When** the cycle completes, **Then** the edge created for it is destroyed and stops accruing cost.

---

### Edge Cases

- **Internal environment FQDN resolution**: The WAF edge backend (and the self-hosted VNet runner) must resolve the internal Container Apps environment's default domain. Because an internal environment uses a private domain, a private DNS zone for that domain must be linked to the virtual network; without it, the backend health probe and runner cannot resolve the origin.
- **Backend health probe vs. application health endpoint**: The edge must consider the internal origin healthy before serving traffic. The probe path/host must match what the API and exporter actually expose, or the edge will report the backend unhealthy and return errors despite healthy compute.
- **Custom domains**: Custom domains for the API and exporter currently bind to the Container App / its default FQDN. With an internal environment behind a WAF edge, those public custom domains must repoint to the WAF edge instead, and TLS for those domains must terminate at the edge.
- **Existing production environment migration**: Production currently runs an external environment whose internal/external property is fixed at creation and cannot be flipped in place. The spec must account for how production transitions to the internal + edge topology without an unplanned outage or data loss, even though day-to-day CD avoids recreating it.
- **OAuth callback continuity**: The API participates in an OAuth flow; the public address used for the callback must remain valid after the edge changes so authentication continues to work.
- **Dashboard hosting unaffected**: The dashboard is served by a separate hosting service with its own edge and must continue to function unchanged; only the API/exporter public edge changes.
- **WAF false positives**: The managed OWASP ruleset may flag legitimate dashboard/API traffic. The design must allow the ruleset to operate without breaking normal application use (e.g., appropriate mode/tuning) while still satisfying the "managed ruleset enforced" requirement.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every environment's Container Apps environment MUST be internal (no public inbound IP on the compute layer) so that the bring-your-own-public-IP feature gate is never reached during creation.
- **FR-002**: New environment creation MUST succeed on a subscription where the BYOPIP feature is unregistered, with no `SubscriptionNotRegisteredForFeature` error in any provisioning step.
- **FR-003**: The system MUST NOT require, request, or register the `Microsoft.Network/AllowBringYourOwnPublicIpAddress` feature (or any other bring-your-own-public-IP feature) in any environment.
- **FR-004**: Each environment MUST provide a single public edge that fronts the internal environment and is the only resource holding a public IP, and that public IP MUST be Azure-managed (not bring-your-own).
- **FR-005**: The public edge MUST enforce a vendor-managed OWASP web-application-firewall ruleset that is attached and enabled in **Prevention** mode (actively blocking matched requests, not log-only) in every environment, not solely custom rules; legitimate-traffic false positives MUST be handled via targeted rule exclusions rather than by weakening the mode.
- **FR-006**: No compute resource (the API application, the exporter application, or the Container Apps environment) MUST be directly reachable from the public internet; all public ingress MUST traverse the WAF edge.
- **FR-007**: The system MUST provide private DNS resolution for the internal Container Apps environment's default domain within the virtual network so the WAF edge backend and the self-hosted runner can resolve the internal origin.
- **FR-008**: The public edge MUST route public requests to the internal API and exporter origins over a private path, including a backend health probe that reflects each origin's actual health endpoint.
- **FR-009**: The public address consumed by the post-deploy validation smoke tests MUST resolve to the WAF edge's public address, and the API and exporter public health checks MUST continue to pass through the edge.
- **FR-010**: The validation runner MUST continue to work without logic changes beyond where the public address is sourced (i.e., the smoke-test commands themselves remain unchanged).
- **FR-011**: Production and every staging/branch environment MUST share the same network/edge topology (internal environment + WAF edge + private DNS for the environment domain).
- **FR-012**: Custom domains for the public API and exporter MUST repoint to the WAF edge, with public TLS terminating at the edge using a certificate referenced from the existing private Key Vault (consumed by the App Gateway via a user-assigned managed identity) and auto-issued/renewed via ACME (Let's Encrypt), while preserving existing public hostnames where configured.
- **FR-013**: The OAuth callback and dashboard cross-origin configuration MUST remain valid after the edge change so authentication and the dashboard continue to function.
- **FR-014**: Staging/branch environments MUST remain ephemeral: the edge and all environment resources created for a cycle MUST be fully removed on teardown so they stop accruing cost.
- **FR-015**: Production MUST transition to the internal + edge topology via a blue-green parallel cutover — provisioning the new internal environment and App Gateway edge alongside the existing external environment, validating the new stack, repointing custom-domain DNS to the new edge, and only then decommissioning the old external environment — so that there is near-zero downtime, the cutover is reversible, and the private PostgreSQL data is never touched.
- **FR-016**: PostgreSQL MUST remain private (no public network access), and the dashboard's separate hosting/edge MUST remain unchanged by this feature.
- **FR-017**: The infrastructure definition MUST validate cleanly and the change MUST be delivered following the project's test-first discipline and 100% coverage policy where applicable to the changed scope.
- **FR-018**: The App Gateway WAF_v2 edge MUST use a minimal autoscale capacity floor (minimum 1 capacity unit) with a small maximum (3 capacity units) for burst headroom, so production stays near the ~$340/month estimate and ephemeral staging edge cost stays at cents-per-hour, consistent with the cost-optimality constraint.
- **FR-019**: The public edge MUST emit its access and WAF (firewall) diagnostic logs to the environment's per-environment Application Insights / Log Analytics workspace (issue #115 telemetry isolation), so that WAF block and match events are queryable for verifying enforcement (SC-003) and tuning the Prevention-mode exclusions (FR-005). This observability requirement applies identically in every environment (parity, FR-011).

### Key Entities *(include if feature involves data)*

- **Container Apps environment (internal)**: The private compute platform hosting the API and exporter. Key attribute: internal-only network exposure (no public IP). Reached only from within the virtual network or via the WAF edge.
- **WAF public edge**: The single public entry point for the API and exporter. Key attributes: Azure-managed public IP, attached managed OWASP WAF ruleset, private backend pointing at the internal environment origin, listeners/routing for the API and exporter, public TLS termination for custom domains.
- **Private DNS zone (environment domain)**: Resolves the internal Container Apps environment's default domain inside the virtual network. Linked to the VNet so the edge backend and the runner can resolve the internal origin.
- **App Gateway subnet**: A dedicated subnet within the existing virtual network reserved for the WAF edge.
- **Public FQDN/address output**: The published public address for the API (and exporter) that the validation smoke tests and custom-domain bindings consume; now sourced from the WAF edge rather than the Container Apps default FQDN.
- **Ephemeral staging environment**: A short-lived full replica of production (including its own WAF edge) created for a deploy/validate cycle and destroyed afterward.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Provisioning a brand-new environment on a subscription without the BYOPIP feature registered succeeds 100% of the time with zero `SubscriptionNotRegisteredForFeature` errors.
- **SC-002**: In every provisioned environment, exactly one resource holds a public IP (the WAF edge), and zero compute resources are directly reachable from the public internet.
- **SC-003**: The public edge in every environment has a managed OWASP WAF ruleset attached and enabled, verifiable by inspection.
- **SC-004**: The post-deploy public health smoke tests for the API and exporter pass through the WAF edge in both staging and production.
- **SC-005**: A side-by-side comparison of staging and production network topology shows identical internal-environment + WAF-edge + private-DNS shapes.
- **SC-006**: A staging deploy/validate/teardown cycle leaves no residual edge or environment resources after teardown (zero ongoing cost from the cycle).
- **SC-007**: The bring-your-own-public-IP feature remains unregistered on the subscription and is never required by any apply.
- **SC-008**: The dashboard, OAuth login, and existing public hostnames continue to work after the change (no user-visible loss of access).
- **SC-009**: The infrastructure definition validates cleanly and the change ships within the project's test-first, full-coverage policy.
- **SC-010**: App Gateway access and WAF firewall logs are queryable in the per-environment Application Insights / Log Analytics workspace (a WAF block event appears in a log query within normal ingestion lag), in both staging and production.

## Assumptions

- The chosen public-edge technology is Azure Application Gateway WAF_v2, selected as the cheapest option meeting the managed-OWASP-WAF bar (verified live retail pricing: ~$340/month all-in for production — fixed instance + capacity units + static IP — versus ~$412.50/month for the next alternative). Staging edge cost is bounded to roughly $0.46/hour, i.e., under ~$2 per ephemeral cycle.
- Architectural parity ("test like prod") is intentionally preferred over a cheaper internal-only staging variant; the modest per-cycle staging edge cost is acceptable.
- The existing teardown discipline (workflow-driven destroy for ephemeral environments) remains the mechanism that bounds staging cost.
- The public address consumed by smoke tests is sourced from an infrastructure output (the API public FQDN output); repointing that output to the WAF edge is the expected mechanism for FR-009/FR-010, and no smoke-test command change is anticipated.
- PostgreSQL privacy and the dashboard's separate hosting edge are explicitly unchanged.
- The Key Vault firewall validation fix is out of scope (tracked separately) and must not be entangled with this work.
- This feature branch is based off `main`; unrelated in-flight Key Vault fixes are excluded.

## Out of Scope

- The Key Vault firewall validation fix (separate work / separate pull request).
- Any change to the Static Web App dashboard hosting (it has its own edge).
- Any change to PostgreSQL network privacy (private access stays as-is).
- Enabling or registering any bring-your-own-public-IP subscription feature.
