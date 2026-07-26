import { Component } from 'react';

/**
 * Catches render-time errors so a single broken page cannot blank the whole
 * app. Offline shop users have no console to inspect, so the fallback offers a
 * plain recovery path instead of a white screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the details in the console for anyone who can open devtools.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const t = this.props.t || ((s) => s);

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <h2>{t('Something went wrong')}</h2>
          <p>{t('The page could not be displayed. Your saved data is safe.')}</p>
          <pre className="error-boundary-detail">{String(error?.message || error)}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="btn btn-primary" onClick={this.handleReset}>
              {t('Try Again')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleReload}>
              {t('Reload App')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
