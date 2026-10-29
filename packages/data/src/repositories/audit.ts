import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

// The audit trail: every action that moves money or stock outside a normal
// sale, or changes what things cost, leaves a row saying who did it, when,
// and why — mirrors desktop's client/src/lib/audit.ts exactly (same action
// names), so Journal reads the same feed regardless of which device wrote
// the row. Call this INSIDE the caller's own db.transaction() — it only
// does a plain insert, same as every repo method that already does this
// inline (e.g. sale.repo.ts's createReturn).
export type AuditAction =
  | 'sale_void' | 'sale_return'
  | 'stock_receive' | 'stock_transfer' | 'stocktake' | 'writeoff'
  | 'purchase_order' | 'purchase_receive' | 'supplier_payment'
  | 'price_change' | 'product_create' | 'product_delete'
  | 'expense' | 'debt_payment' | 'debt_clear' | 'contact_delete'
  | 'shift_close' | 'settings_change' | 'drawer_open' | 'discount'
  | 'cash_in' | 'cash_out'

export function logAudit(
  db: DbAdapter,
  uuid: () => string,
  enqueue: EnqueueFn,
  action: AuditAction,
  opts: {
    userId: number | null
    userName?: string | null
    entity?: string
    entityId?: string | number | null
    details?: Record<string, unknown>
  }
): void {
  const syncId = uuid()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO audit_logs (sync_id, action, entity, entity_id, details, user_id, user_name, occurred_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      syncId, action, opts.entity ?? null, opts.entityId == null ? null : String(opts.entityId),
      opts.details ? JSON.stringify(opts.details) : null, opts.userId, opts.userName ?? null, now, now,
    ]
  )
  enqueue('audit_logs', syncId, 'upsert')
}
