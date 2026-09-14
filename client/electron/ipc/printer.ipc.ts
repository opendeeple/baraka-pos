import { ipcMain, BrowserWindow } from 'electron'
import { dbQuery } from '../services/db.service'
import { renderReceiptText, type ReceiptDoc } from '@baraka/app-core'

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
  if (config.type === 'windows') return config.name.trim() ? null : 'No printer selected'
  if (config.type === 'usb' && (!config.vendorId || !config.productId)) return 'No printer configured'
  if (config.type === 'network' && !config.host) return 'No printer configured'
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Windows-installed printers (incl. most USB thermal receipt printers, which
// ship a Windows driver) go through Electron's own print pipeline instead of
// raw ESC/POS bytes — there's no vendor/product id to open a raw device with,
// only the driver's queue name.
//
// 58mm roll (the common size on small shop thermal printers), 28 monospace
// chars/line at 12px — sized to actually fill that width instead of
// defaulting to a Letter/A4-sized virtual page (which is where the vast
// blank paper feed came from: page *height* defaults to a full page unless
// @page gives it an explicit width, letting the browser shrink height to
// match content via the "<width> auto" form).
const RECEIPT_CHAR_WIDTH = 28

function receiptHtml(text: string): string {
  // Single block, no nested pre/div — that structure (inline-block especially)
  // is what triggered Chromium to print a blank page last time. Centering
  // here is `width: Nch` (exactly RECEIPT_CHAR_WIDTH monospace characters)
  // + `margin: 0 auto`, which keeps body a single, plain block box while
  // still centering it within the page — @page is a little wider than the
  // text so there's room either side to actually see it centered rather
  // than pinned flush against the paper edge.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 62mm auto; margin: 0; }
    body {
      margin: 0 auto;
      width: ${RECEIPT_CHAR_WIDTH}ch;
      padding: 2mm 0;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style></head><body>${escapeHtml(text)}</body></html>`
}

function printOnWindowsPrinter(deviceName: string, text: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // show:false windows are often never actually painted by the GPU
    // process on Windows (Chromium deprioritizes hidden surfaces) — silent
    // print then captures nothing, which is exactly the blank-page symptom.
    // Parked off-screen instead: "shown" so it paints normally, but never
    // visible to the user.
    const win = new BrowserWindow({
      show: true,
      x: -3000,
      y: -3000,
      width: 320,
      height: 700,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
    })
    let settled = false
    const finish = (result: { success: boolean; error?: string }) => {
      if (settled) return
      settled = true
      win.destroy()
      resolve(result)
    }
    win.webContents.once('did-finish-load', () => {
      // A print issued the instant the DOM finishes loading can race
      // Chromium's paint pass and come out blank — give it a beat.
      setTimeout(() => {
        if (settled) return
        win.webContents.print(
          { silent: true, deviceName, printBackground: true, margins: { marginType: 'none' } },
          (success, errorType) => finish(success ? { success: true } : { success: false, error: errorType || 'Print failed' })
        )
      }, 400)
    })
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      finish({ success: false, error: desc || `Failed to load receipt (${code})` })
    })
    // Safety net: never leave the IPC call (and the cashier) hanging if the
    // print dialog/driver stalls.
    setTimeout(() => finish({ success: false, error: 'Print timed out' }), 15_000)
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptHtml(text)))
  })
}

export function registerPrinterIpc() {
  ipcMain.handle('printer:print', async (_event, receiptData: unknown) => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      const d = receiptData as ReceiptDoc

      if (config.type === 'windows') {
        return await printOnWindowsPrinter(config.name, renderReceiptText(d, RECEIPT_CHAR_WIDTH))
      }

      // Dynamic import to avoid build issues when native modules not present
      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule

      const device =
        config.type === 'usb'
          ? new USB(config.vendorId, config.productId)
          : new Network(config.host, Number(config.port) || 9100)

      const printer = new Printer(device)

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
        const lineTotal = item.price * item.quantity * (1 - (item.discount ?? 0) / 100)
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
      if (config.type === 'windows') {
        // A Windows print-driver queue has no raw-byte channel to pulse the
        // drawer with — only USB/network ESC/POS connections can do that.
        return { success: false, error: 'Cash drawer control needs a USB or network printer connection' }
      }
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
      if (config.type === 'windows') {
        const text = [
          'TEST PRINT',
          new Date().toLocaleString(),
          '--------------------------------',
          'If you can read this, the',
          'printer is connected correctly.',
        ].join('\n')
        const result = await printOnWindowsPrinter(config.name, text)
        return result.success ? { success: true, message: 'Test print sent' } : result
      }
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
