import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { getServices } from './services'
import { useAuthStore } from './authStore'

/**
 * Real-time nudge for the register/office screens: without this, a change
 * pushed from another device (desktop Office, another phone) only reached
 * this one on its next periodic pull or screen remount — mobile had no
 * equivalent of desktop's client/src/hooks/useWebSocket.ts sync:changed
 * handler, which is what makes e.g. a price edited in Office show up on the
 * till without a manual refresh. Trimmed to just that one event; mobile
 * doesn't need the POS-only stock:updated/sale:completed cart side effects.
 */
export function useSyncSocket(onChanged?: (tables: string[]) => void): void {
  const store = useAuthStore((s) => s.store)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    if (!store) return
    const { engine, repos } = getServices()
    const token = engine.getTerminalToken()
    if (!token) return

    const socket: Socket = io(engine.getServerUrl(), {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 2000,
    })

    socket.on('connect', () => {
      socket.emit('terminal:register', {
        storeId: store.id,
        terminalId: repos.settings.get('terminal_id') || 'mobile',
      })
    })

    // Best-effort notification channel, same spirit as desktop's
    // useWebSocket — a dropped/reconnecting socket must never be read as
    // "sync is broken". The periodic pulls (RegisterScreen's interval,
    // Settings' Sync Now) are the real source of truth and keep data fresh
    // regardless of this socket's state; Socket.IO reconnects on its own.
    socket.on('sync:changed', async (data: { tables: string[] }) => {
      const wanted = PULL_TABLE_ORDER.filter((t) => data.tables.includes(t))
      if (!wanted.length) return
      try {
        for (const table of wanted) await engine.pullTableV2(table)
        onChangedRef.current?.(data.tables)
      } catch {
        // Periodic pull retries regardless; nothing to surface for a nudge.
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [store?.id])
}
