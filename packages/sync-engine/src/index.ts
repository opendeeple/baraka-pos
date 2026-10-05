// Platform-agnostic sync protocol v2 client engine, shared by Electron
// (better-sqlite3 in the main process) and the Android apps (expo-sqlite sync
// API). All platform concerns are injected via SyncEngineDeps.
import { DEFAULT_SERVER_URL, SHARED_SETTING_KEYS } from '@baraka/shared'

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

/** Minimal synchronous SQL surface (better-sqlite3 / expo-sqlite both fit). */
export interface SyncDb {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined
  run(sql: string, params?: unknown[]): { changes: number }
  transaction(fn: () => void): void
}

export interface SyncEngineDeps {
  db: SyncDb
  /** UUIDv4 generator (crypto.randomUUID on Electron, expo-crypto on Android). */
  uuid: () => string
  /** Defaults to global fetch. */
  fetchImpl?: typeof fetch
  log?: (message: string) => void
  /**
   * Settings key holding this app's terminal token. Defaults to
   * 'terminal_token'; the desktop Office app shares the POS app's database
   * and keeps its own token under another key.
   */
  tokenKey?: string
}

export interface PullResult {
  table: string
  count: number
}

export interface FlushResult {
  synced: number
  errors: number
  dead: number
}

/** Order matters: FK targets must sync before their referrers. */
export const PULL_TABLE_ORDER = [
  'stores', 'collections', 'contacts', 'products', 'product_batches',
  'product_stocks', 'charges', 'settings', 'users', 'pos_sessions', 'sales',
  'purchases', 'cash_logs', 'debt_clearances', 'expenses', 'audit_logs',
] as const

// Insert-only facts: a pulled row that already exists locally (usually this
// device's own, pulled back) is left exactly as it is. cash_logs especially:
// the server stores desktop 'debt_payment' rows as 'deposit', and rewriting
// a local row's source would pull it into session cash totals.
const INSERT_ONLY_PULL = new Set(['cash_logs', 'debt_clearances', 'audit_logs'])

// Pulls of these tables wait while the outbox still holds changes to the
// listed tables (see pullTableV2).
const PULL_WAITS_FOR_PUSH: Record<string, string[]> = {
  product_stocks: ['sales', 'quantity_adjustments', 'purchases'],
  contacts: ['sales', 'cash_logs'],
  purchases: ['cash_logs'],
}

const CURSOR_OVERLAP_MS = 5000

/** "<updatedAt ISO>|<id>" moved back by `ms`, from the start of that instant. */
function rewindCursor(cursor: string, ms: number): string {
  const sep = cursor.lastIndexOf('|')
  const date = new Date(sep === -1 ? cursor : cursor.slice(0, sep))
  if (Number.isNaN(date.getTime())) return cursor
  return `${new Date(date.getTime() - ms).toISOString()}|0`
}

// Staff and store-wide configuration: the server only takes these from a
// manager's token (see syncV2.service).
const OFFICE_ONLY_TABLES = new Set(['users', 'settings', 'stores', 'charges'])
const OFFICE_ROLES = new Set(['admin', 'manager', 'super_admin'])

const INVOICE_LEASE_COUNT = 500
const MAX_ATTEMPTS = 10
const BACKOFF_STEPS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000]

/** Local settings keys that server-pulled settings must never clobber. */
const RESERVED_SETTINGS = new Set([
  'server_url', 'sync_api_key', 'store_id', 'terminal_id', 'cached_user',
  'cached_store', 'printer_config', 'terminal_token', 'terminal_token_role',
  'office_token', 'office_token_role',
  'invoice_prefix', 'invoice_range_start', 'invoice_range_end', 'invoice_range_next',
  'v2_backfill_done', 'active_shift', 'pending_shift_ends',
  // Per device: the paper calibration belongs to this till's printer, the
  // language to whoever uses this screen.
  'receipt_layout', 'app_language',
])

const SHARED_SETTINGS = new Set(SHARED_SETTING_KEYS)
const RESERVED_SETTINGS_PREFIXES = ['last_sync_', 'sync_cursor_']

// Pulled records carry *SyncId fields for their FKs; the local row must store
// the LOCAL integer id of the target (already pulled — table order guarantees
// dependencies sync first).
const PULL_FK_MAP: Record<string, Record<string, { table: string; localColumn: string }>> = {
  products: {
    categorySyncId: { table: 'collections', localColumn: 'category_id' },
    brandSyncId: { table: 'collections', localColumn: 'brand_id' },
  },
  product_batches: {
    productSyncId: { table: 'products', localColumn: 'product_id' },
    vendorSyncId: { table: 'contacts', localColumn: 'vendor_id' },
  },
  product_stocks: {
    productSyncId: { table: 'products', localColumn: 'product_id' },
    batchSyncId: { table: 'product_batches', localColumn: 'batch_id' },
  },
  collections: {
    parentSyncId: { table: 'collections', localColumn: 'parent_id' },
  },
  sales: {
    contactSyncId: { table: 'contacts', localColumn: 'contact_id' },
    sessionSyncId: { table: 'pos_sessions', localColumn: 'session_id' },
    referenceSyncId: { table: 'sales', localColumn: 'reference_id' },
  },
  // A repayment taken on another terminal has no local session (session_id
  // stays NULL), so it never enters this device's drawer totals.
  cash_logs: {
    contactSyncId: { table: 'contacts', localColumn: 'contact_id' },
    sessionSyncId: { table: 'pos_sessions', localColumn: 'session_id' },
  },
  debt_clearances: {
    contactSyncId: { table: 'contacts', localColumn: 'contact_id' },
  },
  expenses: {
    sessionSyncId: { table: 'pos_sessions', localColumn: 'session_id' },
  },
}

/** v1-pulled tables eligible for the one-time orphan sweep after a full pull. */
const SWEEP_TABLES = new Set(['products', 'product_batches', 'product_stocks', 'contacts'])

// Generic pushes flush before sales so FK targets (sessions, contacts,
// products) exist server-side by the time their sales arrive. Collections
// flush first — products reference them via categorySyncId/brandSyncId.
const FLUSH_PRIORITY: Record<string, number> = {
  collections: 0, contacts: 1, users: 1, products: 2, product_batches: 3, pos_sessions: 4,
  settings: 1, charges: 1, stores: 1,
  quantity_adjustments: 5, expenses: 6, purchases: 7, cash_logs: 8, debt_clearances: 9, audit_logs: 10, sales: 99,
}

// When a pulled tombstone hard-deletes a row by sync_id, also delete rows in
// these child tables that reference its *local* id. Without this, a deleted
// product's batches/stocks stay behind as orphans, and since products.id is
// a plain INTEGER PRIMARY KEY (not AUTOINCREMENT), SQLite recycles the freed
// id for the next locally-created product — silently attaching it to the
// dead product's old batches/stocks and fanning out into duplicate rows
// wherever products are joined to their active batch.
const CASCADE_ON_DELETE: Record<string, Array<{ table: string; column: string }>> = {
  products: [
    { table: 'product_batches', column: 'product_id' },
    { table: 'product_stocks', column: 'product_id' },
  ],
  product_batches: [
    { table: 'product_stocks', column: 'batch_id' },
  ],
}

class NetworkError extends Error {}

