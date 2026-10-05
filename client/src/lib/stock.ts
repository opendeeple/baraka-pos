import { v4 as uuidv4 } from 'uuid'
import { useAuthStore } from '../store/auth.store'
import type { StockLocation } from './purchases'

// The golden rule: stock only changes through a document — a delivery, a
// sale, a refund, a transfer, a stocktake or a write-off — never by typing a
// new number in. This is the one door for the documents a device writes
// itself (sales and purchase receipts have their own paths): it moves the
// local figure and records a quantity_adjustments row (kind + reason + who),
// which is also how the change reaches the server (applied there as a delta).

export type StockMoveKind = 'receipt' | 'transfer' | 'stocktake' | 'writeoff'

/** Current quantity at one location — the newest row, like every stock read in the app. */
export async function stockAt(productId: number, batchId: number, location: StockLocation): Promise<number> {
  const [row] = await window.electronAPI.db.query(
    `SELECT quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
    [productId, batchId, location]
  ) as Array<{ quantity: number }>
  return Number(row?.quantity ?? 0)
}

/** Shop + warehouse together — the weight of the current cost price in a new average. */
export async function stockOnHand(productId: number, batchId: number): Promise<number> {
  return (await stockAt(productId, batchId, 'shop')) + (await stockAt(productId, batchId, 'warehouse'))
}

export async function moveStock(opts: {
  productId: number
  batchId: number
  location: StockLocation
  delta: number
  kind: StockMoveKind
  reason: string
}): Promise<{ previous: number; adjusted: number }> {
  const { user } = useAuthStore.getState()
  const now = new Date().toISOString()
  let [stock] = await window.electronAPI.db.query(
    `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
    [opts.productId, opts.batchId, opts.location]
  ) as Array<{ id: number; quantity: number }>
  if (!stock) {
    await window.electronAPI.db.exec(
      `INSERT INTO product_stocks (sync_id, product_id, batch_id, location, quantity, updated_at) VALUES (?,?,?,?,0,?)`,
      [uuidv4(), opts.productId, opts.batchId, opts.location, now]
    )
    ;[stock] = await window.electronAPI.db.query(
      `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
      [opts.productId, opts.batchId, opts.location]
    ) as Array<{ id: number; quantity: number }>
  }
  const previous = Number(stock.quantity)
  const adjusted = previous + opts.delta
  const adjSyncId = uuidv4()
  await window.electronAPI.db.transaction([
    { sql: `UPDATE product_stocks SET quantity=?, updated_at=? WHERE id=?`, params: [adjusted, now, stock.id] },
    {
      sql: `INSERT INTO quantity_adjustments (sync_id, batch_id, stock_id, previous_quantity, adjusted_quantity, reason, location, kind, created_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      params: [adjSyncId, opts.batchId, stock.id, previous, adjusted, opts.reason || null, opts.location, opts.kind, user?.id ?? null, now, now],
    },
  ])
  await window.electronAPI.sync.enqueue('quantity_adjustments', adjSyncId, 'upsert')
  return { previous, adjusted }
}

/**
 * Weighted average cost after adding `qty` at `unitCost` to what's on hand:
 * the goods already there keep what they cost, so profit isn't skewed by the
 * latest delivery's price. Mirrors the server's purchase receipt.
 */
export function averageCost(onHand: number, currentCost: number, qty: number, unitCost: number): number {
  const have = Math.max(0, onHand)
  const avg = have > 0 ? (have * currentCost + qty * unitCost) / (have + qty) : unitCost
  return Math.round(avg * 100) / 100
}
