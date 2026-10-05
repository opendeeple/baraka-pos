import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MonitorSmartphone, RefreshCw } from 'lucide-react'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { useAuthStore } from '../../store/auth.store'

// Fixed server (dev override: VITE_SERVER_URL), same as the reports screen.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

interface Device {
  id: number
  name: string
  platform: string
  lastSeenAt: string | null
  revokedAt: string | null
  createdAt: string
}

const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

/**
 * Every till and office registered with the server. A lost or replaced one is
 * switched off here: its key stops working at once, so it can neither read
 * the shop's data nor send anything into it.
 */
export function DevicesPanel({ className }: { className: string }) {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const [devices, setDevices] = useState<Device[]>([])
  const [thisDevice, setThisDevice] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await window.electronAPI.reports.fetch(`${SERVER_URL}/api/devices`, token) as { devices: Device[] }
      setDevices(res.devices ?? [])
      const [row] = await window.electronAPI.db.query(
        `SELECT meta_value FROM settings WHERE meta_key='device_id' LIMIT 1`, []
      ) as Array<{ meta_value: string }>
      setThisDevice(row ? Number(row.meta_value) : null)
    } catch {
      toast.error(t('reports.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => { load() }, [load])

  async function revoke(id: number) {
    if (!token) return
    try {
      await window.electronAPI.reports.post(`${SERVER_URL}/api/devices/${id}/revoke`, token, {})
      toast.success(t('devices.revoked'))
      setConfirmId(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm flex items-center gap-2">
          <MonitorSmartphone size={15} /> {t('devices.title')}
        </h2>
        <button onClick={load} disabled={loading} className="text-gray-400 hover:text-white p-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="text-xs text-gray-500">{t('devices.hint')}</p>
      <div className="divide-y divide-dark-border border border-dark-border rounded-lg">
        {devices.length === 0 && <p className="text-sm text-gray-500 px-3 py-3">{loading ? '…' : t('devices.empty')}</p>}
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${d.revokedAt ? 'text-gray-500 line-through' : 'text-white'}`}>
                {d.name} <span className="text-xs text-gray-500 font-normal">· {t(`devices.platform_${d.platform.replace('-', '_')}`, { defaultValue: d.platform })}</span>
                {d.id === thisDevice && <span className="ml-2 text-xs text-primary font-normal">{t('devices.thisOne')}</span>}
              </p>
              <p className="text-xs text-gray-500">
                {d.revokedAt
                  ? `${t('devices.revokedAt')}: ${fmtWhen(d.revokedAt)}`
                  : `${t('devices.lastSeen')}: ${fmtWhen(d.lastSeenAt)}`}
              </p>
            </div>
            {!d.revokedAt && d.id !== thisDevice && (
              confirmId === d.id ? (
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => setConfirmId(null)} className="px-3 py-1.5 rounded-lg text-xs border border-dark-border text-gray-300">
                    {t('common.cancel')}
                  </button>
                  <button onClick={() => revoke(d.id)} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 border border-red-500/40 text-red-300">
                    {t('devices.confirmRevoke')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(d.id)} className="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-dark-border text-gray-300 hover:text-red-300">
                  {t('devices.revoke')}
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
