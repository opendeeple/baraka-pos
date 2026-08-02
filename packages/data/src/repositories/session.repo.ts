import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

/** Raw snake_case session row (matches Electron's LocalPosSession convention). */
export interface LocalSession {
  id: number
  sync_id: string | null
  store_id: number
  terminal_id: string
  user_id: number
  state: string
  opening_balance: number
  closing_balance_theoretical: number | null
  closing_balance_actual: number | null
  variance: number | null
  opened_at: string | null
  closed_at: string | null
}

export function createSessionRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    current(terminalId: string): LocalSession | null {
      return (
        (db.get<LocalSession>(
          `SELECT * FROM pos_sessions WHERE terminal_id=? AND state IN ('opened','opening_control') ORDER BY id DESC LIMIT 1`,
          [terminalId]
        ) as LocalSession | undefined) ?? null
      )
    },

    open(opts: { storeId: number; terminalId: string; userId: number; openingBalance: number }): LocalSession {
      const now = new Date().toISOString()
      const syncId = uuid()
      db.transaction(() => {
        db.run(
          `UPDATE pos_sessions SET state='closed', closed_at=? WHERE terminal_id=? AND state IN ('opened','opening_control')`,
          [now, opts.terminalId]
        )
        db.run(
          `INSERT INTO pos_sessions (sync_id, store_id, terminal_id, user_id, state, opening_balance, opened_at, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, 'opened', ?, ?, ?, ?, 'pending')`,
          [syncId, opts.storeId, opts.terminalId, opts.userId, opts.openingBalance, now, now, now]
        )
        enqueue('pos_sessions', syncId, 'upsert')
      })
      return this.current(opts.terminalId)!
    },

    /**
     * Drawer movement (paid-in / paid-out). A cash-in with a contact is a
     * debt repayment: the customer's balance drops locally now, and the
     * server applies the same decrement when the movement syncs.
     */
    cashMovement(input: {
      sessionId: number
      storeId: number
      userId: number
      type: 'cash_in' | 'cash_out'
      amount: number
      reason: string
      note?: string | null
      contactId?: number | null
    }): void {
      if (input.amount <= 0) throw new Error('Amount must be positive')
      const now = new Date().toISOString()
      if (input.type === 'cash_out') {
        const available = this.expectedCash(input.sessionId)
        if (input.amount > available) {
          throw new Error(`Only ${available} cash available in the drawer`)
        }
      }
      const syncId = uuid()
      const description = input.note ? `${input.reason}: ${input.note}` : input.reason
      db.transaction(() => {
        db.run(
          `INSERT INTO cash_logs (sync_id, store_id, session_id, contact_id, transaction_type, amount, source, description, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            syncId, input.storeId, input.sessionId, input.contactId ?? null, input.type,
            input.amount, input.type === 'cash_in' ? 'deposit' : 'withdrawal',
            description, input.userId, now, now,
          ]
        )
        if (input.contactId && input.type === 'cash_in') {
          db.run(`UPDATE contacts SET balance = balance - ?, updated_at = ? WHERE id = ?`, [
            input.amount, now, input.contactId,
          ])
        }
        enqueue('cash_logs', syncId, 'upsert')
      })
    },

    /** Movements for the session, newest first (drawer history feed). */
    cashMovements(sessionId: number): Array<{
      id: number
      type: string
      amount: number
      description: string | null
      contactName: string | null
      createdAt: string
    }> {
      return db
        .all<Record<string, any>>(
          `SELECT cl.id, cl.transaction_type, cl.amount, cl.description, cl.created_at, c.name AS contact_name
           FROM cash_logs cl LEFT JOIN contacts c ON c.id = cl.contact_id
           WHERE cl.session_id=? AND cl.source IN ('deposit','withdrawal')
           ORDER BY cl.id DESC`,
          [sessionId]
        )
        .map((r) => ({
          id: r.id,
          type: r.transaction_type,
          amount: Number(r.amount) || 0,
          description: r.description,
          contactName: r.contact_name,
          createdAt: r.created_at,
        }))
    },

    /** Opening + cash sales − cash refunds + paid-in − paid-out. */
    expectedCash(sessionId: number): number {
      const session = db.get<LocalSession>(`SELECT * FROM pos_sessions WHERE id=?`, [sessionId])
      if (!session) return 0
      const salesCash = db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM payment_transactions
         WHERE session_id=? AND payment_method='Cash' AND transaction_type IN ('sale','return')`,
        [sessionId]
      )
      const movements = db.get<{ total: number }>(
        `SELECT COALESCE(SUM(CASE WHEN transaction_type='cash_in' THEN amount ELSE -amount END), 0) as total
         FROM cash_logs WHERE session_id=? AND source IN ('deposit','withdrawal')`,
        [sessionId]
      )
      return Number(session.opening_balance) + Number(salesCash?.total ?? 0) + Number(movements?.total ?? 0)
    },

    close(sessionId: number, closingBalanceActual: number): LocalSession {
      const now = new Date().toISOString()
      const session = db.get<LocalSession>(`SELECT * FROM pos_sessions WHERE id=?`, [sessionId])
      if (!session) throw new Error(`Session ${sessionId} not found`)

      const theoretical = this.expectedCash(sessionId)
      const variance = closingBalanceActual - theoretical

      db.transaction(() => {
        db.run(
          `UPDATE pos_sessions SET state='closed', closing_balance_theoretical=?, closing_balance_actual=?, variance=?, closed_at=?, updated_at=?, sync_status='pending' WHERE id=?`,
          [theoretical, closingBalanceActual, variance, now, now, sessionId]
        )
        if (session.sync_id) enqueue('pos_sessions', session.sync_id, 'upsert')
      })
      return db.get<LocalSession>(`SELECT * FROM pos_sessions WHERE id=?`, [sessionId])!
    },

    /** Totals by payment method for the close screen. */
    summary(sessionId: number): Array<{ paymentMethod: string; total: number; count: number }> {
      return db
        .all<Record<string, any>>(
          `SELECT payment_method, SUM(amount) AS total, COUNT(*) AS count
           FROM payment_transactions WHERE session_id=? AND transaction_type='sale'
           GROUP BY payment_method ORDER BY total DESC`,
          [sessionId]
        )
        .map((r) => ({ paymentMethod: r.payment_method, total: Number(r.total) || 0, count: r.count }))
    },
  }
}

export type SessionRepository = ReturnType<typeof createSessionRepository>
