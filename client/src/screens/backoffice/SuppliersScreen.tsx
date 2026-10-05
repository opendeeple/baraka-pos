import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Search, Truck, X, Edit2, Banknote, Phone } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { Modal, Button, Input, EmptyState, PageHeader } from '../../components/ui'
import { fmtUZS } from '../../lib/currency'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { loadSuppliers, saveSupplier, type Supplier, type SupplierForm } from '../../lib/suppliers'
import { SupplierPayModal } from '../../components/backoffice/SupplierPayModal'

interface OrderRow {
  id: number; reference_number: string | null; status: string; total_amount: number
  amount_paid: number; created_at: string; received_at: string | null
}
interface PaymentRow { id: number; amount: number; payment_method: string | null; description: string | null; created_at: string }

const EMPTY: SupplierForm = { name: '', phone: '', address: '', notes: '' }

/**
 * Suppliers: who the shop buys from, and what it owes each of them — the
 * received deliveries not yet paid for. Paying settles the oldest first.
 */
export default function SuppliersScreen() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [form, setForm] = useState<SupplierForm | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [paying, setPaying] = useState<Supplier | null>(null)

  async function load() {
    const list = await loadSuppliers(debounced)
    setRows(list)
    setSelected((prev) => (prev ? list.find((s) => s.id === prev.id) ?? null : null))
  }
  useEffect(() => { load() }, [debounced])

  async function open(s: Supplier) {
    setSelected(s)
    const [o, p] = await Promise.all([
      window.electronAPI.db.query(
        `SELECT id, reference_number, status, total_amount, COALESCE(amount_paid, 0) AS amount_paid, created_at, received_at
         FROM purchases WHERE vendor_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`, [s.id]),
      window.electronAPI.db.query(
        `SELECT id, ABS(amount) AS amount, payment_method, description, created_at FROM cash_logs
         WHERE contact_id=? AND source='purchase' ORDER BY created_at DESC LIMIT 50`, [s.id]),
    ])
    setOrders(o as OrderRow[])
    setPayments(p as PaymentRow[])
  }

  async function save() {
    if (!form?.name.trim()) return
    setSaving(true)
    try {
      await saveSupplier(editId, form)
      toast.success(t('settings.saved'))
      setForm(null); setEditId(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const totalOwed = rows.reduce((s, r) => s + r.owed, 0)

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.suppliers')}
        subtitle={t('pageHints.suppliers')}
        actions={<Button icon={Plus} onClick={() => { setEditId(null); setForm({ ...EMPTY }) }}>{t('suppliers.new')}</Button>}
      />
      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-4">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('customers.searchByNameOrPhone')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <div className="ml-auto text-sm">
          <span className="text-gray-400">{t('suppliers.totalWeOwe')} </span>
          <span className={`font-bold ${totalOwed > 0 ? 'text-red-400' : 'text-green-400'}`}>UZS {fmtUZS(totalOwed)}</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
              <tr>{[t('suppliers.name'), t('common.phone'), t('suppliers.orders'), t('suppliers.bought'), t('suppliers.weOwe'), ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {rows.map((s) => (
                <tr key={s.id} onClick={() => open(s)} className={`cursor-pointer hover:bg-dark-card/40 ${selected?.id === s.id ? 'bg-dark-card/60' : ''}`}>
                  <td className="px-4 py-3 text-white text-sm font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{s.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{s.orders}</td>
                  <td className="px-4 py-3 text-gray-300 text-sm">UZS {fmtUZS(s.bought)}</td>
                  <td className={`px-4 py-3 text-sm font-semibold ${s.owed > 0 ? 'text-red-400' : 'text-gray-500'}`}>UZS {fmtUZS(s.owed)}</td>
                  <td className="px-4 py-2 text-right">
                    {s.owed > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); setPaying(s) }}
                        className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-lg px-3 py-2 text-xs font-semibold">
                        <Banknote size={14} /> {t('suppliers.pay')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState icon={Truck} title={t('suppliers.empty')} message={t('suppliers.emptyHint')} />}
        </div>

        {selected && (
          <div className="w-96 border-l border-dark-border bg-dark-surface flex flex-col shrink-0">
            <div className="p-4 border-b border-dark-border flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-white font-semibold">{selected.name}</p>
                {selected.phone && <p className="text-gray-500 text-xs flex items-center gap-1"><Phone size={11} /> {selected.phone}</p>}
                {selected.notes && <p className="text-gray-500 text-xs mt-1">{selected.notes}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditId(selected.id); setForm({ name: selected.name, phone: selected.phone ?? '', address: selected.address ?? '', notes: selected.notes ?? '' }) }}
                  className="text-gray-400 hover:text-white p-2"><Edit2 size={14} /></button>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white p-2"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-dark-card rounded-xl p-3">
                  <p className="text-xs text-gray-500">{t('suppliers.bought')}</p>
                  <p className="text-sm font-bold text-white">UZS {fmtUZS(selected.bought)}</p>
                </div>
                <div className="bg-dark-card rounded-xl p-3">
                  <p className="text-xs text-gray-500">{t('suppliers.weOwe')}</p>
                  <p className={`text-sm font-bold ${selected.owed > 0 ? 'text-red-400' : 'text-green-400'}`}>UZS {fmtUZS(selected.owed)}</p>
                </div>
              </div>
              {selected.owed > 0 && (
                <Button icon={Banknote} fullWidth onClick={() => setPaying(selected)}>{t('suppliers.pay')}</Button>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('suppliers.orders')}</p>
                {orders.length === 0 && <p className="text-xs text-gray-600">{t('suppliers.noOrders')}</p>}
                {orders.map((o) => {
                  const due = Number(o.total_amount) - Number(o.amount_paid)
                  return (
                    <div key={o.id} className="flex justify-between items-center py-2 border-b border-dark-border/50 last:border-0">
                      <div>
                        <p className="text-white text-xs font-mono">{o.reference_number ?? o.id}</p>
                        <p className="text-gray-600 text-xs">{new Date(o.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white text-xs font-semibold">UZS {fmtUZS(Number(o.total_amount))}</p>
                        <p className={`text-xs ${o.status !== 'received' ? 'text-yellow-400' : due > 0.001 ? 'text-red-400' : 'text-green-400'}`}>
                          {o.status !== 'received' ? t('purchases.pending') : due > 0.001 ? t('suppliers.dueAmount', { amount: fmtUZS(due) }) : t('suppliers.paidFull')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {payments.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t('suppliers.payments')}</p>
                  {payments.map((p) => (
                    <div key={p.id} className="flex justify-between items-center py-1.5">
                      <div className="min-w-0 mr-2">
                        <p className="text-gray-300 text-xs">{new Date(p.created_at).toLocaleString()}</p>
                        <p className="text-gray-600 text-xs truncate">{t(`suppliers.method_${p.payment_method ?? 'Cash'}`)}{p.description ? ` · ${p.description}` : ''}</p>
                      </div>
                      <span className="text-green-400 text-xs font-semibold shrink-0">UZS {fmtUZS(Number(p.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={form !== null}
        onClose={() => { setForm(null); setEditId(null) }}
        title={editId ? t('suppliers.edit') : t('suppliers.new')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => { setForm(null); setEditId(null) }}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={save} loading={saving} disabled={!form?.name.trim()}>{t('common.save')}</Button>
          </>
        }
      >
        {form && (
          <div className="p-5 space-y-3">
            <Input label={t('suppliers.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            <Input label={t('common.phone')} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label={t('common.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label={t('suppliers.notes')} placeholder={t('suppliers.notesPlaceholder')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        )}
      </Modal>

      {paying && (
        <SupplierPayModal
          supplier={paying}
          onClose={() => setPaying(null)}
          onPaid={async () => {
            const list = await loadSuppliers(debounced)
            setRows(list)
            const s = selected && list.find((x) => x.id === selected.id)
            if (s) open(s)
          }}
        />
      )}
    </BackOfficeLayout>
  )
}
