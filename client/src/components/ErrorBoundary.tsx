import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, FileText } from 'lucide-react'
import i18n from '../i18n'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    // Log to main process
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="h-screen bg-dark flex items-center justify-center p-6">
          <div className="bg-dark-surface border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/15 mb-4">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
            <h2 className="text-white text-xl font-bold mb-2">{i18n.t('common.somethingWentWrong')}</h2>
            <p className="text-gray-400 text-sm mb-6">
              {i18n.t('common.unexpectedErrorHint')}
            </p>
            {this.state.error && (
              <div className="bg-dark-card border border-dark-border rounded-lg p-3 mb-6 text-left">
                <p className="text-red-400 text-xs font-mono break-all">{this.state.error.message}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => window.electronAPI?.app?.openLogs?.()}
                className="flex-1 flex items-center justify-center gap-2 border border-dark-border text-gray-400 hover:text-white rounded-xl py-3 text-sm transition-colors"
              >
                <FileText size={15} />
                {i18n.t('common.viewLogs')}
              </button>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null })
                  window.electronAPI?.app?.reload?.()
                }}
                className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-orange-600 text-white rounded-xl py-3 text-sm font-medium transition-colors"
              >
                <RefreshCw size={15} />
                {i18n.t('common.reloadApp')}
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
