import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'
import { logAudit } from './audit'

export type StockLocation = 'shop' | 'warehouse'
export type StockMoveKind = 'receipt' | 'transfer' | 'stocktake' | 'writeoff'

export interface StocktakeRow {
  productId: number
  name: string
  batchId: number
  cost: number
  system: number
}

export type WriteOffReason = 'damaged' | 'expired' | 'lost' | 'internal' | 'other'

export interface WarehouseStockRow {
  id: number
  name: string
  batchId: number | null
  unit: string | null
  cost: number
  shopQty: number
  warehouseQty: number
}

const WAREHOUSE_SELECT = `
  SELECT p.id, p.name, p.unit,
         pb.id AS batch_id, COALESCE(pb.cost, 0) AS cost,
         COALESCE(shop.quantity, 0) AS shop_qty,
         COALESCE(wh.quantity, 0) AS warehouse_qty
  FROM products p
  LEFT JOIN product_batches pb ON pb.id = (
    SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
  )
  LEFT JOIN product_stocks shop ON shop.id = (
    SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
  )
  LEFT JOIN product_stocks wh ON wh.id = (
    SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'warehouse' ORDER BY id DESC LIMIT 1
  )
  WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1`

function mapRow(row: Record<string, any>): WarehouseStockRow {
  return {
    id: row.id,
    name: row.name,
    batchId: row.batch_id,
    unit: row.unit,
    cost: Number(row.cost) || 0,
    shopQty: Number(row.shop_qty) || 0,
    warehouseQty: Number(row.warehouse_qty) || 0,
  }
}

/**
 * Shop + warehouse stock and every way it moves outside a sale — receiving a
 * delivery and transferring to the shop floor. Mirrors desktop's
 * client/src/lib/stock.ts and the receive/transfer handlers in
 * client/src/screens/backoffice/WarehouseScreen.tsx. Stocktake and write-off
 * are not ported yet (tracked in the mobile-parity plan).
 */
