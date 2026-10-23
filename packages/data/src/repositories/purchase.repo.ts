import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'
import type { StockLocation } from './warehouse.repo'

export interface PurchaseListItem {
  id: number
  syncId: string
  referenceNumber: string | null
  vendorName: string | null
  status: string
  totalAmount: number
  createdAt: string
}

export interface PurchaseItemRow {
  id: number
  productId: number
  batchId: number | null
  productName: string
  quantity: number
  unitCost: number
}

export interface OrderLineInput {
  productId: number
  batchId: number
  qty: number
  /** Estimated unit price — the product's cost price unless edited. */
  unitCost: number
}

export interface ReceiveCheck {
  itemId: number
  receivedQty: number
  unitCost?: number
}

function orderNumber(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `ZK-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Purchase orders: ordered → 'pending' (waiting for the delivery) → checked
 * line by line → 'received' into the shop or the warehouse. Mirrors
 * desktop's client/src/lib/purchases.ts (createPurchaseOrder /
 * receivePurchaseOrder) — supplier payment and receiving-label printing are
 * not ported (see the mobile-parity plan).
 */
export function createPurchaseRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(limit = 50): PurchaseListItem[] {
      return db
        .all<Record<string, any>>(
          `SELECT pu.id, pu.sync_id, pu.reference_number, pu.status, pu.total_amount, pu.created_at, c.name AS vendor_name
           FROM purchases pu LEFT JOIN contacts c ON c.id = pu.vendor_id
           WHERE pu.deleted_at IS NULL
           ORDER BY pu.id DESC LIMIT ?`,
          [Math.min(limit, 200)]
        )
        .map((r) => ({
          id: r.id,
          syncId: r.sync_id,
          referenceNumber: r.reference_number,
          vendorName: r.vendor_name,
          status: r.status,
          totalAmount: Number(r.total_amount) || 0,
          createdAt: r.created_at,
        }))
    },

    items(purchaseId: number): PurchaseItemRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT pi.id, pi.product_id, pi.batch_id, pi.quantity, pi.unit_cost, p.name AS product_name
           FROM purchase_items pi JOIN products p ON p.id = pi.product_id
           WHERE pi.purchase_id = ? ORDER BY pi.id`,
          [purchaseId]
        )
        .map((r) => ({
          id: r.id,
          productId: r.product_id,
          batchId: r.batch_id,
          productName: r.product_name,
          quantity: Number(r.quantity) || 0,
          unitCost: Number(r.unit_cost) || 0,
        }))
    },

    create(lines: OrderLineInput[], opts: { storeId: number; userId: number; note?: string; vendorId?: number | null }): { id: number; referenceNumber: string } {
      const now = new Date().toISOString()
      const syncId = uuid()
      const referenceNumber = orderNumber()
      const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
      let id = 0
      db.transaction(() => {
        db.run(
          `INSERT INTO purchases (sync_id, store_id, vendor_id, reference_number, note, total_amount, status,
             amount_paid, payment_status, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?, 'pending', 0, 'pending', ?,?,?)`,
          [syncId, opts.storeId, opts.vendorId ?? null, referenceNumber, opts.note?.trim() || null, total, opts.userId, now, now]
        )
        id = db.get<{ id: number }>(`SELECT id FROM purchases WHERE sync_id=?`, [syncId])!.id
        for (const l of lines) {
          db.run(
            `INSERT INTO purchase_items (sync_id, purchase_id, product_id, batch_id, quantity, unit_cost, total_cost, created_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            [uuid(), id, l.productId, l.batchId, l.qty, l.unitCost, l.qty * l.unitCost, now]
          )
        }
        enqueue('purchases', syncId, 'upsert')
      })
      return { id, referenceNumber }
    },

    /**
     * Marks the order received with what actually arrived per line, and adds
     * it to local stock at `location` right away. That stock change is a
     * local copy only — NOT a quantity_adjustments row: the server applies
     * the receipt itself when this purchase's push lands (once, even if
     * another device received the same order first), and the next
     * product_stocks pull replaces the local figure with the server's. A
     * quantity_adjustments row here would double-credit the stock.
     */
    receive(purchaseId: number, location: StockLocation, checks: ReceiveCheck[], userId: number): void {
      const purchase = db.get<{ sync_id: string; status: string }>(`SELECT sync_id, status FROM purchases WHERE id=?`, [purchaseId])
      if (!purchase || purchase.status === 'received') throw new Error('Purchase already received')
      const items = db.all<{ id: number; product_id: number; batch_id: number | null; quantity: number; unit_cost: number }>(
        `SELECT id, product_id, batch_id, quantity, unit_cost FROM purchase_items WHERE purchase_id=?`, [purchaseId]
      )
      const now = new Date().toISOString()
      let receivedTotal = 0

      db.transaction(() => {
        for (const item of items) {
          const check = checks.find((c) => c.itemId === item.id)
          const qty = check ? check.receivedQty : Number(item.quantity)
          const unitCost = check?.unitCost != null && Number.isFinite(check.unitCost) && check.unitCost >= 0
            ? check.unitCost : Number(item.unit_cost)
          receivedTotal += qty * unitCost
          db.run(
            `UPDATE purchase_items SET received_quantity=?, unit_cost=?, total_cost=? WHERE id=?`,
            [qty, unitCost, qty * unitCost, item.id]
          )
          if (!item.batch_id || qty <= 0) continue

          // Captured BEFORE this receipt's own stock change, for the
          // weighted-average cost below — mirrors the server exactly.
          const onHandBefore =
            (db.get<{ q: number }>(
              `SELECT quantity AS q FROM product_stocks WHERE product_id=? AND batch_id=? AND location='shop' ORDER BY id DESC LIMIT 1`,
              [item.product_id, item.batch_id]
            )?.q ?? 0) +
            (db.get<{ q: number }>(
              `SELECT quantity AS q FROM product_stocks WHERE product_id=? AND batch_id=? AND location='warehouse' ORDER BY id DESC LIMIT 1`,
              [item.product_id, item.batch_id]
            )?.q ?? 0)

          // Newest row per product+batch+location — every stock read in the
          // app uses ORDER BY id DESC LIMIT 1 (older duplicate rows exist).
          db.run(
            `UPDATE product_stocks SET quantity = quantity + ?, updated_at=?
             WHERE id = (SELECT id FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1)`,
            [qty, now, item.product_id, item.batch_id, location]
          )
          db.run(
            `INSERT INTO product_stocks (sync_id, product_id, batch_id, location, quantity, updated_at)
             SELECT ?,?,?,?,?,?
             WHERE NOT EXISTS (SELECT 1 FROM product_stocks WHERE product_id=? AND batch_id=? AND location=?)`,
            [uuid(), item.product_id, item.batch_id, location, qty, now, item.product_id, item.batch_id, location]
          )

          // Mirrors the server: the cost price becomes the weighted average
          // of the stock on hand (shop + warehouse) and this delivery.
          if (unitCost > 0) {
            const batch = db.get<{ cost: number }>(`SELECT cost FROM product_batches WHERE id=?`, [item.batch_id])
            const currentCost = Number(batch?.cost ?? 0)
            const have = Math.max(0, onHandBefore)
            const avg = have > 0 ? Math.round(((have * currentCost + qty * unitCost) / (have + qty)) * 100) / 100 : unitCost
            if (avg !== currentCost) {
              db.run(`UPDATE product_batches SET cost=?, updated_at=? WHERE id=?`, [avg, now, item.batch_id])
            }
          }
        }

        const roundedTotal = Math.round(receivedTotal * 100) / 100
        db.run(
          `UPDATE purchases SET status='received', received_location=?, received_at=?, received_by=?, receipt_id=?,
             total_amount=?, payment_status=CASE WHEN COALESCE(amount_paid,0) >= ? THEN 'fully_paid'
               WHEN COALESCE(amount_paid,0) > 0 THEN 'partially_paid' ELSE 'pending' END, updated_at=? WHERE id=?`,
          [location, now, userId, uuid(), roundedTotal, roundedTotal, now, purchaseId]
        )
        enqueue('purchases', purchase.sync_id, 'upsert')
      })
    },
  }
}

export type PurchaseRepository = ReturnType<typeof createPurchaseRepository>
