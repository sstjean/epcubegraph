# Quickstart: Grid-down state on the Current diagram

**Feature**: 181-grid-down-state · **Date**: 2026-07-03

How to build, test, and manually verify this vertical slice. TDD is mandatory — write the
failing test, confirm Red, implement Green, refactor.

---

## What changes, at a glance

| Tier | File | Change |
|------|------|--------|
| Exporter | `local/epcube-exporter/epcube_collector.py` | `build_postgres_readings()` appends a `grid_status_code` reading when `systemStatus` is a valid int; add a small int-parse guard. |
| Exporter | `local/epcube-exporter/test_exporter.py` | New tests: tuple present for valid codes; omitted for `"?"`/non-int. |
| API | — | **No change** (`/readings/current?metric=grid_status_code` already works). |
| Dashboard | `dashboard/src/components/DeviceCard.tsx` | Add `gridDown: boolean` to `DeviceCardMetrics`. |
| Dashboard | `dashboard/src/utils/grid.ts` (new) | Pure `deriveGridDown(code): boolean` = `code === 2 || code === 3`. |
| Dashboard | `dashboard/src/components/CurrentReadings.tsx` | Fetch `grid_status_code`; set `gridDown` per device in `buildDeviceGroups`. |
| Dashboard | `dashboard/src/components/EnergyFlowDiagram.tsx` | Red Grid symbol + "Grid Down" label when `gridDown`; Grid↔EP Cube flow line forced idle (grey, no animation/label) when `gridDown` (FR-005a). |
| Dashboard | `dashboard/tests/**` | Unit `deriveGridDown` + `buildDeviceGroups`; component red-symbol/label test. |

## Build & test commands

```bash
# Exporter (Python 3.12, unittest)
cd local/epcube-exporter && python -m unittest test_exporter -v

# Dashboard (type-check + tests + coverage — 100% gate)
cd dashboard && npm run typecheck
cd dashboard && npm run test:coverage

# API (unchanged, but run to prove no regression)
cd api && dotnet test EpCubeGraph.sln
```

## TDD order (Red → Green per tier)

1. **Exporter Red**: add tests asserting `build_postgres_readings` yields
   `(f"{dev}_battery", "grid_status_code", ts, 2.0)` for `system_status_raw = 2`, and yields
   **no** `grid_status_code` tuple for `system_status_raw = "?"`. Run → fail.
2. **Exporter Green**: append the guarded `grid_status_code` tuple; run → pass.
3. **Dashboard Red**: add `deriveGridDown` unit tests (true for 2/3, false for 0/1/4/5/6/unknown/undefined);
   add `buildDeviceGroups` test that `gridDown` reflects `grid_status_code` per device and is
   false when offline; add an `EnergyFlowDiagram` component test for the red stroke + "Grid Down"
   text. Run → fail (symbol not implemented).
4. **Dashboard Green**: add `gridDown` to `DeviceCardMetrics`, wire the fetch + derivation in
   `CurrentReadings.tsx`, render the red Grid symbol + label in `EnergyFlowDiagram.tsx`.
   Run → pass; `npm run typecheck` clean; coverage 100%.

## Manual end-to-end verification (live data, per Steve's standard)

> Automated tests use synthetic data only. Manual verification uses the live local stack.

1. Start the live-data local stack:
   ```bash
   cd local && docker compose -f docker-compose.prod-local.yml up -d
   ```
2. Confirm the exporter is writing the metric:
   ```bash
   # via API
   curl -s "$API/readings/current?metric=grid_status_code" | jq
   ```
   Expect one entry per battery device with a `value` in `0..6`.
3. **Grid-up sanity**: with the grid up, values should be `0/1/4` and the Current diagram Grid
   symbols render normally (no red, no label).
4. **Grid-down simulation** (do NOT delete real data — UPDATE only): to see the indicator,
   temporarily set a battery device's latest `grid_status_code` to `3` and reload:
   ```sql
   -- illustrative; use a fresh row/timestamp, never DELETE real readings
   INSERT INTO readings(device_id, metric_name, timestamp, value)
   VALUES ('epcube1_battery', 'grid_status_code', now(), 3);
   ```
5. **Visual QA in Chrome (Playwright)**: open the Current view, screenshot, and confirm as if
   you were Steve:
   - The affected system's **Grid symbol is red**.
   - **"Grid Down"** appears directly beneath that system's Grid symbol.
   - Other systems show **no** indicator (US2 attribution).
   - No console errors / network failures.
6. **Recovery**: insert a fresh `grid_status_code = 1` reading; on next refresh the indicator
   clears.

## Acceptance mapping

| Spec | Verified by |
|------|-------------|
| FR-001/002/003 | Exporter tests (tuple + code semantics + `{2,3}` rule) |
| FR-004 | Contract: `grid_status_code` on `/readings/current` |
| FR-005 | `EnergyFlowDiagram` component test (red symbol + "Grid Down" label) |
| FR-006 / US2 | `buildDeviceGroups` per-device attribution test + manual multi-system check |
| FR-008 | Exporter omission test + offline-group zeroing test |
| FR-007 | No timestamp rendered; guardrail noted (America/New_York if ever added) |
| FR-009 | `npm run test:coverage` 100%; exporter/API suites green |
| FR-010 | PR closes #181 |
