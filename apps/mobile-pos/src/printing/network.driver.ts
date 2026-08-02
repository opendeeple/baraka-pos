import TcpSocket from 'react-native-tcp-socket'
import { Buffer } from 'buffer'
import type { PrinterDriver, PrinterConfig } from './PrinterDriver'
import { encodeEscPos } from './PrinterDriver'
import type { ReceiptDoc } from '@baraka/app-core'

const CONNECT_TIMEOUT_MS = 5000

function send(config: PrinterConfig, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!config.address) return reject(new Error('Printer IP not configured'))
    const socket = TcpSocket.createConnection(
      { host: config.address, port: config.port ?? 9100 },
      () => {
        socket.write(Buffer.from(bytes), undefined, (err?: Error) => {
          socket.destroy()
          err ? reject(err) : resolve()
        })
      }
    )
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Printer at ${config.address} not reachable`))
    }, CONNECT_TIMEOUT_MS)
    socket.on('error', (err) => {
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    })
    socket.on('connect', () => clearTimeout(timer))
  })
}

export const networkDriver: PrinterDriver = {
  async print(doc: ReceiptDoc, config: PrinterConfig): Promise<void> {
    await send(config, encodeEscPos(doc, config.width ?? 32))
  },

  probe(config: PrinterConfig): Promise<boolean> {
    return new Promise((resolve) => {
      if (!config.address) return resolve(false)
      const socket = TcpSocket.createConnection(
        { host: config.address, port: config.port ?? 9100 },
        () => {
          socket.destroy()
          resolve(true)
        }
      )
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, CONNECT_TIMEOUT_MS)
      socket.on('error', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(false)
      })
    })
  },
}
