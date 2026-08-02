import type { CartItem, CartCharge } from '@baraka/shared'
import type { DbAdapter } from '../adapter'

export interface HeldCart {
  id: string
  label?: string
  items: CartItem[]
  charges: CartCharge[]
  discount: number
  createdAt: string
}

export function createHeldCartRepository(db: DbAdapter, uuid: () => string) {
  return {
    list(): HeldCart[] {
      const rows = db.all<Record<string, any>>(`SELECT * FROM held_carts ORDER BY created_at`)
      return rows.map((r) => {
        let items: CartItem[] = []
        let charges: CartCharge[] = []
        try { items = JSON.parse(r.items) } catch { /* corrupted row → empty cart */ }
        try { charges = JSON.parse(r.charges || '[]') } catch { /* ditto */ }
        return { id: r.id, label: r.label, items, charges, discount: Number(r.discount) || 0, createdAt: r.created_at }
      })
    },

    save(cart: { label?: string; items: CartItem[]; charges: CartCharge[]; discount: number }): HeldCart {
      const held: HeldCart = {
        id: uuid(),
        label: cart.label,
        items: [...cart.items],
        charges: [...cart.charges],
        discount: cart.discount,
        createdAt: new Date().toISOString(),
      }
      db.run(
        `INSERT OR REPLACE INTO held_carts (id, label, items, charges, discount, contact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [held.id, held.label ?? '', JSON.stringify(held.items), JSON.stringify(held.charges), held.discount, null, held.createdAt]
      )
      return held
    },

    remove(id: string): void {
      db.run(`DELETE FROM held_carts WHERE id=?`, [id])
    },
  }
}

export type HeldCartRepository = ReturnType<typeof createHeldCartRepository>
