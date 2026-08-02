import { Server as HttpServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import jwt from 'jsonwebtoken'
import { env } from './config/env'
import { AuthPayload } from './middleware/auth.middleware'

let io: SocketServer

export function initSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, methods: ['GET', 'POST'] },
  })

  // Require the same JWT used for REST calls — without this, any socket
  // client could join any store's broadcast room by just claiming a storeId.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Unauthorized'))
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload
      socket.data.storeId = payload.storeId
      socket.data.userId = payload.userId
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('terminal:register', ({ terminalId, sessionId }) => {
      const storeId = socket.data.storeId
      socket.join(`store:${storeId}`)
      socket.data.terminalId = terminalId
      console.log(`Terminal ${terminalId} connected to store ${storeId}`)

      // Acknowledge registration
      socket.emit('terminal:registered', { terminalId, storeId, sessionId })
    })

    socket.on('disconnect', () => {
      console.log(`Terminal ${socket.data.terminalId} disconnected`)
    })
  })

  return io
}

export function broadcastToStore(storeId: number, event: string, data: unknown) {
  if (!io) return
  io.to(`store:${storeId}`).emit(event, data)
}

export function broadcastSaleCompleted(
  storeId: number,
  payload: {
    saleId: number
    invoiceNumber: string
    terminalId: string
    total: number
    paymentMethod: string
  }
) {
  broadcastToStore(storeId, 'sale:completed', payload)
}

export function broadcastStockUpdated(
  storeId: number,
  payload: { productId: number; batchId: number; newQty: number }
) {
  broadcastToStore(storeId, 'stock:updated', { ...payload, storeId })
}
