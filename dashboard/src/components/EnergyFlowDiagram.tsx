import { formatKw, formatPercent, formatKwh } from '../utils/formatting';
import type { DeviceGroup } from './CurrentReadings';

export interface EnergyFlowDiagramProps {
  groups: DeviceGroup[];
}

const WIDTH = 380;
const HEIGHT = 380;

// Node positions: Solar top, Grid left, Battery right, Gateway center, Home bottom
const SOLAR   = { x: 190, y: 40 };
const GRID    = { x: 40,  y: 185 };
const BATTERY = { x: 340, y: 185 };
const GATEWAY = { x: 190, y: 185 };
const HOME    = { x: 190, y: 340 };

const THRESHOLD = 10; // watts — below this, line is inactive

/** Animated flow line with power label and directional dot. */
function FlowLine({
  x1, y1, x2, y2, watts, active, reverse, color, id,
}: {
  x1: number; y1: number; x2: number; y2: number;
  watts: number; active: boolean; reverse: boolean; color: string; id: string;
}) {
  const opacity = active ? 1 : 0.3;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Offset label perpendicular to line to avoid overlapping the line
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const offsetX = (-dy / len) * 14;
  const offsetY = (dx / len) * 14;

  return (
    <g opacity={opacity}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} stroke-width={2} stroke-dasharray="6 4"
        class={active ? (reverse ? 'flow-line flow-reverse' : 'flow-line') : ''}
      />
      {active && (
        <circle r={4} fill={color} class="flow-dot">
          <animateMotion
            dur="1.5s" repeatCount="indefinite"
            keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear"
          >
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      )}
      <path id={id} d={`M${x1},${y1} L${x2},${y2}`} fill="none" stroke="none" />
      {active && (
        <text
          x={mx + offsetX} y={my + offsetY}
          text-anchor="middle" dominant-baseline="middle"
          class="flow-line-label"
        >
          {formatKw(watts)}
        </text>
      )}
    </g>
  );
}

