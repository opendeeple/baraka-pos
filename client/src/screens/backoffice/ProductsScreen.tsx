import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, ImagePlus, X, Tag, Tags } from 'lucide-react'
import { LabelPrintModal } from '../../components/backoffice/LabelPrintModal'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { logAudit } from '../../lib/audit'
import { Modal, Button, Input, EmptyState, SkeletonRow, PageHeader, Select } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { resizeImageDataUrl } from '../../lib/image'
import { labelsHtml, labelGeometry, loadLabelSize } from '../../lib/labels'
import { generateUniqueBarcode } from '../../lib/productBarcodes'
import { useAuthStore } from '../../store/auth.store'

interface Product {
  id: number; name: string; sku: string | null; barcode: string | null
  category_id: number | null; category_name: string | null; product_type: string
  is_stock_managed: number; is_active: number; is_featured: number; alert_quantity: number
  batch_id: number | null; price: number; cost: number; stock: number
  unit: string | null; units_per_package: number | null; piece_price: number | null; image_url: string | null
}

interface Category { id: number; name: string }

interface ProductForm {
  name: string; sku: string; barcode: string; category_id: string
  price: string; cost: string; alert_quantity: string; is_stock_managed: boolean; is_active: boolean; is_featured: boolean
  unit: string; units_per_package: string; piece_price: string; image_url: string
}

const EMPTY_FORM: ProductForm = {
  name: '', sku: '', barcode: '', category_id: '',
  price: '', cost: '', alert_quantity: '5', is_stock_managed: true, is_active: true, is_featured: false,
  unit: 'piece', units_per_package: '', piece_price: '', image_url: '',
}

