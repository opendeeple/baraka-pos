import { useSyncStore } from '../../store/sync.store'
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'

export function SyncStatusBadge() {
  const { status, pendingCount, lastSyncAt } = useSyncStore()

  const configs = {
    online: { icon: Wifi, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Online' },
    syncing: { icon: RefreshCw, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Syncing' },
    offline: { icon: WifiOff, color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Offline' },
    error: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/10', label: 'Error' },
  }

  const cfg = configs[status]
  const Icon = cfg.icon

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${cfg.bg} cursor-default`}
      title={lastSyncAt ? `Last sync: ${new Date(lastSyncAt).toLocaleTimeString()}` : 'Not synced'}
    >
      <Icon
        size={13}
        className={`${cfg.color} ${status === 'syncing' ? 'animate-spin' : ''}`}
      />
      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
      {pendingCount > 0 && (
        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 rounded-full font-bold">
          {pendingCount}
        </span>
      )}
    </div>
  )
}
