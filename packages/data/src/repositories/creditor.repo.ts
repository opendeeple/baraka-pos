import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

// Creditors ("haqdorlar"): money (or goods) the shop took from a customer
// and must give back by a due date — the reverse of a customer debt.
// Mirrors desktop's client/src/lib/creditors.ts + CreditorsScreen.tsx.

export type CreditorCurrency = 'UZS' | 'USD'
export type CreditorStatus = 'open' | 'returned'
export type CreditorReturnType = 'money' | 'product'

export interface CreditorRow {
  id: number
  syncId: string
  name: string
  phone: string | null
  amount: number
  currency: CreditorCurrency
  returnType: CreditorReturnType
  productNote: string | null
  receivedAt: string
  dueDate: string
  remindDays: number
  status: CreditorStatus
  returnedAt: string | null
  note: string | null
}

export interface CreditorForm {
  name: string
  phone?: string | null
  amount: number
  currency: CreditorCurrency
  returnType: CreditorReturnType
  productNote?: string | null
  receivedAt: string
  dueDate: string
  remindDays: number
  note?: string | null
}

export function todayYmd(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days from today to `ymd`; negative once it has passed. */
export function daysUntil(ymd: string, today = todayYmd()): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(ymd) - toUtc(today)) / 86_400_000)
}

export function fmtCreditorAmount(amount: number, currency: string): string {
  return currency === 'USD'
    ? `$ ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `UZS ${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function mapRow(r: Record<string, any>): CreditorRow {
  return {
    id: r.id, syncId: r.sync_id, name: r.name, phone: r.phone,
    amount: Number(r.amount) || 0, currency: r.currency, returnType: r.return_type,
    productNote: r.product_note, receivedAt: r.received_at, dueDate: r.due_date,
    remindDays: Number(r.remind_days) || 0, status: r.status, returnedAt: r.returned_at, note: r.note,
  }
}

export function createCreditorRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(opts: { status?: CreditorStatus | 'all'; search?: string; limit?: number } = {}): CreditorRow[] {
      const clauses = ['deleted_at IS NULL']
      const params: unknown[] = []
      if (opts.status && opts.status !== 'all') {
        clauses.push('status = ?')
        params.push(opts.status)
      }
      if (opts.search?.trim()) {
        clauses.push('(name LIKE ? OR phone LIKE ?)')
        params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`)
      }
      const order = opts.status === 'returned' ? 'ORDER BY returned_at DESC' : `ORDER BY status = 'returned', due_date ASC`
      return db
        .all<Record<string, any>>(
          `SELECT id, sync_id, name, phone, amount, currency, return_type, product_note, received_at, due_date,
                  remind_days, status, returned_at, note
           FROM creditors WHERE ${clauses.join(' AND ')} ${order} LIMIT ?`,
          [...params, Math.min(opts.limit ?? 500, 500)]
        )
        .map(mapRow)
    },

    save(id: number | null, form: CreditorForm, userId: number | null): void {
      const now = new Date().toISOString()
      const remindDays = Math.max(0, Math.floor(form.remindDays))
      const values = [
        form.name.trim(), form.phone?.trim() || null, form.amount, form.currency, form.returnType,
        form.returnType === 'product' ? (form.productNote?.trim() || null) : null,
        form.receivedAt, form.dueDate, remindDays, form.note?.trim() || null,
      ]
      db.transaction(() => {
        if (id) {
          const existing = db.get<{ sync_id: string; due_date: string; remind_days: number }>(
            `SELECT sync_id, due_date, remind_days FROM creditors WHERE id=?`, [id]
          )
          if (!existing) throw new Error(`Creditor ${id} not found`)
          // A new due date or warning window means the owner should be warned again.
          const rescheduled = existing.due_date !== form.dueDate || Number(existing.remind_days) !== remindDays
          db.run(
            `UPDATE creditors SET name=?, phone=?, amount=?, currency=?, return_type=?, product_note=?, received_at=?,
               due_date=?, remind_days=?, note=?, updated_at=?
               ${rescheduled ? ', reminder_sent_at=NULL, overdue_sent_at=NULL' : ''}
             WHERE id=?`,
            [...values, now, id]
          )
          enqueue('creditors', existing.sync_id, 'upsert')
        } else {
          const syncId = uuid()
          db.run(
            `INSERT INTO creditors (name, phone, amount, currency, return_type, product_note, received_at, due_date,
               remind_days, note, sync_id, status, created_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`,
            [...values, syncId, userId, now, now]
          )
          enqueue('creditors', syncId, 'upsert')
        }
      })
    },

    markReturned(id: number): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM creditors WHERE id=?`, [id])
        if (!row) return
        db.run(`UPDATE creditors SET status='returned', returned_at=?, updated_at=? WHERE id=?`, [todayYmd(), now, id])
        enqueue('creditors', row.sync_id, 'upsert')
      })
    },

    softDelete(id: number): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM creditors WHERE id=?`, [id])
        if (!row) return
        db.run(`UPDATE creditors SET deleted_at=?, updated_at=? WHERE id=?`, [now, now, id])
        enqueue('creditors', row.sync_id, 'delete')
      })
    },
  }
}

export type CreditorRepository = ReturnType<typeof createCreditorRepository>
