<!--
  Sync Impact Report
  ==================
  Version change: 1.9.0 → 1.12.0
  Modified sections:
    - DevOps — added CI Test Coverage (NON-NEGOTIABLE) principle (1.10.0)
    - DevOps — restored Remote Terraform State principle (1.11.0)
    - DevOps — added Tool Sync (NON-NEGOTIABLE) principle (1.12.0)
  Added sections: none
  Removed sections: none
  Templates requiring updates:
    - .specify/templates/plan-template.md        ✅ no changes needed
    - .specify/templates/spec-template.md         ✅ no changes needed
    - .specify/templates/tasks-template.md        ✅ no changes needed
    - .specify/templates/checklist-template.md    ✅ no changes needed
    - .specify/templates/constitution-template.md ✅ source template (unchanged)
  Dependent specs:
    - specs/001-data-ingestor/plan.md             ✅ no changes needed
  Follow-up TODOs: none (all completed)
-->

# EP Cube Graph Constitution

## Core Principles

### I. Simplicity

- Every solution MUST prefer the most straightforward approach
  that satisfies the requirement.
- New abstractions, layers, or indirection MUST be justified by
  a concrete, present-day need — not a hypothetical future one.
- When two designs solve the same problem, the one with fewer
  moving parts MUST be chosen unless measurable evidence
  demonstrates the simpler option is insufficient.

**Rationale**: EP Cube Graph is a personal telemetry and
graphing application. Unnecessary complexity increases
maintenance burden without proportional benefit.

### II. YAGNI (You Aren't Gonna Need It)

- Features, configuration options, and extension points MUST NOT
  be built until they are explicitly required by a current user
  story or specification.
- Speculative generalization (e.g., plugin systems, multi-tenant
  support, provider abstractions) is prohibited unless a
  specification demands it.
- Code that exists without a covering requirement MUST be
  removed or justified in a plan document.

**Rationale**: Premature features create dead code, widen the
test surface, and obscure the intent of the codebase.

### III. Test-Driven Development (NON-NEGOTIABLE)

- All new functionality MUST follow the Red-Green-Refactor
  cycle: write a failing test, implement the minimum code to
  pass, then refactor.
- Tests MUST be written and confirmed to fail before any
  production code is written for that behaviour.
- Every user story MUST have at least one acceptance-level test
  that can be executed independently.
- Refactoring MUST NOT change externally observable behaviour;
  the existing test suite MUST continue to pass.
- **Code Coverage**: Unit tests and acceptance tests MUST
  achieve 100% code coverage. No production code may exist
  without a corresponding test that exercises it. Coverage
  MUST be measured and enforced in the CI gate.
- **Arrange-Act-Assert (AAA)**: All tests MUST follow the
  Arrange-Act-Assert pattern. Each test method MUST contain
  exactly three clearly separated sections marked with
  `// Arrange`, `// Act`, and `// Assert` comments. The
  Arrange section sets up preconditions and inputs. The Act
  section invokes the behaviour under test. The Assert section
  verifies the expected outcome. Sections MAY be omitted only
  when they would be genuinely empty (e.g., no arrangement
  needed for a static method with no dependencies), but the
  remaining sections MUST still be commented.

**Rationale**: TDD produces verifiable, regression-resistant
code and ensures every feature is exercised by automated tests.
Mandating 100% coverage eliminates untested paths and prevents
silent regressions.

## Development Workflow

- **Branching**: Each feature or fix MUST be developed on a
  dedicated branch named `[###-feature-name]`.
- **Commits**: Commits MUST be atomic and describe the "what"
  and "why". One logical change per commit.
- **Code Review**: All changes MUST be reviewed (self-review
  acceptable for a solo project) against this constitution's
  principles before merge.
- **CI Gate**: The full test suite MUST pass before any branch
  is merged. No test failures are permitted in the main branch.
- **Documentation**: User-facing behaviour changes MUST be
  reflected in relevant docs or specs before merge.

## Performance Standards

- **Telemetry Ingestion**: The system MUST ingest telemetry data
  from EP Cube gateway devices without data loss under normal
  operating conditions.
- **Graph Rendering**: Charts and graphs MUST render within 2
  seconds for up to 30 days of historical data on the target
  hardware.
