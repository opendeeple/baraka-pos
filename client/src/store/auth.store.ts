import { create } from 'zustand'
import { AuthUser } from '@baraka/shared'

interface AuthStore {
  user: AuthUser | null
  token: string | null
  store: { id: number; name: string; address?: string; phone?: string; salePrefix: string } | null
  isAuthenticated: boolean
  setAuth: (user: AuthUser, token: string, store: AuthStore['store']) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  store: null,
  isAuthenticated: false,
  setAuth: (user, token, store) => set({ user, token, store, isAuthenticated: true }),
  logout: () => {
    window.electronAPI.auth.clearToken()
    set({ user: null, token: null, store: null, isAuthenticated: false })
  },
}))
