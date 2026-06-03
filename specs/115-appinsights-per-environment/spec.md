# Feature Specification: Separate Application Insights per Environment

**Feature Branch**: `115-appinsights-per-environment`  
**Created**: 2026-06-01  
**Status**: Draft  
**Input**: User description: "Separate Application Insights per environment (staging vs production) so staging telemetry never pollutes production monitoring, and a staging-destroy fully removes the staging Application Insights resource." (GitHub issue #115)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Production monitoring is free of staging noise (Priority: P1)

As the operator monitoring production, when I open the production Application Map, the failures view, and request/exception traces, I see only production components and production telemetry. Staging activity never appears in my production monitoring views, so I can trust that every error, slow request, or dependency failure I see is a real production signal.

**Why this priority**: Cross-environment telemetry pollution directly undermines the trustworthiness of production monitoring. A staging exception that looks like a production incident wastes operator time and erodes confidence in the monitoring stack. Isolating production telemetry is the core value of this feature and delivers a usable improvement on its own.

**Independent Test**: Deploy a staging environment, generate traffic and a deliberate error in staging, then inspect the production Application Insights views. The story passes if no staging-originated component, request, or exception is present in production telemetry.

**Acceptance Scenarios**:

1. **Given** both a staging and a production environment are deployed, **When** staging serves requests and emits exceptions, **Then** the production Application Map shows only production components and no staging telemetry.
2. **Given** an operator is reviewing production failures and traces, **When** staging is actively generating load, **Then** none of that staging activity is visible in any production Application Insights view.

---

### User Story 2 - Staging telemetry is captured in its own isolated resource (Priority: P2)

As a developer validating a change in staging, I want staging telemetry to flow to a dedicated, environment-specific Application Insights resource so I can debug staging behavior in isolation without my data being mixed into production and without depending on production resources.

**Why this priority**: Isolation must be bidirectional to be reliable — staging needs a real, separate destination for its telemetry, not merely "telemetry turned off." Having a dedicated staging resource gives developers a usable debugging surface and proves the isolation is structural rather than incidental.

**Independent Test**: Deploy a staging environment, exercise the dashboard and API, and confirm staging telemetry lands in an Application Insights resource that is distinct from the production one (separate resource, separate connection string).

**Acceptance Scenarios**:

1. **Given** a staging environment is deployed, **When** the staging dashboard and API generate telemetry, **Then** that telemetry is recorded in an Application Insights resource that is separate from production's.
2. **Given** staging and production are both running, **When** their telemetry destinations are compared, **Then** they resolve to two distinct resources with two distinct connection strings.

---

### User Story 3 - Tearing down staging removes its Application Insights resource (Priority: P2)

As the operator destroying a staging environment, I want the staging Application Insights resource (and any monitoring resource created solely for that environment) to be removed as part of the teardown, so no orphaned monitoring resources remain and no ongoing cost or data accumulates after staging is gone.

**Why this priority**: Per repository practice, staging environments are ephemeral and must leave no residue. An orphaned Application Insights resource is both a cost leak and a clutter/compliance problem. Clean teardown is essential to the lifecycle, though it follows the isolation guarantees in priority.

**Independent Test**: Deploy a staging environment, then run the standard staging-destroy path and confirm the staging Application Insights resource no longer exists and production's Application Insights resource is untouched.

**Acceptance Scenarios**:

1. **Given** a staging environment with its own Application Insights resource, **When** the staging environment is destroyed via the standard teardown, **Then** the staging Application Insights resource is deleted and no orphaned monitoring resource remains for that environment.
2. **Given** staging is being destroyed, **When** teardown completes, **Then** the production Application Insights resource and all production telemetry are unaffected.

---

### Edge Cases

- What happens when two staging environments exist at the same time (e.g., two feature branches)? Each must resolve to its own Application Insights resource so their telemetry does not commingle with each other or with production.
- What happens if the staging dashboard cannot obtain a per-environment connection string at build/deploy time? Staging must fail safe — it must not fall back to emitting telemetry into the production resource; it targets its own environment-scoped resource.
- What happens to historical production telemetry collected before this change, while staging and production were sharing one resource? The change is not required to retroactively purge previously commingled data; the guarantee applies going forward from deployment.
- What happens during the deployment that introduces this change? Switching production to its isolated resource must not silently route production telemetry to a non-existent or staging resource at any point.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each environment (production and every staging environment) MUST send its telemetry to an Application Insights resource that is unique to that environment.
- **FR-002**: Production monitoring views (Application Map, failures, request and exception traces) MUST NOT contain telemetry originating from any staging environment.
- **FR-003**: Staging telemetry MUST be directed to a dedicated staging Application Insights resource that is separate from production's, and MUST never be written to the production resource. Staging telemetry MUST remain enabled (parity with production); disabling staging telemetry is NOT an acceptable outcome, because it would make staging architecturally diverge from production in violation of the Environment Parity principle.
- **FR-004**: The dashboard, API, and any other telemetry-emitting component MUST resolve their telemetry destination from the environment they belong to, so a component deployed to staging cannot emit into production's resource.
- **FR-005**: Destroying a staging environment MUST remove that environment's Application Insights resource (and any monitoring resource provisioned solely for that environment), leaving no orphaned resources and no residual cost.
- **FR-006**: Tearing down a staging environment MUST NOT delete, modify, or otherwise affect the production Application Insights resource or its telemetry.
- **FR-007**: The entire environment-isolation behavior MUST be defined as infrastructure-as-code and be fully reproducible from the repository alone, with no manual portal steps required.
- **FR-008**: The change MUST comply with the security/compliance (SFI) policies already enforced in the repository, including how the telemetry connection string is stored and referenced.
- **FR-009**: The feature MUST be verified end to end before being considered complete — confirming, with a real staging deployment, that the per-environment resource is actually created, that telemetry is isolated in both directions, and that the connection string each component consumes points to that component's own environment resource. The presence of an environment-name-templated resource definition MUST NOT be assumed sufficient on its own.
- **FR-010**: Multiple concurrently deployed staging environments MUST each resolve to their own Application Insights resource, with no commingling between staging environments or with production.

### Key Entities *(include if feature involves data)*

- **Application Insights resource (per environment)**: The monitoring destination that collects requests, exceptions, dependencies, and the Application Map for a single environment. There MUST be exactly one per deployed environment, named/scoped so production and each staging environment are distinct.
- **Telemetry connection string (per environment)**: The credential/identifier that points a telemetry-emitting component at its environment's Application Insights resource. It MUST be sourced and stored per environment, consistent with existing repository secret-handling practices, and consumed by the dashboard, API, and any other emitter for that same environment.
- **Environment**: A complete deployed stack (production or a staging instance). It owns its own monitoring resource, and its lifecycle (create/destroy) governs the lifecycle of that monitoring resource.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a staging environment generates traffic and errors, the production Application Map and failures/traces views show zero staging-originated telemetry.
- **SC-002**: Staging and production telemetry are demonstrably collected in two separate Application Insights resources, each reachable via its own distinct connection string.
- **SC-003**: Running the standard staging-destroy results in zero remaining Application Insights (or environment-scoped monitoring) resources for that staging environment, and zero ongoing cost attributable to it.
- **SC-004**: After staging teardown, the production Application Insights resource still exists and continues to receive production telemetry with no interruption or data loss.
- **SC-005**: The isolation and teardown behavior is reproduced solely from the repository's infrastructure-as-code with no manual portal intervention, on at least one full deploy-then-destroy cycle.
- **SC-006**: With two staging environments deployed simultaneously, each environment's telemetry appears only in its own Application Insights resource.

## Assumptions

- "Staging" refers to the ephemeral, per-branch environments produced by the existing continuous-deployment teardown-capable path; "production" refers to the long-lived primary environment.
- Each environment already deploys with a distinct environment name/prefix, which is the intended mechanism for distinguishing per-environment resources; this spec requires verifying that this distinction actually results in separate Application Insights resources end to end rather than assuming it.
- Historical telemetry collected before this change (while environments shared one resource) does not need to be retroactively separated or purged.
- Existing repository secret-management and compliance (SFI) practices for storing and referencing the telemetry connection string remain the model for the per-environment connection strings; this feature does not introduce a new secret-handling mechanism.
- Telemetry remains enabled in both staging and production (Environment Parity); the isolation guarantee is achieved by separate per-environment resources, never by disabling staging telemetry.
