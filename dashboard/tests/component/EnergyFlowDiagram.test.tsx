import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { EnergyFlowDiagram, getCircuitsForGroup } from '../../src/components/EnergyFlowDiagram';
import type { DeviceGroup } from '../../src/components/CurrentReadings';
import type { VueBulkCurrentReadingsResponse, VueDeviceMapping, PanelHierarchyEntry } from '../../src/types';

function makeGroup(overrides: Partial<DeviceGroup['metrics']> = {}, name = 'EP Cube v2', online = true, baseDeviceId = 'epcube5488'): DeviceGroup {
  return {
    name,
    baseDeviceId,
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
    const groups = [makeGroup({}, 'System 1', true, 'system1'), makeGroup({}, 'System 2', true, 'system2')];
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
    render(<EnergyFlowDiagram groups={[makeGroup({}, 'Offline System', false, 'offline1')]} />);

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

  // ── Vue Circuit List Overlay (US1 — Feature 007) ──

  it('renders active circuits sorted by watts on flow card', () => {
    // Arrange
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [
          { channel_num: '1,2,3', display_name: 'Main', value: 8450.5 },
          { channel_num: '4', display_name: 'Kitchen', value: 1200.0 },
          { channel_num: '5', display_name: 'HVAC', value: 3000.0 },
          { channel_num: 'Balance', display_name: 'Unmonitored loads', value: 320.5 },
        ],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Main Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — mains excluded, sorted by watts descending: HVAC (3000) > Kitchen (1200) > Unmonitored loads (320.5)
    const circuitItems = container.querySelectorAll('.circuit-entry');
    expect(circuitItems.length).toBe(3);
    const names = Array.from(circuitItems).map((el) => el.querySelector('.circuit-name')?.textContent);
    expect(names[0]).toBe('HVAC');
    expect(names[1]).toBe('Kitchen');
    expect(names[2]).toBe('Unmonitored loads');
  });

  it('excludes 0W circuits from flow card', () => {
    // Arrange
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [
          { channel_num: '4', display_name: 'Kitchen', value: 0 },
          { channel_num: '5', display_name: 'HVAC', value: 500.0 },
        ],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Main Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — only HVAC shown (Kitchen is 0W)
    const circuitItems = container.querySelectorAll('.circuit-entry');
    expect(circuitItems.length).toBe(1);
    expect(circuitItems[0].querySelector('.circuit-name')?.textContent).toBe('HVAC');
  });

  it('hides circuit area when no active circuits', () => {
    // Arrange
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [
          { channel_num: '4', display_name: 'Kitchen', value: 0 },
        ],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Main Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — no circuit-list container at all
    expect(container.querySelector('.circuit-list')).toBeNull();
  });

  it('handles missing vue_device_mapping gracefully', () => {
    // Arrange
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [{ channel_num: '4', display_name: 'Kitchen', value: 1200.0 }],
      }],
    };

    // Act — no mapping prop
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} />,
    );

    // Assert — no circuits shown
    expect(container.querySelector('.circuit-list')).toBeNull();
  });

  it('renders two-column layout with left filling first', () => {
    // Arrange — 4 circuits
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [
          { channel_num: '4', display_name: 'A', value: 100 },
          { channel_num: '5', display_name: 'B', value: 200 },
          { channel_num: '6', display_name: 'C', value: 300 },
          { channel_num: '7', display_name: 'D', value: 400 },
        ],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — two columns rendered
    const columns = container.querySelectorAll('.circuit-column');
    expect(columns.length).toBe(2);
  });

  it('shows display name override over channel name', () => {
    // Arrange — display_name from API already includes override resolution
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [
          { channel_num: '4', display_name: 'Custom Override Name', value: 500 },
        ],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert
    const name = container.querySelector('.circuit-name');
    expect(name?.textContent).toBe('Custom Override Name');
  });

  it('renders circuits from multiple panels mapped to same EP Cube', () => {
    // Arrange
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [
        {
          device_gid: 480380,
          timestamp: 1712592000,
          channels: [{ channel_num: '4', display_name: 'Kitchen', value: 500 }],
        },
        {
          device_gid: 480544,
          timestamp: 1712592000,
          channels: [{ channel_num: '4', display_name: 'Dryer', value: 3000 }],
        },
      ],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [
        { gid: 480380, alias: 'Main Panel' },
        { gid: 480544, alias: 'Subpanel' },
      ],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — circuits from both panels shown by display_name
    const names = Array.from(container.querySelectorAll('.circuit-name')).map((el) => el.textContent);
    expect(names).toContain('Kitchen');
    expect(names).toContain('Dryer');
  });

  it('handles mapped device GID not in Vue readings', () => {
    // Arrange — mapping references GID 999999 which has no readings
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [{ channel_num: '4', display_name: 'Kitchen', value: 500 }],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [
        { gid: 480380, alias: 'Main Panel' },
        { gid: 999999, alias: 'Missing Panel' },
      ],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram groups={[makeGroup()]} vueCurrentReadings={vueData} vueDeviceMapping={mapping} />,
    );

    // Assert — only Kitchen from 480380 shown (999999 skipped)
    const names = Array.from(container.querySelectorAll('.circuit-name')).map((el) => el.textContent);
    expect(names).toContain('Kitchen');
    expect(names.length).toBe(1);
  });

  it('resolves hierarchy children when filtering circuits for flow card', () => {
    // Arrange — Main Panel (480380) is mapped, Subpanel 1 (480544) is its child
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [
        {
          device_gid: 480380,
          timestamp: 1712592000,
          channels: [{ channel_num: '4', display_name: 'Kitchen', value: 500 }],
        },
        {
          device_gid: 480544,
          timestamp: 1712592000,
          channels: [{ channel_num: '4', display_name: 'Dryer', value: 3000 }],
        },
      ],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Main Panel' }],
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 480380, child_device_gid: 480544 },
    ];

    // Act
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup()]}
        vueCurrentReadings={vueData}
        vueDeviceMapping={mapping}
        hierarchyEntries={hierarchy}
      />,
    );

    // Assert — both parent and child circuits shown
    const names = Array.from(container.querySelectorAll('.circuit-name')).map((el) => el.textContent);
    expect(names).toContain('Kitchen');
    expect(names).toContain('Dryer');
  });

  it('renders display_name directly when single mapped panel has no children', () => {
    // Arrange — single panel, no hierarchy children
    const vueData: VueBulkCurrentReadingsResponse = {
      devices: [{
        device_gid: 480380,
        timestamp: 1712592000,
        channels: [{ channel_num: '4', display_name: 'Kitchen', value: 500 }],
      }],
    };
    const mapping: VueDeviceMapping = {
      epcube5488: [{ gid: 480380, alias: 'Main Panel' }],
    };

    // Act
    const { container } = render(
      <EnergyFlowDiagram
        groups={[makeGroup()]}
        vueCurrentReadings={vueData}
        vueDeviceMapping={mapping}
        hierarchyEntries={[]}
      />,
    );

    // Assert — display_name used directly
    const name = container.querySelector('.circuit-name');
    expect(name?.textContent).toBe('Kitchen');
  });

  it('deduplicates parent Balance by subtracting children mains', () => {
    // Arrange
    const readings: VueBulkCurrentReadingsResponse = {
      devices: [
        {
          device_gid: 111,
          timestamp: 100,
          channels: [
            { channel_num: '1,2,3', display_name: 'Main', value: 2000 },
            { channel_num: '1', display_name: 'Kitchen', value: 500 },
            { channel_num: 'Balance', display_name: 'M: Unmonitored', value: 1000 },
          ],
        },
        {
          device_gid: 222,
          timestamp: 100,
          channels: [
            { channel_num: '1,2,3', display_name: 'Sub Main', value: 600 },
            { channel_num: '1', display_name: 'Office', value: 200 },
          ],
        },
      ],
    };
    const mapping: VueDeviceMapping = {
      epcube1: [{ gid: 111, alias: 'Main Panel' }],
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 111, child_device_gid: 222 },
    ];

    // Act
    const circuits = getCircuitsForGroup('epcube1', readings, mapping, hierarchy);

    // Assert — Balance should be 1000 - 600 = 400W
    const balance = circuits.find((c) => c.display_name.includes('Unmonitored'));
    expect(balance).toBeDefined();
    expect(balance!.value).toBe(400);
  });

  it('hides Balance when deduplication makes it zero or negative', () => {
    // Arrange
    const readings: VueBulkCurrentReadingsResponse = {
      devices: [
        {
          device_gid: 111,
          timestamp: 100,
          channels: [
            { channel_num: 'Balance', display_name: 'M: Unmonitored', value: 500 },
          ],
        },
        {
          device_gid: 222,
          timestamp: 100,
          channels: [
            { channel_num: '1,2,3', display_name: 'Sub Main', value: 600 },
          ],
        },
      ],
    };
    const mapping: VueDeviceMapping = {
      epcube1: [{ gid: 111, alias: 'Main Panel' }],
    };
    const hierarchy: PanelHierarchyEntry[] = [
      { id: 1, parent_device_gid: 111, child_device_gid: 222 },
    ];

    // Act
    const circuits = getCircuitsForGroup('epcube1', readings, mapping, hierarchy);

    // Assert — Balance should not appear
    expect(circuits.find((c) => c.display_name.includes('Unmonitored'))).toBeUndefined();
  });
});
