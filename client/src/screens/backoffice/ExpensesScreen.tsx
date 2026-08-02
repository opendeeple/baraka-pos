import { useEffect, useState } from 'react'
import { Plus, Receipt, X } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { useAuthStore } from '../../store/auth.store'
import { fmtUZS } from '../../lib/currency'
import { Select } from '../../components/ui/Select'
import { DatePicker } from '../../components/ui/DatePicker'

interface Expense {
  id: number; expense_date: string; category: string; description: string
  amount: number; payment_method: string; reference: string | null; created_at: string
}

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Repairs', 'Other']
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Mobile Money']

export default function ExpensesScreen() {
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
  const { user, store } = useAuthStore()

  useEffect(() => { loadExpenses() }, [dateFrom, dateTo])

  async function loadExpenses() {
    const rows = await window.electronAPI.db.query(
      `SELECT id, expense_date, category, description, amount, payment_method, reference, created_at
       FROM expenses WHERE expense_date >= ? AND expense_date <= ? AND deleted_at IS NULL
       ORDER BY expense_date DESC, created_at DESC`,
      [dateFrom, dateTo]
    )
    setExpenses(rows as Expense[])
  }

  async function saveExpense() {
    if (!form.description.trim() || !form.amount) return
    setSaving(true)
    const now = new Date().toISOString()
    try {
      await window.electronAPI.db.exec(
        `INSERT INTO expenses (expense_date,category,description,amount,payment_method,reference,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [form.expense_date, form.category, form.description, Number(form.amount),
         form.payment_method, form.reference || null, user?.id ?? 1, now, now]
      )
      if (form.payment_method === 'Cash') {
        await window.electronAPI.db.exec(
          `INSERT INTO cash_logs (store_id, transaction_type, amount, source, description, created_by, created_at)
           VALUES (?, 'expense', ?, 'expense', ?, ?, ?)`,
          [store?.id ?? 1, Number(form.amount) * -1, form.description || form.category, user?.id ?? 1, now]
        )
      }
      setShowForm(false)
      setForm({ expense_date: new Date().toISOString().split('T')[0], category: 'Supplies', description: '', amount: '', payment_method: 'Cash', reference: '' })
      loadExpenses()
    } finally { setSaving(false) }
  }

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <BackOfficeLayout>
      <div className="shrink-0 px-6 py-4 border-b border-dark-border bg-dark-surface flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Expenses</h1>
          <p className="text-xs text-gray-500 mt-0.5">Total: <span className="text-red-400 font-semibold">UZS {fmtUZS(totalExpenses)}</span></p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus size={15} /> Add Expense
        </button>
      </div>

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">From</span>
        <DatePicker value={dateFrom} onChange={setDateFrom} className="w-36 shrink-0" />
        <span className="text-xs text-gray-500 shrink-0">to</span>
        <DatePicker value={dateTo} onChange={setDateTo} className="w-36 shrink-0" />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{['Date', 'Category', 'Description', 'Payment', 'Amount'].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-dark-card/40">
                <td className="px-4 py-3 text-gray-400 text-sm">{e.expense_date}</td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-dark-card text-gray-300 border border-dark-border">{e.category}</span>
                </td>
                <td className="px-4 py-3 text-white text-sm">{e.description}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{e.payment_method}</td>
                <td className="px-4 py-3 text-red-400 text-sm font-semibold">UZS {fmtUZS(Number(e.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {expenses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600">
            <Receipt size={40} className="mb-3 opacity-30" /><p className="text-sm">No expenses in this period</p>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-dark-border">
              <h2 className="text-white font-semibold">Add Expense</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Date</label>
                  <DatePicker value={form.expense_date} onChange={(v) => setForm((p) => ({ ...p, expense_date: v }))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Category</label>
                  <Select
                    value={form.category}
                    onChange={(v) => setForm((p) => ({ ...p, category: v }))}
                    options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description *</label>
                <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="e.g. Electricity bill"
                  className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Amount (UZS) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00"
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Payment Method</label>
                  <Select
                    value={form.payment_method}
                    onChange={(v) => setForm((p) => ({ ...p, payment_method: v }))}
                    options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Reference</label>
                <input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} placeholder="Receipt #, invoice #"
                  className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
              </div>
            </div>
            <div className="p-5 pt-0 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={saveExpense} disabled={saving || !form.description || !form.amount}
                className="flex-1 bg-primary disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </BackOfficeLayout>
  )
}
