import { useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Search, Warehouse as WarehouseIcon, ArrowRightLeft, PackagePlus } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
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

type Valuation = 'cost' | 'price'

/**
 * Warehouse stock, separate from shop-floor stock (product_stocks.location).
 * Receiving and transfer both go through the same quantity_adjustments delta
 * mechanism ProductsScreen's manual stock-adjust already uses — it's the
 * only path a client-side stock change reaches the server (see
 * packages/sync-engine's quantity_adjustments CHANGE_BUILDER).
 */
export default function WarehouseScreen() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<StockRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [valuation, setValuation] = useState<Valuation>('cost')
  const [loading, setLoading] = useState(true)
  const [receiveTarget, setReceiveTarget] = useState<StockRow | null>(null)
  const [transferTarget, setTransferTarget] = useState<StockRow | null>(null)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadCategories() }, [])
  useEffect(() => { loadRows() }, [debouncedSearch, catFilter])

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

  async function receive(qty: number, reason: string) {
    if (!receiveTarget?.batch_id) return
    const { id: productId, batch_id: batchId } = receiveTarget
    const now = new Date().toISOString()
    let stock = (await window.electronAPI.db.query(
      `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location='warehouse'`,
      [productId, batchId]
    ) as Array<{ id: number; quantity: number }>)[0]
    if (!stock) {
      await window.electronAPI.db.exec(
        `INSERT INTO product_stocks (sync_id,product_id,batch_id,location,quantity,updated_at) VALUES (?,?,?,'warehouse',0,?)`,
        [uuidv4(), productId, batchId, now]
      )
      stock = (await window.electronAPI.db.query(
        `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location='warehouse'`,
        [productId, batchId]
      ) as Array<{ id: number; quantity: number }>)[0]
    }
    const previous = Number(stock.quantity)
    const adjusted = previous + qty
    await window.electronAPI.db.exec(`UPDATE product_stocks SET quantity=?,updated_at=? WHERE id=?`, [adjusted, now, stock.id])
    const adjSyncId = uuidv4()
    await window.electronAPI.db.exec(
      `INSERT INTO quantity_adjustments (sync_id,batch_id,stock_id,previous_quantity,adjusted_quantity,reason,location,created_at,updated_at) VALUES (?,?,?,?,?,?,'warehouse',?,?)`,
      [adjSyncId, batchId, stock.id, previous, adjusted, reason || null, now, now]
    )
    await window.electronAPI.sync.enqueue('quantity_adjustments', adjSyncId, 'upsert')
    window.electronAPI.sync.pushPending().catch(() => {})
  }

  async function transferToShop(qty: number) {
    if (!transferTarget?.batch_id) return
    const { id: productId, batch_id: batchId } = transferTarget
    const now = new Date().toISOString()

    const whRow = (await window.electronAPI.db.query(
      `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location='warehouse'`,
      [productId, batchId]
    ) as Array<{ id: number; quantity: number }>)[0]
    if (!whRow || Number(whRow.quantity) < qty) throw new Error(t('warehouse.notEnoughStock'))

    let shopRow = (await window.electronAPI.db.query(
      `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location='shop'`,
      [productId, batchId]
    ) as Array<{ id: number; quantity: number }>)[0]
    if (!shopRow) {
      await window.electronAPI.db.exec(
        `INSERT INTO product_stocks (sync_id,product_id,batch_id,location,quantity,updated_at) VALUES (?,?,?,'shop',0,?)`,
        [uuidv4(), productId, batchId, now]
      )
      shopRow = (await window.electronAPI.db.query(
        `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location='shop'`,
        [productId, batchId]
      ) as Array<{ id: number; quantity: number }>)[0]
    }

    const whPrev = Number(whRow.quantity), whNew = whPrev - qty
    const shopPrev = Number(shopRow.quantity), shopNew = shopPrev + qty
    await window.electronAPI.db.exec(`UPDATE product_stocks SET quantity=?,updated_at=? WHERE id=?`, [whNew, now, whRow.id])
    await window.electronAPI.db.exec(`UPDATE product_stocks SET quantity=?,updated_at=? WHERE id=?`, [shopNew, now, shopRow.id])

    const adj1 = uuidv4(), adj2 = uuidv4()
    await window.electronAPI.db.exec(
      `INSERT INTO quantity_adjustments (sync_id,batch_id,stock_id,previous_quantity,adjusted_quantity,reason,location,created_at,updated_at) VALUES (?,?,?,?,?,?,'warehouse',?,?)`,
      [adj1, batchId, whRow.id, whPrev, whNew, t('warehouse.transferReasonOut'), now, now]
    )
    await window.electronAPI.db.exec(
      `INSERT INTO quantity_adjustments (sync_id,batch_id,stock_id,previous_quantity,adjusted_quantity,reason,location,created_at,updated_at) VALUES (?,?,?,?,?,?,'shop',?,?)`,
      [adj2, batchId, shopRow.id, shopPrev, shopNew, t('warehouse.transferReasonIn'), now, now]
    )
    await window.electronAPI.sync.enqueue('quantity_adjustments', adj1, 'upsert')
    await window.electronAPI.sync.enqueue('quantity_adjustments', adj2, 'upsert')
    window.electronAPI.sync.pushPending().catch(() => {})
  }

  return (
    <BackOfficeLayout>
      <PageHeader title={t('nav.warehouse')} />

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
            <tr>{[t('common.name'), t('products.category'), t('warehouse.expiry'), t('warehouse.shopQty'), t('warehouse.warehouseQty'), t('warehouse.value'), ''].map((h, i) => (
              <th key={i} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} cols={7} />)}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3 text-white text-sm font-medium">{r.name}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{r.category_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{r.expiry_date ? r.expiry_date.slice(0, 10) : '—'}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{r.shop_qty}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">{r.warehouse_qty}</td>
                <td className="px-4 py-3 text-gray-300 text-sm">UZS {fmtUZS((Number(r.shop_qty) + Number(r.warehouse_qty)) * unitValue(r))}</td>
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
        {!loading && rows.length === 0 && (
          <EmptyState icon={WarehouseIcon} title={t('warehouse.noProducts')} />
        )}
      </div>

      {receiveTarget && (
        <ReceiveModal
          product={receiveTarget}
          onClose={() => setReceiveTarget(null)}
          onConfirm={async (qty, reason) => {
            await receive(qty, reason)
            setReceiveTarget(null)
            loadRows()
          }}
        />
      )}
      {transferTarget && (
        <TransferModal
          product={transferTarget}
          onClose={() => setTransferTarget(null)}
          onConfirm={async (qty) => {
            await transferToShop(qty)
            setTransferTarget(null)
            loadRows()
          }}
        />
      )}
    </BackOfficeLayout>
  )
}

function ReceiveModal({ product, onClose, onConfirm }: {
  product: StockRow; onClose: () => void; onConfirm: (qty: number, reason: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirm() {
    const n = Number(qty)
    if (!n || n <= 0) return
    setSaving(true)
    try {
      await onConfirm(n, reason)
      toast.success(t('warehouse.received'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('warehouse.receive')} — ${product.name}`}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={confirm} loading={saving} disabled={!qty || Number(qty) <= 0}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.quantity')}</label>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.reasonOptional')}</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function TransferModal({ product, onClose, onConfirm }: {
  product: StockRow; onClose: () => void; onConfirm: (qty: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirm() {
    const n = Number(qty)
    if (!n || n <= 0) return
    setSaving(true)
    try {
      await onConfirm(n)
      toast.success(t('warehouse.transferred'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('warehouse.transfer')} — ${product.name}`}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={confirm} loading={saving} disabled={!qty || Number(qty) <= 0}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-xs text-gray-500">{t('warehouse.availableInWarehouse', { qty: product.warehouse_qty })}</p>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('warehouse.quantity')}</label>
          <Input type="number" min={0} max={product.warehouse_qty} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </div>
      </div>
    </Modal>
  )
}
