import { h } from 'preact';

export interface GaugeDialProps {
  /** Current value */
  value: number;
  /** Minimum value for the gauge arc (default 0) */
  min?: number;
  /** Maximum value for the gauge arc */
  max: number;
  /** Label shown below the value */
  label: string;
  /** Formatted display string for the value */
  displayValue: string;
  /** Optional secondary display string (smaller, below main value) */
  secondaryValue?: string;
  /** Unit label (e.g. "kW", "%") */
  unit: string;
  /** Arc fill color */
  color: string;
  /** Diameter in pixels (default 140) */
  size?: number;
}

const STROKE_WIDTH = 10;
const START_ANGLE = 135;
const END_ANGLE = 405;
const ARC_SPAN = END_ANGLE - START_ANGLE; // 270°

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function GaugeDial({
  value,
  min = 0,
  max,
  label,
  displayValue,
  secondaryValue,
  unit,
  color,
  size = 140,
}: GaugeDialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - STROKE_WIDTH) / 2;

  const range = max - min;
  const isBidirectional = min < 0;

  let fgArc = '';
  let valueNow: number;

  if (isBidirectional && range > 0) {
    // Bidirectional: arc fills from zero-point toward the value
    const zeroRatio = Math.min(Math.max((0 - min) / range, 0), 1);
    const zeroAngle = START_ANGLE + ARC_SPAN * zeroRatio;
    const valueRatio = Math.min(Math.max((value - min) / range, 0), 1);
    const valueAngle = START_ANGLE + ARC_SPAN * valueRatio;
    valueNow = value;

    if (value < 0) {
      fgArc = valueAngle < zeroAngle ? describeArc(cx, cy, r, valueAngle, zeroAngle) : '';
    } else if (value > 0) {
      fgArc = valueAngle > zeroAngle ? describeArc(cx, cy, r, zeroAngle, valueAngle) : '';
    }
  } else {
    // Unidirectional: arc fills from start
    const ratio = range > 0 ? Math.min(Math.max(Math.abs(value) / max, 0), 1) : 0;
    const valueAngle = START_ANGLE + ARC_SPAN * ratio;
    fgArc = ratio > 0 ? describeArc(cx, cy, r, START_ANGLE, valueAngle) : '';
    valueNow = Math.abs(value);
  }

  const bgArc = describeArc(cx, cy, r, START_ANGLE, END_ANGLE);

  // Zero tick mark for bidirectional gauges
  let zeroTick: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (isBidirectional && range > 0) {
    const zeroRatio = (0 - min) / range;
    const zeroAngle = START_ANGLE + ARC_SPAN * zeroRatio;
    const inner = polarToCartesian(cx, cy, r - STROKE_WIDTH * 0.8, zeroAngle);
    const outer = polarToCartesian(cx, cy, r + STROKE_WIDTH * 0.8, zeroAngle);
    zeroTick = { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
  }

  return (
    <div
      class="gauge-dial"
      aria-label={`${label}: ${displayValue}${secondaryValue ? ` ${secondaryValue}` : ''} ${unit}`}
      role="meter"
      aria-valuenow={valueNow}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Background arc (track) */}
        <path
          d={bgArc}
          fill="none"
          stroke="var(--gauge-track, #2d3748)"
          stroke-width={STROKE_WIDTH}
          stroke-linecap="round"
        />
        {/* Foreground arc (value) */}
        {fgArc && (
          <path
            d={fgArc}
            fill="none"
            stroke={color}
            stroke-width={STROKE_WIDTH}
            stroke-linecap="round"
            class="gauge-arc"
          />
        )}
        {/* Zero tick for bidirectional gauges */}
        {zeroTick && (
          <line
            x1={zeroTick.x1}
            y1={zeroTick.y1}
            x2={zeroTick.x2}
            y2={zeroTick.y2}
            stroke="var(--text-secondary, #94a3b8)"
            stroke-width={2}
            stroke-linecap="round"
          />
        )}
        {/* Value text */}
        <text
          x={cx}
          y={secondaryValue ? cy - size * 0.06 : cy - 4}
          text-anchor="middle"
          dominant-baseline="middle"
          font-size={size * 0.16}
          font-weight="bold"
          fill="var(--text-primary, #e2e8f0)"
        >
          {displayValue}
        </text>
        {/* Secondary value text (replaces unit when present) */}
        {secondaryValue ? (
          <text
            x={cx}
            y={cy + size * 0.12}
            text-anchor="middle"
            dominant-baseline="middle"
            font-size={size * 0.1}
            fill="var(--text-secondary, #94a3b8)"
          >
            {secondaryValue}
          </text>
        ) : (
          <text
            x={cx}
            y={cy + size * 0.12}
            text-anchor="middle"
            dominant-baseline="middle"
            font-size={size * 0.1}
            fill="var(--text-secondary, #94a3b8)"
          >
            {unit}
          </text>
        )}
      </svg>
      <span class="gauge-label">{label}</span>
    </div>
  );
}
