import { Component, ComponentChildren } from 'preact';
import { trackException } from '../telemetry';

interface ErrorBoundaryProps {
  children: ComponentChildren;
  isApiReachable?: boolean;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  componentDidCatch(error: Error) {
    this.setState({ hasError: true, error });
    trackException(error);
  }

  render() {
    const { isApiReachable, onRetry, children } = this.props;

    return (
      <div>
        {isApiReachable === false && (
          <div role="alert" style={{ background: '#fef2f2', color: '#dc2626', padding: '0.75rem', borderRadius: '0.25rem', marginBottom: '1rem' }}>
            API unreachable — check your connection and try again.
          </div>
        )}
        {this.state.hasError ? (
          <div>
            <p>Something went wrong.</p>
            <button type="button" onClick={() => { this.setState({ hasError: false, error: null }); onRetry?.(); }}>
              Retry
            </button>
          </div>
        ) : (
          children
        )}
      </div>
    );
  }
}
