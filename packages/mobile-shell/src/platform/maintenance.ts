// Outbox introspection for the Settings screen and sync-status badge.
// Screens must never embed raw SQL — this is the one sanctioned home for it.
import { createDbAdapter } from './database'
import type { DbAdapter } from '@baraka/data'

let db: DbAdapter | null = null

function adapter(): DbAdapter {
  if (!db) db = createDbAdapter()
  return db
}

export interface OutboxCounts {
  pending: number
  dead: number
}

export function outboxCounts(): OutboxCounts {
  const count = (status: string): number =>
    adapter().get<{ c: number }>(`SELECT COUNT(*) c FROM sync_queue_local WHERE status=?`, [status])?.c ?? 0
  return { pending: count('pending'), dead: count('dead') }
}
