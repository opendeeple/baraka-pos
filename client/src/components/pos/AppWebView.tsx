import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw, X } from 'lucide-react'
import { PosApp } from './AppLauncherBar'

interface Props {
  app: PosApp
  visible: boolean
  onClose: () => void
}

export default function AppWebView({ app, visible, onClose }: Props) {
  const [state, setState] = useState({
    canGoBack: false,
    canGoForward: false,
    loading: true,
    title: app.name,
    error: undefined as string | undefined,
  })
  const contentAreaRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  const sendBounds = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const rect = contentAreaRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      window.electronAPI.miniapp.setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    })
  }, [])

  useEffect(() => {
    if (!visible) return
    window.electronAPI.miniapp.open(app.id, app.url)
    sendBounds()
    const ro = new ResizeObserver(sendBounds)
    if (contentAreaRef.current) ro.observe(contentAreaRef.current)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [visible, app.id, app.url, sendBounds])

  useEffect(() => {
    return window.electronAPI.miniapp.onState((s) => {
      if (s.id === app.id) {
        setState((prev) => ({
          canGoBack: s.canGoBack ?? prev.canGoBack,
          canGoForward: s.canGoForward ?? prev.canGoForward,
          loading: s.loading ?? prev.loading,
          title: s.title ?? prev.title,
          error: s.error !== undefined ? s.error : (s.loading === true ? undefined : prev.error),
        }))
      }
    })
  }, [app.id])

  const appIdRef = useRef(app.id)
  useEffect(() => { appIdRef.current = app.id }, [app.id])
  useEffect(() => {
    return () => { window.electronAPI.miniapp.hide(appIdRef.current) }
  }, [])

  if (!visible) return null

  return (
    <div className="absolute inset-0 z-40 pointer-events-none flex flex-col">
      <div className="h-11 bg-dark-surface border-b border-dark-border flex items-center gap-1 px-3 shrink-0 pointer-events-auto">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0"
          style={{ backgroundColor: app.color }}
        >
          {app.name.slice(0, 2).toUpperCase()}
        </div>

        {state.error ? (
          <span className="text-red-400 text-xs ml-1 flex-1 truncate">{state.error}</span>
        ) : (
          <span className="text-white text-sm font-medium ml-1 flex-1 truncate">{state.title}</span>
        )}

        <button
          onClick={() => window.electronAPI.miniapp.navigate('back')}
          disabled={!state.canGoBack}
          className="w-8 h-8 flex items-center justify-center text-gray-400 disabled:text-gray-700 hover:text-white rounded-lg transition-colors"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          onClick={() => window.electronAPI.miniapp.navigate('forward')}
          disabled={!state.canGoForward}
          className="w-8 h-8 flex items-center justify-center text-gray-400 disabled:text-gray-700 hover:text-white rounded-lg transition-colors"
        >
          <ArrowRight size={15} />
        </button>
        <button
          onClick={() => window.electronAPI.miniapp.navigate('reload')}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-lg transition-colors"
        >
          <RotateCw size={14} className={state.loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => {
            window.electronAPI.miniapp.hide(app.id)
            onClose()
          }}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-400 rounded-lg transition-colors ml-1"
        >
          <X size={16} />
        </button>
      </div>

      {/* Placeholder div — its bounding rect tells main process where to place the WebContentsView */}
      <div ref={contentAreaRef} className="flex-1 min-h-0 flex items-center justify-center">
        {state.loading && !state.error && <Loader2 size={32} className="animate-spin text-gray-600" />}
      </div>
    </div>
  )
}
