import type { VueCurrentChannel } from '../types';

const MAINS_CHANNEL = '1,2,3';
const BALANCE_CHANNEL = 'Balance';

export interface CircuitEntry {
  device_gid: number;
  channel_num: string;
  display_name: string;
  value: number;
}

/** Derive a short prefix from a panel alias: first letter + any digits. */
export function derivePanelPrefix(alias: string): string {
  if (!alias) return '';
  const digits = alias.replace(/\D/g, '');
  return alias[0].toUpperCase() + digits;
}

export function filterActiveCircuits(
  channels: VueCurrentChannel[],
): VueCurrentChannel[] {
  return channels.filter(
    (ch) => ch.value > 0 && ch.channel_num !== MAINS_CHANNEL,
  );
}

export function sortByWattsThenName(a: CircuitEntry, b: CircuitEntry): number {
  if (a.value !== b.value) return b.value - a.value;
  return a.display_name.localeCompare(b.display_name);
}

export function sortByCircuitNumber(
  a: VueCurrentChannel,
  b: VueCurrentChannel,
): number {
  const order = (ch: VueCurrentChannel): number => {
    if (ch.channel_num === MAINS_CHANNEL) return 0;
    if (ch.channel_num === BALANCE_CHANNEL) return 2;
    return 1;
  };
  const oa = order(a);
  const ob = order(b);
  if (oa !== ob) return oa - ob;
  const na = parseInt(a.channel_num, 10);
  const nb = parseInt(b.channel_num, 10);
  const aIsNum = !isNaN(na);
  const bIsNum = !isNaN(nb);
  if (aIsNum && bIsNum) return na - nb;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.channel_num.localeCompare(b.channel_num);
}

export interface PanelInfo {
  device_gid: number;
  alias: string;
  parentGid?: number;
}

export interface HierarchyEntry {
  parent_device_gid: number;
  child_device_gid: number;
}

export function orderPanels(
  panels: PanelInfo[],
  hierarchy: HierarchyEntry[],
): PanelInfo[] {
  const panelGids = new Set(panels.map((p) => p.device_gid));
  const safeHierarchy = hierarchy.filter(
    (h) => panelGids.has(h.parent_device_gid) && panelGids.has(h.child_device_gid) && h.parent_device_gid !== h.child_device_gid,
  );

  const childGids = new Set(safeHierarchy.map((h) => h.child_device_gid));
  const childrenOf = new Map<number, PanelInfo[]>();

  for (const h of safeHierarchy) {
    const list = childrenOf.get(h.parent_device_gid) ?? [];
    const panel = panels.find((p) => p.device_gid === h.child_device_gid)!;
    list.push({ ...panel, parentGid: h.parent_device_gid });
    childrenOf.set(h.parent_device_gid, list);
  }

  const topLevel = panels.filter((p) => !childGids.has(p.device_gid));
  const parents = topLevel.filter((p) => childrenOf.has(p.device_gid));
  const standalone = topLevel.filter((p) => !childrenOf.has(p.device_gid));

  const result: PanelInfo[] = [];

  for (const p of standalone.sort((a, b) => a.alias.localeCompare(b.alias))) {
    result.push(p);
  }

  for (const p of parents.sort((a, b) => a.alias.localeCompare(b.alias))) {
    result.push(p);
    const children = childrenOf.get(p.device_gid)!.sort((a, b) =>
      a.alias.localeCompare(b.alias),
    );
    result.push(...children);
  }

  // Fallback: append any panels not yet in result (e.g., from multi-node cycles)
  const seen = new Set(result.map((p) => p.device_gid));
  for (const p of panels.sort((a, b) => a.alias.localeCompare(b.alias))) {
    if (!seen.has(p.device_gid)) result.push(p);
  }

  return result;
}
