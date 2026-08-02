import type { DbAdapter } from '../adapter'

export function createSettingsRepository(db: DbAdapter) {
  return {
    get(key: string, fallback = ''): string {
      const row = db.get<{ meta_value: string }>(
        `SELECT meta_value FROM settings WHERE meta_key=? LIMIT 1`, [key]
      )
      return row?.meta_value ?? fallback
    },

    getJson<T>(key: string): T | null {
      const raw = this.get(key)
      if (!raw) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    set(key: string, value: string): void {
      db.run(
        `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (?, ?, ?, ?)`,
        [Number(this.get('store_id', '1')), key, value, new Date().toISOString()]
      )
    },

    setJson(key: string, value: unknown): void {
      this.set(key, JSON.stringify(value))
    },
  }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>
