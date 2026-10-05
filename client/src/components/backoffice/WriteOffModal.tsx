import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Modal, Button, Input } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { moveStock } from '../../lib/stock'
import { logAudit } from '../../lib/audit'
import type { StockLocation } from '../../lib/purchases'

interface Product { id: number; name: string; barcode: string | null; batch_id: number; cost: number; shop: number; warehouse: number }

const REASONS = ['damaged', 'expired', 'lost', 'internal', 'other'] as const
type Reason = typeof REASONS[number]

interface Props { onClose: () => void; onDone: () => void }

/**
 * Writing off goods that can no longer be sold — broken, expired, lost or
 * stolen, used in the shop. Always with a reason (and a note for "other"),
 * never more than is in stock at that place, and shown at what it cost:
 * this is the shop's shrinkage, and the audit journal keeps every one.
 */
export function WriteOffModal({ onClose, onDone }: Props) {
  const { t } = useTranslation()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Product | null>(null)
  const [location, setLocation] = useState<StockLocation>('shop')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, pb.id AS batch_id, COALESCE(pb.cost, 0) AS cost,
              COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1), 0) AS shop,
              COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'warehouse' ORDER BY id DESC LIMIT 1), 0) AS warehouse
       FROM products p
       JOIN product_batches pb ON pb.id = (SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1)
       WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1
       ORDER BY p.name`,
      []
    ).then((r) => setProducts((r as Product[]).map((p) => ({ ...p, cost: Number(p.cost), shop: Number(p.shop), warehouse: Number(p.warehouse) }))))
  }, [])

  useBarcodeScanner((code) => {
    const p = products.find((x) => x.barcode === code)
    if (p) setPicked(p)
    else toast.error(t('purchases.barcodeNotFound', { code }))
  })

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode === search.trim()) : products).slice(0, 60)
  }, [search, products])

  const available = picked ? (location === 'shop' ? picked.shop : picked.warehouse) : 0
  const n = Number(qty)
  const qtyValid = qty.trim() !== '' && Number.isFinite(n) && n > 0 && n <= available
  const valid = picked && qtyValid && reason && (reason !== 'other' || note.trim())

  async function save() {
    if (!picked || !valid || !reason) return
    setSaving(true)
    try {
      const label = t(`writeoff.reason_${reason}`)
      const text = note.trim() ? `${label}: ${note.trim()}` : label
      await moveStock({ productId: picked.id, batchId: picked.batch_id, location, delta: -n, kind: 'writeoff', reason: text })
      await logAudit('writeoff', {
        entity: 'product', entityId: picked.id,
        details: { product: picked.name, qty: n, location, reason, note: note.trim() || null, value: n * picked.cost },
      })
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('writeoff.done', { name: picked.name, qty: n }))
      onDone()
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
      title={t('writeoff.title')}
      maxWidth="max-w-3xl"
      footer={
        <div className="w-full flex items-center gap-3">
          <p className="flex-1 text-sm text-gray-400">
            {picked && qtyValid ? <>{t('writeoff.loss')}: <span className="text-red-400 font-semibold">UZS {fmtUZS(n * picked.cost)}</span></> : null}
          </p>
          <Button variant="secondary" className="w-32" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="w-48" onClick={save} loading={saving} disabled={!valid}>{t('writeoff.save')}</Button>
        </div>
      }
    >
      <div className="p-5 grid grid-cols-5 gap-4">
        <div className="col-span-2 flex flex-col min-h-0">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchases.searchOrScan')}
              className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
          </div>
          <div className="h-[46vh] overflow-y-auto space-y-1.5 pr-1">
            {matches.map((p) => (
              <button key={p.id} onClick={() => setPicked(p)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border ${picked?.id === p.id ? 'border-primary bg-primary/5' : 'border-dark-border bg-dark-card'}`}>
                <p className="text-white text-sm font-medium truncate">{p.name}</p>
                <p className="text-xs text-gray-500">{t('purchases.toShop')}: {p.shop} · {t('purchases.toWarehouse')}: {p.warehouse}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-3 space-y-4">
          {!picked ? (
            <p className="text-center text-gray-500 text-sm py-16">{t('writeoff.pickProduct')}</p>
          ) : (
            <>
              <div>
                <p className="text-white text-lg font-bold">{picked.name}</p>
                <p className="text-xs text-gray-500">{t('writeoff.costEach', { cost: fmtUZS(picked.cost) })}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['shop', 'warehouse'] as const).map((loc) => (
                  <button key={loc} onClick={() => setLocation(loc)}
                    className={`h-11 rounded-lg border text-sm font-medium ${location === loc ? 'bg-primary/15 border-primary text-primary' : 'border-dark-border text-gray-300'}`}>
                    {loc === 'shop' ? t('purchases.toShop') : t('purchases.toWarehouse')} ({loc === 'shop' ? picked.shop : picked.warehouse})
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t('writeoff.qty', { max: available })}</label>
                <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
                {qty.trim() !== '' && !qtyValid && <p className="text-xs text-red-400 mt-1">{t('writeoff.tooMuch', { max: available })}</p>}
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t('writeoff.reason')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((r) => (
                    <button key={r} onClick={() => setReason(r)}
                      className={`h-11 rounded-lg border text-sm ${reason === r ? 'bg-primary/15 border-primary text-primary' : 'border-dark-border text-gray-300'}`}>
                      {t(`writeoff.reason_${r}`)}
                    </button>
                  ))}
                </div>
              </div>
              <Input placeholder={reason === 'other' ? t('writeoff.noteRequired') : t('writeoff.noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
