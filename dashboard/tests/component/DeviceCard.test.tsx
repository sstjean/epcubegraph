import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { DeviceCard } from '../../src/components/DeviceCard';

const baseMetrics = {
  solarWatts: 3500,
  batteryWatts: 1200,
  batteryPercent: 85.3,
  batteryStoredKwh: 9.7,
  gridWatts: 500,
  homeLoadWatts: 2800,
};

describe('DeviceCard', () => {
  afterEach(cleanup);
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
    expect(screen.getByText('3.5 kW')).toBeTruthy();
  });

  it('shows battery power and SOC formatted correctly', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert — battery dd contains both power and SOC
    expect(screen.getByText(/1\.2 kW/)).toBeTruthy();
    expect(screen.getByText(/85\.3%/)).toBeTruthy();
  });

  it('shows battery stored kWh as secondary value below SOC percentage', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={baseMetrics} />);

    // Assert — Battery SOC gauge displays kWh as separate smaller text
    expect(screen.getByText('9.7 kWh')).toBeTruthy();
    expect(screen.getByText('85.3%')).toBeTruthy();
  });

  it('shows grid power with "Import" label when positive', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: 500 }} />);

    // Assert
    expect(screen.getByText('500.0 W')).toBeTruthy();
    expect(screen.getByText('Grid (Import)')).toBeTruthy();
  });

  it('shows grid power with "Export" label when negative', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: -1500 }} />);

    // Assert
    expect(screen.getByText('1.5 kW')).toBeTruthy();
    expect(screen.getByText('Grid (Export)')).toBeTruthy();
  });

  it('shows grid power with "Idle" label when zero', () => {
    // Arrange & Act
    render(<DeviceCard name="EP Cube v2" online={true} metrics={{ ...baseMetrics, gridWatts: 0 }} />);

    // Assert
    expect(screen.getByText('0.0 W')).toBeTruthy();
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
});
