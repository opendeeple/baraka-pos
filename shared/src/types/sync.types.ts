export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error'
export type SyncEntityType =
  | 'products'
  | 'product_batches'
  | 'product_stocks'
  | 'contacts'
  | 'collections'
  | 'collection_product'
  | 'charges'
  | 'settings'
  | 'stores'

export interface SyncPullRequest {
  table: SyncEntityType
  lastSync?: string
  storeId: number
}

export interface SyncPullResponse<T = unknown> {
  table: SyncEntityType
  records: T[]
  serverTime: string
}

export interface SyncSalePushRequest {
  storeId: number
  terminalId: string
  sales: unknown[]
}

export interface SyncSalePushResponse {
  synced: Array<{
    syncId: string
    serverId: number
    invoiceNumber: string
  }>
  errors: Array<{
    syncId: string
    error: string
  }>
}

export interface SyncQueueItem {
  id: number
  entityType: string
  payload: string
  syncId: string
  createdAt: string
  syncedAt?: string
  status: 'pending' | 'synced' | 'error'
}

export interface SocketEvents {
  'sale:completed': {
    saleId: number
    invoiceNumber: string
    terminalId: string
    total: number
    paymentMethod: string
  }
  'stock:updated': {
    productId: number
    batchId: number
    storeId: number
    newQty: number
  }
  'product:updated': { productId: number }
  'product:deleted': { productId: number }
  'customer:updated': {
    customerId: number
    newBalance: number
    loyaltyBalance: number
  }
  'session:opened': { sessionId: number; terminalId: string; userId: number }
  'session:closed': { sessionId: number; terminalId: string }
  'price:changed': { productId: number; batchId: number; newPrice: number }
  'terminal:register': { terminalId: string; storeId: number; userId: number; sessionId?: number }
  'sync:request': { lastSyncTs: string }
  'sync:notify': { modelName: string; recordIds: number[]; senderTerminalId: string }
}
