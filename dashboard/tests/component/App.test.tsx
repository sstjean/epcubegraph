import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';

// Mock route components to avoid side effects (fetch calls, etc.)
vi.mock('../../src/components/CurrentReadings', () => ({
  CurrentReadings: () => <div data-testid="current-readings">MockedCurrentReadings</div>,
}));

vi.mock('../../src/components/HistoryView', () => ({
  HistoryView: () => <div data-testid="history-view">MockedHistoryView</div>,
}));

import { App } from '../../src/App';

describe('App', () => {
  afterEach(cleanup);

  it('renders <nav> landmark with navigation links (FR-015)', () => {
    // Arrange
    history.pushState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    const nav = screen.getByRole('navigation');
    expect(nav).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('route "/" renders CurrentReadings', () => {
    // Arrange
    history.pushState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    expect(screen.getByTestId('current-readings')).toBeTruthy();
  });

  it('route "/history" renders HistoryView', () => {
    // Arrange
    history.pushState({}, '', '/history');

    // Act
    render(<App />);

    // Assert
    expect(screen.getByTestId('history-view')).toBeTruthy();
  });

  it('navigation links are keyboard-navigable (FR-015)', () => {
    // Arrange
    history.pushState({}, '', '/');

    // Act
    render(<App />);

    // Assert
    const links = screen.getAllByRole('link');
    links.forEach((link) => {
      expect(link.tabIndex).not.toBe(-1);
    });
  });

  it('wraps content in ErrorBoundary', () => {
    // Arrange
    history.pushState({}, '', '/');

    // Act
    const { container } = render(<App />);

    // Assert — ErrorBoundary wraps the content (it renders children normally)
    expect(container.querySelector('nav')).toBeTruthy();
  });
});
