import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, X, Minus, Plus } from 'lucide-react'
import { Modal, Button, Input } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useAuthStore } from '../../store/auth.store'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { createPurchaseOrder, printPurchaseOrder } from '../../lib/purchases'
import { SupplierPicker } from './SupplierPicker'

interface PickProduct {
  id: number; name: string; barcode: string | null; batch_id: number; cost: number
  stock: number; alert_quantity: number; is_stock_managed: number
}
interface Line { key: string; product: PickProduct; qty: string; cost: string }

interface Props {
  onClose: () => void
  onCreated?: (purchaseId: number) => void
}

const isLow = (p: PickProduct) => Boolean(p.is_stock_managed) && p.alert_quantity > 0 && p.stock <= p.alert_quantity

/**
 * Ordering goods on the touchscreen: the product catalog on the left is
 * always visible (running-low products first, with what's left), tapping a
 * product adds it to the order on the right (tapping again adds one more);
 * search or the barcode scanner narrow it down. Estimated unit price comes
 * prefilled from the cost price. Saving creates a waiting ('pending') order
 * and prints its slip; the delivery is checked later (ReceivePurchaseModal).
 */
export function PurchaseOrderModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const { user, store } = useAuthStore()
  const [products, setProducts] = useState<PickProduct[]>([])
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, pb.id AS batch_id, COALESCE(pb.cost, 0) AS cost,
              COALESCE(p.alert_quantity, 0) AS alert_quantity, COALESCE(p.is_stock_managed, 1) AS is_stock_managed,
              COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1), 0)
            + COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'warehouse' ORDER BY id DESC LIMIT 1), 0) AS stock
       FROM products p
       JOIN product_batches pb ON pb.id = (
         SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
       )
       WHERE p.deleted_at IS NULL
       ORDER BY p.name`,
      []
    ).then((rows) => setProducts((rows as PickProduct[]).map((r) => ({
      ...r, cost: Number(r.cost), stock: Number(r.stock), alert_quantity: Number(r.alert_quantity),
    }))))
  }, [])

  // Running-low products first — those are usually what's being ordered.
  const catalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode === search.trim()) : products
    return [...list].sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name))
  }, [search, products])

  function addProduct(p: PickProduct) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === p.id)
      if (i < 0) return [...prev, { key: crypto.randomUUID(), product: p, qty: '1', cost: String(p.cost) }]
      return prev.map((l, j) => (j === i ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
    })
  }

  function addByBarcode(code: string): boolean {
    const p = products.find((pr) => pr.barcode === code)
    if (p) { addProduct(p); setSearch('') }
    return Boolean(p)
  }

  // Scanner while focus is outside any input (the hook ignores inputs) …
  useBarcodeScanner((code) => {
    if (!addByBarcode(code)) toast.error(t('purchases.barcodeNotFound', { code }))
  })

  // … and while it's in the search box, where the scanner types + Enter.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    if (addByBarcode(search.trim())) return
    if (catalog.length === 1) { addProduct(catalog[0]); setSearch('') }
  }

  function setLine(key: string, field: 'qty' | 'cost', value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  function stepQty(key: string, delta: number) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: String(Math.max(1, (Number(l.qty) || 0) + delta)) } : l)))
  }

  const qtyById = new Map(lines.map((l) => [l.product.id, Number(l.qty) || 0]))
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0)
  const valid = lines.length > 0 && lines.every((l) => Number(l.qty) > 0)

  async function save() {
    if (!valid) return
    setSaving(true)
    try {
      const order = await createPurchaseOrder(
        lines.map((l) => ({ productId: l.product.id, batchId: l.product.batch_id, qty: Number(l.qty), unitCost: Number(l.cost) || 0 })),
        { storeId: store?.id ?? 1, userId: user?.id ?? null, note, vendorId }
      )
      toast.success(t('purchases.orderSaved', { ref: order.reference }))
      const printed = await printPurchaseOrder(order.id)
      if (!printed.success) toast.error(t('purchases.printFailed', { error: printed.error ?? '' }))
      onCreated?.(order.id)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('purchases.newOrder')}
      maxWidth="max-w-5xl"
      footer={
        <div className="w-full flex items-center gap-4">
          <div className="flex-1">
            <span className="text-sm text-gray-400 mr-3">{t('purchases.estimatedTotal')}</span>
            <span className="text-white text-lg font-bold">UZS {fmtUZS(total)}</span>
          </div>
          <Button variant="secondary" className="w-40" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="w-56" onClick={save} loading={saving} disabled={!valid}>
            {t('purchases.saveAndPrint')}
          </Button>
        </div>
      }
    >
      <div className="px-5 pt-4"><SupplierPicker value={vendorId} onChange={setVendorId} /></div>
      <div className="p-5 grid grid-cols-5 gap-4">
        {/* Catalog */}
        <div className="col-span-2 flex flex-col min-h-0">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('purchases.searchOrScan')}
              className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-9 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-2">{t('purchases.tapToAdd')}</p>
          <div className="h-[44vh] overflow-y-auto space-y-1.5 pr-1">
            {catalog.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-8">{t('purchases.noProductsFound')}</p>
            )}
            {catalog.map((p) => {
              const inOrder = qtyById.get(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors active:bg-primary/10 ${
                    inOrder ? 'border-primary/60 bg-primary/5' : 'border-dark-border bg-dark-card'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{p.name}</p>
                    <p className={`text-xs ${isLow(p) ? 'text-red-400' : 'text-gray-500'}`}>
                      {t('purchases.stockLeft', { qty: p.stock })} · UZS {fmtUZS(p.cost)}
                    </p>
                  </div>
                  {inOrder ? (
                    <span className="shrink-0 min-w-[2rem] h-7 px-2 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">{inOrder}</span>
                  ) : (
                    <Plus size={16} className="shrink-0 text-gray-500" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Order */}
        <div className="col-span-3 flex flex-col min-h-0">
          <div className="h-[44vh] overflow-y-auto space-y-2 pr-1 mb-3">
            {lines.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-16">{t('purchases.noLinesYet')}</p>
            )}
            {lines.map((l) => (
              <div key={l.key} className="bg-dark-card border border-dark-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-white text-sm font-medium truncate">{l.product.name}</p>
                  <button onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-gray-500 hover:text-red-400 shrink-0 p-1">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex items-end gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.quantity')}</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => stepQty(l.key, -1)} className="w-10 h-10 flex items-center justify-center rounded-lg border border-dark-border text-gray-300 active:bg-dark-surface">
                        <Minus size={16} />
                      </button>
                      <input
                        type="number" min={0} step="any" value={l.qty}
                        onChange={(e) => setLine(l.key, 'qty', e.target.value)}
                        className="w-16 h-10 bg-dark border border-dark-border rounded-lg text-center text-white text-sm focus:outline-none focus:border-primary"
                      />
                      <button onClick={() => stepQty(l.key, 1)} className="w-10 h-10 flex items-center justify-center rounded-lg border border-dark-border text-gray-300 active:bg-dark-surface">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-gray-400 mb-1 block">{t('purchases.estimatedPrice')}</label>
                    <Input type="number" min={0} step="any" value={l.cost} onChange={(e) => setLine(l.key, 'cost', e.target.value)} />
                  </div>
                  <p className="text-right text-sm text-white font-medium pb-2.5 whitespace-nowrap">
                    UZS {fmtUZS((Number(l.qty) || 0) * (Number(l.cost) || 0))}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Input placeholder={t('purchases.optionalNote')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
