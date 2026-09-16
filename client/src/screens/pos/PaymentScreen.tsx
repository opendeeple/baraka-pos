import { fmtUZS } from '../../lib/currency'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Trash2, Search, UserPlus, X, User } from 'lucide-react'
import { useCartStore } from '../../store/cart.store'
import { useAuthStore } from '../../store/auth.store'
import { useSessionStore } from '../../store/session.store'
import { PaymentEntry, PaymentMethod } from '@baraka/shared'
import type { ReceiptDoc } from '@baraka/app-core'
import { NumPad } from '../../components/pos/NumPad'
import { ReceiptModal } from '../../components/pos/ReceiptModal'
import { v4 as uuidv4 } from 'uuid'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

const PAYMENT_METHODS: { method: PaymentMethod; labelKey: string; icon: string }[] = [
  { method: 'Cash',  labelKey: 'payment.methodCash',  icon: '💵' },
  { method: 'Card',  labelKey: 'payment.methodCard', icon: '💳' },
  { method: 'Click', labelKey: 'payment.methodClick', icon: '📱' },
  { method: 'Debt',  labelKey: 'payment.methodDebt', icon: '📋' },
]

interface ContactResult {
  id: number
  name: string
  phone: string | null
  balance: number
}

interface Props {
  onClose: () => void
  onComplete: () => void
}

