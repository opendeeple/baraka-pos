// Thin Electron adapter over the shared sync engine (@baraka/sync-engine).
// The engine is platform-agnostic; this file wires better-sqlite3 and Node's
// crypto/fetch into it and re-exports the same API the IPC layer uses.
import { randomUUID } from 'crypto';
import { createSyncEngine, PULL_TABLE_ORDER } from '@baraka/sync-engine';
import { getDb } from './db.service';
export { PULL_TABLE_ORDER };
const dbAdapter = {
    all: (sql, params = []) => getDb().prepare(sql).all(...params),
    get: (sql, params = []) => getDb().prepare(sql).get(...params),
    run: (sql, params = []) => {
        const result = getDb().prepare(sql).run(...params);
        return { changes: result.changes };
    },
    transaction: (fn) => getDb().transaction(fn)(),
};
let engine = null;
function getEngine() {
    if (!engine) {
        engine = createSyncEngine({ db: dbAdapter, uuid: randomUUID, log: console.log });
    }
    return engine;
}
export const ensureDeviceRegistered = (...args) => getEngine().ensureDeviceRegistered(...args);
export const ensureInvoiceRange = () => getEngine().ensureInvoiceRange();
export const nextInvoiceNumber = () => getEngine().nextInvoiceNumber();
export const isDeviceRegistered = () => getEngine().isDeviceRegistered();
export const pullTableV2 = (...args) => getEngine().pullTableV2(...args);
export const enqueueOutbox = (...args) => getEngine().enqueueOutbox(...args);
export const flushOutbox = () => getEngine().flushOutbox();
export const retryDeadLetters = () => getEngine().retryDeadLetters();
export const backfillOutboxOnce = () => getEngine().backfillOutboxOnce();
export const getSyncStatus = () => getEngine().getSyncStatus();
