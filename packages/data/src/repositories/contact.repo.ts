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
  }
}

export type ContactRepository = ReturnType<typeof createContactRepository>
