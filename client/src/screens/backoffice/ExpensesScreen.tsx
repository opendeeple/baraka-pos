import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Receipt, Calculator, X } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { useAuthStore } from '../../store/auth.store'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, EmptyState, PageHeader, Select, DatePicker, PinConfirmModal } from '../../components/ui'

interface Expense {
  id: number; expense_date: string; category: string; description: string
  amount: number; payment_method: string; reference: string | null; created_at: string
}

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Repairs', 'Owner', 'Other']
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Mobile Money']
const OWNER_CATEGORY = 'Owner'

export default function ExpensesScreen() {
  const { t } = useTranslation()
  const tCategory = (c: string) => t(`expenses.category${c.replace(/\s+/g, '')}`, { defaultValue: c })
  const tPayment = (m: string) => t(`expenses.payment${m.replace(/\s+/g, '')}`, { defaultValue: m })
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  )
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    category: 'Supplies', description: '', amount: '', payment_method: 'Cash', reference: '',
  })
  const [saving, setSaving] = useState(false)
  const [ownerPin, setOwnerPin] = useState('')
  const [pendingOwnerConfirm, setPendingOwnerConfirm] = useState(false)
  const [catFilter, setCatFilter] = useState('')
  const [showEstimate, setShowEstimate] = useState(false)
  const { user, store } = useAuthStore()

  useEffect(() => { loadExpenses() }, [dateFrom, dateTo, catFilter])
  useEffect(() => { loadOwnerPin() }, [])

  async function loadOwnerPin() {
    const rows = await window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='owner_expense_pin' LIMIT 1`, []
    ) as Array<{ meta_value: string }>
    setOwnerPin(rows[0]?.meta_value ?? '')
  }

  async function loadExpenses() {
    let sql = `SELECT id, expense_date, category, description, amount, payment_method, reference, created_at
       FROM expenses WHERE expense_date >= ? AND expense_date <= ? AND deleted_at IS NULL`
    const params: unknown[] = [dateFrom, dateTo]
    if (catFilter) { sql += ` AND category = ?`; params.push(catFilter) }
    sql += ` ORDER BY expense_date DESC, created_at DESC`
    const rows = await window.electronAPI.db.query(sql, params)
    setExpenses(rows as Expense[])
  }

  /** Save button: "Personal (Owner)" expenses need the owner's PIN before
   *  the actual insert runs — everything else saves immediately. */
  function handleSaveClick() {
    if (!form.description.trim() || !form.amount) return
    if (form.category === OWNER_CATEGORY && ownerPin) {
      setPendingOwnerConfirm(true)
      return
    }
    saveExpense()
  }

  async function saveExpense() {
    setSaving(true)
    const now = new Date().toISOString()
    try {
      const syncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO expenses (sync_id,expense_date,category,description,amount,payment_method,reference,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [syncId, form.expense_date, form.category, form.description, Number(form.amount),
         form.payment_method, form.reference || null, user?.id ?? 1, now, now]
      )
      await window.electronAPI.sync.enqueue('expenses', syncId, 'upsert')
      if (form.payment_method === 'Cash') {
        // The cash leaving the drawer is its own synced fact (pushed as a cash_out).
        const cashLogSyncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO cash_logs (sync_id, store_id, transaction_type, amount, source, description, created_by, created_at, updated_at)
           VALUES (?, ?, 'expense', ?, 'expense', ?, ?, ?, ?)`,
          [cashLogSyncId, store?.id ?? 1, Number(form.amount) * -1, form.description || form.category, user?.id ?? 1, now, now]
        )
        await window.electronAPI.sync.enqueue('cash_logs', cashLogSyncId, 'upsert')
      }
      window.electronAPI.sync.pushPending().catch(() => {})
      setShowForm(false)
      setForm({ expense_date: new Date().toISOString().split('T')[0], category: 'Supplies', description: '', amount: '', payment_method: 'Cash', reference: '' })
      loadExpenses()
    } finally { setSaving(false) }
  }

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.expenses')}
        subtitle={<>{t('common.total')}: <span className="text-red-400 font-semibold">UZS {fmtUZS(totalExpenses)}</span></>}
        actions={
          <>
            <Button variant="secondary" icon={Calculator} onClick={() => setShowEstimate(true)}>{t('expenses.purchaseEstimate')}</Button>
            <Button icon={Plus} onClick={() => setShowForm(true)}>{t('expenses.addExpense')}</Button>
          </>
        }
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">{t('expenses.from')}</span>
        <DatePicker value={dateFrom} onChange={setDateFrom} className="w-36 shrink-0" />
        <span className="text-xs text-gray-500 shrink-0">{t('expenses.to')}</span>
        <DatePicker value={dateTo} onChange={setDateTo} className="w-36 shrink-0" />
        <Select
          value={catFilter}
          onChange={setCatFilter}
          options={[{ value: '', label: t('products.allCategories') }, ...CATEGORIES.map((c) => ({ value: c, label: tCategory(c) }))]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.date'), t('common.category'), t('common.description'), t('expenses.payment'), t('common.amount')].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-dark-card/40">
                <td className="px-4 py-3 text-gray-400 text-sm">{e.expense_date}</td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-dark-card text-gray-300 border border-dark-border">{tCategory(e.category)}</span>
                </td>
                <td className="px-4 py-3 text-white text-sm">{e.description}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{tPayment(e.payment_method)}</td>
                <td className="px-4 py-3 text-red-400 text-sm font-semibold">UZS {fmtUZS(Number(e.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {expenses.length === 0 && (
          <EmptyState icon={Receipt} title={t('expenses.noExpensesInPeriod')} />
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t('expenses.addExpense')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={handleSaveClick} loading={saving} disabled={!form.description || !form.amount}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t('common.date')}</label>
                  <DatePicker value={form.expense_date} onChange={(v) => setForm((p) => ({ ...p, expense_date: v }))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t('common.category')}</label>
                  <Select
                    value={form.category}
                    onChange={(v) => setForm((p) => ({ ...p, category: v }))}
                    options={CATEGORIES.map((c) => ({ value: c, label: tCategory(c) }))}
                  />
                </div>
              </div>
              <Input label={t('expenses.descriptionRequired')} placeholder={t('expenses.descriptionPlaceholder')} value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('expenses.amountRequired')} type="number" placeholder="0.00" value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t('expenses.payment')}</label>
                  <Select
                    value={form.payment_method}
                    onChange={(v) => setForm((p) => ({ ...p, payment_method: v }))}
                    options={PAYMENT_METHODS.map((m) => ({ value: m, label: tPayment(m) }))}
                  />
                </div>
              </div>
              <Input label={t('expenses.reference')} placeholder={t('expenses.referencePlaceholder')} value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} />
            </div>
      </Modal>

      {pendingOwnerConfirm && (
        <PinConfirmModal
          expectedPin={ownerPin}
          title={t('settings.ownerExpensePin')}
          onClose={() => setPendingOwnerConfirm(false)}
          onConfirmed={() => { setPendingOwnerConfirm(false); saveExpense() }}
        />
      )}

      {showEstimate && <PurchaseEstimateModal onClose={() => setShowEstimate(false)} />}
    </BackOfficeLayout>
  )
}

