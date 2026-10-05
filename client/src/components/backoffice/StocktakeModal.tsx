import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, Store, Warehouse, ScanLine } from 'lucide-react'
import { Modal, Button, Input } from '../ui'
import { fmtUZS } from '../../lib/currency'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { moveStock } from '../../lib/stock'
import { logAudit } from '../../lib/audit'
import { useAuthStore } from '../../store/auth.store'
import type { StockLocation } from '../../lib/purchases'

interface Row { id: number; name: string; barcode: string | null; batch_id: number; cost: number; system: number }

interface Props { onClose: () => void; onDone: () => void }

/**
 * Stocktake (inventarizatsiya): count what's physically there, and the
 * system records the differences — each one a stock document with the
 * reason, so a shortage or surplus is explained, never silently overwritten.
 * Only counted products change; a partial count (one shelf) is fine.
 */
export function StocktakeModal({ onClose, onDone }: Props) {
  const { t } = useTranslation()
  const { store } = useAuthStore()
  const [location, setLocation] = useState<StockLocation | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!location) return
    window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, pb.id AS batch_id, COALESCE(pb.cost, 0) AS cost,
              COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = ? ORDER BY id DESC LIMIT 1), 0) AS system
       FROM products p
       JOIN product_batches pb ON pb.id = (SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1)
       WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1
       ORDER BY p.name`,
      [location]
    ).then((r) => setRows((r as Row[]).map((x) => ({ ...x, cost: Number(x.cost), system: Number(x.system) }))))
  }, [location])

  // Scanning a product jumps to its row, ready to type the count.
  useBarcodeScanner((code) => {
    const row = rows.find((r) => r.barcode === code)
    if (!row) { toast.error(t('purchases.barcodeNotFound', { code })); return }
    setSearch('')
    setOnlyDiff(false)
    setTimeout(() => { inputs.current[row.id]?.focus(); inputs.current[row.id]?.select() }, 50)
  })

  const diffOf = (r: Row) => {
    const c = counts[r.id]
    return c === undefined || c.trim() === '' || !Number.isFinite(Number(c)) ? null : Number(c) - r.system
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.barcode === search.trim()) && (!onlyDiff || (diffOf(r) ?? 0) !== 0))
  }, [rows, search, onlyDiff, counts])

  const counted = rows.filter((r) => diffOf(r) !== null)
  const shortages = counted.filter((r) => (diffOf(r) ?? 0) < 0)
  const surpluses = counted.filter((r) => (diffOf(r) ?? 0) > 0)
  const shortValue = shortages.reduce((s, r) => s + Math.abs(diffOf(r)!) * r.cost, 0)
  const surplusValue = surpluses.reduce((s, r) => s + diffOf(r)! * r.cost, 0)

  async function finish() {
    if (!location) return
    setSaving(true)
    try {
      const reason = `${t('stocktake.reason')}${note.trim() ? `: ${note.trim()}` : ''}`
      const changes = counted.filter((r) => diffOf(r) !== 0)
      for (const r of changes) {
        await moveStock({ productId: r.id, batchId: r.batch_id, location, delta: diffOf(r)!, kind: 'stocktake', reason })
      }
      await logAudit('stocktake', {
        entity: 'stock', entityId: location,
        details: {
          location, counted: counted.length, changed: changes.length, note: note.trim() || null,
          shortageValue: shortValue, surplusValue,
          lines: changes.map((r) => ({ product: r.name, system: r.system, counted: Number(counts[r.id]) })),
        },
      })
      window.electronAPI.sync.pushPending().catch(() => {})
      window.electronAPI.printer.printReport({
        title: t('stocktake.title'),
        subtitle: `${store?.name ?? ''} — ${location === 'shop' ? t('purchases.toShop') : t('purchases.toWarehouse')}`,
        lines: [
          { label: t('stocktake.countedProducts'), value: String(counted.length) },
          { label: t('stocktake.shortage'), value: `-${fmtUZS(shortValue)}`, bold: true },
          { label: t('stocktake.surplus'), value: `+${fmtUZS(surplusValue)}`, bold: true },
          { divider: true },
          ...changes.map((r) => ({ label: r.name.slice(0, 22), value: `${r.system} -> ${counts[r.id]}` })),
        ],
      }).catch(() => {})
      toast.success(t('stocktake.done', { count: changes.length }))
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
      title={t('stocktake.title')}
      maxWidth="max-w-3xl"
      footer={
        !location ? (
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
        ) : confirming ? (
          <div className="w-full space-y-3">
            <p className="text-sm text-gray-300 text-center">
              {t('stocktake.confirm', { count: counted.filter((r) => diffOf(r) !== 0).length })}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
              <Button className="flex-1" onClick={finish} loading={saving}>{t('stocktake.finish')}</Button>
            </div>
          </div>
        ) : (
          <div className="w-full flex items-center gap-3">
            <div className="flex-1 text-xs text-gray-400 space-y-0.5">
              <p>{t('stocktake.countedOf', { done: counted.length, total: rows.length })}</p>
              <p>
                <span className="text-red-400">{t('stocktake.shortage')}: {shortages.length} · UZS {fmtUZS(shortValue)}</span>
                {'  '}
                <span className="text-green-400">{t('stocktake.surplus')}: {surpluses.length} · UZS {fmtUZS(surplusValue)}</span>
              </p>
            </div>
            <Button variant="secondary" className="w-32" onClick={onClose}>{t('common.cancel')}</Button>
            <Button className="w-56" onClick={() => setConfirming(true)} disabled={counted.length === 0}>{t('stocktake.finish')}</Button>
          </div>
        )
      }
    >
      {!location ? (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">{t('stocktake.hint')}</p>
          <p className="text-white text-sm font-medium text-center">{t('stocktake.where')}</p>
          <div className="grid grid-cols-2 gap-3">
            {([['shop', Store, t('purchases.toShop')], ['warehouse', Warehouse, t('purchases.toWarehouse')]] as const).map(([value, Icon, label]) => (
              <button key={value} onClick={() => setLocation(value)}
                className="flex flex-col items-center justify-center gap-2 h-28 rounded-xl border border-dark-border bg-dark-card text-white hover:border-primary active:bg-primary/10">
                <Icon size={28} className="text-primary" />
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchases.searchOrScan')}
                className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 shrink-0 px-2">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="w-4 h-4" />
              {t('stocktake.onlyDiff')}
            </label>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-500"><ScanLine size={13} /> {t('stocktake.scanHint')}</p>
          <div className="max-h-[44vh] overflow-y-auto pr-1">
            <table className="w-full">
              <thead className="sticky top-0 bg-dark-surface">
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-2 font-medium">{t('common.name')}</th>
                  <th className="py-2 font-medium text-right w-24">{t('stocktake.system')}</th>
                  <th className="py-2 font-medium text-right w-32">{t('stocktake.counted')}</th>
                  <th className="py-2 font-medium text-right w-24">{t('stocktake.diff')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/60">
                {visible.map((r) => {
                  const d = diffOf(r)
                  return (
                    <tr key={r.id}>
                      <td className="py-2 pr-2 text-sm text-white truncate max-w-0 w-full">{r.name}</td>
                      <td className="py-2 text-sm text-gray-400 text-right">{r.system}</td>
                      <td className="py-1.5 pl-3">
                        <input
                          ref={(el) => { inputs.current[r.id] = el }}
                          type="number" min={0} step="any" inputMode="decimal"
                          value={counts[r.id] ?? ''}
                          onChange={(e) => setCounts((p) => ({ ...p, [r.id]: e.target.value }))}
                          className="w-28 h-10 bg-dark border border-dark-border rounded-lg px-2 text-right text-white text-sm focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className={`py-2 text-sm text-right font-semibold ${d === null ? 'text-gray-600' : d < 0 ? 'text-red-400' : d > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                        {d === null ? '—' : d > 0 ? `+${d}` : d}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Input placeholder={t('stocktake.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Modal>
  )
}
