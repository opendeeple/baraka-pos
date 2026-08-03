// expo-sqlite (sync API) adapters for the shared packages.
import * as SQLite from 'expo-sqlite'
import type { SchemaDb } from '@baraka/db-schema'
import type { DbAdapter } from '@baraka/data'
import { runMigrations } from '@baraka/db-schema'

let db: SQLite.SQLiteDatabase | null = null

export function openDatabase(): SQLite.SQLiteDatabase {
  if (db) return db
  db = SQLite.openDatabaseSync('baraka.db')
  db.execSync('PRAGMA journal_mode = WAL')
  db.execSync('PRAGMA foreign_keys = ON')
  runMigrations(schemaAdapter(db))
  return db
}

function schemaAdapter(database: SQLite.SQLiteDatabase): SchemaDb {
  return {
    exec: (sql) => database.execSync(sql),
    all: <T,>(sql: string) => database.getAllSync<T>(sql),
    getUserVersion: () =>
      (database.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0),
    setUserVersion: (version) => database.execSync(`PRAGMA user_version = ${version}`),
    transaction: (fn) => database.withTransactionSync(fn),
  }
}

/** DbAdapter for repositories + sync engine (structurally identical shapes). */
export function createDbAdapter(): DbAdapter {
  const database = openDatabase()
  return {
    all: <T,>(sql: string, params: unknown[] = []) =>
      database.getAllSync<T>(sql, params as SQLite.SQLiteBindParams),
    get: <T,>(sql: string, params: unknown[] = []) =>
      (database.getFirstSync<T>(sql, params as SQLite.SQLiteBindParams) ?? undefined) as T | undefined,
    run: (sql: string, params: unknown[] = []) => {
      const result = database.runSync(sql, params as SQLite.SQLiteBindParams)
      return { changes: result.changes }
    },
    transaction: (fn: () => void) => database.withTransactionSync(fn),
  }
}
