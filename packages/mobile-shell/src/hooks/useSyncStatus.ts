import { useEffect, useState } from 'react'
import type { SyncState } from '@baraka/mobile-ui'
import { outboxCounts } from '../platform/maintenance'

export interface SyncStatus {
  state: SyncState
  pendingCount: number
}

/**
 * Polls the outbox to drive the chrome SyncStatusBadge:
 * dead rows → error, pending rows → pending, otherwise synced.
 * (True offline detection would need NetInfo; the outbox is the honest
 * proxy — offline just accumulates pending rows.)
 */
export function useSyncStatus(pollMs = 5000): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: 'synced', pendingCount: 0 })

  useEffect(() => {
    let alive = true
    const tick = () => {
      try {
        const { pending, dead } = outboxCounts()
        if (!alive) return
        setStatus({
          state: dead > 0 ? 'error' : pending > 0 ? 'pending' : 'synced',
          pendingCount: pending + dead,
        })
      } catch {
        /* DB not open yet during boot — keep last state */
      }
    }
    tick()
    const timer = setInterval(tick, pollMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [pollMs])

  return status
}
