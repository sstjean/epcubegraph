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

// Vue types — Feature 007

export interface VueCurrentChannel {
  channel_num: string;
  display_name: string;
  value: number;
}

export interface VueDeviceCurrentReadings {
  device_gid: number;
  timestamp: number;
  channels: VueCurrentChannel[];
}

export interface VueBulkCurrentReadingsResponse {
  devices: VueDeviceCurrentReadings[];
}

export interface VueDailyChannel {
  channel_num: string;
  display_name: string;
  kwh: number;
}

export interface VueDeviceDailyReadings {
  device_gid: number;
  channels: VueDailyChannel[];
}

export interface VueBulkDailyReadingsResponse {
  date: string;
  devices: VueDeviceDailyReadings[];
}

export interface VuePanelMapping {
  gid: number;
  alias: string;
  prefix: string;
}

export type VueDeviceMapping = Record<string, VuePanelMapping[]>;