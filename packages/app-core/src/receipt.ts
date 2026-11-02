// Device-independent receipt model. Drivers (Electron escpos today; Android
// network/Bluetooth/Sunmi drivers in the mobile apps) render this to bytes.
export interface ReceiptLine {
  name: string
  quantity: number
  price: number
  /** Percent off the line. */
  discount?: number
  /** Money off the whole line, after `discount`. */
  flatDiscount?: number
  /** Box products only: pieces per box (quantity and price are per box). */
  unitsPerPackage?: number
}

export interface ReceiptDoc {
  invoiceNumber: string
  storeName: string
  storeAddress?: string | null
  storePhone?: string | null
  /** Custom greeting line, printed under the store info block. */
  header?: string | null
  /** Omit (empty/undefined) to hide the cashier line entirely. */
  cashierName?: string | null
  /** The sale's customer (debt sales), printed as "Mijoz: …". */
  customerName?: string | null
  timestamp: string
  items: ReceiptLine[]
  charges: Array<{ name: string; amount: number }>
  discount?: number
  total: number
  payments: Array<{ method: string; amount: number }>
  change: number
  footer?: string | null
  openDrawer?: boolean
}

/** Plain-text fixed-width rendering — usable for previews and simple printers. */
export function renderReceiptText(doc: ReceiptDoc, width = 32): string {
  const line = (l: string, r: string) => {
    const space = Math.max(1, width - l.length - r.length)
    return l + ' '.repeat(space) + r
  }
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((width - s.length) / 2))
    return ' '.repeat(pad) + s
  }
  const divider = '-'.repeat(width)
  const out: string[] = []
  out.push(center(doc.storeName))
  if (doc.storeAddress) out.push(center(doc.storeAddress))
  if (doc.storePhone) out.push(center(doc.storePhone))
  if (doc.header) out.push(center(doc.header))
  out.push(divider)
  out.push(line(`Invoice: ${doc.invoiceNumber}`, ''))
  if (doc.cashierName) out.push(line(`Cashier: ${doc.cashierName}`, ''))
  out.push(line(doc.timestamp.slice(0, 19).replace('T', ' '), ''))
  out.push(divider)
  doc.items.forEach((item, i) => {
    out.push(`${i + 1}. ${item.name}`.slice(0, width))
    const qtyPrice = `${item.quantity} x ${item.price.toLocaleString()}`
    out.push(line(`  ${qtyPrice}`, (item.quantity * item.price).toLocaleString()))
  })
  out.push(divider)
  for (const c of doc.charges) out.push(line(c.name, c.amount.toLocaleString()))
  if (doc.discount) out.push(line('Discount', `-${doc.discount.toLocaleString()}`))
  out.push(line('TOTAL', doc.total.toLocaleString()))
  for (const p of doc.payments) out.push(line(p.method, p.amount.toLocaleString()))
  if (doc.change > 0) out.push(line('Change', doc.change.toLocaleString()))
  out.push(divider)
  if (doc.footer) out.push(center(doc.footer))
  return out.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * HTML rendering for Android's system print framework (expo-print) — lets
 * the OS print dialog hand the job to whatever's installed (a Bluetooth/USB
 * printer's own vendor app registered as a print service, "Save as PDF",
 * a cloud-print plugin, …) without BarakaPOS needing its own driver for
 * that printer. `widthMm` targets receipt paper via CSS `@page`; printing
 * to a non-receipt printer (e.g. a PDF file) still reads fine on a normal
 * page since nothing below depends on the physical paper size.
 */
export function renderReceiptHtml(doc: ReceiptDoc, width = 32): string {
  const widthMm = width <= 32 ? 58 : 80
  const rows = doc.items.map((item, i) => {
    const qty = item.unitsPerPackage ? `${item.quantity} box` : String(item.quantity)
    const lineTotal = item.quantity * item.price * (1 - (item.discount ?? 0) / 100) - (item.flatDiscount ?? 0)
    return `<tr>
      <td colspan="2" class="name">${i + 1}. ${escapeHtml(item.name)}</td>
    </tr>
    <tr>
      <td class="muted">${qty} x ${item.price.toLocaleString()}</td>
      <td class="amount">${lineTotal.toLocaleString()}</td>
    </tr>`
  }).join('')
  const chargeRows = doc.charges
    .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td class="amount">${c.amount.toLocaleString()}</td></tr>`)
    .join('')
  const paymentRows = doc.payments
    .map((p) => `<tr><td>${escapeHtml(p.method)}</td><td class="amount">${p.amount.toLocaleString()}</td></tr>`)
    .join('')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: ${widthMm}mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; margin: 0; }
  .center { text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .amount { text-align: right; white-space: nowrap; }
  .name { font-weight: bold; }
  .muted { color: #444; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .total td { font-weight: bold; font-size: 14px; }
</style>
</head>
<body>
  <div class="center">
    <div style="font-weight:bold; font-size:14px;">${escapeHtml(doc.storeName)}</div>
    ${doc.storeAddress ? `<div>${escapeHtml(doc.storeAddress)}</div>` : ''}
    ${doc.storePhone ? `<div>${escapeHtml(doc.storePhone)}</div>` : ''}
    ${doc.header ? `<div>${escapeHtml(doc.header)}</div>` : ''}
  </div>
  <hr>
  <table>
    <tr><td>Invoice</td><td class="amount">${escapeHtml(doc.invoiceNumber)}</td></tr>
    ${doc.cashierName ? `<tr><td>Cashier</td><td class="amount">${escapeHtml(doc.cashierName)}</td></tr>` : ''}
    ${doc.customerName ? `<tr><td>Customer</td><td class="amount">${escapeHtml(doc.customerName)}</td></tr>` : ''}
    <tr><td colspan="2">${doc.timestamp.slice(0, 19).replace('T', ' ')}</td></tr>
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    ${chargeRows}
    ${doc.discount ? `<tr><td>Discount</td><td class="amount">-${doc.discount.toLocaleString()}</td></tr>` : ''}
    <tr class="total"><td>TOTAL</td><td class="amount">${doc.total.toLocaleString()}</td></tr>
    ${paymentRows}
    ${doc.change > 0 ? `<tr><td>Change</td><td class="amount">${doc.change.toLocaleString()}</td></tr>` : ''}
  </table>
  ${doc.footer ? `<hr><div class="center">${escapeHtml(doc.footer)}</div>` : ''}
</body>
</html>`
}
