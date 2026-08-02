import { useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useSyncStore } from '../store/sync.store'
import { useAuthStore } from '../store/auth.store'

// Pull order matters: FK targets before their referrers (products need
// collections, batches need products, stocks need batches).
const SYNC_TABLES = [
  'stores',
  'collections',
  'contacts',
  'products',
  'product_batches',
  'product_stocks',
  'charges',
  'settings',
  'users',
] as const

export function useSync() {
  const { setStatus, setPendingCount, setLastSync } = useSyncStore()
  const { isAuthenticated } = useAuthStore()

  const pullAll = useCallback(async () => {
    if (!isAuthenticated) return
    setStatus('syncing')
    try {
      for (const table of SYNC_TABLES) {
        await window.electronAPI.sync.pullLatest(table)
      }
      setLastSync(new Date().toISOString())
      setStatus('online')
    } catch (err: unknown) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : 'Sync failed'
      toast.error(`Sync error: ${msg}`, { id: 'sync-error', duration: 6000 })
    }
  }, [isAuthenticated, setStatus, setLastSync])

  const pushPending = useCallback(async () => {
    try {
      const result = await window.electronAPI.sync.pushPending()
      setPendingCount(0)
      return result
    } catch (err: unknown) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : 'Push failed'
      toast.error(`Sync push failed: ${msg}`, { id: 'sync-push-error', duration: 6000 })
      return { synced: 0, errors: 0 }
    }
  }, [setPendingCount, setStatus])

  const checkPendingCount = useCallback(async () => {
    const rows = await window.electronAPI.db.query(
      `SELECT COUNT(*) as cnt FROM sync_queue_local WHERE status='pending'`,
      []
    ) as Array<{ cnt: number }>
    setPendingCount(rows[0]?.cnt ?? 0)
  }, [setPendingCount])

  useEffect(() => {
    if (!isAuthenticated) return
    pullAll()
    checkPendingCount()

    const pullInterval = setInterval(pullAll, 5 * 60 * 1000)
    const pendingInterval = setInterval(checkPendingCount, 30_000)
    // v2 outbox: retry-with-backoff lives in the main process; this just makes
    // sure a flush is attempted regularly (v1 only pushed right after a sale).
    const pushInterval = setInterval(() => { pushPending().catch(() => {}) }, 60_000)

    const handleOnline = () => { setStatus('online'); pullAll() }
    const handleOffline = () => {
      setStatus('offline')
      toast.warning('Server connection lost — working offline', { id: 'offline', duration: 0 })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearInterval(pullInterval)
      clearInterval(pendingInterval)
      clearInterval(pushInterval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [isAuthenticated])

  return { pullAll, pushPending, checkPendingCount }
}
