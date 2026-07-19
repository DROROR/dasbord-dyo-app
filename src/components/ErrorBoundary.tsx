import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  onReset?: () => void
}
interface State {
  error: Error | null
}

// Catches render/runtime errors in the page below it so one broken screen
// shows a recoverable message instead of white-screening the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaces the real cause in the console for debugging.
    console.error('App error caught by ErrorBoundary:', error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.error) {
      const message = String(this.state.error?.message || this.state.error)
      return (
        <div className="p-8 flex items-start justify-center">
          <div className="max-w-lg w-full bg-surface rounded-2xl border border-red-200 shadow-sm p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="text-red-600" size={22} />
            </div>
            <h2 className="text-base font-semibold text-gray-800 mb-1">משהו השתבש בעמוד הזה</h2>
            <p className="text-sm text-gray-500 mb-4">
              אפשר לחזור ולנסות שוב. אם זה חוזר, שלחו את הטקסט האדום למטה כדי שנתקן.
            </p>
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
            >
              <RotateCcw size={14} />
              נסה שוב
            </button>
            <pre
              dir="ltr"
              className="mt-4 text-left text-xs text-red-700 bg-red-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap"
            >
              {message}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
