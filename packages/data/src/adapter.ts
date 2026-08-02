// Canonical synchronous DB surface for all BarakaPOS clients. Structurally
// identical to @baraka/sync-engine's SyncDb, so one adapter instance serves
// both the repositories and the sync engine.
export interface DbAdapter {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined
  run(sql: string, params?: unknown[]): { changes: number }
  transaction(fn: () => void): void
}
