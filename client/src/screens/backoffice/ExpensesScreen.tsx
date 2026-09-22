import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { Plus, Receipt } from 'lucide-react'
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
        await window.electronAPI.db.exec(
          `INSERT INTO cash_logs (store_id, transaction_type, amount, source, description, created_by, created_at)
           VALUES (?, 'expense', ?, 'expense', ?, ?, ?)`,
          [store?.id ?? 1, Number(form.amount) * -1, form.description || form.category, user?.id ?? 1, now]
        )
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
        actions={<Button icon={Plus} onClick={() => setShowForm(true)}>{t('expenses.addExpense')}</Button>}
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
    </BackOfficeLayout>
  )
}
