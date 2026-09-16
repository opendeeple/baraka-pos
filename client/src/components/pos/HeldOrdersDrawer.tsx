import { fmtUZS } from '../../lib/currency'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShoppingCart, ArrowLeft, Trash2, RotateCcw } from 'lucide-react'
import { useCartStore } from '../../store/cart.store'

interface Props {
  onClose: () => void
}

// Raw SQLite row shape (JSON-string fields, snake_case) — distinct from the
// parsed `HeldCart` in cart.store.ts, hence the different name.
interface HeldCartRow {
  id: string
  label: string
  items: string
  charges: string
  created_at: string
}

export function HeldOrdersPanel({ onClose }: Props) {
  const { t } = useTranslation()
  const { restoreHeld, discardHeld, items: currentItems } = useCartStore()
  const [heldCarts, setHeldCarts] = useState<HeldCartRow[]>([])

  useEffect(() => {
    window.electronAPI.db
      .query(`SELECT * FROM held_carts ORDER BY created_at DESC`, [])
      .then((rows) => setHeldCarts(rows as HeldCartRow[]))
  }, [])

  const handleRestore = async (id: string) => {
    if (currentItems.length > 0) {
      const ok = confirm(t('pos.discardAndRestoreConfirm'))
      if (!ok) return
    }
    await restoreHeld(id)
    onClose()
  }

  const handleDiscard = async (id: string) => {
    await discardHeld(id)
    setHeldCarts((prev) => prev.filter((c) => c.id !== id))
  }

  const parseItems = (json: string) => {
    try { return JSON.parse(json) } catch { return [] }
  }

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between shrink-0 min-h-[60px]">
        <div className="flex items-center gap-2 text-white">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 active:text-white rounded-lg transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <ShoppingCart size={16} className="text-primary" />
          <span className="font-bold text-sm">{t('pos.heldOrders')}</span>
          {heldCarts.length > 0 && (
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">
              {heldCarts.length}
            </span>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {heldCarts.length === 0 ? (
          <div className="text-center text-gray-500 py-16">
            <ShoppingCart size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-base">{t('pos.noHeldOrders')}</p>
          </div>
        ) : (
          heldCarts.map((cart) => {
            const items = parseItems(cart.items)
            const total = items.reduce(
              (s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity,
              0
            )
            return (
              <div key={cart.id} className="bg-dark-card rounded-2xl p-4 border border-dark-border">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white text-base font-semibold">{cart.label}</p>
                    <p className="text-gray-500 text-sm mt-0.5">
                      {new Date(cart.created_at).toLocaleTimeString()} · {t('pos.itemCount', { count: items.length })}
                    </p>
                  </div>
                  <p className="text-primary font-bold text-lg">UZS {fmtUZS(total)}</p>
                </div>

                <div className="text-sm text-gray-400 mb-4 space-y-1">
                  {items.slice(0, 3).map((item: { name: string; quantity: number; unitPrice: number }, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>{item.quantity}× {item.name}</span>
                      <span>UZS {fmtUZS(item.quantity * item.unitPrice)}</span>
                    </div>
                  ))}
                  {items.length > 3 && (
                    <p className="text-gray-500 text-xs">{t('pos.moreItems', { count: items.length - 3 })}</p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleRestore(cart.id)}
                    className="flex-1 flex items-center justify-center gap-2 h-12 text-sm bg-primary active:bg-orange-600 text-white rounded-xl font-semibold transition-colors"
                  >
                    <RotateCcw size={16} />
                    {t('pos.restore')}
                  </button>
                  <button
                    onClick={() => handleDiscard(cart.id)}
                    className="w-12 h-12 flex items-center justify-center bg-red-500/20 active:bg-red-500/40 text-red-400 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
