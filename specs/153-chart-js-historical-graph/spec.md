# Feature Specification: Chart.js Migration for Historical Graph

**Feature Branch**: `153-chart-js-historical-graph`
**Created**: 2026-05-23
**Status**: Draft
**Input**: User description: "Replace the uPlot charting library in the dashboard's historical graph view with Chart.js + chartjs-adapter-date-fns to fix axis-label tick density on long ranges (the original #149 bug), gain native grouped-bar support, native x-axis padding, and better tick auto-formatting — while preserving all current behavior (line vs grouped bars by step, battery overlay, gap insertion, legend toggling, multi-device stacking, 100% test coverage)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Correct axis labels across all zoom levels (Priority: P1)

As a homeowner viewing the historical graph, when I select any of the built-in range presets (1d, 7d, 30d, 1y) or a Custom range, the time axis below the chart shows labels appropriate to the displayed range — so I can always tell **which day, month, or year** the bars/lines correspond to without zooming in or guessing.

**Why this priority**: This is the original user-visible bug (issue #149). On the 1y zoom today, the axis shows day-of-month numbers across a year of daily bars, which is unreadable. Without this, the long-range views are effectively broken.

**Independent Test**: Load the dashboard with seeded historical data spanning at least 13 months, click each range preset in turn (1d, 7d, 30d, 1y), and visually confirm the axis labels match the table below. Then pick a custom range that spans ~6 weeks and confirm labels are readable (no overlap, no orphan day numbers without month context).

**Acceptance Scenarios**:

1. **Given** the user has selected the **1d** preset, **When** the chart renders, **Then** the x-axis labels show hours (e.g., `09:00`, `12:00`, `15:00`) with the date implicit in the page header.
2. **Given** the user has selected the **7d** preset, **When** the chart renders, **Then** the x-axis labels show short day-of-week + day-of-month (e.g., `Mon 18`, `Tue 19`) or equivalent unambiguous day labels.
3. **Given** the user has selected the **30d** preset, **When** the chart renders, **Then** the x-axis labels show day-of-month with a month abbreviation at least at month boundaries (e.g., `May 1`, `May 8`, `May 15`).
4. **Given** the user has selected the **1y** preset, **When** the chart renders, **Then** the x-axis labels show **month and year** (e.g., `Jun 2025`, `Sep 2025`, `Dec 2025`) — never bare day-of-month numbers.
5. **Given** the user has selected a **Custom** range, **When** the chart renders, **Then** the axis label format is automatically chosen from the appropriate granularity (hours / days / months / years) based on the span, with no label overlap.

---

### User Story 2 — Grouped bar chart for daily and longer buckets (Priority: P1)

As a homeowner comparing my energy sources for each day, when the bucket size is one day or larger (`step >= 86400`), I see three **side-by-side** bars per bucket — Solar production, Home Load, and Grid import/export — so I can compare them at a glance without bars overlapping or hiding each other.

**Why this priority**: Grouped (non-overlapping) bars are the primary reading view for 7d / 30d / 1y / long-Custom ranges. The current uPlot implementation hand-rolls bar offsets and is the main source of complexity and brittleness motivating the migration.

**Independent Test**: Select the 30d preset on a device with seeded Solar, Home Load, and Grid data. Visually confirm three distinct bars per day, none overlapping, each in its series color. Hover any bucket and confirm the tooltip shows all three series values plus the bucket timestamp.

**Acceptance Scenarios**:

1. **Given** the bucket step is `>= 86400` seconds, **When** the chart renders, **Then** Solar, Home Load, and Grid render as three side-by-side bars within each bucket, with visible gaps between buckets.
2. **Given** the bucket step is `< 86400` seconds, **When** the chart renders, **Then** Solar, Home Load, and Grid render as continuous **lines** (not bars).
3. **Given** a bar/line chart is rendered, **When** the user hovers any bucket, **Then** a tooltip shows the bucket timestamp and the value of every visible (non-toggled-off) series.

---

### User Story 3 — Battery % overlay on a secondary axis (Priority: P1)

As a homeowner, when I look at any historical chart, I see Battery state-of-charge (0–100%) rendered as a **line on a right-side secondary y-axis** scaled 0–100, so I can correlate battery behavior with power flows without it being squashed by the watt-scale primary axis.

**Why this priority**: Battery overlay is core to interpreting solar/grid behavior. It must survive the migration unchanged.

**Independent Test**: Open any range with seeded battery data. Confirm the right-side y-axis is labeled 0–100 with `%` ticks, and the battery line stays within that range regardless of how large the watt values are on the left axis.

**Acceptance Scenarios**:

1. **Given** the dataset contains battery percent values, **When** the chart renders, **Then** Battery % appears as a line on a secondary right-side y-axis scaled 0–100 with `%`-suffixed tick labels.
2. **Given** the user toggles Battery off in the legend, **When** the chart re-renders, **Then** the Battery line disappears but the secondary axis behavior of remaining series is unaffected.

---

### User Story 4 — Gap insertion when data is missing (Priority: P2)

As a homeowner, when the exporter was down or the device disconnected, I see a **visible gap** in the chart over the missing period instead of a straight interpolation line that fakes data I never had.

**Why this priority**: Misleading interpolation across outages would erode trust in the dashboard's correctness. The current uPlot implementation already does this; it must be preserved.

**Independent Test**: Seed a dataset with a multi-hour gap, render the chart, and confirm the line/bar visibly breaks across the gap (no straight line connecting points across the missing range).

**Acceptance Scenarios**:

1. **Given** two consecutive data points are separated by more than 2× the bucket step, **When** the chart renders, **Then** the series shows a gap (line break or missing bar) across the interval rather than connecting the surrounding points.

---

### User Story 5 — Legend-driven series toggling (Priority: P2)

As a homeowner, when I click a series name in the chart legend, that series hides (or re-appears) and the chart re-renders without losing my current zoom / range selection.

**Why this priority**: Standard interaction; current behavior must be preserved.

**Independent Test**: Click each legend entry in turn, confirm the series toggles, then confirm the range preset selection is unchanged.

**Acceptance Scenarios**:

1. **Given** all four series (Solar, Home Load, Grid, Battery) are visible, **When** the user clicks any legend entry, **Then** that series is hidden from the chart and tooltips and the legend entry visually indicates the disabled state.
2. **Given** a series is hidden, **When** the user clicks its legend entry again, **Then** it is restored.

---

### User Story 6 — Multiple device charts stacked vertically (Priority: P2)

As a homeowner with more than one EP Cube device, when I open the historical view, I see **one chart per active device**, stacked vertically, each with its own legend and axes — so I can read each device independently.

**Why this priority**: Multi-device users depend on this. Must survive the migration.

**Independent Test**: With two seeded devices, open the historical view and confirm two independent chart blocks render with their respective device names as headings.

**Acceptance Scenarios**:

1. **Given** the active dataset contains *N* devices, **When** the historical view renders, **Then** *N* independent chart blocks render stacked vertically, each scoped to one device's data.
2. **Given** the user changes the range preset, **When** the charts re-render, **Then** all device charts update consistently to the new range.

---

### User Story 7 — Bars don't touch chart edges (Priority: P3)

As a homeowner, the first and last bars of any bar chart have visible padding from the left/right edges of the plot area, so I can see the full bar width and the edge bucket labels aren't clipped.

**Why this priority**: Polish. The current implementation requires manual padding hacks; Chart.js provides this natively.

**Independent Test**: Render a 7d bar chart and visually confirm the leftmost and rightmost bars have horizontal padding from the plot frame.

**Acceptance Scenarios**:

1. **Given** a grouped bar chart is rendered, **When** the chart paints, **Then** the leftmost and rightmost bars do not visually touch the left/right edges of the plot area.

---

### Edge Cases

- **No data for selected range**: Chart area renders empty (or a placeholder message) without throwing — same behavior as today.
- **Single data point in range**: Renders the single point/bar without crashing; axis still labels sensibly.
- **All series toggled off via legend**: Plot area renders empty with axes still drawn; toggling any series back on restores it.
- **Device added / removed mid-session**: Re-rendering with a different device set creates / destroys chart instances cleanly with no orphaned canvases or memory leaks (the existing unmount-cleanup test must still pass).
- **Extremely sparse data** (e.g., one point per week on a 1y range): Axis tick density auto-adjusts; no overlapping labels.
- **Window resize**: Charts resize responsively without distortion or stale dimensions.
- **Custom range crossing a DST boundary**: Time axis labels render in the user's local timezone without duplicated or skipped hour labels around the transition. *(Behavior matches today; documented as preserved.)*

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The historical graph component MUST render line charts when the bucket step is `< 86400` seconds and grouped (side-by-side, non-overlapping) bar charts when the bucket step is `>= 86400` seconds.
- **FR-002**: Solar, Home Load, and Grid MUST share the primary (left) y-axis scaled in watts; Battery % MUST render on a secondary (right) y-axis fixed to a 0–100 scale with `%`-suffixed tick labels.
- **FR-003**: The x-axis MUST auto-format tick labels appropriate to the displayed range: hours for sub-day ranges, day labels for week ranges, day-with-month for month ranges, **month-and-year** for year-scale ranges, and an auto-chosen granularity for Custom ranges.
- **FR-004**: Hovering any bucket MUST display a tooltip listing the bucket timestamp and the value of every series currently enabled in the legend.
- **FR-005**: When the gap between two consecutive data points exceeds 2× the bucket step, the chart MUST render a visible gap rather than connecting/interpolating across the missing interval.
- **FR-006**: The chart MUST reserve horizontal padding inside the plot area so that the first and last bars never touch the left/right plot edges.
- **FR-007**: Clicking a legend entry MUST toggle the corresponding series' visibility in both the plot and tooltips, without altering the selected range preset.
- **FR-008**: When the active dataset contains multiple devices, the component MUST render one independent chart per device, stacked vertically in a stable order.
- **FR-009**: The component MUST destroy underlying chart instances on unmount and on data/range changes that require re-creation, leaving no orphaned canvas elements or retained chart objects.
- **FR-010**: The migration MUST remove the uPlot dependency, its CSS import, and any uPlot-specific styling from the dashboard once the new implementation is in place. (uPlot is used only in `HistoricalGraph.tsx` and the `.uplot` CSS rules in `app.css`.)
- **FR-011**: The chart lifecycle (creation, update, destruction) MUST be managed directly against the Chart.js `Chart` class — no React/Preact wrapper library (e.g., `react-chartjs-2`) may be introduced.
- **FR-012**: Time-axis formatting MUST use a date adapter compatible with Chart.js (`chartjs-adapter-date-fns`) so that auto-formatted ticks honor the user's local timezone.
- **FR-013**: The PR completing this migration MUST close issue #149 (axis-labels bug) and issue #153 (this migration).

### Non-Functional Requirements

- **NFR-001 (Test coverage)**: Line coverage MUST remain at 100% for the dashboard package after the migration (constitution non-negotiable). All existing behaviors covered by `dashboard/tests/component/HistoricalGraph.test.tsx` MUST have equivalent coverage in the migrated test file, including mocked Chart.js lifecycle assertions analogous to the current uPlot mock.
- **NFR-002 (Bundle size audit — no hard budget)**: The dashboard production bundle size delta introduced by replacing `uplot` with `chart.js` + `chartjs-adapter-date-fns` (+ `date-fns` peer) MUST be measured and reported in the PR description. There is **no enforced upper bound**; the migration proceeds regardless of size delta. However, if the measured gzipped delta exceeds **+120 KB**, the PR description MUST additionally summarize the user-facing effects (initial load time on a typical broadband connection, cache impact, mobile cost) so the maintainer can make an informed accept/mitigate decision before merge. Mitigation options (tree-shakable component registration, deferred import, etc.) MAY be applied but are not required by the spec.
- **NFR-003 (Render performance)**: Initial render of a single device chart with up to ~400 buckets (1y of daily data) MUST complete within **200 ms** on a typical developer machine, measured against the seeded local stack at <http://localhost:5173>.
- **NFR-004 (Accessibility)**: Legend entries MUST remain keyboard-activatable (tab focus + Enter/Space) and the canvas MUST carry an `aria-label` summarizing the chart's device and range, matching or exceeding the current implementation's a11y posture.
- **NFR-005 (Visual verification)**: Before merge, all five range presets (1d, 7d, 30d, 1y, Custom) MUST be visually verified against the persistent local production-like stack (`local/docker-compose.prod-local.yml`) at <http://localhost:5173>, with screenshots attached to the PR.
- **NFR-006 (No silent fallback)**: If Chart.js fails to initialize (e.g., context creation error), the failure MUST surface to the user and to telemetry — no empty-canvas silent failure.

### Key Entities

- **Device Chart**: One rendered chart block scoped to a single device. Has a canvas element, a Chart.js `Chart` instance, an associated dataset, and a legend.
- **Series**: One of `Solar`, `Home Load`, `Grid`, `Battery`. Each has a fixed color, an axis assignment (primary watts vs secondary percent), and a render type derived from the bucket step (line vs grouped bar).
- **Bucket**: One time-aligned slot containing one value per series. Buckets are evenly spaced by `step` seconds; gaps > 2× `step` mark missing-data intervals.
- **Range Preset**: A user-selectable named time range — `1d`, `7d`, `30d`, `1y`, or `Custom` — that determines the bucket `step` and therefore the chart type and axis format.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the **1y** range preset, every visible x-axis tick label includes **both a month and a year** (e.g., `Jun 2025`) and **none** are bare day-of-month numbers. (Closes #149.)
- **SC-002**: On the **30d** range preset, every bucket shows three visually distinct, non-overlapping bars for Solar, Home Load, and Grid, with the first and last bars not touching the plot edges.
- **SC-003**: Toggling each legend entry hides/restores its series within one render frame and preserves the currently selected range preset.
- **SC-004**: The `uplot` package and `uplot/dist/uPlot.min.css` import no longer appear in `dashboard/package.json`, `dashboard/src/`, or `dashboard/tests/` after the migration.
- **SC-005**: Dashboard line coverage is **≥ 100%** of currently-covered lines (no regression) as reported by `npm run test:coverage`.
- **SC-006**: Bundle size delta vs. the pre-migration build is **measured and recorded** in the PR description (no pass/fail threshold). If the delta exceeds +120 KB gzipped, the PR description also includes a user-impact summary per NFR-002.
- **SC-007**: All seven user stories' acceptance scenarios pass on the persistent local stack at <http://localhost:5173> with screenshots attached to the PR.
- **SC-008**: Issues #149 and #153 are closed by the merging PR.

## Assumptions

- The migration is purely a presentation-layer change; the API contract (`/api/historical`), bucket shape, and `step` semantics are unchanged.
- `chartjs-adapter-date-fns` (with `date-fns`) is the chosen date adapter — selected over Luxon/Moment because `date-fns` is already lighter and tree-shakable.
- Chart.js is loaded with explicit component registration (e.g., `Chart.register(LineController, BarController, …)`) rather than the auto-registration bundle, to keep bundle impact minimal.
- The 2× step gap-insertion rule is preserved as-is; no requirement change.
- The Preact `useEffect` + `useRef` pattern currently used for the uPlot lifecycle remains the integration pattern for Chart.js, with manual `new Chart(...)` / `chart.destroy()` calls.
- Visual verification uses the existing seeded data in the persistent prod-local stack; no new seed fixtures are required for this spec, though the planning phase may identify some.

## Dependencies

- Issue #153 (this migration) and issue #149 (axis labels bug) are tracked in GitHub; the merging PR closes both.
- Source of truth for the current behavior is `dashboard/src/components/HistoricalGraph.tsx` and `dashboard/tests/component/HistoricalGraph.test.tsx`.
- Motivation and prior-art notes live in `.specify/memory/SESSION_HANDOFF.md`.
- The persistent local stack (`local/docker-compose.prod-local.yml`) must be running for the visual-verification success criterion.
