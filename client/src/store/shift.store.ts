import { create } from 'zustand'
import { useAuthStore } from './auth.store'

/** The badge-scan shift running on this terminal (POS only). */
export interface ActiveShift {
  id: number
  startedAt: string
}

interface ShiftStore {
  shift: ActiveShift | null
  /** The last heartbeat couldn't reach the server — the shift carries on offline. */
  offline: boolean
  setShift: (shift: ActiveShift | null) => void
  setOffline: (offline: boolean) => void
}

export const useShiftStore = create<ShiftStore>((set) => ({
  shift: null,
  offline: false,
  setShift: (shift) => set({ shift, offline: false }),
  setOffline: (offline) => set({ offline }),
}))

// Persisted in local settings so an app restart mid-shift resumes it (after a
// heartbeat confirms the server still has it open) instead of losing it.
const ACTIVE_SHIFT_KEY = 'active_shift'

export async function loadActiveShift(): Promise<ActiveShift | null> {
  const rows = await window.electronAPI.db.query<{ meta_value: string }>(
    `SELECT meta_value FROM settings WHERE meta_key=? LIMIT 1`, [ACTIVE_SHIFT_KEY]
  )
  try { return rows[0] ? JSON.parse(rows[0].meta_value) as ActiveShift : null } catch { return null }
}

export async function saveActiveShift(shift: ActiveShift): Promise<void> {
  await window.electronAPI.db.exec(
    `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at)
     VALUES ((SELECT COALESCE(MAX(store_id),1) FROM settings), ?, ?, ?)`,
    [ACTIVE_SHIFT_KEY, JSON.stringify(shift), new Date().toISOString()]
  )
  useShiftStore.getState().setShift(shift)
}

export async function clearActiveShift(): Promise<void> {
  await window.electronAPI.db.exec(`DELETE FROM settings WHERE meta_key=?`, [ACTIVE_SHIFT_KEY])
  useShiftStore.getState().setShift(null)
}

/**
 * Ends this terminal's shift and signs out. Works offline too: the main
 * process queues the end with the time of the press and delivers it once the
 * server is reachable.
 */
export async function endShiftAndSignOut(): Promise<void> {
  const { shift } = useShiftStore.getState()
  if (shift) await window.electronAPI.shift.end(shift.id).catch(() => {})
  await clearActiveShift()
  useAuthStore.getState().logout()
}
