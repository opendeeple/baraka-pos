import { v4 as uuidv4 } from 'uuid'
import { useAuthStore } from '../store/auth.store'

// The audit trail: every action that moves money or stock outside a normal
// sale, or changes what things cost, leaves a row saying who did it, when,
// and why. Written locally first and synced insert-only (audit_logs), so the
// owner sees the same journal on every device (Back office > Jurnal).

export type AuditAction =
  | 'sale_void' | 'sale_return'
  | 'stock_receive' | 'stock_transfer' | 'stocktake' | 'writeoff'
  | 'purchase_order' | 'purchase_receive' | 'supplier_payment'
  | 'price_change' | 'product_create' | 'product_delete'
  | 'expense' | 'debt_payment' | 'debt_clear'
  | 'shift_close' | 'settings_change' | 'drawer_open'

export async function logAudit(
  action: AuditAction,
  opts: { entity?: string; entityId?: string | number | null; details?: Record<string, unknown> } = {}
): Promise<void> {
  const { user } = useAuthStore.getState()
  const syncId = uuidv4()
  const now = new Date().toISOString()
  try {
    await window.electronAPI.db.exec(
      `INSERT INTO audit_logs (sync_id, action, entity, entity_id, details, user_id, user_name, occurred_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [syncId, action, opts.entity ?? null, opts.entityId == null ? null : String(opts.entityId),
       opts.details ? JSON.stringify(opts.details) : null, user?.id ?? null, user?.name ?? null, now, now]
    )
    await window.electronAPI.sync.enqueue('audit_logs', syncId, 'upsert')
  } catch (e) {
    // The journal must never block the action it records.
    console.error('audit log failed', e)
  }
}
