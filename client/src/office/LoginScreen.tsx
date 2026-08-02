import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '../store/auth.store'
import { AuthUser } from '@baraka/shared'

const SERVER_URL = 'http://localhost:3001'

export default function OfficeLoginScreen() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serverUrl, setServerUrl] = useState(SERVER_URL)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/backoffice', { replace: true })
    } else {
      restoreSession()
    }
  }, [])

  async function restoreSession() {
    // The saved server URL belongs to the terminal — restore it for both the
    // form and the token check (the useState default is just a placeholder).
    let effectiveUrl = serverUrl
    try {
      const rows = await window.electronAPI.db.query(
        `SELECT meta_value FROM settings WHERE meta_key='server_url' LIMIT 1`, []
      ) as Array<{ meta_value: string }>
      if (rows[0]?.meta_value) {
        effectiveUrl = rows[0].meta_value
        setServerUrl(effectiveUrl)
      }
    } catch { /* fresh DB — keep default */ }

    const token = await window.electronAPI.auth.getToken()
    if (!token) return
    try {
      const result = await window.electronAPI.auth.me(effectiveUrl, token)
      if (result.status === 200) {
        const data = result.data as { user: AuthUser; store: { id: number; name: string; address?: string; phone?: string; salePrefix: string } }
        setAuth(data.user, token, data.store)
        navigate('/backoffice', { replace: true })
      }
    } catch { /* Token expired or server offline */ }
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
      const data = result.data as { token: string; syncApiKey?: string; user: AuthUser; store: { id: number; name: string; salePrefix: string } }

      await window.electronAPI.auth.saveToken(data.token)
      setAuth(data.user, data.token, data.store)

      const now = new Date().toISOString()
      const sid = data.store.id
      const upsert = (key: string, val: string) =>
        window.electronAPI.db.exec(
          `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (?, ?, ?, ?)`,
          [sid, key, val, now]
        )

      await upsert('server_url', serverUrl)
      await upsert('store_id', String(sid))
      if (data.syncApiKey) await upsert('sync_api_key', data.syncApiKey)

      // Register this machine for sync v2 before entering the app — sync
      // needs the device credentials from the first moment.
      try {
        const reg = await window.electronAPI.sync.ensureDevice(data.token)
        if (!reg.registered && reg.error) console.warn('Device registration pending:', reg.error)
      } catch { /* offline or non-manager — sync will surface it */ }

      navigate('/backoffice', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl font-bold text-primary mb-2">BarakaPOS</div>
          <div className="text-dark-border text-sm">Back Office Management</div>
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
          BarakaPOS Office v1.0.0 — © 2026 Baraka Mini Market
        </div>
      </div>
    </div>
  )
}