- **Storage Efficiency**: Log storage MUST use a format that
  supports efficient time-range queries without requiring full
  dataset scans for common access patterns.
- **Responsiveness**: The application MUST remain responsive
  (UI updates within 500 ms) while background data collection
  is active.

## Platform Constraints

- **Server-Side Hosting**: All server-side components MUST be
  deployed to and hosted on Microsoft Azure.
- **Azure Services**: Infrastructure choices (compute, storage,
  messaging, etc.) MUST use Azure-native services unless a
  specification documents a justified exception.
- **Portability**: Application code SHOULD avoid tight coupling
  to Azure-specific SDKs where a standard interface exists
  (e.g., prefer standard HTTP clients over Azure-only helpers),
  but operational deployment MUST target Azure.
- **Web Application**: A web application MUST be provided as a
  client interface for accessing telemetry data and graphs.
- **iPhone Application**: A native iPhone (iOS) application
  MUST be provided as a mobile client interface.
- **Client–Server Contract**: Both client applications MUST
  communicate with the server-side components through a shared,
  versioned API contract. Direct database access from clients
  is prohibited.
- **Local Data Ingestion Containerization**: All local data
  ingestion services (e.g., epcube-exporter, vmagent) MUST
  be packaged and deployed as Docker containers. Container
  images MUST be reproducible from a Dockerfile in the
  repository. Bare-metal or manual installation of ingestion
  components is prohibited.

**Rationale**: Standardising on Azure simplifies infrastructure
management, billing, and operational tooling for a single-owner
project. Providing both web and iOS clients ensures access from
any device.

## Security

- **Transport Encryption**: All communication between client
  applications (web and iPhone) and the server MUST use TLS 1.2
  or higher. Plain-text HTTP endpoints MUST NOT be exposed.
- **Authentication**: Every API request from a client MUST be
  authenticated. Anonymous access to server-side endpoints is
  prohibited unless explicitly scoped in a specification.
- **Authorization**: The server MUST enforce authorization
  checks on every request. Clients MUST NOT be trusted to
  self-authorize.
- **Secrets Management**: API keys, tokens, and credentials
  MUST NOT be stored in source code or client bundles. Secrets
  MUST be managed through Azure Key Vault or an equivalent
  secure store.
- **Token Handling**: Authentication tokens MUST have a bounded
  lifetime and MUST be refreshed or reissued before expiry.
  Long-lived static tokens are prohibited.
- **Input Validation**: The server MUST validate and sanitise
  all input received from clients. Client-side validation alone
  is insufficient.
- **Zero-Trust Architecture**: The implementation MUST follow
  zero-trust principles:
  - **Never Trust, Always Verify**: Every request MUST be
    authenticated and authorized regardless of its origin,
    including requests from internal services and components.
  - **Least Privilege**: Each component, service, and user
    MUST be granted only the minimum permissions required for
    its function. Over-scoped roles are prohibited.
  - **Assume Breach**: The system MUST be designed so that
    compromise of any single component does not grant access
    to the entire system. Segment trust boundaries between
    services.
  - **Explicit Verification**: Network location (e.g., being
    on the same VNET or subnet) MUST NOT be treated as proof
    of trust. Identity-based verification is required at every
    boundary.
  - **No Implicit Trust Between Tiers**: The server MUST NOT
    trust client applications, and internal services MUST NOT
    trust each other without explicit, per-request credential
    verification.

**Rationale**: The system handles personal energy telemetry
data. Zero-trust ensures that no component is implicitly
trusted, limiting blast radius in the event of a compromise
and protecting data across all client platforms.

## DevOps

- **Infrastructure as Code**: All cloud infrastructure,
  platform configuration, and environment setup MUST be
  defined in version-controlled infrastructure-as-code
  templates (e.g., Bicep, Terraform). Manual creation of
  cloud resources via portal or CLI ad-hoc commands is
  prohibited for production environments.
- **Reproducible Deployments**: Every deployment MUST be
  reproducible from the repository alone. Given the same
  commit and configuration, deploying to a fresh environment
  MUST produce an identical result.
- **Minimize Manual Steps**: Manual deployment steps MUST be
  minimized. Any remaining manual step (e.g., one-time secret
  seeding, DNS delegation) MUST be documented in the
  quickstart or runbook with exact commands.
