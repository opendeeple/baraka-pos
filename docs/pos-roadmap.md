# POS Feature Roadmap — synthesized from reference-app analysis

Source: deep analysis of tailpos (RN offline POS), Odoo POS, OpenSourcePOS,
NexoPOS, Lakasir, and POS-Awesome (2026-08-02). Shipped items are marked ✅.

## Shipped in this round ✅

- **Full-sale refunds** — `SaleRepository.createReturn` (negative amounts,
  stock restore, cash-out log, debt reversal) + POS Sales History screen with
  a Refund action; server keeps signed debt/stock semantics.
- **Suggested cash denominations** (Lakasir pattern) — total rounded up to
  each banknote, deduped, on the payment screen; plus the existing Exact.
- **Sale-level discount** — numpad modal in the cart, capped at sale total.
- **Advisory stock warning** at add-to-cart (Odoo/OSPOS stance: warn, never
  block) and **low-stock ⚠ indicator** on register tiles (`alert_quantity`).
- **Featured-first product grid** (★) and **Short/Overage** sign-aware label
  at session close.
- **Large-amount fat-finger confirm** on manually keyed payments (Odoo's
  `isOrderValid` guard).
- **Cash in/out ledger during a session** — `cash_logs` is now an
  outbox-synced push table (insert-only fact, like quantity_adjustments):
  `SessionRepository.cashMovement` writes source `deposit`/`withdrawal` rows
  with a reason picklist + note, guarded so cash-out never exceeds drawer
  contents; movements feed `expectedCash` at close on Android **and** desktop
  (`session.ipc.ts` parity). Verified end-to-end on the emulator → Postgres.
- **Debt repayment as a first-class transaction** — the "Customer debt
  payment" cash-in variant carries `contactSyncId`; the client decrements the
  customer's balance locally and the server applies the same decrement on
  sync (verified: 26,000 → 16,000 across devices).

## Next up, ranked by value for a mini-market

1. **X/Z reports.** One aggregate (per-tender totals incl. refunds block,
   discount count+amount, cash movements, per-category quantities, session
   duration, opening/expected/counted/difference) printable mid-shift (X) and
   at close (Z). Odoo `report_sale_details.py` is the content checklist.
2. **Partial line-level refunds with over-refund protection.** Refund lines
   reference the original sale item; cap at `qty − already_refunded`; frozen
   prices. (Current full-sale refund is the v1.)
3. **Per-line edit modal** (tailpos `QuantityModalComponent`): one modal with
   qty / price override / line discount (% and fixed) tabs + shared numpad.
   Never auto-merge a price-overridden line with a normal one (match on
   item **and** price).
4. **Supervisor PIN override with audit trail** (tailpos's best feature):
   `can_approve` on users; discount / void / price-override / refund stash the
   intent, prompt approver PIN, replay, and record `approved_by`.
5. **Per-payment-method blind close** (Odoo/POS-Awesome): counted per tender,
   cash entered blind, manager threshold (`amount_authorized_diff`) gating
   large variances, denomination-count helper, open/close user recorded.
6. **Receipt completeness**: cashier + terminal names, per-payment breakdown +
   change, configurable header/footer + return policy, and a **barcode/QR of
   the sale reference** (scan-to-refund; OSPOS builds its whole return flow
   on this). Reprint counter distinguishes copies.
7. **Quick product / open-price line** from the register (NexoPOS
   `ns_pos_quick_product`) for unbarcoded produce/bread; stock-untracked line.
8. **Qty box beside search + "new line" toggle** (POS-Awesome) — turns
    12× same item into two taps.
9. **Cash rounding to nearest denomination** with the delta booked as an
    explicit adjustment payment row (OSPOS `HALF_FIVE` mode) — needed if
    small notes disappear from circulation.
10. **Scale/weighed-barcode decoding** (prefix + embedded weight/price) when
    a scale enters the picture.

## Patterns adopted as principles (no code change needed)

- Print failures must never block a sale (tailpos does this right; we already
  fire-and-forget).
- Master data is server-authoritative, transactional data is push-only —
  matches our sync v2 split.
- Denormalize name/price/tax onto sale lines at sale time (we already do).
- Never generate receipt numbers from row counts (tailpos bug); our leased
  invoice ranges already solve this.
- Keyboard-wedge scanners need radio/focus arbitration with search fields
  (tailpos `searchStatusChange`) — relevant for the desktop app and any
  Bluetooth HID scanner support later.
