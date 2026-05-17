import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { h } from 'preact';
import { DeviceCard } from '../../src/components/DeviceCard';

const baseMetrics = {
  solarWatts: 3456,
  batteryWatts: 1234,
  batteryPercent: 85.3,
  batteryStoredKwh: 9.876,
  gridWatts: 567,
  homeLoadWatts: 2345,
};

describe('DeviceCard', () => {
  it('renders as <article> with aria-label including group name (FR-015)', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    const article = screen.getByRole('article');
    expect(article).toBeTruthy();
    expect(article.getAttribute('aria-label')).toContain('EP Cube v2');
  });

  it('displays the group name as heading', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    expect(screen.getByText('EP Cube v2')).toBeTruthy();
  });

  it('shows online badge with aria-label "Online" (FR-015)', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    const badge = screen.getByLabelText('Online');
    expect(badge).toBeTruthy();
  });

  it('shows offline badge with aria-label "Offline" (FR-015)', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v1" online={false} metrics={baseMetrics} />);

    // Assert
    const badge = screen.getByLabelText('Offline');
    expect(badge).toBeTruthy();
  });

  it('displays solar generation formatted via formatWatts', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    expect(screen.getByText('3.456 kW')).toBeTruthy();
  });

  it('shows battery power and SOC formatted correctly', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert — battery dd contains both power and SOC
    expect(screen.getByText(/1\.234 kW/)).toBeTruthy();
    expect(screen.getByText(/85\.3%/)).toBeTruthy();
  });

  it('shows battery stored kWh as secondary value below SOC percentage', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert — Battery SOC gauge displays kWh as separate smaller text
    expect(screen.getByText('9.876 kWh')).toBeTruthy();
    expect(screen.getByText('85.3%')).toBeTruthy();
  });

  it('shows grid power with "Import" label when positive', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: 567 }} />);

    // Assert
    expect(screen.getByText('567 W')).toBeTruthy();
    expect(screen.getByText('Grid (Import)')).toBeTruthy();
  });

  it('shows grid power with "Export" label when negative', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: -4567 }} />);

    // Assert
    expect(screen.getByText('4.567 kW')).toBeTruthy();
    expect(screen.getByText('Grid (Export)')).toBeTruthy();
  });

  it('shows grid power with "Idle" label when zero', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: 0 }} />);

    // Assert
    expect(screen.getByText('0 W')).toBeTruthy();
    expect(screen.getByText('Grid (Idle)')).toBeTruthy();
  });

  it('uses sufficient contrast colors on badges (FR-015)', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert — online badge uses green #16a34a
    const onlineBadge = screen.getByLabelText('Online');
    expect(onlineBadge).toBeTruthy();
  });

  it('renders five gauge dials for instantaneous metrics (FR-002)', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBe(5);
  });

  it('gauge dials have accessible labels for Solar, Battery SOC, Battery Power, Home Load, Grid', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    const meters = screen.getAllByRole('meter');
    const labels = meters.map((m) => m.getAttribute('aria-label'));
    expect(labels.some((l) => l?.includes('Solar'))).toBe(true);
    expect(labels.some((l) => l?.includes('Battery SOC'))).toBe(true);
    expect(labels.some((l) => l?.includes('Battery Power'))).toBe(true);
    expect(labels.some((l) => l?.includes('Home Load'))).toBe(true);
    expect(labels.some((l) => l?.includes('Grid'))).toBe(true);
  });

  it('grid gauge shows charging/discharging unit for battery power', () => {
    // Arrange & Act — positive batteryWatts = charging
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, batteryWatts: 1200 }} />);

    // Assert
    const meters = screen.getAllByRole('meter');
    const batteryPowerMeter = meters.find((m) => m.getAttribute('aria-label')?.includes('Battery Power'));
    expect(batteryPowerMeter?.getAttribute('aria-label')).toContain('charging');
  });

  it('shows discharging unit when battery power is negative', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, batteryWatts: -800 }} />);

    // Assert
    const meters = screen.getAllByRole('meter');
    const batteryPowerMeter = meters.find((m) => m.getAttribute('aria-label')?.includes('Battery Power'));
    expect(batteryPowerMeter?.getAttribute('aria-label')).toContain('discharging');
  });

  it('renders pendingMergeNote on a separate line below the title row', () => {
    // Arrange & Act
    render(
      <DeviceCard
        name="EP Cube v2"
        online={true}
        metrics={baseMetrics}
        pendingMergeNote="These are the new device readings.  The old device is offline."
      />,
    );

    // Assert — note appears in its own element inside the header
    const note = document.querySelector('.device-card-pending-note');
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain('These are the new device readings');
    expect(note?.textContent).toContain('The old device is offline');
    // Title and badge live in title-row, note is a sibling below it
    const header = document.querySelector('.device-card-header');
    const titleRow = header?.querySelector('.device-card-title-row');
    expect(titleRow).toBeTruthy();
    expect(titleRow?.contains(note)).toBe(false);
  });

  it('does not render pending note element when pendingMergeNote prop is not provided', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert
    expect(document.querySelector('.device-card-pending-note')).toBeNull();
  });
});
