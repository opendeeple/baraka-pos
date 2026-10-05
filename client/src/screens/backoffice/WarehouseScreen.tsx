import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Search, Warehouse as WarehouseIcon, ArrowRightLeft, PackagePlus, Store, ClipboardCheck, PackageMinus, CalendarClock } from 'lucide-react'
import { loadExpiring, EXPIRING_DAYS, type ExpiringRow } from '../../lib/expiry'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import type { StockLocation } from '../../lib/purchases'
import { moveStock, stockAt, stockOnHand, averageCost } from '../../lib/stock'
import { logAudit } from '../../lib/audit'
import { StocktakeModal } from '../../components/backoffice/StocktakeModal'
import { WriteOffModal } from '../../components/backoffice/WriteOffModal'
import { PendingOrderPicker, loadPendingOrders, type PendingOrder } from '../../components/backoffice/PendingOrderPicker'
import { ReceivePurchaseModal } from '../../components/backoffice/ReceivePurchaseModal'
import { Modal, Button, Input, PageHeader, EmptyState, SkeletonRow, Select } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface StockRow {
  id: number
  name: string
  category_id: number | null
  category_name: string | null
  batch_id: number | null
  cost: number
  price: number
  expiry_date: string | null
  shop_qty: number
  warehouse_qty: number
}

interface Category { id: number; name: string }
interface PickerProduct { id: number; name: string; batch_id: number | null; warehouse_qty: number; cost: number }

type Valuation = 'cost' | 'price'

/**
 * Stock in the shop and the warehouse, and every way it may change outside a
 * sale: receiving a delivery, moving goods to the shop, a stocktake (count
 * and record the differences), and writing off damaged/expired/lost goods.
 * All of them are documents (lib/stock.ts moveStock) — nothing here lets a
 * quantity simply be typed in.
 */
