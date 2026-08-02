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
