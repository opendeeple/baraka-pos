import { useEffect, useRef, type MutableRefObject } from 'react'
import { io, Socket } from 'socket.io-client'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { useAuthStore } from '../store/auth.store'

// Fixed server (dev override: VITE_SERVER_URL). Matches the login screen.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

type StockUpdatePayload = { productId: number; batchId: number; newQty: number }
type SaleCompletedPayload = { saleId: number; invoiceNumber: string; total: number }

type WebSocketOpts = {
  onStockUpdated?: (data: StockUpdatePayload) => void
  onSaleCompleted?: (data: SaleCompletedPayload) => void
  onProductUpdated?: () => void
  onSessionChanged?: () => void
  // Fires whenever ANY device (including this one) pushes a successful
  // change — the server's generic push handler broadcasts this for every
  // table, not just products/stock. This is what makes e.g. a product added
  // in Office show up in POS without a manual refresh or waiting for the
  // 5-minute poll.
  onSyncChanged?: (tables: string[]) => void
}

export function useWebSocket(opts: WebSocketOpts = {}): MutableRefObject<Socket | null> {
  const { token, store } = useAuthStore()
  const socketRef = useRef<Socket | null>(null)
  // Always holds the latest callbacks without triggering socket reconnects
  const optsRef = useRef<WebSocketOpts>(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!token || !store) return

    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('terminal:register', {
        storeId: store.id,
        terminalId: navigator.userAgent,
      })
    })

    // Deliberately not touching sync.store's status here. This socket is a
    // best-effort real-time notification channel, not the source of truth for
    // "is data syncing" — useSync.ts's pull/push already owns that, driven by
    // actual REST round trips with its own retry/backoff. This connection
    // drops and reconnects on its own on some networks (idle timeouts, WS-only
    // transport with no polling fallback) far more often than real data-sync
    // failures happen; wiring connect/disconnect/connect_error into the same
    // shared status caused the badge to flip Online→Xato→Online repeatedly
    // even while every actual sync was succeeding. Socket.IO reconnects by
    // itself (reconnectionDelay below), and the periodic/on-demand REST pulls
    // keep data fresh regardless of this socket's state.

    socket.on('stock:updated', (data: StockUpdatePayload) => optsRef.current.onStockUpdated?.(data))
    socket.on('sale:completed', (data: SaleCompletedPayload) => optsRef.current.onSaleCompleted?.(data))
    socket.on('product:updated', () => optsRef.current.onProductUpdated?.())
    socket.on('product:deleted', () => optsRef.current.onProductUpdated?.())
    socket.on('session:opened', () => optsRef.current.onSessionChanged?.())
    socket.on('session:closed', () => optsRef.current.onSessionChanged?.())
    socket.on('sync:changed', (data: { tables: string[] }) => optsRef.current.onSyncChanged?.(data.tables))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [token, store?.id])

  return socketRef
}
