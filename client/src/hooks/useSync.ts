import { useEffect, useCallback, useRef } from 'react'
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
  const { setStatus, setPendingCount, setLastSync, setLastError } = useSyncStore()
  const { isAuthenticated } = useAuthStore()
  // pullAll is triggered from several independent places — mount, the 5-min
  // interval, the 20s error-retry chain below, the manual refresh button,
  // the browser 'online' event, and now the sync:changed websocket handler —
  // which can overlap (e.g. a websocket event landing while the periodic
  // interval is already mid-pull). Two concurrent pulls racing on the shared
  // status/error state caused the badge to get stuck on Error even though
  // data was syncing fine. A guard that just skips a second call fixes that,
  // but breaks callers that specifically need to know once fresh data has
  // landed (e.g. reloading the product list right after a sync:changed
  // event) — they'd skip out immediately and read stale local data instead
  // of waiting for the already-in-flight pull to actually finish. Sharing
  // the in-flight promise solves both: only one real pull ever runs, and
  // every caller — the one that started it and any that arrive while it's
  // running — resolves once it's actually done.
  const inFlightRef = useRef<Promise<void> | null>(null)

  const pullAll = useCallback((): Promise<void> => {
    if (!isAuthenticated) return Promise.resolve()
    if (inFlightRef.current) return inFlightRef.current

    const run = async () => {
      try {
        // Login sets isAuthenticated before device registration's network round
        // trip resolves (so login still works while offline) — a pull racing that
        // gap would hit "Device not registered" and falsely flash Error. Skip
        // quietly; the next interval retries once registration has landed.
        if (!(await window.electronAPI.sync.isDeviceRegistered())) return
        setStatus('syncing')
        for (const table of SYNC_TABLES) {
          await window.electronAPI.sync.pullLatest(table)
        }
        setLastSync(new Date().toISOString())
        setLastError(null)
        setStatus('online')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Sync failed'
        setStatus('error')
        setLastError(msg)
        toast.error(`Sync error: ${msg}`, { id: 'sync-error', duration: 6000 })
        // Most failures here are transient (a cold Render free-tier instance,
        // a brief network blip) — retry soon instead of leaving the badge
        // stuck on Error for up to the full 5-minute interval.
        setTimeout(() => { pullAll() }, 20_000)
      } finally {
        inFlightRef.current = null
      }
    }

    const promise = run()
    inFlightRef.current = promise
    return promise
  }, [isAuthenticated, setStatus, setLastSync, setLastError])

  const pushPending = useCallback(async () => {
    try {
      const result = await window.electronAPI.sync.pushPending()
      setPendingCount(0)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Push failed'
      setStatus('error')
      setLastError(msg)
      toast.error(`Sync push failed: ${msg}`, { id: 'sync-push-error', duration: 6000 })
      return { synced: 0, errors: 0 }
    }
  }, [setPendingCount, setStatus, setLastError])

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
