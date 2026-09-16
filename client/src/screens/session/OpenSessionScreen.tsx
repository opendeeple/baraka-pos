import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSessionStore, LocalPosSession } from '../../store/session.store'
import { useAuthStore } from '../../store/auth.store'
import { NumPad } from '../../components/pos/NumPad'
import { LogOut, Store } from 'lucide-react'

export default function OpenSessionScreen() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { setSession } = useSessionStore()
  const { store, user, logout } = useAuthStore()
  const [openingBalance, setOpeningBalance] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const session = await window.electronAPI.session.open(Number(openingBalance))
      setSession(session as LocalPosSession)
      navigate('/pos')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('session.failedToOpen'))
    } finally {
      setLoading(false)
    }
  }

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <form onSubmit={handleOpen} className="min-h-screen bg-dark flex">
      {/* Left panel — info */}
      <div className="flex flex-col justify-between w-80 shrink-0 bg-dark-surface border-r border-dark-border p-8">
        <div>
          {/* Store */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Store size={20} className="text-primary" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight">{store?.name ?? 'Store'}</div>
              <div className="text-xs text-gray-500">{t('session.pointOfSale')}</div>
            </div>
          </div>

          {/* Cashier */}
          <div className="mb-8">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">{t('session.cashier')}</p>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/30 flex items-center justify-center text-primary font-bold text-lg">
                {initials}
              </div>
              <div>
                <div className="text-white font-semibold">{user?.name}</div>
                <div className="text-xs text-gray-500 capitalize">{(user as { role?: string })?.role ?? 'cashier'}</div>
              </div>
            </div>
          </div>

        </div>

        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 text-gray-500 hover:text-white text-sm transition-colors"
        >
          <LogOut size={15} />
          {t('session.switchUser')}
        </button>
      </div>

      {/* Right panel — numpad */}
      <div className="flex-1 flex flex-col items-center justify-center p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-white mb-1">{t('session.openCashRegister')}</h1>
          <p className="text-gray-500 text-sm mb-8">{t('session.enterOpeningAmount')}</p>

          <NumPad
            value={openingBalance}
            onChange={setOpeningBalance}
          />

          {error && (
            <div className="mt-4 bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full bg-primary active:bg-orange-600 active:scale-[0.98] disabled:opacity-40 text-white font-bold py-4 rounded-2xl text-lg transition-all shadow-lg shadow-primary/20"
          >
            {loading ? t('session.opening') : t('session.openRegisterAndSell')}
          </button>
        </div>
      </div>
    </form>
  )
}
