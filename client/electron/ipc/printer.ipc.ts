import { ipcMain, BrowserWindow } from 'electron'
import { dbQuery } from '../services/db.service'
import type { ReceiptDoc } from '@baraka/app-core'
import { thermalItemsTable, boxLineForPrint, fmtMoney, fmtQty, fmtDateTime, THANKS, type DocItem } from '../services/documentLayout'

interface EscposPrinter {
  font: (f: string) => EscposPrinter
  align: (a: string) => EscposPrinter
  style: (s: string) => EscposPrinter
  text: (t: string) => EscposPrinter
  drawLine: () => EscposPrinter
  tableCustom: (cols: unknown[]) => EscposPrinter
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
// 'items' and 'itemQty' are no longer drawn (the bordered table is 'table');
// kept so saved layouts still parse.
export type ReceiptElementKey =
  | 'storeName' | 'storeInfo' | 'invoiceInfo' | 'items' | 'itemQty' | 'table'
  | 'totals' | 'totalRow' | 'footer' | 'saleNumber'

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
    // Smaller than the body so the five columns (№/Tovar/Soni/Narx/Summa)
    // leave the name column wide enough to read: 34 chars at 11px ≈ 41 at 9px.
    table: { fontPx: 9, shiftPx: 0 },
    totals: { fontPx: 11, shiftPx: 0 },
    totalRow: { fontPx: 11, shiftPx: 0 },
    footer: { fontPx: 13, shiftPx: 0 },
    saleNumber: { fontPx: 13, shiftPx: 0 },
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

// The bordered items table (documentLayout.ts thermalItemsTable) is drawn
// with plain +/-/| characters inside the same plain <div> primitive as every
// other line here — no CSS table/width/flex involved, so it doesn't touch
// any of the properties already proven to blank the page on this printer.
// It has its own element style ('table'), and its character width is the
// calibrated charWidth scaled to that font, so the grid fills the paper.
function tableLinesHtml(items: DocItem[], layout: ReceiptLayoutConfig): string[] {
  const el = layout.elements.table
  const width = Math.floor(layout.charWidth * REFERENCE_FONT_PX / el.fontPx)
  return thermalItemsTable(items, width).map((l) =>
    `<div style="font-size:${el.fontPx}px;margin-left:${el.shiftPx}px;${l.bold ? 'font-weight:700;' : ''}">${escapeHtml(l.text)}</div>`)
}

// The app's own former default footer (saved into many receipt templates
// without anyone choosing it) — reads as the current default instead.
const OLD_DEFAULT_FOOTER = 'Thank you for shopping with us!'
const footerText = (footer: string | null | undefined) =>
  footer == null || footer.trim() === OLD_DEFAULT_FOOTER ? THANKS : footer

const METHOD_LABELS: Record<string, string> = {
  Cash: 'Naqd', Card: 'Karta', Click: 'Click', Debt: 'Qarz', BankTransfer: "O'tkazma",
}
const methodLabel = (m: string) => METHOD_LABELS[m] ?? m

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

// Also rendered on screen by ReceiptModal (via 'printer:receiptHtml'), so
// the preview is this exact markup rather than a separate look-alike.
export function receiptHtml(doc: ReceiptDoc, layout: ReceiptLayoutConfig): string {
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

  // Laid out like the store's document template (documentLayout.ts): name,
  // number and date, the customer, the items table with its Jami row, the
  // payment, then the phone and the thank-you line at the bottom.
  lines.push(div('storeName', centerPad(doc.storeName, W, scaleOf('storeName')), 'font-weight:700;letter-spacing:0.5px;'))
  if (doc.storeAddress) lines.push(div('storeInfo', centerPad(doc.storeAddress, W, scaleOf('storeInfo')), 'font-weight:700;'))
  if (doc.header) lines.push(div('storeInfo', centerPad(doc.header, W, scaleOf('storeInfo')), 'font-weight:700;'))
  lines.push(`<div class="divider"></div>`)
  lines.push(div('invoiceInfo', `Chek № ${doc.invoiceNumber}`, 'font-weight:700;'))
  lines.push(div('invoiceInfo', `Sana: ${fmtDateTime(doc.timestamp)}`))
  if (doc.customerName) lines.push(div('invoiceInfo', `Mijoz: ${doc.customerName}`, 'font-weight:700;'))
  if (doc.cashierName) lines.push(div('invoiceInfo', `Kassir: ${doc.cashierName}`))

  lines.push(...tableLinesHtml(doc.items.map((item) => ({
    ...boxLineForPrint(item.name, item.quantity, item.price, item.unitsPerPackage),
    sum: item.quantity * item.price * (1 - (item.discount ?? 0) / 100),
  })), layout))

  // The table's Jami is the goods; the amount due differs only when there
  // are sale-level charges or a discount, so it's repeated only then.
  for (const c of doc.charges) lines.push(div('totals', padRow(c.name, fmtMoney(c.amount), W)))
  if (doc.discount) lines.push(div('totals', padRow('Chegirma:', `-${fmtMoney(doc.discount)}`, W)))
  if (doc.charges.length || doc.discount) {
    lines.push(div('totalRow', padRow("TO'LOV:", fmtMoney(doc.total), W), 'font-weight:700;'))
  }
  for (const p of doc.payments) lines.push(div('totals', padRow(`${methodLabel(p.method)}:`, fmtMoney(p.amount), W)))
  if (doc.change > 0) lines.push(div('totals', padRow('Qaytim:', fmtMoney(doc.change), W)))
  lines.push(`<div class="divider"></div>`)
  if (doc.storePhone) lines.push(div('storeInfo', centerPad(`Tel: ${doc.storePhone}`, W, scaleOf('storeInfo')), 'font-weight:700;'))
  const thanks = footerText(doc.footer)
  if (thanks) lines.push(div('footer', centerPad(thanks, W, scaleOf('footer')), 'font-weight:700;letter-spacing:0.5px;'))
  // Sale number as plain text where the Code 39 barcode used to be.
  lines.push(div('saleNumber', centerPad(`№ ${doc.invoiceNumber}`, W, scaleOf('saleNumber')), 'font-weight:700;letter-spacing:0.5px;margin-top:4px;'))

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

// Extracted from the original single-purpose printOnWindowsPrinter so the
// shopping-list document (a plain HTML string, not a ReceiptDoc) can go
// through the exact same silent/sized print path instead of a second,
// slightly-different copy of this logic.
const MICRONS_PER_CSS_PX = 25400 / 96

function silentPrintHtml(deviceName: string, html: string, paperWidthMm: number): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // show:false windows are often never actually painted by the GPU
    // process on Windows (Chromium deprioritizes hidden surfaces) — silent
    // print then captures nothing, which is exactly the blank-page symptom.
    // Parked off-screen instead: "shown" so it paints normally, but never
    // visible to the user.
    //
    // The window's CSS width is set to match the real paper width (not a
    // fixed guess) because document.body.scrollHeight below is measured
    // against THIS on-screen viewport — @page (further down) has zero
    // effect on normal layout, only on the actual print pagination. A
    // mismatched viewport means a line can wrap differently at measurement
    // time than it does when actually printed, so the measured height (and
    // the pageSize sent to the driver) comes out wrong for that content —
    // this stayed invisible for sale receipts, whose lines are all either
    // short or padded to exactly fit the paper width already, but a longer
    // free-text line (e.g. the shopping list's disclaimer) can cross the
    // gap between the two widths and wrap onto an extra line only at print
    // time, which is where a mismatched pageSize turns into the driver
    // padding/repositioning content with blank paper.
    const cssWidthPx = Math.round((paperWidthMm * 1000) / MICRONS_PER_CSS_PX)
    const win = new BrowserWindow({
      show: true,
      x: -3000,
      y: -3000,
      width: cssWidthPx,
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
          const heightMicrons = Math.ceil(scrollHeightPx * MICRONS_PER_CSS_PX) + 2000 // +2mm safety buffer
          const widthMicrons = paperWidthMm * 1000
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
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  })
}

function printOnWindowsPrinter(deviceName: string, doc: ReceiptDoc, layout: ReceiptLayoutConfig): Promise<{ success: boolean; error?: string }> {
  return silentPrintHtml(deviceName, receiptHtml(doc, layout), layout.paperWidthMm)
}

export interface ShoppingListItem { name: string; qty: number; cost: number }

/** A purchase order prints as a titled, numbered list ("BUYURTMA", ZK-…) for its supplier. */
export interface ShoppingListMeta { title?: string; reference?: string; supplier?: string | null }

// A restock shopping list: which low-stock products need buying and a rough
// estimate of what it'll cost, based on the product's stored cost price
// (tannarx). Nothing here is persisted anywhere — it exists only for this
// one print, built fresh from the caller's numbers each time, since the
// real market price on the day of buying can differ from the stored cost.
// Same document layout as the sale receipt (store, number and date, the
// supplier, the items table with Jami, phone at the bottom) and the same
// monospace primitives (no CSS text-align/width/flex — see the notes on
// those above), so it prints correctly on the same hardware.
function shoppingListHtml(items: ShoppingListItem[], layout: ReceiptLayoutConfig, meta: ShoppingListMeta = {}): string {
  const W = layout.charWidth
  const esc = escapeHtml
  const els = layout.elements
  const scaleOf = (k: ReceiptElementKey) => els[k].fontPx / REFERENCE_FONT_PX
  const styleOf = (k: ReceiptElementKey, extra = '') =>
    `font-size:${els[k].fontPx}px;margin-left:${els[k].shiftPx}px;${extra}`
  const div = (k: ReceiptElementKey, text: string, extraCss = '') =>
    `<div style="${styleOf(k, extraCss)}">${esc(text)}</div>`

  const store = (dbQuery(`SELECT name, phone FROM stores LIMIT 1`, []) as Array<{ name: string; phone: string | null }>)[0]
  const lines: string[] = []
  if (store?.name) lines.push(div('storeName', centerPad(store.name, W, scaleOf('storeName')), 'font-weight:700;letter-spacing:0.5px;'))
  lines.push(`<div class="divider"></div>`)
  const title = meta.title ?? "XARID RO'YXATI"
  lines.push(div('invoiceInfo', meta.reference ? `${title} № ${meta.reference}` : title, 'font-weight:700;'))
  lines.push(div('invoiceInfo', `Sana: ${fmtDateTime(new Date())}`))
  if (meta.supplier) lines.push(div('invoiceInfo', `Yetkazib beruvchi: ${meta.supplier}`, 'font-weight:700;'))
  lines.push(...tableLinesHtml(items.map((it) => ({ name: it.name, qty: it.qty, price: it.cost })), layout))
  lines.push(div('totals', 'Narxlar taxminiy (tannarx bo\'yicha)'))
  lines.push(`<div class="divider"></div>`)
  if (store?.phone) lines.push(div('storeInfo', centerPad(`Tel: ${store.phone}`, W, scaleOf('storeInfo')), 'font-weight:700;'))

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

/** A label/value report (X/Z shift reports, stocktake results) on the receipt printer. */
export type ReportLine = { label: string; value?: string; bold?: boolean } | { divider: true }
export interface ReportDoc { title: string; subtitle?: string; lines: ReportLine[] }

function reportHtml(doc: ReportDoc, layout: ReceiptLayoutConfig): string {
  const W = layout.charWidth
  const esc = escapeHtml
  const els = layout.elements
  const scaleOf = (k: ReceiptElementKey) => els[k].fontPx / REFERENCE_FONT_PX
  const div = (k: ReceiptElementKey, text: string, extraCss = '') =>
    `<div style="font-size:${els[k].fontPx}px;margin-left:${els[k].shiftPx}px;${extraCss}">${esc(text)}</div>`
  const out: string[] = []
  out.push(div('storeName', centerPad(doc.title, W, scaleOf('storeName')), 'font-weight:700;'))
  if (doc.subtitle) out.push(div('storeInfo', centerPad(doc.subtitle, W, scaleOf('storeInfo'))))
  out.push(div('invoiceInfo', new Date().toLocaleString().slice(0, 19)))
  out.push(`<div class="divider"></div>`)
  for (const line of doc.lines) {
    if ('divider' in line) { out.push(`<div class="divider"></div>`); continue }
    const text = line.value === undefined ? line.label : padRow(line.label, line.value, W)
    out.push(div('totals', text, line.bold ? 'font-weight:700;' : ''))
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${layout.paperWidthMm}mm auto; margin: 0; }
    body { margin: 0; padding: 2.5mm ${layout.marginMm}mm; font-family: Consolas, 'Courier New', monospace;
      font-size: ${REFERENCE_FONT_PX}px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
  </style></head><body>${out.join('')}</body></html>`
}

export function registerPrinterIpc() {
  ipcMain.handle('printer:printReport', async (_event, docArg: unknown) => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      const doc = docArg as ReportDoc
      const layout = getReceiptLayoutConfig()
      if (config.type === 'windows') {
        return await silentPrintHtml(config.name, reportHtml(doc, layout), layout.paperWidthMm)
      }
      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule
      const device = config.type === 'usb'
        ? new USB(config.vendorId, config.productId)
        : new Network(config.host, Number(config.port) || 9100)
      const printer = new Printer(device)
      printer.font('a').align('ct').style('b').text(doc.title).style('normal')
      if (doc.subtitle) printer.text(doc.subtitle)
      printer.text(new Date().toLocaleString().slice(0, 19)).drawLine().align('lt')
      for (const line of doc.lines) {
        if ('divider' in line) { printer.drawLine(); continue }
        if (line.value === undefined) { printer.style(line.bold ? 'b' : 'normal').text(line.label).style('normal'); continue }
        printer.tableCustom([
          { text: line.label, width: 0.62, style: line.bold ? 'b' : undefined },
          { text: line.value, width: 0.38, align: 'RIGHT', style: line.bold ? 'b' : undefined },
        ])
      }
      printer.drawLine().cut().close()
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Print failed' }
    }
  })

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

      const fmt = fmtMoney

      printer
        .font('a')
        .align('ct')
        .style('b')
        .text(d.storeName)
        .style('normal')
      if (d.storeAddress) printer.text(d.storeAddress)
      printer
        .drawLine()
        .align('lt')
        .style('b')
        .text(`Chek № ${d.invoiceNumber}`)
        .style('normal')
        .text(`Sana: ${fmtDateTime(d.timestamp)}`)
      if (d.customerName) printer.style('b').text(`Mijoz: ${d.customerName}`).style('normal')
      if (d.cashierName) printer.text(`Kassir: ${d.cashierName}`)
      printer
        .drawLine()
        .tableCustom([
          { text: '№', width: 0.06 },
          { text: 'Tovar', width: 0.38 },
          { text: 'Soni', width: 0.12, align: 'RIGHT' },
          { text: 'Narx', width: 0.2, align: 'RIGHT' },
          { text: 'Summa', width: 0.24, align: 'RIGHT' },
        ])

      let totalQty = 0
      let goods = 0
      d.items.forEach((item, i) => {
        const lineTotal = item.price * item.quantity * (1 - (item.discount ?? 0) / 100)
        const shown = boxLineForPrint(item.name, item.quantity, item.price, item.unitsPerPackage)
        totalQty += shown.qty
        goods += lineTotal
        printer.tableCustom([
          { text: String(i + 1), width: 0.06 },
          { text: shown.name.slice(0, 20), width: 0.38 },
          { text: fmtQty(shown.qty), width: 0.12, align: 'RIGHT' },
          { text: fmt(shown.price), width: 0.2, align: 'RIGHT' },
          { text: fmt(lineTotal), width: 0.24, align: 'RIGHT' },
        ])
      })

      printer
        .drawLine()
        .tableCustom([
          { text: 'Jami', width: 0.44, style: 'b' },
          { text: fmtQty(totalQty), width: 0.12, style: 'b', align: 'RIGHT' },
          { text: fmt(goods), width: 0.44, style: 'b', align: 'RIGHT' },
        ])

      for (const c of d.charges) {
        printer.tableCustom([
          { text: c.name, width: 0.6 },
          { text: fmt(c.amount), width: 0.4, align: 'RIGHT' },
        ])
      }
      if (d.discount) {
        printer.tableCustom([
          { text: 'Chegirma', width: 0.6 },
          { text: `-${fmt(d.discount)}`, width: 0.4, align: 'RIGHT' },
        ])
      }
      if (d.charges.length || d.discount) {
        printer.tableCustom([
          { text: "TO'LOV", width: 0.6, style: 'b' },
          { text: fmt(d.total), width: 0.4, style: 'b', align: 'RIGHT' },
        ])
      }

      for (const p of d.payments) {
        printer.tableCustom([
          { text: methodLabel(p.method), width: 0.6 },
          { text: fmt(p.amount), width: 0.4, align: 'RIGHT' },
        ])
      }

      if (d.change > 0) {
        printer.tableCustom([
          { text: 'Qaytim', width: 0.6 },
          { text: fmt(d.change), width: 0.4, align: 'RIGHT' },
        ])
      }

      printer.drawLine().align('ct')
      if (d.storePhone) printer.style('b').text(`Tel: ${d.storePhone}`).style('normal')
      printer
        .style('b')
        .text(footerText(d.footer))
        .text(`№ ${d.invoiceNumber}`)
        .style('normal')
        .cut()
        .close()

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Print failed' }
    }
  })

  // Restock shopping list (Back office > Dashboard > Low stock) — same
  // receipt printer as sales, so it prints on the same paper the owner
  // already carries around, but built from ShoppingListItem[] the caller
  // computes fresh each time, not a stored ReceiptDoc.
  ipcMain.handle('printer:printShoppingList', async (_event, items: unknown, metaArg?: unknown) => {
    try {
      const config = getPrinterConfig()
      const reason = unconfiguredReason(config)
      if (reason) return { success: false, error: reason }
      const list = items as ShoppingListItem[]
      const meta = (metaArg ?? {}) as ShoppingListMeta
      const layout = getReceiptLayoutConfig()

      if (config.type === 'windows') {
        return await silentPrintHtml(config.name, shoppingListHtml(list, layout, meta), layout.paperWidthMm)
      }

      const { Printer, USB, Network } = await import('escpos' as never) as never as EscposModule
      const device =
        config.type === 'usb'
          ? new USB(config.vendorId, config.productId)
          : new Network(config.host, Number(config.port) || 9100)
      const printer = new Printer(device)
      const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })
      const total = list.reduce((s, it) => s + it.qty * it.cost, 0)

      const title = meta.title ?? "XARID RO'YXATI"
      printer
        .font('a')
        .align('ct')
        .style('b')
        .text(meta.reference ? `${title} № ${meta.reference}` : title)
        .style('normal')
        .drawLine()
        .align('lt')
        .text(`Sana: ${fmtDateTime(new Date())}`)
      if (meta.supplier) printer.style('b').text(`Yetkazib beruvchi: ${meta.supplier}`).style('normal')
      printer.tableCustom([
        { text: '№', width: 0.06 },
        { text: 'Tovar', width: 0.38 },
        { text: 'Soni', width: 0.12, align: 'RIGHT' },
        { text: 'Narx', width: 0.2, align: 'RIGHT' },
        { text: 'Summa', width: 0.24, align: 'RIGHT' },
      ])
      list.forEach((it, i) => {
        printer.tableCustom([
          { text: String(i + 1), width: 0.06 },
          { text: it.name.slice(0, 20), width: 0.38 },
          { text: String(it.qty), width: 0.12, align: 'RIGHT' },
          { text: fmt(it.cost), width: 0.2, align: 'RIGHT' },
          { text: fmt(it.qty * it.cost), width: 0.24, align: 'RIGHT' },
        ])
      })
      printer
        .drawLine()
        .tableCustom([
          { text: 'Jami', width: 0.44, style: 'b' },
          { text: String(list.reduce((s, it) => s + it.qty, 0)), width: 0.12, style: 'b', align: 'RIGHT' },
          { text: fmt(total), width: 0.44, style: 'b', align: 'RIGHT' },
        ])
        .text("Narxlar taxminiy (tannarx bo'yicha)")
        .drawLine()
        .cut()
        .close()

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Print failed' }
    }
  })

  // Employee badges (Back office > Employees) go through the normal print
  // dialog rather than the till's receipt printer: they're printed rarely and
  // usually on an office/card printer the user picks each time. The window is
  // shown (not parked off-screen like receipts) because the system dialog
  // opens over it.
  ipcMain.handle('printer:printBadge', (event, html: string) => new Promise<{ success: boolean; error?: string }>((resolve) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const win = new BrowserWindow({ parent, modal: !!parent, width: 420, height: 300, show: false, autoHideMenuBar: true })
    win.webContents.once('did-finish-load', () => {
      win.show()
      setTimeout(() => {
        win.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (success, errorType) => {
          win.destroy()
          // The user closing the dialog isn't a failure worth reporting.
          resolve(success || errorType === 'cancelled' ? { success } : { success: false, error: errorType || 'Print failed' })
        })
      }, 300)
    })
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  }))

  ipcMain.handle('printer:receiptHtml', (_event, receiptData: unknown) => {
    const layout = getReceiptLayoutConfig()
    return { html: receiptHtml(receiptData as ReceiptDoc, layout), paperWidthMm: layout.paperWidthMm }
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
        // A long name too, so the test also shows names wrapping in the table.
        const testDoc: ReceiptDoc = {
          invoiceNumber: 'TEST-0001',
          storeName: 'TEST PRINT',
          header: 'Printer ulangan',
          cashierName: 'Test',
          customerName: 'Mijoz ismi',
          timestamp: new Date().toISOString(),
          items: [
            { name: 'Navot dil 10kg', quantity: 1, price: 158000 },
            { name: 'Zaychik malako 500gr 12ta', quantity: 2, price: 13500 },
          ],
          charges: [],
          total: 185000,
          payments: [{ method: 'Cash', amount: 185000 }],
          change: 0,
          storePhone: '+998 90 000 00 00',
          footer: THANKS,
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
