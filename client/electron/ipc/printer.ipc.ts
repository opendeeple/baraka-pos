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

// Matches the values already hand-tuned against the real till printer
// (Xprinter XP-365B, 76mm/75mm roll) in an earlier session, so a fresh
// install starts pre-calibrated instead of needing that trial-and-error
// real-hardware pass redone from scratch.
const DEFAULT_RECEIPT_LAYOUT: ReceiptLayoutConfig = {
  paperWidthMm: 75,
  marginMm: 5,
  charWidth: 34,
  elements: {
    storeName: { fontPx: 22, shiftPx: 10 },
    storeInfo: { fontPx: 11, shiftPx: 25 },
    invoiceInfo: { fontPx: 11, shiftPx: -1 },
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

// A real bordered items table (№ / Nomi / Soni / Narx columns), drawn with
// plain +/-/| characters inside the same plain <div> primitive as every
// other line here — no CSS table/width/flex involved, so it doesn't touch
// any of the properties already proven to blank the page on this printer.
// Column widths are chars, sized to sum to exactly `width` including the 5
// border pipes, so every row/border line lines up under the same font.
const TABLE_NO_W = 2
const TABLE_QTY_W = 3
const TABLE_PRICE_W = 8
function tableNameWidth(width: number): number {
  return Math.max(4, width - 5 - TABLE_NO_W - TABLE_QTY_W - TABLE_PRICE_W)
}
function tableBorder(width: number): string {
  const nameW = tableNameWidth(width)
  return '+' + '-'.repeat(TABLE_NO_W) + '+' + '-'.repeat(nameW) + '+' + '-'.repeat(TABLE_QTY_W) + '+' + '-'.repeat(TABLE_PRICE_W) + '+'
}
// Pads to width; never truncates (a too-long number would lose its most
// significant digits) — an overflowing cell just nudges that one row's
// border alignment slightly instead of corrupting the value.
function tableCell(s: string, w: number, align: 'l' | 'r' = 'l'): string {
  if (s.length >= w) return s
  const pad = ' '.repeat(w - s.length)
  return align === 'l' ? s + pad : pad + s
}
function tableRow(no: string, name: string, qty: string, price: string, width: number): string {
  const nameW = tableNameWidth(width)
  return `|${tableCell(no, TABLE_NO_W)}|${tableCell(name.slice(0, nameW), nameW)}|${tableCell(qty, TABLE_QTY_W, 'r')}|${tableCell(price, TABLE_PRICE_W, 'r')}|`
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

// Standard Code 39 bar/space widths (N=narrow, W=wide), 5 bars + 4 spaces per
// character, ANSI MH10.8M-1983. Only the subset invoice numbers actually use
// (0-9, A-Z, '-') is included — narrower than the full table on purpose, so
// there's no character here that hasn't been checked against the published
// reference.
const CODE39_PATTERNS: Record<string, string> = {
  '0': 'NNNWWNWNN', '1': 'WNNWNNNNW', '2': 'NNWWNNNNW', '3': 'WNWWNNNNN',
  '4': 'NNNWWNNNW', '5': 'WNNWWNNNN', '6': 'NNWWWNNNN', '7': 'NNNWNNWNW',
  '8': 'WNNWNNWNN', '9': 'NNWWNNWNN',
  A: 'WNNNNWNNW', B: 'NNWNNWNNW', C: 'WNWNNWNNN', D: 'NNNNWWNNW',
  E: 'WNNNWWNNN', F: 'NNWNWWNNN', G: 'NNNNNWWNW', H: 'WNNNNWWNN',
  I: 'NNWNNWWNN', J: 'NNNNWWWNN', K: 'WNNNNNNWW', L: 'NNWNNNNWW',
  M: 'WNWNNNNWN', N: 'NNNNWNNWW', O: 'WNNNWNNWN', P: 'NNWNWNNWN',
  Q: 'NNNNNNWWW', R: 'WNNNNNWWN', S: 'NNWNNNWWN', T: 'NNNNWNWWN',
  U: 'WWNNNNNNW', V: 'NWWNNNNNW', W: 'WWWNNNNNN', X: 'NWNNWNNNW',
  Y: 'WWNNWNNNN', Z: 'NWWNWNNNN', '-': 'NWNNNNWNW',
  '*': 'NWNNWNWNN', // start/stop
}

// A real, scannable Code 39 barcode as inline SVG rects — sized by SVG
// viewBox/attribute geometry, not CSS width/flex (the primitives already
// proven to blank the page on this printer). Renders through the same
// Chromium print path as the rest of the receipt, so it's still subject to
// whatever that path does with SVG specifically — unlike every other element
// on this receipt, that hasn't been print-tested on real hardware yet.
function code39Svg(invoiceNumber: string, maxWidthPx: number, heightPx: number): { svg: string; width: number } {
  const clean = invoiceNumber.toUpperCase().replace(/[^0-9A-Z-]/g, '-')
  const chars = `*${clean}*`.split('')
  // Each char is 3 wide + 6 narrow elements (the "3 of 9" in Code 39) plus a
  // 1-unit inter-character gap — sum that in narrow-units first, then derive
  // the pixel size of one narrow unit from the paper's actual available
  // width so long invoice numbers shrink to fit instead of overflowing.
  const unitsPerChar = 3 * 2.5 + 6 * 1 + 1
  const totalUnits = chars.length * unitsPerChar - 1 // no trailing gap after the last char
  const unitPx = Math.min(1.3, maxWidthPx / totalUnits)
  const narrow = unitPx
  const wide = unitPx * 2.5
  const gap = unitPx
  let x = 0
  const rects: string[] = []
  for (const ch of chars) {
    const pattern = CODE39_PATTERNS[ch] ?? CODE39_PATTERNS['-']
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i] === 'W' ? wide : narrow
      const isBar = i % 2 === 0 // pattern alternates bar, space, bar, ... starting with a bar
      if (isBar) rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${heightPx}" fill="#000"/>`)
      x += w
    }
    x += gap
  }
  const totalWidth = x - gap
  return {
    svg: `<svg width="${totalWidth.toFixed(2)}" height="${heightPx}" viewBox="0 0 ${totalWidth.toFixed(2)} ${heightPx}" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`,
    width: totalWidth,
  }
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

  // Bordered items table (№ / Nomi / Soni / Narx) — every row, including
  // the borders, renders at the SAME element style ('items') so the
  // monospace character grid lines up between them; mixing font sizes
  // within this table would throw off the border alignment.
  lines.push(div('items', tableBorder(W)))
  lines.push(div('items', tableRow('№', 'Nomi', 'Soni', 'Narx', W), 'font-weight:700;'))
  lines.push(div('items', tableBorder(W)))
  doc.items.forEach((item, i) => {
    const itemTotal = (item.quantity * item.price).toLocaleString()
    lines.push(div('items', tableRow(String(i + 1), item.name, String(item.quantity), itemTotal, W)))
  })
  lines.push(div('items', tableBorder(W)))

  for (const c of doc.charges) lines.push(div('totals', padRow(c.name, c.amount.toLocaleString(), W)))
  if (doc.discount) lines.push(div('totals', padRow('DISCOUNT:', `-${doc.discount.toLocaleString()}`, W)))
  lines.push(div('totalRow', padRow('TOTAL AMOUNT:', doc.total.toLocaleString(), W), 'font-weight:700;'))
  for (const p of doc.payments) lines.push(div('totals', padRow(`${p.method.toUpperCase()}:`, p.amount.toLocaleString(), W)))
  if (doc.change > 0) lines.push(div('totals', padRow('CHANGE:', doc.change.toLocaleString(), W)))
  lines.push(`<div class="divider"></div>`)
  if (doc.footer) lines.push(div('footer', centerPad(doc.footer, W, scaleOf('footer')), 'font-weight:700;letter-spacing:0.5px;'))
  // Real, scannable Code 39 barcode encoding the invoice number — sized to
  // the printable width via SVG viewBox/width *attributes* (not the CSS
  // `width` property already proven to blank the page) and centered the same
  // way as everything else's per-element shift: plain margin-left, just
  // computed instead of a fixed constant. This is the one element on the
  // receipt that hasn't been print-tested on real hardware yet.
  const contentWidthPx = (layout.paperWidthMm - 2 * layout.marginMm) * (96 / 25.4)
  const barcode = code39Svg(doc.invoiceNumber, contentWidthPx, 30)
  const barcodeMarginLeft = Math.max(0, (contentWidthPx - barcode.width) / 2)
  lines.push(`<div style="margin-top:4px;margin-left:${barcodeMarginLeft.toFixed(2)}px;">${barcode.svg}</div>`)

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
          { text: '#', width: 0.06 },
          { text: 'Item', width: 0.44 },
          { text: 'Qty', width: 0.1 },
          { text: 'Price', width: 0.2 },
          { text: 'Total', width: 0.2, align: 'RIGHT' },
        ])

      d.items.forEach((item, i) => {
        const lineTotal = item.price * item.quantity * (1 - (item.discount ?? 0) / 100)
        printer.tableCustom([
          { text: String(i + 1), width: 0.06 },
          { text: item.name.slice(0, 24), width: 0.44 },
          { text: String(item.quantity), width: 0.1 },
          { text: fmt(item.price), width: 0.2 },
          { text: fmt(lineTotal), width: 0.2, align: 'RIGHT' },
        ])
      })

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
        // Sample items included (not an empty doc) so a test print actually
        // exercises the item table layout, not just the header/footer — an
        // empty-items test print looked "unchanged" after layout edits
        // because there was nothing in it for those edits to affect.
        const testDoc: ReceiptDoc = {
          invoiceNumber: 'TEST-0001',
          storeName: 'TEST PRINT',
          header: 'If you can read this, the printer is connected correctly.',
          cashierName: 'Test',
          timestamp: new Date().toISOString(),
          items: [
            { name: 'Sample item A', quantity: 1, price: 10000 },
            { name: 'Sample item B', quantity: 2, price: 5000 },
          ],
          charges: [],
          total: 20000,
          payments: [{ method: 'Cash', amount: 20000 }],
          change: 0,
          footer: 'Thank you for shopping with us!',
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
