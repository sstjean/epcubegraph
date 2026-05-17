import { useState, useEffect } from 'preact/hooks';
import { fetchSettings, updateSetting } from '../../api';
import { errorMessage } from '../../utils/errors';

const POLL_SETTINGS = [
  { key: 'epcube_poll_interval_seconds', label: 'EP Cube Polling Interval', default: '30' },
  { key: 'vue_poll_interval_seconds', label: 'Emporia Vue Current Polling', default: '1' },
  { key: 'vue_daily_poll_interval_seconds', label: 'Emporia Vue Daily Polling', default: '300' },
] as const;

export function validatePollingValue(val: string): string | null {
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
  if (n < 1) return 'Minimum is 1 second';
  if (n > 3600) return 'Maximum is 3600 seconds';
  return null;
}

type Message = { type: 'success' | 'error'; text: string } | null;

export function PollingIntervalsSection() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

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
        for (const ps of POLL_SETTINGS) {
          if (!(ps.key in vals)) vals[ps.key] = ps.default;
        }
        setValues(vals);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Failed to load settings'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setMessage(null);
  }

  async function handleSave() {
    setMessage(null);
    setError(null);
    for (const ps of POLL_SETTINGS) {
      const err = validatePollingValue(values[ps.key] ?? ps.default);
      if (err) {
        setMessage({ type: 'error', text: `${ps.label}: ${err}` });
        return;
      }
    }
    setSaving(true);
    try {
      for (const ps of POLL_SETTINGS) {
        await updateSetting(ps.key, values[ps.key] ?? ps.default);
      }
      setMessage({ type: 'success', text: 'Polling intervals saved' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Failed to save') });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div class="settings-section" aria-busy="true"><h3>Polling Intervals</h3><p>Loading...</p></div>;

  return (
    <div class="settings-section">
      <h3>Polling Intervals</h3>
      {error && <p role="alert" class="settings-error">{error}</p>}
      <div class="settings-fields">
        {POLL_SETTINGS.map((ps) => (
          <div class="settings-field" key={ps.key}>
            <label for={ps.key}>{ps.label} (seconds)</label>
            <input
              id={ps.key}
              type="number"
              min="1"
              max="3600"
              value={values[ps.key] ?? ps.default}
              onInput={(e) => handleChange(ps.key, (e.target as HTMLInputElement).value)}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        class="settings-save"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving...' : 'Save Polling Intervals'}
      </button>
      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} class={message.type === 'error' ? 'settings-error' : 'settings-success'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
