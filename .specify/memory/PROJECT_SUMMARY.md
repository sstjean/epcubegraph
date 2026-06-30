# EpCubeGraph — Project Summary

**Last Updated**: 2026-06-30
**Repository**: https://github.com/sstjean/epcubegraph (PUBLIC)
**Branch**: `168-internal-appgw-waf-edge` (no PR yet; 2 commits ahead of main)
**Last merged**: PR #171 — fix(167): allow js.monitor.azure.com in CSP connect-src
**Active work**: Feature 168 — Internal Container Apps env behind App Gateway WAF_v2 (Terraform only)

> **⛔ LOCAL TESTING = REAL DATA.** Always use `docker-compose.prod-local.yml`. Never use `docker-compose.local.yml` (mock) for manual testing. Mocks are only for automated test suites.

---

## Recent sessions (2026-06-30)

- **Start-up audit.** Discovered PROJECT_SUMMARY + SESSION_HANDOFF were stale
  (dated 2026-06-06, branch 164). Verified PR #165 merged 2026-06-12; deleted the
  obsolete `SESSION_HANDOFF.md` and refreshed this summary to branch-168 reality.
- **CI/PR noise triaged** (root causes read from actual logs, not speculation):
  - **#168, #169 (Dependabot)**: `deploy / deploy-staging` FAILURE is benign —
    Dependabot PRs run with a restricted token and have no access to the repo's
    Azure OIDC secrets, so `azure/login@v3` fails with "Ensure 'client-id' and
    'tenant-id' are supplied." Every real code check (build/test/dashboard/
    exporter/infra) passes. #168 is a lockfile-only removal of transitive
    `esbuild` platform packages; #169 bumps `pyjwt` 2.12.1→2.13.0.
  - **#172 (`166-fix-kv-firewall-routing`)**: `deploy-staging` FAILURE is a
    pre-existing infra blocker on `main`, NOT caused by the PR's code. Container
    App Managed Environment creation fails with
    `SubscriptionNotRegisteredForFeature: Microsoft.Network/AllowBringYourOwnPublicIpAddress`.
    This is exactly the problem **feature 168 exists to fix** (internal env, no
    BYO public IP). The KV-firewall fallback code itself passes all code checks.
- **Feature 168 Terraform baseline** (T003 partial / T011 prep): `cd infra &&
  terraform fmt -check -recursive` → clean (exit 0); `terraform validate` →
  "Success! The configuration is valid." Live `terraform output` fqdn capture and
  `terraform plan` still pending (need backend/state + Azure auth).
- Feature 168 task state: **25 done / 12 open**. Remaining tasks are live-Azure
  gated: ACME wildcard cert prereq (T002), plan/validate runs (T011/T027/T037),
  staging↔prod parity diff (T029/T030), ephemeral staging cycle + teardown
  (T032), production blue-green cutover runbook + execution (T034/T035).
- GitHub issues for 168 exist and are correct: parent **#173** + user stories
  **#174–#179** (U168-1..6).

## Recent sessions (2026-06-06)

- Completed cleanup for #163 / #115:
  - Merged PR #163 with merge commit.
  - Verified #115 auto-closed.
  - Deleted `115-appinsights-per-environment` branch (local + remote).
  - Destroyed residual b115 staging env via run `27017066095` and verified all `epcubegraph-b115-app*` resource groups removed.
- Advanced #164 with live telemetry verification:
  - Generated controlled production API traffic and confirmed immediate `requests` ingestion in App Insights (`epcubegraph-api`), disproving the broad "API ingestion is fully broken" claim.
  - Verified dashboard telemetry gap remained (`pageViews` and `customEvents` absent in production history).
  - Verified deployed dashboard bundle contains a real App Insights connection string and tracking methods (so the issue is not missing bundle config injection).
- Implemented dashboard fix on branch `164-dashboard-pageview-initial-load`:
  - `dashboard/src/App.tsx`: track initial page view on mount; avoid duplicate first event when router emits initial route change.
  - `dashboard/tests/component/App.test.tsx`: added regression tests for initial page-view tracking and route-change tracking.
  - Commit: `484e870`.
