import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { runMigrations as runSchemaMigrations, type SchemaDb } from '@baraka/db-schema'

let db: Database.Database
const BACKUP_RETENTION_DAYS = 14

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

  // A synced device only ever risks losing what hasn't reached the server
  // yet; the real reason for this is the other kind of loss — the live file
  // itself getting corrupted (a bad write, a crash mid-write, a failing
  // disk) with no way to tell until it's too late. Training's practice data
  // isn't worth protecting the same way, so it's skipped.
  if (!training) backupDatabaseIfDue(dbPath)

  console.log(`✅ SQLite initialized: ${dbPath}`)
}

/** YYYY-MM-DD in local time, so "today" matches what the owner would call today. */
function todayStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * One snapshot a day, kept for BACKUP_RETENTION_DAYS — enough to recover
 * from a corrupted live file without the backup folder growing forever.
 * Runs once per app startup (POS and Office both call this; the dated
 * filename makes a second call the same day a harmless no-op) rather than
 * a running timer, since the app isn't necessarily left open overnight.
 */
function backupDatabaseIfDue(dbPath: string): void {
  try {
    const backupDir = join(app.getPath('userData'), 'backups')
    const target = join(backupDir, `baraka-${todayStamp()}.db`)
    if (existsSync(target)) return
    mkdirSync(backupDir, { recursive: true })
    backupDatabaseTo(target)
    pruneOldBackups(backupDir)
  } catch (err) {
    // A failed backup is never a reason to stop the app from opening.
    console.error('[backup] daily snapshot failed:', err)
  }
}

/**
 * VACUUM INTO, not a raw file copy — the live file is open in WAL mode and
 * being written to, so copying its bytes directly can capture it
 * mid-write; VACUUM INTO is SQLite's own online-backup primitive and always
 * produces a single consistent, non-WAL file at the target path.
 */
export function backupDatabaseTo(targetPath: string): void {
  if (existsSync(targetPath)) unlinkSync(targetPath)
  getDb().exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`)
}

function pruneOldBackups(backupDir: string): void {
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const name of readdirSync(backupDir)) {
    if (!/^baraka-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue
    const path = join(backupDir, name)
    if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
  }
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
