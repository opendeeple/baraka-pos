import { useEffect, useRef, type MutableRefObject } from 'react'
import { io, Socket } from 'socket.io-client'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { useAuthStore } from '../store/auth.store'
import { useSyncStore } from '../store/sync.store'

// Fixed server (dev override: VITE_SERVER_URL). Matches the login screen.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

type StockUpdatePayload = { productId: number; batchId: number; newQty: number }
type SaleCompletedPayload = { saleId: number; invoiceNumber: string; total: number }

type WebSocketOpts = {
  onStockUpdated?: (data: StockUpdatePayload) => void
  onSaleCompleted?: (data: SaleCompletedPayload) => void
  onProductUpdated?: () => void
  onSessionChanged?: () => void
}

export function useWebSocket(opts: WebSocketOpts = {}): MutableRefObject<Socket | null> {
  const { token, store } = useAuthStore()
  const { setStatus } = useSyncStore()
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
      setStatus('online')
      socket.emit('terminal:register', {
        storeId: store.id,
        terminalId: navigator.userAgent,
      })
    })

    socket.on('disconnect', () => setStatus('offline'))
    socket.on('connect_error', () => setStatus('error'))

    socket.on('stock:updated', (data: StockUpdatePayload) => optsRef.current.onStockUpdated?.(data))
    socket.on('sale:completed', (data: SaleCompletedPayload) => optsRef.current.onSaleCompleted?.(data))
    socket.on('product:updated', () => optsRef.current.onProductUpdated?.())
    socket.on('product:deleted', () => optsRef.current.onProductUpdated?.())
    socket.on('session:opened', () => optsRef.current.onSessionChanged?.())
    socket.on('session:closed', () => optsRef.current.onSessionChanged?.())

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [token, store?.id])

  return socketRef
}