- Validation completed:
  - `cd dashboard && npm run typecheck` passed.
  - `cd dashboard && npm run test:coverage` passed at 100% statements/branches/functions/lines (775 tests).
- Collaboration artifacts:
  - Posted issue update to #164 with verified findings and fix summary.
  - Opened PR #165: https://github.com/sstjean/epcubegraph/pull/165.
  - Latest observed state: PR #165 open, merge state `CLEAN`, checks green.

## Recent sessions (2026-06-04)

- Completed full shutdown-cycle for issue #115 on branch `115-appinsights-per-environment`:
  - Added validator enforcement in `infra/validate-deployment.sh` for Application Insights:
    - R1: `${env}-appinsights` exists
    - R2: linked to `${env}-logs`
    - R3: API `APPLICATIONINSIGHTS_CONNECTION_STRING` secretRef is `appinsights-connection-string`
  - Live evidence captured before teardown:
    - Validator PASS: 65 passed / 0 failed in staging
    - Distinct instrumentation keys: staging `9ce57485-...` vs production `c62f58ff-...`
    - Production query windows (`30m`, `30d`) showed zero staging leakage
  - Staging destroy completed (run `26906146556`) and verified:
    - `epcubegraph-b115-app-*` resource groups removed
    - staging App Insights + Log Analytics removed
    - production `epcubegraph-appinsights` remains intact
- Documentation/spec updates completed and committed:
  - `DEPLOY.md`: new per-environment App Insights guidance and resource table rows
  - `specs/115-appinsights-per-environment/tasks.md`: marked complete with evidence and observed telemetry limitation notes
- PR opened: #163 (`https://github.com/sstjean/epcubegraph/pull/163`), merge state currently `CLEAN`.
- Issue #115 updated with closing evidence comments.
- New defect discovered and filed: #164 (no App Insights telemetry emitted at runtime despite correct wiring).

## Recent sessions (2026-05-24)

- **PR #161 opened** (`153-chart-js-historical-graph`): Chart.js 4.5 replaces
  uPlot in `HistoricalGraph.tsx` and `HistoryView.tsx`. Phases 2-8 of the spec
  complete plus visual/UX polish discovered during Playwright verification:
  - `getTimeUnit(step)` decouples tick granularity from data density:
    hour/day/month picked from API aggregation step (closes #149).
  - `shouldShowBattery(step)` keeps SoC overlay on line views only.
  - Per-bar grid coloring by sign (red pull / green export); border color
    matches fill.
  - Diagonal red/green legend swatch (`createGridSplitSwatch` via
    `legend.pointStyle`) so the swatch reflects per-bar coloring without the
    `CanvasPattern` tile-seam artifact.
  - Display timezone pinned to `America/New_York` via explicit
    `ticks.callback` (`formatAxisTick`) and `formatTooltipTimestamp` —
    `chartjs-adapter-date-fns` has no native TZ support.
- New tooling: `scripts/inspect-swatch.py` and `scripts/dump-swatch.py`
  (Pillow) — crop/zoom + ASCII-dump a Chart.js legend swatch from a
  `verify-*.png` to verify pixel-accurate colors/orientation.
- Verification: typecheck clean, 36 test files, 100% coverage on all metrics,
  Playwright Chrome sweep of 1d/7d/30d/1y presets.
- New memory rule (`/memories/end-to-end-verification.md`): always dump
  pixels before describing visual output — never describe what I *intended*
  to draw.

## Recent sessions (2026-05-23)

- PR #150 merged — issue #66 calendar picker affordance, deployed to staging cleanly
- PR #151 merged — dropped specs 003 (iPhone app) and 004 (iPad app); closed #5, #6
- Cleaned up local + remote branches; only `origin/main` plus active work branches
- Dispatched staging-destroy workflow to remove vestigial staging env
- **Issue #149 attempted but pivoted**: uPlot proved too limited for grouped
  bars + x-axis padding + month/year tick labels. Decision: swap uPlot for
  Chart.js. Branch `149-axis-month-year-labels` abandoned; WIP stashed.
  See `SESSION_HANDOFF.md` for the full plan.

## What's Next

1. **Feature 168** is the active thread. Next concrete steps when ready for live
   Azure work: capture current `api_fqdn`/`exporter_fqdn` outputs for rollback
   (T003), run `terraform plan` and confirm no `SubscriptionNotRegisteredForFeature`
   + internal LB (T011), then provision the shared `*.devsbx.xyz` ACME wildcard
   cert prereq (T002) before the first gateway apply.
2. **Open Dependabot PRs** awaiting merge decision: #168 (esbuild lockfile),
   #169 (pyjwt). Both have green code checks; only the benign Dependabot
   `deploy-staging` auth failure is red. Awaiting explicit merge approval.
3. **PR #172** (KV firewall fallback) — code checks green; `deploy-staging` red
   only because of the pre-existing BYO-public-IP blocker that 168 fixes. Decide
   whether to merge #172 ahead of 168 or fold into the 168 cutover.
4. Decide #164 closure (dashboard pageview fix from #165 shipped; confirm
   post-deploy telemetry before closing).

