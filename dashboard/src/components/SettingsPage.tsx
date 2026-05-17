import { useState } from 'preact/hooks';
import { DeviceMerge } from './DeviceMerge';
import { PollingIntervalsSection } from './settings/PollingIntervalsSection';
import { VueDeviceMappingSection } from './settings/VueDeviceMappingSection';
import { PanelHierarchySection } from './settings/PanelHierarchySection';
import { RemovedDevicesSection } from './settings/RemovedDevicesSection';

export type SettingsTab = 'polling' | 'mapping' | 'hierarchy' | 'merge' | 'removed';

const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'polling', label: 'Polling' },
  { id: 'mapping', label: 'Vue Mapping' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'merge', label: 'Merge' },
  { id: 'removed', label: 'Removed' },
] as const;

export function SettingsPage({ initialTab }: { initialTab?: SettingsTab } = {}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (initialTab) return initialTab;
    const stored = localStorage.getItem('settingsActiveTab');
    return stored && SETTINGS_TABS.some((t) => t.id === stored) ? (stored as SettingsTab) : 'polling';
  });

  function handleTabChange(tab: SettingsTab) {
    setActiveTab(tab);
    localStorage.setItem('settingsActiveTab', tab);
  }

  return (
    <section aria-label="Settings">
      <h2>Settings</h2>
      <div class="settings-layout">
        <nav class="settings-tabs" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`settings-tabpanel-${t.id}`}
              tabIndex={activeTab === t.id ? 0 : -1}
              class={`settings-tab${activeTab === t.id ? ' settings-tab--active' : ''}`}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div
          class="settings-content"
          role="tabpanel"
          id={`settings-tabpanel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {activeTab === 'polling' && <PollingIntervalsSection />}
          {activeTab === 'mapping' && <VueDeviceMappingSection />}
          {activeTab === 'hierarchy' && <PanelHierarchySection />}
          {activeTab === 'merge' && <DeviceMerge />}
          {activeTab === 'removed' && <RemovedDevicesSection />}
        </div>
      </div>
    </section>
  );
}
