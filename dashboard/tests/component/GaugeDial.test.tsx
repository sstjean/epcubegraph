import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { GaugeDial } from '../../src/components/GaugeDial';

describe('GaugeDial', () => {
  afterEach(cleanup);

  it('renders with role="meter" and correct aria attributes', () => {
    render(
      <GaugeDial value={3500} max={12000} label="Solar" displayValue="3.5 kW" unit="generation" color="#f59e0b" />
    );

    const meter = screen.getByRole('meter');
    expect(meter).toBeTruthy();
    expect(meter.getAttribute('aria-valuenow')).toBe('3500');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('12000');
  });

  it('shows display value and unit text in SVG', () => {
    const { container } = render(
      <GaugeDial value={85} max={100} label="Battery SOC" displayValue="85.0%" unit="charge" color="#22c55e" />
    );

    const texts = container.querySelectorAll('text');
    const textContents = Array.from(texts).map((t) => t.textContent);
    expect(textContents).toContain('85.0%');
    expect(textContents).toContain('charge');
  });

  it('shows label below the SVG', () => {
    render(
      <GaugeDial value={1200} max={5000} label="Battery Power" displayValue="1.2 kW" unit="charging" color="#3b82f6" />
    );

    expect(screen.getByText('Battery Power')).toBeTruthy();
  });

  it('includes label and value in aria-label', () => {
    render(
      <GaugeDial value={500} max={10000} label="Grid (Import)" displayValue="500.0 W" unit="import" color="#ef4444" />
    );

    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-label')).toBe('Grid (Import): 500.0 W import');
  });

  it('renders SVG with background and foreground arcs', () => {
    const { container } = render(
      <GaugeDial value={6000} max={12000} label="Solar" displayValue="6.0 kW" unit="generation" color="#f59e0b" />
    );

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2); // bg arc + fg arc
  });

  it('renders only background arc when value is 0', () => {
    const { container } = render(
      <GaugeDial value={0} max={12000} label="Solar" displayValue="0.0 W" unit="generation" color="#f59e0b" />
    );

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // bg arc only
  });

  it('clamps value at max (ratio never exceeds 1)', () => {
    render(
      <GaugeDial value={15000} max={12000} label="Solar" displayValue="15.0 kW" unit="generation" color="#f59e0b" />
    );

    const meter = screen.getByRole('meter');
    // aria-valuenow is clamped to max
    expect(meter.getAttribute('aria-valuenow')).toBe('12000');
    // But visually the arc shouldn't overflow — we check it renders without error
    expect(meter).toBeTruthy();
  });

  it('handles negative values on unidirectional gauge (clamps to zero fill)', () => {
    const { container } = render(
      <GaugeDial value={-1500} max={10000} label="Grid (Export)" displayValue="-1.5 kW" unit="export" color="#10b981" />
    );

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // bg arc only — negative value is below min=0
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it('handles max=0 gracefully (no division by zero)', () => {
    const { container } = render(
      <GaugeDial value={0} max={0} label="Empty" displayValue="0" unit="" color="#ccc" />
    );

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // bg arc only, ratio=0
  });

  it('respects custom size prop', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" size={200} />
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('200');
  });

  it('uses default size=140 when not specified', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" />
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('140');
    expect(svg?.getAttribute('height')).toBe('140');
  });

  it('applies correct color to foreground arc', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#ff6600" />
    );

    const paths = container.querySelectorAll('path');
    const fgPath = paths[1]; // second path is foreground
    expect(fgPath.getAttribute('stroke')).toBe('#ff6600');
  });

  it('background arc uses dark track color', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" />
    );

    const bgPath = container.querySelectorAll('path')[0];
    // Uses CSS variable; inline fallback is #2d3748
    expect(bgPath.getAttribute('stroke')).toContain('#');
  });

  // Bidirectional gauge tests (min < 0)
  it('supports bidirectional mode with min < 0', () => {
    const { container } = render(
      <GaugeDial value={-3000} min={-5000} max={20000} label="Grid (Export)" displayValue="-3.0 kW" unit="export" color="#10b981" />
    );

    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuemin')).toBe('-5000');
    expect(meter.getAttribute('aria-valuemax')).toBe('20000');
    expect(meter.getAttribute('aria-valuenow')).toBe('-3000');

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2); // bg arc + fg arc
  });

  it('renders zero tick mark for bidirectional gauges', () => {
    const { container } = render(
      <GaugeDial value={5000} min={-5000} max={20000} label="Grid (Import)" displayValue="5.0 kW" unit="import" color="#ef4444" />
    );

    const line = container.querySelector('line');
    expect(line).toBeTruthy();
  });

  it('does not render zero tick for unidirectional gauges', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" />
    );

    const line = container.querySelector('line');
    expect(line).toBeNull();
  });

  it('bidirectional gauge fills from zero toward negative value', () => {
    const { container } = render(
      <GaugeDial value={-2000} min={-5000} max={20000} label="Grid (Export)" displayValue="-2.0 kW" unit="export" color="#10b981" />
    );

    // Should have bg + fg arcs
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });

  it('bidirectional gauge shows no fill arc when value is exactly 0', () => {
    const { container } = render(
      <GaugeDial value={0} min={-5000} max={20000} label="Grid" displayValue="0.0 W" unit="" color="#10b981" />
    );

    // Only background arc, no foreground
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
  });

  it('renders secondary value text when secondaryValue prop is provided', () => {
    // Arrange & Act
    const { container } = render(
      <GaugeDial value={85} max={100} label="Battery SOC" displayValue="85.0%" secondaryValue="9.7 kWh" unit="charge" color="#22c55e" />
    );

    // Assert
    const texts = container.querySelectorAll('text');
    const textContents = Array.from(texts).map((t) => t.textContent);
    expect(textContents).toContain('85.0%');
    expect(textContents).toContain('9.7 kWh');
  });

  it('includes secondaryValue in aria-label when provided', () => {
    // Arrange & Act
    render(
      <GaugeDial value={85} max={100} label="Battery SOC" displayValue="85.0%" secondaryValue="9.7 kWh" unit="charge" color="#22c55e" />
    );

    // Assert
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-label')).toContain('9.7 kWh');
  });

  it('bidirectional gauge with negative value clamped to same angle as zero renders empty fg arc', () => {
    // When both min and max are negative, zero clamps to ratio 1 (end of arc).
    // A negative value also clamps to ratio 1, so valueAngle >= zeroAngle → empty string.
    const { container } = render(
      <GaugeDial value={-10} min={-100} max={-50} label="Grid" displayValue="-10 W" unit="" color="#ef4444" />
    );
    // Only the background arc path should render (no foreground arc)
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
  });

  it('bidirectional gauge with positive value clamped to same angle as zero renders empty fg arc', () => {
    // Same scenario: zero and positive value both clamp to ratio 1 → equal angles.
    const { container } = render(
      <GaugeDial value={10} min={-100} max={-50} label="Grid" displayValue="10 W" unit="" color="#10b981" />
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
  });

  it('bidirectional gauge with range=0 renders only background arc', () => {
    const { container } = render(
      <GaugeDial value={0} min={0} max={0} label="Empty" displayValue="0" unit="" color="#ccc" />
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // bg arc only
  });
});
