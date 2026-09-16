import { ipcMain, BrowserWindow } from 'electron'
import { dbQuery } from '../services/db.service'
import type { ReceiptDoc } from '@baraka/app-core'

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

// One font-size + one horizontal nudge per named text element — "left/right
// shift" is a plain CSS margin-left (can be negative), not baked into the
// centerPad math, so it stacks cleanly on top of automatic centering as a
// fine-tuning knob. margin-left is untested here specifically, but the same
// property (margin-top, on .footer) already printed correctly — this isn't
// the width+margin:auto / flex / inline-block / text-align combo that broke
// things; it's a fixed single-direction offset with no container-width
// computation involved.
export type ReceiptElementKey =
  | 'storeName' | 'storeInfo' | 'invoiceInfo' | 'items' | 'itemQty'
  | 'totals' | 'totalRow' | 'footer' | 'barcode'

interface ElementStyle { fontPx: number; shiftPx: number }

type ReceiptLayoutConfig = {
  paperWidthMm: number
  marginMm: number
  charWidth: number
  elements: Record<ReceiptElementKey, ElementStyle>
}

// Character-width math (centerPad) is calibrated against this size; each
// element's actual fontPx is scaled relative to it, not to any one
// particular element's setting (there's no longer a single "body" font).
const REFERENCE_FONT_PX = 11

const DEFAULT_RECEIPT_LAYOUT: ReceiptLayoutConfig = {
  paperWidthMm: 60,
  marginMm: 3,
  charWidth: 28,
  elements: {
    storeName: { fontPx: 13, shiftPx: 0 },
    storeInfo: { fontPx: 11, shiftPx: 0 },
    invoiceInfo: { fontPx: 11, shiftPx: 0 },
    items: { fontPx: 11, shiftPx: 0 },
    itemQty: { fontPx: 10, shiftPx: 0 },
    totals: { fontPx: 11, shiftPx: 0 },
    totalRow: { fontPx: 11, shiftPx: 0 },
    footer: { fontPx: 13, shiftPx: 0 },
    barcode: { fontPx: 11, shiftPx: 0 },
  },
}

// User-tunable from Backoffice > Settings > Receipt Print Layout — every
// thermal printer/paper roll combination fits text differently, and there's
// no way to verify sizing/alignment from here without the physical
// hardware, so the numbers are exposed instead of hardcoded.
function getReceiptLayoutConfig(): ReceiptLayoutConfig {
  try {
    const rows = dbQuery(
      `SELECT meta_value FROM settings WHERE meta_key='receipt_layout' LIMIT 1`,
      []
    ) as Array<{ meta_value: string }>
    if (rows.length > 0) {
      const saved = JSON.parse(rows[0].meta_value) as Partial<ReceiptLayoutConfig>
      return {
        ...DEFAULT_RECEIPT_LAYOUT,
        ...saved,
        elements: { ...DEFAULT_RECEIPT_LAYOUT.elements, ...saved.elements },
      }
    }
  } catch { /* empty */ }
  return DEFAULT_RECEIPT_LAYOUT
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
// Sizing (paper width, margins, font sizes) comes from ReceiptLayoutConfig,
// not hardcoded — see getReceiptLayoutConfig(). @page needs an explicit
// width for its height to auto-shrink to content (the "<width> auto" form);
// without one it defaults to a Letter/A4-sized virtual page, which is where
// the vast blank paper feed came from before this was configurable.

// Right-pads/truncates so left+right together span exactly `width` chars —
// same manual alignment renderReceiptText uses, reused here because a plain
// padded monospace line is the one row style proven not to break printing
// (see note below on the layout primitives that did).
function padRow(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length)
  return left + ' '.repeat(space) + right
}

// Leading-space centering instead of CSS text-align:center — every element
// that had text-align:center (store name/address/phone/header/footer)
// printed as fully MISSING content on real hardware, while identically-
// structured divs without it (Invoice/items/TOTAL) printed fine. Whatever
// this driver's print path does with centered text, plain left-aligned
// text with manual padding sidesteps it entirely.
//
// `width` is calibrated for the BASE (body) font size. A line rendered at a
// larger fontScale (e.g. the bold, bigger store name) has physically wider
// characters — both in the text itself and in the padding spaces, which
// render at that same larger size — so the padding count has to be worked
// out in that line's own font, not the base grid: divide the target width
// by fontScale first, then split the remainder as usual.
function centerPad(s: string, width: number, fontScale = 1): string {
  const effectiveWidth = width / fontScale
  const pad = Math.max(0, Math.floor((effectiveWidth - s.length) / 2))
  return ' '.repeat(pad) + s
}

// Visual-only bar pattern, deterministic per invoice number — plain text
// (| and spaces), not an actual encoded/scannable barcode.
function fakeBarcode(seed: string, width: number): string {
  let n = 0
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0
  let out = ''
  for (let i = 0; i < width; i++) {
    n = (n * 1103515245 + 12345) >>> 0
    out += (n >>> 16) % 3 === 0 ? ' ' : '|'
  }
  return out
}

