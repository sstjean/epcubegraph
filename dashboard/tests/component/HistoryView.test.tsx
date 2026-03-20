import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { HistoryView } from '../../src/components/HistoryView';

describe('HistoryView', () => {
  afterEach(cleanup);

  it('renders as <section> with heading (FR-015)', () => {
    // Act
    render(<HistoryView />);

    // Assert
    const section = document.querySelector('section');
    expect(section).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
  });
});
