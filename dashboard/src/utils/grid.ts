/**
 * Pure grid-down rule (feature 181).
 *
 * A system is "grid-down" when its EP Cube `systemStatus` is 2 (Backup) or
 * 3 (Off-Grid). Any other code, a non-integer, or an absent value is grid-up.
 * The `{2, 3}` rule lives here as the single source of truth for the dashboard.
 */
export function deriveGridDown(code: number): boolean {
  return Number.isInteger(code) && (code === 2 || code === 3);
}