## Open issues

- **#173** — Internal Container Apps env behind App Gateway WAF_v2 (parent; in flight)
- **#174–#179** — U168-1..6 user stories for feature 168
- **#164** — API/dashboard emit no Application Insights telemetry at runtime (dashboard pageview fix shipped via #165; confirm post-deploy)
- **#52**  — Port epcube-exporter from Python to C# (low priority)

## Pending

- Feature 168 branch has 2 commits, no PR opened yet.
- Open PRs: #172 (KV firewall fix), #168 + #169 (Dependabot) — all awaiting merge decision.
- No uncommitted local changes.

---

## ⚡ Prior State (2026-05-17)

### Feature 124: Device Discovery (SHIPPED ✅)
Merged via PR #137 and deployed to production 2026-05-17. End-to-end behaviour validated
first in staging (prod→staging DB mirror surfaced the real prior hardware swap, replacement
banner appeared, merge executed within the bumped command timeout), then in production.
Issue #134 closed.

**Beyond original spec, also delivered on this branch:**
- Cross-cycle replacement detection (alias matching between newly-added and previously-removed devices, not just same-cycle)
- Poll-before-sleep exporter fix (new devices begin emitting telemetry on the same poll cycle as discovery; was previously delayed by a full poll interval)
- `DELETE /api/v1/devices/{cloudId}` endpoint + `RemovedDevicesSection` UI for hard-deleting devices the user does not want to merge (option C management view)
- `SettingsPage` SRP refactor — god component split into `PollingIntervalsSection`, `VueDeviceMappingSection`, `PanelHierarchySection` plus a tab orchestrator. Per-section tests only mock what each section uses.
- Banner UX redesign: two-column table (Last Seen / Device ID / Device Name / Readings / Duplicates) with Yes/No buttons. `DeviceDiscoveryProvider` lifts pending state so the banner and the device card share it (merge/dismiss updates both instantly without polling lag).
- Card-level "These are the new device readings. The old device is offline." indicator on the active device card during a pending replacement (only when both devices would resolve to the same display title).
- Disambiguation of duplicate-titled cards (`EP Cube v2 (5488)` / `EP Cube v2 (5840)` when both share product_code).
- Offline-zero fix: offline cards no longer render stale last-known values.
- `updated_at` field on `DeviceInfo` (exposes when a device was marked removed, shown in the Removed tab as "Removed Date").
- Bug fix: `vue_device_mapping` rename in merge now uses proper `epcube{id}` prefix (was previously a silent no-op on key mismatch; now logged via new `ILogger<PostgresMetricsStore>`).
- Bug fix: `DismissPendingReplacementAsync` closes the lookup reader before rollback (was raising `NpgsqlOperationInProgressException` when the pending row didn't exist).
- Constitution Section IV: new "Bug Fix Regression Tests (NON-NEGOTIABLE)" rule — every bug fix must start with one or more failing tests.

### Session 2026-05-18 — Post-Feature-124 cleanup

**Cleanup completed:**
- PR #137 (Feature 124) merged to `main` and deployed to production.
- PR #138 (post-merge docs cleanup) opened, reviewed, merged to `main`.
- Local feature branch `124-device-discovery` deleted; remote deleted.
- Local cleanup branch `docs/post-124-cleanup` deleted; remote deleted.
- Staging environment `epcubegraph-b124-dev` destroyed (run #26008216055,
  completed in 33m35s). Resource groups `epcubegraph-b124-dev-rg` and
  `epcubegraph-b124-dev-bootstrap-rg` confirmed gone via `az group exists`.
- Stale staging envs `b123-def` and `b093-exp` also confirmed destroyed.
- Runner VNet has zero ephemeral peerings (mirror-script trap cleanup left
  no orphans).
- Local dev servers (ports 5062, 5173) stopped. Local `prod-against-real-data`
  Docker stack (`local-postgres-1`, `local-epcube-exporter-1`) left running
  intentionally as the persistent dev environment.

**Discipline note:**
- Initially committed the cleanup docs directly to `main` (rule violation).
- Recovered by branching to `docs/post-124-cleanup`, resetting `main`, and
  opening PR #138 properly. Going forward: GitHub branch protection now
  enforces "no direct commits to main" — always work on a branch and PR.

### Session 2026-05-19 — Production dashboard auth timeout incident + hotfix prepared

**Incident summary (production):**
- Dashboard rendered auth errors with `BrowserAuthError: monitor_window_timeout`
  (`Token acquisition in iframe failed due to timeout`) and blocked data loading.
- User confirmed issue was already present before hard refresh; closing the tab,
  opening a new tab, and re-authenticating restored normal behavior.

**Telemetry evidence collected (Azure App Insights, `epcubegraph-appinsights`):**
- Signature: `monitor_window_timeout` only.
- Window: first seen `2026-05-19T12:46:54.757Z`, last seen `2026-05-19T13:28:10.841Z`.
- Volume: ~2.4k exceptions in that window.
- Scope: single user/session/browser fingerprint (Edge 148 on Mac OS X 10.15).
- Later check (`ago(90m)`) returned zero new `monitor_window_timeout` exceptions.

**Root-cause conclusion (based on telemetry + behavior):**
- Session-scoped client auth loop in MSAL silent iframe token acquisition.
- Not a backend/API/platform outage.

**Hotfix implemented locally (dashboard):**
- `dashboard/src/auth.ts`
  - Added single-flight token acquisition (`accessTokenRequestInFlight`) so
    concurrent API calls share one silent token request.
  - Added explicit `monitor_window_timeout` handling to escalate to one
    controlled `loginRedirect`.
  - Added redirect de-duplication guard (`loginRedirectInFlight`) to prevent
    repeated redirect loops.
- `dashboard/tests/unit/auth.test.ts`
  - Added regression tests for timeout fallback, in-progress handling,
    redirect de-dupe, and concurrent token request dedupe.

**Verification:**
- `dashboard` typecheck: pass.
- Focused tests (`auth` + `api`): pass.
- Full dashboard coverage suite: pass at 100% lines/branches/statements/functions.

**Status:**
- Fix is implemented and validated locally; deploy pending.

### Session 2026-05-17 — Feature 124 shipped + PR #137 review remediation
**Production deployment confirmed.** The cross-cycle replacement detection caught the real
prior hardware swap immediately on first prod-deploy discovery cycle, dashboard surfaced
the merge prompt, and the merge executed successfully against ~475k readings rows.

**Notable mid-session work captured:**
- **Silent-error swallow fix (exporter)** — `read_active_epcube_ids` and `read_setting_int`
  in `PostgresWriter` were swallowing exceptions via `log.debug` without rolling back the
  psycopg2 connection, poisoning every subsequent write with `InFailedSqlTransaction`.
  Fixed via new `_rollback_safe()` helper + visible WARNING logs with `exc_info=True`.
  Vue's `VuePostgresWriter` had the same gap; fixed in a follow-up commit with the same
  pattern. Constitution rule 6 ("No silent error swallowing") materially enforced.
- **Merge query CommandTimeout** — Npgsql default 30s timeout was too short for the
  ~475k-row UPDATE in `ExecuteMergeAsync`. Bumped to `MergeCommandTimeoutSeconds = 600`
  (10 min) on the three heavy commands (count, conflict delete, transfer update).
- **Ephemeral prod→staging DB mirror tooling** — new Terraform module
  `infra/runner-pg-access/` + `scripts/mirror-db.sh` that peers the self-hosted runner
  VNet into a target env's VNet for one phase at a time (CIDRs collide so sequential is
  required), runs `pg_dump | gzip` on the runner, swaps the peering to the target,
  restores via `psql`, and destroys everything via `trap EXIT`. Used to mirror prod data
  into the 124 staging env for realistic-volume validation.
