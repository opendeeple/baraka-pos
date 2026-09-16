import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, User, Banknote } from 'lucide-react'
import { fmtUZS } from '../../lib/currency'
import { NumPad } from './NumPad'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore } from '../../store/session.store'
import { Debtor } from '../../types/pos.types'

interface DebtEvent {
  type: 'debt' | 'payment'
  label: string
  date: string
  amount: number
}

interface Props {
  contact: Debtor
  onClose: () => void
  onPaymentComplete?: () => void
}

export function DebtHistoryPanel({ contact, onClose, onPaymentComplete }: Props) {
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  const { session } = useSessionStore()

  const [events, setEvents] = useState<DebtEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [currentBalance, setCurrentBalance] = useState(contact.balance)

  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('0')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  useEffect(() => { loadRecords() }, [contact.id])

  function loadRecords() {
    setLoading(true)
    window.electronAPI.db.query(
      `SELECT 'debt' as type, s.invoice_number as label, s.created_at as date,
              SUM(pt.amount) as amount
       FROM sales s
       JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
       WHERE s.contact_id = ? AND s.status != 'cancelled'
       GROUP BY s.id
       UNION ALL
       SELECT 'payment' as type, description as label, created_at as date, amount
       FROM cash_logs
       WHERE source = 'debt_payment' AND reference_id = ?
       ORDER BY date DESC
       LIMIT 100`,
      [contact.id, contact.id]
    ).then((rows) => { setEvents(rows as DebtEvent[]); setLoading(false) })
  }

  async function confirmPayment() {
    const amt = parseFloat(payAmount)
    if (!amt || amt <= 0) { setPayError(t('debt.enterValidAmount')); return }
    if (amt > currentBalance) { setPayError(t('debt.cannotExceed', { amount: `UZS ${fmtUZS(currentBalance)}` })); return }
    setPaying(true)
    setPayError('')
    try {
      const now = new Date().toISOString()
      const newBalance = Math.max(0, currentBalance - amt)
      const cashLogSyncId = uuidv4()
      await window.electronAPI.db.exec(
        `UPDATE contacts SET balance = ?, updated_at = ? WHERE id = ?`,
        [newBalance, now, contact.id]
      )
      await window.electronAPI.db.exec(
        `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, description, reference_id, contact_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'cash_in', ?, 'debt_payment', 'Debt repayment', ?, ?, ?, ?, ?)`,
        [cashLogSyncId, store?.id ?? 1, session?.id ?? null,
         amt, contact.id, contact.id, user?.id ?? 1, now, now]
      )
      // The local balance UPDATE above is instant local feedback; the server
      // is the one that actually decrements Contact.balance (balance isn't a
      // directly push-able field — see CONTACT_FIELDS) as a side effect of
      // this cash_logs push, so other devices see the payment once they pull.
      await window.electronAPI.sync.enqueue('cash_logs', cashLogSyncId, 'upsert')
      window.electronAPI.sync.pushPending().catch(() => {})
      setCurrentBalance(newBalance)
      setShowPay(false)
      setPayAmount('0')
      if (newBalance === 0) { setEvents([]) } else { loadRecords() }
      onPaymentComplete?.()
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t('debt.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between shrink-0 min-h-[60px]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={showPay ? () => { setShowPay(false); setPayAmount('0'); setPayError('') } : onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 active:text-white rounded-lg transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="w-7 h-7 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
            <User size={13} className="text-yellow-400" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{contact.name}</p>
            {contact.phone && <p className="text-gray-500 text-xs">{contact.phone}</p>}
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">{t('debt.totalDebt')}</p>
          <p className="text-yellow-400 font-bold text-sm">UZS {fmtUZS(currentBalance)}</p>
        </div>
      </div>

      {showPay ? (
        /* NumPad payment view */
        <>
          <div className="flex-1 p-4 flex flex-col justify-end">
            <NumPad value={payAmount} onChange={setPayAmount} label={t('debt.repaymentAmount')} />
          </div>
          {payError && (
            <p className="text-red-400 text-xs px-4 pb-2">{payError}</p>
          )}
          <div className="shrink-0 border-t border-dark-border p-4">
            <button
              onClick={confirmPayment}
              disabled={paying || payAmount === '0'}
              className="w-full h-12 bg-green-600 active:bg-green-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
            >
              {paying ? t('debt.processing') : t('debt.confirmPayment')}
            </button>
          </div>
        </>
      ) : (
        /* History list */
        <>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <p className="text-center text-gray-500 py-16 text-sm">{t('common.loading')}</p>
            ) : events.length === 0 ? (
              <p className="text-center text-gray-500 py-16 text-sm">{t('debt.noRecords')}</p>
            ) : (
              <div className="space-y-2">
                {events.map((e, i) => (
                  <div
                    key={i}
                    className={`border rounded-xl px-4 py-3 flex items-center justify-between ${
                      e.type === 'payment'
                        ? 'bg-green-500/5 border-green-500/20'
                        : 'bg-dark-card border-dark-border'
                    }`}
                  >
                    <div>
                      <p className="text-white text-sm font-semibold">{e.label}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{e.date.slice(0, 10)}</p>
                    </div>
                    <p className={`font-bold text-sm ${e.type === 'payment' ? 'text-green-400' : 'text-yellow-400'}`}>
                      UZS {fmtUZS(e.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {currentBalance > 0 && (
            <div className="shrink-0 border-t border-dark-border p-4">
              <button
                onClick={() => setShowPay(true)}
                className="w-full flex items-center justify-center gap-2 h-12 bg-green-600 active:bg-green-700 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                <Banknote size={16} />
                {t('debt.payDebt')}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
