/**
 * ErrorBoundary - Catches React rendering errors to prevent full page crashes
 * 
 * Used to wrap components that may fail due to malformed data (e.g., chat messages).
 */

import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Check if custom fallback is provided
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function' 
          ? this.props.fallback(this.state.error)
          : this.props.fallback;
      }

      // Default fallback UI
      return (
        <div style={{
          padding: '20px',
          margin: '10px',
          border: '1px solid #ff4444',
          borderRadius: '4px',
          backgroundColor: '#2a1a1a',
          color: '#ff6666'
        }}>
          <h3>⚠️ Something went wrong</h3>
          <p>This component encountered an error and couldn't render.</p>
          {this.props.showError && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer' }}>Error details</summary>
              <pre style={{ 
                marginTop: '10px', 
                padding: '10px', 
                backgroundColor: '#1a1a1a',
                overflow: 'auto',
                fontSize: '12px'
              }}>
                {this.state.error?.toString()}
              </pre>
            </details>
          )}
          {this.props.onReset && (
            <button 
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset?.();
              }}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                backgroundColor: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Try again
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