- **CI/CD Pipeline**: A CI/CD pipeline MUST build, test, and
  deploy every change that reaches the main branch. The
  pipeline MUST enforce the full test suite gate (Principle
  III) before deployment proceeds.
- **CI Coverage Gate (NON-NEGOTIABLE)**: The CI pipeline MUST
  enforce 100% combined code coverage (unit + integration) as
  a hard gate. The pipeline MUST fail the build if coverage
  falls below 100%. This gate MUST NOT be bypassed, made
  informational, or reduced to a warning under any
  circumstance. Lowering the threshold requires a constitution
  amendment (MAJOR version bump).
- **CI Test Coverage (NON-NEGOTIABLE)**: All tests across all
  components (API, exporter, etc.) MUST be executed during
  branch CI on every push. Smoke tests MUST be run against
  production after each deployment. No test suite may exist
  in the repository without a corresponding CI job that
  executes it.
- **Environment Parity (NON-NEGOTIABLE)**: Staging and
  production environments MUST be identical in architecture,
  security posture, network topology, and configuration —
  differing only in parameter values (names, scale, SKUs).
  If a security control, network rule, or architectural
  pattern exists in production, it MUST exist in staging.
  Shortcuts, workarounds, or reduced security in staging
  are prohibited. A change that cannot be validated in
  staging MUST NOT be promoted to production.
- **Rollback Capability**: Every deployment MUST support
  rollback to the previous version. Container-based
  deployments MUST use immutable, tagged images — `latest`
  tags are prohibited in production.
- **Local Deployment Automation**: Local deployments (e.g.,
  Docker Compose stacks) MUST include scripted setup that
  builds, configures, and starts all services with minimal
  manual interaction. The operator MUST only need to provide
  environment-specific values (e.g., device IPs, tokens) via
  a configuration file or environment variables; all other
  steps MUST be automated.
- **CI/CD Zero Warnings**: All errors and warnings reported
  by GitHub Actions during push and pull request workflows
  MUST be analyzed and resolved. Warnings MUST NOT be
  ignored or allowed to accumulate. Each CI/CD run MUST
  complete with zero warnings and zero errors. Persistent
  warnings that cannot be fixed MUST be suppressed with an
  inline justification comment explaining why.
- **Remote Terraform State**: Terraform state MUST be stored
  remotely in Azure Blob Storage with Azure AD authentication.
  Local state files are prohibited for shared or deployed
  environments. The backend configuration MUST be defined in
  a version-controlled `backend.hcl.example` template. CI/CD
  pipelines MUST use OIDC-based authentication for state
  access.
- **Tool Sync (NON-NEGOTIABLE)**: The canonical tool list in
  `scripts/tools.json` MUST be kept in sync with all
  development setup scripts (`scripts/setup-macos.sh`,
  `scripts/setup-windows.ps1`) and documentation
  (`DEVELOP.md`). When a tool is added to or removed from
  the project, all setup scripts and documentation MUST be
  updated in the same commit. CI runs
  `scripts/validate-tool-sync.sh` to enforce this — the
  build MUST fail if any drift is detected. Introducing a
  tool without updating all setup artifacts is prohibited.

**Rationale**: Infrastructure as code ensures auditability,
reproducibility, and eliminates configuration drift. Minimizing
manual steps reduces human error and makes the system
recoverable by anyone with repository access.

## Governance

- This constitution supersedes all other development practices.
  When a conflict arises, the constitution is authoritative.
- **Amendments**: Any change to this constitution MUST be
  documented with a version bump, rationale, and updated date.
  Amendments follow semantic versioning:
  - MAJOR: Principle removal or backward-incompatible redefinition.
  - MINOR: New principle or section added, or material expansion.
  - PATCH: Clarifications, wording fixes, non-semantic refinements.
- **Compliance Review**: Every plan and implementation MUST
  include a Constitution Check gate verifying alignment with
  these principles.
- **Complexity Justification**: Any deviation from Simplicity or
  YAGNI MUST be documented in the plan's Complexity Tracking
  table with a rejected simpler alternative.

**Version**: 1.12.0 | **Ratified**: 2026-03-07 | **Last Amended**: 2026-03-19
