# Sync Protocol v2

Shipped 2026-08-01 as Phase 0 of the Android apps project. Replaces the v1 sync
(`GET/POST /api/sync/*`, global `X-API-Key`), which is deprecated but still
mounted for the transition; remove it once the Electron fleet has updated.

## Identity model

- Every syncable row carries a **`sync_id` UUID**, minted wherever the row is
  born (server, Electron, Android). It is the only sync conflict key — local
  integer PKs never travel over the wire and are never overwritten.
- Clients keep a **`server_id`** column mirroring the server PK (informational
  + one-time v1 reconciliation).
- FKs travel as **`*SyncId`** fields (`sessionSyncId`, `productSyncId`, …) and
  are resolved to integer ids on each side.
- Stock quantities never sync as absolutes — they move as **deltas** (sale
  items, purchase items, signed `quantity_adjustments`).

## Device identity

- `POST /api/devices/register` (JWT, role ≥ manager) → `{deviceId, deviceKey}`.
  The key is returned once and stored bcrypt-hashed (`devices.keyHash`).
- All `/api/sync/v2/*` calls authenticate with `Authorization: Device <id>:<key>`
  (`deviceAuth.middleware.ts`). Store scope always derives from the device row.
- `GET /api/devices` lists, `PUT /api/devices/:id/revoke` revokes.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/sync/v2/pull?table=&cursor=&limit=` | Store-scoped incremental pull. Opaque cursor (`updatedAt\|id`), pages of ≤1000, tombstones included (`deletedAt` set → client deletes). Records carry `id` (server PK), `syncId`, `*SyncId` FKs. `sales` pulls nested `items`/`payments`; the client inserts child rows only when the sale is new locally (sales are immutable facts apart from status flips), so office devices get full local dashboards and POS devices see cross-terminal history without echo duplicates. |
| `POST /api/sync/v2/push` | Generic change batch `{changes:[{table, syncId, op, data, clientUpdatedAt}]}`. Dimension tables use last-writer-wins on `clientUpdatedAt`; facts are insert-only idempotent on `syncId`. Per-change results: `applied \| skipped-stale \| error` (+`serverId`). |
| `POST /api/sync/v2/sales` | Sales batch (complex transaction). Idempotent on `syncId`; resolves `userSyncId`/`sessionSyncId`/`contactSyncId`; stores `deviceId`; clamps stock at 0 (logged discrepancy); broadcasts `sale:completed`/`stock:updated` after commit. |
| `POST /api/sync/v2/invoice-range` | Atomically leases a block of invoice numbers from `store.currentSaleNumber`. Printed offline receipts are final; gaps from wiped devices are accepted. |

After any accepted push the server emits `sync:changed {tables}` to the store's
socket room so peers pull promptly.

### Debt history across devices (2026-10)

Every device shows the same debtor statement (debt sales, repayments, deleted
debts), so three tables travel beyond their origin device:

- `sales` — Electron now pulls it too (Android always did). A sale the device
  already has is never overwritten except for a void (`status='cancelled'`);
  a voided sale (server tombstone) is kept locally as cancelled, not deleted.
  `createdAt` is served as the sale's own time (`saleTime`).
- `cash_logs` — pull serves **only customer repayments** (cash-in `deposit`
  with a contact; desktop pushes its `debt_payment` rows as `deposit`).
  Insert-only on the client: a device's own rows are never rewritten, and
  rows from other terminals carry no local session, so they never enter this
  terminal's drawer totals. `createdAt` is served as `transactionDate`.
- `debt_clearances` — "delete a paid-off debt" is a per-contact cut-off
  (`clearedAt`); debt history shows only rows newer than the latest one.
  Pushed insert-only, pulled insert-only. The server migration seeds one for
  every contact already at 0 balance with debt history, so devices pulling
  old sales don't resurface long-paid debts.

Pull order: contacts before all three. Electron skips `cash_logs` /
`debt_clearances` quietly if an older server answers "Unknown table".

### Purchase orders and receiving (2026-10)

An order is created `pending` (server `draft`) with its lines, printed as an
order slip, and later received line by line into `shop` or `warehouse`.

- `purchases` pull carries the lines (`items`, with `productSyncId` /
  `batchSyncId` / `receivedQuantity` / `discrepancyNote`); the client upserts
  them, adopting server line syncIds by batch for lines pushed by older
  builds. A purchase with a pending or dead outbox row is never overwritten.
- **The server puts received goods into stock**, exactly once, when a push
  moves a purchase into `received` *with* a `receivedLocation`
  (`applyPurchaseReceipt`: stock increment + audit `QuantityAdjustment` +
  batch cost). Older builds send no location and push their own
  `quantity_adjustments`, so for them `received` stays a plain flag.
- A received purchase never reopens. If two devices receive the same order,
  only the first receipt applies; each receipt carries a device-minted
  `receiptId`, and a device that sees a different `receiptId` on pull takes
  back the stock it had added locally.
- The receiving device updates its own stock optimistically (no
  `quantity_adjustments`); peers get the server's figures through
  `product_stocks` after the push's `sync:changed` broadcast.
- Receiving ends with the supplier's invoice: per line the real unit price
  (`unitCost`) and an optional `expiryDate`. The server stores both on the
  line, uses the real price for the weighted-average batch cost, and keeps
  the batch's **nearest** expiry among goods on hand (an earlier date on
  stock already there wins). The header's `totalAmount` becomes what arrived
  at the invoice prices — what the supplier is owed.
- Suppliers are contacts of type `vendor` (`contactSyncId` on the order).
  Paying one settles their received orders oldest first: each order's
  `amountPaid` / `paymentStatus` push with the order (LWW), and the money is
  a `cash_logs` cash-out with source `purchase` (in the till's shift when
  paid from the drawer). What's owed is always computed from the orders,
  never kept as a running balance.

### Integrity round (2026-10)

Stock changes only through documents, and every document says what it is:

- `quantity_adjustments.kind` — `receipt` (delivery without an order),
  `purchase` (server, on receipt), `transfer`, `stocktake`, `writeoff`,
  `sale_void` (server, when a sale turns `cancelled`). There is no free
  "set quantity" anywhere in the apps.
- A **void** is pushed as the sale with `status='cancelled'`; on that
  transition the server undoes it once (`voidSaleEffects`): stock back to the
  shop shelf, the debt off the customer, the cash back out with a cash log.
- **Returns** use the Android convention on every client: negative amounts,
  positive quantities, negative unit prices. The server applies `abs()` to
  quantities, so older desktop returns (negative quantities) also add stock.
- Cash in the drawer is the tendered amount minus change, everywhere
  (server cash logs, reports, the shift's expected cash).
- Store-wide settings (`SHARED_SETTING_KEYS` in `@baraka/shared`: receipt
  text, Telegram/SMS, reminders, owner PIN, scale barcodes), `charges`
  on/off and the store's name/address/phone are pushed and pulled; device
  settings (printer, paper layout, language) stay local.
- `audit_logs` — the journal (voids with reasons, refunds, stocktakes,
  write-offs, price changes, deletions, supplier payments, shift closes) —
  is pushed and pulled insert-only, so every device shows the same journal.
- `expenses` are pulled too (category and date-only `expenseDate`).

### Audit fixes (2026-10-05)

- **Stock never goes below zero, and concurrent moves don't lose each
  other.** Every server-side stock change (sales, voids, adjustments,
  receipts) goes through `applyStockDelta`: the row is locked
  (`SELECT … FOR UPDATE`), the delta applied, the result floored at 0. The
  tills also refuse to sell more than the shelf holds (the cart caps at
  `maxStock`); quick-add enters a product *with* its quantity (a `receipt`
  adjustment).
- **A sale voided before it ever reached the server** (offline) arrives with
  `status='cancelled'`: it's stored tombstoned for history and moves no stock,
  debt or cash.
- **Profit** = Σ(line net of its % and flat discount − cost) − sale discount.
- **Reports** count by `saleTime` (not server arrival) in the store's timezone
  (`Store.timezone`; the column default `'UTC'` means Asia/Tashkent).
- **Supplier payments**: `purchases.amountPaid`/`paymentStatus` are no longer
  accepted from devices. The server allocates each supplier payment — a
  `cash_logs` row, `source='purchase'`, `cash_out`, contact = vendor — over
  that vendor's received orders, oldest first.
- **Back-office-only tables**: `users`, `settings`, `stores`, `charges` are
  refused from `*-pos` devices. `super_admin` can't be set or changed from any
  device, and pushed password hashes are ignored.
- **Telegram chat id** (`contacts.telegramChatId`) syncs: the back office that
  polls the bot pushes it; pulls send it only when known (null = unknown, so a
  device's unpushed copy is never wiped).
- **Pulls wait for pushes**: `product_stocks` (pending sales / adjustments /
  purchases), `contacts` (pending sales / cash_logs) and `purchases` (pending
  cash_logs) are skipped while those are still in the outbox — these tables
  arrive as absolute figures and would overwrite the unsent local change.
- **Cursor overlap**: each pull re-reads the last 5 s before its cursor (rows
  committed late with an older `updatedAt`); empty pages never move the cursor.
- **Targeted pulls**: `sync:changed` names every table a push changed
  (`ALSO_CHANGES`); tills pull only those instead of all fifteen.
- **Device auth** verifies the key with bcrypt once per process, then by
  SHA-256; `lastSeenAt`/`lastPulledAt` are written at most once a minute.
  Back office → Settings → Devices lists and revokes devices.

## Client engine (Electron main: `client/electron/services/sync.service.ts`)

- **Outbox** (`sync_queue_local`): pointer rows `{table_name, op, sync_id}`;
  push payloads are rebuilt from current DB state at flush time
  (`CHANGE_BUILDERS` / `buildSalePayload`). Retry with backoff
  (30s→1m→5m→15m→1h), dead-letter after 10 server-rejections (network errors
  never count), `sync:retryDead` re-queues.
- **Pull** applies pages transactionally, adopts server syncIds into v1-era
  rows by `server_id` match, hard-deletes tombstones, rewires FKs to local ids,
  and persists per-table cursors (`settings.sync_cursor_<table>`).
- **Orphan sweep** after the first full pull: rows whose `server_id` was never
  mentioned are reclassified local-only and enqueued — this finally uploads
  rows the v1 id-collision bug would have silently overwritten.
- **SQLite migrations** are now versioned via `PRAGMA user_version`
  (`db.service.ts`); v2 adds `sync_id`/`server_id`/outbox columns and backfills
  UUIDs in pure SQL.
- Local `users` (employees without a server username) are **not pushed** from
  desktop — a modeling mismatch deferred to the Android office work.

## Testing

- `pnpm --filter server test:syncv2` — live-API suite: auth, scoping,
  pagination, LWW, tombstones, idempotency, disjoint concurrent invoice
  leases, revocation (cleans up after itself; needs dev server + seeded DB).
- `pnpm --filter client test:sync` — headless Electron sync-engine e2e:
  fresh-DB migration → device registration → full pull → local sale →
  flush → server verification (leaves a registered device + synced sale
  behind; dev only).
- `pnpm --filter client test:e2e` — existing Playwright renderer suite
  (mocked `electronAPI`, includes the new sync surface).
