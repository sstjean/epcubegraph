# Session Handoff (2026-06-04)

## Branch / Repo State

- Current branch: `115-appinsights-per-environment`
- Latest commits on branch:
  - `9d6bb2e` docs(memory): shutdown update project summary for 2026-06-04
  - `caddd42` docs(115): record verify-only evidence + per-env App Insights note
  - `049780f` feat(115): validator R1-R3 App Insights checks
- Working tree: clean at shutdown
- Stashes: none created this session

## What Was Completed

1. Closed out issue #115 work items with evidence and docs updates.
2. Opened PR #163: https://github.com/sstjean/epcubegraph/pull/163
3. Ran staging destroy workflow and verified teardown:
   - run `26906146556` succeeded
   - b115 staging RGs removed
   - production App Insights still present
4. Filed follow-up defect #164 for no App Insights telemetry ingestion:
   - https://github.com/sstjean/epcubegraph/issues/164

## What Was Tried / What Failed

- Tried to prove positive telemetry landing in staging and production using `az monitor app-insights query` across `requests`, `exceptions`, `customEvents`, `traces`, `dependencies`.
- Result: zero rows observed (including production over 30d), despite valid connection string wiring and validator pass.
- This was determined to be a separate defect (not #115 isolation failure), so investigation was split into #164.

## Decision / How To Proceed

- Treat #115 as complete via structural isolation proof + validator enforcement (PR #163).
- Track and fix runtime telemetry ingestion separately under #164.

## Concrete Next Actions

1. Monitor PR #163 checks and merge when green:
   - `gh pr view 163 --json state,mergeStateStatus,url`
2. After merge, verify #115 closes and clean branch:
   - `gh issue view 115`
   - `git checkout main && git pull`
   - `git branch -d 115-appinsights-per-environment`
   - `git push origin --delete 115-appinsights-per-environment`
3. Confirm no vestigial staging envs remain (including any PR-triggered ones):
   - `az group list --query "[?contains(name, 'epcubegraph-b')].name" -o tsv`
   - If needed: `gh workflow run cd.yml -f environment=staging -f branch_name=<branch> -f destroy=true`
4. Start #164 diagnosis in live environment:
   - Check API container logs for AI channel/transmission errors
   - Test reachability from API container to App Insights ingestion endpoint
   - Validate whether private-network egress path supports AI endpoints
   - Propose fix path (AMPLS/private link vs NAT egress) with environment parity

## Do Not Repeat / Guardrails

- Do not treat telemetry non-arrival as proof of leakage; #115 isolation is already proven by separate resources/keys and validator R1-R3.
- Do not run `infra/validate-deployment.sh` on macOS system bash 3.2; use `/opt/homebrew/bin/bash` locally (CI Linux bash is unaffected).
- Do not use portal-only evidence for #115/#164; keep CLI-query evidence as primary.

## Open Issues Affected

- #115 (pending auto-close on PR #163 merge)
- #164 (new, open)
- #52 (unchanged backlog)