export default function WarehouseScreen() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<StockRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState<'all' | 'shop' | 'warehouse'>('all')
  const [valuation, setValuation] = useState<Valuation>('cost')
  const [loading, setLoading] = useState(true)
  const [receiveTarget, setReceiveTarget] = useState<StockRow | null>(null)
  const [transferTarget, setTransferTarget] = useState<StockRow | null>(null)
  const [showReceivePicker, setShowReceivePicker] = useState(false)
  const [showTransferPicker, setShowTransferPicker] = useState(false)
  const [allProducts, setAllProducts] = useState<PickerProduct[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[] | null>(null)
  const [receivingOrder, setReceivingOrder] = useState<PendingOrder | null>(null)
  const [showStocktake, setShowStocktake] = useState(false)
  const [showWriteOff, setShowWriteOff] = useState(false)
  const [expiring, setExpiring] = useState<ExpiringRow[]>([])
  const debouncedSearch = useDebouncedValue(search)
  useEffect(() => { loadExpiring().then(setExpiring) }, [rows])

  // A delivery usually belongs to an order: while any are waiting, receiving
  // starts by picking one (checked line by line); otherwise straight to the
  // manual receive.
  async function startReceive() {
    const orders = await loadPendingOrders()
    if (orders.length) setPendingOrders(orders)
    else setShowReceivePicker(true)
  }

  useEffect(() => { loadCategories(); loadAllProducts() }, [])
  useEffect(() => { loadRows() }, [debouncedSearch, catFilter])

  // Independent of the page's category/search filter — the general
  // Receive/Transfer buttons let you pick ANY product, not just whichever
  // ones happen to match the current filter.
  async function loadAllProducts() {
    setAllProducts(await window.electronAPI.db.query(`
      SELECT p.id, p.name, pb.id as batch_id, COALESCE(pb.cost, 0) as cost, COALESCE(wh.quantity, 0) as warehouse_qty
      FROM products p
      LEFT JOIN product_batches pb ON pb.id = (
        SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks wh ON wh.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'warehouse' ORDER BY id DESC LIMIT 1
      )
      WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1
      ORDER BY p.name LIMIT 1000
    `, []) as PickerProduct[])
  }

  async function loadCategories() {
    setCategories(await window.electronAPI.db.query(
      `SELECT id, name FROM collections WHERE collection_type='category' AND deleted_at IS NULL ORDER BY name`, []
    ) as Category[])
  }

  async function loadRows() {
    let sql = `
      SELECT p.id, p.name, p.category_id, c.name as category_name,
             pb.id as batch_id, pb.cost, pb.price, pb.expiry_date,
             COALESCE(shop.quantity, 0) as shop_qty,
             COALESCE(wh.quantity, 0) as warehouse_qty
      FROM products p
      LEFT JOIN collections c ON c.id = p.category_id
      LEFT JOIN product_batches pb ON pb.id = (
        SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks shop ON shop.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks wh ON wh.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'warehouse' ORDER BY id DESC LIMIT 1
      )
      WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1`
    const params: unknown[] = []
    if (debouncedSearch.trim()) {
      sql += ` AND p.name LIKE ?`
      params.push(`%${debouncedSearch}%`)
    }
    if (catFilter) { sql += ` AND p.category_id = ?`; params.push(catFilter) }
    sql += ` ORDER BY p.name LIMIT 300`
    setLoading(true)
    try {
      setRows(await window.electronAPI.db.query(sql, params) as StockRow[])
    } finally { setLoading(false) }
  }

  const unitValue = (r: StockRow) => Number(valuation === 'cost' ? r.cost : r.price)

  const totals = useMemo(() => {
    let shopQty = 0, shopValue = 0, whQty = 0, whValue = 0
    for (const r of rows) {
      const v = unitValue(r)
      shopQty += Number(r.shop_qty); shopValue += Number(r.shop_qty) * v
      whQty += Number(r.warehouse_qty); whValue += Number(r.warehouse_qty) * v
    }
    return { shopQty, shopValue, whQty, whValue, totalQty: shopQty + whQty, totalValue: shopValue + whValue }
  }, [rows, valuation])

  // The summary cards above always show shop/warehouse/combined together;
  // this only narrows which ROWS the table lists, so "faqat ombor" (only
  // warehouse) genuinely separates the two instead of always showing every
  // product with both columns side by side.
  const displayRows = useMemo(() => {
    if (locationFilter === 'shop') return rows.filter((r) => Number(r.shop_qty) > 0)
    if (locationFilter === 'warehouse') return rows.filter((r) => Number(r.warehouse_qty) > 0)
    return rows
  }, [rows, locationFilter])

  // A delivery without an order. `location` is asked every time — goods can
  // go straight onto the shop floor (sellable at once) or into the warehouse.
  // The cost price becomes the weighted average of what's on hand and what
  // this delivery cost, not simply the latest price.
  async function receive(productId: number, batchId: number, qty: number, reason: string, location: StockLocation, newCost?: number) {
    const onHand = await stockOnHand(productId, batchId)
    await moveStock({ productId, batchId, location, delta: qty, kind: 'receipt', reason })
    if (newCost !== undefined && newCost > 0) {
      const [batch] = await window.electronAPI.db.query(`SELECT cost, sync_id FROM product_batches WHERE id=?`, [batchId]) as Array<{ cost: number; sync_id: string | null }>
      const cost = averageCost(onHand, Number(batch?.cost ?? 0), qty, newCost)
      if (cost !== Number(batch?.cost ?? 0)) {
        await window.electronAPI.db.exec(`UPDATE product_batches SET cost=?, updated_at=? WHERE id=?`, [cost, new Date().toISOString(), batchId])
        if (batch?.sync_id) await window.electronAPI.sync.enqueue('product_batches', batch.sync_id, 'upsert')
      }
    }
    await logAudit('stock_receive', { entity: 'product', entityId: productId, details: { product: await productName(productId), qty, location, reason, unitCost: newCost ?? null } })
    window.electronAPI.sync.pushPending().catch(() => {})
  }

  // The journal syncs to other devices, where this device's product ids mean
  // nothing — entries carry the name.
  async function productName(productId: number): Promise<string | null> {
    const [p] = await window.electronAPI.db.query(`SELECT name FROM products WHERE id=?`, [productId]) as Array<{ name: string }>
    return p?.name ?? null
  }

  async function transferToShop(productId: number, batchId: number, qty: number) {
    if ((await stockAt(productId, batchId, 'warehouse')) < qty) throw new Error(t('warehouse.notEnoughStock'))
    await moveStock({ productId, batchId, location: 'warehouse', delta: -qty, kind: 'transfer', reason: t('warehouse.transferReasonOut') })
    await moveStock({ productId, batchId, location: 'shop', delta: qty, kind: 'transfer', reason: t('warehouse.transferReasonIn') })
    await logAudit('stock_transfer', { entity: 'product', entityId: productId, details: { product: await productName(productId), qty, from: 'warehouse', to: 'shop' } })
    window.electronAPI.sync.pushPending().catch(() => {})
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.warehouse')}
        subtitle={t('pageHints.warehouse')}
        actions={
          <>
            <Button variant="secondary" icon={PackagePlus} onClick={startReceive}>
              {t('warehouse.receive')}
            </Button>
            <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setShowTransferPicker(true)}>
              {t('warehouse.transfer')}
            </Button>
            <Button variant="secondary" icon={ClipboardCheck} onClick={() => setShowStocktake(true)}>
              {t('stocktake.title')}
            </Button>
            <Button variant="secondary" icon={PackageMinus} onClick={() => setShowWriteOff(true)}>
              {t('writeoff.title')}
            </Button>
          </>
        }
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border grid grid-cols-3 gap-3">
        <div className="bg-dark-card border border-dark-border rounded-lg p-3">
          <p className="text-xs text-gray-500">{t('warehouse.inShop')}</p>
          <p className="text-white font-semibold text-sm">{totals.shopQty} {t('warehouse.units')}</p>
          <p className="text-green-400 text-xs">UZS {fmtUZS(totals.shopValue)}</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-lg p-3">
          <p className="text-xs text-gray-500">{t('warehouse.inWarehouse')}</p>
          <p className="text-white font-semibold text-sm">{totals.whQty} {t('warehouse.units')}</p>
          <p className="text-green-400 text-xs">UZS {fmtUZS(totals.whValue)}</p>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-lg p-3">
          <p className="text-xs text-gray-500">{t('warehouse.total')}</p>
          <p className="text-white font-semibold text-sm">{totals.totalQty} {t('warehouse.units')}</p>
          <p className="text-green-400 text-xs">UZS {fmtUZS(totals.totalValue)}</p>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="shrink-0 mx-6 mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-red-300 font-semibold">
              <CalendarClock size={16} /> {t('dashboard.expiringCount', { count: expiring.length, days: EXPIRING_DAYS })}
            </p>
            <Button size="sm" variant="secondary" icon={PackageMinus} onClick={() => setShowWriteOff(true)}>{t('writeoff.title')}</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {expiring.slice(0, 8).map((r) => (
              <span key={r.batch_id} className={`text-xs px-2.5 py-1 rounded-full ${r.days_left < 0 ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/15 text-yellow-300'}`}>
                {r.name} · {r.stock} · {r.days_left < 0 ? t('warehouse.expiredShort') : t('dashboard.daysLeft', { count: r.days_left })}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.search')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <Select
          value={catFilter}
          onChange={setCatFilter}
          className="w-44 shrink-0"
          options={[{ value: '', label: t('common.all') }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
        />
        <Select
          value={locationFilter}
          onChange={(v) => setLocationFilter(v as 'all' | 'shop' | 'warehouse')}
          className="w-40 shrink-0"
          options={[
            { value: 'all', label: t('warehouse.filterAll') },
            { value: 'shop', label: t('warehouse.filterShopOnly') },
            { value: 'warehouse', label: t('warehouse.filterWarehouseOnly') },
          ]}
        />
        <Select
          value={valuation}
          onChange={(v) => setValuation(v as Valuation)}
          className="w-40 shrink-0"
          options={[
            { value: 'cost', label: t('warehouse.byCost') },
            { value: 'price', label: t('warehouse.byPrice') },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.name'), t('common.category'), t('warehouse.expiry'), t('warehouse.shopQty'), t('warehouse.warehouseQty'), t('warehouse.value'), ''].map((h, i) => (
              <th key={i} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} cols={7} />)}
            {!loading && displayRows.map((r) => (
              <tr key={r.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3 text-white text-sm font-medium">{r.name}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{r.category_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{r.expiry_date ? r.expiry_date.slice(0, 10) : '—'}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{r.shop_qty}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{r.warehouse_qty}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">
                  UZS {fmtUZS((locationFilter === 'shop' ? Number(r.shop_qty) : locationFilter === 'warehouse' ? Number(r.warehouse_qty) : Number(r.shop_qty) + Number(r.warehouse_qty)) * unitValue(r))}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setReceiveTarget(r)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <PackagePlus size={13} /> {t('warehouse.receive')}
                    </button>
                    {r.warehouse_qty > 0 && (
                      <button onClick={() => setTransferTarget(r)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <ArrowRightLeft size={13} /> {t('warehouse.transfer')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && displayRows.length === 0 && (
          <EmptyState icon={WarehouseIcon} title={t('warehouse.noProducts')} />
        )}
      </div>

      {receiveTarget && (
        <ReceiveModal
          product={{ id: receiveTarget.id, name: receiveTarget.name, batch_id: receiveTarget.batch_id, warehouse_qty: receiveTarget.warehouse_qty, cost: receiveTarget.cost }}
          products={allProducts}
          onClose={() => setReceiveTarget(null)}
          onConfirm={async (productId, batchId, qty, reason, location, cost) => {
            await receive(productId, batchId, qty, reason, location, cost)
            setReceiveTarget(null)
            loadRows(); loadAllProducts()
          }}
        />
      )}
      {showReceivePicker && (
        <ReceiveModal
          product={null}
          products={allProducts}
          onClose={() => setShowReceivePicker(false)}
          onConfirm={async (productId, batchId, qty, reason, location, cost) => {
            await receive(productId, batchId, qty, reason, location, cost)
            setShowReceivePicker(false)
            loadRows(); loadAllProducts()
          }}
        />
      )}
      {showStocktake && (
        <StocktakeModal onClose={() => setShowStocktake(false)} onDone={() => { setShowStocktake(false); loadRows(); loadAllProducts() }} />
      )}
      {showWriteOff && (
        <WriteOffModal onClose={() => setShowWriteOff(false)} onDone={() => { setShowWriteOff(false); loadRows(); loadAllProducts() }} />
      )}
      {pendingOrders && (
        <PendingOrderPicker
          orders={pendingOrders}
          onClose={() => setPendingOrders(null)}
          onPick={(o) => { setPendingOrders(null); setReceivingOrder(o) }}
          onWithoutOrder={() => { setPendingOrders(null); setShowReceivePicker(true) }}
        />
      )}
      {receivingOrder && (
        <ReceivePurchaseModal
          purchaseId={receivingOrder.id}
          reference={receivingOrder.reference_number}
          onClose={() => setReceivingOrder(null)}
          onReceived={() => { setReceivingOrder(null); loadRows(); loadAllProducts() }}
        />
      )}
      {transferTarget && (
        <TransferModal
          product={{ id: transferTarget.id, name: transferTarget.name, batch_id: transferTarget.batch_id, warehouse_qty: transferTarget.warehouse_qty }}
          products={allProducts}
          onClose={() => setTransferTarget(null)}
          onConfirm={async (productId, batchId, qty) => {
            await transferToShop(productId, batchId, qty)
            setTransferTarget(null)
            loadRows(); loadAllProducts()
          }}
        />
      )}
      {showTransferPicker && (
        <TransferModal
          product={null}
          products={allProducts}
          onClose={() => setShowTransferPicker(false)}
          onConfirm={async (productId, batchId, qty) => {
            await transferToShop(productId, batchId, qty)
            setShowTransferPicker(false)
            loadRows(); loadAllProducts()
          }}
        />
      )}
    </BackOfficeLayout>
  )
}

interface ModalProduct { id: number; name: string; batch_id: number | null; warehouse_qty: number; cost?: number }

// `product` pre-selected (opened from a row's own button) or null (opened
// from the general header button — the picker below lets you choose any
// product with stock managed, not just ones matching the page's current
// filter).
function ReceiveModal({ product, products, onClose, onConfirm }: {
  product: ModalProduct | null
  products: PickerProduct[]
  onClose: () => void
  onConfirm: (productId: number, batchId: number, qty: number, reason: string, location: StockLocation, cost?: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [pickedId, setPickedId] = useState(product ? String(product.id) : '')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [cost, setCost] = useState(product ? String(product.cost ?? '') : '')
  // No default on purpose: each delivery's destination is chosen explicitly.
  const [location, setLocation] = useState<StockLocation | null>(null)
  const [saving, setSaving] = useState(false)

  const picked = product ?? products.find((p) => String(p.id) === pickedId) ?? null

  // Picking from the dropdown (no pre-selected product): prefill the cost
  // field with that product's current stored cost once chosen, so it reads
  // as "confirm or update" rather than starting blank.
  useEffect(() => {
    if (!product && picked) setCost(String(picked.cost))
  }, [picked?.id])

  async function confirm() {
    const n = Number(qty)
    if (!n || n <= 0 || !picked?.batch_id || !location) return
    setSaving(true)
    try {
      const costNum = cost.trim() === '' ? undefined : Number(cost)
      await onConfirm(picked.id, picked.batch_id, n, reason, location, costNum)
      toast.success(t('purchases.receivedInto', { place: location === 'shop' ? t('purchases.toShop') : t('purchases.toWarehouse') }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? `${t('warehouse.receive')} — ${product.name}` : t('warehouse.receive')}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={confirm} loading={saving} disabled={!picked?.batch_id || !qty || Number(qty) <= 0 || !location}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('purchases.whereToReceive')}</label>
          <div className="grid grid-cols-2 gap-2">
            {(['shop', 'warehouse'] as const).map((loc) => (
              <button
                key={loc}
                onClick={() => setLocation(loc)}
                className={`flex items-center justify-center gap-2 h-11 rounded-lg border text-sm font-medium transition-colors ${
                  location === loc ? 'bg-primary/15 border-primary text-primary' : 'border-dark-border text-gray-300 hover:text-white'
                }`}
              >
                {loc === 'shop' ? <Store size={15} /> : <WarehouseIcon size={15} />}
                {loc === 'shop' ? t('purchases.toShop') : t('purchases.toWarehouse')}
              </button>
            ))}
          </div>
        </div>
        {!product && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('common.name')}</label>
            <Select
              value={pickedId}
              onChange={setPickedId}
              options={[{ value: '', label: '—' }, ...products.filter((p) => p.batch_id).map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.quantity')}</label>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus={Boolean(product)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.unitCost')}</label>
          <Input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t('warehouse.unitCostHint')} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.reasonOptional')}</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function TransferModal({ product, products, onClose, onConfirm }: {
  product: ModalProduct | null
  products: PickerProduct[]
  onClose: () => void
  onConfirm: (productId: number, batchId: number, qty: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [pickedId, setPickedId] = useState(product ? String(product.id) : '')
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)

  const picked = product ?? products.find((p) => String(p.id) === pickedId) ?? null

  async function confirm() {
    const n = Number(qty)
    if (!n || n <= 0 || !picked?.batch_id) return
    setSaving(true)
    try {
      await onConfirm(picked.id, picked.batch_id, n)
      toast.success(t('warehouse.transferred'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? `${t('warehouse.transfer')} — ${product.name}` : t('warehouse.transfer')}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={confirm} loading={saving} disabled={!picked?.batch_id || !qty || Number(qty) <= 0}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {!product && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('common.name')}</label>
            <Select
              value={pickedId}
              onChange={setPickedId}
              options={[{ value: '', label: '—' }, ...products.filter((p) => p.batch_id && p.warehouse_qty > 0).map((p) => ({ value: String(p.id), label: p.name }))]}
            />
          </div>
        )}
        {picked && (
          <p className="text-xs text-gray-500">{t('warehouse.availableInWarehouse', { qty: picked.warehouse_qty })}</p>
        )}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.quantity')}</label>
          <Input type="number" min={0} max={picked?.warehouse_qty ?? 0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus={Boolean(product)} />
        </div>
      </div>
    </Modal>
  )
}
