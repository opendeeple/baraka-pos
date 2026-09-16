import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings, RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore } from '../../store/session.store'
import { SyncStatusBadge } from './SyncStatusBadge'

interface Props {
  /** Manually push+pull data from the server. Omit to hide the refresh button. */
  onRefresh?: () => Promise<void> | void
}

export default function TopBar({ onRefresh }: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  const { session } = useSessionStore()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefreshClick() {
    if (!onRefresh || refreshing) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const sessionTime = session
    ? new Date(session.opened_at ?? Date.now()).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })
    : '--:--'

  return (
    <div className="h-16 bg-dark-surface border-b border-dark-border flex items-center px-4 gap-3 shrink-0">
      {/* Store */}
      <div className="flex items-center gap-2 mr-1 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
          <span className="text-primary font-bold text-base">B</span>
        </div>
        <span className="text-white font-semibold text-sm whitespace-nowrap">{store?.name ?? 'BarakaPOS'}</span>
      </div>

      <div className="flex-1" />

      {/* Session time */}
      <div className="text-xs text-gray-500 whitespace-nowrap shrink-0">
        {t('pos.sessionSince')} <span className="text-gray-300 font-medium">{sessionTime}</span>
      </div>

      {/* Manual refresh */}
      {onRefresh && (
        <button
          onClick={handleRefreshClick}
          disabled={refreshing}
          title={t('pos.refreshFromServer')}
          className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-card rounded-xl transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      )}

      {/* Sync */}
      <SyncStatusBadge />

      {/* Settings */}
      <button
        onClick={() => navigate('/pos/settings')}
        title={t('posSettings.title')}
        className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-card rounded-xl transition-colors shrink-0"
      >
        <Settings size={18} />
      </button>

      {/* Cashier avatar + name */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-9 h-9 rounded-full bg-dark-card border border-dark-border flex items-center justify-center">
          <span className="text-gray-300 text-sm font-semibold">{user?.name?.charAt(0) ?? '?'}</span>
        </div>
        <span className="text-sm text-gray-300 whitespace-nowrap font-medium">{user?.name}</span>
      </div>
    </div>
  )
}
