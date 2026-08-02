import { create } from 'zustand'
import type { CartItem, CartCharge } from '@baraka/shared'
import type { HeldCartRepository, HeldCart } from '@baraka/data'

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
  holdCart: (label?: string) => void
  restoreHeld: (id: string) => void
  discardHeld: (id: string) => void
  clearCart: () => void
  loadHeldCarts: () => void
}

/**
 * Platform-agnostic cart store factory: held-cart persistence goes through the
 * injected repository (better-sqlite3 over IPC on Electron, expo-sqlite on
 * Android) instead of window.electronAPI.
 */
export function createCartStore(heldCarts: HeldCartRepository) {
  return create<CartStore>((set, get) => ({
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

    getFinalTotal: () => get().getSubtotal() + get().getTotalChargeAmount() - get().discount,

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

    removeItem: (index) => set((state) => ({ items: state.items.filter((_, i) => i !== index) })),

    updateItem: (index, patch) =>
      set((state) => {
        const items = [...state.items]
        items[index] = { ...items[index], ...patch }
        return { items }
      }),

    setQuantity: (index, qty) => {
      if (qty <= 0) {
        get().removeItem(index)
        return
      }
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

    holdCart: (label) => {
      const { items, charges, discount } = get()
      if (items.length === 0) return
      const held = heldCarts.save({ label, items, charges, discount })
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
      heldCarts.remove(id)
      set((state) => ({ heldCarts: state.heldCarts.filter((h) => h.id !== id) }))
    },

    clearCart: () => set({ items: [], charges: [], discount: 0 }),

    loadHeldCarts: () => {
      set({ heldCarts: heldCarts.list() })
    },
  }))
}

export type CartStoreHook = ReturnType<typeof createCartStore>
