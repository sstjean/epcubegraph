import type { Device } from '../types';

/** Extract the base alias (e.g. "EP Cube v2") from a device's alias or id. */
export function getGroupName(device: Device): string {
  if (device.alias) {
    return device.alias.replace(/\s*(Battery|Solar)$/i, '').trim();
  }
  const base = device.device.replace(/_(battery|solar)$/, '');
  const match = base.match(/^epcube(\d+)$/i);
  return match ? `EP Cube ${match[1]}` : base;
}

/** Group devices by base alias into a Map of name → devices. */
export function groupDevicesByAlias(devices: Device[]): Map<string, Device[]> {
  const groupMap = new Map<string, Device[]>();
  for (const device of devices) {
    const name = getGroupName(device);
    const existing = groupMap.get(name) ?? [];
    existing.push(device);
    groupMap.set(name, existing);
  }
  return groupMap;
}

const DEV_TYPE_LABELS: Record<string, string> = {
  '0': 'EP Cube v1',
  '2': 'EP Cube v2',
};

/**
 * Derive a user-facing display name for a device group.
 * Parses product_code (e.g., "EP Cube (devType=0)") to map to "EP Cube v1" / "EP Cube v2".
 * Falls back to getGroupName when product_code is unavailable or unrecognized.
 */
export function getDisplayName(devices: Device[]): string {
  for (const device of devices) {
    if (device.product_code) {
      const match = device.product_code.match(/devType=(\d+)/);
      if (match && DEV_TYPE_LABELS[match[1]]) {
        return DEV_TYPE_LABELS[match[1]];
      }
    }
  }
  return getGroupName(devices[0]);
}
