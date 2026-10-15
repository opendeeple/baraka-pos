import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Modal, Button } from '../ui'
import { useAuthStore } from '../../store/auth.store'
import { labelsHtml, type LabelSize } from '../../lib/labels'
import type { LabelCandidate } from '../../lib/purchases'

interface Props {
  items: LabelCandidate[]
  onClose: () => void
}

/**
 * The last step before anything actually prints: shows what's about to go
 * out — one row per product, the suggested count editable in case fewer or
 * more stickers are wanted than units received — so nothing prints on its
 * own without a look first, and lets a failed or skipped print run be
 * redone later from the same data (PurchasesScreen's reprint action builds
 * the same candidate list fresh).
 */
export function ReceivingLabelsConfirmModal({ items: initial, onClose }: Props) {
  const { t } = useTranslation()
  const { store } = useAuthStore()
  const [items, setItems] = useState(initial)
  const [printing, setPrinting] = useState(false)

  function setQty(productId: number, qty: number) {
    setItems((prev) => prev.map((it) => (it.productId === productId ? { ...it, qty: Math.max(0, qty) } : it)))
  }

  async function confirmPrint() {
    const toPrint = items.filter((it) => it.qty > 0)
    if (!toPrint.length) { onClose(); return }
    setPrinting(true)
    try {
      const total = toPrint.reduce((s, p) => s + Math.round(p.qty), 0)

      const [cfgRow] = await window.electronAPI.db.query(
        `SELECT meta_value FROM settings WHERE meta_key='receiving_label_config'`, []
      ) as Array<{ meta_value: string }>
      let mode: 'sticker' | 'roll' = 'sticker'
      let size: LabelSize = '58x40'
      if (cfgRow?.meta_value) {
        try {
          const parsed = JSON.parse(cfgRow.meta_value)
          if (parsed.mode === 'roll' || parsed.mode === 'sticker') mode = parsed.mode
          if (parsed.size) size = parsed.size
        } catch { /* malformed setting — stick with the defaults above */ }
      }

      if (mode === 'sticker') {
        const html = labelsHtml(
          toPrint.map((p) => ({
            name: p.name, price: p.price, barcode: p.barcode, unit: p.unit, copies: Math.round(p.qty),
            unitsPerPackage: p.unitsPerPackage, piecePrice: p.piecePrice,
          })),
          size,
          { storeName: store?.name ?? '', perKg: t('labels.perKg'), perBox: t('labels.perBox'), perPiece: t('labels.perPiece'), currency: t('labels.currency') }
        )
        const res = await window.electronAPI.printer.printBadge(html)
        if (res.success) { toast.success(t('labels.printed', { count: total })); onClose(); return }
        // Sticker stock jammed, wrong printer selected, etc. — the barcodes
        // are already minted and saved; fall back to a plain text listing so
        // that work isn't lost even though nothing came out of the printer.
      }

      const reportRes = await window.electronAPI.printer.printReport({
        title: t('labels.title'),
        lines: toPrint.flatMap((p, i) => [
          ...(i > 0 ? [{ divider: true as const }] : []),
          { label: p.name, bold: true },
          { label: t('products.barcode'), value: p.barcode },
          { label: t('common.quantity'), value: String(Math.round(p.qty)) },
        ]),
      })
      if (reportRes.success) { toast.success(t('labels.printed', { count: total })); onClose() }
      else if (reportRes.error) toast.error(reportRes.error)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('labels.confirmPrintTitle')}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={confirmPrint} loading={printing} disabled={items.every((it) => it.qty <= 0)}>
            {t('labels.print')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-2">
        <p className="text-xs text-gray-400">{t('labels.confirmPrintHint')}</p>
        <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
          {items.map((it) => (
            <div key={it.productId} className="flex items-center justify-between gap-2 bg-dark-card border border-dark-border rounded-lg px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm truncate">{it.name}</p>
                <p className="text-gray-500 text-xs">{it.barcode}</p>
              </div>
              <input
                type="number" min={0} value={it.qty}
                onChange={(e) => setQty(it.productId, Number(e.target.value) || 0)}
                className="w-20 shrink-0 bg-dark border border-dark-border rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:border-primary"
              />
            </div>
          ))}
          {items.length === 0 && <p className="text-center text-gray-500 text-sm py-8">{t('labels.noneToLabel')}</p>}
        </div>
      </div>
    </Modal>
  )
}
