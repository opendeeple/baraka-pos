import type { CartItem, CartCharge, PaymentEntry } from '@baraka/shared'
import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

export interface CreateSaleInput {
  storeId: number
  sessionId: number
  userId: number
  contactId?: number | null
  items: CartItem[]
  charges: CartCharge[]
  discount: number
  payments: Array<Pick<PaymentEntry, 'paymentMethod' | 'amount'>>
  /** Final invoice number (from the leased range) or a local placeholder. */
  invoiceNumber: string
  note?: string | null
}

export interface CreateSaleResult {
  saleId: number
  syncId: string
  invoiceNumber: string
  total: number
  changeAmount: number
}

export interface SaleHistoryItem {
  id: number
  syncId: string
  invoiceNumber: string
  saleTime: string
  totalAmount: number
  paymentStatus: string
  status: string
  saleType: string
  syncStatus: string
  contactName: string | null
}

export function saleTotals(items: CartItem[], charges: CartCharge[], discount: number) {
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = item.unitPrice * item.quantity
    const lineDiscount = item.discount > 0 ? lineTotal * (item.discount / 100) : 0
    return sum + lineTotal - lineDiscount
  }, 0)
  const chargeAmount = charges.reduce(
    (sum, c) => (c.rateType === 'percentage' ? sum + (subtotal * c.rateValue) / 100 : sum + c.rateValue),
    0
  )
  return { subtotal, chargeAmount, total: subtotal + chargeAmount - discount }
}