// Render answers 502/503 while it deploys or restarts, and 5xx/429 generally
// say nothing about the row itself — retried like an outage, never counted
// toward the dead-letter limit.
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function coerceSqlValue(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

interface OutboxRow {
  id: number
  table_name: string | null
  entity_type: string
  op: string
  payload: string
  sync_id: string
  attempt_count: number
}

export function createSyncEngine(deps: SyncEngineDeps) {
  const { db, uuid } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const log = deps.log ?? (() => {})
  const tokenKey = deps.tokenKey ?? 'terminal_token'
  const roleKey = `${tokenKey}_role`

  let lastHttpSuccessAt = 0

  // --- settings ------------------------------------------------------------

  function getSetting(key: string, fallback = ''): string {
    const row = db.get<{ meta_value: string }>(
      `SELECT meta_value FROM settings WHERE meta_key=? LIMIT 1`, [key]
    )
    return row?.meta_value ?? fallback
  }

  function setSetting(key: string, value: string): void {
    db.run(
      `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (?, ?, ?, ?)`,
      [Number(getSetting('store_id', '1')), key, value, new Date().toISOString()]
    )
  }

  // A 401 means the server no longer accepts the terminal token (expired, or
  // its user was deactivated). Every retry would fail the same way, so it's
  // dropped: hasTerminalToken() then reports false, sync waits, and the next
  // password sign-in on this device stores a fresh token.
  function clearTerminalTokenOn401(status: number): void {
    if (status !== 401) return
    setSetting(tokenKey, '')
    setSetting(roleKey, '')
  }

  function getServerUrl(): string {
    return getSetting('server_url', DEFAULT_SERVER_URL)
  }

  // --- HTTP (cold-start-aware timeouts for Render free tier) ---------------

  async function httpJson(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; data: any }> {
    const idleMs = Date.now() - lastHttpSuccessAt
    const timeoutMs = idleMs > 10 * 60 * 1000 ? 90_000 : 30_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${getServerUrl()}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      })
      lastHttpSuccessAt = Date.now()
      const data = await response.json().catch(() => ({}))
      return { status: response.status, data }
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'network error')
    } finally {
      clearTimeout(timer)
    }
  }

  function authHeaders(): Record<string, string> {
    const token = getSetting(tokenKey)
    if (!token) throw new Error('Not signed in — sign in with a password while online')
    return { Authorization: `Bearer ${token}` }
  }

  function hasTerminalToken(): boolean {
    return Boolean(getSetting(tokenKey))
  }

  // --- terminal token + invoice range --------------------------------------

  /**
   * Called after every online sign-in on this device: the signed-in user's
   * token becomes the one this device syncs with. It deliberately outlives
   * sign-out (a shift change), so sync and badge sign-in keep working until
   * the token itself expires.
   */
  async function setTerminalToken(token: string, role: string): Promise<void> {
    setSetting(tokenKey, token)
    setSetting(roleKey, role)
    await ensureInvoiceRange().catch(() => {})
  }

  async function ensureInvoiceRange(): Promise<void> {
    const next = Number(getSetting('invoice_range_next', '0'))
    const end = Number(getSetting('invoice_range_end', '-1'))
    const remaining = end - next + 1
    if (end >= 0 && remaining > INVOICE_LEASE_COUNT * 0.2) return

    const { status, data } = await httpJson('POST', '/api/sync/v2/invoice-range', {
      headers: authHeaders(),
      body: { count: INVOICE_LEASE_COUNT },
    })
    if (status !== 200) {
      clearTerminalTokenOn401(status)
      throw new Error(data?.error ?? `invoice-range HTTP ${status}`)
    }
    setSetting('invoice_prefix', data.prefix)
    setSetting('invoice_range_start', String(data.start))
    setSetting('invoice_range_end', String(data.end))
    setSetting('invoice_range_next', String(data.start))
  }

  /**
   * Next invoice number from the leased range, or null when no range is
   * available (never signed in online) — callers fall back to
   * a local placeholder in that case.
   */
  function nextInvoiceNumber(): string | null {
    const prefix = getSetting('invoice_prefix')
    const next = Number(getSetting('invoice_range_next', '0'))
    const end = Number(getSetting('invoice_range_end', '-1'))
    if (!prefix || next > end) return null
    setSetting('invoice_range_next', String(next + 1))
    if (end - next < INVOICE_LEASE_COUNT * 0.2) {
      ensureInvoiceRange().catch(() => {})
    }
    return `${prefix}-${String(next).padStart(6, '0')}`
  }

  // --- pull ----------------------------------------------------------------

  function isReservedSettingKey(key: string): boolean {
    return RESERVED_SETTINGS.has(key) || RESERVED_SETTINGS_PREFIXES.some((p) => key.startsWith(p))
  }

  function lookupIdBySyncId(table: string, syncId: unknown): number | null {
    if (!syncId || typeof syncId !== 'string') return null
    const row = db.get<{ id: number }>(`SELECT id FROM ${table} WHERE sync_id=?`, [syncId])
    return row?.id ?? null
  }

  /**
   * Nested items/payments for a pulled sale. Inserted only when the sale has
   * no local children yet (fresh replica) — sales are immutable facts apart
   * from status flips, and locally-created sales already own their child rows.
   */
  function upsertSaleChildren(record: Record<string, unknown>, syncId: string): void {
    const sale = db.get<{ id: number; contact_id: number | null; session_id: number | null }>(
      `SELECT id, contact_id, session_id FROM sales WHERE sync_id=?`, [syncId]
    )
    if (!sale) return

    const items = Array.isArray(record.items) ? (record.items as Array<Record<string, unknown>>) : []
    const hasItems = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?`, [sale.id])
    if (items.length && !hasItems?.n) {
      for (const item of items) {
        db.run(
          `INSERT INTO sale_items (sale_id, item_type, product_id, batch_id, charge_id, description, quantity, free_quantity, unit_price, unit_cost, discount, flat_discount, is_free, notes, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            sale.id, item.itemType ?? 'product',
            lookupIdBySyncId('products', item.productSyncId),
            lookupIdBySyncId('product_batches', item.batchSyncId),
            null, item.description ?? '',
            coerceSqlValue(item.quantity), coerceSqlValue(item.freeQuantity ?? 0),
            coerceSqlValue(item.unitPrice), coerceSqlValue(item.unitCost ?? 0),
            coerceSqlValue(item.discount ?? 0), coerceSqlValue(item.flatDiscount ?? 0),
            item.isFree ? 1 : 0, item.notes ?? null, coerceSqlValue(item.createdAt),
          ]
        )
      }
    }

    const payments = Array.isArray(record.payments) ? (record.payments as Array<Record<string, unknown>>) : []
    const hasPays = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payment_transactions WHERE sale_id=?`, [sale.id])
    if (payments.length && !hasPays?.n) {
      for (const pay of payments) {
        db.run(
          `INSERT INTO payment_transactions (sale_id, store_id, contact_id, session_id, transaction_date, amount, payment_method, transaction_type, charge_state, payment_terminal_ref, note, created_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'synced')`,
          [
            sale.id, coerceSqlValue(pay.storeId),
            lookupIdBySyncId('contacts', pay.contactSyncId) ?? sale.contact_id,
            sale.session_id,
            coerceSqlValue(pay.transactionDate), coerceSqlValue(pay.amount),
            pay.paymentMethod, pay.transactionType ?? 'sale',
            pay.chargeState ?? 'FULLY_CHARGED', pay.paymentTerminalRef ?? null,
            pay.note ?? null, coerceSqlValue(pay.createdAt),
          ]
        )
      }
    }
  }

  /**
   * Purchase orders travel with their lines (received quantities included),
   * so an order placed on one device can be received on another. A device's
   * own unsent edit — an order created or received offline — wins until its
   * push lands; the next pull then brings the server's settled copy.
   */
  function upsertPurchase(record: Record<string, unknown>, syncId: string, serverId: number): void {
    // 'dead' too: a dead-lettered receipt is retried on the next app start,
    // and overwriting it meanwhile would show the order as waiting again.
    if (db.get(`SELECT 1 AS x FROM sync_queue_local WHERE sync_id=? AND status IN ('pending','dead')`, [syncId])) return
    const existing = db.get<{ id: number; receipt_id: string | null; received_location: string | null }>(
      `SELECT id, receipt_id, received_location FROM purchases WHERE sync_id=?`, [syncId]
    )
    if (record.deletedAt) {
      if (existing) db.run(`UPDATE purchases SET deleted_at=?, server_id=? WHERE id=?`, [coerceSqlValue(record.deletedAt), serverId, existing.id])
      return
    }

    // This device received the order too, but the server applied another
    // device's receipt (a different receiptId): the goods this device added
    // to its own stock when receiving were never counted — take them back.
    // The winning receipt's stock arrives through the product_stocks pull.
    if (existing?.receipt_id && record.receiptId && record.receiptId !== existing.receipt_id && existing.received_location) {
      const mine = db.all<{ product_id: number; batch_id: number | null; received_quantity: number | null }>(
        `SELECT product_id, batch_id, received_quantity FROM purchase_items WHERE purchase_id=?`, [existing.id]
      )
      for (const item of mine) {
        if (!item.batch_id || !item.received_quantity) continue
        db.run(
          `UPDATE product_stocks SET quantity = quantity - ?, updated_at = ?
           WHERE id = (SELECT id FROM product_stocks WHERE product_id=? AND batch_id=? AND location=? ORDER BY id DESC LIMIT 1)`,
          [Number(item.received_quantity), new Date().toISOString(), item.product_id, item.batch_id, existing.received_location]
        )
      }
      log(`[syncV2] purchase ${syncId}: receipt lost to another device, local stock reverted`)
    }

    // Local convention: an open order is 'pending' (the server calls it 'draft').
    const status = record.status === 'draft' || !record.status ? 'pending' : String(record.status)
    const header = [
      lookupIdBySyncId('contacts', record.contactSyncId), record.referenceNo ?? null, record.note ?? null,
      coerceSqlValue(record.totalAmount ?? 0), status, coerceSqlValue(record.updatedAt),
      record.receivedLocation ?? null, coerceSqlValue(record.receivedAt), record.receiptId ?? null,
      coerceSqlValue(record.amountPaid ?? 0), (record.paymentStatus as string) ?? 'pending', serverId,
    ]
    let purchaseId: number
    if (existing) {
      db.run(
        `UPDATE purchases SET vendor_id=?, reference_number=?, note=?, total_amount=?, status=?, updated_at=?,
           received_location=?, received_at=?, receipt_id=?, amount_paid=?, payment_status=?, server_id=? WHERE id=?`,
        [...header, existing.id]
      )
      purchaseId = existing.id
    } else {
      db.run(
        `INSERT INTO purchases (vendor_id, reference_number, note, total_amount, status, updated_at,
           received_location, received_at, receipt_id, amount_paid, payment_status, server_id, sync_id, store_id, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [...header, syncId, coerceSqlValue(record.storeId), coerceSqlValue(record.createdBy), coerceSqlValue(record.createdAt)]
      )
      purchaseId = db.get<{ id: number }>(`SELECT id FROM purchases WHERE sync_id=?`, [syncId])!.id
    }

    const items = Array.isArray(record.items) ? (record.items as Array<Record<string, unknown>>) : []
    const serverItemIds = new Set(items.map((i) => i.syncId as string).filter(Boolean))
    for (const item of items) {
      const batchId = lookupIdBySyncId('product_batches', item.batchSyncId)
      const productId = lookupIdBySyncId('products', item.productSyncId)
        ?? (batchId ? db.get<{ product_id: number }>(`SELECT product_id FROM product_batches WHERE id=?`, [batchId])?.product_id ?? null : null)
      if (!productId) continue // purchase_items.product_id is NOT NULL
      const itemSyncId = item.syncId as string
      // Lines pushed by older builds have no sync_id locally (or one the
      // server never saw) — adopt the server's by matching the batch.
      let local = db.get<{ id: number }>(`SELECT id FROM purchase_items WHERE sync_id=?`, [itemSyncId])
      if (!local && batchId) {
        local = db
          .all<{ id: number; sync_id: string | null }>(
            `SELECT id, sync_id FROM purchase_items WHERE purchase_id=? AND batch_id=? ORDER BY id`, [purchaseId, batchId]
          )
          .find((c) => !c.sync_id || !serverItemIds.has(c.sync_id))
      }
      const qty = Number(item.quantity ?? 0)
      const cost = Number(item.unitCost ?? 0)
      const values = [
        productId, batchId, qty, cost, qty * cost,
        item.receivedQuantity == null ? null : Number(item.receivedQuantity),
        item.discrepancyNote ?? null, item.expiryDate ? String(coerceSqlValue(item.expiryDate)).slice(0, 10) : null, itemSyncId,
      ]
      if (local) {
        db.run(
          `UPDATE purchase_items SET product_id=?, batch_id=?, quantity=?, unit_cost=?, total_cost=?,
             received_quantity=?, discrepancy_note=?, expiry_date=?, sync_id=? WHERE id=?`,
          [...values, local.id]
        )
      } else {
        db.run(
          `INSERT INTO purchase_items (product_id, batch_id, quantity, unit_cost, total_cost,
             received_quantity, discrepancy_note, expiry_date, sync_id, purchase_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [...values, purchaseId, coerceSqlValue(item.createdAt)]
        )
      }
    }
  }

  function upsertStore(record: Record<string, unknown>): void {
    const updated = db.run(
      `UPDATE stores SET name=?, address=?, phone=?, sale_prefix=?, current_sale_number=?, updated_at=?, server_id=? WHERE server_id=? OR id=?`,
      [
        record.name, record.address ?? null, record.phone ?? null, record.salePrefix ?? 'INV',
        record.currentSaleNumber ?? 0, coerceSqlValue(record.updatedAt), record.id,
        record.id, record.id,
      ]
    )
    if (updated.changes === 0) {
      db.run(
        `INSERT INTO stores (name, address, phone, sale_prefix, current_sale_number, updated_at, server_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          record.name, record.address ?? null, record.phone ?? null, record.salePrefix ?? 'INV',
          record.currentSaleNumber ?? 0, coerceSqlValue(record.updatedAt), record.id,
        ]
      )
    }
  }

  function upsertPulledRecords(table: string, records: Record<string, unknown>[]): Set<string> {
    const pulledSyncIds = new Set<string>()
    if (!records.length) return pulledSyncIds

    const colInfo = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
    const localCols = new Set(colInfo.map((c) => c.name))
    const fkMap = PULL_FK_MAP[table] ?? {}

    db.transaction(() => {
      for (const record of records) {
        const syncId = record.syncId as string | undefined
        const serverId = record.id as number

        if (table === 'stores') {
          upsertStore(record)
          continue
        }
        if (table === 'settings') {
          const key = record.metaKey as string
          if (!key || isReservedSettingKey(key)) continue
          if (record.deletedAt) continue
          db.run(
            `INSERT INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (?,?,?,?)
             ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value, updated_at=excluded.updated_at`,
            [coerceSqlValue(record.storeId), key, coerceSqlValue(record.metaValue), coerceSqlValue(record.updatedAt)]
          )
          continue
        }

        if (!syncId) continue
        pulledSyncIds.add(syncId)

        // Adoption: a v1-era row that mirrored this server row (server_id
        // match) still has its migration-generated placeholder sync_id — adopt
        // the server's authoritative syncId so the upsert below hits that row.
        db.run(
          `UPDATE ${table} SET sync_id=? WHERE server_id=? AND sync_id<>?
           AND NOT EXISTS (SELECT 1 FROM ${table} t2 WHERE t2.sync_id=?)`,
          [syncId, serverId, syncId, syncId]
        )

        if (table === 'purchases') {
          upsertPurchase(record, syncId, serverId)
          continue
        }

        // A voided sale is tombstoned server-side. Keep it (and its items and
        // payments) as cancelled instead of deleting it: sale history and
        // debt statements still show it, and reports already skip cancelled.
        if (table === 'sales' && record.deletedAt) {
          db.run(
            `UPDATE sales SET status='cancelled', deleted_at=?, server_id=?, sync_status='synced' WHERE sync_id=?`,
            [coerceSqlValue(record.deletedAt), serverId, syncId]
          )
          continue
        }

        // Sales are immutable facts apart from a void. One this device already
        // has (usually its own, pulled back) keeps its local row: a full
        // overwrite would swap local conventions (time-only sale_time, local
        // created_at, a local 'refunded' flag) for the server's copy.
        if (table === 'sales' && db.get(`SELECT 1 AS x FROM sales WHERE sync_id=?`, [syncId])) {
          db.run(
            `UPDATE sales SET server_id=?, sync_status='synced'${record.status === 'cancelled' ? ", status='cancelled'" : ''} WHERE sync_id=?`,
            [serverId, syncId]
          )
          upsertSaleChildren(record, syncId)
          continue
        }

        // Tombstone: the row is gone on the server. Cascade to children that
        // reference this row's *local* id — products.id is a plain INTEGER
        // PRIMARY KEY (not AUTOINCREMENT), so SQLite recycles a freed id for
        // the next locally-created row. Leaving orphaned product_batches /
        // product_stocks behind meant a later product silently "inherited"
        // a deleted product's old batches, fanning out into duplicate rows
        // wherever products are joined to their active batch.
        if (record.deletedAt) {
          const cascades = CASCADE_ON_DELETE[table]
          if (cascades) {
            const row = db.get<{ id: number }>(`SELECT id FROM ${table} WHERE sync_id=?`, [syncId])
            if (row) {
              for (const { table: childTable, column } of cascades) {
                db.run(`DELETE FROM ${childTable} WHERE ${column}=?`, [row.id])
              }
            }
          }
          db.run(`DELETE FROM ${table} WHERE sync_id=?`, [syncId])
          continue
        }

        const entries: Array<[string, unknown]> = []
        for (const [k, v] of Object.entries(record)) {
          if (k === 'id' || k === 'syncId' || Array.isArray(v)) continue
          if (k in fkMap) {
            const { table: fkTable, localColumn } = fkMap[k]
            if (localCols.has(localColumn)) entries.push([localColumn, lookupIdBySyncId(fkTable, v)])
            continue
          }
          const col = camelToSnake(k)
          // Raw server integer FKs mean nothing locally — FK columns are only
          // written via their *SyncId counterparts above.
          if (Object.values(fkMap).some((m) => m.localColumn === col)) continue
          if (localCols.has(col)) entries.push([col, coerceSqlValue(v)])
        }
        // contact_id is NOT NULL there; a clearance for a contact deleted on
        // this device has nothing left to apply to.
        if (table === 'debt_clearances' && !entries.some(([k, v]) => k === 'contact_id' && v != null)) continue
        if (table === 'product_stocks') {
          const pid = entries.find(([k]) => k === 'product_id')?.[1]
          const bid = entries.find(([k]) => k === 'batch_id')?.[1]
          // Stock of a product/batch this device doesn't have (deleted, or
          // never synced) has nothing to attach to — storing it with NULL
          // links only left orphan rows behind.
          if (pid == null || bid == null) continue
          const loc = (entries.find(([k]) => k === 'location')?.[1] as string | undefined) ?? 'shop'
          // One row per product+batch+location. A row this device created
          // itself (its own sync_id) is the same stock: it adopts the
          // server's identity instead of becoming a duplicate next to it.
          if (!db.get(`SELECT 1 AS x FROM product_stocks WHERE sync_id=?`, [syncId])) {
            db.run(
              `UPDATE product_stocks SET sync_id=? WHERE id = (
                 SELECT MAX(id) FROM product_stocks WHERE product_id=? AND batch_id=? AND COALESCE(location,'shop')=?)`,
              [syncId, pid, bid, loc]
            )
          }
          db.run(
            `DELETE FROM product_stocks WHERE product_id=? AND batch_id=? AND COALESCE(location,'shop')=? AND sync_id<>?`,
            [pid, bid, loc, syncId]
          )
        }
        entries.push(['sync_id', syncId])
        entries.push(['server_id', serverId])
        if (table === 'expenses') {
          // Devices keep expense_date date-only and call the category
          // `category`; servers before the 2026-10 mapping sent `source` and a
          // full timestamp — normalised either way.
          const date = entries.find(([k]) => k === 'expense_date')
          if (date && typeof date[1] === 'string') date[1] = date[1].slice(0, 10)
          if (!entries.some(([k]) => k === 'category') && typeof record.source === 'string') entries.push(['category', record.source])
        }
        if (table === 'sales') {
          // A sale present in a pull is on the server by definition.
          entries.push(['sync_status', 'synced'])
          // Local convention stores sale_date as date-only; the server sends a
          // full ISO timestamp, which would break `sale_date = ?` report filters.
          const saleDate = entries.find(([k]) => k === 'sale_date')
          if (saleDate && typeof saleDate[1] === 'string') saleDate[1] = saleDate[1].slice(0, 10)
        }

        const keys = entries.map(([k]) => k)
        const values = entries.map(([, v]) => v)
        const updates = keys.filter((k) => k !== 'sync_id').map((k) => `${k}=excluded.${k}`).join(', ')
        db.run(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})
           ON CONFLICT(sync_id) DO ${INSERT_ONLY_PULL.has(table) ? 'NOTHING' : `UPDATE SET ${updates}`}`,
          values
        )

        if (table === 'sales') upsertSaleChildren(record, syncId)
      }
    })
    return pulledSyncIds
  }

  async function pullTableV2(table: string): Promise<PullResult> {
    // These tables arrive as absolute figures. While this device still has
    // unsent changes that move them (a sale's stock and debt, a repayment, a
    // supplier payment), pulling would overwrite the local figure with the
    // server's older one until the push lands — the pull waits a cycle.
    const blockers = PULL_WAITS_FOR_PUSH[table]
    if (blockers) {
      const marks = blockers.map(() => '?').join(',')
      const pending = db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_queue_local
         WHERE status='pending' AND COALESCE(table_name, CASE entity_type WHEN 'sale' THEN 'sales' ELSE entity_type END) IN (${marks})`,
        blockers
      )
      if (pending && pending.c > 0) {
        log(`[syncV2] ${table}: pull deferred, ${pending.c} local change(s) not pushed yet`)
        return { table, count: 0 }
      }
    }
    // Self-heal rows written before sale_date normalization existed (pulled
    // sales briefly stored full ISO timestamps, breaking `sale_date = ?`
    // report filters). Idempotent and cheap at POS scale.
    if (table === 'sales') {
      db.run(`UPDATE sales SET sale_date = substr(sale_date, 1, 10) WHERE length(sale_date) > 10`)
    }
    const cursorKey = `sync_cursor_${table}`
    let cursor = getSetting(cursorKey)
    const isInitialFullPull = !cursor
    // A row can commit with an updatedAt a little older than the newest one
    // already pulled (its transaction started first); re-reading the last few
    // seconds catches it. Upserts are idempotent, so the overlap is harmless.
    if (cursor) cursor = rewindCursor(cursor, CURSOR_OVERLAP_MS)
    const allPulled = new Set<string>()
    let total = 0

    for (let page = 0; page < 200; page++) {
      const params = new URLSearchParams({ table, limit: '500' })
      if (cursor) params.set('cursor', cursor)
      const { status, data } = await httpJson('GET', `/api/sync/v2/pull?${params}`, {
        headers: authHeaders(),
      })
      if (status !== 200) {
        clearTerminalTokenOn401(status)
        throw new Error(data?.error ?? `Pull ${table}: HTTP ${status}`)
      }

      const pulled = upsertPulledRecords(table, data.records as Record<string, unknown>[])
      pulled.forEach((s) => allPulled.add(s))
      total += data.records.length

      // Persist the cursor only after the page is applied — crash-safe resume.
      // An empty page echoes the (rewound) cursor back; keeping that would
      // walk the cursor further back on every quiet pull.
      if (data.nextCursor && data.records.length > 0) {
        cursor = data.nextCursor
        setSetting(cursorKey, cursor)
      }
      if (!data.hasMore) break
    }

    if (isInitialFullPull) {
      sweepOrphansAfterFullPull(table, allPulled)
    }

    return { table, count: total }
  }

  /**
   * One-time reconciliation after the first full v2 pull of a table: any local
   * row still claiming a server_id that the full pull never mentioned is a
   * v1-era collision artifact (a locally-created row that happened to share a
   * server row's integer id). Reclassify it as local-only and enqueue it for
   * push so it is finally uploaded instead of silently overwritten.
   */
  function sweepOrphansAfterFullPull(table: string, pulledSyncIds: Set<string>): void {
    if (!SWEEP_TABLES.has(table)) return
    const rows = db.all<{ id: number; sync_id: string }>(
      `SELECT id, sync_id FROM ${table} WHERE server_id IS NOT NULL`
    )
    const orphans = rows.filter((r) => !pulledSyncIds.has(r.sync_id))
    if (!orphans.length) return

    db.transaction(() => {
      for (const orphan of orphans) {
        db.run(`UPDATE ${table} SET server_id=NULL WHERE id=?`, [orphan.id])
        if (table === 'product_stocks') {
          // Stocks are not directly pushable — their content travels as a
          // quantity_adjustments delta instead.
          const stock = db.get<{ quantity: number; product_id: number; batch_id: number }>(
            `SELECT quantity, product_id, batch_id FROM product_stocks WHERE id=?`, [orphan.id]
          )
          if (stock && stock.quantity) {
            enqueueOutbox('quantity_adjustments', uuid(), 'upsert', {
              inline: {
                previousQuantity: 0,
                adjustedQuantity: stock.quantity,
                reason: 'v1→v2 reconciliation (locally-created stock)',
                productLocalId: stock.product_id,
                batchLocalId: stock.batch_id,
              },
            })
          }
        } else {
          enqueueOutbox(table, orphan.sync_id, 'upsert')
        }
      }
    })
    log(`[syncV2] ${table}: reclassified ${orphans.length} orphan row(s) as local-only`)
  }

  // --- outbox --------------------------------------------------------------

  function enqueueOutbox(
    table: string,
    syncId: string,
    op: 'upsert' | 'delete',
    payload: Record<string, unknown> | null = null
  ): void {
    // One live outbox row per entity: re-editing before a flush replaces it.
    const existing = db.get<{ id: number }>(
      `SELECT id FROM sync_queue_local WHERE sync_id=? AND status='pending'`, [syncId]
    )
    if (existing) {
      db.run(`UPDATE sync_queue_local SET op=?, payload=? WHERE id=?`, [
        op, JSON.stringify(payload ?? {}), existing.id,
      ])
      return
    }
    db.run(
      `INSERT INTO sync_queue_local (entity_type, table_name, op, payload, sync_id, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        table === 'sales' ? 'sale' : table, table, op,
        JSON.stringify(payload ?? {}), syncId, new Date().toISOString(),
      ]
    )
  }

  function backoffMs(attempt: number): number {
    return BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)]
  }

  function scheduleRetry(row: OutboxRow, error: string, countAttempt: boolean): void {
    const attempts = row.attempt_count + (countAttempt ? 1 : 0)
    if (countAttempt && attempts >= MAX_ATTEMPTS) {
      db.run(`UPDATE sync_queue_local SET status='dead', attempt_count=?, last_error=? WHERE id=?`, [
        attempts, error, row.id,
      ])
      return
    }
    const nextRetry = new Date(Date.now() + backoffMs(attempts)).toISOString()
    db.run(`UPDATE sync_queue_local SET attempt_count=?, next_retry_at=?, last_error=? WHERE id=?`, [
      attempts, nextRetry, error, row.id,
    ])
  }

  function markSynced(rowId: number): void {
    db.run(`UPDATE sync_queue_local SET status='synced', synced_at=? WHERE id=?`, [
      new Date().toISOString(), rowId,
    ])
  }

  /** Re-queue dead-lettered rows (manual retry from the sync UI). */
  function retryDeadLetters(): number {
    return db.run(
      `UPDATE sync_queue_local SET status='pending', attempt_count=0, next_retry_at=NULL WHERE status='dead'`
    ).changes
  }

  /**
   * App start: every unsent row gets another chance right away. Dead letters
   * included — nothing surfaces them in the UI, and their cause (an old server
   * build, a server-side bug since fixed) has often gone away by the next
   * start; a row that is truly bad just dead-letters again.
   */
  function requeueOnStartup(): number {
    retryDeadLetters()
    return db.run(`UPDATE sync_queue_local SET next_retry_at=NULL WHERE status='pending'`).changes
  }

  // --- payload builders (flush-time: always reflect current DB state) ------

  function userSyncIdForLocalRef(userId: unknown): string | undefined {
    if (!userId) return undefined
    // Session/sale user_id conventionally holds the SERVER user id (it comes
    // from the login response); local employee rows are matched by id second.
    const byServer = db.get<{ sync_id: string }>(`SELECT sync_id FROM users WHERE server_id=?`, [userId])
    if (byServer?.sync_id) return byServer.sync_id
    const byLocal = db.get<{ sync_id: string }>(`SELECT sync_id FROM users WHERE id=?`, [userId])
    return byLocal?.sync_id
  }

  function syncIdForLocalId(table: string, localId: unknown): string | null {
    if (!localId) return null
    const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM ${table} WHERE id=?`, [localId])
    return row?.sync_id ?? null
  }

  type ChangeBuilder = (row: OutboxRow) => Record<string, unknown> | null

  const CHANGE_BUILDERS: Record<string, ChangeBuilder> = {
    collections: ({ sync_id }) => {
      // Read regardless of op: on delete the row is already soft-deleted
      // locally (deleted_at set, not removed) so it is still here to build
      // the last-known field values the outbox op='delete' will discard.
      const c = db.get<any>(`SELECT * FROM collections WHERE sync_id=?`, [sync_id])
      if (!c) return null
      return {
        collectionType: c.collection_type ?? 'category',
        name: c.name,
        description: c.description,
        sortOrder: c.sort_order ?? 0,
        parentSyncId: syncIdForLocalId('collections', c.parent_id),
        _updatedAt: c.updated_at,
      }
    },
    contacts: ({ sync_id }) => {
      const c = db.get<any>(`SELECT * FROM contacts WHERE sync_id=?`, [sync_id])
      if (!c) return null
      // balance/loyalty are server-accumulated (debt-sale pushes increment
      // them there); pushing absolutes would double-count.
      return {
        name: c.name, email: c.email, phone: c.phone, address: c.address,
        type: c.type, notes: c.notes,
        // Learnt by the back office that polls the Telegram bot; shared so
        // every till can message the customer. The server only ever fills it.
        telegramChatId: c.telegram_chat_id ?? undefined,
        _updatedAt: c.updated_at,
      }
    },
    products: ({ sync_id }) => {
      const p = db.get<any>(`SELECT * FROM products WHERE sync_id=?`, [sync_id])
      if (!p) return null
      return {
        name: p.name, description: p.description, sku: p.sku, barcode: p.barcode,
        imageUrl: p.image_url, unit: p.unit, unitsPerPackage: p.units_per_package,
        productType: p.product_type,
        isStockManaged: Boolean(p.is_stock_managed), isActive: Boolean(p.is_active),
        isFeatured: Boolean(p.is_featured), alertQuantity: p.alert_quantity,
        discount: p.discount,
        categorySyncId: syncIdForLocalId('collections', p.category_id),
        brandSyncId: syncIdForLocalId('collections', p.brand_id),
        _updatedAt: p.updated_at,
      }
    },
    product_batches: ({ sync_id }) => {
      const b = db.get<any>(`SELECT * FROM product_batches WHERE sync_id=?`, [sync_id])
      if (!b) return null
      const productSyncId = syncIdForLocalId('products', b.product_id)
      if (!productSyncId) return null
      return {
        productSyncId,
        vendorSyncId: syncIdForLocalId('contacts', b.vendor_id),
        batchNumber: b.batch_number, expiryDate: b.expiry_date, cost: b.cost,
        price: b.price, discount: b.discount, isActive: Boolean(b.is_active),
        isFeatured: Boolean(b.is_featured), _updatedAt: b.updated_at,
      }
    },
    users: ({ sync_id }) => {
      const u = db.get<any>(`SELECT * FROM users WHERE sync_id=?`, [sync_id])
      if (!u) return null
      return {
        name: u.name, email: u.email, role: u.role ?? 'cashier',
        // Omitted rather than null when unset: the desktop edit form doesn't
        // round-trip the PIN, so null here would wipe a server-side PIN.
        pinCode: u.pin_code ?? undefined,
        badgeCode: u.badge_code ?? undefined,
        isActive: Boolean(u.is_active),
        _updatedAt: u.updated_at,
      }
    },
    pos_sessions: ({ sync_id }) => {
      const s = db.get<any>(`SELECT * FROM pos_sessions WHERE sync_id=?`, [sync_id])
      if (!s) return null
      const userSyncId = userSyncIdForLocalRef(s.user_id)
      if (!userSyncId) return null // retried once users have been pulled
      return {
        userSyncId, terminalId: s.terminal_id, state: s.state,
        openingBalance: s.opening_balance,
        closingBalanceTheoretical: s.closing_balance_theoretical,
        closingBalanceActual: s.closing_balance_actual,
        variance: s.variance, openedAt: s.opened_at, closedAt: s.closed_at,
        _updatedAt: s.updated_at,
      }
    },
    expenses: ({ sync_id }) => {
      const e = db.get<any>(`SELECT * FROM expenses WHERE sync_id=?`, [sync_id])
      if (!e) return null
      // expense_date is stored date-only ("YYYY-MM-DD"); the server's field is
      // a full DateTime and rejects a bare date with a Prisma validation error.
      const expenseDate = String(e.expense_date).includes('T')
        ? e.expense_date
        : `${e.expense_date}T00:00:00.000Z`
      return {
        description: e.description, amount: e.amount, expenseDate,
        source: e.category ?? e.source ?? null, createdBy: e.created_by,
        sessionSyncId: syncIdForLocalId('pos_sessions', e.session_id),
        _updatedAt: e.updated_at,
      }
    },
    purchases: ({ sync_id }) => {
      const p = db.get<any>(`SELECT * FROM purchases WHERE sync_id=?`, [sync_id])
      if (!p) return null
      const items = db.all<any>(
        `SELECT pi.*, b.sync_id AS batch_sync_id, pr.sync_id AS product_sync_id, pr.name AS product_name FROM purchase_items pi
         LEFT JOIN product_batches b ON b.id = pi.batch_id
         LEFT JOIN products pr ON pr.id = pi.product_id
         WHERE pi.purchase_id=?`,
        [p.id]
      )
      const statusMap: Record<string, string> = { pending: 'draft', received: 'received', partial: 'partial' }
      return {
        contactSyncId: syncIdForLocalId('contacts', p.vendor_id),
        referenceNo: p.reference_number, totalAmount: p.total_amount ?? 0,
        status: statusMap[p.status] ?? 'draft', note: p.note, createdBy: p.created_by,
        // Present once received through the checklist: the server then puts
        // the goods into stock itself (once), so no quantity_adjustments.
        receivedLocation: p.received_location ?? undefined,
        receivedAt: p.received_at ?? undefined,
        receivedBy: p.received_by ?? undefined,
        receiptId: p.receipt_id ?? undefined,
        // Not amount_paid: the server works it out from the supplier payments
        // themselves (cash_logs, source 'purchase') — an absolute figure from
        // two paying devices would overwrite one payment with the other.
        items: items.map((i) => ({
          syncId: i.sync_id ?? undefined,
          batchSyncId: i.batch_sync_id,
          productSyncId: i.product_sync_id,
          description: i.product_name ?? '',
          quantity: i.quantity ?? 0,
          unitPrice: i.unit_cost ?? 0,
          unitCost: i.unit_cost ?? 0,
          receivedQuantity: i.received_quantity ?? undefined,
          discrepancyNote: i.discrepancy_note ?? undefined,
          // Read by the server when it applies the receipt: the expiry date
          // written on this delivery (see applyPurchaseReceipt).
          expiryDate: i.expiry_date ?? undefined,
        })),
        _updatedAt: p.updated_at,
      }
    },
    cash_logs: ({ sync_id }) => {
      const c = db.get<any>(`SELECT * FROM cash_logs WHERE sync_id=?`, [sync_id])
      if (!c) return null
      const sessionSyncId = syncIdForLocalId('pos_sessions', c.session_id)
      return {
        sessionSyncId,
        contactSyncId: syncIdForLocalId('contacts', c.contact_id),
        // The server only knows cash_in / cash_out; local rows also use e.g.
        // 'expense' (stored as a negative amount), which must go out as cash_out.
        transactionType: c.transaction_type === 'cash_out' || Number(c.amount) < 0 ? 'cash_out' : 'cash_in',
        amount: Math.abs(Number(c.amount) || 0),
        source: c.source,
        paymentMethod: c.payment_method ?? undefined,
        description: c.description,
        transactionDate: c.created_at,
        createdBy: c.created_by,
        _updatedAt: c.updated_at ?? c.created_at,
      }
    },
    debt_clearances: ({ sync_id }) => {
      const d = db.get<any>(`SELECT * FROM debt_clearances WHERE sync_id=?`, [sync_id])
      if (!d) return null
      const contactSyncId = syncIdForLocalId('contacts', d.contact_id)
      if (!contactSyncId) return null // retried once the contact has synced
      return {
        contactSyncId,
        clearedAt: d.cleared_at,
        clearedBy: d.cleared_by,
        totalDebt: d.total_debt ?? 0,
        totalPaid: d.total_paid ?? 0,
        _updatedAt: d.updated_at ?? d.cleared_at,
      }
    },
    quantity_adjustments: (row) => {
      const inline = JSON.parse(row.payload || '{}')?.inline
      if (inline) {
        const productSyncId = syncIdForLocalId('products', inline.productLocalId)
        const batchSyncId = syncIdForLocalId('product_batches', inline.batchLocalId)
        if (!productSyncId || !batchSyncId) return null
        return {
          productSyncId, batchSyncId,
          previousQuantity: inline.previousQuantity, adjustedQuantity: inline.adjustedQuantity,
          reason: inline.reason, location: inline.location || 'shop', kind: inline.kind ?? 'receipt',
          _updatedAt: new Date().toISOString(),
        }
      }
      const a = db.get<any>(`SELECT * FROM quantity_adjustments WHERE sync_id=?`, [row.sync_id])
      if (!a) return null
      const batchSyncId = syncIdForLocalId('product_batches', a.batch_id)
      const batch = db.get<any>(`SELECT product_id FROM product_batches WHERE id=?`, [a.batch_id])
      const productSyncId = batch ? syncIdForLocalId('products', batch.product_id) : null
      if (!productSyncId || !batchSyncId) return null
      return {
        productSyncId, batchSyncId,
        previousQuantity: a.previous_quantity, adjustedQuantity: a.adjusted_quantity,
        reason: a.reason, createdBy: a.created_by, location: a.location || 'shop', kind: a.kind ?? undefined,
        _updatedAt: a.updated_at ?? a.created_at,
      }
    },
    settings: ({ sync_id }) => {
      const s = db.get<any>(`SELECT * FROM settings WHERE sync_id=?`, [sync_id])
      if (!s || !SHARED_SETTINGS.has(s.meta_key)) return null
      return { metaKey: s.meta_key, metaValue: s.meta_value ?? '', _updatedAt: s.updated_at ?? new Date().toISOString() }
    },
    stores: ({ sync_id }) => {
      const s = db.get<any>(`SELECT * FROM stores WHERE sync_id=?`, [sync_id])
      if (!s) return null
      return { name: s.name, address: s.address, phone: s.phone, _updatedAt: s.updated_at ?? new Date().toISOString() }
    },
    charges: ({ sync_id }) => {
      const c = db.get<any>(`SELECT * FROM charges WHERE sync_id=?`, [sync_id])
      if (!c) return null
      return {
        name: c.name, chargeType: c.charge_type ?? undefined, rateType: c.rate_type ?? undefined,
        rateValue: Number(c.rate_value ?? 0), isActive: Boolean(c.is_active), isDefault: Boolean(c.is_default),
        _updatedAt: c.updated_at ?? new Date().toISOString(),
      }
    },
    audit_logs: ({ sync_id }) => {
      const a = db.get<any>(`SELECT * FROM audit_logs WHERE sync_id=?`, [sync_id])
      if (!a) return null
      return {
        action: a.action, entity: a.entity, entityId: a.entity_id, details: a.details,
        userId: a.user_id, userName: a.user_name, occurredAt: a.occurred_at, _updatedAt: a.occurred_at,
      }
    },
  }

  function buildSalePayload(syncId: string): Record<string, unknown> | null {
    const sale = db.get<any>(`SELECT * FROM sales WHERE sync_id=?`, [syncId])
    if (!sale) return null
    const items = db.all<any>(
      `SELECT si.*, p.sync_id AS product_sync_id, b.sync_id AS batch_sync_id
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN product_batches b ON b.id = si.batch_id
       WHERE si.sale_id = ?`,
      [sale.id]
    )
    const payments = db.all<any>(`SELECT * FROM payment_transactions WHERE sale_id=?`, [sale.id])

    const sessionSyncId = syncIdForLocalId('pos_sessions', sale.session_id)
    // Session must exist locally; retried otherwise. Exception: a sale pulled
    // from another terminal has no local session, but the server already has
    // it — a re-push of it only carries a void, which never needs the session.
    if (!sessionSyncId && !sale.server_id) return null

    const saleDate =
      sale.sale_time && String(sale.sale_time).includes('T')
        ? sale.sale_time
        : `${sale.sale_date}T${sale.sale_time ?? '00:00:00'}.000Z`

    return {
      syncId,
      userSyncId: userSyncIdForLocalRef(sale.user_id),
      sessionSyncId,
      contactSyncId: syncIdForLocalId('contacts', sale.contact_id),
      referenceSyncId: syncIdForLocalId('sales', sale.reference_id),
      invoiceNumber: sale.invoice_number,
      saleType: sale.sale_type ?? 'sale',
      saleDate,
      subtotal: sale.subtotal ?? 0,
      discount: sale.discount ?? 0,
      totalChargeAmount: sale.total_charge_amount ?? 0,
      totalAmount: sale.total_amount ?? 0,
      amountReceived: sale.amount_received ?? 0,
      changeAmount: sale.change_amount ?? 0,
      status: sale.status ?? 'completed',
      paymentStatus: sale.payment_status ?? 'fully_paid',
      note: sale.note,
      items: items.map((i) => ({
        syncId: i.sync_id ?? undefined,
        itemType: i.item_type ?? 'product',
        productSyncId: i.product_sync_id,
        batchSyncId: i.batch_sync_id,
        description: i.description ?? '',
        quantity: i.quantity ?? 0,
        unitPrice: i.unit_price ?? 0,
        unitCost: i.unit_cost ?? 0,
        discount: i.discount ?? 0,
        flatDiscount: i.flat_discount ?? 0,
        isFree: Boolean(i.is_free),
      })),
      payments: payments.map((p) => ({
        syncId: p.sync_id ?? undefined,
        paymentMethod: p.payment_method,
        amount: p.amount ?? 0,
        transactionType: p.transaction_type ?? 'sale',
        note: p.note,
      })),
    }
  }

  function deadCount(): number {
    return db.get<{ c: number }>(`SELECT COUNT(*) c FROM sync_queue_local WHERE status='dead'`)!.c
  }

  async function flushOutbox(): Promise<FlushResult> {
    if (!hasTerminalToken()) return { synced: 0, errors: 0, dead: deadCount() }

    // A cashier's token can't push staff/settings changes; they stay pending
    // for a manager's token (on desktop, the Office app sharing this outbox)
    // instead of burning their retries on certain refusals.
    const officeOnly = [...OFFICE_ONLY_TABLES]
    const skipOffice = OFFICE_ROLES.has(getSetting(roleKey)) ? 0 : 1
    const now = new Date().toISOString()
    const rows = db.all<OutboxRow>(
      `SELECT id, table_name, entity_type, op, payload, sync_id, attempt_count
       FROM sync_queue_local
       WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
         AND (? = 0 OR COALESCE(table_name, entity_type) NOT IN (${officeOnly.map(() => '?').join(',')}))
       ORDER BY id LIMIT 200`,
      [now, skipOffice, ...officeOnly]
    )
    if (!rows.length) return { synced: 0, errors: 0, dead: deadCount() }

    for (const row of rows) {
      if (!row.table_name) row.table_name = row.entity_type === 'sale' ? 'sales' : row.entity_type
    }
    rows.sort(
      (a, b) =>
        (FLUSH_PRIORITY[a.table_name!] ?? 50) - (FLUSH_PRIORITY[b.table_name!] ?? 50) || a.id - b.id
    )

    let synced = 0
    let errors = 0

    const generic = rows.filter((r) => r.table_name !== 'sales')
    const saleRows = rows.filter((r) => r.table_name === 'sales')

    if (generic.length) {
      const changes: Array<{ row: OutboxRow; change: Record<string, unknown> }> = []
      for (const row of generic) {
        const builder = CHANGE_BUILDERS[row.table_name!]
        if (!builder) {
          scheduleRetry(row, `No builder for table ${row.table_name}`, true)
          errors++
          continue
        }
        const built = builder(row)
        if (!built) {
          scheduleRetry(row, 'Local FK not yet resolvable (will retry after pull)', true)
          errors++
          continue
        }
        const { _updatedAt, ...data } = built
        changes.push({
          row,
          change: {
            table: row.table_name,
            syncId: row.sync_id,
            op: row.op ?? 'upsert',
            data,
            clientUpdatedAt: (_updatedAt as string) ?? now,
          },
        })
      }

      if (changes.length) {
        try {
          const { status, data } = await httpJson('POST', '/api/sync/v2/push', {
            headers: authHeaders(),
            body: { changes: changes.map((c) => c.change) },
          })
          if (isTransientStatus(status)) throw new NetworkError(`push HTTP ${status}`)
          if (status !== 200) {
            clearTerminalTokenOn401(status)
            throw new Error(data?.error ?? `push HTTP ${status}`)
          }
          const bySyncId = new Map<string, { status: string; serverId?: number; error?: string }>(
            (data.results as any[]).map((r) => [r.syncId, r])
          )
          for (const { row } of changes) {
            const result = bySyncId.get(row.sync_id)
            if (!result) {
              scheduleRetry(row, 'No result returned for change', true)
              errors++
            } else if (result.status === 'applied' || result.status === 'skipped-stale') {
              markSynced(row.id)
              // (settings has no server_id column; quantity_adjustments' stays local.)
              if (result.serverId && row.table_name !== 'quantity_adjustments' && row.table_name !== 'settings') {
                db.run(`UPDATE ${row.table_name} SET server_id=? WHERE sync_id=?`, [
                  result.serverId, row.sync_id,
                ])
              }
              synced++
            } else {
              scheduleRetry(row, result.error ?? 'unknown error', true)
              errors++
            }
          }
        } catch (err) {
          // Network failures never count toward the dead-letter limit.
          const msg = err instanceof Error ? err.message : 'network error'
          for (const { row } of changes) scheduleRetry(row, msg, !(err instanceof NetworkError))
          errors += changes.length
        }
      }
    }

    if (saleRows.length) {
      const payloads: Array<{ row: OutboxRow; sale: Record<string, unknown> }> = []
      for (const row of saleRows) {
        const sale = buildSalePayload(row.sync_id)
        if (!sale) {
          scheduleRetry(row, 'Sale or its session missing locally', true)
          errors++
          continue
        }
        payloads.push({ row, sale })
      }
      if (payloads.length) {
        try {
          const { status, data } = await httpJson('POST', '/api/sync/v2/sales', {
            headers: authHeaders(),
            body: { sales: payloads.map((p) => p.sale) },
          })
          if (isTransientStatus(status)) throw new NetworkError(`sales push HTTP ${status}`)
          if (status !== 200) {
            clearTerminalTokenOn401(status)
            throw new Error(data?.error ?? `sales push HTTP ${status}`)
          }
          const okBySyncId = new Map<string, { serverId: number; invoiceNumber: string }>(
            (data.synced as any[]).map((s) => [s.syncId, s])
          )
          const errBySyncId = new Map<string, string>(
            (data.errors as any[]).map((e) => [e.syncId, e.error])
          )
          for (const { row } of payloads) {
            const ok = okBySyncId.get(row.sync_id)
            if (ok) {
              markSynced(row.id)
              db.run(
                `UPDATE sales SET sync_status='synced', server_id=?, invoice_number=? WHERE sync_id=?`,
                [ok.serverId, ok.invoiceNumber, row.sync_id]
              )
              synced++
            } else {
              scheduleRetry(row, errBySyncId.get(row.sync_id) ?? 'unknown error', true)
              errors++
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'network error'
          for (const { row } of payloads) scheduleRetry(row, msg, !(err instanceof NetworkError))
          errors += payloads.length
        }
      }
    }

    return { synced, errors, dead: deadCount() }
  }

  // --- one-time v2 backfill ------------------------------------------------

  function backfillOutboxOnce(): void {
    if (getSetting('v2_backfill_done')) return

    const enqueueMissing = (table: string, where: string) => {
      const rows = db.all<{ sync_id: string }>(
        `SELECT sync_id FROM ${table} WHERE ${where}
         AND sync_id NOT IN (SELECT sync_id FROM sync_queue_local)`
      )
      for (const r of rows) enqueueOutbox(table, r.sync_id, 'upsert')
      if (rows.length) log(`[syncV2] backfill: enqueued ${rows.length} ${table} row(s)`)
    }

    // Rows created after migration (or never pulled) that the server has no
    // copy of. Users are intentionally excluded: local "users" are employees
    // without a server username — a modeling mismatch to resolve with the
    // Android office app work, not silently on desktop.
    enqueueMissing('contacts', 'server_id IS NULL')
    enqueueMissing('products', 'server_id IS NULL')
    enqueueMissing('product_batches', 'server_id IS NULL')
    // Sessions: the open one, plus any referenced by still-pending sales.
    enqueueMissing(
      'pos_sessions',
      `server_id IS NULL AND (state != 'closed'
        OR id IN (SELECT session_id FROM sales WHERE sync_id IN
          (SELECT sync_id FROM sync_queue_local WHERE status='pending' AND (table_name='sales' OR entity_type='sale'))))`
    )
    setSetting('v2_backfill_done', new Date().toISOString())
  }

  function getSyncStatus(): 'online' | 'offline' | 'syncing' {
    if (!lastHttpSuccessAt) return 'offline'
    return Date.now() - lastHttpSuccessAt < 10 * 60 * 1000 ? 'online' : 'offline'
  }

  return {
    getServerUrl,
    setTerminalToken,
    ensureInvoiceRange,
    nextInvoiceNumber,
    hasTerminalToken,
    pullTableV2,
    enqueueOutbox,
    flushOutbox,
    retryDeadLetters,
    requeueOnStartup,
    backfillOutboxOnce,
    getSyncStatus,
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
