import { create } from 'zustand'
import { SyncStatus } from '@baraka/shared'

interface SyncStore {
  status: SyncStatus
  pendingCount: number
  lastSyncAt: string | null
  setStatus: (status: SyncStatus) => void
  setPendingCount: (count: number) => void
  setLastSync: (ts: string) => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'online',
  pendingCount: 0,
  lastSyncAt: null,
  setStatus: (status) => set({ status }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setLastSync: (ts) => set({ lastSyncAt: ts }),
}))
