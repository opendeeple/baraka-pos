import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Pause, ShoppingBag, Plus, Minus, LogOut } from 'lucide-react'
import { useCartStore } from '../../store/cart.store'
import { fmtUZS } from '../../lib/currency'
import { HeldOrdersPanel } from './HeldOrdersDrawer'
import { DebtHistoryPanel } from './DebtHistoryDrawer'
import { Debtor } from '../../types/pos.types'

interface Props {
  onCheckout: () => void
  onCloseRegister: () => void
}

export default function CartPanel({ onCheckout, onCloseRegister }: Props) {
  const { t } = useTranslation()
  const {
    items, charges, heldCarts,
    getSubtotal, getTotalChargeAmount, getFinalTotal,
    removeItem, setQuantity, holdCart, clearCart,
  } = useCartStore()

  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null)
  const [activePanel, setActivePanel] = useState<'held' | null>(null)

  const subtotal = getSubtotal()
  const chargeAmount = getTotalChargeAmount()
  const total = getFinalTotal()

  const loadDebtors = useCallback(() => {
    window.electronAPI.db.query(
      `SELECT id, name, phone, balance FROM contacts
       WHERE type IN ('customer','both') AND deleted_at IS NULL AND balance > 0
       ORDER BY balance DESC LIMIT 50`,
      []
    ).then((rows) => setDebtors(rows as Debtor[]))
  }, [])

  useEffect(() => {
    if (items.length > 0) return
    loadDebtors()
  }, [items.length, loadDebtors])

  return (
    <>
      <div className="w-96 bg-dark-surface border-l border-dark-border flex flex-col h-full shrink-0">
        {/* Header — only when cart has items */}
        {items.length > 0 && <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between shrink-0 min-h-[60px]">
          <div className="flex items-center gap-2 text-white">
            <ShoppingBag size={18} className="text-primary" />
            <span className="font-bold text-base">{t('pos.cart')}</span>
            {items.length > 0 && (
              <span className="text-sm bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">
                {items.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {/* Held orders button — only shown when there are held carts */}
            {heldCarts.length > 0 && (
              <button
                onClick={() => setActivePanel('held')}
                className="relative h-10 px-3 text-sm bg-dark-card border border-dark-border text-gray-400 active:text-white rounded-lg transition-colors"
              >
                {t('pos.held')}
                <span className="absolute -top-2 -right-2 bg-yellow-500 text-black text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">
                  {heldCarts.length}
                </span>
              </button>
            )}
            {/* Hold current cart */}
            {items.length > 0 && (
              <button
                onClick={() => holdCart()}
                title={t('pos.holdOrder')}
                className="h-10 w-10 flex items-center justify-center bg-dark-card border border-dark-border text-gray-400 active:text-yellow-400 rounded-lg transition-colors"
              >
                <Pause size={16} />
              </button>
            )}
          </div>
        </div>}

        {/* Content — held panel takes priority over everything else */}
        {activePanel === 'held' ? (
          <HeldOrdersPanel onClose={() => setActivePanel(null)} />
        ) : selectedDebtor ? (
          <DebtHistoryPanel
            contact={selectedDebtor}
            onClose={() => setSelectedDebtor(null)}
            onPaymentComplete={() => { setSelectedDebtor(null); loadDebtors() }}
          />
        ) : items.length === 0 ? (
          <>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">{t('pos.outstandingDebts')}</p>
                  {heldCarts.length > 0 && (
                    <button
                      onClick={() => setActivePanel('held')}
                      className="relative flex items-center gap-1.5 h-8 px-3 text-xs bg-dark-card border border-dark-border text-gray-400 active:text-white rounded-lg transition-colors"
                    >
                      {t('pos.held')}
                      <span className="bg-yellow-500 text-black text-xs w-4 h-4 flex items-center justify-center rounded-full font-bold">
                        {heldCarts.length}
                      </span>
                    </button>
                  )}
                </div>
                {debtors.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-6">{t('pos.noOutstandingDebts')}</p>
                ) : (
                  <div className="space-y-2">
                    {debtors.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDebtor(d)}
                        className="w-full flex items-center justify-between bg-dark-card border border-dark-border rounded-xl px-3 py-2.5 active:border-yellow-500/40 transition-colors text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium truncate">{d.name}</p>
                          {d.phone && <p className="text-gray-500 text-xs">{d.phone}</p>}
                        </div>
                        <span className="text-yellow-400 text-sm font-semibold whitespace-nowrap ml-2">
                          UZS {fmtUZS(d.balance)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-dark-border p-4">
              <button
                onClick={onCloseRegister}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-dark-border text-gray-400 active:text-red-400 active:border-red-400/40 text-sm font-medium transition-colors"
              >
                <LogOut size={15} />
                {t('pos.closeRegister')}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="divide-y divide-dark-border">
              {items.map((item, index) => (
                <CartItemRow
                  key={`${item.productId}-${item.batchId}`}
                  item={item}
                  onRemove={() => removeItem(index)}
                  onQtyChange={(qty) => setQuantity(index, qty)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Totals + actions */}
        {items.length > 0 && (
          <div className="shrink-0 border-t border-dark-border">
            <div className="px-4 py-3 space-y-2 text-sm">
              {charges.map((c) => {
                const amount = c.rateType === 'percentage'
                  ? (subtotal * c.rateValue) / 100
                  : c.rateValue
                return (
                  <div key={c.id} className="flex justify-between text-gray-400 text-xs">
                    <span>{c.name} {c.rateType === 'percentage' ? `(${c.rateValue}%)` : ''}</span>
                    <span>UZS {fmtUZS(amount)}</span>
                  </div>
                )
              })}

              {/* Total */}
              <div className="flex justify-between text-primary font-bold text-xl">
                <span>{t('common.total')}</span>
                <span>UZS {fmtUZS(total)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-3 pb-4 space-y-2">
              <button
                onClick={onCheckout}
                className="w-full h-16 bg-primary active:bg-orange-600 active:scale-[0.98] text-white font-bold rounded-2xl transition-all text-lg shadow-lg shadow-primary/25"
              >
                {t('pos.pay')}
              </button>
              <button
                onClick={() => clearCart()}
                className="w-full flex items-center justify-center gap-2 h-10 text-gray-500 active:text-red-400 text-sm transition-colors rounded-xl"
              >
                <Trash2 size={14} />
                {t('pos.clearCart')}
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  )
}

const DELETE_BTN_WIDTH = 80 // px: exactly how wide the revealed delete zone is

function CartItemRow({
  item,
  onRemove,
  onQtyChange,
}: {
  item: { name: string; quantity: number; unitPrice: number; discount: number; maxStock?: number }
  onRemove: () => void
  onQtyChange: (qty: number) => void
}) {
  const { t } = useTranslation()
  const lineTotal = item.unitPrice * item.quantity * (1 - item.discount / 100)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const startOffset = useRef(0)
  const decided = useRef(false)
  const isSwiping = useRef(false)
  const offsetRef = useRef(0)

  const syncOffset = (v: number) => { offsetRef.current = v; setOffset(v) }
  const close = useCallback(() => syncOffset(0), [])
  const justSwiped = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startX.current = e.clientX
    startY.current = e.clientY
    startOffset.current = offsetRef.current
    decided.current = false
    isSwiping.current = false
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const dx = startX.current - e.clientX
    const dy = Math.abs(e.clientY - startY.current)

    if (!decided.current) {
      if (Math.abs(dx) < 6 && dy < 6) return
      decided.current = true
      if (dy > Math.abs(dx)) { isSwiping.current = false; return }
      isSwiping.current = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (!isSwiping.current) return

    syncOffset(Math.max(0, Math.min(DELETE_BTN_WIDTH, startOffset.current + dx)))
  }, [])

  const onPointerUp = useCallback(() => {
    if (!isSwiping.current) return
    isSwiping.current = false
    setDragging(false)
    justSwiped.current = true   // suppress the click that fires right after pointerup
    syncOffset(offsetRef.current >= DELETE_BTN_WIDTH / 2 ? DELETE_BTN_WIDTH : 0)
  }, [])

  const handleContentClick = useCallback(() => {
    if (justSwiped.current) { justSwiped.current = false; return }
    if (offsetRef.current > 0) close()
  }, [close])

  const isOpen = offset > 0

  return (
    <div className="relative select-none">
      {/* Delete button — fixed width, anchored right, behind content */}
      <div
        className="absolute inset-y-0 right-0 bg-red-500 active:bg-red-600 flex flex-col items-center justify-center gap-1 cursor-pointer"
        style={{ width: DELETE_BTN_WIDTH }}
        onClick={() => { onRemove() }}
      >
        <Trash2 size={18} className="text-white" />
        <span className="text-white text-[10px] font-bold tracking-wide">{t('common.delete')}</span>
      </div>

      {/* Item content — slides left max DELETE_BTN_WIDTH, solid bg covers delete zone */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleContentClick}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)',
        }}
        className="px-3 py-2.5 flex flex-col gap-2 bg-dark-surface"
      >
        {/* Top row: name + line total */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium leading-snug">{item.name}</p>
            {item.discount > 0 && (
              <span className="text-xs text-green-400">-{item.discount}%</span>
            )}
          </div>
          <span className="text-primary font-bold text-sm whitespace-nowrap shrink-0">
            UZS {fmtUZS(lineTotal)}
          </span>
        </div>

        {/* Bottom row: qty controls + unit price */}
        <div className="flex items-center justify-between">
          <div className="flex items-center border border-dark-border rounded-xl overflow-hidden">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onQtyChange(Math.max(1, item.quantity - 1)) }}
              className="w-11 h-10 flex items-center justify-center text-gray-300 active:bg-dark-card border-r border-dark-border transition-colors"
            >
              <Minus size={15} />
            </button>
            <span className="w-10 text-center text-white font-bold text-base">
              {item.quantity}
            </span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onQtyChange(item.quantity + 1) }}
              className="w-11 h-10 flex items-center justify-center text-gray-300 active:bg-dark-card border-l border-dark-border transition-colors"
            >
              <Plus size={15} />
            </button>
          </div>
          <span className="text-xs text-gray-500">
            UZS {fmtUZS(item.unitPrice)} × {item.quantity}
          </span>
        </div>
      </div>
    </div>
  )
}