- **PR #137 review remediation** — 7 review threads from the Copilot reviewer addressed:
  - `cbb19b4` fix(exporter): raise on non-200 cloud response so `retry_with_backoff` retries
  - `1f5aada` fix(api): validate `/devices` `status` param, 400 on unknown values
  - `8311f2e` feat(api): include `status` field on `DeviceInfo` response
  - `03c817f` docs(124): contract + cross-cycle alignment

**New process rules added to constitution + copilot-instructions:**
- **5-Minute Debug Limit (NON-NEGOTIABLE)** — after 5 minutes of unsuccessful debugging,
  STOP and brief Steve with what was checked, known vs. unknown, candidate hypotheses.
- Constitution clarification on Bug Fix Regression Tests already in place.

### Session 2026-05-16 — Feature 124 wrap + branch ready for PR
**Work completed (9 new commits on `124-device-discovery`, not yet pushed):**
1. `6385888` chore: constitution + .gitignore (`*.lscache`)
2. `d1fab4c` test(local): `scripts/simulate-device-replacement.sh`
3. `129127a` fix(exporter): cross-cycle detection + poll-before-sleep + helper consolidation
4. `f423049` feat(api): merge fixes, `DELETE /devices`, `updated_at`, regression coverage (`MergeStoreFullTests`, `DeleteDeviceStoreTests`, `DeleteDeviceEndpointTests`, `DevicesUpdatedAtTests`)
5. `7afd0a2` feat(dashboard): redesign replacement banner + shared `useDeviceDiscoveryContext`
6. `5a2d951` feat(dashboard): card-level pending-merge note, offline-zero, disambiguation
7. `67b17af` refactor(dashboard): split `SettingsPage` into per-tab sections (SRP)
8. `fbf944d` feat(dashboard): `RemovedDevicesSection` — manage and hard-delete removed devices
9. (PROJECT_SUMMARY update — this commit)

