import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { ScanBarcode, KeyRound } from 'lucide-react'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore, LocalPosSession } from '../../store/session.store'
import { useShiftStore, loadActiveShift, saveActiveShift, clearActiveShift } from '../../store/shift.store'
import { AuthUser, DEFAULT_SERVER_URL } from '@baraka/shared'

// Fixed server — end users never see or type an address. Dev override:
// VITE_SERVER_URL (e.g. http://localhost:3001).
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

type LoginMode = 'password' | 'badge'
const LOGIN_MODE_KEY = 'pos_login_mode'

interface LoginData {
  token: string
  syncApiKey?: string
  user: AuthUser
  store: { id: number; name: string; address?: string; phone?: string; salePrefix: string }
}

interface BadgeError {
  code?: string
  error?: string
  employeeName?: string
  deviceName?: string
  startedAt?: string
}

function badgeErrorMessage(t: TFunction, data: BadgeError | undefined): string {
  switch (data?.code) {
    case 'DEVICE_NOT_REGISTERED': return t('auth.badgeDeviceNotRegistered')
    case 'NETWORK': return t('auth.badgeOffline')
    case 'BADGE_NOT_FOUND': return t('auth.badgeNotFound')
    case 'SHIFT_OPEN_ELSEWHERE':
      return t('auth.badgeShiftOpenElsewhere', {
        name: data.employeeName,
        device: data.deviceName,
        time: data.startedAt ? new Date(data.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      })
  }
  return data?.error || t('auth.loginFailed')
}

function readLoginMode(): LoginMode {
  try { return localStorage.getItem(LOGIN_MODE_KEY) === 'badge' ? 'badge' : 'password' } catch { return 'password' }
}

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
  const setShift = useShiftStore((s) => s.setShift)
  const setShiftOffline = useShiftStore((s) => s.setOffline)
  // Badge sign-in starts an attendance shift on this terminal — POS only.
  const [mode, setMode] = useState<LoginMode>(() => (isOffice ? 'password' : readLoginMode()))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [badgeCode, setBadgeCode] = useState('')
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

      // A badge shift left open by the last run resumes unless the server
      // says it was ended meanwhile (another cashier took over, or a manager
      // ended it). Offline, it simply carries on — selling must keep working.
      const shift = await loadActiveShift()
      if (shift) {
        const hb = await window.electronAPI.shift.heartbeat(shift.id)
        const stillOpen = hb.status === 0 || (hb.status === 200 && (hb.data as { active?: boolean }).active)
        if (!stillOpen) {
          await clearActiveShift()
          await window.electronAPI.auth.clearToken()
          setRestoring(false)
          return
        }
        setShift(shift)
        if (hb.status === 0) setShiftOffline(true)
      }

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

  // Shared by password and badge sign-in once the server has accepted either.
  async function completeLogin(data: LoginData) {
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
      const data = result.data as LoginData
      await completeLogin(data)

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

  // Badge scan: the server checks the one-open-shift-per-cashier rule across
  // terminals, hands this terminal over from whoever was on it, and signs the
  // scanned employee in. Needs this terminal to be registered (an admin's
  // password sign-in did that once) and the server to be reachable.
  async function handleBadgeLogin(e: React.FormEvent) {
    e.preventDefault()
    const code = badgeCode.trim()
    if (!code || loading) return
    setError('')
    setLoading(true)
    try {
      const result = await window.electronAPI.shift.start(code)
      if (result.status !== 200) throw new Error(badgeErrorMessage(t, result.data as BadgeError))
      const data = result.data as LoginData & { shift: { id: number; startedAt: string } }
      await completeLogin(data)
      await saveActiveShift({ id: data.shift.id, startedAt: data.shift.startedAt })
      await checkAndNavigate()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.loginFailed')
      setError(msg)
      toast.error(msg)
      setBadgeCode('') // ready for the next scan
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next: LoginMode) {
    setMode(next)
    setError('')
    try { localStorage.setItem(LOGIN_MODE_KEY, next) } catch { /* per-device nicety only */ }
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

          {!isOffice && (
            <div className="grid grid-cols-2 gap-1 p-1 mb-6 bg-dark-card border border-dark-border rounded-xl">
              {([
                ['password', KeyRound, t('auth.passwordTab')],
                ['badge', ScanBarcode, t('auth.badgeTab')],
              ] as const).map(([m, Icon, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === m ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          )}

          {mode === 'badge' ? (
            <form onSubmit={handleBadgeLogin} className="space-y-4">
              <div className="flex flex-col items-center text-center gap-3 pb-2">
                <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <ScanBarcode size={28} className="text-primary" />
                </div>
                <p className="text-sm text-gray-400">{t('auth.badgeHint')}</p>
              </div>

              {/* Masked: the scanned code is a sign-in credential. */}
              <input
                key="badge"
                type="password"
                inputMode="numeric"
                value={badgeCode}
                onChange={(e) => setBadgeCode(e.target.value)}
                autoFocus
                autoComplete="off"
                readOnly={loading}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-4 py-3 text-white text-center text-lg tracking-widest font-mono focus:outline-none focus:border-primary"
                placeholder={t('auth.badgePlaceholder')}
              />

              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 rounded-lg px-4 py-2 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !badgeCode.trim()}
                className="w-full bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t('auth.badgeChecking') : t('auth.badgeSubmit')}
              </button>
            </form>
          ) : (
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
          )}
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
