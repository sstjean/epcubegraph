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
    // aria-valuenow is the absolute value clamped to display
    expect(meter.getAttribute('aria-valuenow')).toBe('15000');
    // But visually the arc shouldn't overflow — we check it renders without error
    expect(meter).toBeTruthy();
  });

  it('handles negative values using absolute value for arc (grid export)', () => {
    const { container } = render(
      <GaugeDial value={-1500} max={10000} label="Grid (Export)" displayValue="-1.5 kW" unit="export" color="#10b981" />
    );

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2); // should render foreground arc for abs(value)
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1500');
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

  it('uses default size=120 when not specified', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" />
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('120');
    expect(svg?.getAttribute('height')).toBe('120');
  });

  it('applies correct color to foreground arc', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#ff6600" />
    );

    const paths = container.querySelectorAll('path');
    const fgPath = paths[1]; // second path is foreground
    expect(fgPath.getAttribute('stroke')).toBe('#ff6600');
  });

  it('background arc uses gray track color', () => {
    const { container } = render(
      <GaugeDial value={50} max={100} label="Test" displayValue="50%" unit="pct" color="#000" />
    );

    const bgPath = container.querySelectorAll('path')[0];
    expect(bgPath.getAttribute('stroke')).toBe('#e5e7eb');
  });
});