**Tests:**
- Exporter: 331/331 pass
- API: 452/452 pass
- Dashboard: 664/664 pass
- **Total: 1447 tests**

**Working tree at session end:** clean. Push pending user approval.

### Session 2026-05-15 — Feature 124 audit + removed-device toggle progress
**Work completed:**
- Performed startup procedure and full status audit against specs/tasks/code.
- Verified test state end-to-end:
  - Exporter: 323/323 pass, `epcube_collector.py` 100% coverage
  - API: 422/422 pass (after starting Docker Desktop)
  - Dashboard: 595/595 pass, 100% coverage
- Audited `specs/124-device-discovery/tasks.md` against implementation and updated stale checkboxes:
  - Marked T015–T053 and T055–T057 complete
  - Left T054, T058, T059, T060 open
- Implemented removed-device visibility feature work in dashboard:
  - Added removed-device toggle and persistence via localStorage (`showRemovedDevices`)
  - Added removed-device rendering/styling (`device-removed`, `removed-toggle`)
  - Fetched removed devices via `fetchDevicesByStatus('removed')`
- Added/updated component tests for removed-device toggle behavior and hardened selectors to avoid ambiguous label matches.
- Verified `CurrentReadings` component suite: 34/34 passing.

**Working tree at shutdown (uncommitted):**
- `dashboard/src/app.css`
- `dashboard/src/components/CurrentReadings.tsx`
- `dashboard/tests/component/CurrentReadings.test.tsx`
- `specs/124-device-discovery/tasks.md`

### Session 2026-05-12 — Test isolation refactor complete + push + PR
**Commits made (3 new, all on `124-device-discovery`):**
1. `f1c3b3a` — Commit 5 previously-done dashboard unit test files
2. `cf868d8` — Phase 4 complete: remove all beforeEach/afterEach from 18 dashboard files
3. `c82fd57` — Phase 5 complete: inline setUp into 115 Python test methods

