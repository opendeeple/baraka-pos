import type { DbAdapter } from '../adapter'
import { logAudit } from './audit'

// Debt history only counts rows newer than the contact's latest clearance
// (debt_clearances, schema v12) — clearing a paid-off debt records a
// cut-off instead of deleting sales/cash_logs. '' sorts before any ISO
// timestamp, so a contact that was never cleared sees their whole history.
// Mirrors desktop's client/src/lib/debt.ts exactly.
function lastClearedSql(contactIdExpr: string): string {
  return `COALESCE((SELECT MAX(dc.cleared_at) FROM debt_clearances dc WHERE dc.contact_id = ${contactIdExpr}), '')`
}

export interface ContactListItem {
  id: number
  syncId: string | null
  name: string
  phone: string | null
  email: string | null
  address: string | null
  type: string
  balance: number
  loyaltyPointsBalance: number
  /** Set once the customer taps the bot's deep link — learnt by whichever
   *  device polls Telegram and synced to every other device (including this
   *  one) from there; mobile never does the polling/linking itself. */
  telegramChatId: string | null
}

function mapContact(row: Record<string, any>): ContactListItem {
  return {
    id: row.id,
    syncId: row.sync_id ?? null,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    type: row.type,
    balance: Number(row.balance) || 0,
    loyaltyPointsBalance: Number(row.loyalty_points_balance) || 0,
    telegramChatId: row.telegram_chat_id ?? null,
  }
}

export interface EnqueueFn {
  (table: string, syncId: string, op: 'upsert' | 'delete'): void
}

