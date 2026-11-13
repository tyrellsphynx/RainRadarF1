import { Component, type ErrorInfo, type ReactNode } from 'react'
import { navigate } from './useHashRoute'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render errors below it (lazy pages included) so a crash never
 * leaves a white screen: the shell survives and offers a way out.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('RainRadarF1 page crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="error-box" role="alert">
          <p>Something went wrong rendering this page.</p>
          <p className="muted">{this.state.error.message}</p>
          <div className="error-actions">
            <button className="btn" onClick={() => window.location.reload()}>
              Reload the app
            </button>
            <button
              className="btn"
              onClick={() => {
                this.setState({ error: null })
                navigate('#/')
              }}
            >
              Back to the home page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
