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

function getEngine(): SyncEngine {
  if (!engine) {
    engine = createSyncEngine({ db: dbAdapter, uuid: randomUUID, log: console.log })
  }
  return engine
}

export const ensureDeviceRegistered: SyncEngine['ensureDeviceRegistered'] = (...args) =>
  getEngine().ensureDeviceRegistered(...args)
export const ensureInvoiceRange: SyncEngine['ensureInvoiceRange'] = () =>
  getEngine().ensureInvoiceRange()
export const nextInvoiceNumber: SyncEngine['nextInvoiceNumber'] = () =>
  getEngine().nextInvoiceNumber()
export const isDeviceRegistered: SyncEngine['isDeviceRegistered'] = () =>
  getEngine().isDeviceRegistered()
export const pullTableV2: SyncEngine['pullTableV2'] = (...args) => getEngine().pullTableV2(...args)
export const enqueueOutbox: SyncEngine['enqueueOutbox'] = (...args) =>
  getEngine().enqueueOutbox(...args)
export const flushOutbox: SyncEngine['flushOutbox'] = () => getEngine().flushOutbox()
export const retryDeadLetters: SyncEngine['retryDeadLetters'] = () =>
  getEngine().retryDeadLetters()
export const backfillOutboxOnce: SyncEngine['backfillOutboxOnce'] = () =>
  getEngine().backfillOutboxOnce()
export const getSyncStatus: SyncEngine['getSyncStatus'] = () => getEngine().getSyncStatus()
