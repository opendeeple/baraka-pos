import { create } from 'zustand'
import { SyncStatus } from '@baraka/shared'

interface SyncStore {
  status: SyncStatus
  pendingCount: number
  lastSyncAt: string | null
  /** The message behind the last 'error' status — null once a sync succeeds again. */
  lastError: string | null
  setStatus: (status: SyncStatus) => void
  setPendingCount: (count: number) => void
  setLastSync: (ts: string) => void
  setLastError: (message: string | null) => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'online',
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
  setStatus: (status) => set({ status }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setLastSync: (ts) => set({ lastSyncAt: ts }),
  setLastError: (message) => set({ lastError: message }),
}))