/** SOC arc for battery node. */
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  const s = { x: cx + r * Math.cos(toRad(endDeg)), y: cy + r * Math.sin(toRad(endDeg)) };
  const e = { x: cx + r * Math.cos(toRad(startDeg)), y: cy + r * Math.sin(toRad(startDeg)) };
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/** Single-system flow diagram rendered inside a device card. */
function SystemFlowDiagram({ group, index }: { group: DeviceGroup; index: number }) {
  const m = group.metrics;
  const prefix = `flow-${index}`;

  const solarActive = Math.abs(m.solarWatts) > THRESHOLD;
  const gridActive = Math.abs(m.gridWatts) > THRESHOLD;
  const gridImporting = m.gridWatts > 0;
  const batteryActive = Math.abs(m.batteryWatts) > THRESHOLD;
  const batteryCharging = m.batteryWatts > 0;
  const homeActive = m.homeLoadWatts > THRESHOLD;

  // Battery SOC ring
  const socFraction = Math.min(Math.max(m.batteryPercent / 100, 0), 1);
  const SOC_GAP = 30;
  const SOC_START = 90 + SOC_GAP / 2;
  const SOC_SPAN = 360 - SOC_GAP;
  const socEnd = SOC_START + SOC_SPAN * socFraction;
  const RING_R = 30;
  const RING_STROKE = 6;
  const bgArc = describeArc(BATTERY.x, BATTERY.y, RING_R, SOC_START, SOC_START + SOC_SPAN);
  const fgArc = socFraction > 0 ? describeArc(BATTERY.x, BATTERY.y, RING_R, SOC_START, socEnd) : '';

  return (
    <article class="device-card" aria-label={`Energy flow for ${group.name}`}>
      <header class="device-card-header">
        <h3>{group.name}</h3>
        <span
          aria-label={group.online ? 'Online' : 'Offline'}
          class={`badge ${group.online ? 'badge-online' : 'badge-offline'}`}
        >
          {group.online ? 'Online' : 'Offline'}
        </span>
      </header>
      <div class="energy-flow-diagram">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-hidden="true"
          class="energy-flow-svg"
        >
          {/* --- Flow lines --- */}
          {/* Solar → Gateway */}
          <FlowLine
            x1={SOLAR.x} y1={SOLAR.y + 18}
            x2={GATEWAY.x} y2={GATEWAY.y - 28}
            watts={Math.abs(m.solarWatts)} active={solarActive} reverse={false}
            color={solarActive ? '#facc15' : '#4b5563'}
            id={`${prefix}-solar`}
          />
          {/* Grid ↔ Gateway */}
          <FlowLine
            x1={GRID.x + 20} y1={GRID.y}
            x2={GATEWAY.x - 28} y2={GATEWAY.y}
            watts={Math.abs(m.gridWatts)} active={gridActive}
            reverse={!gridImporting}
            color={gridActive ? (gridImporting ? '#ef4444' : '#10b981') : '#4b5563'}
            id={`${prefix}-grid`}
          />
          {/* Gateway ↔ Battery */}
          <FlowLine
            x1={GATEWAY.x + 28} y1={GATEWAY.y}
            x2={BATTERY.x - RING_R - 4} y2={BATTERY.y}
            watts={Math.abs(m.batteryWatts)} active={batteryActive}
            reverse={!batteryCharging}
            color={batteryActive ? (batteryCharging ? '#22c55e' : '#ef4444') : '#4b5563'}
            id={`${prefix}-battery`}
          />
          {/* Gateway → Home */}
          <FlowLine
            x1={GATEWAY.x} y1={GATEWAY.y + 28}
            x2={HOME.x} y2={HOME.y - 22}
            watts={Math.abs(m.homeLoadWatts)} active={homeActive} reverse={false}
            color={homeActive ? '#a855f7' : '#4b5563'} id={`${prefix}-home`}
          />

          {/* --- Solar node (top) --- */}
          <g class="flow-node">
            <g transform={`translate(${SOLAR.x - 14}, ${SOLAR.y - 14})`}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={solarActive ? '#facc15' : '#4b5563'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            </g>
            <text x={SOLAR.x} y={SOLAR.y - 20} text-anchor="middle" class="flow-node-label">Solar</text>
          </g>

          {/* --- Grid node (left) --- */}
          <g class="flow-node">
            <g transform={`translate(${GRID.x - 14}, ${GRID.y - 14})`}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={gridActive ? (gridImporting ? '#ef4444' : '#10b981') : '#4b5563'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
              </svg>
            </g>
            <text x={GRID.x} y={GRID.y + 30} text-anchor="middle" class="flow-node-label">Grid</text>
            <text x={GRID.x} y={GRID.y + 44} text-anchor="middle" class="flow-node-sublabel">
              {m.gridWatts >= 0 ? 'importing' : 'exporting'}
            </text>
          </g>

          {/* --- Gateway node (center) --- */}
          <g class="flow-node">
            <rect
              x={GATEWAY.x - 26} y={GATEWAY.y - 26}
              width={52} height={52} rx={12}
              fill="var(--bg-card-hover, #253348)"
              stroke="var(--accent, #38bdf8)" stroke-width={2}
            />
            <g transform={`translate(${GATEWAY.x - 12}, ${GATEWAY.y - 12})`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #38bdf8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </g>
            <text x={GATEWAY.x} y={GATEWAY.y - 32} text-anchor="middle" class="flow-gateway-label">
              EP Cube
            </text>
          </g>

          {/* --- Battery node (right) with SOC ring --- */}
          <g class="flow-node">
            <path d={bgArc} fill="none" stroke="var(--gauge-track, #334155)" stroke-width={RING_STROKE} stroke-linecap="round" />
            {fgArc && (
              <path d={fgArc} fill="none" stroke="#22c55e" stroke-width={RING_STROKE} stroke-linecap="round" class="gauge-arc" />
            )}
            {/* Battery icon inside ring */}
            <g transform={`translate(${BATTERY.x - 10}, ${BATTERY.y - 12})`}>
              <svg width="20" height="24" viewBox="0 0 24 24" fill="none" stroke={batteryActive ? (batteryCharging ? '#22c55e' : '#3b82f6') : '#4b5563'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="4" width="12" height="18" rx="2" />
                <line x1="10" y1="1" x2="14" y2="1" />
                {batteryCharging ? (
                  <path d="M13 10l-2 3h3l-2 3" />
                ) : (
                  <path d="M10 13h4" />
                )}
              </svg>
            </g>
            <text x={BATTERY.x} y={BATTERY.y + RING_R + 16} text-anchor="middle" class="flow-node-value">
              {formatPercent(m.batteryPercent)}
            </text>
            <text x={BATTERY.x} y={BATTERY.y + RING_R + 30} text-anchor="middle" class="flow-node-sublabel">
              {formatKwh(m.batteryStoredKwh)}
            </text>
            <text x={BATTERY.x} y={BATTERY.y + RING_R + 44} text-anchor="middle" class="flow-node-sublabel">
              {batteryActive ? (batteryCharging ? 'charging' : 'discharging') : 'idle'}
            </text>
          </g>

          {/* --- Home node (bottom) --- */}
          <g class="flow-node">
            <g transform={`translate(${HOME.x - 14}, ${HOME.y - 14})`}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={homeActive ? '#a855f7' : '#4b5563'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </g>
            <text x={HOME.x} y={HOME.y + 22} text-anchor="middle" class="flow-node-label">Home</text>
          </g>
        </svg>
      </div>
    </article>
  );
}

export function EnergyFlowDiagram({ groups }: EnergyFlowDiagramProps) {
  return (
    <div class="device-cards">
      {groups.map((group, i) => (
        <SystemFlowDiagram key={group.name} group={group} index={i} />
      ))}
    </div>
  );
}
