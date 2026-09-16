import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { runMigrations as runSchemaMigrations } from '@baraka/db-schema';
let db;
/** Adapts a better-sqlite3 handle to the platform-agnostic SchemaDb surface. */
function schemaAdapter(database) {
    return {
        exec: (sql) => database.exec(sql),
        all: (sql) => database.prepare(sql).all(),
        getUserVersion: () => database.pragma('user_version', { simple: true }) ?? 0,
        setUserVersion: (version) => {
            database.pragma(`user_version = ${version}`);
        },
        transaction: (fn) => database.transaction(fn)(),
    };
}
export async function initDatabase(training = false) {
    const userDataPath = app.getPath('userData');
    const dbFile = training ? 'baraka_training.db' : 'baraka.db';
    const dbPath = join(userDataPath, dbFile);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    console.log(`✅ SQLite initialized: ${dbPath}`);
}
export function runMigrations(database) {
    runSchemaMigrations(schemaAdapter(database));
}
export function getDb() {
    if (!db)
        throw new Error('Database not initialized');
    return db;
}
/** Test seam: lets harnesses run the sync engine against an injected DB. */
export function setDbInstance(instance) {
    db = instance;
}
export function dbQuery(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.all(...params);
}
export function dbExec(sql, params = []) {
    const stmt = getDb().prepare(sql);
    stmt.run(...params);
}
export function dbTransaction(ops) {
    const txn = getDb().transaction(() => {
        for (const op of ops) {
            getDb().prepare(op.sql).run(...op.params);
        }
    });
    txn();
}
