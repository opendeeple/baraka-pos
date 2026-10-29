import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'
import { logAudit } from './audit'

// Suppliers are contacts of type 'vendor' (or 'both'), synced like
// customers. What the shop owes one is computed from its received orders
// (purchases.total_amount − amount_paid), never kept as a counter — mirrors
// desktop's client/src/lib/suppliers.ts + lib/purchases.ts's paySupplier.

export type PayMethod = 'Cash' | 'Card' | 'Click' | 'Transfer'

export interface SupplierRow {
  id: number
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  /** What the shop still owes for goods received. */
  owed: number
  orders: number
  bought: number
  lastOrder: string | null
}

export interface SupplierForm {
  name: string
  phone?: string | null
  address?: string | null
  notes?: string | null
}

export interface SupplierOrderRow {
  id: number
  referenceNumber: string | null
  status: string
  totalAmount: number
  amountPaid: number
  createdAt: string
  receivedAt: string | null
}

export interface SupplierPaymentRow {
  id: number
  amount: number
  paymentMethod: string | null
  description: string | null
  createdAt: string
}

const SUPPLIER_DEBT_SQL = `COALESCE((SELECT SUM(total_amount - COALESCE(amount_paid, 0)) FROM purchases
  WHERE vendor_id = c.id AND status = 'received' AND deleted_at IS NULL), 0)`