interface EstimateProduct { id: number; name: string; cost: number }

/**
 * A freeform "how much would this cost me" draft — pick any products, any
 * quantities, see a running total from the stored cost price (tannarx).
 * Nothing here ever touches the database: it's local component state only,
 * gone the moment the modal closes. Printing reuses the same
 * printer:printShoppingList path the restock estimate uses, since both are
 * "name/qty/cost list -> printed total", just built differently.
 */
function PurchaseEstimateModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [products, setProducts] = useState<EstimateProduct[]>([])
  const [lines, setLines] = useState<Array<{ id: string; productId: string; qty: string }>>([
    { id: crypto.randomUUID(), productId: '', qty: '1' },
  ])
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name, COALESCE(pb.cost, 0) as cost
       FROM products p
       LEFT JOIN product_batches pb ON pb.id = (
         SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
       )
       WHERE p.deleted_at IS NULL
       ORDER BY p.name`,
      []
    ).then((rows) => setProducts(rows as EstimateProduct[]))
  }, [])

  function addLine() {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), productId: '', qty: '1' }])
  }
  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }
  function setLine(id: string, key: 'productId' | 'qty', value: string) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [key]: value } : l)))
  }

  const resolved = lines
    .map((l) => {
      const p = products.find((pr) => String(pr.id) === l.productId)
      const qty = Number(l.qty) || 0
      return p && qty > 0 ? { name: p.name, qty, cost: p.cost } : null
    })
    .filter((x): x is { name: string; qty: number; cost: number } => x !== null)

  const total = resolved.reduce((s, it) => s + it.qty * it.cost, 0)

  async function print() {
    if (!resolved.length) return
    setPrinting(true)
    try {
      const res = await window.electronAPI.printer.printShoppingList(resolved)
      if (res.success) { toast.success(t('expenses.estimatePrinted')); onClose() }
      else toast.error(res.error || t('expenses.estimateFailed'))
    } finally { setPrinting(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('expenses.purchaseEstimate')}
      maxWidth="max-w-2xl"
      // The total and action buttons live in this footer slot (pinned below
      // children, outside the scrollable list — see Modal.tsx) rather than
      // scrolling with the line list: on the touchscreen till this is used
      // from, "Chop etish" has to stay reachable without hunting for it
      // after adding several products.
      footer={
        <div className="w-full space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{t('expenses.estimateTotal')}</span>
            <span className="text-white text-lg font-bold">UZS {fmtUZS(total)}</span>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.close')}</Button>
            <Button className="flex-1" onClick={print} loading={printing} disabled={!resolved.length}>
              {t('expenses.printEstimate')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-400">{t('expenses.purchaseEstimateHint')}</p>
        {/* Bounded + scrollable so the title/total/buttons around it stay
            reachable on a touchscreen no matter how many lines are added.
            Select's own dropdown is portaled to <body> (see Select.tsx)
            specifically so this scroll container doesn't clip it. */}
        <div className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
          {lines.map((l) => {
            const p = products.find((pr) => String(pr.id) === l.productId)
            return (
              <div key={l.id} className="bg-dark-card border border-dark-border rounded-xl p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Select
                    className="flex-1"
                    value={l.productId}
                    onChange={(v) => setLine(l.id, 'productId', v)}
                    options={[{ value: '', label: '—' }, ...products.map((pr) => ({ value: String(pr.id), label: pr.name }))]}
                  />
                  <button onClick={() => removeLine(l.id)} className="text-gray-500 hover:text-red-400 shrink-0 p-1.5">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 shrink-0">{t('warehouse.quantity')}</label>
                  <Input
                    type="number" min={0} step="any"
                    className="w-24"
                    value={l.qty}
                    onChange={(e) => setLine(l.id, 'qty', e.target.value)}
                  />
                  <span className="flex-1 text-right text-sm text-white font-medium">
                    {p ? `UZS ${fmtUZS((Number(l.qty) || 0) * p.cost)}` : '—'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <Button variant="secondary" icon={Plus} onClick={addLine} className="w-full">{t('expenses.addLine')}</Button>
      </div>
    </Modal>
  )
}