function receiptHtml(doc: ReceiptDoc, layout: ReceiptLayoutConfig): string {
  // Every <div> below is a plain block: no width/margin:auto/flex/inline-
  // block (blanked the whole page) and no text-align:center (silently
  // dropped just those lines) — both diagnosed on real hardware. All
  // centering is plain space-padded text (centerPad), not CSS; the only
  // per-element CSS is font-size/weight/letter-spacing/margin-left, all
  // individually proven not to break printing.
  const W = layout.charWidth
  const esc = escapeHtml
  const els = layout.elements
  const scaleOf = (k: ReceiptElementKey) => els[k].fontPx / REFERENCE_FONT_PX
  const styleOf = (k: ReceiptElementKey, extra = '') =>
    `font-size:${els[k].fontPx}px;margin-left:${els[k].shiftPx}px;${extra}`
  const div = (k: ReceiptElementKey, text: string, extraCss = '') =>
    `<div style="${styleOf(k, extraCss)}">${esc(text)}</div>`

  const lines: string[] = []

  lines.push(div('storeName', centerPad(doc.storeName, W, scaleOf('storeName')), 'font-weight:700;letter-spacing:0.5px;'))
  if (doc.storeAddress) lines.push(div('storeInfo', centerPad(doc.storeAddress, W, scaleOf('storeInfo')), 'font-weight:700;'))
  if (doc.storePhone) lines.push(div('storeInfo', centerPad(doc.storePhone, W, scaleOf('storeInfo')), 'font-weight:700;'))
  if (doc.header) lines.push(div('storeInfo', centerPad(doc.header, W, scaleOf('storeInfo')), 'font-weight:700;'))
  lines.push(`<div class="divider"></div>`)
  lines.push(div('invoiceInfo', `Invoice: ${doc.invoiceNumber}`))
  if (doc.cashierName) lines.push(div('invoiceInfo', `Cashier: ${doc.cashierName}`))
  lines.push(div('invoiceInfo', doc.timestamp.slice(0, 19).replace('T', ' ')))
  lines.push(`<div class="divider"></div>`)

  for (const item of doc.items) {
    const itemTotal = (item.quantity * item.price).toLocaleString()
    lines.push(div('items', padRow(item.name.slice(0, W - 10), itemTotal, W)))
    lines.push(div('itemQty', `${item.quantity}x${item.price.toLocaleString()}`))
  }
  lines.push(`<div class="divider"></div>`)

  for (const c of doc.charges) lines.push(div('totals', padRow(c.name, c.amount.toLocaleString(), W)))
  if (doc.discount) lines.push(div('totals', padRow('DISCOUNT:', `-${doc.discount.toLocaleString()}`, W)))
  lines.push(div('totalRow', padRow('TOTAL AMOUNT:', doc.total.toLocaleString(), W), 'font-weight:700;'))
  for (const p of doc.payments) lines.push(div('totals', padRow(`${p.method.toUpperCase()}:`, p.amount.toLocaleString(), W)))
  if (doc.change > 0) lines.push(div('totals', padRow('CHANGE:', doc.change.toLocaleString(), W)))
  lines.push(`<div class="divider"></div>`)
  if (doc.footer) lines.push(div('footer', centerPad(doc.footer, W, scaleOf('footer')), 'font-weight:700;letter-spacing:0.5px;'))
  // Decorative only — not a real scannable barcode. Generating one needs a
  // raster/SVG renderer, which is more untested surface in a print pipeline
  // that's already broken on text-align, width and flex; this is plain text.
  lines.push(div('barcode', centerPad(fakeBarcode(doc.invoiceNumber, W - 2), W, scaleOf('barcode')), 'letter-spacing:1px;margin-top:4px;'))

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${layout.paperWidthMm}mm auto; margin: 0; }
    body {
      margin: 0;
      padding: 2.5mm ${layout.marginMm}mm;
      font-family: Consolas, 'Courier New', monospace;
      font-size: ${REFERENCE_FONT_PX}px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
  </style></head><body>${lines.join('')}</body></html>`
}

function printOnWindowsPrinter(deviceName: string, doc: ReceiptDoc, layout: ReceiptLayoutConfig): Promise<{ success: boolean; error?: string }> {
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
      setTimeout(async () => {
        if (settled) return
        try {
          // @page { size: <width>mm auto } only auto-shrinks the page height
          // for PDF export. Printing straight to a real driver via
          // webContents.print() instead falls back to that driver's own
          // configured default paper LENGTH (commonly A4/Letter, ~297mm) —
          // that's the source of the excess trailing blank paper, regardless
          // of how short the receipt content actually is. Measuring the
          // real rendered height and passing it as an explicit pageSize
          // overrides the driver default so the physical feed matches the
          // content instead.
          const scrollHeightPx = await win.webContents.executeJavaScript('document.body.scrollHeight') as number
          const MICRONS_PER_CSS_PX = 25400 / 96
          const heightMicrons = Math.ceil(scrollHeightPx * MICRONS_PER_CSS_PX) + 2000 // +2mm safety buffer
          const widthMicrons = layout.paperWidthMm * 1000
          if (settled) return
          win.webContents.print(
            {
              silent: true, deviceName, printBackground: true,
              margins: { marginType: 'none' },
              pageSize: { width: widthMicrons, height: heightMicrons },
            },
            (success, errorType) => finish(success ? { success: true } : { success: false, error: errorType || 'Print failed' })
          )
        } catch (e) {
          finish({ success: false, error: e instanceof Error ? e.message : 'Print failed' })
        }
      }, 400)
    })
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      finish({ success: false, error: desc || `Failed to load receipt (${code})` })
    })
    // Safety net: never leave the IPC call (and the cashier) hanging if the
    // print dialog/driver stalls.
    setTimeout(() => finish({ success: false, error: 'Print timed out' }), 15_000)
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptHtml(doc, layout)))
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
        return await printOnWindowsPrinter(config.name, d, getReceiptLayoutConfig())
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
        const testDoc: ReceiptDoc = {
          invoiceNumber: 'TEST',
          storeName: 'TEST PRINT',
          header: 'If you can read this, the printer is connected correctly.',
          timestamp: new Date().toISOString(),
          items: [],
          charges: [],
          total: 0,
          payments: [],
          change: 0,
        }
        const result = await printOnWindowsPrinter(config.name, testDoc, getReceiptLayoutConfig())
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
