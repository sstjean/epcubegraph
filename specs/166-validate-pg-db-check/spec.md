# Feature Specification: Reliable Post-Deployment Validation (No False Negatives, No Swallowed CLI Errors)

**Feature Branch**: `166-validate-pg-db-check`  
**Created**: 2026-06-13  
**Status**: Draft  
**Input**: User description: "Fix issue #166 — the post-deployment validation script reports a false negative for the managed PostgreSQL database on the production CD gate because it uses deprecated/removed az CLI flags and silently swallows the resulting error, collapsing a real CLI failure into 'database not found'. Fix the database check to be az-CLI-version-stable, surface real CLI errors, preserve true negatives, and audit the whole script for the same anti-pattern."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Production CD gate passes when production is healthy (Priority: P1)

As the maintainer of EpCubeGraph, when the production Continuous Deployment pipeline runs its post-deployment validation gate against a healthy production environment, I need the validation to report success so that the pipeline reflects reality and I can trust a green run.

**Why this priority**: This is the core defect. Today every production CD run is RED because the PostgreSQL database check reports a false negative even though the database exists and production is healthy. A validation gate that is permanently red is worse than no gate at all — it trains the maintainer to ignore failures, masking the next *real* regression. Restoring trust in the gate is the single most important outcome.

**Independent Test**: Run the validation against the current healthy production environment using an az CLI version at or above the runner's version (>= 2.86.0). The managed PostgreSQL database section must report the database as present (a pass), and the overall run must finish with zero failures attributable to the database check.

**Acceptance Scenarios**:

1. **Given** production is healthy and the managed PostgreSQL database `epcubegraph` exists, **When** the validation runs on an az CLI version >= 2.86.0, **Then** the database check reports the database as present (pass) and contributes no failures.
2. **Given** production is healthy, **When** the validation runs on the maintainer's local az CLI version (currently 2.84.0), **Then** the database check still reports the database as present (pass) — the fix must work across both the old and new CLI versions.
3. **Given** the validation completes against a healthy production environment, **When** the maintainer reads the summary, **Then** the failed count is zero and the run is GREEN.

---

### User Story 2 - Real CLI errors are surfaced, never disguised as "not found" (Priority: P1)

As the maintainer, when an underlying Azure CLI command fails for any reason other than the resource genuinely being absent (e.g. unrecognized arguments, authentication expiry, throttling, transient service error), I need the validation to surface that real error in the log so that I can diagnose the true cause instead of being misled into hunting for a missing resource that actually exists.

**Why this priority**: This is the root cause of issue #166 and a direct violation of the project constitution's "No silent error swallowing" principle (rule 6). The `2>/dev/null || echo ""` pattern converted a real "unrecognized arguments" error into an empty string, which the script then misread as "database not found." Any fix that only patches the one database line but leaves the swallow-and-misreport behaviour in place would simply relocate the same failure mode. Distinguishing *tool failure* from *resource absence* is essential to a trustworthy gate.

**Why P1 (tied with US1)**: US1 makes the gate green for the healthy case; US2 ensures the gate never lies about *why* something is red. Both are required for the gate to be trustworthy — fixing one without the other leaves the maintainer either with a false green or a misleading red.

**Independent Test**: Force the database-check command to fail with a non-absence error (for example, by invoking it on an az CLI version where the previously-used flags are unrecognized, or by simulating a CLI error). The validation must report a failure whose message reflects the *actual* CLI error (e.g. surfaces the stderr / unrecognized-arguments text), not the generic "database not found."

**Acceptance Scenarios**:

1. **Given** the az CLI command for the database check exits non-zero because of unrecognized arguments, **When** the validation runs, **Then** the log surfaces the actual CLI error text (stderr) and the check is reported as a tool-level failure distinct from "resource not found."
2. **Given** any audited check's underlying az command exits non-zero for a reason other than absence, **When** the validation runs, **Then** the real error is visible in the log rather than being collapsed to an empty string and misreported as a missing resource.
3. **Given** a CLI command fails, **When** the maintainer reads the validation output, **Then** they can tell the difference between "the CLI/tooling broke" and "the resource is genuinely missing" without needing to re-run anything.

---

### User Story 3 - Genuinely missing resources still fail the check (true negatives preserved) (Priority: P2)

As the maintainer, when a resource the validation expects (the PostgreSQL database, or any other audited resource) is genuinely absent from the environment, I need the validation to still report that as a failure so that the gate continues to catch real deployment regressions.

**Why this priority**: The whole point of the gate is to catch broken deployments. Hardening the script against false negatives and swallowed errors must not weaken its ability to catch *true* negatives. This is slightly lower priority than US1/US2 only because the current script already detects true negatives (that behaviour is not broken today); the risk is purely regression-avoidance during the fix.

**Independent Test**: Run the validation against an environment where the target resource genuinely does not exist (e.g. a freshly torn-down or never-provisioned database). The check must report a failure clearly indicating the resource is missing, distinct from a tool-level error.

