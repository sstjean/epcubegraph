import { h } from 'preact';
import Router from 'preact-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CurrentReadings } from './components/CurrentReadings';
import { HistoryView } from './components/HistoryView';

export function App() {
  return (
    <ErrorBoundary>
      <nav>
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
