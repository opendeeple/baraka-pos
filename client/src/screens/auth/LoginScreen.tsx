import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore, LocalPosSession } from '../../store/session.store'
import { AuthUser } from '@baraka/shared'

const DEFAULT_SERVER_URL = 'http://localhost:3001'

export default function LoginScreen() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const { setSession } = useSessionStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL)

  useEffect(() => {
    if (isAuthenticated) {
      checkAndNavigate()
    } else {
      restoreSession()
    }
  }, [])

  async function restoreSession() {
    try {
      // Read cached user + store from SQLite — works even when server is offline
      const rows = await window.electronAPI.db.query(
        `SELECT meta_key, meta_value FROM settings WHERE meta_key IN ('cached_user','cached_store','server_url')`,
        []
      ) as Array<{ meta_key: string; meta_value: string }>

      const map: Record<string, string> = {}
      rows.forEach((r) => { map[r.meta_key] = r.meta_value })

      // The saved server URL belongs to the terminal, not the login — restore
      // it even when there is no cached session to resume.
      if (map.server_url) setServerUrl(map.server_url)

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
      const result = await window.electronAPI.auth.login(serverUrl, username, password)
      if (result.status !== 200) {
        const msg = (result.data as Record<string, string>)?.error || 'Login failed'
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

      await upsert('server_url', serverUrl)
      await upsert('store_id', String(sid))
      await upsert('cached_user', JSON.stringify(data.user))
      await upsert('cached_store', JSON.stringify(data.store))
      if (data.syncApiKey) await upsert('sync_api_key', data.syncApiKey)

      // Register this terminal for sync v2 before entering the app — the sync
      // hooks fire immediately on auth and need the device credentials.
      // (First registration needs a manager/admin token; no-op afterwards.)
      try {
        const reg = await window.electronAPI.sync.ensureDevice(data.token)
        if (!reg.registered && reg.error) console.warn('Device registration pending:', reg.error)
      } catch { /* offline or non-manager — sync will surface it */ }

      await checkAndNavigate()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
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
          <div className="text-dark-border text-sm">Mini Market Point of Sale</div>
        </div>

        <div className="bg-dark-surface rounded-2xl p-8 shadow-2xl border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-6">Sign In</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Server URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Username</label>
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
              <label className="block text-sm text-gray-400 mb-1">Password</label>
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
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 text-xs text-dark-border">
          BarakaPOS v1.0.0 — © 2026 Baraka Mini Market
        </div>
      </div>
    </div>
  )
}
