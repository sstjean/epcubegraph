// API response types — consumed from Feature 001 REST API
// See specs/002-web-dashboard/data-model.md

export interface Device {
  device: string;
  class: string;
  manufacturer?: string;
  product_code?: string;
  uid?: string;
  online: boolean;
  alias?: string;
}

export interface DeviceListResponse {
  devices: Device[];
}

export interface Reading {
  device_id: string;
  timestamp: number;
  value: number;
}

export interface CurrentReadingsResponse {
  metric: string;
  readings: Reading[];
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface TimeSeries {
  device_id: string;
  values: TimeSeriesPoint[];
}

export interface RangeReadingsResponse {
  metric: string;
  series: TimeSeries[];
}

// Client-side types

export type TimeRange = 'today' | '7d' | '30d' | '1y' | 'custom';

export interface TimeRangeValue {
  start: number;
  end: number;
  step: number;
}

// Settings types — Feature 006

export interface SettingEntry {
  key: string;
  value: string;
  last_modified: string;
}

export interface SettingsResponse {
  settings: SettingEntry[];
}

export interface PanelHierarchyEntry {
  id: number;
  parent_device_gid: number;
  child_device_gid: number;
}

export interface PanelHierarchyResponse {
  entries: PanelHierarchyEntry[];
}

export interface DisplayNameOverride {
  id: number;
  device_gid: number;
  channel_number: string | null;
  display_name: string;
}

export interface DisplayNamesResponse {
  overrides: DisplayNameOverride[];
}