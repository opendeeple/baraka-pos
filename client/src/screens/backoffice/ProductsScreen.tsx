import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Plus, Search, Edit2, Package, AlertTriangle, X, Check } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Select } from '../../components/ui/Select'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Product {
  id: number; name: string; sku: string | null; barcode: string | null
  category_id: number | null; category_name: string | null; product_type: string
  is_stock_managed: number; is_active: number; alert_quantity: number
  batch_id: number | null; price: number; cost: number; stock: number
}

interface Category { id: number; name: string }

interface ProductForm {
  name: string; sku: string; barcode: string; category_id: string
  price: string; cost: string; alert_quantity: string; is_stock_managed: boolean; is_active: boolean
}

const EMPTY_FORM: ProductForm = {
  name: '', sku: '', barcode: '', category_id: '',
  price: '', cost: '', alert_quantity: '5', is_stock_managed: true, is_active: true,
}

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [adjustId, setAdjustId] = useState<number | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadAll() }, [debouncedSearch, catFilter])
  useEffect(() => { loadCategories() }, [])

  async function loadAll() {
    let sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.category_id,
             c.name as category_name, p.product_type,
             p.is_stock_managed, p.is_active, p.alert_quantity,
             pb.id as batch_id, pb.price, pb.cost,
             COALESCE(ps.quantity, 0) as stock
      FROM products p
      LEFT JOIN collections c ON c.id = p.category_id
      LEFT JOIN product_batches pb ON pb.product_id = p.id AND pb.is_active = 1
      LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.batch_id = pb.id
      WHERE p.deleted_at IS NULL`
    const params: unknown[] = []
    if (debouncedSearch.trim()) {
      sql += ` AND (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)`
      const q = `%${debouncedSearch}%`; params.push(q, q, q)
    }
    if (catFilter) { sql += ` AND p.category_id = ?`; params.push(catFilter) }
    sql += ` ORDER BY p.name LIMIT 200`
    setProducts(await window.electronAPI.db.query(sql, params) as Product[])
  }

  async function loadCategories() {
    setCategories(await window.electronAPI.db.query(
      `SELECT id, name FROM collections WHERE collection_type='category' ORDER BY name`, []
    ) as Category[])
  }

  function openCreate() { setEditId(null); setForm(EMPTY_FORM); setShowForm(true) }
  function openEdit(p: Product) {
    setEditId(p.id)
    setForm({ name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      category_id: p.category_id ? String(p.category_id) : '',
      price: String(p.price), cost: String(p.cost),
      alert_quantity: String(p.alert_quantity), is_stock_managed: Boolean(p.is_stock_managed),
      is_active: Boolean(p.is_active) })
    setShowForm(true)
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.price) return
    setSaving(true)
    const now = new Date().toISOString()
    try {
      if (editId) {
        await window.electronAPI.db.exec(
          `UPDATE products SET name=?,sku=?,barcode=?,category_id=?,is_stock_managed=?,is_active=?,alert_quantity=?,updated_at=? WHERE id=?`,
          [form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, form.is_active ? 1 : 0, Number(form.alert_quantity) || 0, now, editId])
        await window.electronAPI.db.exec(
          `UPDATE product_batches SET price=?,cost=?,updated_at=? WHERE product_id=? AND is_active=1`,
          [Number(form.price), Number(form.cost) || 0, now, editId])
        const syncRows = await window.electronAPI.db.query(
          `SELECT p.sync_id AS product_sync_id, b.sync_id AS batch_sync_id
           FROM products p LEFT JOIN product_batches b ON b.product_id = p.id AND b.is_active = 1
           WHERE p.id=?`, [editId]
        ) as Array<{ product_sync_id: string; batch_sync_id: string | null }>
        if (syncRows[0]?.product_sync_id) await window.electronAPI.sync.enqueue('products', syncRows[0].product_sync_id, 'upsert')
        if (syncRows[0]?.batch_sync_id) await window.electronAPI.sync.enqueue('product_batches', syncRows[0].batch_sync_id, 'upsert')
      } else {
        const productSyncId = uuidv4()
        const batchSyncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO products (sync_id,name,sku,barcode,category_id,is_stock_managed,alert_quantity,is_active,product_type,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,'simple',?,?)`,
          [productSyncId, form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, Number(form.alert_quantity) || 0, now, now])
        const rows = await window.electronAPI.db.query(`SELECT last_insert_rowid() as id`, []) as Array<{id:number}>
        const pid = rows[0].id
        await window.electronAPI.db.exec(
          `INSERT INTO product_batches (sync_id,product_id,price,cost,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`,
          [batchSyncId, pid, Number(form.price), Number(form.cost) || 0, now, now])
        const bRows = await window.electronAPI.db.query(`SELECT id FROM product_batches WHERE product_id=? LIMIT 1`, [pid]) as Array<{id:number}>
        await window.electronAPI.db.exec(
          `INSERT INTO product_stocks (sync_id,product_id,batch_id,quantity,updated_at) VALUES (?,?,?,0,?)`,
          [uuidv4(), pid, bRows[0].id, now])
        await window.electronAPI.sync.enqueue('products', productSyncId, 'upsert')
        await window.electronAPI.sync.enqueue('product_batches', batchSyncId, 'upsert')
      }
      window.electronAPI.sync.pushPending().catch(() => {})
      setShowForm(false); loadAll()
    } finally { setSaving(false) }
  }

  async function saveAdjust() {
    if (adjustId === null || !adjustQty.trim()) return
    const p = products.find((x) => x.id === adjustId)
    if (!p || !p.batch_id) return
    const now = new Date().toISOString()
    await window.electronAPI.db.exec(
      `UPDATE product_stocks SET quantity=?,updated_at=? WHERE product_id=? AND batch_id=?`,
      [Number(adjustQty), now, adjustId, p.batch_id])
    // Always record the adjustment — it is the unit of stock sync (deltas).
    const adjSyncId = uuidv4()
    const stockRow = await window.electronAPI.db.query(`SELECT id FROM product_stocks WHERE product_id=? AND batch_id=?`, [adjustId, p.batch_id]) as Array<{id:number}>
    await window.electronAPI.db.exec(
      `INSERT INTO quantity_adjustments (sync_id,batch_id,stock_id,previous_quantity,adjusted_quantity,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [adjSyncId, p.batch_id, stockRow[0]?.id, p.stock, Number(adjustQty), adjustReason || null, now, now])
    await window.electronAPI.sync.enqueue('quantity_adjustments', adjSyncId, 'upsert')
    window.electronAPI.sync.pushPending().catch(() => {})
    setAdjustId(null); setAdjustQty(''); setAdjustReason(''); loadAll()
  }

  const f = (k: keyof ProductForm, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <BackOfficeLayout>
      <div className="shrink-0 px-6 py-4 border-b border-dark-border bg-dark-surface flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Products</h1>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-primary hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus size={15} /> Add Product
        </button>
      </div>

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…"
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <Select
          value={catFilter}
          onChange={setCatFilter}
          options={[
            { value: '', label: 'All Categories' },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{['Product', 'Category', 'Price', 'Cost', 'Stock', 'Status', ''].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3">
                  <p className="text-white text-sm font-medium">{p.name}</p>
                  {p.barcode && <p className="text-gray-500 text-xs">{p.barcode}</p>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">{p.category_name ?? '—'}</td>
                <td className="px-4 py-3 text-white text-sm">UZS {fmtUZS(Number(p.price))}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">UZS {fmtUZS(Number(p.cost))}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${p.stock === 0 ? 'text-red-400' : p.stock <= p.alert_quantity ? 'text-yellow-400' : 'text-white'}`}>{p.stock}</span>
                    {p.stock <= p.alert_quantity && p.is_stock_managed === 1 && <AlertTriangle size={12} className="text-yellow-400" />}
                    <button onClick={() => { setAdjustId(p.id); setAdjustQty(String(p.stock)) }}
                      className="text-xs text-gray-500 hover:text-primary opacity-0 group-hover:opacity-100 transition-all">Adjust</button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(p)} className="text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all p-1 rounded">
                    <Edit2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600">
            <Package size={40} className="mb-3 opacity-30" /><p className="text-sm">No products found</p>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-dark-border">
              <h2 className="text-white font-semibold">{editId ? 'Edit Product' : 'New Product'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">Name *</label>
                  <input value={form.name} onChange={(e) => f('name', e.target.value)}
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
                {[['SKU', 'sku', 'AUTO'], ['Barcode', 'barcode', 'Scan or type']].map(([label, key, ph]) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <input value={form[key as keyof ProductForm] as string} onChange={(e) => f(key as keyof ProductForm, e.target.value)} placeholder={ph}
                      className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price (UZS) *</label>
                  <input type="number" value={form.price} onChange={(e) => f('price', e.target.value)}
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Cost (UZS)</label>
                  <input type="number" value={form.cost} onChange={(e) => f('cost', e.target.value)}
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Category</label>
                  <Select
                    value={form.category_id}
                    onChange={(v) => f('category_id', v)}
                    options={[
                      { value: '', label: 'No category' },
                      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Alert Qty</label>
                  <input type="number" value={form.alert_quantity} onChange={(e) => f('alert_quantity', e.target.value)}
                    className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
                <div className="col-span-2 flex items-center gap-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button onClick={() => f('is_stock_managed', !form.is_stock_managed)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${form.is_stock_managed ? 'bg-primary' : 'bg-dark-border'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_stock_managed ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">Track inventory</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button onClick={() => f('is_active', !form.is_active)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${form.is_active ? 'bg-primary' : 'bg-dark-border'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">Active</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="p-5 pt-0 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={saveProduct} disabled={saving || !form.name || !form.price}
                className="flex-1 bg-primary disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {adjustId !== null && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl w-72">
            <div className="flex items-center justify-between p-4 border-b border-dark-border">
              <h2 className="text-white font-semibold text-sm">Adjust Stock</h2>
              <button onClick={() => setAdjustId(null)} className="text-gray-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">New Quantity</label>
                <input autoFocus type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Reason</label>
                <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="e.g. Stock count"
                  className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary" />
              </div>
            </div>
            <div className="p-4 pt-0 flex gap-2">
              <button onClick={() => setAdjustId(null)} className="flex-1 border border-dark-border text-gray-400 rounded-xl py-2">Cancel</button>
              <button onClick={saveAdjust} className="flex-1 bg-primary text-white rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-1.5">
                <Check size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </BackOfficeLayout>
  )
}
