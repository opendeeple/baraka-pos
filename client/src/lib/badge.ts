import { code39Svg } from './code39'
import { parseStickerSize } from './labels'

export interface BadgeData {
  storeName: string
  employeeName: string
  position: string
  badgeCode: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 'card' is the standard ID-card size (CR80, 85.6 × 54 mm) for ordinary badge
// holders, printed on an office/card printer. The sticker sizes are for the
// thermal label printer: pure black on white, because a thermal head dithers
// grey borders and colour fills into dotted smudges. Used both for the
// on-screen preview (iframe) and for printing (printer:printBadge), so what's
// previewed is exactly what prints.
/** 'card', or a sticker as "<width>x<height>" in mm. */
export type BadgeSize = string

export const BADGE_PRESETS: BadgeSize[] = ['card', '58x40', '58x30', '60x30', '40x30', '100x60']

export const BADGE_WIDTH_MM = 85.6
export const BADGE_HEIGHT_MM = 54

/** Page size of a badge; an invalid sticker size falls back to the card. */
export function badgeDims(size: BadgeSize): { w: number; h: number } {
  return (size !== 'card' && parseStickerSize(size)) || { w: BADGE_WIDTH_MM, h: BADGE_HEIGHT_MM }
}

export function badgeHtml(b: BadgeData, size: BadgeSize = 'card'): string {
  const sticker = size !== 'card' ? parseStickerSize(size) : null
  return sticker ? stickerHtml(b, sticker) : cardHtml(b)
}

function cardHtml(b: BadgeData): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${BADGE_WIDTH_MM}mm ${BADGE_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; }
    .card {
      width: ${BADGE_WIDTH_MM}mm; height: ${BADGE_HEIGHT_MM}mm;
      border: 0.3mm solid #d4d4d4; border-radius: 3mm; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .store {
      background: #f97316; color: #fff; font-weight: 700; font-size: 3.2mm;
      letter-spacing: 0.3mm; text-transform: uppercase; padding: 2mm 4mm;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .who { flex: 1; padding: 2.5mm 4mm 0; }
    .name { font-weight: 700; font-size: 4.6mm; line-height: 1.15; word-break: break-word; }
    .position { margin-top: 1mm; font-size: 3.4mm; color: #555; }
    .code { padding: 0 4mm 3mm; text-align: center; }
    .code svg { display: block; margin: 0 auto; }
  </style></head><body><div class="card">
    <div class="store">${esc(b.storeName)}</div>
    <div class="who">
      <div class="name">${esc(b.employeeName)}</div>
      <div class="position">${esc(b.position)}</div>
    </div>
    <!-- No human-readable digits under the bars: the code is a sign-in credential,
         so it shouldn't be readable (or typeable) at a glance. -->
    <div class="code">${code39Svg(b.badgeCode, 0.33, 12)}</div>
  </div></body></html>`
}

// Sizes scale from 58×40. A 10-digit Code 39 is ~173 narrow bars wide, so the
// bar width is picked to keep it inside the sticker (0.2 mm floor for scanners).
function stickerScale(w: number, h: number) {
  const k = Math.min(w / 58, h / 40)
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    narrow: r(Math.min(0.375, Math.max(0.2, ((w - 4) / 173) * 0.85))),
    bar: r(Math.max(6, 11 * k)),
    store: r(Math.max(1.8, 2.4 * k)),
    name: r(Math.max(2.6, 3.6 * k)),
    position: r(Math.max(2, 2.6 * k)),
  }
}

function stickerHtml(b: BadgeData, { w, h }: { w: number; h: number }): string {
  const s = stickerScale(w, h)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, 'Segoe UI', sans-serif; }
    .card { width: ${w}mm; height: ${h}mm; padding: 1.2mm 1.5mm; overflow: hidden; display: flex; flex-direction: column; }
    .store { font-size: ${s.store}mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1mm; white-space: nowrap; overflow: hidden; }
    .name { font-size: ${s.name}mm; font-weight: 700; line-height: 1.15; max-height: ${(s.name * 2.35).toFixed(2)}mm; overflow: hidden; margin-top: 0.4mm; }
    .position { font-size: ${s.position}mm; white-space: nowrap; overflow: hidden; }
    .code { margin-top: auto; }
    .code svg { display: block; margin: 0 auto; }
  </style></head><body><div class="card">
    ${b.storeName ? `<div class="store">${esc(b.storeName)}</div>` : ''}
    <div class="name">${esc(b.employeeName)}</div>
    ${b.position ? `<div class="position">${esc(b.position)}</div>` : ''}
    <div class="code">${code39Svg(b.badgeCode, s.narrow, s.bar)}</div>
  </div></body></html>`
}
