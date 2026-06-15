# Implementation Plan: Reliable Post-Deployment Validation (No False Negatives, No Swallowed CLI Errors)

**Branch**: `166-validate-pg-db-check` | **Date**: 2026-06-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/166-validate-pg-db-check/spec.md`

## Summary

The production CD `validate-prod` gate is permanently RED because
`infra/validate-deployment.sh` checks the managed PostgreSQL database with
`az postgres flexible-server db show --server-name … --database-name …` — flags removed
in az CLI 2.86.0 (the runner auto-updated past it). The command exits non-zero, and the
`2>/dev/null || echo ""` idiom swallows the real error into an empty string, which the
script misreads as "database not found" — a false negative that also violates the
constitution's "No silent error swallowing" rule.

**Technical approach**: (A) replace the database check with a version-stable
`az resource show --ids <constructed db id>` and read charset/collation from
`.properties.*` (live-confirmed on az 2.84.0). (B) Introduce a single getter helper
`az_json` (in `infra/lib/az-json.sh`) that captures stdout, stderr, and exit code
separately without swallowing stderr, and apply it at all 17 audited sites so a **tool
error** is always distinguished from **resource absence**. (C) Prove it with a
self-contained Bash test that stubs `az` (no new framework), plus live verification
against production.

## Technical Context

**Language/Version**: Bash (target `/usr/bin/env bash`, `set -euo pipefail`); Python 3 used inline for JSON parsing (unchanged)
**Primary Dependencies**: Azure CLI (`az`) — must work on **2.84.0** (local) and **>= 2.86.0** (runner); `python3`; `curl` (existing smoke tests)
**Storage**: N/A (no schema/data changes — FR-010)
**Testing**: Self-contained Bash test runner with a stubbed `az` on `PATH` (`infra/tests/`); no bats-core (YAGNI)
**Target Platform**: macOS (maintainer local) + Linux CD runner
**Project Type**: Infrastructure/DevOps Bash tooling (single script + sourced lib)
**Performance Goals**: N/A (validation gate; runtime dominated by `az` calls, unchanged)
**Constraints**: Must remain `set -euo pipefail`-safe; reuse existing `pass`/`fail`/`skip`/`header`/`info` helpers and exit-code contract (0 all-pass / 1 any-fail); change limited to `infra/validate-deployment.sh` + supporting harness
**Scale/Scope**: One script (~640 lines), 17 anti-pattern occurrences, 1 new helper, 1 new test + stub

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ PASS | One small getter helper + a command swap. No new abstractions beyond the single helper the spec demands. |
| II. YAGNI | ✅ PASS | No bats-core, no coverage tool gating, no version-branching logic. Only what FR-001…FR-013 require. |
| III. Single Responsibility | ✅ PASS | `az_json` does one thing (run + capture, no decision). Pass/fail/skip policy stays at call sites where it legitimately varies. |
| IV. TDD (NON-NEGOTIABLE) | ✅ PASS | Red (test + stub first) → Green (helper) → Refactor (apply to 17 sites). Bug-fix regression test created first. Branch coverage of the new logic via 3 scenarios. |
| Dev Workflow — Local type/lint parity | ✅ PASS | Bash has no type checker; the bash test + `grep` audit are locally runnable, mirroring CI. |
| DevOps — IaC / no app changes | ✅ PASS | Tooling-only; no Terraform resource, schema, or app code changed (FR-010). |
| DevOps — CI Test Coverage | ✅ PASS | New test suite wired into a CI job (runs on every push). |
| DevOps — Tool Sync | ✅ PASS | No new dev tool added (deliberately avoided bats) → no `tools.json`/setup-script/DEVELOP.md churn. |
| Security — no silent error swallowing (rule 6) | ✅ PASS | Core of the fix: stderr captured to `AZ_JSON_ERR`, never `/dev/null`. |
| Root Cause Only | ✅ PASS | Fixes the swallow-and-misreport root cause across the whole script, not just the one line. |

**No violations → Complexity Tracking table is empty (not required).**

## Project Structure

### Documentation (this feature)

```text
specs/166-validate-pg-db-check/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions A/B/C, live-verified field paths, anti-pattern inventory
├── data-model.md        # Phase 1 — outcomes + az_json contract + DB resource attributes
├── quickstart.md        # Phase 1 — Red→Green→live verification steps
├── contracts/
│   └── az-json.md        # Phase 1 — az_json interface contract + call-site patterns + stub/test assertions
├── checklists/          # (pre-existing)
└── tasks.md             # Phase 2 — created by /speckit.tasks (NOT this command)
```

### Source Code (repository root)

```text
infra/
├── validate-deployment.sh   # MODIFIED: source lib; DB command swap (.properties.* paths); all 17 sites use az_json
├── lib/
│   └── az-json.sh            # NEW: az_json getter helper (sourced by the script and by tests)
└── tests/
    ├── stub-az               # NEW: fake `az`, behaviour selected by STUB_AZ_MODE
    └── test-az-json.sh       # NEW: plain-bash runner; asserts the 3 scenarios + call-site outcomes
```

CI: add a `bash infra/tests/test-az-json.sh` step to the existing
validation/lint workflow (exact workflow file identified during /speckit.tasks).

**Structure Decision**: Single Bash script with one **sourced library** (`infra/lib/az-json.sh`)
so the helper is unit-testable in isolation, and a sibling `infra/tests/` harness. This
is the minimal structure that satisfies SRP + TDD without introducing a test framework.

## Phase 0 — Outline & Research

**Output**: [research.md](research.md) — COMPLETE. All NEEDS CLARIFICATION resolved:

- **Decision A** — DB command: `az resource show --ids <constructed id>`; charset/collation
  live-confirmed at `.properties.charset` / `.properties.collation` (was top-level). FR-008
  satisfied without dropping any sub-check.
- **Decision B** — `az_json` getter helper; exact `set +e/set -e` capture pattern; `local`
  `$?`-masking pitfall documented; stderr to temp file (never `/dev/null`).
- **Decision C** — stub-`az` + plain-bash test; no bats; coverage via 3 branch-covering
  scenarios + live prod run (2.84.0) + CD run (>= 2.86.0).
- **Anti-pattern inventory** — 17 occurrences mapped to line numbers, absence policy, and
  remediation (16 `az` → `az_json`; 1 python-parse → remove swallow).

## Phase 1 — Design & Contracts

**Outputs**: [data-model.md](data-model.md), [contracts/az-json.md](contracts/az-json.md),
[quickstart.md](quickstart.md) — COMPLETE.

- **data-model.md** — validation outcome state machine (adds tool-error vs absence
  distinction); `az_json` I/O contract; DB resource attributes + derived `PG_DB_ID`.
- **contracts/az-json.md** — `az_json` signature, guarantees, reference implementation,
  the canonical call-site patterns (fail-on-absent / skip-on-absent / tsv-empty-ok /
  DB-check), and the stub + acceptance assertions.
- **quickstart.md** — Red→Green test commands, anti-pattern grep audit, live prod
  verification, forced-error verification, and final CD-gate confirmation.

### Agent context update

`.specify/scripts/bash/update-agent-context.sh copilot` run to register the
Bash-tooling/`az_json`/stub-`az` context (no new language/runtime introduced).

## Post-Design Constitution Re-check

Re-evaluated after Phase 1: still **PASS** on all principles. The design adds exactly one
helper (SRP/Simplicity intact), no new tooling (YAGNI/Tool-Sync intact), follows TDD
Red→Green→Refactor, and removes the silent-swallow root cause everywhere (rule 6). No
complexity to justify.

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