export function createWarehouseRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  const repo = {
    list(opts: { search?: string; limit?: number } = {}): WarehouseStockRow[] {
      const clauses: string[] = []
      const params: unknown[] = []
      if (opts.search) {
        clauses.push('p.name LIKE ?')
        params.push(`%${opts.search}%`)
      }
      const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : ''
      const limit = ` ORDER BY p.name LIMIT ${Math.min(opts.limit ?? 300, 1000)}`
      return db.all<Record<string, any>>(WAREHOUSE_SELECT + where + limit, params).map(mapRow)
    },

    /** Current quantity at one location — the newest row, like every stock read in the app. */
    stockAt(productId: number, batchId: number, location: StockLocation): number {
      const row = db.get<{ quantity: number }>(
        `SELECT quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
        [productId, batchId, location]
      )
      return Number(row?.quantity ?? 0)
    },

    /**
     * Weighted average cost after adding `qty` at `unitCost` to what's on
     * hand — mirrors desktop's averageCost in client/src/lib/stock.ts.
     */
    averageCost(onHand: number, currentCost: number, qty: number, unitCost: number): number {
      const have = Math.max(0, onHand)
      const avg = have > 0 ? (have * currentCost + qty * unitCost) / (have + qty) : unitCost
      return Math.round(avg * 100) / 100
    },

    /** The one door for a stock change that isn't a sale — always records a quantity_adjustments row. */
    moveStock(opts: {
      productId: number
      batchId: number
      location: StockLocation
      delta: number
      kind: StockMoveKind
      reason: string
      userId: number
    }): { previous: number; adjusted: number } {
      const now = new Date().toISOString()
      let stock = db.get<{ id: number; quantity: number }>(
        `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
        [opts.productId, opts.batchId, opts.location]
      )
      let previous = 0
      let adjusted = 0
      db.transaction(() => {
        if (!stock) {
          db.run(
            `INSERT INTO product_stocks (sync_id, product_id, batch_id, location, quantity, updated_at) VALUES (?,?,?,?,0,?)`,
            [uuid(), opts.productId, opts.batchId, opts.location, now]
          )
          stock = db.get<{ id: number; quantity: number }>(
            `SELECT id, quantity FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1`,
            [opts.productId, opts.batchId, opts.location]
          )!
        }
        previous = Number(stock!.quantity)
        adjusted = previous + opts.delta
        const adjSyncId = uuid()
        db.run(`UPDATE product_stocks SET quantity = quantity + ?, updated_at=? WHERE id=?`, [opts.delta, now, stock!.id])
        db.run(
          `INSERT INTO quantity_adjustments (sync_id, batch_id, stock_id, previous_quantity, adjusted_quantity, reason, location, kind, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [adjSyncId, opts.batchId, stock!.id, previous, adjusted, opts.reason || null, opts.location, opts.kind, opts.userId, now, now]
        )
        enqueue('quantity_adjustments', adjSyncId, 'upsert')
      })
      return { previous, adjusted }
    },

    /**
     * A delivery without an order: goods land in the shop (sellable at once)
     * or the warehouse, and the batch's cost becomes the weighted average of
     * what's on hand and what this delivery cost.
     */
    receive(opts: {
      productId: number
      batchId: number
      qty: number
      location: StockLocation
      reason: string
      userId: number
      unitCost?: number
    }): void {
      const onHand = repo.stockAt(opts.productId, opts.batchId, 'shop') + repo.stockAt(opts.productId, opts.batchId, 'warehouse')
      repo.moveStock({ ...opts, delta: opts.qty, kind: 'receipt' })
      if (opts.unitCost !== undefined && opts.unitCost > 0) {
        const batch = db.get<{ cost: number; sync_id: string | null }>(`SELECT cost, sync_id FROM product_batches WHERE id=?`, [opts.batchId])
        const cost = repo.averageCost(onHand, Number(batch?.cost ?? 0), opts.qty, opts.unitCost)
        if (cost !== Number(batch?.cost ?? 0)) {
          db.run(`UPDATE product_batches SET cost=?, updated_at=? WHERE id=?`, [cost, new Date().toISOString(), opts.batchId])
          if (batch?.sync_id) enqueue('product_batches', batch.sync_id, 'upsert')
        }
      }
    },

    /** Moves stock from the warehouse onto the shop floor — two linked adjustments, atomic by caller convention. */
    transferToShop(opts: { productId: number; batchId: number; qty: number; userId: number }): void {
      if (repo.stockAt(opts.productId, opts.batchId, 'warehouse') < opts.qty) {
        throw new Error('Not enough stock in the warehouse')
      }
      repo.moveStock({
        productId: opts.productId, batchId: opts.batchId, location: 'warehouse',
        delta: -opts.qty, kind: 'transfer', reason: 'Transfer out', userId: opts.userId,
      })
      repo.moveStock({
        productId: opts.productId, batchId: opts.batchId, location: 'shop',
        delta: opts.qty, kind: 'transfer', reason: 'Transfer in', userId: opts.userId,
      })
    },

    /** Every stock-managed product's batch + system quantity at one location — the count sheet to fill in. */
    stocktakeItems(location: StockLocation): StocktakeRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT p.id AS product_id, p.name, pb.id AS batch_id, COALESCE(pb.cost, 0) AS cost,
                  COALESCE((SELECT quantity FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = ? ORDER BY id DESC LIMIT 1), 0) AS system
           FROM products p
           JOIN product_batches pb ON pb.id = (SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1)
           WHERE p.deleted_at IS NULL AND p.is_stock_managed = 1
           ORDER BY p.name`,
          [location]
        )
        .map((r) => ({ productId: r.product_id, name: r.name, batchId: r.batch_id, cost: Number(r.cost) || 0, system: Number(r.system) || 0 }))
    },

    /**
     * Counted what's physically there; the system records the differences —
     * each one its own stock document (kind='stocktake'), never a silent
     * overwrite. Only lines whose count differs from the system figure
     * change anything. One audit row summarizes the whole session, like
     * desktop's StocktakeModal.
     */
    applyStocktake(
      location: StockLocation,
      lines: Array<{ productId: number; batchId: number; name: string; system: number; counted: number; cost: number }>,
      note: string,
      userId: number
    ): { changed: number } {
      const changes = lines.filter((l) => l.counted !== l.system)
      if (changes.length === 0) return { changed: 0 }
      const reason = `Stocktake${note.trim() ? `: ${note.trim()}` : ''}`
      let shortageValue = 0
      let surplusValue = 0
      // Each line is its own moveStock transaction (which already wraps
      // itself) — not nested inside one big transaction, since the DbAdapter
      // doesn't guarantee nested transactions are safe. Matches
      // transferToShop's same already-accepted non-atomic-pair tradeoff.
      for (const l of changes) {
        const delta = l.counted - l.system
        repo.moveStock({ productId: l.productId, batchId: l.batchId, location, delta, kind: 'stocktake', reason, userId })
        if (delta < 0) shortageValue += Math.abs(delta) * l.cost
        else surplusValue += delta * l.cost
      }
      logAudit(db, uuid, enqueue, 'stocktake', {
        entity: 'stock', entityId: location, userId,
        details: {
          location, counted: lines.length, changed: changes.length, note: note.trim() || null,
          shortageValue, surplusValue,
          lines: changes.map((l) => ({ product: l.name, system: l.system, counted: l.counted })),
        },
      })
      return { changed: changes.length }
    },

    /**
     * Writing off goods that can no longer be sold — broken, expired, lost
     * or stolen. Never more than is in stock at that location.
     */
    writeOff(opts: {
      productId: number
      batchId: number
      productName: string
      location: StockLocation
      qty: number
      cost: number
      reason: WriteOffReason
      note?: string
      userId: number
    }): void {
      if (repo.stockAt(opts.productId, opts.batchId, opts.location) < opts.qty) {
        throw new Error('Not enough stock at that location')
      }
      const text = opts.note?.trim() ? `${opts.reason}: ${opts.note.trim()}` : opts.reason
      // moveStock already wraps its own transaction — not nested further, see applyStocktake's note above.
      repo.moveStock({
        productId: opts.productId, batchId: opts.batchId, location: opts.location,
        delta: -opts.qty, kind: 'writeoff', reason: text, userId: opts.userId,
      })
      logAudit(db, uuid, enqueue, 'writeoff', {
        entity: 'product', entityId: opts.productId, userId: opts.userId,
        details: {
          product: opts.productName, qty: opts.qty, location: opts.location,
          reason: opts.reason, note: opts.note?.trim() || null, value: opts.qty * opts.cost,
        },
      })
    },
  }
  return repo
}

export type WarehouseRepository = ReturnType<typeof createWarehouseRepository>
