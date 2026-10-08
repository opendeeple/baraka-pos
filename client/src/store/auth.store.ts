import { create } from 'zustand'
import { AuthUser } from '@baraka/shared'

type Store = { id: number; name: string; address?: string; phone?: string; salePrefix: string }

interface AuthStore {
  user: AuthUser | null
  token: string | null
  store: Store | null
  isAuthenticated: boolean
  setAuth: (user: AuthUser, token: string, store: Store | null) => void
  /** Merges a partial store update into state — e.g. after Settings saves a
   *  new name/address/phone, or after a sync pull brings one in from another
   *  device, so every screen reading store.name (TopBar, BackOfficeLayout's
   *  sidebar, receipts) reflects it immediately instead of only after the
   *  next login/restore. */
  updateStore: (patch: Partial<Store>) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  store: null,
  isAuthenticated: false,
  setAuth: (user, token, store) => set({ user, token, store, isAuthenticated: true }),
  updateStore: (patch) => set((s) => (s.store ? { store: { ...s.store, ...patch } } : s)),
  logout: () => {
    window.electronAPI.auth.clearToken()
    set({ user: null, token: null, store: null, isAuthenticated: false })
  },
}))