**Key decisions:**
- `@testing-library/preact` does NOT auto-cleanup — added global `afterEach(cleanup)` in `tests/setup.ts`
- Complex mock setup extracted to `setupMocks()` helpers (DeviceMerge, HistoricalGraph, SettingsPage)
- Python setUp inlined via script for 115 methods across 2 classes

**Branch pushed + PR opened:**
- PR #137 — Test isolation refactor: every test self-contained (Phases 0–5)
- 15 commits total on `124-device-discovery`, all pushed

### PR #136 — Exporter Refactor (MERGED ✅)
- Issue #135 closed — see prior session entry below.

### Production Outage — PostgreSQL Auto-Stop (UNRESOLVED)
- See Copilot repo memory `postgres-auto-stop-runbook.md`

### Staging Environments
All prior staging branch environments destroyed and verified gone:
- `b124-dev`: destroyed (run #26008216055)
- `b123-def`: destroyed (run #25572637307)
- `b093-exp`: destroyed (run #25588799137)

### Tests (as of 2026-05-17)
- Dashboard: 686 tests, 100% all metrics
- API: 486 tests, 100% line + 100% branch (self-contained; Testcontainers per test)
- Exporter: 349 tests, 100% coverage
- **Total: 1521 tests**

### Open Issues
| # | Title | Label | Status |
|---|-------|-------|--------|
| 115 | Separate Application Insights per environment | enhancement | Open |
| 66 | Calendar-aware time range selector | enhancement | Open |
| 52 | Port exporter Python→C# | enhancement | Open |
| 6 | iPad App | feature | Spec only |
| 5 | iPhone App | feature | Spec only |

### What's Next
Awaiting next feature direction.

### Pending
Nothing pending. Repo, environments, and issues all at baseline.

### Production Services
| Service | URL |
|---------|-----|
| Dashboard | https://epcube.devsbx.xyz |
| API | https://epcube-api.devsbx.xyz/api/v1/health |
| Exporter debug | https://epcube-debug.devsbx.xyz |

### Shared Infrastructure
| Resource | Repo |
|----------|------|
| Azure DNS zone (devsbx.xyz) | sstjean/devsbx-common |
| tfstate storage | tfstateepcubegraph in tfstate-rg |

---

## Executive Summary

**EpCubeGraph** is a personal energy monitoring system for Canadian Solar EP Cube solar/battery gateways. Collects telemetry from EP Cube devices via cloud API, stores in PostgreSQL, exposes through a web dashboard and REST API. Constitution mandates TDD (100% coverage), zero warnings in CI/CD, Azure-first deployment, and semantic architecture.

---

## Architecture

### System Flow

1. **Ingest**: epcube-exporter polls EP Cube cloud API (monitoring-us.epcube.com), writes directly to PostgreSQL
2. **Store**: PostgreSQL 17 (local Docker Compose); Azure Database for PostgreSQL Flexible Server (Azure). Indefinite retention.
3. **Serve**: ASP.NET Core Minimal API queries PostgreSQL via Npgsql. Entra ID JWT auth + `user_impersonation` scope. Clean JSON responses.
4. **Visualize**: Preact SPA on Azure Static Web Apps. MSAL.js PKCE auth. uPlot charting.

### Key Design Decisions

- **Background threads**: All daemon thread loops MUST wrap the entire body in try/except with logging. No code outside the try block (including DB reads, `time.sleep()`). Always log thread startup.
- **epcube-exporter**: Python daemon, AJ-Captcha block puzzle solver, polls every 60s, writes to PostgreSQL via psycopg2
- **PostgreSQL**: All time-series storage. Exporter writes directly. API queries via Npgsql + NpgsqlDataSource connection pooling. Integration tests use Testcontainers.PostgreSql.
- **API**: ASP.NET Core Minimal API. Entra ID JWT + `user_impersonation` scope. **Local port: 5062**.
- **Dashboard**: Preact (3KB) + uPlot + MSAL.js (PKCE). Auto-polls API every 30s.

### API Endpoints (`/api/v1`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | No | Datastore health check |
| `GET /readings/current?metric={name}` | Yes | Latest reading per device |
| `GET /readings/range?metric={name}&start=&end=&step=` | Yes | Bucketed time-series |
| `GET /devices` | Yes | Device inventory (`?status=active|removed|merged|all`, default `active`) |
| `GET /devices/{device}/metrics` | Yes | Metrics for one device |
| `GET /devices/pending-replacements` | Yes | List pending replacement prompts |
| `POST /devices/pending-replacements/{id}/dismiss` | Yes | Dismiss a pending replacement |
| `GET /devices/merge-preview?old_device_id=X&new_device_id=Y` | Yes | Preview reading counts before merge |
| `POST /devices/merge` | Yes | Execute device merge (transfer readings, mark old merged) |
| `DELETE /devices/{cloudId}` | Yes | Hard-delete a removed/merged device + its readings (refuses active) |
| `GET /grid?start=&end=&step=` | Yes | Grid power time-series |
| `GET /settings` | Yes | All settings key-value pairs |
| `PUT /settings/{key}` | Yes | Update setting (allowlisted keys only) |
| `GET /settings/hierarchy` | Yes | Panel hierarchy entries |
| `PUT /settings/hierarchy` | Yes | Replace hierarchy (cycle detection) |
| `GET /settings/display-names` | Yes | Display name overrides |
| `PUT /settings/display-names/{deviceGid}` | Yes | Update display names for device |
| `DELETE /settings/display-names/{deviceGid}/{channel}` | Yes | Clear display name override |

---

## Feature Status

### Feature 001: Data Ingestor (COMPLETE ✅)
### Feature 002: Web Dashboard (COMPLETE ✅)
### Feature 005: Emporia Vue (COMPLETE ✅, PR #95)
### Feature 006: Dashboard Settings Page (COMPLETE ✅, PR #90)
### Feature 007: Dashboard Vue Circuits (COMPLETE ✅, PR #108)
### Feature 010: Simplify Vue Mapping (COMPLETE ✅, PR #124)
### Feature 093: Remove Vestigial Metrics (COMPLETE ✅)
### Feature 124: Automatic Device Discovery (SHIPPED ✅, PR #137)
### Feature 003: iPhone App (SPEC ONLY)
### Feature 004: iPad App (SPEC ONLY)

---

## Tech Stack

| Layer | Component | Version |
|-------|-----------|---------|
| Ingestion | epcube-exporter (Python) | 3.12 |
| Storage | PostgreSQL | 17-alpine (local) / Flexible Server (Azure) |
| API | .NET SDK | 10.0 |
| API DB | Npgsql | 9.0.3 |
| Dashboard | Preact | 10.x |
| Build | Vite | 5.x |
| Charting | uPlot | 1.6.32 |
| Auth (browser) | MSAL.js | @azure/msal-browser |
| Auth (API) | Microsoft.Identity.Web | Latest |
| Testing (API) | xUnit + Testcontainers.PostgreSql | 4.3.0 |
| Testing (Dashboard) | Vitest | 3.x |
| Azure | Container Apps, PostgreSQL Flex, SWA, Key Vault, VNet |
| IaC | Terraform | 1.5+ |
| CI/CD | GitHub Actions | — |

---

## Key File Locations

| Purpose | Path |
|---------|------|
| API | `api/src/EpCubeGraph.Api/` |
| API Tests | `api/tests/EpCubeGraph.Api.Tests/` |
| Dashboard | `dashboard/src/` |
| Dashboard Tests | `dashboard/tests/` |
| Exporter | `local/epcube-exporter/` |
| Infrastructure | `infra/` |
| CI/CD | `.github/workflows/` |
| Specs | `specs/` |
| Constitution | `.specify/memory/constitution.md` |
| Session Procedures | `.specify/memory/session-procedures.md` |

---

## References

- **Constitution**: `.specify/memory/constitution.md`
- **Session Procedures**: `.specify/memory/session-procedures.md`
- **Data Model**: `specs/001-data-ingestor/data-model.md`
- **API Contract**: `specs/001-data-ingestor/contracts/api-v1.md`
- **Dashboard Config**: `specs/002-web-dashboard/contracts/dashboard-config.md`
- **Research**: `specs/*/research.md`
- **Quickstarts**: `specs/*/quickstart.md`
