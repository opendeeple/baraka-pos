import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Plus, Search, Edit2, Package, AlertTriangle, Check } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, EmptyState, SkeletonRow, PageHeader, Select } from '../../components/ui'
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
  const [loading, setLoading] = useState(true)
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
    setLoading(true)
    try {
      setProducts(await window.electronAPI.db.query(sql, params) as Product[])
    } finally { setLoading(false) }
  }

  async function loadCategories() {
    setCategories(await window.electronAPI.db.query(
      `SELECT id, name FROM collections WHERE collection_type='category' AND deleted_at IS NULL ORDER BY name`, []
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
      <PageHeader
        title="Products"
        actions={<Button icon={Plus} onClick={openCreate}>Add Product</Button>}
      />

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
            {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={7} />)}
            {!loading && products.map((p) => (
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
        {!loading && products.length === 0 && (
          <EmptyState icon={Package} title="No products found" />
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit Product' : 'New Product'}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button className="flex-1" onClick={saveProduct} loading={saving} disabled={!form.name || !form.price}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Input label="Name *" value={form.name} onChange={(e) => f('name', e.target.value)} />
                </div>
                {[['SKU', 'sku', 'AUTO'], ['Barcode', 'barcode', 'Scan or type']].map(([label, key, ph]) => (
                  <Input key={key} label={label} placeholder={ph}
                    value={form[key as keyof ProductForm] as string}
                    onChange={(e) => f(key as keyof ProductForm, e.target.value)} />
                ))}
                <Input label="Price (UZS) *" type="number" value={form.price} onChange={(e) => f('price', e.target.value)} />
                <Input label="Cost (UZS)" type="number" value={form.cost} onChange={(e) => f('cost', e.target.value)} />
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
                <Input label="Alert Qty" type="number" value={form.alert_quantity} onChange={(e) => f('alert_quantity', e.target.value)} />
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
      </Modal>

      <Modal
        open={adjustId !== null}
        onClose={() => setAdjustId(null)}
        title={<h2 className="text-white font-semibold text-sm">Adjust Stock</h2>}
        maxWidth="max-w-[18rem]"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setAdjustId(null)}>Cancel</Button>
            <Button className="flex-1" icon={Check} onClick={saveAdjust}>Save</Button>
          </>
        }
      >
            <div className="p-4 space-y-3">
              <Input label="New Quantity" autoFocus type="number" value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)} />
              <Input label="Reason" value={adjustReason} placeholder="e.g. Stock count"
                onChange={(e) => setAdjustReason(e.target.value)} />
            </div>
      </Modal>
    </BackOfficeLayout>
  )
}
