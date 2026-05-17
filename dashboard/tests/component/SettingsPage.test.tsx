import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { h } from 'preact';

// Mock each section to isolate SettingsPage's responsibility: tab navigation.
// Tests here MUST NOT touch fetchSettings, fetchDevices, etc. — those belong to
// the section-level test files.
vi.mock('../../src/components/settings/PollingIntervalsSection', () => ({
  PollingIntervalsSection: () => <div data-testid="section-polling">PollingSection</div>,
}));
vi.mock('../../src/components/settings/VueDeviceMappingSection', () => ({
  VueDeviceMappingSection: () => <div data-testid="section-mapping">MappingSection</div>,
}));
vi.mock('../../src/components/settings/PanelHierarchySection', () => ({
  PanelHierarchySection: () => <div data-testid="section-hierarchy">HierarchySection</div>,
}));
vi.mock('../../src/components/DeviceMerge', () => ({
  DeviceMerge: () => <div data-testid="section-merge">MergeSection</div>,
}));
vi.mock('../../src/components/settings/RemovedDevicesSection', () => ({
  RemovedDevicesSection: () => <div data-testid="section-removed">RemovedSection</div>,
}));

import { SettingsPage } from '../../src/components/SettingsPage';

describe('SettingsPage tab navigation', () => {
  beforeEach(() => {
    localStorage.removeItem('settingsActiveTab');
  });

  it('renders all four tab buttons', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByRole('tab', { name: 'Polling' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Vue Mapping' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hierarchy' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Merge' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Removed' })).toBeTruthy();
  });

  it('renders Polling section by default', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByTestId('section-polling')).toBeTruthy();
    expect(screen.queryByTestId('section-mapping')).toBeNull();
    expect(screen.queryByTestId('section-hierarchy')).toBeNull();
    expect(screen.queryByTestId('section-merge')).toBeNull();
  });

  it('marks the active tab with aria-selected="true" and others with false', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByRole('tab', { name: 'Polling' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Vue Mapping' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Hierarchy' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Merge' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a tab switches the visible section', () => {
    // Arrange
    render(<SettingsPage />);

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Vue Mapping' }));

    // Assert
    expect(screen.getByTestId('section-mapping')).toBeTruthy();
    expect(screen.queryByTestId('section-polling')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Vue Mapping' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Polling' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Hierarchy tab renders only the hierarchy section', () => {
    // Arrange
    render(<SettingsPage />);

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));

    // Assert
    expect(screen.getByTestId('section-hierarchy')).toBeTruthy();
    expect(screen.queryByTestId('section-polling')).toBeNull();
    expect(screen.queryByTestId('section-mapping')).toBeNull();
    expect(screen.queryByTestId('section-merge')).toBeNull();
  });

  it('clicking Merge tab renders only the merge section', () => {
    // Arrange
    render(<SettingsPage />);

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Merge' }));

    // Assert
    expect(screen.getByTestId('section-merge')).toBeTruthy();
    expect(screen.queryByTestId('section-polling')).toBeNull();
  });

  it('clicking Removed tab renders only the removed devices section', () => {
    // Arrange
    render(<SettingsPage />);

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Removed' }));

    // Assert
    expect(screen.getByTestId('section-removed')).toBeTruthy();
    expect(screen.queryByTestId('section-polling')).toBeNull();
    expect(screen.queryByTestId('section-merge')).toBeNull();
  });

  it('persists active tab to localStorage on change', () => {
    // Arrange
    render(<SettingsPage />);

    // Act
    fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));

    // Assert
    expect(localStorage.getItem('settingsActiveTab')).toBe('hierarchy');
  });

  it('restores the active tab from localStorage on mount', () => {
    // Arrange
    localStorage.setItem('settingsActiveTab', 'mapping');

    // Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByTestId('section-mapping')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Vue Mapping' }).getAttribute('aria-selected')).toBe('true');
  });

  it('falls back to Polling when localStorage value is invalid', () => {
    // Arrange
    localStorage.setItem('settingsActiveTab', 'not-a-real-tab');

    // Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByTestId('section-polling')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Polling' }).getAttribute('aria-selected')).toBe('true');
  });

  it('initialTab prop overrides localStorage', () => {
    // Arrange
    localStorage.setItem('settingsActiveTab', 'polling');

    // Act
    render(<SettingsPage initialTab="hierarchy" />);

    // Assert
    expect(screen.getByTestId('section-hierarchy')).toBeTruthy();
  });

  it('uses tablist role with vertical orientation for accessibility', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('active tab has tabIndex=0, inactive tabs have tabIndex=-1 (roving tabindex)', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByRole('tab', { name: 'Polling' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Vue Mapping' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'Hierarchy' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'Merge' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'Removed' }).getAttribute('tabindex')).toBe('-1');
  });

  it('renders Settings heading', () => {
    // Arrange & Act
    render(<SettingsPage />);

    // Assert
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  });
});
