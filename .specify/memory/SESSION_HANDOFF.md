# Session Handoff (2026-06-30)

## Branch / Repo State

- Current branch: `168-internal-appgw-waf-edge` (pushed to origin)
- **PR #180** (open): https://github.com/sstjean/epcubegraph/pull/180
  - Base `main` ← `168-internal-appgw-waf-edge`, 5 commits
  - Closes #173; implements stories #174–#179
- Working tree: clean after shutdown commit
- Stashes: none

## What Was Completed This Session

1. Start-up audit found stale memory (branch-164 era). Verified PR #165 merged
   2026-06-12; deleted obsolete `SESSION_HANDOFF.md`; refreshed `PROJECT_SUMMARY.md`.
2. Triaged CI/PR noise from actual logs:
   - #168/#169 Dependabot `deploy-staging` red = no Azure OIDC secrets in Dependabot
     context (benign). Merged both with merge commits.
   - #172 `deploy-staging` red = pre-existing `SubscriptionNotRegisteredForFeature:
     AllowBringYourOwnPublicIpAddress` blocker on main (the thing 168 fixes).
3. Folded #172's commit onto 168 (`19ac848`, clean cherry-pick). Verified
   `test-az-json.sh` 21/21, `test-edge-asserts.sh` 14/14, `terraform validate` clean.
4. Established 168 Terraform baseline: `terraform fmt -check -recursive` clean,
   `terraform validate` success.
5. Pushed branch 168; opened PR #180.

## Decision / How To Proceed

- Feature 168 implementation (Terraform + bash TDD) is committed and validated
  locally/statically. Remaining work is the **live-Azure blue-green cutover** —
  deliberately manual, gated on Azure auth + backend state.
- `deploy / deploy-staging` on PR #180 will stay red until the internal env is
  actually applied; that is expected, not a regression.

## Concrete Next Actions (live-Azure, when ready)

1. T002 — provision shared `*.devsbx.xyz` ACME wildcard cert into Key Vault BEFORE
   first gateway apply.
2. T003 — `cd infra && terraform output` to capture current `api_fqdn`/`exporter_fqdn`
   for rollback baseline.
3. T011 — `terraform plan` (staging); confirm NO `SubscriptionNotRegisteredForFeature`
   and an internal LB shows.
4. T027–T037 — staging parity diff, ephemeral cycle + teardown, then production
   blue-green cutover (repoint custom-domain CNAMEs, confirm dashboard load + OAuth),
   decommission old external env. PostgreSQL untouched throughout.
5. When 168 merges: close #172 (folded), delete branch 168 local+remote, check for
   vestigial staging envs.

## Do Not Repeat / Guardrails

- Don't "fix" PR #180's `deploy-staging` red by weakening checks — it clears on cutover.
- Merge-commit policy only (`--merge`), never squash.
- Don't run the BYOPIP feature registration — the whole point of 168 is to NOT need it.
- Don't tear down PostgreSQL during cutover (FR-016).

## Open Issues Affected

- #173 (parent, closes on 180 merge), #174–#179 (stories)
- #172 (open; folded onto 168)
- #164 (dashboard pageview fix shipped via #165; confirm post-deploy before close)
- #52 (backlog: exporter Python→C#)
