// Device-independent receipt model. Drivers (Electron escpos today; Android
// network/Bluetooth/Sunmi drivers in the mobile apps) render this to bytes.
export interface ReceiptLine {
  name: string
  quantity: number
  price: number
  discount?: number
}

export interface ReceiptDoc {
  invoiceNumber: string
  storeName: string
  storeAddress?: string | null
  storePhone?: string | null
  cashierName: string
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

/** Plain-text 32/48-col rendering — usable for previews and simple printers. */
export function renderReceiptText(doc: ReceiptDoc, width: 32 | 48 = 32): string {
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
  out.push(divider)
  out.push(line(`Invoice: ${doc.invoiceNumber}`, ''))
  out.push(line(`Cashier: ${doc.cashierName}`, ''))
  out.push(line(doc.timestamp.slice(0, 19).replace('T', ' '), ''))
  out.push(divider)
  for (const item of doc.items) {
    out.push(item.name.slice(0, width))
    const qtyPrice = `${item.quantity} x ${item.price.toLocaleString()}`
    out.push(line(`  ${qtyPrice}`, (item.quantity * item.price).toLocaleString()))
  }
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
