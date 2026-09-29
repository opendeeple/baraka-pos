import { code39Svg } from './code39'

export interface BadgeData {
  storeName: string
  employeeName: string
  position: string
  badgeCode: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Standard ID-card size (CR80, 85.6 × 54 mm) so it fits ordinary badge
// holders. Used both for the on-screen preview (iframe) and for printing
// (printer:printBadge), so what's previewed is exactly what prints.
export const BADGE_WIDTH_MM = 85.6
export const BADGE_HEIGHT_MM = 54

export function badgeHtml(b: BadgeData): string {
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
