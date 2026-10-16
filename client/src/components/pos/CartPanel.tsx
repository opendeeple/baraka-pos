import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Trash2, Pause, ShoppingBag, Plus, Minus, LogOut, Tag, X, ChevronDown, Search, Zap } from 'lucide-react'
import { useCartStore, cartLineTotal } from '../../store/cart.store'
import { fmtUZS } from '../../lib/currency'
import { HeldOrdersPanel } from './HeldOrdersDrawer'
import { DebtHistoryPanel } from './DebtHistoryDrawer'
import { NumPad } from './NumPad'
import { DiscountModal } from './DiscountModal'
import { Modal, Button } from '../ui'
import { Debtor } from '../../types/pos.types'
import { OPEN_DEBT_CONDITION } from '../../lib/debt'
import type { LocalProduct } from './ProductGrid'

interface Props {
  onCheckout: () => void
  onCloseRegister: () => void
  /** Tapping a featured quick-sell product routes through the same handler
   *  as the main grid (kg/box products open the unit calculator instead of
   *  adding a flat quantity of 1). */
  onProductTap: (product: LocalProduct) => void
}

export default function CartPanel({ onCheckout, onCloseRegister, onProductTap }: Props) {
  const { t } = useTranslation()
  const {
    items, charges, heldCarts,
    getSubtotal, getTotalChargeAmount, getFinalTotal,
    removeItem, setQuantity, updateItem, holdCart, clearCart,
  } = useCartStore()

  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null)
  const [activePanel, setActivePanel] = useState<'held' | null>(null)
  // Closed by default — the debtor list used to take the whole idle panel;
  // now it's a search dropdown you open only when you need it, leaving the
  // space for quick-sell instead.
  const [debtorsOpen, setDebtorsOpen] = useState(false)
  const [debtorSearch, setDebtorSearch] = useState('')
  const [featuredProducts, setFeaturedProducts] = useState<LocalProduct[]>([])

  const subtotal = getSubtotal()
  const chargeAmount = getTotalChargeAmount()
  const total = getFinalTotal()

  const loadDebtors = useCallback(() => {
    window.electronAPI.db.query(
      `SELECT c.id, c.name, c.phone, c.balance FROM contacts c
       WHERE c.type IN ('customer','both') AND c.deleted_at IS NULL AND ${OPEN_DEBT_CONDITION}
       ORDER BY c.balance DESC LIMIT 50`,
      []
    ).then((rows) => setDebtors(rows as Debtor[]))
  }, [])

  // Products the owner picked in Office (Mahsulotlar > "Tezkor sotuvda") —
  // tapping one adds it straight to the cart, same as the main grid.
  const loadFeaturedProducts = useCallback(() => {
    window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, p.image_url, p.is_stock_managed, p.unit, p.units_per_package, p.piece_price,
              pb.id as batch_id, pb.price, pb.cost,
              COALESCE(ps.quantity, 0) as stock
       FROM products p
       LEFT JOIN product_batches pb ON pb.id = (
         SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN product_stocks ps ON ps.id = (
         SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
       )
       WHERE p.is_featured = 1 AND p.is_active = 1 AND p.deleted_at IS NULL
       ORDER BY p.name LIMIT 12`,
      []
    ).then((rows) => setFeaturedProducts(rows as LocalProduct[]))
  }, [])

  const filteredDebtors = debtorSearch.trim()
    ? debtors.filter((d) => {
        const q = debtorSearch.trim().toLowerCase()
        return d.name.toLowerCase().includes(q) || (d.phone ?? '').includes(q)
      })
    : debtors

  useEffect(() => {
    if (items.length > 0) return
    loadDebtors()
    loadFeaturedProducts()
    // Repayments and deleted debts also arrive from other devices via sync,
    // and a product's "Tezkor sotuvda" flag can be flipped in Office at any
    // time (same local database, no sync round-trip needed on one machine)
    // — a cheap local re-read keeps both lists current without a click.
    const timer = setInterval(() => { loadDebtors(); loadFeaturedProducts() }, 10_000)
    return () => clearInterval(timer)
  }, [items.length, loadDebtors, loadFeaturedProducts])

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
            onPaymentComplete={loadDebtors}
            onCleared={() => { setSelectedDebtor(null); loadDebtors() }}
            onDeleted={() => { setSelectedDebtor(null); loadDebtors() }}
          />
        ) : items.length === 0 ? (
          <>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="px-4 pt-4 pb-2 space-y-4">
                {/* Debtors — a closed-by-default search dropdown instead of a
                    permanently open list, so the space below is free for
                    quick-sell. */}
                <div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDebtorsOpen((v) => !v)}
                      className="flex-1 flex items-center justify-between bg-dark-card border border-dark-border rounded-xl px-3 py-2.5 active:border-primary/40 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-sm text-gray-300">
                        <Search size={14} className="text-gray-500" />
                        {t('pos.outstandingDebts')}
                        {debtors.length > 0 && (
                          <span className="bg-yellow-500/20 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full font-semibold">
                            {debtors.length}
                          </span>
                        )}
                      </span>
                      <ChevronDown size={16} className={`text-gray-500 transition-transform ${debtorsOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {heldCarts.length > 0 && (
                      <button
                        onClick={() => setActivePanel('held')}
                        className="relative flex items-center gap-1.5 h-[42px] px-3 text-xs bg-dark-card border border-dark-border text-gray-400 active:text-white rounded-xl transition-colors shrink-0"
                      >
                        {t('pos.held')}
                        <span className="bg-yellow-500 text-black text-xs w-4 h-4 flex items-center justify-center rounded-full font-bold">
                          {heldCarts.length}
                        </span>
                      </button>
                    )}
                  </div>
                  {debtorsOpen && (
                    <div className="mt-2 space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                          value={debtorSearch}
                          onChange={(e) => setDebtorSearch(e.target.value)}
                          placeholder={t('pos.searchDebtor')}
                          autoFocus
                          className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                        />
                      </div>
                      {filteredDebtors.length === 0 ? (
                        <p className="text-gray-600 text-sm text-center py-4">{t('pos.noOutstandingDebts')}</p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {filteredDebtors.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => { setSelectedDebtor(d); setDebtorsOpen(false); setDebtorSearch('') }}
                              className="w-full flex items-center justify-between bg-dark-card border border-dark-border rounded-xl px-3 py-2.5 active:border-yellow-500/40 transition-colors text-left"
                            >
                              <div className="min-w-0">
                                <p className="text-white text-sm font-medium truncate">{d.name}</p>
                                {d.phone && <p className="text-gray-500 text-xs">{d.phone}</p>}
                              </div>
                              {d.balance > 0 ? (
                                <span className="text-yellow-400 text-sm font-semibold whitespace-nowrap ml-2">
                                  UZS {fmtUZS(d.balance)}
                                </span>
                              ) : (
                                <span className="text-green-400 text-xs font-semibold whitespace-nowrap ml-2">
                                  {t('debt.paidBadge')}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick sell — products picked in Office (Mahsulotlar >
                    "Tezkor sotuvda"), fills the space the debtor list used to
                    take up by default. */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Zap size={12} /> {t('pos.quickSell')}
                  </p>
                  {featuredProducts.length === 0 ? (
                    <p className="text-gray-600 text-xs text-center py-6">{t('pos.noFeaturedProducts')}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {featuredProducts.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => onProductTap(p)}
                          className="flex flex-col items-start bg-dark-card border border-dark-border rounded-xl px-3 py-2.5 active:border-primary/40 transition-colors text-left"
                        >
                          <span className="text-white text-sm font-medium truncate w-full">{p.name}</span>
                          <span className="text-primary text-xs font-semibold mt-0.5">UZS {fmtUZS(p.price ?? 0)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                  // One product can have two lines (whole boxes and loose pieces).
                  key={`${item.productId}-${item.batchId}-${item.unitPrice}`}
                  item={item}
                  onRemove={() => removeItem(index)}
                  onDiscountChange={(percent, amount) => updateItem(index, { discount: percent, flatDiscount: amount })}
                  onQtyChange={(qty) => {
                    if (setQuantity(index, qty)) {
                      toast.warning(t('pos.onlyInStock', { name: item.name, count: item.maxStock }))
                    }
                  }}
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
  onDiscountChange,
}: {
  item: { name: string; quantity: number; unitPrice: number; discount: number; flatDiscount?: number; maxStock?: number }
  onRemove: () => void
  onQtyChange: (qty: number) => void
  onDiscountChange: (percent: number, amount: number) => void
}) {
  const { t } = useTranslation()
  const lineTotal = cartLineTotal(item)
  const hasDiscount = item.discount > 0 || (item.flatDiscount ?? 0) > 0
  const [showDiscount, setShowDiscount] = useState(false)
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

  // Tap the quantity number to type an exact value instead of only stepping
  // by 1 — same onQtyChange as the +/- buttons. A NumPad modal (the same
  // on-screen keypad used for payment amounts) replaces a plain text input:
  // this runs on a touchscreen till with no physical keyboard, where typing
  // into an inline input means fighting the OS's on-screen keyboard.
  const [showQtyPad, setShowQtyPad] = useState(false)
  const [qtyDraft, setQtyDraft] = useState('')

  function startEditQty() {
    setQtyDraft(String(item.quantity))
    setShowQtyPad(true)
  }

  function commitQtyDraft() {
    setShowQtyPad(false)
    const parsed = parseFloat(qtyDraft.replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) onQtyChange(parsed)
  }

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
        {/* Top row: name + line total + delete. The swipe-left gesture below
            also removes the line, but it's not discoverable on a touchscreen
            with no visual hint — this button works with a single direct tap. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium leading-snug">{item.name}</p>
            {item.discount > 0 && (
              <span className="text-xs text-green-400">-{item.discount}%</span>
            )}
            {(item.flatDiscount ?? 0) > 0 && (
              <span className="text-xs text-green-400">-UZS {fmtUZS(item.flatDiscount ?? 0)}</span>
            )}
          </div>
          <span className="text-primary font-bold text-sm whitespace-nowrap shrink-0">
            UZS {fmtUZS(lineTotal)}
          </span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            title={t('common.delete')}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-500 active:text-red-400 active:bg-red-500/10 transition-colors"
          >
            <X size={16} />
          </button>
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
            <span
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); startEditQty() }}
              className="w-10 text-center text-white font-bold text-base"
            >
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              UZS {fmtUZS(item.unitPrice)} × {item.quantity}
            </span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setShowDiscount(true) }}
              title={t('discount.title')}
              className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-colors ${
                hasDiscount ? 'border-green-500/50 text-green-400 bg-green-500/10' : 'border-dark-border text-gray-400 active:text-white'
              }`}
            >
              <Tag size={15} />
            </button>
          </div>
        </div>
      </div>

      {showDiscount && (
        <DiscountModal
          title={`${t('discount.title')}: ${item.name}`}
          base={item.unitPrice * item.quantity}
          allowPercent
          initial={{ percent: item.discount, amount: item.flatDiscount ?? 0 }}
          onSave={({ percent, amount }) => { onDiscountChange(percent, amount); setShowDiscount(false) }}
          onClose={() => setShowDiscount(false)}
        />
      )}

      {showQtyPad && (
        <Modal
          open
          onClose={() => setShowQtyPad(false)}
          title={item.name}
          maxWidth="max-w-xs"
          footer={
            <>
              <Button variant="secondary" className="flex-1" onClick={() => setShowQtyPad(false)}>{t('common.cancel')}</Button>
              <Button className="flex-1" onClick={commitQtyDraft}>{t('common.save')}</Button>
            </>
          }
        >
          <div className="p-4">
            <NumPad value={qtyDraft} onChange={setQtyDraft} maxDecimals={3} label={t('common.quantity')} />
          </div>
        </Modal>
      )}
    </div>
  )
}
