import { create } from 'zustand'
import { CartItem, CartCharge } from '@baraka/shared'

export interface HeldCart {
  id: string
  label?: string
  items: CartItem[]
  charges: CartCharge[]
  discount: number
  createdAt: string
}

interface CartStore {
  items: CartItem[]
  charges: CartCharge[]
  discount: number
  heldCarts: HeldCart[]

  getSubtotal: () => number
  getTotalChargeAmount: () => number
  getFinalTotal: () => number

  addItem: (item: CartItem) => void
  removeItem: (index: number) => void
  updateItem: (index: number, patch: Partial<CartItem>) => void
  setQuantity: (index: number, qty: number) => void
  setDiscount: (amount: number) => void
  addCharge: (charge: CartCharge) => void
  removeCharge: (chargeId: number) => void
  holdCart: (label?: string) => Promise<void>
  restoreHeld: (id: string) => void
  discardHeld: (id: string) => void
  clearCart: () => void
  loadHeldCarts: () => void
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  charges: [],
  discount: 0,
  heldCarts: [],

  getSubtotal: () =>
    get().items.reduce((sum, item) => {
      const lineTotal = item.unitPrice * item.quantity
      const lineDiscount = item.discount > 0 ? lineTotal * (item.discount / 100) : 0
      return sum + lineTotal - lineDiscount
    }, 0),

  getTotalChargeAmount: () => {
    const subtotal = get().getSubtotal()
    return get().charges.reduce((sum, charge) => {
      if (charge.rateType === 'percentage') return sum + (subtotal * charge.rateValue) / 100
      return sum + charge.rateValue
    }, 0)
  },

  getFinalTotal: () =>
    get().getSubtotal() + get().getTotalChargeAmount() - get().discount,

  addItem: (newItem) => {
    set((state) => {
      const existingIdx = state.items.findIndex(
        (i) => i.productId === newItem.productId && i.batchId === newItem.batchId
      )
      if (existingIdx >= 0) {
        const items = [...state.items]
        items[existingIdx] = {
          ...items[existingIdx],
          quantity: items[existingIdx].quantity + newItem.quantity,
        }
        return { items }
      }
      return { items: [...state.items, newItem] }
    })
  },

  removeItem: (index) =>
    set((state) => ({ items: state.items.filter((_, i) => i !== index) })),

  updateItem: (index, patch) =>
    set((state) => {
      const items = [...state.items]
      items[index] = { ...items[index], ...patch }
      return { items }
    }),

  setQuantity: (index, qty) => {
    if (qty <= 0) { get().removeItem(index); return }
    get().updateItem(index, { quantity: qty })
  },

  setDiscount: (amount) => set({ discount: Math.max(0, amount) }),

  addCharge: (charge) =>
    set((state) => {
      if (state.charges.find((c) => c.id === charge.id)) return {}
      return { charges: [...state.charges, charge] }
    }),

  removeCharge: (chargeId) =>
    set((state) => ({ charges: state.charges.filter((c) => c.id !== chargeId) })),

  holdCart: async (label) => {
    const { items, charges, discount } = get()
    if (items.length === 0) return
    const held: HeldCart = {
      id: crypto.randomUUID(),
      label,
      items: [...items],
      charges: [...charges],
      discount,
      createdAt: new Date().toISOString(),
    }
    await window.electronAPI.db.exec(
      `INSERT OR REPLACE INTO held_carts (id, label, items, charges, discount, contact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [held.id, held.label ?? '', JSON.stringify(held.items), JSON.stringify(held.charges), held.discount, null, held.createdAt]
    )
    set((state) => ({ heldCarts: [...state.heldCarts, held], items: [], charges: [], discount: 0 }))
  },

  restoreHeld: (id) => {
    const held = get().heldCarts.find((h) => h.id === id)
    if (!held) return
    if (get().items.length > 0) get().holdCart('Auto-held')
    set({ items: held.items, charges: held.charges, discount: held.discount })
    get().discardHeld(id)
  },

  discardHeld: (id) => {
    window.electronAPI.db.exec(`DELETE FROM held_carts WHERE id=?`, [id])
    set((state) => ({ heldCarts: state.heldCarts.filter((h) => h.id !== id) }))
  },

  clearCart: () => set({ items: [], charges: [], discount: 0 }),

  loadHeldCarts: async () => {
    const rows = await window.electronAPI.db.query(`SELECT * FROM held_carts ORDER BY created_at`, []) as Array<{
      id: string; label: string; items: string; charges: string; discount: number; created_at: string
    }>
    set({
      heldCarts: rows.map((r) => {
        let items: CartItem[] = []
        let charges: CartCharge[] = []
        try { items = JSON.parse(r.items) } catch { items = [] }
        try { charges = JSON.parse(r.charges || '[]') } catch { charges = [] }
        return { id: r.id, label: r.label, items, charges, discount: r.discount, createdAt: r.created_at }
      })
    })
  },
}))
