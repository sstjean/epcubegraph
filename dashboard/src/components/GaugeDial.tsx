import { h } from 'preact';

export interface GaugeDialProps {
  /** Current value */
  value: number;
  /** Maximum value for the gauge arc (min is always 0) */
  max: number;
  /** Label shown below the value */
  label: string;
  /** Formatted display string for the value */
  displayValue: string;
  /** Unit label (e.g. "kW", "%") */
  unit: string;
  /** Arc fill color */
  color: string;
  /** Diameter in pixels (default 120) */
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
  max,
  label,
  displayValue,
  unit,
  color,
  size = 120,
}: GaugeDialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - STROKE_WIDTH) / 2;

  // Clamp ratio to [0, 1]
  const ratio = max > 0 ? Math.min(Math.max(Math.abs(value) / max, 0), 1) : 0;
  const valueAngle = START_ANGLE + ARC_SPAN * ratio;

  const bgArc = describeArc(cx, cy, r, START_ANGLE, END_ANGLE);
  const fgArc = ratio > 0 ? describeArc(cx, cy, r, START_ANGLE, valueAngle) : '';

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}
      aria-label={`${label}: ${displayValue} ${unit}`}
      role="meter"
      aria-valuenow={Math.abs(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Background arc (track) */}
        <path
          d={bgArc}
          fill="none"
          stroke="#e5e7eb"
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
          />
        )}
        {/* Value text */}
        <text
          x={cx}
          y={cy - 4}
          text-anchor="middle"
          dominant-baseline="middle"
          font-size={size * 0.17}
          font-weight="bold"
          fill="currentColor"
        >
          {displayValue}
        </text>
        {/* Unit text */}
        <text
          x={cx}
          y={cy + size * 0.13}
          text-anchor="middle"
          dominant-baseline="middle"
          font-size={size * 0.12}
          fill="#6b7280"
        >
          {unit}
        </text>
      </svg>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>{label}</span>
    </div>
  );
}
