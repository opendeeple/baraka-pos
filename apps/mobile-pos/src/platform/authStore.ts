import { create } from 'zustand'
import type { AuthUser } from '@baraka/shared'
import type { LocalSession } from '@baraka/data'

export interface StoreInfo {
  id: number
  name: string
  address?: string | null
  phone?: string | null
  salePrefix: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  store: StoreInfo | null
  session: LocalSession | null
  isAuthenticated: boolean
  setAuth: (user: AuthUser, token: string | null, store: StoreInfo) => void
  setSession: (session: LocalSession | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  store: null,
  session: null,
  isAuthenticated: false,
  setAuth: (user, token, store) => set({ user, token, store, isAuthenticated: true }),
  setSession: (session) => set({ session }),
  logout: () => set({ user: null, token: null, store: null, session: null, isAuthenticated: false }),
}))