**Acceptance Scenarios**:

1. **Given** the managed PostgreSQL database `epcubegraph` genuinely does not exist, **When** the validation runs, **Then** the database check reports a failure indicating the database is missing (a true negative), and the run is RED.
2. **Given** any audited resource is genuinely absent, **When** the validation runs, **Then** the corresponding check fails with a message indicating absence, distinct from a CLI/tooling error.

---

### User Story 4 - The whole script is hardened against the same anti-pattern (Priority: P2)

As the maintainer, I need every resource check in the validation script — not just the PostgreSQL database — to distinguish a real CLI/tooling error from a genuinely-absent resource, so that the same class of silent false negative cannot resurface elsewhere in the script the next time the az CLI changes behaviour.

**Why this priority**: The database line is the instance that bit production today, but the identical `2>/dev/null || echo ""` + "empty-string-means-missing" anti-pattern appears roughly a dozen-and-a-half times across the script (Container Apps environment, PostgreSQL server, API & exporter Container Apps, ACR, Key Vault, secret list, Log Analytics, Application Insights, managed identity, ACR id lookup, role-assignment list, Entra app list, and service-principal show). Fixing only the one line that failed today guarantees a repeat incident the next time any other command's flags or output change. A holistic audit is required by the project's engineering principles ("Holistic Thinking", "Root Cause Only").

**Independent Test**: Inspect the script after the change and confirm that no remaining resource check uses the swallow-everything-then-treat-empty-as-missing pattern; each audited check can be shown (by review and by a forced-error test on at least a representative sample) to surface a real error distinctly from reporting absence.

**Acceptance Scenarios**:

1. **Given** the hardened script, **When** the maintainer audits each resource check, **Then** none of them silently discards stderr in a way that converts a real CLI failure into a "resource not found" result.
2. **Given** any single audited check is forced to fail at the CLI level, **When** the validation runs, **Then** that check surfaces the real error rather than reporting the resource as absent.
3. **Given** the audit is complete, **When** the maintainer reviews the change, **Then** every previously-identified occurrence of the anti-pattern is either remediated or explicitly documented as intentionally-and-safely retaining absence-detection (with justification).

---

### Edge Cases

- **Charset / collation sub-checks**: The current database section reads `charset` (expected `UTF8`) and `collation` (expected `en_US.utf8`) from the command's JSON output. The replacement, version-stable data source for the database check MUST be confirmed to return these same fields. If the chosen data source does not expose `charset`/`collation`, the spec requires that this be flagged and resolved — either by sourcing those two fields from an alternative version-stable command, or, if no version-stable source exists, by explicitly deciding to drop those sub-checks (with that decision recorded). The validation must not silently lose the charset/collation assertions, and it must not fail spuriously because the new data source omits a field it expects.
- **Resource exists but the command that reads its detail fails**: A check must not report "missing" when the resource is present but the read failed for a tooling reason; this is the precise failure US2 guards against.
- **Transient / retryable CLI errors** (throttling, brief auth blips): These are tool-level failures, not absence. They must surface as such; the gate should not silently mark a present resource as missing because of a transient error.
- **Data-plane access blocked by firewall** (already handled today for Key Vault secret listing): The existing fallback that verifies secrets via the Container App when the Key Vault data plane is unreachable must be preserved — but its "empty list" handling must still distinguish a real CLI error from a genuinely-empty result.
- **az CLI exit code vs. stdout**: Because `set -euo pipefail` is in effect and the command is captured in a subshell, the design must capture the command's exit status separately from its stdout so that a non-zero exit is detectable rather than masked by the `|| echo ""` fallback.
- **Resource ID availability for the database check**: If the version-stable approach relies on a database resource ID, that ID must be derivable in the validation context (from Terraform state, from the already-fetched server JSON, or constructed from known naming conventions) without reintroducing a deprecated command.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The managed PostgreSQL database check MUST correctly report the database `epcubegraph` as present when it exists, when run on an az CLI version at or above the CD runner's version (>= 2.86.0).
- **FR-002**: The managed PostgreSQL database check MUST continue to work (report present-when-present) on the maintainer's current local az CLI version (2.84.0), i.e. the fix MUST be version-stable across the breaking change introduced in az CLI 2.86.0.
- **FR-003**: The managed PostgreSQL database check MUST NOT rely on az CLI arguments that were deprecated and removed in the 2.86.0 breaking-change release (the `--server-name` / `--database-name` flags on the database-show command).
- **FR-004**: When any audited check's underlying az CLI command exits non-zero for a reason other than the resource being genuinely absent, the validation MUST surface the actual error (the command's stderr / exit status) in its output, and MUST NOT report the result as a generic "resource not found."
- **FR-005**: The validation MUST capture each audited command's exit status separately from its standard output, so that a non-zero exit is distinguishable from an empty-but-successful result.
- **FR-006**: A genuinely-absent resource MUST still be reported as a failure indicating absence (true negatives preserved) for the PostgreSQL database check and for every other audited check.
- **FR-007**: The validation MUST present a tool-level/CLI failure and a resource-absence failure as distinguishable outcomes in its output, so the maintainer can tell which occurred without re-running.
- **FR-008**: The PostgreSQL database check MUST preserve the existing charset assertion (expected `UTF8`) and collation assertion (expected `en_US.utf8`), OR, if the chosen version-stable data source does not expose those fields, the change MUST explicitly document the decision to source them elsewhere or to drop them, and MUST NOT produce spurious failures due to a missing field.
- **FR-009**: Every occurrence of the "swallow stderr then treat empty output as missing" anti-pattern in the script MUST be reviewed; each MUST either be hardened to distinguish CLI error from absence, or be explicitly documented as a justified, safe retention of absence-detection.
- **FR-010**: The change MUST be limited to the Bash validation tooling (`infra/validate-deployment.sh`) and any supporting validation harness; it MUST NOT modify application code, database schema, or Terraform-managed infrastructure resources.
- **FR-011**: The hardened script MUST continue to use the existing reporting helpers (`pass`, `fail`, `skip`, `header`, `info`) and remain compatible with `set -euo pipefail`, so its overall pass/fail/skip summary and exit-code semantics (0 = all pass, 1 = any failure) are unchanged.
- **FR-012**: The validation's overall exit-code contract MUST remain: exit 0 when all checks pass, exit 1 when one or more checks fail — so the CD gate continues to block on real failures.
- **FR-013**: Existing legitimate `skip` behaviours MUST be preserved (e.g. an optional Container App not deployed because its image is empty, or an unreachable endpoint due to timeout). Hardening MUST NOT convert a legitimate "skip" into a "fail."

