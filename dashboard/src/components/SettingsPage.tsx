import { useState, useEffect } from 'preact/hooks';
import { fetchSettings, updateSetting } from '../api';

const POLL_SETTINGS = [
  { key: 'epcube_poll_interval_seconds', label: 'EP Cube Polling Interval', default: '30', disabled: false },
  { key: 'vue_poll_interval_seconds', label: 'Emporia Vue Polling Interval', default: '1', disabled: true },
] as const;

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchSettings();
        if (cancelled) return;
        const vals: Record<string, string> = {};
        for (const s of res.settings) vals[s.key] = s.value;
        // Fill defaults for missing keys
        for (const ps of POLL_SETTINGS) {
          if (!(ps.key in vals)) vals[ps.key] = ps.default;
        }
        setValues(vals);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSuccess(null);
  }

  function validate(val: string): string | null {
    const n = Number(val);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
    if (n < 1) return 'Minimum is 1 second';
    if (n > 3600) return 'Maximum is 3600 seconds';
    return null;
  }

  async function handleSavePolling() {
    setError(null);
    setSuccess(null);

    // Validate all editable fields
    for (const ps of POLL_SETTINGS) {
      if (ps.disabled) continue;
      const err = validate(values[ps.key]);
      if (err) {
        setError(`${ps.label}: ${err}`);
        return;
      }
    }

    setSaving(true);
    try {
      for (const ps of POLL_SETTINGS) {
        if (ps.disabled) continue;
        await updateSetting(ps.key, values[ps.key]);
      }
      setSuccess('Polling intervals saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section aria-busy="true"><h2>Settings</h2><p>Loading...</p></section>;

  return (
    <section aria-label="Settings">
      <h2>Settings</h2>

      {error && <p role="alert" class="settings-error">{error}</p>}
      {success && <p role="status" class="settings-success">{success}</p>}

      <div class="settings-section">
        <h3>Polling Intervals</h3>
        <div class="settings-fields">
          {POLL_SETTINGS.map((ps) => (
            <div class="settings-field" key={ps.key}>
              <label for={ps.key}>
                {ps.label} (seconds)
                {ps.disabled && <span class="settings-coming-soon"> — Coming in Feature 005</span>}
              </label>
              <input
                id={ps.key}
                type="number"
                min="1"
                max="3600"
                value={values[ps.key] ?? ps.default}
                disabled={ps.disabled}
                onInput={(e) => handleChange(ps.key, (e.target as HTMLInputElement).value)}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          class="settings-save"
          onClick={handleSavePolling}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Polling Intervals'}
        </button>
      </div>
    </section>
  );
}
