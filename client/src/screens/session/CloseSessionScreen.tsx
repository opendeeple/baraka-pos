import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../../store/session.store'
import { fmtUZS } from '../../lib/currency'
import { NumPad } from '../../components/pos/NumPad'
import { ArrowLeft, TrendingUp, ShoppingBag, Banknote, CreditCard, Smartphone } from 'lucide-react'

interface SessionSummary {
  totalSales: number
  totalCash: number
  totalCard: number
  totalOther: number
  saleCount: number
  theoreticalCash: number
  openingBalance: number
}

export default function CloseSessionScreen() {
  const navigate = useNavigate()
  const { session, clearSession } = useSessionStore()
  const [actualCash, setActualCash] = useState('0')
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    if (!session) return
    const salesRows = await window.electronAPI.db.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount),0) as total FROM sales WHERE session_id=? AND status='completed'`,
      [session.id]
    ) as Array<{ cnt: number; total: number }>

    const cashRow = await window.electronAPI.db.query(
      `SELECT COALESCE(SUM(amount),0) as cash FROM payment_transactions WHERE session_id=? AND payment_method='Cash' AND transaction_type='sale'`,
      [session.id]
    ) as Array<{ cash: number }>

    const cardRow = await window.electronAPI.db.query(
      `SELECT COALESCE(SUM(amount),0) as card FROM payment_transactions WHERE session_id=? AND payment_method='Card' AND transaction_type='sale'`,
      [session.id]
    ) as Array<{ card: number }>

    const opening = session.opening_balance
    setSummary({
      saleCount: salesRows[0].cnt,
      totalSales: salesRows[0].total,
      totalCash: cashRow[0].cash,
      totalCard: cardRow[0].card,
      totalOther: salesRows[0].total - cashRow[0].cash - cardRow[0].card,
      theoreticalCash: opening + cashRow[0].cash,
      openingBalance: opening,
    })
  }

  async function handleClose() {
    if (!session) return
    setLoading(true)
    try {
      await window.electronAPI.session.close({
        sessionId: session.id,
        closingBalanceActual: Number(actualCash),
      })
      clearSession()
      navigate('/session/open')
    } finally {
      setLoading(false)
    }
  }

  const variance = summary ? Number(actualCash) - summary.theoreticalCash : 0
  const variancePositive = variance >= 0

  return (
    <div className="min-h-screen bg-dark flex">
      {/* Left panel — summary */}
      <div className="flex flex-col w-[420px] shrink-0 bg-dark-surface border-r border-dark-border overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-dark-border flex items-center gap-3">
          <button
            onClick={() => navigate('/pos')}
            className="w-9 h-9 rounded-lg border border-dark-border flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Close Register</h1>
            <p className="text-xs text-gray-500">Session summary</p>
          </div>
        </div>

        {summary ? (
          <div className="p-6 space-y-4 flex-1">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-dark-card rounded-2xl p-4 border border-dark-border">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingBag size={14} className="text-primary" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Transactions</span>
                </div>
                <div className="text-2xl font-bold text-white">{summary.saleCount}</div>
              </div>
              <div className="bg-dark-card rounded-2xl p-4 border border-dark-border">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-green-400" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Total Sales</span>
                </div>
                <div className="text-lg font-bold text-white leading-tight">{fmtUZS(summary.totalSales)}</div>
                <div className="text-xs text-gray-500">UZS</div>
              </div>
            </div>

            {/* Payment breakdown */}
            <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden">
              <div className="px-4 py-3 border-b border-dark-border">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Payment Breakdown</span>
              </div>
              <div className="divide-y divide-dark-border">
                <PayRow icon={<Banknote size={15} className="text-green-400" />} label="Cash" value={summary.totalCash} />
                <PayRow icon={<CreditCard size={15} className="text-blue-400" />} label="Card" value={summary.totalCard} />
                <PayRow icon={<Smartphone size={15} className="text-purple-400" />} label="Other" value={summary.totalOther} />
              </div>
            </div>

            {/* Cash reconciliation */}
            <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden">
              <div className="px-4 py-3 border-b border-dark-border">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Cash Reconciliation</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Opening balance</span>
                  <span className="text-white">{fmtUZS(summary.openingBalance)} UZS</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">+ Cash sales</span>
                  <span className="text-white">{fmtUZS(summary.totalCash)} UZS</span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t border-dark-border pt-3">
                  <span className="text-gray-300">Expected in drawer</span>
                  <span className="text-white">{fmtUZS(summary.theoreticalCash)} UZS</span>
                </div>
              </div>
            </div>

            {/* Variance */}
            {Number(actualCash) > 0 && (
              <div className={`rounded-2xl p-4 border ${variancePositive ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-sm font-semibold ${variancePositive ? 'text-green-400' : 'text-red-400'}`}>
                    Variance {variancePositive ? '(Over)' : '(Short)'}
                  </span>
                  <span className={`text-lg font-bold ${variancePositive ? 'text-green-400' : 'text-red-400'}`}>
                    {variancePositive ? '+' : ''}{fmtUZS(variance)} UZS
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Loading summary...
          </div>
        )}
      </div>

      {/* Right panel — actual cash numpad */}
      <div className="flex-1 flex flex-col items-center justify-center p-10">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-bold text-white mb-1">Count Actual Cash</h2>
          <p className="text-gray-500 text-sm mb-6">Enter the cash amount physically in the drawer</p>

          <NumPad
            value={actualCash}
            onChange={setActualCash}
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => navigate('/pos')}
              className="flex-1 border border-dark-border text-gray-400 hover:text-white font-medium py-4 rounded-2xl text-sm transition-colors"
            >
              Back to POS
            </button>
            <button
              onClick={handleClose}
              disabled={loading}
              className="flex-1 bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-sm transition-all"
            >
              {loading ? 'Closing...' : 'Close Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PayRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <span className="text-sm font-medium text-white">{fmtUZS(value)} UZS</span>
    </div>
  )
}
