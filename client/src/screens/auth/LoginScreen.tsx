import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore, LocalPosSession } from '../../store/session.store'
import { AuthUser, DEFAULT_SERVER_URL } from '@baraka/shared'

// Fixed server — end users never see or type an address. Dev override:
// VITE_SERVER_URL (e.g. http://localhost:3001).
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

export interface LoginScreenProps {
  /**
   * 'pos' (default): offline-capable restore from cached user/store, then
   * routes to /pos or /session/open and caches the login for offline restore.
   * 'office': restores via auth.me over the network and routes to /backoffice.
   */
  variant?: 'pos' | 'office'
}

export default function LoginScreen({ variant = 'pos' }: LoginScreenProps) {
  const isOffice = variant === 'office'
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { setAuth, isAuthenticated } = useAuthStore()
  const { setSession } = useSessionStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // Only the POS variant blocks the form behind the restore spinner — the
  // office variant shows the form immediately while it restores in background.
  const [restoring, setRestoring] = useState(!isOffice)
  const [error, setError] = useState('')

  // Pin settings.server_url to the fixed URL — overwrites any stale address
  // (e.g. an old localhost) saved by a previous build so sync targets it.
  async function pinServerUrl() {
    try {
      await window.electronAPI.db.exec(
        `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at)
         VALUES ((SELECT COALESCE(MAX(store_id),1) FROM settings), 'server_url', ?, ?)`,
        [SERVER_URL, new Date().toISOString()]
      )
    } catch { /* fresh DB — login will write it */ }
  }

  useEffect(() => {
    if (isAuthenticated) {
      if (isOffice) navigate('/backoffice', { replace: true })
      else checkAndNavigate()
    } else {
      if (isOffice) restoreOfficeSession()
      else restorePosSession()
    }
  }, [])

  async function restorePosSession() {
    try {
      await pinServerUrl()
      // Read cached user + store from SQLite — works even when server is offline
      const rows = await window.electronAPI.db.query(
        `SELECT meta_key, meta_value FROM settings WHERE meta_key IN ('cached_user','cached_store')`,
        []
      ) as Array<{ meta_key: string; meta_value: string }>

      const map: Record<string, string> = {}
      rows.forEach((r) => { map[r.meta_key] = r.meta_value })

      const token = await window.electronAPI.auth.getToken()
      if (!token) { setRestoring(false); return }

      if (!map.cached_user || !map.cached_store) { setRestoring(false); return }

      const user = JSON.parse(map.cached_user)
      const store = JSON.parse(map.cached_store)

      setAuth(user, token, store)
      await checkAndNavigate()
    } catch {
      setRestoring(false)
    }
  }

  async function restoreOfficeSession() {
    await pinServerUrl()
    const token = await window.electronAPI.auth.getToken()
    if (!token) return
    try {
      const result = await window.electronAPI.auth.me(SERVER_URL, token)
      if (result.status === 200) {
        const data = result.data as { user: AuthUser; store: { id: number; name: string; address?: string; phone?: string; salePrefix: string } }
        setAuth(data.user, token, data.store)
        navigate('/backoffice', { replace: true })
      }
    } catch { /* Token expired or server offline */ }
  }

  async function checkAndNavigate() {
    try {
      const session = await window.electronAPI.session.current()
      if (session) {
        setSession(session as LocalPosSession)
        navigate('/pos')
      } else {
        navigate('/session/open')
      }
    } catch {
      setRestoring(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await window.electronAPI.auth.login(SERVER_URL, username, password)
      if (result.status !== 200) {
        const msg = (result.data as Record<string, string>)?.error || t('auth.loginFailed')
        throw new Error(msg)
      }
      const data = result.data as {
        token: string
        syncApiKey?: string
        user: AuthUser
        store: { id: number; name: string; address?: string; phone?: string; salePrefix: string }
      }

      await window.electronAPI.auth.saveToken(data.token)
      setAuth(data.user, data.token, data.store)

      // Persist everything needed for offline restore
      const now = new Date().toISOString()
      const sid = data.store.id
      const upsert = (key: string, val: string) =>
        window.electronAPI.db.exec(
          `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (?, ?, ?, ?)`,
          [sid, key, val, now]
        )

      await upsert('server_url', SERVER_URL)
      await upsert('store_id', String(sid))
      if (!isOffice) {
        await upsert('cached_user', JSON.stringify(data.user))
        await upsert('cached_store', JSON.stringify(data.store))
      }
      if (data.syncApiKey) await upsert('sync_api_key', data.syncApiKey)

      // Register this terminal for sync v2 before entering the app — the sync
      // hooks fire immediately on auth and need the device credentials.
      // (First registration needs a manager/admin token; no-op afterwards.)
      try {
        const reg = await window.electronAPI.sync.ensureDevice(data.token)
        if (!reg.registered && reg.error) console.warn('Device registration pending:', reg.error)
      } catch { /* offline or non-manager — sync will surface it */ }

      if (isOffice) navigate('/backoffice', { replace: true })
      else await checkAndNavigate()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.loginFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Show spinner while auto-restoring — avoids flash of login form
  if (restoring) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl font-bold text-primary mb-6">BarakaPOS</div>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl font-bold text-primary mb-2">BarakaPOS</div>
          <div className="text-dark-border text-sm">
            {isOffice ? t('auth.backOfficeManagement') : t('auth.posSubtitle')}
          </div>
        </div>

        <div className="bg-dark-surface rounded-2xl p-8 shadow-2xl border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-6">{t('auth.signIn')}</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('auth.username')}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                className="w-full bg-dark-card border border-dark-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('auth.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-dark-card border border-dark-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-400 rounded-lg px-4 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 text-xs text-dark-border">
          {isOffice
            ? 'BarakaPOS Office v1.0.0 — © 2026 Baraka Mini Market'
            : 'BarakaPOS v1.0.0 — © 2026 Baraka Mini Market'}
        </div>
      </div>
    </div>
  )
}
