// Platform-agnostic sync protocol v2 client engine, shared by Electron
// (better-sqlite3 in the main process) and the Android apps (expo-sqlite sync
// API). All platform concerns are injected via SyncEngineDeps.
import { DEFAULT_SERVER_URL } from '@baraka/shared'

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
}

export type SyncPlatform = 'android-pos' | 'android-office' | 'electron-pos' | 'electron-office'

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
] as const

const INVOICE_LEASE_COUNT = 500
const MAX_ATTEMPTS = 10
const BACKOFF_STEPS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000]

/** Local settings keys that server-pulled settings must never clobber. */
const RESERVED_SETTINGS = new Set([
  'server_url', 'sync_api_key', 'store_id', 'terminal_id', 'cached_user',
  'cached_store', 'printer_config', 'device_id', 'device_key',
  'invoice_prefix', 'invoice_range_start', 'invoice_range_end', 'invoice_range_next',
  'v2_backfill_done',
])
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
}

/** v1-pulled tables eligible for the one-time orphan sweep after a full pull. */
const SWEEP_TABLES = new Set(['products', 'product_batches', 'product_stocks', 'contacts'])

// Generic pushes flush before sales so FK targets (sessions, contacts,
// products) exist server-side by the time their sales arrive. Collections
// flush first — products reference them via categorySyncId/brandSyncId.
const FLUSH_PRIORITY: Record<string, number> = {
  collections: 0, contacts: 1, products: 2, product_batches: 3, pos_sessions: 4,
  quantity_adjustments: 5, expenses: 6, purchases: 7, cash_logs: 8, sales: 99,
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

  function deviceHeaders(): Record<string, string> {
    const id = getSetting('device_id')
    const key = getSetting('device_key')
    if (!id || !key) throw new Error('Device not registered — log in as a manager/admin while online')
    return { Authorization: `Device ${id}:${key}` }
  }

  function isDeviceRegistered(): boolean {
    return Boolean(getSetting('device_id') && getSetting('device_key'))
  }

  // --- device registration + invoice range ---------------------------------

  async function ensureDeviceRegistered(
    jwtToken: string,
    platform: SyncPlatform
  ): Promise<{ registered: boolean; error?: string }> {
    if (isDeviceRegistered()) {
      await ensureInvoiceRange().catch(() => {})
      return { registered: true }
    }
    const terminalId = getSetting('terminal_id', 'TERMINAL-001')
    try {
      const { status, data } = await httpJson('POST', '/api/devices/register', {
        headers: { Authorization: `Bearer ${jwtToken}` },
        body: { name: terminalId, platform },
      })
      if (status !== 201) {
        return { registered: false, error: data?.error ?? `HTTP ${status}` }
      }
      setSetting('device_id', String(data.deviceId))
      setSetting('device_key', data.deviceKey)
      await ensureInvoiceRange().catch(() => {})
      return { registered: true }
    } catch (err) {
      return { registered: false, error: err instanceof Error ? err.message : 'network error' }
    }
  }

  async function ensureInvoiceRange(): Promise<void> {
    const next = Number(getSetting('invoice_range_next', '0'))
    const end = Number(getSetting('invoice_range_end', '-1'))
    const remaining = end - next + 1
    if (end >= 0 && remaining > INVOICE_LEASE_COUNT * 0.2) return

    const { status, data } = await httpJson('POST', '/api/sync/v2/invoice-range', {
      headers: deviceHeaders(),
      body: { count: INVOICE_LEASE_COUNT },
    })
    if (status !== 200) throw new Error(data?.error ?? `invoice-range HTTP ${status}`)
    setSetting('invoice_prefix', data.prefix)
    setSetting('invoice_range_start', String(data.start))
    setSetting('invoice_range_end', String(data.end))
    setSetting('invoice_range_next', String(data.start))
  }

  /**
   * Next invoice number from the leased range, or null when no range is
   * available (device never registered / never online) — callers fall back to
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
        entries.push(['sync_id', syncId])
        entries.push(['server_id', serverId])
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
           ON CONFLICT(sync_id) DO UPDATE SET ${updates}`,
          values
        )

        if (table === 'sales') upsertSaleChildren(record, syncId)
      }
    })
    return pulledSyncIds
  }

  async function pullTableV2(table: string): Promise<PullResult> {
    // Self-heal rows written before sale_date normalization existed (pulled
    // sales briefly stored full ISO timestamps, breaking `sale_date = ?`
    // report filters). Idempotent and cheap at POS scale.
    if (table === 'sales') {
      db.run(`UPDATE sales SET sale_date = substr(sale_date, 1, 10) WHERE length(sale_date) > 10`)
    }
    const cursorKey = `sync_cursor_${table}`
    let cursor = getSetting(cursorKey)
    const isInitialFullPull = !cursor
    const allPulled = new Set<string>()
    let total = 0

    for (let page = 0; page < 200; page++) {
      const params = new URLSearchParams({ table, limit: '500' })
      if (cursor) params.set('cursor', cursor)
      const { status, data } = await httpJson('GET', `/api/sync/v2/pull?${params}`, {
        headers: deviceHeaders(),
      })
      if (status !== 200) throw new Error(data?.error ?? `Pull ${table}: HTTP ${status}`)

      const pulled = upsertPulledRecords(table, data.records as Record<string, unknown>[])
      pulled.forEach((s) => allPulled.add(s))
      total += data.records.length

      // Persist the cursor only after the page is applied — crash-safe resume.
      if (data.nextCursor) {
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
        type: c.type, notes: c.notes, _updatedAt: c.updated_at,
      }
    },
    products: ({ sync_id }) => {
      const p = db.get<any>(`SELECT * FROM products WHERE sync_id=?`, [sync_id])
      if (!p) return null
      return {
        name: p.name, description: p.description, sku: p.sku, barcode: p.barcode,
        imageUrl: p.image_url, unit: p.unit, productType: p.product_type,
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
        `SELECT pi.*, b.sync_id AS batch_sync_id, pr.name AS product_name FROM purchase_items pi
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
        items: items.map((i) => ({
          syncId: i.sync_id ?? undefined,
          batchSyncId: i.batch_sync_id,
          description: i.product_name ?? '',
          quantity: i.quantity ?? 0,
          unitPrice: i.unit_cost ?? 0,
          unitCost: i.unit_cost ?? 0,
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
        transactionType: c.transaction_type,
        amount: Math.abs(Number(c.amount) || 0),
        source: c.source,
        description: c.description,
        transactionDate: c.created_at,
        createdBy: c.created_by,
        _updatedAt: c.updated_at ?? c.created_at,
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
          reason: inline.reason, _updatedAt: new Date().toISOString(),
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
        reason: a.reason, createdBy: a.created_by, _updatedAt: a.updated_at ?? a.created_at,
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
    if (!sessionSyncId) return null // session must exist locally; retried otherwise

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
    if (!isDeviceRegistered()) return { synced: 0, errors: 0, dead: deadCount() }

    const now = new Date().toISOString()
    const rows = db.all<OutboxRow>(
      `SELECT id, table_name, entity_type, op, payload, sync_id, attempt_count
       FROM sync_queue_local
       WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY id LIMIT 200`,
      [now]
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
            headers: deviceHeaders(),
            body: { changes: changes.map((c) => c.change) },
          })
          if (status !== 200) throw new Error(data?.error ?? `push HTTP ${status}`)
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
              if (result.serverId && row.table_name !== 'quantity_adjustments') {
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
            headers: deviceHeaders(),
            body: { sales: payloads.map((p) => p.sale) },
          })
          if (status !== 200) throw new Error(data?.error ?? `sales push HTTP ${status}`)
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
    ensureDeviceRegistered,
    ensureInvoiceRange,
    nextInvoiceNumber,
    isDeviceRegistered,
    pullTableV2,
    enqueueOutbox,
    flushOutbox,
    retryDeadLetters,
    backfillOutboxOnce,
    getSyncStatus,
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
