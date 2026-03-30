import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { EnergyFlowDiagram } from '../../src/components/EnergyFlowDiagram';
import type { DeviceGroup } from '../../src/components/CurrentReadings';

function makeGroup(overrides: Partial<DeviceGroup['metrics']> = {}, name = 'EP Cube v2', online = true): DeviceGroup {
  return {
    name,
    online,
    devices: [],
    metrics: {
      solarWatts: 3500,
      batteryWatts: 1200,
      batteryPercent: 72,
      batteryStoredKwh: 7.2,
      gridWatts: 500,
      homeLoadWatts: 2800,
      ...overrides,
    },
  };
}

describe('EnergyFlowDiagram', () => {
  afterEach(cleanup);

  it('renders one article per device group', () => {
    const groups = [makeGroup({}, 'System 1'), makeGroup({}, 'System 2')];
    render(<EnergyFlowDiagram groups={groups} />);

    const articles = screen.getAllByRole('article');
    expect(articles.length).toBe(2);
  });

  it('renders device name and online badge', () => {
    render(<EnergyFlowDiagram groups={[makeGroup()]} />);

    expect(screen.getByText('EP Cube v2')).toBeTruthy();
    expect(screen.getByLabelText('Online')).toBeTruthy();
  });

  it('renders offline badge when device is offline', () => {
    render(<EnergyFlowDiagram groups={[makeGroup({}, 'Offline System', false)]} />);

    expect(screen.getByLabelText('Offline')).toBeTruthy();
  });

  it('renders aria-label on article with device name', () => {
    render(<EnergyFlowDiagram groups={[makeGroup()]} />);

    const article = screen.getByRole('article');
    expect(article.getAttribute('aria-label')).toContain('EP Cube v2');
  });

  it('shows Solar, Grid, Home, EP Cube node labels', () => {
    const { container } = render(<EnergyFlowDiagram groups={[makeGroup()]} />);

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Solar');
    expect(texts).toContain('Grid');
    expect(texts).toContain('Home');
    expect(texts).toContain('EP Cube');
  });

  it('shows battery SOC percentage and stored kWh', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryPercent: 66, batteryStoredKwh: 6.6 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts.some((t) => t?.includes('66.0%'))).toBe(true);
    expect(texts.some((t) => t?.includes('6.600 kWh'))).toBe(true);
  });

  // Flow line activation
  it('activates solar flow line when solar > threshold', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ solarWatts: 3000 })]} />
    );

    const flowLines = container.querySelectorAll('.flow-line');
    expect(flowLines.length).toBeGreaterThanOrEqual(1);
  });

  it('deactivates all flow lines when all values are near zero', () => {
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup({ solarWatts: 0, batteryWatts: 0, gridWatts: 0, homeLoadWatts: 0 })]}
      />
    );

    const flowLines = container.querySelectorAll('.flow-line');
    expect(flowLines.length).toBe(0);
  });

  // Grid direction
  it('shows "importing" when grid watts is positive', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ gridWatts: 1500 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('importing');
  });

  it('shows "exporting" when grid watts is negative', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ gridWatts: -2000 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('exporting');
  });

  it('shows "idle" label when grid watts is zero', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ gridWatts: 0 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('idle');
    expect(texts).not.toContain('importing');
    expect(texts).not.toContain('exporting');
  });

  // Battery direction
  it('shows "charging" label when battery watts is positive', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryWatts: 2000 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('charging');
  });

  it('shows "discharging" label when battery watts is negative', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryWatts: -1500 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('discharging');
  });

  it('shows "idle" label when battery watts is below threshold', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryWatts: 0 })]} />
    );

    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('idle');
    expect(texts).not.toContain('charging');
    expect(texts).not.toContain('discharging');
  });

  // Flow line power labels
  it('displays watt values on active flow lines', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ solarWatts: 3500, homeLoadWatts: 2800 })]} />
    );

    const labels = container.querySelectorAll('.flow-line-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    // All labels should be in kW format
    expect(labelTexts.every((t) => t?.includes('kW'))).toBe(true);
  });

  // SOC ring rendering
  it('renders SOC arc when battery percent > 0', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryPercent: 50 })]} />
    );

    const gaugeArcs = container.querySelectorAll('.gauge-arc');
    expect(gaugeArcs.length).toBe(1);
  });

  it('renders no SOC arc when battery percent is 0', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryPercent: 0 })]} />
    );

    const gaugeArcs = container.querySelectorAll('.gauge-arc');
    expect(gaugeArcs.length).toBe(0);
  });

  // SVG structure
  it('renders SVG with correct viewBox', () => {
    const { container } = render(<EnergyFlowDiagram groups={[makeGroup()]} />);

    const svg = container.querySelector('.energy-flow-svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 380 380');
  });

  it('renders SVG with aria-hidden for accessibility', () => {
    const { container } = render(<EnergyFlowDiagram groups={[makeGroup()]} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  // FlowLine reverse direction
  it('applies flow-reverse class when grid is exporting (reverse)', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ gridWatts: -3000 })]} />
    );

    const reverseLines = container.querySelectorAll('.flow-reverse');
    expect(reverseLines.length).toBeGreaterThanOrEqual(1);
  });

  it('applies flow-reverse class when battery is discharging (reverse)', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryWatts: -2000 })]} />
    );

    const reverseLines = container.querySelectorAll('.flow-reverse');
    expect(reverseLines.length).toBeGreaterThanOrEqual(1);
  });

  it('does not apply flow-reverse for solar (always forward)', () => {
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup({ solarWatts: 5000, gridWatts: 0, batteryWatts: 0, homeLoadWatts: 0 })]}
      />
    );

    const reverseLines = container.querySelectorAll('.flow-reverse');
    expect(reverseLines.length).toBe(0);
  });

  // Empty groups
  it('renders nothing when groups array is empty', () => {
    const { container } = render(<EnergyFlowDiagram groups={[]} />);

    const articles = container.querySelectorAll('article');
    expect(articles.length).toBe(0);
  });

  // Battery clamped SOC
  it('clamps battery SOC to 100% max', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryPercent: 120 })]} />
    );

    // Should render without error, arc clamped
    const gaugeArcs = container.querySelectorAll('.gauge-arc');
    expect(gaugeArcs.length).toBe(1);
  });

  it('clamps battery SOC to 0% min', () => {
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup({ batteryPercent: -5 })]} />
    );

    // No SOC arc when clamped to 0
    const gaugeArcs = container.querySelectorAll('.gauge-arc');
    expect(gaugeArcs.length).toBe(0);
  });

  it('uses inactive gray color (#4b5563) on all lines and icons when values are zero', () => {
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup({ solarWatts: 0, gridWatts: 0, batteryWatts: 0, homeLoadWatts: 0 })]}
      />
    );

    // All four flow lines should use the inactive gray stroke
    const lines = container.querySelectorAll('line[stroke]');
    const grayLines = Array.from(lines).filter((l) => l.getAttribute('stroke') === '#4b5563');
    expect(grayLines.length).toBe(4);

    // Node icons (solar, grid, battery, home SVGs) should also use gray stroke
    const svgs = Array.from(container.querySelectorAll('svg svg'));
    const grayIcons = svgs.filter((s) => s.getAttribute('stroke') === '#4b5563');
    // Solar, Grid, Battery, Home icons = 4
    expect(grayIcons.length).toBe(4);
  });

  it('uses active colors on lines and icons when values are above threshold', () => {
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup({ solarWatts: 3000, gridWatts: 1500, batteryWatts: 500, homeLoadWatts: 2000 })]}
      />
    );

    // No line or icon should use gray
    const lines = container.querySelectorAll('line[stroke]');
    const grayLines = Array.from(lines).filter((l) => l.getAttribute('stroke') === '#4b5563');
    expect(grayLines.length).toBe(0);

    const svgs = Array.from(container.querySelectorAll('svg svg'));
    const grayIcons = svgs.filter((s) => s.getAttribute('stroke') === '#4b5563');
    expect(grayIcons.length).toBe(0);
  });
});
