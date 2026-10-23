import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

export interface ExpenseItem {
  id: number
  expenseDate: string
  category: string
  description: string | null
  amount: number
  paymentMethod: string
  reference: string | null
  createdAt: string
}

export interface CreateExpenseInput {
  storeId: number
  sessionId: number | null
  userId: number
  expenseDate: string
  category: string
  description: string
  amount: number
  paymentMethod: string
  reference?: string | null
}

/** Mirrors desktop's client/src/screens/backoffice/ExpensesScreen.tsx saveExpense. */
export function createExpenseRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(opts: { dateFrom: string; dateTo: string; category?: string }): ExpenseItem[] {
      const clauses = ['expense_date >= ?', 'expense_date <= ?', 'deleted_at IS NULL']
      const params: unknown[] = [opts.dateFrom, opts.dateTo]
      if (opts.category) {
        clauses.push('category = ?')
        params.push(opts.category)
      }
      return db
        .all<Record<string, any>>(
          `SELECT id, expense_date, category, description, amount, payment_method, reference, created_at
           FROM expenses WHERE ${clauses.join(' AND ')}
           ORDER BY expense_date DESC, created_at DESC`,
          params
        )
        .map((r) => ({
          id: r.id,
          expenseDate: r.expense_date,
          category: r.category,
          description: r.description,
          amount: Number(r.amount) || 0,
          paymentMethod: r.payment_method,
          reference: r.reference,
          createdAt: r.created_at,
        }))
    },

    create(input: CreateExpenseInput): void {
      const now = new Date().toISOString()
      const syncId = uuid()
      db.transaction(() => {
        db.run(
          `INSERT INTO expenses (sync_id,expense_date,category,description,amount,payment_method,reference,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            syncId, input.expenseDate, input.category, input.description, input.amount,
            input.paymentMethod, input.reference ?? null, input.userId, now, now,
          ]
        )
        enqueue('expenses', syncId, 'upsert')
        if (input.paymentMethod === 'Cash') {
          // The cash leaving the drawer is its own synced fact (pushed as a
          // cash_out), tied to this till's open session so the shift's
          // expected cash accounts for it — same as the desktop screen.
          const cashLogSyncId = uuid()
          db.run(
            `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, payment_method, description, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 'expense', ?, 'expense', 'Cash', ?, ?, ?, ?)`,
            [
              cashLogSyncId, input.storeId, input.sessionId, -input.amount,
              input.description || input.category, input.userId, now, now,
            ]
          )
          enqueue('cash_logs', cashLogSyncId, 'upsert')
        }
      })
    },
  }
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>
