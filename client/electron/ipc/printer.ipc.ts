import { ipcMain } from 'electron'
import { dbQuery } from '../services/db.service'

interface EscposPrinter {
  font: (f: string) => EscposPrinter
  align: (a: string) => EscposPrinter
  style: (s: string) => EscposPrinter
  text: (t: string) => EscposPrinter
  drawLine: () => EscposPrinter
  tableCustom: (cols: unknown[]) => EscposPrinter
  barcode: (data: string, type: string) => EscposPrinter
  cut: () => EscposPrinter
  close: () => void
  cashdraw: (pin: number) => EscposPrinter
}

interface EscposModule {
  Printer: new (device: unknown) => EscposPrinter
  USB: new (vid: string, pid: string) => unknown
  Network: new (ip: string, port: number) => unknown
}

type PrinterConfig = {
  type: 'usb' | 'network' | 'windows'
  host: string
  port: string
  vendorId: string
  productId: string
  name: string
}

function unconfiguredReason(config: PrinterConfig): string | null {
  if (config.type === 'windows') return 'Windows printer support is not implemented yet'
  if (config.type === 'usb' && (!config.vendorId || !config.productId)) return 'No printer configured'
  if (config.type === 'network' && !config.host) return 'No printer configured'
  return null
}

export function registerPrinterIpc() {
  ipcMain.handle('printer:print', async (_event, receiptData: unknown) => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      // Dynamic import to avoid build issues when native modules not present
      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule

      const device =
        config.type === 'usb'
          ? new USB(config.vendorId, config.productId)
          : new Network(config.host, Number(config.port) || 9100)

      const printer = new Printer(device)
      const d = receiptData as {
        storeName: string
        invoiceNumber: string
        cashierName: string
        timestamp: string
        items: Array<{ name: string; quantity: number; price: number; discount: number }>
        charges: Array<{ name: string; amount: number }>
        total: number
        payments: Array<{ method: string; amount: number }>
        change: number
      }

      const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      printer
        .font('a')
        .align('ct')
        .style('b')
        .text(d.storeName)
        .style('normal')
        .drawLine()
        .align('lt')
        .text(`Invoice: ${d.invoiceNumber}`)
        .text(`Date:    ${new Date(d.timestamp).toLocaleString()}`)
        .text(`Cashier: ${d.cashierName}`)
        .drawLine()
        .tableCustom([
          { text: 'Item', width: 0.5 },
          { text: 'Qty', width: 0.1 },
          { text: 'Price', width: 0.2 },
          { text: 'Total', width: 0.2, align: 'RIGHT' },
        ])

      for (const item of d.items) {
        const lineTotal = item.price * item.quantity * (1 - item.discount / 100)
        printer.tableCustom([
          { text: item.name.slice(0, 24), width: 0.5 },
          { text: String(item.quantity), width: 0.1 },
          { text: fmt(item.price), width: 0.2 },
          { text: fmt(lineTotal), width: 0.2, align: 'RIGHT' },
        ])
      }

      printer.drawLine()

      for (const c of d.charges) {
        printer.tableCustom([
          { text: c.name, width: 0.7 },
          { text: `UZS ${fmt(c.amount)}`, width: 0.3, align: 'RIGHT' },
        ])
      }

      printer
        .tableCustom([
          { text: 'TOTAL', width: 0.7, style: 'b' },
          { text: `UZS ${fmt(d.total)}`, width: 0.3, style: 'b', align: 'RIGHT' },
        ])
        .drawLine()

      for (const p of d.payments) {
        printer.tableCustom([
          { text: p.method, width: 0.7 },
          { text: `UZS ${fmt(p.amount)}`, width: 0.3, align: 'RIGHT' },
        ])
      }

      if (d.change > 0) {
        printer.tableCustom([
          { text: 'Change', width: 0.7 },
          { text: `UZS ${fmt(d.change)}`, width: 0.3, align: 'RIGHT' },
        ])
      }

      printer
        .drawLine()
        .align('ct')
        .text('Thank you for shopping with us!')
        .barcode(d.invoiceNumber, 'CODE39')
        .cut()
        .close()

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Print failed' }
    }
  })

  ipcMain.handle('printer:openCashDrawer', async () => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule
      const device =
        config.type === 'usb'
          ? new USB(config.vendorId, config.productId)
          : new Network(config.host, Number(config.port) || 9100)
      const printer = new Printer(device)
      printer.cashdraw(2).close()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed' }
    }
  })

  ipcMain.handle('printer:listPrinters', async () => {
    // Return available USB printers (simplified)
    return []
  })

  ipcMain.handle('printer:testPrint', async () => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule
      const device =
        config.type === 'usb'
          ? new USB(config.vendorId, config.productId)
          : new Network(config.host, Number(config.port) || 9100)
      const printer = new Printer(device)
      printer
        .font('a').align('ct').style('b')
        .text('TEST PRINT')
        .style('normal')
        .text(new Date().toLocaleString())
        .drawLine()
        .text('If you can read this, the')
        .text('printer is connected correctly.')
        .cut()
        .close()
      return { success: true, message: 'Test print sent' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Test print failed' }
    }
  })

  ipcMain.handle('printer:configure', (_event, config: unknown) => {
    // Config saved to SQLite via db:exec from renderer
    return { success: true }
  })
}

function getPrinterConfig(): PrinterConfig {
  try {
    const rows = dbQuery(
      `SELECT meta_value FROM settings WHERE meta_key='printer_config' LIMIT 1`,
      []
    ) as Array<{ meta_value: string }>
    if (rows.length > 0) return JSON.parse(rows[0].meta_value)
  } catch { /* empty */ }
  return { type: 'usb', host: '', port: '9100', vendorId: '', productId: '', name: '' }
}
