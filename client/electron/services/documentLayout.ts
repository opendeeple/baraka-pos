// The one document layout every customer- and supplier-facing paper or PDF
// uses, modelled on the wholesale delivery note the owner showed us
// ("Отгрузка №… от …"): store name on top, the document number and date, the
// other party, a bordered № / Tovar / Soni / Narx / Summa table whose long
// names wrap inside their column, a Jami row with the total quantity and
// sum, then the store's phone and a thank-you line.
//
// Two renderers of the same content:
//  - thermalItemsTable(): monospace text for the receipt printer, whose
//    driver drops CSS tables and centering (see printer.ipc.ts);
//  - documentPageHtml(): a real HTML table, for the PDFs sent over Telegram.
// No electron imports, so both can be rendered and checked outside the app.

export interface DocItem {
  name: string
  qty: number
  price: number
  /** Line total after discounts; defaults to qty × price. */
  sum?: number
}

export function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Quantities can be weights (1.255 kg), so keep up to 3 decimals. */
export function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fmtDate(value: string | Date): string {
  const d = new Date(value)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function fmtDateTime(value: string | Date): string {
  const d = new Date(value)
  return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const lineSum = (it: DocItem) => it.sum ?? it.qty * it.price

/** Word-wraps to `width` columns; a single word longer than that is split. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (let word of text.trim().split(/\s+/)) {
    while (word.length > width) {
      if (line) { out.push(line); line = '' }
      out.push(word.slice(0, width))
      word = word.slice(width)
    }
    if (!word) continue
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ' ' + word
    else { out.push(line); line = word }
  }
  if (line || out.length === 0) out.push(line)
  return out
}

// ─── Thermal (monospace) ───────────────────────────────────────────────────

export interface TextLine { text: string; bold?: boolean }

const NO_W = 2
const QTY_W = 4
const PRICE_W = 8
const SUM_W = 9
// Narrower than this and names become unreadable — the Narx column is
// dropped instead (Summa still shows what the line cost).
const MIN_NAME_W = 8

// Pads to width; never truncates — a too-long number would lose digits, so
// an overflowing cell only nudges that one row's border instead.
function cell(s: string, w: number, align: 'l' | 'r'): string {
  if (s.length >= w) return s
  const fill = ' '.repeat(w - s.length)
  return align === 'l' ? s + fill : fill + s
}

/**
 * The bordered items table at `width` characters, with a Jami row. Every
 * line is exactly `width` wide (barring an oversized number), so it lines up
 * under one monospace font.
 */
export function thermalItemsTable(items: DocItem[], width: number): TextLine[] {
  const withPrice = width - 6 - NO_W - QTY_W - PRICE_W - SUM_W >= MIN_NAME_W
  const nameW = withPrice
    ? width - 6 - NO_W - QTY_W - PRICE_W - SUM_W
    : Math.max(MIN_NAME_W, width - 5 - NO_W - QTY_W - SUM_W)
  const widths = withPrice ? [NO_W, nameW, QTY_W, PRICE_W, SUM_W] : [NO_W, nameW, QTY_W, SUM_W]
  const aligns: Array<'l' | 'r'> = withPrice ? ['l', 'l', 'r', 'r', 'r'] : ['l', 'l', 'r', 'r']
  const border = (ws: number[]) => '+' + ws.map((w) => '-'.repeat(w)).join('+') + '+'
  const row = (cells: string[], ws = widths, al = aligns) =>
    '|' + cells.map((c, i) => cell(c, ws[i], al[i])).join('|') + '|'
  const pick = (no: string, name: string, qty: string, price: string, sum: string) =>
    withPrice ? [no, name, qty, price, sum] : [no, name, qty, sum]

  const out: TextLine[] = []
  out.push({ text: border(widths) })
  out.push({ text: row(pick('№', 'Tovar', 'Soni', 'Narx', 'Summa')), bold: true })
  out.push({ text: border(widths) })
  items.forEach((it, i) => {
    const names = wrapText(it.name, nameW)
    out.push({ text: row(pick(String(i + 1), names[0], fmtQty(it.qty), fmtMoney(it.price), fmtMoney(lineSum(it)))) })
    for (const more of names.slice(1)) out.push({ text: row(pick('', more, '', '', '')) })
    out.push({ text: border(widths) })
  })

  // Jami spans the № and Tovar columns, the sum spans Narx and Summa; a sum
  // too long even for that borrows room from the Jami cell.
  const totalQty = fmtQty(items.reduce((s, it) => s + it.qty, 0))
  const totalSum = fmtMoney(items.reduce((s, it) => s + lineSum(it), 0))
  const sumW = withPrice ? PRICE_W + 1 + SUM_W : SUM_W
  const borrow = Math.max(0, totalSum.length - sumW)
  const totalWs = [NO_W + 1 + nameW - borrow, QTY_W, sumW + borrow]
  out.push({ text: row(['Jami', totalQty, totalSum], totalWs, ['l', 'r', 'r']), bold: true })
  out.push({ text: border(totalWs) })
  return out
}

// ─── PDF page (HTML) ───────────────────────────────────────────────────────

export interface DocColumn { label: string; align?: 'left' | 'right' | 'center' }

export interface DocTable {
  title?: string
  columns: DocColumn[]
  rows: string[][]
  /** Same length as `columns`; rendered bold under the rows. */
  total?: string[]
}

export interface DocPage {
  storeName: string
  storeAddress?: string | null
  /** e.g. "Chek № BRK-000123 · 05.10.2026 14:32" */
  title: string
  /** Label/value lines under the title — "Mijoz: …". */
  info: Array<[string, string]>
  tables: DocTable[]
  /** Label/value lines under the tables — debt totals and the like. */
  summary: Array<{ label: string; value: string; bold?: boolean }>
  phone?: string | null
  thanks?: string | null
}

/** The standard items table: № / Tovar / Soni / Narx / Summa + Jami. */
export function itemsDocTable(items: DocItem[]): DocTable {
  return {
    columns: [
      { label: '№', align: 'center' }, { label: 'Tovar' }, { label: 'Soni', align: 'center' },
      { label: 'Narx', align: 'right' }, { label: 'Summa', align: 'right' },
    ],
    rows: items.map((it, i) => [String(i + 1), it.name, fmtQty(it.qty), fmtMoney(it.price), fmtMoney(lineSum(it))]),
    total: ['', 'Jami', fmtQty(items.reduce((s, it) => s + it.qty, 0)), '', fmtMoney(items.reduce((s, it) => s + lineSum(it), 0))],
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function documentPageHtml(page: DocPage): string {
  const table = (t: DocTable) => {
    const align = (i: number) => t.columns[i]?.align ?? 'left'
    const td = (v: string, i: number, tag = 'td') => `<${tag} style="text-align:${align(i)}">${esc(v)}</${tag}>`
    return `${t.title ? `<h3>${esc(t.title)}</h3>` : ''}
      <table>
        <thead><tr>${t.columns.map((c, i) => td(c.label, i, 'th')).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => td(v, i)).join('')}</tr>`).join('')}</tbody>
        ${t.total ? `<tfoot><tr>${t.total.map((v, i) => td(v, i)).join('')}</tr></tfoot>` : ''}
      </table>`
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm; }
    body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 12.5px; color: #111; }
    .brand { text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
    .address { text-align: center; color: #444; margin-top: 2px; }
    h2 { font-size: 14px; margin: 22px 0 10px; }
    h3 { font-size: 13px; margin: 18px 0 6px; }
    .info { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #000; padding: 5px 7px; font-weight: 700; vertical-align: middle; }
    th { background: #f2f2f2; }
    tfoot td { font-size: 13.5px; }
    .summary { margin-top: 14px; }
    .summary div { margin: 3px 0; }
    .summary .bold { font-weight: 800; font-size: 14px; }
    .footer { margin-top: 26px; font-weight: 700; }
    .thanks { margin-top: 6px; font-weight: 700; font-style: italic; text-decoration: underline; }
  </style></head><body>
    <div class="brand">${esc(page.storeName)}</div>
    ${page.storeAddress ? `<div class="address">${esc(page.storeAddress)}</div>` : ''}
    <h2>${esc(page.title)}</h2>
    ${page.info.map(([k, v]) => `<div class="info">${esc(k)}: <b>${esc(v)}</b></div>`).join('')}
    ${page.tables.map(table).join('')}
    ${page.summary.length ? `<div class="summary">${page.summary.map((s) =>
      `<div class="${s.bold ? 'bold' : ''}">${esc(s.label)}: ${esc(s.value)}</div>`).join('')}</div>` : ''}
    ${page.phone ? `<div class="footer">Tel: ${esc(page.phone)}</div>` : ''}
    ${page.thanks ? `<div class="thanks">${esc(page.thanks)}</div>` : ''}
  </body></html>`
}

export const THANKS = 'XARIDINGIZ UCHUN RAHMAT'
