import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings, RefreshCw, LogOut, WifiOff } from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore } from '../../store/session.store'
import { useShiftStore, endShiftAndSignOut } from '../../store/shift.store'
import { Modal, Button } from '../ui'
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
  const shift = useShiftStore((s) => s.shift)
  const shiftOffline = useShiftStore((s) => s.offline)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmEndShift, setConfirmEndShift] = useState(false)
  const [endingShift, setEndingShift] = useState(false)

  async function handleEndShift() {
    setEndingShift(true)
    try {
      await endShiftAndSignOut()
      navigate('/login', { replace: true })
    } finally {
      setEndingShift(false)
    }
  }

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

      {/* Badge shift: when it started + hand the terminal over */}
      {shift && (
        <>
          <div className="text-xs text-gray-500 whitespace-nowrap shrink-0 flex items-center gap-1.5">
            {t('shift.since', {
              time: new Date(shift.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })}
            {shiftOffline && (
              <span title={t('shift.offlineHint')} className="flex items-center gap-1 text-amber-400">
                <WifiOff size={12} />
                {t('shift.offline')}
              </span>
            )}
          </div>
          <button
            onClick={() => setConfirmEndShift(true)}
            title={t('shift.end')}
            className="h-9 px-3 flex items-center gap-1.5 text-sm text-gray-400 hover:text-white hover:bg-dark-card border border-dark-border rounded-xl transition-colors shrink-0"
          >
            <LogOut size={15} />
            {t('shift.end')}
          </button>
        </>
      )}

      <Modal
        open={confirmEndShift}
        onClose={() => setConfirmEndShift(false)}
        title={t('shift.endConfirmTitle')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmEndShift(false)}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" icon={LogOut} loading={endingShift} onClick={handleEndShift}>
              {t('shift.end')}
            </Button>
          </>
        }
      >
        <p className="p-5 text-sm text-gray-400">{t('shift.endConfirmBody', { name: user?.name ?? '' })}</p>
      </Modal>
    </div>
  )
}
