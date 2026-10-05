import { useTranslation } from 'react-i18next'
import { PackageCheck, PackagePlus } from 'lucide-react'
import { Modal, Button } from '../ui'
import { fmtUZS } from '../../lib/currency'

export interface PendingOrder { id: number; reference_number: string; created_at: string; total_amount: number; item_count: number }

/** Orders still waiting for their delivery (status 'pending'), newest first. */
export async function loadPendingOrders(): Promise<PendingOrder[]> {
  return await window.electronAPI.db.query(
    `SELECT p.id, p.reference_number, p.created_at, p.total_amount,
            (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) AS item_count
     FROM purchases p WHERE p.status = 'pending' AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC`,
    []
  ) as PendingOrder[]
}

interface Props {
  orders: PendingOrder[]
  onPick: (order: PendingOrder) => void
  onWithoutOrder: () => void
  onClose: () => void
}

/**
 * "A delivery arrived — which order is it?" Shown by the warehouse's
 * receive button while orders are waiting, so receiving starts from what
 * was ordered; goods that came without an order go the manual way.
 */
export function PendingOrderPicker({ orders, onPick, onWithoutOrder, onClose }: Props) {
  const { t } = useTranslation()

  return (
    <Modal
      open
      onClose={onClose}
      title={t('purchases.pendingOrders')}
      maxWidth="max-w-lg"
      footer={
        <div className="w-full flex gap-3">
          <Button variant="secondary" className="w-36" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="secondary" icon={PackagePlus} className="flex-1" onClick={onWithoutOrder}>{t('purchases.receiveWithoutOrder')}</Button>
        </div>
      }
    >
      <div className="p-5 space-y-3">
        <p className="text-sm text-gray-400">{t('purchases.pickOrderHint')}</p>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => onPick(o)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-dark-border bg-dark-card text-left hover:border-primary active:bg-primary/10"
            >
              <div className="min-w-0">
                <p className="text-primary font-mono font-semibold text-sm">{o.reference_number}</p>
                <p className="text-gray-500 text-xs">
                  {new Date(o.created_at).toLocaleDateString()} · {t('purchases.orderedItemsCount', { count: Number(o.item_count) || 0 })} · UZS {fmtUZS(Number(o.total_amount))}
                </p>
              </div>
              <PackageCheck size={20} className="text-green-400 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
