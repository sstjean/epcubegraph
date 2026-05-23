# Feature 066 — Custom Range: Calendar Picker Discoverability

**Status:** Draft
**Issue:** #66
**Branch:** `066-calendar-picker-affordance`
**Related (split out):** #149 — Bug: 1y view x-axis shows day-of-month labels

## Summary

The Custom range Start/End date inputs in `TimeRangeSelector` (History page)
expose only the browser's native calendar glyph as the affordance for opening
the date picker. Against the dark theme this glyph is nearly invisible. Users
don't realize a calendar picker is available.

The "1d" preset's day picker already solves this by overlaying a transparent
native date input on top of a visible "Mar 22, 2026" pill. Clicking the pill
opens the picker. This feature ports that pattern to the Custom range.

## Goals

- Make the calendar picker obviously available for the Custom range.
- Preserve the existing native `<input type="date">` for accessibility,
  locale-awareness, and zero new dependencies.
- No behavior changes beyond affordance.

## Non-goals

- No new presets, no preset removal, no calendar-aware preset semantics.
- No chart-type adaptation (line vs. bar) changes.
- No API contract changes.
- No new dependencies (no react-day-picker, etc.).

## UX

Each of Start date and End date renders as:

  [📅  May 22, 2026]   ← visible pill, full hit-target, hover state
       (transparent <input type="date"> overlay)

- Calendar icon (left), formatted date label (e.g., "May 22, 2026"), padded
  pill body, dashed underline or border to signal "interactive".
- Clicking anywhere on the pill opens the native calendar (overlay input
  receives the click).
- Existing validation (start < end, ignore invalid) unchanged.

## Implementation notes

- `TimeRangeSelector.tsx`: refactor the Custom branch to render Start/End as
  pill+overlay using the same pattern as `.day-picker-label` / `.day-picker-input`.
- `app.css`: introduce a shared `.date-pill` class for the pill (reuse across
  day-picker and custom-range); add a `.date-pill-icon` for the calendar glyph.
- Existing tests:
  - `getByLabelText(/start/i)` and `getByLabelText(/end/i)` queries must still
    resolve to the underlying date input (achieved by keeping `aria-label` on
    the input). All existing assertions pass unchanged.
- New tests:
  - Custom range shows a visible date pill for Start and End (text matches the
    formatted date).
  - Each pill contains a calendar icon (queryable by role/test-id).
  - Clicking the pill's container does not break the existing onChange path
    (input value-change still emits as before).

## Acceptance criteria

1. Custom range Start displays a visible "📅 <formatted date>" pill.
2. Custom range End displays a visible "📅 <formatted date>" pill.
3. Native calendar picker opens when the pill area is clicked.
4. All existing `TimeRangeSelector` tests pass without modification.
5. New regression tests cover pill markup + icon presence.
6. Dashboard coverage remains 100% lines/branches/statements/functions.

## Files touched

- `dashboard/src/components/TimeRangeSelector.tsx`
- `dashboard/src/app.css`
- `dashboard/tests/component/TimeRangeSelector.test.tsx`

## Out of scope / deferred

- Calendar-aware presets (1d/7d/1m/1y snapping to calendar boundaries, with
  prev/next navigation on all presets).
- Year-view x-axis labels showing day-of-month instead of month — tracked
  separately in #149.
- Adaptive chart types by range duration (multi-bar by day/week/month/year).
