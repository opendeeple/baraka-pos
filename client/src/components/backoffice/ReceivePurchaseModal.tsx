import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Store, Warehouse, CheckCircle2, AlertTriangle, ScanLine } from 'lucide-react'
import { Modal, Button, Input } from '../ui'
import { useAuthStore } from '../../store/auth.store'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { receivePurchaseOrder, type StockLocation } from '../../lib/purchases'
import { fmtUZS } from '../../lib/currency'

interface Line { id: number; name: string; barcode: string | null; quantity: number; unit_cost: number }
interface Check { qty: number; note: string | null }

interface Props {
  purchaseId: number
  reference: string
  onClose: () => void
  onReceived: () => void
}

/**
 * Receiving a delivery against its order: first where it goes (shop or
 * warehouse), then the receiver takes the goods in whatever order they come
 * off the truck — scanning a product's barcode (or tapping it in the list)
 * finds it in the order and asks "N of these were ordered, count them:
 * correct?", taking a yes or the real count plus a reason. No forced
 * sequence: after each answer it waits for the next scan. Once every
 * product is answered, a summary and the supplier's invoice prices/expiry,
 * and the whole delivery is received in one go.
 */
export function ReceivePurchaseModal({ purchaseId, reference, onClose, onReceived }: Props) {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const [location, setLocation] = useState<StockLocation | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [checks, setChecks] = useState<Record<number, Check>>({})
  const [active, setActive] = useState<number | null>(null)
  const [differ, setDiffer] = useState(false)
  const [newQty, setNewQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  // Last step, from the supplier's invoice (nakladnoy): the real unit price
  // where it differs from the estimate, and the expiry date on the goods.
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [expiries, setExpiries] = useState<Record<number, string>>({})
  const [lastAnswered, setLastAnswered] = useState<{ name: string; qty: number; note: string | null; ok: boolean } | null>(null)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT pi.id, p.name, p.barcode, pi.quantity, COALESCE(pi.unit_cost, 0) AS unit_cost FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`,
      [purchaseId]
    ).then((rows) => {
      const list = (rows as Line[]).map((r) => ({ ...r, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost) }))
      setLines(list)
      setPrices(Object.fromEntries(list.map((l) => [l.id, String(l.unit_cost)])))
    })
  }, [purchaseId])

  function ask(id: number | null) {
    setActive(id)
    setDiffer(false)
    setNewQty('')
    setReason('')
  }

  function chooseLocation(loc: StockLocation) {
    setLocation(loc)
    ask(null) // waits for the first scan
  }

  // After an answer, back to waiting for the next scan; the last answer
  // stays visible so the receiver sees it was taken.
  function answer(line: Line, check: Check) {
    setChecks((prev) => ({ ...prev, [line.id]: check }))
    setLastAnswered({ name: line.name, ...check, ok: check.qty === line.quantity })
    ask(null)
  }

  function saveDifference(line: Line) {
    const qty = Number(newQty)
    if (newQty.trim() === '' || !Number.isFinite(qty) || qty < 0) return
    // Same count after all is simply correct; a real difference needs a reason.
    if (qty !== line.quantity && !reason.trim()) { toast.error(t('purchases.reasonRequired')); return }
    answer(line, { qty, note: qty === line.quantity ? null : reason.trim() })
  }

  useBarcodeScanner(async (code) => {
    if (!location) { toast.info(t('purchases.chooseLocationFirst')); return }
    const same = lines.filter((l) => l.barcode === code)
    // The same product twice in the order: the unanswered line first; an
    // answered one opens again so its count can be corrected.
    const line = same.find((l) => !checks[l.id]) ?? same[0]
    if (line) {
      ask(line.id)
      if (checks[line.id]) toast.info(t('purchases.alreadyChecked', { name: line.name }))
      return
    }
    const [product] = await window.electronAPI.db.query(
      `SELECT name FROM products WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`, [code]
    ) as Array<{ name: string }>
    if (product) toast.warning(t('purchases.notInOrder', { name: product.name }))
    else toast.error(t('purchases.barcodeNotFound', { code }))
  })

  const doneCount = lines.filter((l) => checks[l.id]).length
  const allChecked = lines.length > 0 && doneCount === lines.length
  const differing = lines.filter((l) => checks[l.id] && checks[l.id].qty !== l.quantity)
  const current = lines.find((l) => l.id === active) ?? null
  const placeName = location === 'shop' ? t('purchases.toShop') : t('purchases.toWarehouse')
  const priceOf = (l: Line) => {
    const v = Number(prices[l.id])
    return prices[l.id]?.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : l.unit_cost
  }
  const invoiceTotal = lines.reduce((s, l) => s + (checks[l.id]?.qty ?? 0) * priceOf(l), 0)

  async function accept() {
    if (!location || !allChecked) return
    setSaving(true)
    try {
      await receivePurchaseOrder(
        purchaseId,
        location,
        lines.map((l) => ({
          itemId: l.id, receivedQty: checks[l.id].qty, note: checks[l.id].note,
          unitCost: priceOf(l), expiryDate: expiries[l.id] || null,
        })),
        user?.id ?? null
      )
      toast.success(t('purchases.receivedInto', { place: placeName }))
      onReceived()
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
      title={`${t('purchases.receiveOrder')} — ${reference}`}
      maxWidth="max-w-2xl"
      footer={
        location ? (
          <div className="w-full flex gap-3">
            <Button variant="secondary" className="w-40" onClick={onClose}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={accept} loading={saving} disabled={!allChecked}>
              {allChecked ? t('purchases.acceptAll') : t('purchases.checkedCount', { done: doneCount, total: lines.length })}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
        )
      }
    >
      {!location ? (
        <div className="p-5 space-y-4">
          <p className="text-white text-sm font-medium text-center">{t('purchases.whereToReceive')}</p>
          <div className="grid grid-cols-2 gap-3">
            {([['shop', Store, t('purchases.toShop')], ['warehouse', Warehouse, t('purchases.toWarehouse')]] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                onClick={() => chooseLocation(value)}
                className="flex flex-col items-center justify-center gap-2 h-28 rounded-xl border border-dark-border bg-dark-card text-white hover:border-primary active:bg-primary/10 transition-colors"
              >
                <Icon size={28} className="text-primary" />
                <span className="text-sm font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 text-center">{t('purchases.orderedItemsCount', { count: lines.length })}</p>
        </div>
      ) : (
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">{t('purchases.receivingInto')} <span className="text-white font-semibold">{placeName}</span></span>
            <button onClick={() => setLocation(null)} className="text-primary hover:underline">{t('purchases.change')}</button>
          </div>

          {/* The question about the scanned/tapped product, the summary once
              all are answered, or else: waiting for the next scan */}
          {current ? (
            <div className="rounded-xl border border-primary bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">{t('purchases.checkedCount', { done: doneCount, total: lines.length })}</p>
                <button onClick={() => ask(null)} className="text-xs text-gray-400 hover:text-white px-2 py-1">{t('purchases.otherProduct')}</button>
              </div>
              <div>
                <p className="text-white text-lg font-bold leading-tight">{current.name}</p>
                <p className="text-gray-300 text-sm mt-1">{t('purchases.orderedQty', { qty: current.quantity })}</p>
              </div>
              <p className="text-sm text-primary font-medium">{t('purchases.countAndCheck')}</p>
              {!differ ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => answer(current, { qty: current.quantity, note: null })}
                    className="flex-1 h-12 bg-green-600 active:bg-green-700 text-white font-semibold rounded-xl text-sm"
                  >
                    {t('purchases.yesCorrect', { qty: current.quantity })}
                  </button>
                  <button
                    onClick={() => { setDiffer(true); setNewQty(String(checks[current.id]?.qty ?? current.quantity)); setReason(checks[current.id]?.note ?? '') }}
                    className="flex-1 h-12 border border-yellow-500/50 text-yellow-400 font-semibold rounded-xl text-sm"
                  >
                    {t('purchases.noDifferent')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">{t('purchases.actualQty')}</label>
                      <Input type="number" min={0} step="any" value={newQty} onChange={(e) => setNewQty(e.target.value)} autoFocus />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-400 mb-1 block">{t('purchases.reason')}</label>
                      <Input value={reason} placeholder={t('purchases.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveDifference(current) }} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setDiffer(false)} className="flex-1 h-11 border border-dark-border text-gray-300 rounded-xl text-sm">
                      {t('common.cancel')}
                    </button>
                    <button onClick={() => saveDifference(current)} className="flex-1 h-11 bg-primary text-white font-semibold rounded-xl text-sm">
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : allChecked ? (
            differing.length === 0 ? (
              <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-3">
                <CheckCircle2 size={22} className="text-green-400 shrink-0" />
                <p className="text-green-300 text-sm font-semibold">{t('purchases.allCorrect')}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 space-y-1.5">
                <p className="flex items-center gap-2 text-yellow-300 text-sm font-semibold">
                  <AlertTriangle size={18} className="shrink-0" /> {t('purchases.someDiffer', { count: differing.length })}
                </p>
                {differing.map((l) => (
                  <p key={l.id} className="text-xs text-yellow-100/90">
                    {l.name}: {l.quantity} → {checks[l.id].qty} — {checks[l.id].note}
                  </p>
                ))}
              </div>
            )
          ) : (
            <div className="rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 p-5 text-center space-y-2">
              <ScanLine size={34} className="text-primary mx-auto" />
              <p className="text-white text-base font-semibold">{t('purchases.scanToCheck')}</p>
              <p className="text-xs text-gray-400">{t('purchases.scanToCheckHint')}</p>
              <p className="text-xs text-gray-500">{t('purchases.checkedCount', { done: doneCount, total: lines.length })}</p>
              {lastAnswered && (
                <p className={`text-sm font-medium ${lastAnswered.ok ? 'text-green-400' : 'text-yellow-400'}`}>
                  {lastAnswered.ok
                    ? t('purchases.lastOk', { name: lastAnswered.name, qty: lastAnswered.qty })
                    : t('purchases.lastDiffer', { name: lastAnswered.name, qty: lastAnswered.qty, note: lastAnswered.note ?? '' })}
                </p>
              )}
            </div>
          )}

          {allChecked && !current ? (
            <div>
              <p className="text-white text-sm font-semibold">{t('purchases.invoiceStep')}</p>
              <p className="text-xs text-gray-500 mb-2">{t('purchases.invoiceHint')}</p>
              <div className="space-y-1.5 max-h-[34vh] overflow-y-auto pr-1">
                {lines.map((l) => {
                  const qty = checks[l.id].qty
                  const changed = priceOf(l) !== l.unit_cost
                  return (
                    <div key={l.id} className="bg-dark-card border border-dark-border rounded-xl px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-white text-sm font-medium truncate">{l.name}</p>
                        <p className="text-xs text-gray-400 shrink-0">{qty} × = <span className="text-white font-semibold">UZS {fmtUZS(qty * priceOf(l))}</span></p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-1.5">
                        <div>
                          <label className="text-[11px] text-gray-500 block">{t('purchases.unitPriceInvoice')}</label>
                          <Input type="number" min={0} step="any" value={prices[l.id] ?? ''} className={changed ? 'border-yellow-500/60' : ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-500 block">{t('purchases.expiryOptional')}</label>
                          <Input type="date" value={expiries[l.id] ?? ''}
                            onChange={(e) => setExpiries((p) => ({ ...p, [l.id]: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between items-center mt-2 px-1">
                <span className="text-sm text-gray-400">{t('purchases.invoiceTotal')}</span>
                <span className="text-white font-bold">UZS {fmtUZS(invoiceTotal)}</span>
              </div>
              <button onClick={() => ask(lines[0]?.id ?? null)} className="text-xs text-primary hover:underline mt-1 px-1">
                {t('purchases.recount')}
              </button>
            </div>
          ) : (
          <div>
            <p className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>{t('purchases.orderedItems')}</span>
              <span className="flex items-center gap-1"><ScanLine size={13} /> {t('purchases.scanHint')}</span>
            </p>
            <div className="space-y-1.5 max-h-[30vh] overflow-y-auto pr-1">
              {/* What's still to check comes first. */}
              {[...lines.filter((l) => !checks[l.id]), ...lines.filter((l) => checks[l.id])].map((line) => {
                const check = checks[line.id]
                return (
                  <button
                    key={line.id}
                    onClick={() => ask(line.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left ${
                      active === line.id ? 'border-primary bg-dark-card' : 'border-dark-border bg-dark-card'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{line.name}</p>
                      <p className="text-gray-500 text-xs">{t('purchases.ordered', { qty: line.quantity })}</p>
                    </div>
                    {!check ? (
                      <span className="text-xs text-gray-500 shrink-0">{t('purchases.notChecked')}</span>
                    ) : check.qty === line.quantity ? (
                      <span className="flex items-center gap-1 text-xs text-green-400 shrink-0"><CheckCircle2 size={14} /> {check.qty}</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-400 shrink-0 max-w-[50%]">
                        <AlertTriangle size={14} className="shrink-0" /> <span className="truncate">{check.qty} · {check.note}</span>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          )}
        </div>
      )}
    </Modal>
  )
}
