import { v4 as uuidv4 } from 'uuid'
import { logAudit } from './audit'

// Voids and refunds of a recorded sale (Back office > Sotuvlar). Kept out of
// the screen so the same code is what the screen runs and what the sync tests
// exercise.

export interface SaleForOps {
  id: number
  sync_id: string | null
  invoice_number: string
  sale_type: string
  total_amount: number
  store_id?: number
  contact_id?: number | null
  session_id?: number | null
  items: Array<{ product_id: number | null; batch_id: number | null; quantity: number }>
  payments: Array<{ payment_method: string; amount: number }>
}

export interface RefundLine {
  productId: number | null
  batchId: number | null
  name: string
  qty: number
  /** What one unit actually cost the customer (item + sale-level discounts spread in). */
  refundEach: number
  unitCost: number
}

/**
 * Void = the sale never happened: goods back on the shop shelf (a voided
 * return takes them off again), the debt it put on the customer taken off,
 * and its money out of the shift (a cancelled sale is excluded everywhere).
 * The server undoes the same effects once, when the cancelled sale arrives.
 */
export async function voidSale(sale: SaleForOps, reason: string): Promise<void> {
  const now = new Date().toISOString()
  const isReturn = sale.sale_type === 'return'
  const ops: Array<{ sql: string; params: unknown[] }> = [
    { sql: `UPDATE sales SET status='cancelled', updated_at=? WHERE id=?`, params: [now, sale.id] },
  ]
  for (const item of sale.items) {
    if (!item.product_id || !item.batch_id) continue
    const qty = Math.abs(Number(item.quantity))
    ops.push({
      sql: `UPDATE product_stocks SET quantity = quantity + ?, updated_at = ?
            WHERE id = (SELECT id FROM product_stocks WHERE product_id=? AND batch_id=? AND location='shop' ORDER BY id DESC LIMIT 1)`,
      params: [isReturn ? -qty : qty, now, item.product_id, item.batch_id],
    })
  }
  const debt = sale.payments.filter((p) => p.payment_method === 'Debt').reduce((s, p) => s + Number(p.amount), 0)
  if (debt !== 0 && sale.contact_id) {
    ops.push({ sql: `UPDATE contacts SET balance = balance - ?, updated_at = ? WHERE id = ?`, params: [debt, now, sale.contact_id] })
  }
  await window.electronAPI.db.transaction(ops)
  if (sale.sync_id) await window.electronAPI.sync.enqueue('sales', sale.sync_id, 'upsert')
  await logAudit('sale_void', {
    entity: 'sale', entityId: sale.invoice_number,
    details: { total: Number(sale.total_amount), reason: reason.trim(), payments: sale.payments },
  })
  window.electronAPI.sync.pushPending().catch(() => {})
}

/**
 * A refund as its own 'return' sale, written the way Android writes them —
 * negative amounts, positive quantities — which is what the server and the
 * reports expect: goods back on the shop shelf, the money out of the CURRENT
 * till session (that's the drawer paying it), and a refund to debt lowers
 * what the customer owes. The caller caps each line at sold − already refunded.
 */
export async function refundSale(
  sale: SaleForOps,
  lines: RefundLine[],
  method: string,
  opts: { userId: number | null; storeId: number }
): Promise<{ invoice: string; refundTotal: number }> {
  const now = new Date().toISOString()
  const syncId = uuidv4()
  const refundTotal = Math.round(lines.reduce((s, l) => s + l.refundEach * l.qty, 0) * 100) / 100
  const current = await window.electronAPI.session.current() as { id: number } | null
  const sessionId = current?.id ?? sale.session_id ?? null
  const leased = await window.electronAPI.sync.nextInvoiceNumber()
  const invoice = `RET-${leased ?? syncId.slice(0, 8).toUpperCase()}`
  const storeId = sale.store_id ?? opts.storeId

  const ops: Array<{ sql: string; params: unknown[] }> = [{
    sql: `INSERT INTO sales (sync_id, store_id, session_id, contact_id, user_id, invoice_number, sale_type,
            reference_id, subtotal, total_amount, amount_received, change_amount, status, payment_status,
            sale_date, sale_time, created_at, updated_at, sync_status)
          VALUES (?,?,?,?,?,?,'return',?,?,?,?,0,'completed','fully_paid',?,?,?,?,'pending')`,
    params: [syncId, storeId, sessionId, sale.contact_id ?? null, opts.userId ?? 1,
      invoice, sale.id, -refundTotal, -refundTotal, -refundTotal,
      now.split('T')[0], now.split('T')[1].slice(0, 8), now, now],
  }]
  for (const line of lines) {
    ops.push({
      sql: `INSERT INTO sale_items (sync_id, sale_id, item_type, product_id, batch_id, description, quantity, unit_price, unit_cost, created_at)
            SELECT ?, id, 'product', ?, ?, ?, ?, ?, ?, ? FROM sales WHERE sync_id=?`,
      params: [uuidv4(), line.productId, line.batchId, line.name, line.qty, -line.refundEach, -line.unitCost, now, syncId],
    })
    if (line.productId && line.batchId) {
      ops.push({
        sql: `UPDATE product_stocks SET quantity = quantity + ?, updated_at = ?
              WHERE id = (SELECT id FROM product_stocks WHERE product_id=? AND batch_id=? AND location='shop' ORDER BY id DESC LIMIT 1)`,
        params: [line.qty, now, line.productId, line.batchId],
      })
    }
  }
  ops.push({
    sql: `INSERT INTO payment_transactions (sync_id, sale_id, store_id, session_id, transaction_date, amount,
            payment_method, transaction_type, charge_state, created_at, sync_status)
          SELECT ?, id, ?, ?, ?, ?, ?, 'return', 'FULLY_CHARGED', ?, 'pending' FROM sales WHERE sync_id=?`,
    params: [uuidv4(), storeId, sessionId, now, -refundTotal, method, now, syncId],
  })
  if (method === 'Debt' && sale.contact_id) {
    ops.push({ sql: `UPDATE contacts SET balance = balance - ?, updated_at = ? WHERE id = ?`, params: [refundTotal, now, sale.contact_id] })
  }
  // Outbox pointer in the same transaction — the push payload is rebuilt
  // from these rows at flush time (same as a POS checkout).
  ops.push({
    sql: `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
          VALUES ('sale', 'sales', 'upsert', '{}', ?, ?, 'pending')`,
    params: [syncId, now],
  })
  await window.electronAPI.db.transaction(ops)
  await logAudit('sale_return', {
    entity: 'sale', entityId: sale.invoice_number,
    details: { returnInvoice: invoice, refund: refundTotal, method, lines: lines.map((l) => ({ product: l.name, qty: l.qty })) },
  })
  window.electronAPI.sync.pushPending().catch(() => {})
  return { invoice, refundTotal }
}
