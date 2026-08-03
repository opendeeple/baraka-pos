import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Search, Plus, X, Star, ShoppingBag, Users, Edit2 } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, EmptyState, SkeletonRow, PageHeader } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Customer {
  id: number; name: string; phone: string | null; email: string | null
  balance: number; loyalty_points_balance: number; type: string; created_at: string
  total_sales: number; sale_count: number
}

interface CustomerForm { name: string; phone: string; email: string; address: string }

export default function CustomersScreen() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [loyaltyTx, setLoyaltyTx] = useState<Array<{ points: number; type: string; description: string; created_at: string }>>([])
  const [recentSales, setRecentSales] = useState<Array<{ invoice_number: string; total_amount: number; created_at: string }>>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CustomerForm>({ name: '', phone: '', email: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadCustomers() }, [debouncedSearch])

  async function loadCustomers() {
    let sql = `
      SELECT c.id, c.name, c.phone, c.email, c.balance, c.loyalty_points_balance, c.type, c.created_at,
             COALESCE(SUM(s.total_amount), 0) as total_sales,
             COUNT(s.id) as sale_count
      FROM contacts c
      LEFT JOIN sales s ON s.contact_id = c.id AND s.status != 'cancelled'
      WHERE c.type IN ('customer','both') AND c.deleted_at IS NULL`
    const params: unknown[] = []
    if (debouncedSearch.trim()) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`
      const q = `%${debouncedSearch}%`; params.push(q, q, q)
    }
    sql += ` GROUP BY c.id ORDER BY c.name LIMIT 100`
    setLoading(true)
    try {
      setCustomers(await window.electronAPI.db.query(sql, params) as Customer[])
    } finally { setLoading(false) }
  }

  async function loadCustomerDetail(id: number) {
    const [lTx, sales] = await Promise.all([
      window.electronAPI.db.query(
        `SELECT points, type, description, created_at FROM loyalty_point_transactions WHERE contact_id=? ORDER BY created_at DESC LIMIT 20`, [id]
      ),
      window.electronAPI.db.query(
        `SELECT invoice_number, total_amount, created_at FROM sales WHERE contact_id=? AND status!='cancelled' ORDER BY created_at DESC LIMIT 10`, [id]
      ),
    ])
    setLoyaltyTx(lTx as typeof loyaltyTx)
    setRecentSales(sales as typeof recentSales)
  }

  function openCustomer(c: Customer) { setSelected(c); loadCustomerDetail(c.id) }

  async function saveCustomer() {
    if (!form.name.trim()) return
    setSaving(true)
    const now = new Date().toISOString()
    if (editId) {
      await window.electronAPI.db.exec(
        `UPDATE contacts SET name=?,phone=?,email=?,address=?,updated_at=? WHERE id=?`,
        [form.name, form.phone || null, form.email || null, form.address || null, now, editId]
      )
      const [row] = await window.electronAPI.db.query(
        `SELECT sync_id FROM contacts WHERE id=?`, [editId]
      ) as Array<{ sync_id: string }>
      if (row?.sync_id) await window.electronAPI.sync.enqueue('contacts', row.sync_id, 'upsert')
      if (selected?.id === editId) {
        setSelected((prev) => prev ? { ...prev, name: form.name, phone: form.phone || null, email: form.email || null } : null)
      }
    } else {
      const syncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO contacts (sync_id,name,phone,email,address,type,balance,loyalty_points_balance,created_at,updated_at)
         VALUES (?,?,?,?,?,'customer',0,0,?,?)`,
        [syncId, form.name, form.phone || null, form.email || null, form.address || null, now, now]
      )
      await window.electronAPI.sync.enqueue('contacts', syncId, 'upsert')
    }
    window.electronAPI.sync.pushPending().catch(() => {})
    setSaving(false); setShowForm(false); setEditId(null); setForm({ name: '', phone: '', email: '', address: '' }); loadCustomers()
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title="Customers"
        actions={
          <Button icon={Plus} onClick={() => { setEditId(null); setForm({ name: '', phone: '', email: '', address: '' }); setShowForm(true) }}>
            New Customer
          </Button>
        }
      />
      <div className="shrink-0 px-6 py-3 border-b border-dark-border">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone…"
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
              <tr>{['Name', 'Phone', 'Total Spent', 'Purchases', 'Loyalty Pts', 'Balance', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={7} />)}
              {!loading && customers.map((c) => (
                <tr key={c.id} onClick={() => openCustomer(c)} className="hover:bg-dark-card/40 cursor-pointer group">
                  <td className="px-4 py-3">
                    <p className="text-white text-sm font-medium">{c.name}</p>
                    {c.email && <p className="text-gray-500 text-xs">{c.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-primary text-sm font-semibold">UZS {fmtUZS(Number(c.total_sales))}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{c.sale_count}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold ${Number(c.loyalty_points_balance) > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {c.loyalty_points_balance}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${Number(c.balance) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                      UZS {fmtUZS(Number(c.balance))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 group-hover:text-gray-300">›</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && customers.length === 0 && (
            <EmptyState icon={Users} title="No customers yet" />
          )}
        </div>

        {selected && (
          <div className="w-72 border-l border-dark-border bg-dark-surface overflow-y-auto shrink-0">
            <div className="p-4 border-b border-dark-border flex items-center justify-between">
              <div>
                <p className="text-white font-semibold">{selected.name}</p>
                {selected.phone && <p className="text-gray-500 text-xs">{selected.phone}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => {
                  setEditId(selected.id)
                  setForm({ name: selected.name, phone: selected.phone ?? '', email: selected.email ?? '', address: '' })
                  setShowForm(true)
                }} className="text-gray-400 hover:text-white p-1 rounded"><Edit2 size={14} /></button>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white p-1 rounded"><X size={16} /></button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Spent', val: `UZS ${fmtUZS(Number(selected.total_sales))}`, color: 'text-primary' },
                  { label: 'Purchases', val: String(selected.sale_count), color: 'text-white' },
                  { label: 'Loyalty Points', val: String(selected.loyalty_points_balance), color: 'text-yellow-400' },
                  { label: 'Balance', val: `UZS ${fmtUZS(Number(selected.balance))}`, color: Number(selected.balance) < 0 ? 'text-red-400' : 'text-white' },
                ].map((s) => (
                  <div key={s.label} className="bg-dark-card rounded-xl p-3">
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-sm font-bold ${s.color}`}>{s.val}</p>
                  </div>
                ))}
              </div>

              {recentSales.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><ShoppingBag size={11} /> Recent Sales</p>
                  {recentSales.map((s, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-dark-border/50 last:border-0">
                      <div>
                        <p className="text-white text-xs font-mono">{s.invoice_number}</p>
                        <p className="text-gray-600 text-xs">{new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <p className="text-primary text-xs font-semibold">UZS {fmtUZS(Number(s.total_amount))}</p>
                    </div>
                  ))}
                </div>
              )}

              {loyaltyTx.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Star size={11} /> Loyalty History</p>
                  {loyaltyTx.map((tx, i) => (
                    <div key={i} className="flex justify-between items-center py-1.5">
                      <p className="text-gray-400 text-xs flex-1 mr-2 truncate">{tx.description}</p>
                      <span className={`text-xs font-semibold ${tx.points > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.points > 0 ? '+' : ''}{tx.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditId(null) }}
        title={editId ? 'Edit Customer' : 'New Customer'}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</Button>
            <Button className="flex-1" onClick={saveCustomer} loading={saving} disabled={!form.name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-3">
              {[['Name *', 'name', 'text'], ['Phone', 'phone', 'tel'], ['Email', 'email', 'email'], ['Address', 'address', 'text']].map(([label, key, type]) => (
                <Input key={key} label={label} type={type} value={form[key as keyof CustomerForm]}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} />
              ))}
            </div>
      </Modal>
    </BackOfficeLayout>
  )
}
