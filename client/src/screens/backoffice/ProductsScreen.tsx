import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, Check } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, EmptyState, SkeletonRow, PageHeader, Select } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Product {
  id: number; name: string; sku: string | null; barcode: string | null
  category_id: number | null; category_name: string | null; product_type: string
  is_stock_managed: number; is_active: number; alert_quantity: number
  batch_id: number | null; price: number; cost: number; stock: number
  unit: string | null; units_per_package: number | null
}

interface Category { id: number; name: string }

interface ProductForm {
  name: string; sku: string; barcode: string; category_id: string
  price: string; cost: string; alert_quantity: string; is_stock_managed: boolean; is_active: boolean
  unit: string; units_per_package: string
}

const EMPTY_FORM: ProductForm = {
  name: '', sku: '', barcode: '', category_id: '',
  price: '', cost: '', alert_quantity: '5', is_stock_managed: true, is_active: true,
  unit: 'piece', units_per_package: '',
}

export default function ProductsScreen() {
  const { t } = useTranslation()
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
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)
  const debouncedSearch = useDebouncedValue(search)
  // setSaving/setDeleting only disable the button on the *next* render — a
  // few rapid clicks land before that commits and each ran a full extra
  // insert (reported: adding one product created 4 rows). Refs update
  // synchronously, so this guard actually blocks the very next click.
  const submittingRef = useRef(false)

  useEffect(() => { loadAll() }, [debouncedSearch, catFilter])
  useEffect(() => { loadCategories() }, [])

  async function loadAll() {
    let sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.category_id,
             c.name as category_name, p.product_type,
             p.is_stock_managed, p.is_active, p.alert_quantity,
             p.unit, p.units_per_package,
             pb.id as batch_id, pb.price, pb.cost,
             COALESCE(ps.quantity, 0) as stock
      FROM products p
      LEFT JOIN collections c ON c.id = p.category_id
      LEFT JOIN product_batches pb ON pb.id = (
        SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks ps ON ps.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id ORDER BY id DESC LIMIT 1
      )
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
      is_active: Boolean(p.is_active),
      unit: p.unit ?? 'piece', units_per_package: p.units_per_package ? String(p.units_per_package) : '' })
    setShowForm(true)
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.price) return
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    const now = new Date().toISOString()
    try {
      if (editId) {
        await window.electronAPI.db.exec(
          `UPDATE products SET name=?,sku=?,barcode=?,category_id=?,is_stock_managed=?,is_active=?,alert_quantity=?,unit=?,units_per_package=?,updated_at=? WHERE id=?`,
          [form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, form.is_active ? 1 : 0, Number(form.alert_quantity) || 0,
           form.unit, form.unit === 'box' ? (Number(form.units_per_package) || null) : null, now, editId])
        await window.electronAPI.db.exec(
          `UPDATE product_batches SET price=?,cost=?,updated_at=? WHERE product_id=? AND is_active=1`,
          [Number(form.price), Number(form.cost) || 0, now, editId])
        const syncRows = await window.electronAPI.db.query(
          `SELECT p.sync_id AS product_sync_id, b.sync_id AS batch_sync_id
           FROM products p LEFT JOIN product_batches b ON b.id = (
             SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
           )
           WHERE p.id=?`, [editId]
        ) as Array<{ product_sync_id: string; batch_sync_id: string | null }>
        if (syncRows[0]?.product_sync_id) await window.electronAPI.sync.enqueue('products', syncRows[0].product_sync_id, 'upsert')
        if (syncRows[0]?.batch_sync_id) await window.electronAPI.sync.enqueue('product_batches', syncRows[0].batch_sync_id, 'upsert')
      } else {
        const productSyncId = uuidv4()
        const batchSyncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO products (sync_id,name,sku,barcode,category_id,is_stock_managed,alert_quantity,is_active,product_type,unit,units_per_package,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,'simple',?,?,?,?)`,
          [productSyncId, form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, Number(form.alert_quantity) || 0,
           form.unit, form.unit === 'box' ? (Number(form.units_per_package) || null) : null, now, now])
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
    } finally { setSaving(false); submittingRef.current = false }
  }

  async function saveAdjust() {
    if (adjustId === null || !adjustQty.trim()) return
    if (submittingRef.current) return
    submittingRef.current = true
    const p = products.find((x) => x.id === adjustId)
    if (!p || !p.batch_id) { submittingRef.current = false; return }
    try {
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
    } finally { submittingRef.current = false }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    if (submittingRef.current) return
    submittingRef.current = true
    setDeleting(true)
    const now = new Date().toISOString()
    try {
      const row = (await window.electronAPI.db.query(
        `SELECT sync_id FROM products WHERE id=?`, [deleteTarget.id]
      ) as Array<{ sync_id: string }>)[0]
      await window.electronAPI.db.exec(
        `UPDATE products SET deleted_at=?, updated_at=? WHERE id=?`,
        [now, now, deleteTarget.id]
      )
      if (row?.sync_id) await window.electronAPI.sync.enqueue('products', row.sync_id, 'delete')
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('products.deletedToast', { name: deleteTarget.name }))
      setDeleteTarget(null)
      loadAll()
    } finally { setDeleting(false); submittingRef.current = false }
  }

  const f = (k: keyof ProductForm, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.products')}
        actions={<Button icon={Plus} onClick={openCreate}>{t('products.addProduct')}</Button>}
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('products.searchProducts')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <Select
          value={catFilter}
          onChange={setCatFilter}
          options={[
            { value: '', label: t('products.allCategories') },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.name'), t('common.category'), t('common.price'), t('common.cost'), t('common.stock'), t('common.status'), ''].map((h) => (
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
                      className="text-xs text-gray-500 hover:text-primary opacity-0 group-hover:opacity-100 transition-all">{t('products.adjust')}</button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {p.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => openEdit(p)} className="text-gray-500 hover:text-white p-1 rounded">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget(p)} className="text-gray-500 hover:text-red-400 p-1 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && products.length === 0 && (
          <EmptyState icon={Package} title={t('products.noProductsFound')} />
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('products.editProduct') : t('products.newProduct')}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={saveProduct} loading={saving} disabled={!form.name || !form.price}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Input label={t('products.nameRequired')} value={form.name} onChange={(e) => f('name', e.target.value)} />
                </div>
                {[[t('products.sku'), 'sku', t('products.auto')], [t('products.barcode'), 'barcode', t('products.scanOrType')]].map(([label, key, ph]) => (
                  <Input key={key} label={label} placeholder={ph}
                    value={form[key as keyof ProductForm] as string}
                    onChange={(e) => f(key as keyof ProductForm, e.target.value)} />
                ))}
                <Input label={t('products.priceRequired')} type="number" value={form.price} onChange={(e) => f('price', e.target.value)} />
                <Input label={t('products.costUzs')} type="number" value={form.cost} onChange={(e) => f('cost', e.target.value)} />
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t('common.category')}</label>
                  <Select
                    value={form.category_id}
                    onChange={(v) => f('category_id', v)}
                    options={[
                      { value: '', label: t('products.noCategory') },
                      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                </div>
                <Input label={t('products.alertQty')} type="number" value={form.alert_quantity} onChange={(e) => f('alert_quantity', e.target.value)} />
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t('products.unit')}</label>
                  <Select
                    value={form.unit}
                    onChange={(v) => f('unit', v)}
                    options={[
                      { value: 'piece', label: t('products.unitPiece') },
                      { value: 'kg', label: t('products.unitKg') },
                      { value: 'box', label: t('products.unitBox') },
                    ]}
                  />
                </div>
                {form.unit === 'box' && (
                  <Input
                    label={t('products.unitsPerPackage')}
                    type="number"
                    value={form.units_per_package}
                    onChange={(e) => f('units_per_package', e.target.value)}
                    placeholder={t('products.unitsPerPackageHint')}
                  />
                )}
                <div className="col-span-2 flex items-center gap-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button onClick={() => f('is_stock_managed', !form.is_stock_managed)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${form.is_stock_managed ? 'bg-primary' : 'bg-dark-border'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_stock_managed ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">{t('products.trackInventory')}</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button onClick={() => f('is_active', !form.is_active)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${form.is_active ? 'bg-primary' : 'bg-dark-border'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">{t('common.active')}</span>
                  </label>
                </div>
              </div>
            </div>
      </Modal>

      <Modal
        open={adjustId !== null}
        onClose={() => setAdjustId(null)}
        title={<h2 className="text-white font-semibold text-sm">{t('products.adjustStock')}</h2>}
        maxWidth="max-w-[18rem]"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setAdjustId(null)}>{t('common.cancel')}</Button>
            <Button className="flex-1" icon={Check} onClick={saveAdjust}>{t('common.save')}</Button>
          </>
        }
      >
            <div className="p-4 space-y-3">
              <Input label={t('products.newQuantity')} autoFocus type="number" value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)} />
              <Input label={t('products.reason')} value={adjustReason} placeholder={t('products.reasonPlaceholder')}
                onChange={(e) => setAdjustReason(e.target.value)} />
            </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('products.deleteProduct')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete} loading={deleting}>
              {deleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="p-5 text-sm text-gray-400">
          {t('products.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        </div>
      </Modal>
    </BackOfficeLayout>
  )
}