export function createContactRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    search(term: string, limit = 30): ContactListItem[] {
      const like = `%${term}%`
      return db
        .all<Record<string, any>>(
          `SELECT * FROM contacts WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?)
           ORDER BY name LIMIT ?`,
          [like, like, limit]
        )
        .map(mapContact)
    },

    byId(id: number): ContactListItem | null {
      const row = db.get<Record<string, any>>(`SELECT * FROM contacts WHERE id=?`, [id])
      return row ? mapContact(row) : null
    },

    create(input: { name: string; phone?: string | null; email?: string | null; address?: string | null; type?: string }): ContactListItem {
      const syncId = uuid()
      const now = new Date().toISOString()
      db.transaction(() => {
        db.run(
          `INSERT INTO contacts (sync_id, name, phone, email, address, type, balance, loyalty_points_balance, created_at, updated_at)
           VALUES (?,?,?,?,?,?,0,0,?,?)`,
          [syncId, input.name, input.phone ?? null, input.email ?? null, input.address ?? null, input.type ?? 'customer', now, now]
        )
        enqueue('contacts', syncId, 'upsert')
      })
      return this.bySyncId(syncId)!
    },

    update(id: number, patch: { name?: string; phone?: string | null; email?: string | null; address?: string | null }): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        const existing = db.get<Record<string, any>>(`SELECT * FROM contacts WHERE id=?`, [id])
        if (!existing) throw new Error(`Contact ${id} not found`)
        db.run(
          `UPDATE contacts SET name=?, phone=?, email=?, address=?, updated_at=? WHERE id=?`,
          [
            patch.name ?? existing.name,
            patch.phone !== undefined ? patch.phone : existing.phone,
            patch.email !== undefined ? patch.email : existing.email,
            patch.address !== undefined ? patch.address : existing.address,
            now, id,
          ]
        )
        if (existing.sync_id) enqueue('contacts', existing.sync_id, 'upsert')
      })
    },

    bySyncId(syncId: string): ContactListItem | null {
      const row = db.get<Record<string, any>>(`SELECT * FROM contacts WHERE sync_id=?`, [syncId])
      return row ? mapContact(row) : null
    },

    /** Device-local audit trail for a sent/failed notification — message_log
     *  isn't synced (desktop's own copy stays desktop-only too), so this is
     *  just this device's own record of what it sent. */
    logMessage(contactId: number, channel: string, body: string, status: 'sent' | 'failed', error?: string | null): void {
      db.run(
        `INSERT INTO message_log (contact_id, channel, body, status, error, trigger, created_at) VALUES (?,?,?,?,?, 'manual', ?)`,
        [contactId, channel, body, status, error ?? null, new Date().toISOString()]
      )
    },

    /** Debt repayments against this contact, newest first — mirrors desktop's
     *  REPAYMENT_FOR_CONTACT (client/src/lib/debt.ts): desktop records them
     *  as 'debt_payment', ones pulled from other devices arrive as 'deposit'
     *  (the server's name for a cash-in against a customer); the reference_id
     *  branch catches old desktop rows written before contact_id existed. */
    repayments(contactId: number, limit = 10): Array<{ amount: number; createdAt: string }> {
      return db
        .all<{ amount: number; created_at: string }>(
          `SELECT amount, created_at FROM cash_logs
           WHERE transaction_type = 'cash_in' AND source IN ('debt_payment', 'deposit')
             AND (contact_id = ? OR (contact_id IS NULL AND source = 'debt_payment' AND reference_id = ?))
           ORDER BY created_at DESC LIMIT ?`,
          [contactId, contactId, limit]
        )
        .map((r) => ({ amount: Number(r.amount) || 0, createdAt: r.created_at }))
    },

    /**
     * The debtor's statement since their last cleared debt: what they took
     * on credit, and every repayment since — mirrors desktop's
     * DebtHistoryDrawer.tsx loadRecords exactly (same lastClearedSql cutoff,
     * distinct from repayments() above, which is lifetime history for the
     * Telegram message and must NOT have this cutoff).
     */
    debtStatement(contactId: number): {
      debts: Array<{ label: string; date: string; amount: number }>
      payments: Array<{ date: string; amount: number }>
    } {
      const since = lastClearedSql('?')
      const debts = db
        .all<{ label: string; date: string; amount: number }>(
          `SELECT s.invoice_number as label, s.created_at as date, SUM(pt.amount) as amount
           FROM sales s
           JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
           WHERE s.contact_id = ? AND s.status != 'cancelled' AND s.created_at > ${since}
           GROUP BY s.id
           ORDER BY s.created_at`,
          [contactId, contactId]
        )
        .map((r) => ({ label: r.label, date: r.date, amount: Number(r.amount) || 0 }))
      const payments = db
        .all<{ date: string; amount: number }>(
          `SELECT created_at as date, amount FROM cash_logs
           WHERE (transaction_type = 'cash_in' AND source IN ('debt_payment', 'deposit')
             AND (contact_id = ? OR (contact_id IS NULL AND source = 'debt_payment' AND reference_id = ?)))
             AND created_at > ${since}
           ORDER BY created_at`,
          [contactId, contactId, contactId]
        )
        .map((r) => ({ date: r.date, amount: Number(r.amount) || 0 }))
      return { debts, payments }
    },

    /**
     * Records a repayment: `amt` (never more than the balance) comes off
     * the debt; anything handed over beyond that is change, given back from
     * the drawer but not itself recorded as money in or out. Mirrors
     * desktop's DebtHistoryDrawer.tsx confirmPayment. No till-session
     * concept on mobile, so cash_logs.session_id stays NULL (same
     * convention as expense.repo.ts/supplier.repo.ts).
     */
    payDebt(contactId: number, received: number, method: 'Cash' | 'Card' | 'Click', opts: { storeId: number; userId: number }): { applied: number; change: number; newBalance: number } {
      const contact = db.get<{ balance: number; name: string }>(`SELECT balance, name FROM contacts WHERE id=?`, [contactId])
      if (!contact) throw new Error(`Contact ${contactId} not found`)
      const balance = Number(contact.balance) || 0
      if (method !== 'Cash' && received > balance + 0.001) {
        throw new Error(`Cannot exceed the balance of ${balance}`)
      }
      const amt = Math.min(received, balance)
      if (!(amt > 0)) throw new Error('Enter a valid amount')
      const change = received - amt
      const now = new Date().toISOString()
      const newBalance = Math.max(0, balance - amt)
      const cashLogSyncId = uuid()
      db.transaction(() => {
        db.run(`UPDATE contacts SET balance = MAX(0, balance - ?), updated_at = ? WHERE id = ?`, [amt, now, contactId])
        db.run(
          `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, payment_method, description, reference_id, contact_id, created_by, created_at, updated_at)
           VALUES (?, ?, NULL, 'cash_in', ?, 'deposit', ?, 'Debt repayment', ?, ?, ?, ?, ?)`,
          [cashLogSyncId, opts.storeId, amt, method, contactId, contactId, opts.userId, now, now]
        )
        enqueue('cash_logs', cashLogSyncId, 'upsert')
        logAudit(db, uuid, enqueue, 'debt_payment', {
          entity: 'contact', entityId: contactId, userId: opts.userId,
          details: { customer: contact.name, amount: amt, method, balanceAfter: newBalance, ...(change > 0 ? { received, change } : {}) },
        })
      })
      return { applied: amt, change, newBalance }
    },

    /**
     * Records a cut-off rather than deleting anything — sales and cash_logs
     * are financial records the server and reports depend on. Only allowed
     * once the balance is actually zero (re-checked here, not just trusted
     * from a possibly-stale caller).
     */
    clearDebt(contactId: number, totalDebt: number, totalPaid: number, userId: number): void {
      const contact = db.get<{ balance: number; name: string }>(`SELECT balance, name FROM contacts WHERE id=?`, [contactId])
      if (!contact) throw new Error(`Contact ${contactId} not found`)
      if (Number(contact.balance) > 0) throw new Error('This contact still owes money')
      const now = new Date().toISOString()
      const clearanceSyncId = uuid()
      db.transaction(() => {
        db.run(
          `INSERT INTO debt_clearances (sync_id, contact_id, cleared_at, cleared_by, total_debt, total_paid, updated_at) VALUES (?,?,?,?,?,?,?)`,
          [clearanceSyncId, contactId, now, userId, totalDebt, totalPaid, now]
        )
        enqueue('debt_clearances', clearanceSyncId, 'upsert')
        logAudit(db, uuid, enqueue, 'debt_clear', {
          entity: 'contact', entityId: contactId, userId,
          details: { customer: contact.name, totalDebt, totalPaid },
        })
      })
    },

    /**
     * Soft-deletes the contact itself — allowed even with an open balance
     * (any remaining debt is written off along with it), which is why
     * callers should gate this behind the owner PIN the same way desktop's
     * DebtHistoryDrawer does (PinConfirmModal, owner_expense_pin setting).
     */
    delete(contactId: number, userId: number): void {
      const contact = db.get<{ sync_id: string; name: string; balance: number }>(`SELECT sync_id, name, balance FROM contacts WHERE id=?`, [contactId])
      if (!contact) return
      const now = new Date().toISOString()
      db.transaction(() => {
        db.run(`UPDATE contacts SET deleted_at=?, updated_at=? WHERE id=?`, [now, now, contactId])
        if (contact.sync_id) enqueue('contacts', contact.sync_id, 'delete')
        logAudit(db, uuid, enqueue, 'contact_delete', {
          entity: 'contact', entityId: contactId, userId,
          details: { customer: contact.name, balanceWrittenOff: Number(contact.balance) || 0 },
        })
      })
    },
  }
}

export type ContactRepository = ReturnType<typeof createContactRepository>
