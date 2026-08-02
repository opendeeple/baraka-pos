import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations as runSchemaMigrations, type SchemaDb } from '@baraka/db-schema'

let db: Database.Database

/** Adapts a better-sqlite3 handle to the platform-agnostic SchemaDb surface. */
function schemaAdapter(database: Database.Database): SchemaDb {
  return {
    exec: (sql) => database.exec(sql),
    all: <T,>(sql: string) => database.prepare(sql).all() as T[],
    getUserVersion: () => (database.pragma('user_version', { simple: true }) as number) ?? 0,
    setUserVersion: (version) => {
      database.pragma(`user_version = ${version}`)
    },
    transaction: (fn) => database.transaction(fn)(),
  }
}

export async function initDatabase(training = false): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dbFile = training ? 'baraka_training.db' : 'baraka.db'
  const dbPath = join(userDataPath, dbFile)

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  console.log(`✅ SQLite initialized: ${dbPath}`)
}

export function runMigrations(database: Database.Database): void {
  runSchemaMigrations(schemaAdapter(database))
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

/** Test seam: lets harnesses run the sync engine against an injected DB. */
export function setDbInstance(instance: Database.Database): void {
  db = instance
}

export function dbQuery(sql: string, params: unknown[] = []): unknown[] {
  const stmt = getDb().prepare(sql)
  return stmt.all(...params)
}

export function dbExec(sql: string, params: unknown[] = []): void {
  const stmt = getDb().prepare(sql)
  stmt.run(...params)
}

export function dbTransaction(ops: Array<{ sql: string; params: unknown[] }>): void {
  const txn = getDb().transaction(() => {
    for (const op of ops) {
      getDb().prepare(op.sql).run(...op.params)
    }
  })
  txn()
}
