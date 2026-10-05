import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, X, Minus, Plus, Barcode, Tag } from 'lucide-react'
import { Modal, Button, Select } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useAuthStore } from '../../store/auth.store'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { barcodeSvg, generateInternalBarcode, labelsHtml, LABEL_SIZES, type LabelSize } from '../../lib/labels'

interface Row { id: number; name: string; barcode: string | null; unit: string | null; price: number; sync_id: string | null }
interface Pick { product: Row; copies: number }

/**
 * Price labels for the shelves: pick products (tap, search or scan), how many
 * of each, the sticker size — and print. Products without a barcode can get
 * an in-store one first, so everything on the shelf is scannable. "Narxi
 * o'zgarganlar" picks every product whose price changed today.
 */
export function LabelPrintModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { store } = useAuthStore()
  const [products, setProducts] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [size, setSize] = useState<LabelSize>('58x40')
  const [showStore, setShowStore] = useState(true)
  const [printing, setPrinting] = useState(false)

  async function load() {
    const rows = await window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, p.unit, p.sync_id, COALESCE(pb.price, 0) AS price
       FROM products p
       LEFT JOIN product_batches pb ON pb.id = (SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1)
       WHERE p.deleted_at IS NULL AND p.is_active = 1 ORDER BY p.name`, []
    ) as Row[]
    const list = rows.map((r) => ({ ...r, price: Number(r.price) }))
    setProducts(list)
    setPicks((prev) => prev.map((p) => ({ ...p, product: list.find((r) => r.id === p.product.id) ?? p.product })))
  }
  useEffect(() => { load() }, [])

  const catalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode === search.trim()) : products
  }, [search, products])

  function add(p: Row) {
    setPicks((prev) => prev.some((x) => x.product.id === p.id)
      ? prev.map((x) => (x.product.id === p.id ? { ...x, copies: x.copies + 1 } : x))
      : [...prev, { product: p, copies: 1 }])
  }

  useBarcodeScanner((code) => {
    const p = products.find((r) => r.barcode === code)
    if (p) add(p)
    else toast.error(t('purchases.barcodeNotFound', { code }))
  })

  async function addChangedToday() {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const rows = await window.electronAPI.db.query(
      `SELECT DISTINCT json_extract(details, '$.product') AS name FROM audit_logs WHERE action = 'price_change' AND occurred_at >= ?`,
      [from.toISOString()]
    ) as Array<{ name: string | null }>
    const names = new Set(rows.map((r) => r.name).filter(Boolean))
    const changed = products.filter((p) => names.has(p.name))
    if (changed.length === 0) { toast.info(t('labels.noneChangedToday')); return }
    changed.forEach(add)
    toast.success(t('labels.addedChanged', { count: changed.length }))
  }

  const missing = picks.filter((p) => !barcodeSvg(p.product.barcode))

  // Products without a scannable barcode get an in-store EAN-13 (synced).
  async function assignBarcodes() {
    const now = new Date().toISOString()
    for (const p of missing) {
      let code = generateInternalBarcode()
      for (let i = 0; i < 5; i++) {
        const [dup] = await window.electronAPI.db.query(`SELECT 1 AS x FROM products WHERE barcode = ?`, [code]) as unknown[]
        if (!dup) break
        code = generateInternalBarcode()
      }
      await window.electronAPI.db.exec(`UPDATE products SET barcode = ?, updated_at = ? WHERE id = ?`, [code, now, p.product.id])
      if (p.product.sync_id) await window.electronAPI.sync.enqueue('products', p.product.sync_id, 'upsert')
    }
    window.electronAPI.sync.pushPending().catch(() => {})
    toast.success(t('labels.barcodesAssigned', { count: missing.length }))
    await load()
  }

  const html = (items: Pick[]) => labelsHtml(
    items.map((p) => ({ name: p.product.name, price: p.product.price, barcode: p.product.barcode, unit: p.product.unit, copies: p.copies })),
    size,
    { storeName: showStore ? store?.name ?? '' : '', perKg: t('labels.perKg'), currency: t('labels.currency') }
  )

  async function print() {
    setPrinting(true)
    try {
      const res = await window.electronAPI.printer.printBadge(html(picks))
      if (res.success) toast.success(t('labels.printed', { count: picks.reduce((s, p) => s + p.copies, 0) }))
      else if (res.error) toast.error(res.error)
    } finally { setPrinting(false) }
  }

  const total = picks.reduce((s, p) => s + p.copies, 0)
  const dims = LABEL_SIZES[size]

  return (
    <Modal open onClose={onClose} title={t('labels.title')} maxWidth="max-w-6xl"
      footer={
        <div className="w-full flex items-center gap-3">
          <span className="flex-1 text-sm text-gray-400">{t('labels.total', { count: total })}</span>
          <Button variant="secondary" className="w-40" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="w-56" icon={Tag} onClick={print} loading={printing} disabled={total === 0}>{t('labels.print')}</Button>
        </div>
      }>
      <div className="p-5 grid grid-cols-12 gap-4">
        {/* Catalog */}
        <div className="col-span-4 flex flex-col min-h-0">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchases.searchOrScan')}
              className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
          </div>
          <button onClick={addChangedToday} className="mb-2 h-10 rounded-lg border border-dark-border text-sm text-gray-300 hover:text-white">
            {t('labels.changedToday')}
          </button>
          <div className="h-[48vh] overflow-y-auto space-y-1.5 pr-1">
            {catalog.map((p) => (
              <button key={p.id} onClick={() => add(p)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-dark-border bg-dark-card text-left active:bg-primary/10">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">{p.name}</p>
                  <p className={`text-xs ${p.barcode ? 'text-gray-500' : 'text-yellow-500'}`}>
                    {p.barcode ?? t('labels.noBarcode')} · UZS {fmtUZS(p.price)}
                  </p>
                </div>
                <Plus size={16} className="shrink-0 text-gray-500" />
              </button>
            ))}
          </div>
        </div>

        {/* Picked */}
        <div className="col-span-4 flex flex-col min-h-0">
          <div className="h-[52vh] overflow-y-auto space-y-2 pr-1">
            {picks.length === 0 && <p className="text-center text-gray-500 text-sm py-16">{t('labels.pickHint')}</p>}
            {picks.map((p) => (
              <div key={p.product.id} className="bg-dark-card border border-dark-border rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-white text-sm font-medium truncate">{p.product.name}</p>
                  <button onClick={() => setPicks((prev) => prev.filter((x) => x.product.id !== p.product.id))} className="text-gray-500 hover:text-red-400 p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-xs ${barcodeSvg(p.product.barcode) ? 'text-gray-500' : 'text-yellow-500'}`}>
                    {barcodeSvg(p.product.barcode) ? p.product.barcode : t('labels.noBarcode')}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPicks((prev) => prev.map((x) => x.product.id === p.product.id ? { ...x, copies: Math.max(1, x.copies - 1) } : x))}
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-dark-border text-gray-300"><Minus size={14} /></button>
                    <span className="w-8 text-center text-white text-sm">{p.copies}</span>
                    <button onClick={() => setPicks((prev) => prev.map((x) => x.product.id === p.product.id ? { ...x, copies: x.copies + 1 } : x))}
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-dark-border text-gray-300"><Plus size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Options + preview */}
        <div className="col-span-4 space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('labels.size')}</label>
            <Select value={size} onChange={(v) => setSize(v as LabelSize)}
              options={(Object.keys(LABEL_SIZES) as LabelSize[]).map((k) => ({ value: k, label: `${k.replace('x', ' × ')} mm` }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" className="w-4 h-4" checked={showStore} onChange={(e) => setShowStore(e.target.checked)} />
            {t('labels.showStore')}
          </label>
          {missing.length > 0 && (
            <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
              <p className="text-yellow-200 text-xs">{t('labels.missingBarcodes', { count: missing.length })}</p>
              <Button size="sm" variant="secondary" icon={Barcode} onClick={assignBarcodes}>{t('labels.assignBarcodes')}</Button>
            </div>
          )}
          {picks.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">{t('labels.preview')}</p>
              <div className="bg-white rounded-lg overflow-hidden inline-block" style={{ width: `${dims.w}mm`, height: `${dims.h}mm` }}>
                <iframe title="label" srcDoc={html([{ ...picks[0], copies: 1 }])}
                  style={{ width: `${dims.w}mm`, height: `${dims.h}mm`, border: 0 }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
