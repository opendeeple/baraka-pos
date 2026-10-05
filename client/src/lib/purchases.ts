import { v4 as uuidv4 } from 'uuid'
import { logAudit } from './audit'
import { averageCost, stockOnHand } from './stock'

// Purchase orders (Back office > Xaridlar): ordered → 'pending' (waiting for
// the delivery) → checked line by line → 'received' into the shop or the
// warehouse. The server puts received goods into stock exactly once (see
// applyPurchaseReceipt in server/src/modules/sync/syncV2.service.ts); this
// device only mirrors that locally so the goods show up at once.

export type StockLocation = 'shop' | 'warehouse'

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
  /** Why the received quantity differs from the ordered one. */
  note: string | null
  /** The supplier's invoice price, when it differs from the order's estimate. */
  unitCost?: number
  /** Expiry date printed on the goods (YYYY-MM-DD), if written down. */
  expiryDate?: string | null
}

export type PayMethod = 'Cash' | 'Card' | 'Click' | 'Transfer'

function orderNumber(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `ZK-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// The outbox pointer goes in the same transaction as the rows it points at:
// the sync engine leaves purchases with a pending outbox row alone on pull,
// and a pull landing between the two would otherwise undo the change.
function outboxOp(syncId: string, now: string) {
  return {
    sql: `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
          SELECT 'purchases', 'purchases', 'upsert', '{}', ?, ?, 'pending'
          WHERE NOT EXISTS (SELECT 1 FROM sync_queue_local WHERE sync_id = ? AND status = 'pending')`,
    params: [syncId, now, syncId],
  }
}

export async function createPurchaseOrder(
  lines: OrderLineInput[],
  opts: { storeId: number; userId: number | null; note?: string; vendorId?: number | null }
): Promise<{ id: number; reference: string }> {
  const now = new Date().toISOString()
  const syncId = uuidv4()
  const reference = orderNumber()
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const ops: Array<{ sql: string; params: unknown[] }> = [{
    sql: `INSERT INTO purchases (sync_id, store_id, vendor_id, reference_number, note, total_amount, status,
            amount_paid, payment_status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 'pending', ?, ?, ?)`,
    params: [syncId, opts.storeId, opts.vendorId ?? null, reference, opts.note?.trim() || null, total, opts.userId, now, now],
  }]
  for (const l of lines) {
    ops.push({
      sql: `INSERT INTO purchase_items (sync_id, purchase_id, product_id, batch_id, quantity, unit_cost, total_cost, created_at)
            SELECT ?, id, ?, ?, ?, ?, ?, ? FROM purchases WHERE sync_id = ?`,
      params: [uuidv4(), l.productId, l.batchId, l.qty, l.unitCost, l.qty * l.unitCost, now, syncId],
    })
  }
  ops.push(outboxOp(syncId, now))
  await window.electronAPI.db.transaction(ops)
  window.electronAPI.sync.pushPending().catch(() => {})
  const [row] = await window.electronAPI.db.query(`SELECT id FROM purchases WHERE sync_id = ?`, [syncId]) as Array<{ id: number }>
  await logAudit('purchase_order', { entity: 'purchase', entityId: reference, details: { lines: lines.length, total } })
  return { id: row.id, reference }
}

/** The order slip: what to buy, how many, estimated cost — handed to whoever goes buying. */
export async function printPurchaseOrder(purchaseId: number): Promise<{ success: boolean; error?: string }> {
  const [head] = await window.electronAPI.db.query(
    `SELECT reference_number FROM purchases WHERE id = ?`, [purchaseId]
  ) as Array<{ reference_number: string | null }>
  const items = await window.electronAPI.db.query(
    `SELECT p.name, pi.quantity, pi.unit_cost FROM purchase_items pi
     JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`, [purchaseId]
  ) as Array<{ name: string; quantity: number; unit_cost: number }>
  return window.electronAPI.printer.printShoppingList(
    items.map((i) => ({ name: i.name, qty: Number(i.quantity), cost: Number(i.unit_cost) })),
    { title: 'BUYURTMA', reference: head?.reference_number ?? undefined }
  )
}

/**
 * Marks the order received with what actually arrived per line, and adds it
 * to local stock at `location` right away. That stock change is a local copy
 * only — no quantity_adjustments: the server applies the receipt itself when
 * this purchase's push lands (once, even if another device received the same
 * order), and the next product_stocks pull replaces the local figure with
 * the server's.
 */
export async function receivePurchaseOrder(
  purchaseId: number,
  location: StockLocation,
  checks: ReceiveCheck[],
  userId: number | null
): Promise<void> {
  const now = new Date().toISOString()
  const [purchase] = await window.electronAPI.db.query(
    `SELECT sync_id, status, reference_number FROM purchases WHERE id = ?`, [purchaseId]
  ) as Array<{ sync_id: string; status: string; reference_number: string | null }>
  if (!purchase || purchase.status === 'received') throw new Error('Purchase already received')
  const items = await window.electronAPI.db.query(
    `SELECT id, product_id, batch_id, quantity, unit_cost FROM purchase_items WHERE purchase_id = ?`, [purchaseId]
  ) as Array<{ id: number; product_id: number; batch_id: number | null; quantity: number; unit_cost: number }>

  const ops: Array<{ sql: string; params: unknown[] }> = []
  let receivedTotal = 0
  for (const item of items) {
    const check = checks.find((c) => c.itemId === item.id)
    const qty = check ? check.receivedQty : Number(item.quantity)
    const unitCost = check?.unitCost != null && Number.isFinite(check.unitCost) && check.unitCost >= 0
      ? check.unitCost : Number(item.unit_cost)
    const expiry = check?.expiryDate || null
    receivedTotal += qty * unitCost
    ops.push({
      sql: `UPDATE purchase_items SET received_quantity = ?, discrepancy_note = ?, unit_cost = ?, total_cost = ?, expiry_date = ? WHERE id = ?`,
      params: [qty, check?.note ?? null, unitCost, qty * unitCost, expiry, item.id],
    })
    item.unit_cost = unitCost
    if (!item.batch_id || qty <= 0) continue
    // Newest row per product+batch+location — every stock read in the app
    // uses ORDER BY id DESC LIMIT 1 (older duplicate rows exist).
    ops.push({
      sql: `UPDATE product_stocks SET quantity = quantity + ?, updated_at = ?
            WHERE id = (SELECT id FROM product_stocks WHERE product_id = ? AND batch_id = ? AND location = ? ORDER BY id DESC LIMIT 1)`,
      params: [qty, now, item.product_id, item.batch_id, location],
    })
    ops.push({
      sql: `INSERT INTO product_stocks (sync_id, product_id, batch_id, location, quantity, updated_at)
            SELECT ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM product_stocks WHERE product_id = ? AND batch_id = ? AND location = ?)`,
      params: [uuidv4(), item.product_id, item.batch_id, location, qty, now, item.product_id, item.batch_id, location],
    })
    // Mirrors the server: the cost price becomes the weighted average of the
    // stock on hand and this delivery; the batch keeps the nearest expiry.
    const onHand = await stockOnHand(item.product_id, item.batch_id)
    if (Number(item.unit_cost) > 0) {
      const [batch] = await window.electronAPI.db.query(`SELECT cost FROM product_batches WHERE id = ?`, [item.batch_id]) as Array<{ cost: number }>
      const cost = averageCost(onHand, Number(batch?.cost ?? 0), qty, Number(item.unit_cost))
      ops.push({
        sql: `UPDATE product_batches SET cost = ?, updated_at = ? WHERE id = ? AND cost <> ?`,
        params: [cost, now, item.batch_id, cost],
      })
    }
    if (expiry) {
      ops.push({
        sql: `UPDATE product_batches SET expiry_date = ?
              WHERE id = ? AND NOT (? > 0 AND expiry_date IS NOT NULL AND substr(expiry_date, 1, 10) < ?)`,
        params: [expiry, item.batch_id, onHand, expiry],
      })
    }
  }
  // receipt_id tells this device, on a later pull, whether the server applied
  // this receipt or another device's (then the stock added above is undone).
  // The order's total becomes what actually arrived at the invoice prices —
  // what the supplier is owed.
  ops.push({
    sql: `UPDATE purchases SET status = 'received', received_location = ?, received_at = ?, received_by = ?, receipt_id = ?,
            total_amount = ?, payment_status = CASE WHEN COALESCE(amount_paid, 0) >= ? THEN 'fully_paid'
              WHEN COALESCE(amount_paid, 0) > 0 THEN 'partially_paid' ELSE 'pending' END, updated_at = ? WHERE id = ?`,
    params: [location, now, userId, uuidv4(), Math.round(receivedTotal * 100) / 100, Math.round(receivedTotal * 100) / 100, now, purchaseId],
  })
  ops.push(outboxOp(purchase.sync_id, now))
  await window.electronAPI.db.transaction(ops)
  await logAudit('purchase_receive', {
    entity: 'purchase', entityId: purchase.reference_number ?? purchaseId,
    details: {
      location, total: Math.round(receivedTotal * 100) / 100,
      lines: checks.map((c) => ({ item: c.itemId, qty: c.receivedQty, note: c.note, cost: c.unitCost, expiry: c.expiryDate })),
    },
  })
  window.electronAPI.sync.pushPending().catch(() => {})
}

/** Received orders of a supplier not yet fully paid, oldest first. */
export const UNPAID_PURCHASES_SQL = `
  SELECT id, sync_id, reference_number, total_amount, COALESCE(amount_paid, 0) AS amount_paid, received_at, created_at
  FROM purchases
  WHERE vendor_id = ? AND status = 'received' AND deleted_at IS NULL
    AND COALESCE(amount_paid, 0) < total_amount
  ORDER BY COALESCE(received_at, created_at), id`

/** What the shop owes each supplier: received goods minus what's been paid. */
export const SUPPLIER_DEBT_SQL = `
  COALESCE((SELECT SUM(total_amount - COALESCE(amount_paid, 0)) FROM purchases
            WHERE vendor_id = c.id AND status = 'received' AND deleted_at IS NULL), 0)`

/**
 * Pays a supplier: the amount settles their received orders oldest first
 * (each order's amount_paid / payment_status, synced with the order). A cash
 * payment out of the open till is a paid-out in that shift (source
 * 'purchase', counted by the Z report); otherwise it's recorded without a
 * shift — money from the safe or a bank transfer.
 */
export async function paySupplier(
  vendorId: number,
  amount: number,
  method: PayMethod,
  opts: { userId: number | null; storeId: number; fromTill: boolean; note?: string }
): Promise<{ applied: number; orders: string[] }> {
  const now = new Date().toISOString()
  const unpaid = await window.electronAPI.db.query(UNPAID_PURCHASES_SQL, [vendorId]) as Array<{
    id: number; sync_id: string; reference_number: string | null; total_amount: number; amount_paid: number
  }>
  const owed = unpaid.reduce((s, p) => s + Number(p.total_amount) - Number(p.amount_paid), 0)
  const pay = Math.min(Math.round(amount * 100) / 100, Math.round(owed * 100) / 100)
  if (!(pay > 0)) throw new Error('Nothing to pay')

  const ops: Array<{ sql: string; params: unknown[] }> = []
  const orders: string[] = []
  let left = pay
  for (const p of unpaid) {
    if (left <= 0) break
    const due = Number(p.total_amount) - Number(p.amount_paid)
    const part = Math.min(due, left)
    left = Math.round((left - part) * 100) / 100
    const paid = Math.round((Number(p.amount_paid) + part) * 100) / 100
    ops.push({
      sql: `UPDATE purchases SET amount_paid = ?, payment_status = ?, updated_at = ? WHERE id = ?`,
      params: [paid, paid >= Number(p.total_amount) ? 'fully_paid' : 'partially_paid', now, p.id],
    })
    ops.push(outboxOp(p.sync_id, now))
    orders.push(p.reference_number ?? String(p.id))
  }
  const session = opts.fromTill && method === 'Cash'
    ? await window.electronAPI.session.current() as { id: number } | null
    : null
  const cashSync = uuidv4()
  ops.push({
    sql: `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, payment_method,
            description, contact_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'cash_out', ?, 'purchase', ?, ?, ?, ?, ?, ?)`,
    params: [cashSync, opts.storeId, session?.id ?? null, -pay, method,
      opts.note?.trim() || `Yetkazib beruvchiga to'lov: ${orders.join(', ')}`, vendorId, opts.userId, now, now],
  })
  ops.push({
    sql: `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
          VALUES ('cash_logs', 'cash_logs', 'upsert', '{}', ?, ?, 'pending')`,
    params: [cashSync, now],
  })
  await window.electronAPI.db.transaction(ops)
  const [vendor] = await window.electronAPI.db.query(`SELECT name FROM contacts WHERE id = ?`, [vendorId]) as Array<{ name: string }>
  await logAudit('supplier_payment', {
    entity: 'contact', entityId: vendorId,
    details: { supplier: vendor?.name ?? null, amount: pay, method, fromTill: Boolean(session), orders },
  })
  window.electronAPI.sync.pushPending().catch(() => {})
  return { applied: pay, orders }
}
