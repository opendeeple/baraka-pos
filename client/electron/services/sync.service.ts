// Thin Electron adapter over the shared sync engine (@baraka/sync-engine).
// The engine is platform-agnostic; this file wires better-sqlite3 and Node's
// crypto/fetch into it and re-exports the same API the IPC layer uses.
import { randomUUID } from 'crypto'
import { createSyncEngine, PULL_TABLE_ORDER, type SyncDb, type SyncEngine } from '@baraka/sync-engine'
import { getDb } from './db.service'

export { PULL_TABLE_ORDER }

const dbAdapter: SyncDb = {
  all: (sql, params = []) => getDb().prepare(sql).all(...(params as unknown[])) as never,
  get: (sql, params = []) => getDb().prepare(sql).get(...(params as unknown[])) as never,
  run: (sql, params = []) => {
    const result = getDb().prepare(sql).run(...(params as unknown[]))
    return { changes: result.changes }
  },
  transaction: (fn) => getDb().transaction(fn)(),
}

let engine: SyncEngine | null = null
// POS and Office share one database but each syncs with its own signed-in
// user's token, so a cashier signing in at the till never replaces the
// manager token the back office needs.
let tokenKey = 'terminal_token'

/** Must run before the first sync call. */
export function setSyncApp(app: 'pos' | 'office'): void {
  tokenKey = app === 'office' ? 'office_token' : 'terminal_token'
}

function getEngine(): SyncEngine {
  if (!engine) {
    engine = createSyncEngine({ db: dbAdapter, uuid: randomUUID, log: console.log, tokenKey })
  }
  return engine
}

export const getServerUrl: SyncEngine['getServerUrl'] = () => getEngine().getServerUrl()
export const setTerminalToken: SyncEngine['setTerminalToken'] = (...args) =>
  getEngine().setTerminalToken(...args)
export const ensureInvoiceRange: SyncEngine['ensureInvoiceRange'] = () =>
  getEngine().ensureInvoiceRange()
export const nextInvoiceNumber: SyncEngine['nextInvoiceNumber'] = () =>
  getEngine().nextInvoiceNumber()
export const hasTerminalToken: SyncEngine['hasTerminalToken'] = () =>
  getEngine().hasTerminalToken()
export const pullTableV2: SyncEngine['pullTableV2'] = (...args) => getEngine().pullTableV2(...args)
export const enqueueOutbox: SyncEngine['enqueueOutbox'] = (...args) =>
  getEngine().enqueueOutbox(...args)
// The background loop below, the renderer's own interval and every "push now
// after saving" call land here; one flush at a time, later callers share it.
let flushInFlight: ReturnType<SyncEngine['flushOutbox']> | null = null
export const flushOutbox: SyncEngine['flushOutbox'] = () => {
  if (!flushInFlight) flushInFlight = getEngine().flushOutbox().finally(() => { flushInFlight = null })
  return flushInFlight
}

const OUTBOX_FLUSH_MS = 60_000

/**
 * Pushes the outbox from the main process every minute for as long as the
 * app runs. The renderer only flushed while certain screens were mounted
 * (the POS app: only the selling screen), so anything recorded offline sat
 * unsent while the till was on the login or open/close-register screens.
 */
export function startOutboxLoop(): void {
  const requeued = getEngine().requeueOnStartup()
  if (requeued) console.log(`[syncV2] retrying ${requeued} unsent outbox row(s) from before this start`)
  const tick = () => { flushOutbox().catch((err) => console.warn('[syncV2] background flush failed:', err)) }
  setTimeout(tick, 5_000)
  setInterval(tick, OUTBOX_FLUSH_MS)
}
export const retryDeadLetters: SyncEngine['retryDeadLetters'] = () =>
  getEngine().retryDeadLetters()
export const backfillOutboxOnce: SyncEngine['backfillOutboxOnce'] = () =>
  getEngine().backfillOutboxOnce()
export const getSyncStatus: SyncEngine['getSyncStatus'] = () => getEngine().getSyncStatus()
