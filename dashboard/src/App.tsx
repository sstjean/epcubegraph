import { h } from 'preact';
import Router from 'preact-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CurrentReadings } from './components/CurrentReadings';
import { HistoryView } from './components/HistoryView';

export function App() {
  return (
    <ErrorBoundary>
      <nav>
        <span class="nav-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          EP Cube
        </span>
        <a href="/">Current</a>
        <a href="/history">History</a>
      </nav>
      <Router>
        <CurrentReadings path="/" />
        <HistoryView path="/history" />
      </Router>
    </ErrorBoundary>
  );
}
