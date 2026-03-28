import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

describe('ErrorBoundary', () => {
  afterEach(cleanup);
  it('renders children when no error', () => {
    // Arrange & Act
    render(
      <ErrorBoundary>
        <p>Hello World</p>
      </ErrorBoundary>
    );

    // Assert
    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  it('shows error message and Retry button on catch', () => {
    // Arrange
    const ThrowError = () => {
      throw new Error('Test error');
    };

    // Act
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Assert
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('shows API unreachable banner with role="alert" when isApiReachable=false', () => {
    // Arrange & Act
    render(
      <ErrorBoundary isApiReachable={false}>
        <p>Content</p>
      </ErrorBoundary>
    );

    // Assert
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/api unreachable/i);
  });

  it('does not show alert banner when isApiReachable=true', () => {
    // Arrange & Act
    render(
      <ErrorBoundary isApiReachable={true}>
        <p>Content</p>
      </ErrorBoundary>
    );

    // Assert
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retry button calls onRetry callback and is keyboard-focusable', async () => {
    // Arrange
    const onRetry = vi.fn();
    const ThrowError = () => {
      throw new Error('Test error');
    };

    // Act
    render(
      <ErrorBoundary onRetry={onRetry}>
        <ThrowError />
      </ErrorBoundary>
    );
    const button = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(button);

    // Assert
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(button.tabIndex).not.toBe(-1);
  });
});
