import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, User, Banknote, Trash2, Lock, CheckCircle2 } from 'lucide-react'
import { fmtUZS } from '../../lib/currency'
import { lastClearedSql, fmtDateTime, REPAYMENT_FOR_CONTACT } from '../../lib/debt'
import { logAudit } from '../../lib/audit'
import { NumPad } from './NumPad'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore } from '../../store/session.store'
import { Debtor } from '../../types/pos.types'

interface DebtRow { label: string; date: string; amount: number }
interface PaymentRow { date: string; amount: number }

interface Props {
  contact: Debtor
  onClose: () => void
  /** After a repayment. The panel stays open — showing the new remaining
   *  balance, and the delete button once the debt is fully paid. */
  onPaymentComplete?: () => void
  /** After a paid-off debt was deleted; defaults to onClose. */
  onCleared?: () => void
}

/**
 * A debtor's statement since their last cleared debt: what they took on
 * credit, below it every repayment (when + how much), the totals of each,
 * and what's still owed. The debt can only be deleted once fully paid.
 */
export function DebtHistoryPanel({ contact, onClose, onPaymentComplete, onCleared }: Props) {
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  const { session } = useSessionStore()

  const [debts, setDebts] = useState<DebtRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [currentBalance, setCurrentBalance] = useState(contact.balance)

  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('0')
  const [payMethod, setPayMethod] = useState<'Cash' | 'Card' | 'Click'>('Cash')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => { loadRecords() }, [contact.id])

  const totalDebt = debts.reduce((s, d) => s + Number(d.amount), 0)
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const fullyPaid = currentBalance <= 0
  const hasHistory = debts.length > 0 || payments.length > 0

  async function loadRecords() {
    setLoading(true)
    try {
      const since = lastClearedSql('?')
      const [debtRows, paymentRows, balanceRows] = await Promise.all([
        window.electronAPI.db.query(
          `SELECT s.invoice_number as label, s.created_at as date, SUM(pt.amount) as amount
           FROM sales s
           JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
           WHERE s.contact_id = ? AND s.status != 'cancelled' AND s.created_at > ${since}
           GROUP BY s.id
           ORDER BY s.created_at`,
          [contact.id, contact.id]
        ),
        window.electronAPI.db.query(
          `SELECT created_at as date, amount FROM cash_logs
           WHERE ${REPAYMENT_FOR_CONTACT} AND created_at > ${since}
           ORDER BY created_at`,
          [contact.id, contact.id, contact.id]
        ),
        // The prop can be stale (a pull or another window may have changed it).
        window.electronAPI.db.query(`SELECT balance FROM contacts WHERE id = ?`, [contact.id]),
      ]) as [DebtRow[], PaymentRow[], Array<{ balance: number }>]
      setDebts(debtRows)
      setPayments(paymentRows)
      if (balanceRows[0]) setCurrentBalance(Number(balanceRows[0].balance))
    } finally {
      setLoading(false)
    }
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
      // The drawer it lands in: the till's open session (also when paying
      // from the Office on the same PC); card/Click never touch the drawer.
      const current = session ?? (await window.electronAPI.session.current() as { id: number } | null)
      await window.electronAPI.db.exec(
        `UPDATE contacts SET balance = ?, updated_at = ? WHERE id = ?`,
        [newBalance, now, contact.id]
      )
      // 'deposit' + contact = a debt repayment — the name Android and the
      // server use (older desktop rows say 'debt_payment'; both are read).
      await window.electronAPI.db.exec(
        `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, payment_method, description, reference_id, contact_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'cash_in', ?, 'deposit', ?, 'Debt repayment', ?, ?, ?, ?, ?)`,
        [cashLogSyncId, store?.id ?? 1, current?.id ?? null,
         amt, payMethod, contact.id, contact.id, user?.id ?? 1, now, now]
      )
      await logAudit('debt_payment', { entity: 'contact', entityId: contact.id, details: { customer: contact.name, amount: amt, method: payMethod, balanceAfter: newBalance } })
      // The local balance UPDATE above is instant local feedback; the server
      // is the one that actually decrements Contact.balance (balance isn't a
      // directly push-able field — see CONTACT_FIELDS) as a side effect of
      // this cash_logs push, so other devices see the payment once they pull.
      await window.electronAPI.sync.enqueue('cash_logs', cashLogSyncId, 'upsert')
      window.electronAPI.sync.pushPending().catch(() => {})
      setCurrentBalance(newBalance)
      setShowPay(false)
      setPayAmount('0')
      await loadRecords()
      onPaymentComplete?.()
    } catch (e) {
      setPayError(e instanceof Error ? e.message : t('debt.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  // Records a cut-off rather than deleting anything: sales and cash_logs are
  // financial records the server and reports depend on (see schema v12).
  async function clearDebt() {
    setClearing(true)
    try {
      const [row] = await window.electronAPI.db.query(
        `SELECT balance FROM contacts WHERE id = ?`, [contact.id]
      ) as Array<{ balance: number }>
      if (row && Number(row.balance) > 0) {
        // Re-checked at click time — something added debt since this opened.
        setCurrentBalance(Number(row.balance))
        setConfirmClear(false)
        return
      }
      const now = new Date().toISOString()
      const clearanceSyncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO debt_clearances (sync_id, contact_id, cleared_at, cleared_by, total_debt, total_paid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [clearanceSyncId, contact.id, now, user?.id ?? null, totalDebt, totalPaid, now]
      )
      // Every other device drops the debt from its list once it pulls this.
      await window.electronAPI.sync.enqueue('debt_clearances', clearanceSyncId, 'upsert')
      await logAudit('debt_clear', { entity: 'contact', entityId: contact.id, details: { customer: contact.name, totalDebt, totalPaid } })
      window.electronAPI.sync.pushPending().catch(() => {})
      ;(onCleared ?? onClose)()
    } finally {
      setClearing(false)
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
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">{t('debt.remaining')}</p>
          <p className={`font-bold text-sm ${fullyPaid ? 'text-green-400' : 'text-yellow-400'}`}>UZS {fmtUZS(Math.max(0, currentBalance))}</p>
        </div>
      </div>

      {showPay ? (
        /* NumPad payment view */
        <>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col justify-end gap-3">
            <div className="grid grid-cols-3 gap-2 shrink-0">
              {(['Cash', 'Card', 'Click'] as const).map((m) => (
                <button key={m} onClick={() => setPayMethod(m)}
                  className={`h-11 rounded-xl border text-sm font-medium ${payMethod === m ? 'bg-primary border-primary text-white' : 'border-dark-border text-gray-300'}`}>
                  {t(`payment.method${m}`)}
                </button>
              ))}
            </div>
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
        /* Statement: debts, repayments below, then what's left */
        <>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <p className="text-center text-gray-500 py-16 text-sm">{t('common.loading')}</p>
            ) : (
              <div className="space-y-4">
                {!hasHistory && (
                  <p className="text-center text-gray-500 py-10 text-sm">{t('debt.noRecords')}</p>
                )}

                {debts.length > 0 && (
                  <section>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('debt.debtsTaken')}</p>
                    <div className="space-y-2">
                      {debts.map((d, i) => (
                        <div key={i} className="bg-dark-card border border-dark-border rounded-xl px-4 py-3 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{d.label}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{fmtDateTime(d.date)}</p>
                          </div>
                          <p className="text-yellow-400 font-bold text-sm whitespace-nowrap ml-2">UZS {fmtUZS(Number(d.amount))}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-sm px-1 pt-2">
                      <span className="text-gray-400">{t('debt.totalDebt')}</span>
                      <span className="text-yellow-400 font-semibold">UZS {fmtUZS(totalDebt)}</span>
                    </div>
                  </section>
                )}

                {payments.length > 0 && (
                  <section>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('debt.payments')}</p>
                    <div className="space-y-2">
                      {payments.map((p, i) => (
                        <div key={i} className="bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-white text-sm font-semibold">{t('debt.payment')}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{fmtDateTime(p.date)}</p>
                          </div>
                          <p className="text-green-400 font-bold text-sm whitespace-nowrap ml-2">UZS {fmtUZS(Number(p.amount))}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-sm px-1 pt-2">
                      <span className="text-gray-400">{t('debt.totalPaid')}</span>
                      <span className="text-green-400 font-semibold">UZS {fmtUZS(totalPaid)}</span>
                    </div>
                  </section>
                )}

                {/* The contact's balance, not totalDebt - totalPaid: it's the
                    authoritative figure (repayments taken on another device
                    reach this one only through the server's balance). */}
                <div className={`rounded-xl px-4 py-3 flex items-center justify-between border ${
                  fullyPaid ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
                }`}>
                  {fullyPaid ? (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-green-400">
                      <CheckCircle2 size={15} /> {t('debt.fullyPaid')}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-red-300">{t('debt.remaining')}</span>
                  )}
                  <span className={`font-bold text-sm whitespace-nowrap ml-2 ${fullyPaid ? 'text-green-400' : 'text-red-400'}`}>
                    UZS {fmtUZS(Math.max(0, currentBalance))}
                  </span>
                </div>
              </div>
            )}
          </div>

          {(!fullyPaid || hasHistory) && !loading && (
            <div className="shrink-0 border-t border-dark-border p-4 space-y-2">
              {!fullyPaid && (
                <button
                  onClick={() => setShowPay(true)}
                  className="w-full flex items-center justify-center gap-2 h-12 bg-green-600 active:bg-green-700 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  <Banknote size={16} />
                  {t('debt.payDebt')}
                </button>
              )}

              {hasHistory && (confirmClear ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-300 text-center">{t('debt.clearConfirm')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 h-11 border border-dark-border text-gray-300 rounded-xl text-sm transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={clearDebt}
                      disabled={clearing}
                      className="flex-1 h-11 bg-red-600 active:bg-red-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
                    >
                      {clearing ? t('debt.processing') : t('debt.clearYes')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setConfirmClear(true)}
                    disabled={!fullyPaid}
                    className="w-full flex items-center justify-center gap-2 h-11 border border-red-500/40 text-red-400 active:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors"
                  >
                    {fullyPaid ? <Trash2 size={15} /> : <Lock size={15} />}
                    {t('debt.clearDebt')}
                  </button>
                  {!fullyPaid && (
                    <p className="text-[11px] text-gray-500 text-center">{t('debt.clearLocked')}</p>
                  )}
                </>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