export default function PaymentScreen({ onClose, onComplete }: Props) {
  const { t } = useTranslation()
  const { items, charges, discount, getFinalTotal, getSubtotal, getTotalChargeAmount, clearCart } = useCartStore()
  const { user, store } = useAuthStore()
  const { session } = useSessionStore()

  const [payments, setPayments] = useState<PaymentEntry[]>([])
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('Cash')
  const [amountInput, setAmountInput] = useState('0')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ReceiptDoc | null>(null)

  // Debt contact state
  const [debtContact, setDebtContact] = useState<ContactResult | null>(null)
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<ContactResult[]>([])
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [savingContact, setSavingContact] = useState(false)
  const debouncedContactSearch = useDebouncedValue(contactSearch)

  const total = getFinalTotal()
  const subtotal = getSubtotal()
  const chargeAmount = getTotalChargeAmount()
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, total - paid)
  const change = Math.max(0, paid - total)
  const isFullyPaid = paid >= total && payments.length > 0
  const hasDebtPayment = payments.some((p) => p.paymentMethod === 'Debt')
  const canComplete = isFullyPaid && (!hasDebtPayment || debtContact !== null)

  // If the cashier typed the full amount but never pressed "+ Add" (a common
  // slip with a single, exact payment), Complete Sale can proceed directly —
  // it adds that amount as the payment itself instead of staying disabled.
  const pendingAmount = parseFloat(amountInput) || 0
  const canCompleteFromPending =
    payments.length === 0 &&
    pendingAmount >= total &&
    pendingAmount > 0 &&
    (selectedMethod !== 'Debt' || debtContact !== null)
  const canCompleteNow = canComplete || canCompleteFromPending

  useEffect(() => {
    if (selectedMethod !== 'Debt' || debtContact) return
    const q = debouncedContactSearch.trim()
    const sql = q
      ? `SELECT id, name, phone, balance FROM contacts WHERE type IN ('customer','both') AND deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 20`
      : `SELECT id, name, phone, balance FROM contacts WHERE type IN ('customer','both') AND deleted_at IS NULL ORDER BY name LIMIT 20`
    window.electronAPI.db.query(sql, q ? [`%${q}%`, `%${q}%`] : [])
      .then((rows) => setContactResults(rows as ContactResult[]))
  }, [debouncedContactSearch, selectedMethod, debtContact])

  function addPayment() {
    if (selectedMethod === 'Debt' && !debtContact) {
      setError(t('payment.selectContactForDebt'))
      return
    }
    const amt = parseFloat(amountInput)
    if (!amt || amt <= 0) return
    setError('')
    setPayments((prev) => [...prev, { paymentMethod: selectedMethod, amount: amt }])
    setAmountInput('0')
  }

  function setExact() {
    setAmountInput(remaining.toFixed(2).replace(/^0/, '') || '0')
  }

  function handleCompleteSale() {
    if (canCompleteFromPending) {
      processPayment([{ paymentMethod: selectedMethod, amount: pendingAmount }])
      return
    }
    processPayment()
  }

  async function createContact() {
    if (!newContactName.trim() || !newContactPhone.trim()) return
    setSavingContact(true)
    try {
      const now = new Date().toISOString()
      const fullPhone = `+998 ${newContactPhone.trim()}`
      const contactSyncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO contacts (sync_id, name, phone, type, balance, loyalty_points_balance, created_at, updated_at)
         VALUES (?, ?, ?, 'customer', 0, 0, ?, ?)`,
        [contactSyncId, newContactName.trim(), fullPhone, now, now]
      )
      await window.electronAPI.sync.enqueue('contacts', contactSyncId, 'upsert')
      const rows = await window.electronAPI.db.query(
        `SELECT id, name, phone, balance FROM contacts
         WHERE phone = ? ORDER BY id DESC LIMIT 1`,
        [fullPhone]
      ) as ContactResult[]
      if (rows.length > 0) {
        setDebtContact(rows[0])
        setShowCreateContact(false)
        setNewContactName('')
        setNewContactPhone('')
        setContactSearch('')
        setContactResults([])
      }
    } finally {
      setSavingContact(false)
    }
  }

  /**
   * `overridePayments`: used when Complete Sale is pressed with a typed-but-
   * not-yet-added amount (see canCompleteFromPending) — that amount becomes
   * the payment itself instead of requiring an explicit "+ Add" first.
   */
  async function processPayment(overridePayments?: PaymentEntry[]) {
    const effectivePayments = overridePayments ?? payments
    const effectivePaid = effectivePayments.reduce((s, p) => s + p.amount, 0)
    const effectiveFullyPaid = effectivePaid >= total && effectivePayments.length > 0
    const effectiveHasDebt = effectivePayments.some((p) => p.paymentMethod === 'Debt')

    if (!effectiveFullyPaid) { setError(t('payment.insufficientAmount')); return }
    if (effectiveHasDebt && !debtContact) { setError(t('payment.contactRequiredForDebt')); return }
    setProcessing(true)
    setError('')

    try {
      const syncId = uuidv4()
      const now = new Date().toISOString()
      const changeAmount = Math.max(0, effectivePaid - total)
      const storeId = store?.id ?? 1
      const sessionId = session?.id ?? 1
      const userId = user?.id ?? 1
      // Server-leased invoice range: the number printed on the receipt is
      // final. Placeholder fallback only when the device has never been online.
      const invoiceNumber =
        (await window.electronAPI.sync.nextInvoiceNumber()) ??
        `INV-${syncId.slice(0, 8).toUpperCase()}`

      // All DB writes in a single atomic transaction — no partial sales on crash
      const ops: Array<{ sql: string; params: unknown[] }> = []

      ops.push({
        sql: `INSERT INTO sales (sync_id, store_id, session_id, contact_id, user_id,
               invoice_number, sale_type, subtotal, discount, total_charge_amount,
               total_amount, amount_received, change_amount, status, payment_status,
               sale_date, sale_time, cart_snapshot, created_at, updated_at, sync_status)
             VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,'pending')`,
        params: [
          syncId, storeId, sessionId,
          debtContact?.id ?? null, userId,
          invoiceNumber, 'sale',
          subtotal, discount, chargeAmount,
          total, effectivePaid, changeAmount,
          'completed', effectiveHasDebt ? 'partially_paid' : 'fully_paid',
          now.split('T')[0], now.split('T')[1].slice(0, 8),
          JSON.stringify({ items, charges, discount }),
          now, now,
        ],
      })

      for (const item of items) {
        ops.push({
          sql: `INSERT INTO sale_items (sale_id, item_type, product_id, batch_id, description,
                 quantity, free_quantity, unit_price, unit_cost, discount, flat_discount, is_free, created_at)
               SELECT id,?,?,?,?,?,?,?,?,?,?,?,? FROM sales WHERE sync_id=?`,
          params: ['product', item.productId, item.batchId, item.name,
                   item.quantity, item.freeQuantity ?? 0, item.unitPrice, item.unitCost ?? 0,
                   item.discount, 0, item.isFree ? 1 : 0, now, syncId],
        })
        ops.push({
          sql: `UPDATE product_stocks SET quantity = quantity - ? WHERE product_id = ? AND batch_id = ?`,
          params: [item.quantity, item.productId, item.batchId],
        })
      }

      for (const payment of effectivePayments) {
        ops.push({
          sql: `INSERT INTO payment_transactions (sale_id, store_id, session_id, transaction_date,
                 amount, payment_method, transaction_type, charge_state, created_at, sync_status)
               SELECT id,?,?,?,?,?,?,?,?,'pending' FROM sales WHERE sync_id=?`,
          params: [storeId, sessionId, now, payment.amount, payment.paymentMethod, 'sale', 'FULLY_CHARGED', now, syncId],
        })
      }

      if (effectiveHasDebt && debtContact) {
        const debtTotal = effectivePayments
          .filter((p) => p.paymentMethod === 'Debt')
          .reduce((s, p) => s + p.amount, 0)
        ops.push({
          sql: `UPDATE contacts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
          params: [debtTotal, now, debtContact.id],
        })
      }

      const cashPayments = effectivePayments.filter((p) => p.paymentMethod === 'Cash')
      for (const cp of cashPayments) {
        ops.push({
          sql: `INSERT INTO cash_logs (store_id, session_id, transaction_type, amount, source, description, created_by, created_at)
               SELECT ?,?,'sale',?,'sale',('Sale ' || id),?,? FROM sales WHERE sync_id=?`,
          params: [storeId, sessionId, cp.amount, userId, now, syncId],
        })
      }

      // Outbox pointer row — the push payload is rebuilt from the sale rows at
      // flush time, so it always reflects the committed state.
      ops.push({
        sql: `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
             VALUES ('sale', 'sales', 'upsert', '{}', ?, ?, 'pending')`,
        params: [syncId, now],
      })

      await window.electronAPI.db.transaction(ops)

      // Post-transaction: fire-and-forget side effects
      if (cashPayments.length > 0) {
        window.electronAPI.printer.openCashDrawer().catch(console.error)
      }
      window.electronAPI.sync.pushPending().catch(console.error)

      const chargeDisplay = charges.map((c) => ({
        name: c.name,
        amount: c.rateType === 'percentage' ? (subtotal * c.rateValue) / 100 : c.rateValue,
      }))

      // Freshest store info + receipt template — `store` (from login) goes
      // stale the moment Backoffice > Settings edits the `stores` row or
      // `receipt_template`, since neither writes back to the auth store.
      const storeRow = (await window.electronAPI.db.query(
        `SELECT name, address, phone FROM stores WHERE id=? LIMIT 1`, [storeId]
      ) as Array<{ name: string; address: string | null; phone: string | null }>)[0]
      const templateRow = (await window.electronAPI.db.query(
        `SELECT meta_value FROM settings WHERE meta_key='receipt_template' LIMIT 1`, []
      ) as Array<{ meta_value: string }>)[0]
      const template = templateRow ? JSON.parse(templateRow.meta_value) as {
        header?: string; footer?: string; show_cashier?: boolean
      } : {}

      const doc: ReceiptDoc = {
        invoiceNumber,
        storeName: storeRow?.name || store?.name || 'Store',
        storeAddress: storeRow?.address ?? store?.address,
        storePhone: storeRow?.phone ?? store?.phone,
        header: template.header,
        cashierName: template.show_cashier === false ? null : (user?.name ?? 'Cashier'),
        timestamp: now,
        items: items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unitPrice, discount: i.discount })),
        charges: chargeDisplay,
        total,
        payments: effectivePayments.map((p) => ({ method: p.paymentMethod, amount: p.amount })),
        change: changeAmount,
        footer: template.footer,
      }
      // Fire-and-forget: prints on a configured physical printer if there is
      // one. Either way, the on-screen receipt below (set via setReceipt) is
      // what actually confirms the sale to the cashier.
      window.electronAPI.printer.print(doc).catch(console.error)

      clearCart()
      setReceipt(doc)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('debt.paymentFailed'))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="h-screen flex bg-dark overflow-hidden">
      {/* Left: Order summary */}
      <div className="flex-1 p-6 overflow-auto flex flex-col">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-white">{t('payment.title')}</h2>
        </div>

        <div className="bg-dark-surface rounded-2xl border border-dark-border p-5 mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">{t('payment.orderSummary')}</p>

          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-300 truncate flex-1 mr-2">
                  {item.quantity}× {item.name}
                  {item.discount > 0 && <span className="text-green-400 ml-1">-{item.discount}%</span>}
                </span>
                <span className="text-white whitespace-nowrap">
                  UZS {fmtUZS(item.unitPrice * item.quantity * (1 - item.discount / 100))}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {charges.map((c, i) => {
              const amt = c.rateType === 'percentage' ? (subtotal * c.rateValue) / 100 : c.rateValue
              return (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-400">{c.name}</span>
                  <span className="text-white">UZS {fmtUZS(amt)}</span>
                </div>
              )
            })}
            <div className="flex justify-between text-xl font-bold text-primary border-t border-dark-border pt-3">
              <span>{t('payment.totalCaps')}</span>
              <span>UZS {fmtUZS(total)}</span>
            </div>
          </div>
        </div>

        {/* Payments applied */}
        {payments.length > 0 && (
          <div className="bg-dark-surface rounded-2xl border border-dark-border p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">{t('payment.paymentsApplied')}</p>
            <div className="space-y-2">
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between items-center min-h-[48px]">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300 text-sm">{t(PAYMENT_METHODS.find((m) => m.method === p.paymentMethod)?.labelKey ?? 'payment.methodCash')}</span>
                    {p.paymentMethod === 'Debt' && debtContact && (
                      <span className="text-yellow-400 text-xs font-medium">{debtContact.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white text-sm font-medium">UZS {fmtUZS(p.amount)}</span>
                    <button
                      onClick={() => setPayments((prev) => prev.filter((_, j) => j !== i))}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 active:bg-red-500/30 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-dark-border mt-3 pt-3">
              {remaining > 0 ? (
                <div className="flex justify-between text-red-400 font-semibold">
                  <span>{t('payment.remaining')}</span>
                  <span>UZS {fmtUZS(remaining)}</span>
                </div>
              ) : (
                <div className="flex justify-between text-green-400 font-bold text-lg">
                  <span>{t('payment.change')}</span>
                  <span>UZS {fmtUZS(change)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right: Payment entry panel */}
      <div className="w-[340px] bg-dark-surface border-l border-dark-border flex flex-col">
        {/* Method selector */}
        <div className="p-4 border-b border-dark-border shrink-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('payment.paymentMethod')}</p>
          <div className="grid grid-cols-4 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.method}
                onClick={() => { setSelectedMethod(m.method); setError('') }}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-xs font-semibold border transition-all ${
                  selectedMethod === m.method
                    ? 'bg-primary border-primary text-white shadow-lg shadow-primary/30'
                    : 'bg-dark-card border-dark-border text-gray-400 active:text-white'
                }`}
              >
                <span className="text-lg leading-none">{m.icon}</span>
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {selectedMethod === 'Debt' ? (
          /* Debt flow: contact picker + amount */
          <div className="flex-1 p-4 overflow-auto flex flex-col gap-3">
            {debtContact ? (
              /* Selected contact card */
              <div className="bg-dark-card border border-primary/30 rounded-xl p-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <User size={14} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{debtContact.name}</p>
                    {debtContact.phone && (
                      <p className="text-gray-400 text-xs">{debtContact.phone}</p>
                    )}
                    {debtContact.balance > 0 && (
                      <p className="text-yellow-400 text-xs">
                        {t('payment.currentDebt', { amount: `UZS ${fmtUZS(debtContact.balance)}` })}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setDebtContact(null)
                    setPayments((prev) => prev.filter((p) => p.paymentMethod !== 'Debt'))
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors ml-2 shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              /* Contact search + create */
              <>
                <div className="flex gap-2 shrink-0">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                      type="text"
                      placeholder={t('payment.searchNameOrPhone')}
                      value={contactSearch}
                      onChange={(e) => { setContactSearch(e.target.value); setShowCreateContact(false) }}
                      className="w-full bg-dark-card border border-dark-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary/50"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={() => { setShowCreateContact((v) => !v); setContactSearch('') }}
                    title={t('payment.createNewContact')}
                    className={`w-11 h-11 flex items-center justify-center rounded-xl border transition-colors shrink-0 ${
                      showCreateContact
                        ? 'bg-primary border-primary text-white'
                        : 'bg-dark-card border-dark-border text-gray-400 hover:text-primary hover:border-primary/50'
                    }`}
                  >
                    <UserPlus size={16} />
                  </button>
                </div>

                {contactResults.length > 0 && !showCreateContact && (
                  <div className="space-y-1.5 shrink-0">
                    {contactResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setDebtContact(c)
                          setContactSearch('')
                          setContactResults([])
                          setShowCreateContact(false)
                        }}
                        className="w-full text-left bg-dark-card border border-dark-border hover:border-primary/40 rounded-xl px-3 py-2.5 transition-colors"
                      >
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        {c.phone && <p className="text-gray-400 text-xs">{c.phone}</p>}
                        {c.balance > 0 && (
                          <p className="text-yellow-400 text-xs">{t('payment.debtAmount', { amount: `UZS ${fmtUZS(c.balance)}` })}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {showCreateContact && (
                  <div className="bg-dark-card border border-dark-border rounded-xl p-3 space-y-2 shrink-0">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">{t('payment.newContact')}</p>
                    <input
                      type="text"
                      placeholder={t('payment.fullName')}
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      className="w-full bg-dark border border-dark-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary/50"
                    />
                    <div className="flex items-center bg-dark border border-dark-border rounded-lg overflow-hidden focus-within:border-primary/50">
                      <span className="px-3 text-sm text-gray-400 border-r border-dark-border shrink-0 py-2 select-none">+998</span>
                      <input
                        type="tel"
                        placeholder="93 336 3933"
                        value={newContactPhone}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 9)
                          let fmt = digits
                          if (digits.length > 2) fmt = digits.slice(0, 2) + ' ' + digits.slice(2)
                          if (digits.length > 5) fmt = digits.slice(0, 2) + ' ' + digits.slice(2, 5) + ' ' + digits.slice(5)
                          setNewContactPhone(fmt)
                        }}
                        className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => {
                          setShowCreateContact(false)
                          setNewContactName('')
                          setNewContactPhone('')
                        }}
                        className="flex-1 border border-dark-border text-gray-400 rounded-lg py-2 text-sm transition-colors"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        onClick={createContact}
                        disabled={!newContactName.trim() || newContactPhone.replace(/\D/g, '').length < 9 || savingContact}
                        className="flex-1 bg-primary disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
                      >
                        {savingContact ? t('common.saving') : t('common.save')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Amount entry — shown after contact selected */}
            {debtContact && (
              <div className="flex-1 flex flex-col min-h-0">
                <NumPad
                  value={amountInput}
                  onChange={setAmountInput}
                  label={t('payment.debtAmountLabel')}
                />
                <div className="flex gap-2 mt-3 shrink-0">
                  <button
                    onClick={setExact}
                    className="flex-1 h-[72px] rounded-xl font-semibold transition-all active:scale-95 bg-dark-card text-white active:bg-dark-surface border border-dark-border/50 flex flex-col items-center justify-center gap-0.5"
                  >
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">UZS</span>
                    <span className="text-sm">{fmtUZS(remaining)}</span>
                  </button>
                  <button
                    onClick={addPayment}
                    className="flex-1 bg-dark-card border border-dark-border text-white hover:border-primary/50 rounded-lg py-2.5 text-sm font-medium transition-colors"
                  >
                    {t('payment.addPayment')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Normal numpad for Cash / Card / Click */
          <div className="flex-1 p-4 overflow-hidden">
            <NumPad
              value={amountInput}
              onChange={setAmountInput}
              label={t('payment.amountLabel')}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={setExact}
                className="flex-1 h-[72px] rounded-xl font-semibold transition-all active:scale-95 bg-dark-card text-white active:bg-dark-surface border border-dark-border/50 flex flex-col items-center justify-center gap-0.5"
              >
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">UZS</span>
                <span className="text-sm">{fmtUZS(remaining)}</span>
              </button>
              <button
                onClick={addPayment}
                className="flex-1 bg-dark-card border border-dark-border text-white hover:border-primary/50 rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                {t('payment.addPayment')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-4 mb-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl px-4 py-2.5 text-sm">
            {error}
          </div>
        )}

        <div className="p-4 shrink-0">
          <button
            onClick={handleCompleteSale}
            disabled={processing || !canCompleteNow}
            className="w-full bg-primary hover:bg-orange-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-base transition-all"
          >
            {processing ? t('debt.processing') : t('payment.completeSale')}
          </button>
        </div>
      </div>

      <ReceiptModal
        receipt={receipt}
        onClose={() => { setReceipt(null); onComplete() }}
      />
    </div>
  )
}
