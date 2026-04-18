import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchVueBulkCurrentReadings, fetchSettings, fetchHierarchy } from '../api';
import type { VueBulkCurrentReadingsResponse, VueDeviceMapping, PanelHierarchyEntry } from '../types';
import { toTrackedError, errorMessage } from '../utils/errors';

export function isValidVueDeviceMapping(parsed: unknown): parsed is VueDeviceMapping {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) return false;
    if (typeof value !== 'object' || value === null) return false;
    const panel = value as Record<string, unknown>;
    if (typeof panel.gid !== 'number' || !Number.isInteger(panel.gid) || typeof panel.alias !== 'string') return false;
  }
  return true;
}

export interface UseVueDataResult {
  vueCurrentReadings: VueBulkCurrentReadingsResponse | undefined;
  vueDeviceMapping: VueDeviceMapping | undefined;
  vueError: string | null;
  hierarchyEntries: PanelHierarchyEntry[];
}

export function useVueData(): UseVueDataResult {
  const [vueCurrentReadings, setVueCurrentReadings] = useState<VueBulkCurrentReadingsResponse | undefined>();
  const [vueDeviceMapping, setVueDeviceMapping] = useState<VueDeviceMapping | undefined>();
  const [vueError, setVueError] = useState<string | null>(null);
  const [hierarchyEntries, setHierarchyEntries] = useState<PanelHierarchyEntry[]>([]);
  const vuePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vueSettingsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadVueReadings = async () => {
    try {
      const vueReadings = await fetchVueBulkCurrentReadings();
      if (!mountedRef.current) return;
      setVueCurrentReadings(vueReadings);
      setVueError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setVueError(errorMessage(err, 'Vue readings unavailable'));
      toTrackedError(err, 'Vue readings unavailable');
    }
  };

  const loadVueSettings = async () => {
    try {
      const [settingsResp, hierarchyResp] = await Promise.all([
        fetchSettings(),
        fetchHierarchy().catch(() => ({ entries: [] as PanelHierarchyEntry[] })),
      ]);
      if (!mountedRef.current) return;
      setHierarchyEntries(hierarchyResp.entries);

      const mappingSetting = settingsResp.settings.find((s) => s.key === 'vue_device_mapping');
      if (mappingSetting) {
        try {
          const parsed: unknown = JSON.parse(mappingSetting.value);
          if (isValidVueDeviceMapping(parsed)) {
            setVueDeviceMapping(parsed);
          } else {
            setVueDeviceMapping(undefined);
            toTrackedError(new Error('vue_device_mapping uses invalid or legacy array format'), 'Invalid vue_device_mapping format');
          }
        } catch (err) {
          setVueDeviceMapping(undefined);
          toTrackedError(err, 'Invalid vue_device_mapping JSON');
        }
      } else {
        setVueDeviceMapping(undefined);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      toTrackedError(err, 'Vue settings load failed');
    }
  };

  useEffect(() => {
    loadVueReadings();
    vuePollingRef.current = setInterval(loadVueReadings, 1000);
    return () => clearInterval(vuePollingRef.current!);
  }, []);

  useEffect(() => {
    loadVueSettings();
    vueSettingsPollingRef.current = setInterval(loadVueSettings, 60000);
    return () => clearInterval(vueSettingsPollingRef.current!);
  }, []);

  return { vueCurrentReadings, vueDeviceMapping, vueError, hierarchyEntries };
}