### Key Entities *(include if data involved)*

- **Validation check**: A single named assertion about a deployed resource (existence, a property value, an endpoint response). Has three possible outcomes — pass, fail, skip — and now must internally distinguish two *kinds* of fail: tool/CLI error vs. resource absence.
- **Managed PostgreSQL database (`epcubegraph`)**: The specific resource whose check is failing today. Relevant attributes the validation asserts: existence, charset (`UTF8`), collation (`en_US.utf8`). Lives on the managed PostgreSQL flexible server `${ENV_NAME}-postgres`.
- **az CLI version boundary (2.86.0)**: The breaking-change release that removed the previously-used database-show flags. The CD runner auto-updates past it; the local maintainer machine (2.84.0) predates it. The fix must straddle this boundary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the validation against the current healthy production environment on an az CLI version >= 2.86.0 yields zero failures attributable to the PostgreSQL database check, and the database is reported present.
- **SC-002**: The production CD `validate-prod` gate transitions from consistently RED to GREEN on the next run against healthy production, with no false-negative database failure.
- **SC-003**: When the database-check command is forced to fail at the CLI level, 100% of the time the validation output shows the real error text and does not report "database not found."
- **SC-004**: When the database is genuinely absent, 100% of the time the validation reports a failure indicating the database is missing (no false positives / no silent passes).
- **SC-005**: The same present-when-present database result is produced on both az CLI 2.84.0 and >= 2.86.0 (the fix is version-stable across the breaking change).
- **SC-006**: Zero remaining occurrences of the unguarded "swallow stderr then treat empty as missing" anti-pattern survive in the script without either remediation or a documented, justified exception — covering all ~17 identified occurrences.
- **SC-007**: The validation's overall summary semantics are unchanged: exit 0 on all-pass, exit 1 on any-fail, and legitimate skips remain skips.

## Assumptions

- The production environment is genuinely healthy and the `epcubegraph` database exists; the only reason the gate is red is the false negative described in issue #166 (confirmed in the issue).
- The CD runner's auto-updated az CLI has crossed 2.86.0; the maintainer's local az CLI is 2.84.0 (locally verified at `2.84.0`).
- A version-stable way to confirm database existence is available (e.g. a resource-ID-based show, or post-2.86.0 flag semantics guarded for cross-version use). Selecting and validating the exact command is a planning/implementation concern, not a spec concern; the spec only requires that the chosen approach satisfy FR-001 through FR-003 and FR-008.
- The change is reviewable as a focused infrastructure/tooling diff and requires no application, schema, or Terraform resource changes (per issue constraints).
- This is a single-owner personal project; "the maintainer" is the sole stakeholder for whom the gate must be trustworthy.

## Out of Scope

- Any change to application code, database schema, or Terraform-managed infrastructure.
- Pinning or downgrading the az CLI version on the runner (the fix must work *with* the current and future CLI, not freeze it).
- Re-architecting the validation script beyond what is needed to remove false negatives and surface real errors.
- Adding new resource checks unrelated to the issue.
