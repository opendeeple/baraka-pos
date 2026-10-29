import type { DbAdapter } from '../adapter'

export interface JournalEntry {
  id: number
  action: string
  entity: string | null
  entityId: string | null
  /** Raw JSON string, same as the DB column — the screen parses it per-action, like desktop's describe(). */
  details: string | null
  userName: string | null
  occurredAt: string
}

export type JournalGroup = 'all' | 'sales' | 'stock' | 'money' | 'products' | 'system'

// Mirrors desktop's JournalScreen.tsx GROUPS exactly, including
// 'debt_reminder' — a row only desktop's background reminder scheduler
// ever writes (not in packages/data's own AuditAction union, since mobile
// never writes one itself), but it syncs down from desktop and this screen
// still needs to group/display it. Plain strings here on purpose, not
// AuditAction — this is the READ side, which must handle anything that
// might show up in a synced row, not just what mobile itself writes.
export const JOURNAL_GROUPS: Record<Exclude<JournalGroup, 'all'>, string[]> = {
  sales: ['sale_void', 'sale_return'],
  stock: ['stock_receive', 'stock_transfer', 'stocktake', 'writeoff', 'purchase_order', 'purchase_receive'],
  money: ['expense', 'debt_payment', 'debt_clear', 'debt_reminder', 'supplier_payment', 'shift_close', 'drawer_open', 'contact_delete'],
  products: ['price_change', 'product_create', 'product_delete'],
  system: ['settings_change'],
}

/** Entries worth the owner's eye — money or goods leaving outside a normal sale. */
export const JOURNAL_ATTENTION = new Set<string>(['sale_void', 'writeoff', 'product_delete', 'debt_clear', 'price_change', 'contact_delete'])

/** The audit trail — every sensitive action, synced from every device. Mirrors desktop's JournalScreen.tsx query. */
export function createJournalRepository(db: DbAdapter) {
  return {
    list(opts: { periodDays?: number | 'all'; group?: JournalGroup; userName?: string; search?: string; limit?: number } = {}): JournalEntry[] {
      const clauses = ['1=1']
      const params: unknown[] = []
      if (opts.periodDays && opts.periodDays !== 'all') {
        const from = new Date()
        from.setHours(0, 0, 0, 0)
        from.setDate(from.getDate() - (opts.periodDays - 1))
        clauses.push('occurred_at >= ?')
        params.push(from.toISOString())
      }
      if (opts.group && opts.group !== 'all') {
        const actions = JOURNAL_GROUPS[opts.group]
        clauses.push(`action IN (${actions.map(() => '?').join(',')})`)
        params.push(...actions)
      }
      if (opts.userName) {
        clauses.push('user_name = ?')
        params.push(opts.userName)
      }
      if (opts.search?.trim()) {
        clauses.push('(details LIKE ? OR entity_id LIKE ?)')
        params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`)
      }
      return db
        .all<Record<string, any>>(
          `SELECT id, action, entity, entity_id, details, user_name, occurred_at FROM audit_logs
           WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`,
          [...params, Math.min(opts.limit ?? 500, 500)]
        )
        .map((r) => ({
          id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id,
          details: r.details, userName: r.user_name, occurredAt: r.occurred_at,
        }))
    },

    users(): string[] {
      return db
        .all<{ user_name: string }>(`SELECT DISTINCT user_name FROM audit_logs WHERE user_name IS NOT NULL ORDER BY user_name`)
        .map((r) => r.user_name)
    },
  }
}

export type JournalRepository = ReturnType<typeof createJournalRepository>
