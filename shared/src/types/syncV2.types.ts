// Sync protocol v2 contract, shared by server, Electron, and the Android apps.
//
// Identity model: every syncable row carries a globally-unique `syncId` (UUIDv4),
// minted wherever the row is born. Local integer PKs never travel over the wire;
// clients upsert pulled rows ON CONFLICT(sync_id) and translate FKs to
// `*SyncId` references on push. Server resolves them back to its own int ids.

/** Tables a device may pull. Superset of v1's SyncEntityType. */
export type SyncV2PullTable =
  | 'products'
  | 'product_batches'
  | 'product_stocks'
  | 'contacts'
  | 'collections'
  | 'collection_product'
  | 'charges'
  | 'settings'
  | 'stores'
  | 'users'
  | 'pos_sessions'
  | 'expenses'
  | 'purchases'
  | 'quantity_adjustments'
  | 'sales'

/** Tables a device may push through the generic change endpoint (sales have their own). */
export type SyncV2PushTable =
  | 'contacts'
  | 'products'
  | 'product_batches'
  | 'expenses'
  | 'purchases'
  | 'pos_sessions'
  | 'quantity_adjustments'
  | 'users'
  | 'cash_logs'

export interface DeviceRegisterRequest {
  name: string
  platform: 'android-pos' | 'android-office' | 'electron-pos' | 'electron-office'
}

export interface DeviceRegisterResponse {
  deviceId: number
  deviceSyncId: string
  /** Returned exactly once; stored bcrypt-hashed server-side. */
  deviceKey: string
  storeId: number
}

export interface SyncV2PullRequest {
  table: SyncV2PullTable
  /** Opaque cursor from the previous page's/pull's `nextCursor`; omit for a full initial pull. */
  cursor?: string
  limit?: number
}

/**
 * Pulled records are camelCase API shapes including `id` (the server PK, stored
 * client-side as `server_id`), `syncId`, `updatedAt`, and `deletedAt` (tombstone —
 * non-null means the client must delete/deactivate its local row).
 * FK columns are accompanied by their `*SyncId` counterparts (e.g. `productSyncId`)
 * so clients can rewire local integer FKs without consulting server ids.
 */
export interface SyncV2PullResponse<T = Record<string, unknown>> {
  table: SyncV2PullTable
  records: T[]
  /** Authoritative server clock at response time. */
  serverTime: string
  /** Opaque; pass as `cursor` on the next request. Derived from server updatedAt, immune to client clock skew. */
  nextCursor: string
  hasMore: boolean
}

export type SyncV2Op = 'upsert' | 'delete'

export interface SyncV2Change {
  table: SyncV2PushTable
  syncId: string
  op: SyncV2Op
  /**
   * camelCase entity payload. FKs are expressed as `*SyncId` fields
   * (contactSyncId, sessionSyncId, productSyncId, batchSyncId, userSyncId ...).
   * Stock never travels as an absolute quantity — use quantity_adjustments deltas.
   */
  data: Record<string, unknown>
  /** Client-side last-modified time, used for last-writer-wins on dimension tables. */
  clientUpdatedAt: string
}

export interface SyncV2PushRequest {
  changes: SyncV2Change[]
}

export type SyncV2ChangeStatus = 'applied' | 'skipped-stale' | 'error'

export interface SyncV2ChangeResult {
  syncId: string
  status: SyncV2ChangeStatus
  /** Server PK for the row, present when status is 'applied' or 'skipped-stale'. */
  serverId?: number
  error?: string
}

export interface SyncV2PushResponse {
  results: SyncV2ChangeResult[]
  serverTime: string
}

/**
 * One offline sale in a v2 sales push. Mirrors SaleCheckoutRequest but all
 * cross-entity references are syncIds, and the invoice number is final
 * (allocated from the device's leased range).
 */
export interface SyncV2SalePayload {
  syncId: string
  userSyncId?: string
  sessionSyncId?: string
  contactSyncId?: string | null
  invoiceNumber: string
  saleType: 'sale' | 'return'
  referenceSyncId?: string | null
  saleDate: string
  subtotal: number
  discount: number
  totalChargeAmount: number
  totalAmount: number
  amountReceived: number
  changeAmount: number
  status: string
  paymentStatus: string
  note?: string | null
  items: Array<{
    syncId?: string
    itemType?: 'product' | 'charge'
    productSyncId?: string | null
    batchSyncId?: string | null
    description: string
    quantity: number
    unitPrice: number
    unitCost?: number
    discount?: number
    flatDiscount?: number
    isFree?: boolean
  }>
  payments: Array<{
    syncId?: string
    paymentMethod: string
    amount: number
    transactionType?: string
    note?: string | null
  }>
}

export interface SyncV2SalesPushRequest {
  sales: SyncV2SalePayload[]
}

export interface SyncV2SalesPushResponse {
  synced: Array<{
    syncId: string
    serverId: number
    invoiceNumber: string
  }>
  errors: Array<{
    syncId: string
    error: string
  }>
  serverTime: string
}

export interface InvoiceRangeRequest {
  /** How many invoice numbers to lease. */
  count: number
}

export interface InvoiceRangeResponse {
  /** Store's salePrefix, e.g. "INV". Format numbers as `${prefix}-${String(n).padStart(6, '0')}`. */
  prefix: string
  /** First number in the leased block, inclusive. */
  start: number
  /** Last number in the leased block, inclusive. */
  end: number
}

/** Outbox row statuses used by v2 clients (replaces v1's terminal 'error'). */
export type OutboxStatus = 'pending' | 'synced' | 'dead'

export interface SyncV2SocketEvents {
  /** Emitted to the store room after any accepted push so peers pull promptly. */
  'sync:changed': { tables: string[] }
}
