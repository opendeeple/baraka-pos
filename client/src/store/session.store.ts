import { create } from 'zustand'
import { SessionState } from '@baraka/shared'

// Raw shape returned by `SELECT * FROM pos_sessions` over IPC — snake_case
// SQLite columns, not the shared (camelCase) PosSession API type.
export interface LocalPosSession {
  id: number
  store_id: number
  terminal_id: string
  user_id: number
  state: SessionState
  opening_balance: number
  closing_balance_theoretical?: number
  closing_balance_actual?: number
  variance?: number
  opened_at: string
  closed_at?: string
  created_at: string
  updated_at: string
}

interface SessionStore {
  session: LocalPosSession | null
  state: SessionState | null
  setSession: (session: LocalPosSession | null) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  session: null,
  state: null,
  setSession: (session) => set({ session, state: session?.state ?? null }),
  clearSession: () => set({ session: null, state: null }),
}))
