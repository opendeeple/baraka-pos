import type { DbAdapter } from '../adapter'

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
  }
}

export type ContactRepository = ReturnType<typeof createContactRepository>