export function createSupplierRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(search?: string): SupplierRow[] {
      const clauses = [`c.type IN ('vendor','both')`, `c.deleted_at IS NULL`]
      const params: unknown[] = []
      if (search?.trim()) {
        clauses.push('(c.name LIKE ? OR c.phone LIKE ?)')
        params.push(`%${search.trim()}%`, `%${search.trim()}%`)
      }
      return db
        .all<Record<string, any>>(
          `SELECT c.id, c.name, c.phone, c.address, c.notes,
                  ${SUPPLIER_DEBT_SQL} AS owed,
                  (SELECT COUNT(*) FROM purchases WHERE vendor_id = c.id AND deleted_at IS NULL) AS orders,
                  COALESCE((SELECT SUM(total_amount) FROM purchases WHERE vendor_id = c.id AND status = 'received' AND deleted_at IS NULL), 0) AS bought,
                  (SELECT MAX(created_at) FROM purchases WHERE vendor_id = c.id AND deleted_at IS NULL) AS last_order
           FROM contacts c WHERE ${clauses.join(' AND ')}
           ORDER BY owed DESC, c.name`,
          params
        )
        .map((r) => ({
          id: r.id, name: r.name, phone: r.phone, address: r.address, notes: r.notes,
          owed: Number(r.owed) || 0, orders: Number(r.orders) || 0, bought: Number(r.bought) || 0,
          lastOrder: r.last_order,
        }))
    },

    /** Creates (id null) or updates a supplier. Returns its id. */
    save(id: number | null, form: SupplierForm): number {
      const now = new Date().toISOString()
      const values = [form.name.trim(), form.phone?.trim() || null, form.address?.trim() || null, form.notes?.trim() || null]
      let resultId = id ?? 0
      db.transaction(() => {
        if (id) {
          db.run(`UPDATE contacts SET name=?, phone=?, address=?, notes=?, updated_at=? WHERE id=?`, [...values, now, id])
          const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM contacts WHERE id=?`, [id])
          if (row?.sync_id) enqueue('contacts', row.sync_id, 'upsert')
        } else {
          const syncId = uuid()
          db.run(
            `INSERT INTO contacts (sync_id, name, phone, address, notes, type, balance, loyalty_points_balance, created_at, updated_at)
             VALUES (?,?,?,?,?,'vendor',0,0,?,?)`,
            [syncId, ...values, now, now]
          )
          enqueue('contacts', syncId, 'upsert')
          resultId = db.get<{ id: number }>(`SELECT id FROM contacts WHERE sync_id=?`, [syncId])!.id
        }
      })
      return resultId
    },

    orders(supplierId: number, limit = 50): SupplierOrderRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT id, reference_number, status, total_amount, COALESCE(amount_paid, 0) AS amount_paid, created_at, received_at
           FROM purchases WHERE vendor_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
          [supplierId, limit]
        )
        .map((r) => ({
          id: r.id, referenceNumber: r.reference_number, status: r.status,
          totalAmount: Number(r.total_amount) || 0, amountPaid: Number(r.amount_paid) || 0,
          createdAt: r.created_at, receivedAt: r.received_at,
        }))
    },

    payments(supplierId: number, limit = 50): SupplierPaymentRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT id, ABS(amount) AS amount, payment_method, description, created_at FROM cash_logs
           WHERE contact_id=? AND source='purchase' ORDER BY created_at DESC LIMIT ?`,
          [supplierId, limit]
        )
        .map((r) => ({
          id: r.id, amount: Number(r.amount) || 0, paymentMethod: r.payment_method,
          description: r.description, createdAt: r.created_at,
        }))
    },

    /**
     * Pays a supplier: the amount settles their received orders oldest
     * first. A cash payment is recorded without a till session — mobile has
     * no open-shift concept (see expense.repo.ts's create() for the same
     * convention). Returns how much was actually applied (capped at what's owed).
     */
    pay(vendorId: number, amount: number, method: PayMethod, opts: { userId: number | null; storeId: number; note?: string }): { applied: number; orders: string[] } {
      const unpaid = db.all<{ id: number; sync_id: string; reference_number: string | null; total_amount: number; amount_paid: number }>(
        `SELECT id, sync_id, reference_number, total_amount, COALESCE(amount_paid, 0) AS amount_paid
         FROM purchases WHERE vendor_id=? AND status='received' AND deleted_at IS NULL AND COALESCE(amount_paid,0) < total_amount
         ORDER BY COALESCE(received_at, created_at), id`,
        [vendorId]
      )
      const owed = unpaid.reduce((s, p) => s + Number(p.total_amount) - Number(p.amount_paid), 0)
      const pay = Math.min(Math.round(amount * 100) / 100, Math.round(owed * 100) / 100)
      if (!(pay > 0)) throw new Error('Nothing to pay')

      const now = new Date().toISOString()
      const orderRefs: string[] = []
      let left = pay
      db.transaction(() => {
        for (const p of unpaid) {
          if (left <= 0) break
          const due = Number(p.total_amount) - Number(p.amount_paid)
          const part = Math.min(due, left)
          left = Math.round((left - part) * 100) / 100
          const paid = Math.round((Number(p.amount_paid) + part) * 100) / 100
          db.run(
            `UPDATE purchases SET amount_paid=?, payment_status=?, updated_at=? WHERE id=?`,
            [paid, paid >= Number(p.total_amount) ? 'fully_paid' : 'partially_paid', now, p.id]
          )
          orderRefs.push(p.reference_number ?? String(p.id))
        }
        const vendor = db.get<{ name: string }>(`SELECT name FROM contacts WHERE id=?`, [vendorId])
        const cashSyncId = uuid()
        db.run(
          `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, payment_method,
             description, contact_id, created_by, created_at, updated_at)
           VALUES (?, ?, NULL, 'cash_out', ?, 'purchase', ?, ?, ?, ?, ?, ?)`,
          [cashSyncId, opts.storeId, -pay, method, opts.note?.trim() || `Payment to supplier: ${orderRefs.join(', ')}`, vendorId, opts.userId, now, now]
        )
        enqueue('cash_logs', cashSyncId, 'upsert')
        logAudit(db, uuid, enqueue, 'supplier_payment', {
          entity: 'contact', entityId: vendorId, userId: opts.userId,
          details: { supplier: vendor?.name ?? null, amount: pay, method, orders: orderRefs },
        })
      })
      return { applied: pay, orders: orderRefs }
    },
  }
}

export type SupplierRepository = ReturnType<typeof createSupplierRepository>
