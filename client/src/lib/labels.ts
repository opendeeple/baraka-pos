import { code39Svg } from './code39'
import { ean13CheckDigit, isValidEan13 } from './scaleBarcode'

// Shelf / price labels (Mahsulotlar > Etiketka): product name, price and a
// scannable barcode, one label per page so a label printer feeds exactly one
// sticker each. Printed through the system print dialog (printer:printBadge),
// where the label printer and its stock are picked.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** EAN-13 symbol with the digits under it, sized in millimetres. */
export function ean13Svg(code: string, moduleMm = 0.3, barMm = 14): string {
  if (!isValidEan13(code)) throw new Error(`EAN-13: invalid code ${code}`)
  const first = Number(code[0])
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === 'L' ? L : G)[Number(code[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])]
  bits += '101'
  const quietL = 9, quietR = 7
  const guard = new Set<number>()
  for (const i of [0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]) guard.add(i)
  const textMm = moduleMm * 9
  const height = barMm + textMm
  const rects: string[] = []
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue
    const h = guard.has(i) ? barMm + textMm * 0.55 : barMm
    rects.push(`<rect x="${((quietL + i) * moduleMm).toFixed(3)}" width="${moduleMm.toFixed(3)}" height="${h.toFixed(3)}"/>`)
  }
  const width = (quietL + 95 + quietR) * moduleMm
  const y = (barMm + textMm * 0.9).toFixed(3)
  const fs = (textMm * 0.95).toFixed(3)
  const text = (x: number, s: string, anchor = 'middle') =>
    `<text x="${(x * moduleMm).toFixed(3)}" y="${y}" font-size="${fs}" text-anchor="${anchor}" font-family="Arial, sans-serif">${s}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(3)}mm" height="${height.toFixed(3)}mm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}" shape-rendering="crispEdges" fill="#000">`
    + rects.join('')
    + text(quietL - 1.5, code[0], 'end')
    + text(quietL + 3 + 21, code.slice(1, 7))
    + text(quietL + 50 + 21, code.slice(7, 13))
    + `</svg>`
}

/**
 * The barcode a product's label should carry: EAN-13 as is, a 12-digit UPC-A
 * as its EAN-13 form, any other all-digit code as Code 39; null when the
 * code can't be drawn (letters — scanners on a Russian/Uzbek keyboard layout
 * would read those back wrong anyway).
 */
export function barcodeSvg(code: string | null, moduleMm = 0.3, barMm = 14): string | null {
  if (!code) return null
  if (isValidEan13(code)) return ean13Svg(code, moduleMm, barMm)
  if (/^\d{12}$/.test(code) && isValidEan13(`0${code}`)) return ean13Svg(`0${code}`, moduleMm, barMm)
  if (/^\d{1,20}$/.test(code)) return code39Svg(code, moduleMm, barMm) + `<div class="digits">${code}</div>`
  return null
}

/** A new in-store EAN-13 ("20" + 10 random digits + check) for a product that came without one. */
export function generateInternalBarcode(): string {
  const digits = crypto.getRandomValues(new Uint32Array(10))
  const body = '20' + Array.from(digits, (d) => String(d % 10)).join('')
  return body + ean13CheckDigit(body)
}

export interface LabelItem { name: string; price: number; barcode: string | null; unit: string | null; copies: number }
export type LabelSize = '58x40' | '40x30' | '30x20'

export const LABEL_SIZES: Record<LabelSize, { w: number; h: number; module: number; bar: number; name: number; price: number }> = {
  '58x40': { w: 58, h: 40, module: 0.3, bar: 11, name: 3.4, price: 7 },
  '40x30': { w: 40, h: 30, module: 0.25, bar: 8, name: 2.8, price: 5 },
  '30x20': { w: 30, h: 20, module: 0.2, bar: 6, name: 2.2, price: 3.6 },
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const money = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')

export function labelsHtml(items: LabelItem[], size: LabelSize, opts: { storeName?: string; perKg: string; currency: string }): string {
  const s = LABEL_SIZES[size]
  const pages: string[] = []
  for (const it of items) {
    const svg = barcodeSvg(it.barcode, s.module, s.bar)
    const unit = it.unit === 'kg' ? ` <span class="unit">${esc(opts.perKg)}</span>` : ''
    const page = `<div class="label">
      ${opts.storeName ? `<div class="store">${esc(opts.storeName)}</div>` : ''}
      <div class="name">${esc(it.name)}</div>
      <div class="price">${money(it.price)} <span class="cur">${esc(opts.currency)}</span>${unit}</div>
      ${svg ? `<div class="code">${svg}</div>` : ''}
    </div>`
    for (let i = 0; i < Math.max(1, it.copies); i++) pages.push(page)
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${s.w}mm ${s.h}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, 'Segoe UI', sans-serif; }
    .label { width: ${s.w}mm; height: ${s.h}mm; padding: 1.2mm 1.5mm; overflow: hidden;
      display: flex; flex-direction: column; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .store { font-size: ${(s.name * 0.7).toFixed(2)}mm; color: #333; text-transform: uppercase; letter-spacing: 0.1mm; }
    .name { font-size: ${s.name}mm; font-weight: 700; line-height: 1.15; max-height: ${(s.name * 2.35).toFixed(2)}mm; overflow: hidden; }
    .price { font-size: ${s.price}mm; font-weight: 800; line-height: 1.1; margin-top: auto; white-space: nowrap; }
    .cur, .unit { font-size: ${(s.price * 0.42).toFixed(2)}mm; font-weight: 600; }
    .code { text-align: center; margin-top: 0.6mm; }
    .code svg { display: block; margin: 0 auto; max-width: 100%; }
    .digits { font-size: ${(s.name * 0.75).toFixed(2)}mm; text-align: center; letter-spacing: 0.3mm; }
  </style></head><body>${pages.join('')}</body></html>`
}