export default function ProductsScreen() {
  const { t } = useTranslation()
  const { store } = useAuthStore()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  // Extra barcodes this product also answers to (an older batch's packaging,
  // a supplier's own code) — diffed against originalExtraBarcodes on save.
  const [extraBarcodes, setExtraBarcodes] = useState<string[]>([])
  const [originalExtraBarcodes, setOriginalExtraBarcodes] = useState<string[]>([])
  const [newExtraBarcode, setNewExtraBarcode] = useState('')
  const [printingLabel, setPrintingLabel] = useState(false)
  const [noBarcodeToggle, setNoBarcodeToggle] = useState(false)
  const navigate = useNavigate()
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
             p.is_stock_managed, p.is_active, p.is_featured, p.alert_quantity,
             p.unit, p.units_per_package, p.piece_price, p.image_url,
             pb.id as batch_id, pb.price, pb.cost,
             COALESCE(ps.quantity, 0) as stock
      FROM products p
      LEFT JOIN collections c ON c.id = p.category_id
      LEFT JOIN product_batches pb ON pb.id = (
        SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks ps ON ps.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
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

  function openCreate() {
    setEditId(null); setForm(EMPTY_FORM); setExtraBarcodes([]); setOriginalExtraBarcodes([]); setNewExtraBarcode('')
    setNoBarcodeToggle(false)
    setShowForm(true)
  }
  async function openEdit(p: Product) {
    setEditId(p.id)
    setNoBarcodeToggle(false)
    setForm({ name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      category_id: p.category_id ? String(p.category_id) : '',
      price: String(p.price), cost: String(p.cost),
      alert_quantity: String(p.alert_quantity), is_stock_managed: Boolean(p.is_stock_managed),
      is_active: Boolean(p.is_active), is_featured: Boolean(p.is_featured),
      unit: p.unit ?? 'piece', units_per_package: p.units_per_package ? String(p.units_per_package) : '',
      piece_price: p.piece_price ? String(p.piece_price) : '',
      image_url: p.image_url ?? '' })
    const rows = await window.electronAPI.db.query(
      `SELECT barcode FROM product_barcodes WHERE product_id=? AND deleted_at IS NULL ORDER BY id`, [p.id]
    ) as Array<{ barcode: string }>
    const codes = rows.map((r) => r.barcode)
    setExtraBarcodes(codes); setOriginalExtraBarcodes(codes); setNewExtraBarcode('')
    setShowForm(true)
  }

  // Checked as soon as the barcode is entered (blur, or Enter from a
  // scanner) instead of only at save time — catching a re-scanned product
  // right away is the whole point: by the time the rest of the form is
  // filled in and Save is pressed, retyping everything is real lost work.
  async function checkBarcodeLive(raw: string) {
    const code = raw.trim()
    if (!code) return
    const [prodDup] = await window.electronAPI.db.query(
      `SELECT name FROM products WHERE deleted_at IS NULL AND id != ? AND barcode = ? LIMIT 1`,
      [editId ?? -1, code]
    ) as Array<{ name: string }>
    if (prodDup) { toast.error(t('products.duplicateExists', { name: prodDup.name })); return }
    const [aliasDup] = await window.electronAPI.db.query(
      `SELECT p.name FROM product_barcodes pb JOIN products p ON p.id = pb.product_id
       WHERE pb.deleted_at IS NULL AND pb.product_id != ? AND pb.barcode = ? LIMIT 1`,
      [editId ?? -1, code]
    ) as Array<{ name: string }>
    if (aliasDup) toast.error(t('products.duplicateExists', { name: aliasDup.name }))
  }

  function addExtraBarcode() {
    const code = newExtraBarcode.trim()
    if (!code) return
    if (code === form.barcode.trim() || extraBarcodes.includes(code)) {
      toast.error(t('products.duplicateBarcodeInForm', { barcode: code }))
      return
    }
    setExtraBarcodes((prev) => [...prev, code])
    setNewExtraBarcode('')
  }

  // A plain action switch, not a persisted state: flipping it on mints a
  // barcode right away (then it's just an ordinary editable field again,
  // same as one that was typed or scanned in). Flipping it back off clears
  // that generated code back out — switched on by mistake, or changed their
  // mind, shouldn't leave a barcode behind that nobody actually typed.
  async function toggleNoBarcode() {
    const next = !noBarcodeToggle
    setNoBarcodeToggle(next)
    f('barcode', next ? await generateUniqueBarcode() : '')
  }

  // Quick single-label print right from the edit form — the full "Narx
  // etiketkasi" screen (size picker, multiple products) stays for bulk runs.
  async function printThisLabel() {
    if (!form.barcode.trim()) { toast.error(t('labels.noBarcode')); return }
    setPrintingLabel(true)
    try {
      // The sticker size set next to the label printer in Settings.
      const size = await loadLabelSize()
      const html = labelsHtml(
        [{
          name: form.name, price: Number(form.price) || 0, barcode: form.barcode.trim(), unit: form.unit, copies: 1,
          unitsPerPackage: Number(form.units_per_package) || null, piecePrice: Number(form.piece_price) || null,
        }],
        size,
        { storeName: store?.name ?? '', perKg: t('labels.perKg'), perBox: t('labels.perBox'), perPiece: t('labels.perPiece'), currency: t('labels.currency') }
      )
      const res = await window.electronAPI.printer.printBadge(html, labelGeometry(size))
      if (res.success) toast.success(t('labels.printed', { count: 1 }))
      else if (res.error) toast.error(res.error)
    } finally { setPrintingLabel(false) }
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.price) return
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    const now = new Date().toISOString()
    try {
      const barcodeTrimmed = form.barcode.trim()
      const rawBarcodes = [barcodeTrimmed, ...extraBarcodes].filter((b) => b !== '')
      const seenBarcodes = new Set<string>()
      for (const b of rawBarcodes) {
        if (seenBarcodes.has(b)) { toast.error(t('products.duplicateBarcodeInForm', { barcode: b })); return }
        seenBarcodes.add(b)
      }
      const [nameDup] = await window.electronAPI.db.query(
        `SELECT name FROM products WHERE deleted_at IS NULL AND id != ? AND LOWER(name) = LOWER(?) LIMIT 1`,
        [editId ?? -1, form.name.trim()]
      ) as Array<{ name: string }>
      if (nameDup) { toast.error(t('products.duplicateExists', { name: nameDup.name })); return }
      if (seenBarcodes.size) {
        const list = [...seenBarcodes]
        const marks = list.map(() => '?').join(',')
        const [prodDup] = await window.electronAPI.db.query(
          `SELECT name FROM products WHERE deleted_at IS NULL AND id != ? AND barcode IN (${marks}) LIMIT 1`,
          [editId ?? -1, ...list]
        ) as Array<{ name: string }>
        if (prodDup) { toast.error(t('products.duplicateExists', { name: prodDup.name })); return }
        const [aliasDup] = await window.electronAPI.db.query(
          `SELECT p.name FROM product_barcodes pb JOIN products p ON p.id = pb.product_id
           WHERE pb.deleted_at IS NULL AND pb.product_id != ? AND pb.barcode IN (${marks}) LIMIT 1`,
          [editId ?? -1, ...list]
        ) as Array<{ name: string }>
        if (aliasDup) { toast.error(t('products.duplicateExists', { name: aliasDup.name })); return }
      }
      let productId: number
      if (editId) {
        const before = products.find((x) => x.id === editId)
        await window.electronAPI.db.exec(
          `UPDATE products SET name=?,sku=?,barcode=?,category_id=?,is_stock_managed=?,is_active=?,is_featured=?,alert_quantity=?,unit=?,units_per_package=?,piece_price=?,image_url=?,updated_at=? WHERE id=?`,
          [form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, form.is_active ? 1 : 0, form.is_featured ? 1 : 0, Number(form.alert_quantity) || 0,
           form.unit, form.unit === 'box' ? (Number(form.units_per_package) || null) : null,
           form.unit === 'box' ? (Number(form.piece_price) || null) : null,
           form.image_url || null, now, editId])
        // Only the selling price is edited here; the cost price follows what
        // deliveries actually cost (weighted average on every receipt).
        await window.electronAPI.db.exec(
          `UPDATE product_batches SET price=?,updated_at=? WHERE product_id=? AND is_active=1`,
          [Number(form.price), now, editId])
        if (before && Number(before.price) !== Number(form.price)) {
          await logAudit('price_change', { entity: 'product', entityId: editId, details: { product: form.name, from: Number(before.price), to: Number(form.price) } })
        }
        const syncRows = await window.electronAPI.db.query(
          `SELECT p.sync_id AS product_sync_id, b.sync_id AS batch_sync_id
           FROM products p LEFT JOIN product_batches b ON b.id = (
             SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
           )
           WHERE p.id=?`, [editId]
        ) as Array<{ product_sync_id: string; batch_sync_id: string | null }>
        if (syncRows[0]?.product_sync_id) await window.electronAPI.sync.enqueue('products', syncRows[0].product_sync_id, 'upsert')
        if (syncRows[0]?.batch_sync_id) await window.electronAPI.sync.enqueue('product_batches', syncRows[0].batch_sync_id, 'upsert')
        productId = editId
      } else {
        const productSyncId = uuidv4()
        const batchSyncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO products (sync_id,name,sku,barcode,category_id,is_stock_managed,alert_quantity,is_active,is_featured,product_type,unit,units_per_package,piece_price,image_url,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,'simple',?,?,?,?,?,?)`,
          [productSyncId, form.name, form.sku || null, form.barcode || null, form.category_id || null,
           form.is_stock_managed ? 1 : 0, Number(form.alert_quantity) || 0, form.is_featured ? 1 : 0,
           form.unit, form.unit === 'box' ? (Number(form.units_per_package) || null) : null,
           form.unit === 'box' ? (Number(form.piece_price) || null) : null,
           form.image_url || null, now, now])
        const rows = await window.electronAPI.db.query(`SELECT last_insert_rowid() as id`, []) as Array<{id:number}>
        const pid = rows[0].id
        await window.electronAPI.db.exec(
          `INSERT INTO product_batches (sync_id,product_id,price,cost,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`,
          [batchSyncId, pid, Number(form.price), Number(form.cost) || 0, now, now])
        const bRows = await window.electronAPI.db.query(`SELECT id FROM product_batches WHERE product_id=? LIMIT 1`, [pid]) as Array<{id:number}>
        await window.electronAPI.db.exec(
          `INSERT INTO product_stocks (sync_id,product_id,batch_id,location,quantity,updated_at) VALUES (?,?,?,'shop',0,?)`,
          [uuidv4(), pid, bRows[0].id, now])
        await window.electronAPI.sync.enqueue('products', productSyncId, 'upsert')
        await window.electronAPI.sync.enqueue('product_batches', batchSyncId, 'upsert')
        await logAudit('product_create', { entity: 'product', entityId: pid, details: { product: form.name, price: Number(form.price), cost: Number(form.cost) || 0 } })
        productId = pid
      }
      await saveExtraBarcodes(productId)
      window.electronAPI.sync.pushPending().catch(() => {})
      setShowForm(false); loadAll()
    } finally { setSaving(false); submittingRef.current = false }
  }

  async function saveExtraBarcodes(productId: number) {
    const now = new Date().toISOString()
    const toAdd = extraBarcodes.filter((b) => !originalExtraBarcodes.includes(b))
    const toRemove = originalExtraBarcodes.filter((b) => !extraBarcodes.includes(b))
    for (const barcode of toAdd) {
      const syncId = uuidv4()
      await window.electronAPI.db.exec(
        `INSERT INTO product_barcodes (sync_id,product_id,barcode,created_at,updated_at) VALUES (?,?,?,?,?)`,
        [syncId, productId, barcode, now, now]
      )
      await window.electronAPI.sync.enqueue('product_barcodes', syncId, 'upsert')
    }
    for (const barcode of toRemove) {
      const [row] = await window.electronAPI.db.query(
        `SELECT sync_id FROM product_barcodes WHERE product_id=? AND barcode=? AND deleted_at IS NULL LIMIT 1`,
        [productId, barcode]
      ) as Array<{ sync_id: string }>
      if (!row) continue
      await window.electronAPI.db.exec(
        `UPDATE product_barcodes SET deleted_at=?, updated_at=? WHERE product_id=? AND barcode=? AND deleted_at IS NULL`,
        [now, now, productId, barcode]
      )
      await window.electronAPI.sync.enqueue('product_barcodes', row.sync_id, 'delete')
    }
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
      await logAudit('product_delete', { entity: 'product', entityId: deleteTarget.id, details: { product: deleteTarget.name, stock: deleteTarget.stock } })
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('products.deletedToast', { name: deleteTarget.name }))
      setDeleteTarget(null)
      loadAll()
    } finally { setDeleting(false); submittingRef.current = false }
  }

  const f = (k: keyof ProductForm, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  async function pickImage() {
    const picked = await window.electronAPI.files.pickImage()
    if (!picked) return
    const resized = await resizeImageDataUrl(picked)
    f('image_url', resized)
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.products')}
        subtitle={t('pageHints.products')}
        actions={<>
          <Button variant="secondary" icon={Tags} onClick={() => navigate('/backoffice/categories')}>{t('nav.categories')}</Button>
          <Button variant="secondary" icon={Tag} onClick={() => setShowLabels(true)}>{t('labels.button')}</Button>
          <Button icon={Plus} onClick={openCreate}>{t('products.addProduct')}</Button>
        </>}
      />
      {showLabels && <LabelPrintModal onClose={() => setShowLabels(false)} />}

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
            <tr>{['№', t('common.name'), t('common.category'), t('common.price'), t('common.cost'), t('common.stock'), t('common.status'), ''].map((h, i) => (
              <th key={i} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={8} />)}
            {!loading && products.map((p, i) => (
              <tr key={p.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3 text-gray-500 text-sm">{i + 1}</td>
                <td className="px-4 py-3">
                  <p className="text-white text-sm font-medium">{p.name}</p>
                  {p.barcode && <p className="text-gray-500 text-xs">{p.barcode}</p>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">{p.category_name ?? '—'}</td>
                <td className="px-4 py-3 text-white text-sm">
                  UZS {fmtUZS(Number(p.price))}
                  <span className="text-gray-500 text-xs ml-1">
                    /{p.unit === 'kg' ? t('products.unitKg') : p.unit === 'box' ? t('products.unitBox') : t('products.unitPiece')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">UZS {fmtUZS(Number(p.cost))}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${p.stock === 0 ? 'text-red-400' : p.stock <= p.alert_quantity ? 'text-yellow-400' : 'text-white'}`}>{p.stock}</span>
                    {p.stock <= p.alert_quantity && p.is_stock_managed === 1 && <AlertTriangle size={12} className="text-yellow-400" />}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {p.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={pickImage}
                  className="relative w-16 h-16 rounded-xl border border-dashed border-dark-border bg-dark-card flex items-center justify-center shrink-0 overflow-hidden hover:border-primary transition-colors"
                >
                  {form.image_url ? (
                    <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImagePlus size={20} className="text-gray-500" />
                  )}
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <Button variant="secondary" onClick={pickImage} type="button">{t('products.chooseImage')}</Button>
                  {form.image_url && (
                    <button type="button" onClick={() => f('image_url', '')} className="text-gray-500 hover:text-red-400 p-1.5">
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Input label={t('products.nameRequired')} value={form.name} onChange={(e) => f('name', e.target.value)} />
                </div>
                <Input label={t('products.sku')} placeholder={t('products.auto')}
                  value={form.sku} onChange={(e) => f('sku', e.target.value)} />
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-400">{t('products.noBarcodeQuestion')}</label>
                  <button type="button" onClick={toggleNoBarcode}
                    className={`w-10 h-5 rounded-full transition-colors relative ${noBarcodeToggle ? 'bg-primary' : 'bg-dark-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${noBarcodeToggle ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div className="col-span-2 flex items-end gap-1.5">
                  <div className="flex-1">
                    <Input label={t('products.barcode')} placeholder={t('products.scanOrType')}
                      value={form.barcode} onChange={(e) => f('barcode', e.target.value)}
                      onBlur={(e) => checkBarcodeLive(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') checkBarcodeLive(form.barcode) }} />
                  </div>
                  <button type="button" title={t('labels.print')} onClick={printThisLabel} disabled={printingLabel || !form.barcode.trim()}
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-primary disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:border-dark-border">
                    <Tag size={16} />
                  </button>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-gray-400 block">{t('products.extraBarcodes')}</label>
                  {extraBarcodes.map((code) => (
                    <div key={code} className="flex items-center gap-2 bg-dark-card border border-dark-border rounded-lg px-3 py-2">
                      <span className="flex-1 text-sm text-white">{code}</span>
                      <button type="button" onClick={() => setExtraBarcodes((prev) => prev.filter((b) => b !== code))}
                        className="text-gray-500 hover:text-red-400 p-0.5">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <input
                      value={newExtraBarcode}
                      onChange={(e) => setNewExtraBarcode(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtraBarcode() } }}
                      placeholder={t('products.scanOrType')}
                      className="flex-1 bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                    />
                    <button type="button" onClick={addExtraBarcode}
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-primary">
                      <Plus size={16} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">{t('products.extraBarcodesHint')}</p>
                </div>
                <div>
                  <Input
                    label={
                      form.unit === 'kg' ? t('products.priceLabelKg')
                        : form.unit === 'box' ? t('products.priceLabelBox')
                        : t('products.priceLabelPiece')
                    }
                    type="number" value={form.price} onChange={(e) => f('price', e.target.value)}
                  />
                  {form.unit === 'box' && !Number(form.piece_price) && Number(form.units_per_package) > 0 && Number(form.price) > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {t('products.pricePerPieceHint', { price: fmtUZS(Number(form.price) / Number(form.units_per_package)) })}
                    </p>
                  )}
                </div>
                <div>
                  <Input
                    label={
                      form.unit === 'kg' ? t('products.costLabelKg')
                        : form.unit === 'box' ? t('products.costLabelBox')
                        : t('products.costLabelPiece')
                    }
                    type="number" value={form.cost} onChange={(e) => f('cost', e.target.value)}
                    disabled={editId !== null}
                  />
                  {editId !== null && <p className="text-xs text-gray-500 mt-1">{t('products.costFromReceipts')}</p>}
                </div>
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
                {form.unit === 'box' && (
                  <div>
                    <Input
                      label={t('products.piecePriceLabel')}
                      type="number"
                      value={form.piece_price}
                      onChange={(e) => f('piece_price', e.target.value)}
                      placeholder={Number(form.units_per_package) > 0 && Number(form.price) > 0
                        ? fmtUZS(Number(form.price) / Number(form.units_per_package))
                        : ''}
                    />
                    <p className="text-xs text-gray-500 mt-1">{t('products.piecePriceHint')}</p>
                  </div>
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
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button onClick={() => f('is_featured', !form.is_featured)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${form.is_featured ? 'bg-primary' : 'bg-dark-border'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.is_featured ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-gray-400">{t('products.featuredToggle')}</span>
                  </label>
                </div>
              </div>
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