export function createSaleRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    /**
     * The entire sale write — sale + items + stock decrements + payments +
     * debt balance + cash log + outbox pointer — in ONE local transaction.
     * (Port of the Electron PaymentScreen ops array; shared by Android.)
     */
    createSale(input: CreateSaleInput): CreateSaleResult {
      const syncId = uuid()
      const now = new Date().toISOString()
      const { subtotal, chargeAmount, total } = saleTotals(input.items, input.charges, input.discount)
      const paid = input.payments.reduce((s, p) => s + p.amount, 0)
      const changeAmount = Math.max(0, paid - total)
      const hasDebt = input.payments.some((p) => p.paymentMethod === 'Debt')

      let saleId = 0
      db.transaction(() => {
        db.run(
          `INSERT INTO sales (sync_id, store_id, session_id, contact_id, user_id,
             invoice_number, sale_type, subtotal, discount, total_charge_amount,
             total_amount, amount_received, change_amount, status, payment_status,
             sale_date, sale_time, cart_snapshot, created_at, updated_at, sync_status)
           VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,'pending')`,
          [
            syncId, input.storeId, input.sessionId, input.contactId ?? null, input.userId,
            input.invoiceNumber, 'sale', subtotal, input.discount, chargeAmount,
            total, paid, changeAmount, 'completed', hasDebt ? 'partially_paid' : 'fully_paid',
            now.split('T')[0], now, JSON.stringify({ items: input.items, charges: input.charges, discount: input.discount }),
            now, now,
          ]
        )
        saleId = db.get<{ id: number }>(`SELECT id FROM sales WHERE sync_id=?`, [syncId])!.id

        for (const item of input.items) {
          db.run(
            `INSERT INTO sale_items (sync_id, sale_id, item_type, product_id, batch_id, description,
               quantity, free_quantity, unit_price, unit_cost, discount, flat_discount, is_free, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              uuid(), saleId, 'product', item.productId, item.batchId, item.name,
              item.quantity, item.freeQuantity ?? 0, item.unitPrice, item.unitCost ?? 0,
              item.discount, 0, item.isFree ? 1 : 0, now,
            ]
          )
          db.run(
            `UPDATE product_stocks SET quantity = quantity - ?, updated_at = ? WHERE product_id = ? AND batch_id = ?`,
            [item.quantity, now, item.productId, item.batchId]
          )
        }

        for (const payment of input.payments) {
          db.run(
            `INSERT INTO payment_transactions (sync_id, sale_id, store_id, session_id, transaction_date,
               amount, payment_method, transaction_type, charge_state, created_at, sync_status)
             VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
            [uuid(), saleId, input.storeId, input.sessionId, now, payment.amount, payment.paymentMethod, 'sale', 'FULLY_CHARGED', now]
          )
        }

        if (hasDebt && input.contactId) {
          const debtTotal = input.payments
            .filter((p) => p.paymentMethod === 'Debt')
            .reduce((s, p) => s + p.amount, 0)
          db.run(`UPDATE contacts SET balance = balance + ?, updated_at = ? WHERE id = ?`, [
            debtTotal, now, input.contactId,
          ])
        }

        const cashTotal = input.payments
          .filter((p) => p.paymentMethod === 'Cash')
          .reduce((s, p) => s + p.amount, 0)
        if (cashTotal > 0) {
          db.run(
            `INSERT INTO cash_logs (store_id, session_id, transaction_type, amount, source, description, created_by, created_at)
             VALUES (?,?,'sale',?,'sale',?,?,?)`,
            [input.storeId, input.sessionId, cashTotal, `Sale ${saleId}`, input.userId, now]
          )
        }

        enqueue('sales', syncId, 'upsert')
      })

      return { saleId, syncId, invoiceNumber: input.invoiceNumber, total, changeAmount }
    },

    /**
     * Full-sale refund: mirrors the original sale as a `return` row with
     * NEGATIVE monetary amounts (so revenue reports net out) and positive
     * quantities, restores stock, reverses cash/debt effects, and enqueues the
     * return for sync. Returns null if the sale is missing or already returned.
     */
    createReturn(originalSaleId: number, opts: { invoiceNumber: string; userId: number }): CreateSaleResult | null {
      const original = db.get<Record<string, any>>(`SELECT * FROM sales WHERE id=?`, [originalSaleId])
      if (!original || original.sale_type === 'return' || original.status !== 'completed') return null
      const alreadyReturned = db.get<{ id: number }>(
        `SELECT id FROM sales WHERE reference_id=? AND sale_type='return'`, [originalSaleId]
      )
      if (alreadyReturned) return null

      const items = db.all<Record<string, any>>(`SELECT * FROM sale_items WHERE sale_id=?`, [originalSaleId])
      const payments = db.all<Record<string, any>>(`SELECT * FROM payment_transactions WHERE sale_id=?`, [originalSaleId])
      const syncId = uuid()
      const now = new Date().toISOString()
      const total = Number(original.total_amount) || 0

      let saleId = 0
      db.transaction(() => {
        db.run(
          `INSERT INTO sales (sync_id, store_id, session_id, contact_id, user_id,
             invoice_number, sale_type, reference_id, subtotal, discount, total_charge_amount,
             total_amount, amount_received, change_amount, status, payment_status,
             sale_date, sale_time, created_at, updated_at, sync_status)
           VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,'pending')`,
          [
            syncId, original.store_id, original.session_id, original.contact_id, opts.userId,
            opts.invoiceNumber, 'return', originalSaleId,
            -Number(original.subtotal || 0), -Number(original.discount || 0), -Number(original.total_charge_amount || 0),
            -total, -total, 0, 'completed', original.payment_status,
            now.split('T')[0], now, now, now,
          ]
        )
        saleId = db.get<{ id: number }>(`SELECT id FROM sales WHERE sync_id=?`, [syncId])!.id

        for (const item of items) {
          db.run(
            `INSERT INTO sale_items (sync_id, sale_id, item_type, product_id, batch_id, description,
               quantity, unit_price, unit_cost, discount, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              uuid(), saleId, item.item_type ?? 'product', item.product_id, item.batch_id,
              item.description, item.quantity, -Number(item.unit_price || 0),
              -Number(item.unit_cost || 0), item.discount ?? 0, now,
            ]
          )
          if (item.product_id && item.batch_id) {
            db.run(
              `UPDATE product_stocks SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND batch_id = ?`,
              [item.quantity, now, item.product_id, item.batch_id]
            )
          }
        }

        for (const payment of payments) {
          db.run(
            `INSERT INTO payment_transactions (sync_id, sale_id, store_id, session_id, transaction_date,
               amount, payment_method, transaction_type, charge_state, created_at, sync_status)
             VALUES (?,?,?,?,?,?,?,'return','FULLY_CHARGED',?,'pending')`,
            [uuid(), saleId, original.store_id, original.session_id, now, -Number(payment.amount || 0), payment.payment_method, now]
          )
          if (payment.payment_method === 'Cash') {
            db.run(
              `INSERT INTO cash_logs (store_id, session_id, transaction_type, amount, source, description, created_by, created_at)
               VALUES (?,?,'cash_out',?,'sale',?,?,?)`,
              [original.store_id, original.session_id, Number(payment.amount || 0), `Refund ${original.invoice_number}`, opts.userId, now]
            )
          }
          if (payment.payment_method === 'Debt' && original.contact_id) {
            db.run(`UPDATE contacts SET balance = balance - ?, updated_at = ? WHERE id = ?`, [
              Number(payment.amount || 0), now, original.contact_id,
            ])
          }
        }

        db.run(`UPDATE sales SET status='refunded', updated_at=? WHERE id=?`, [now, originalSaleId])
        enqueue('sales', syncId, 'upsert')
      })

      return { saleId, syncId, invoiceNumber: opts.invoiceNumber, total: -total, changeAmount: 0 }
    },

    history(opts: { sessionId?: number; limit?: number } = {}): SaleHistoryItem[] {
      const clauses: string[] = []
      const params: unknown[] = []
      if (opts.sessionId) {
        clauses.push('s.session_id = ?')
        params.push(opts.sessionId)
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      return db
        .all<Record<string, any>>(
          `SELECT s.id, s.sync_id, s.invoice_number, s.sale_time, s.total_amount,
                  s.payment_status, s.status, s.sale_type, s.sync_status, c.name AS contact_name
           FROM sales s LEFT JOIN contacts c ON c.id = s.contact_id
           ${where} ORDER BY s.id DESC LIMIT ${Math.min(opts.limit ?? 50, 500)}`,
          params
        )
        .map((r) => ({
          id: r.id,
          syncId: r.sync_id,
          invoiceNumber: r.invoice_number,
          saleTime: r.sale_time,
          totalAmount: Number(r.total_amount) || 0,
          paymentStatus: r.payment_status,
          status: r.status,
          saleType: r.sale_type ?? 'sale',
          syncStatus: r.sync_status,
          contactName: r.contact_name,
        }))
    },
  }
}

export type SaleRepository = ReturnType<typeof createSaleRepository>
