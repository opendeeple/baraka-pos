import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { prisma } from '../../config/database'
import { broadcastSaleCompleted, broadcastStockUpdated, broadcastToStore } from '../../socket'
import type {
  SyncV2PullTable,
  SyncV2PullResponse,
  SyncV2Change,
  SyncV2ChangeResult,
  SyncV2PushResponse,
  SyncV2SalePayload,
  SyncV2SalesPushResponse,
  InvoiceRangeResponse,
} from '@baraka/shared'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

interface DeviceCtx {
  deviceId: number
  storeId: number
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

// Cursor is opaque to clients: "<updatedAt ISO>|<server id>". The id tiebreak
// makes pagination stable when many rows share one updatedAt (e.g. bulk import).
function parseCursor(cursor?: string): { after: Date; afterId: number } | null {
  if (!cursor) return null
  const sep = cursor.lastIndexOf('|')
  const date = new Date(sep === -1 ? cursor : cursor.slice(0, sep))
  if (Number.isNaN(date.getTime())) throw new Error('Invalid cursor')
  const afterId = sep === -1 ? 0 : Number(cursor.slice(sep + 1)) || 0
  return { after: date, afterId }
}

function makeCursor(updatedAt: Date, id: number): string {
  return `${updatedAt.toISOString()}|${id}`
}

function incrementalWhere(cursor?: string): object {
  const parsed = parseCursor(cursor)
  if (!parsed) return {}
  return {
    OR: [
      { updatedAt: { gt: parsed.after } },
      { updatedAt: parsed.after, id: { gt: parsed.afterId } },
    ],
  }
}

type PullConfig = {
  fetch: (
    storeId: number,
    where: object,
    take: number
  ) => Promise<Array<Record<string, unknown> & { id: number; updatedAt: Date }>>
  map?: (row: Record<string, any>) => Record<string, unknown>
}

// Every pulled record keeps `id` (stored client-side as server_id), carries
// `syncId`, and exposes FK targets as `*SyncId` so clients never depend on
// server integer ids. Tombstones (`deletedAt` set) are included, not filtered.
const PULL_CONFIG: Record<SyncV2PullTable, PullConfig> = {
  products: {
    fetch: (storeId, where, take) =>
      prisma.product.findMany({
        where: { storeId, ...where },
        include: {
          category: { select: { syncId: true } },
          brand: { select: { syncId: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ category, brand, ...row }) => ({
      ...row,
      categorySyncId: category?.syncId ?? null,
      brandSyncId: brand?.syncId ?? null,
    }),
  },
  product_batches: {
    fetch: (storeId, where, take) =>
      prisma.productBatch.findMany({
        where: { product: { storeId }, ...where },
        include: {
          product: { select: { syncId: true } },
          vendor: { select: { syncId: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ product, vendor, ...row }) => ({
      ...row,
      productSyncId: product.syncId,
      vendorSyncId: vendor?.syncId ?? null,
    }),
  },
  product_stocks: {
    fetch: (storeId, where, take) =>
      prisma.productStock.findMany({
        where: { storeId, ...where },
        include: {
          product: { select: { syncId: true } },
          batch: { select: { syncId: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ product, batch, ...row }) => ({
      ...row,
      productSyncId: product.syncId,
      batchSyncId: batch.syncId,
    }),
  },
  contacts: {
    fetch: (storeId, where, take) =>
      prisma.contact.findMany({
        where: { storeId, ...where },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
  },
  collections: {
    // Collections are global (slug is globally unique); no store scope exists.
    fetch: (_storeId, where, take) =>
      prisma.collection.findMany({
        where,
        include: { parent: { select: { syncId: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ parent, ...row }) => ({ ...row, parentSyncId: parent?.syncId ?? null }),
  },
  collection_product: {
    fetch: (storeId, where, take) =>
      prisma.collectionProduct.findMany({
        where: { product: { storeId }, ...where },
        include: {
          collection: { select: { syncId: true } },
          product: { select: { syncId: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ collection, product, ...row }) => ({
      ...row,
      collectionSyncId: collection.syncId,
      productSyncId: product.syncId,
    }),
  },
  charges: {
    fetch: (storeId, where, take) =>
      prisma.charge.findMany({
        where: { storeId, ...where },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
  },
  settings: {
    fetch: (storeId, where, take) =>
      prisma.setting.findMany({
        where: { storeId, ...where },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
  },
  stores: {
    fetch: (storeId, where, take) =>
      prisma.store.findMany({
        where: { id: storeId, ...where },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
  },
  users: {
    fetch: (storeId, where, take) =>
      prisma.user.findMany({
        where: { storeId, ...where },
        // pinCode ships so devices can verify PINs offline; passwordHash never leaves the server.
        select: {
          id: true,
          syncId: true,
          storeId: true,
          name: true,
          email: true,
          username: true,
          role: true,
          pinCode: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }) as never,
  },
  pos_sessions: {
    fetch: (storeId, where, take) =>
      prisma.posSession.findMany({
        where: { storeId, ...where },
        include: { user: { select: { syncId: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ user, ...row }) => ({ ...row, userSyncId: user.syncId }),
  },
  expenses: {
    fetch: (storeId, where, take) =>
      prisma.expense.findMany({
        where: { storeId, ...where },
        include: { session: { select: { syncId: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ session, ...row }) => ({ ...row, sessionSyncId: session?.syncId ?? null }),
  },
  purchases: {
    fetch: (storeId, where, take) =>
      prisma.purchase.findMany({
        where: { storeId, ...where },
        include: {
          contact: { select: { syncId: true } },
          items: { include: { batch: { select: { syncId: true } } } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ contact, items, ...row }) => ({
      ...row,
      contactSyncId: contact?.syncId ?? null,
      items: (items as Array<Record<string, any>>).map(({ batch, ...item }) => ({
        ...item,
        batchSyncId: batch?.syncId ?? null,
      })),
    }),
  },
  quantity_adjustments: {
    fetch: (storeId, where, take) =>
      prisma.quantityAdjustment.findMany({
        where: { storeId, ...where },
        include: {
          batch: { select: { syncId: true } },
          stock: {
            select: {
              syncId: true,
              product: { select: { syncId: true } },
              batch: { select: { syncId: true } },
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ batch, stock, ...row }) => ({
      ...row,
      batchSyncId: batch.syncId,
      stockSyncId: stock.syncId,
      productSyncId: stock.product.syncId,
    }),
  },
  // Sales replicate to office devices (each Android/desktop office keeps its
  // own SQLite, so the dashboard/reports need the facts locally). Items and
  // payments travel nested; the client inserts them only when the sale is new
  // locally — sales are immutable facts apart from status flips.
  sales: {
    fetch: (storeId, where, take) =>
      prisma.sale.findMany({
        where: { storeId, ...where },
        include: {
          contact: { select: { syncId: true } },
          session: { select: { syncId: true } },
          reference: { select: { syncId: true } },
          items: {
            include: {
              product: { select: { syncId: true } },
              batch: { select: { syncId: true } },
            },
          },
          payments: { include: { contact: { select: { syncId: true } } } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    map: ({ contact, session, reference, items, payments, ...row }) => ({
      ...row,
      contactSyncId: contact?.syncId ?? null,
      sessionSyncId: session.syncId,
      referenceSyncId: reference?.syncId ?? null,
      items: (items as Array<Record<string, any>>).map(({ product, batch, ...item }) => ({
        ...item,
        productSyncId: product?.syncId ?? null,
        batchSyncId: batch?.syncId ?? null,
      })),
      payments: (payments as Array<Record<string, any>>).map(({ contact: payContact, ...pay }) => ({
        ...pay,
        contactSyncId: payContact?.syncId ?? null,
      })),
    }),
  },
}

export async function pullTableV2(
  device: DeviceCtx,
  table: SyncV2PullTable,
  cursor?: string,
  limit?: number
): Promise<SyncV2PullResponse> {
  const config = PULL_CONFIG[table]
  if (!config) throw new Error(`Unknown table: ${table}`)

  const take = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const where = incrementalWhere(cursor)
  // take + 1 to detect hasMore without a second count query
  const rows = await config.fetch(device.storeId, where, take + 1)
  const hasMore = rows.length > take
  const page = hasMore ? rows.slice(0, take) : rows

  const last = page[page.length - 1]
  const nextCursor = last ? makeCursor(last.updatedAt, last.id) : cursor ?? ''

  prisma.device
    .update({ where: { id: device.deviceId }, data: { lastPulledAt: new Date() } })
    .catch(() => {})

  return {
    table,
    records: config.map ? page.map(config.map) : page,
    serverTime: dayjs().toISOString(),
    nextCursor,
    hasMore,
  }
}

// ---------------------------------------------------------------------------
// Generic push
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient

async function resolveSyncId(
  tx: Tx,
  model: 'contact' | 'product' | 'productBatch' | 'posSession' | 'user' | 'collection' | 'sale',
  syncId: string | null | undefined
): Promise<number | null> {
  if (!syncId) return null
  const row = await (tx[model] as any).findUnique({ where: { syncId }, select: { id: true } })
  if (!row) throw new Error(`Unresolved ${model} syncId: ${syncId}`)
  return row.id
}

/**
 * Last-writer-wins guard for dimension tables: if the server row changed after
 * the client's edit, the push is skipped and the client keeps the server copy
 * on its next pull.
 */
function isStale(serverUpdatedAt: Date, clientUpdatedAt: string): boolean {
  return serverUpdatedAt.getTime() > new Date(clientUpdatedAt).getTime()
}

type PushHandler = (
  tx: Tx,
  device: DeviceCtx,
  change: SyncV2Change
) => Promise<{ serverId: number; status: 'applied' | 'skipped-stale' }>

function pick(data: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f]
  return out
}

// balance / loyaltyPointsBalance are deliberately absent: they are
// server-accumulated from debt payments and loyalty transactions — a client
// pushing absolute values would double-count or clobber concurrent activity.
const CONTACT_FIELDS = ['name', 'email', 'phone', 'whatsapp', 'address', 'type', 'notes', 'metaData']
const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcode', 'imageUrl', 'unit', 'productType', 'isStockManaged', 'isActive', 'isFeatured', 'alertQuantity', 'discount', 'metaData']
const BATCH_FIELDS = ['batchNumber', 'expiryDate', 'cost', 'price', 'discount', 'isActive', 'isFeatured']
const EXPENSE_FIELDS = ['description', 'amount', 'expenseDate', 'source', 'createdBy']
const SESSION_FIELDS = ['terminalId', 'state', 'openingBalance', 'closingBalanceTheoretical', 'closingBalanceActual', 'variance', 'openedAt', 'closedAt']
const USER_FIELDS = ['name', 'email', 'username', 'role', 'pinCode', 'isActive']
const PURCHASE_FIELDS = ['purchaseDate', 'referenceNo', 'totalAmount', 'discount', 'amountPaid', 'paymentStatus', 'status', 'note', 'createdBy']

const PUSH_HANDLERS: Record<string, PushHandler> = {
  contacts: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const existing = await tx.contact.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.contact.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : (pick(data, CONTACT_FIELDS) as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.contact.create({
      data: { syncId, storeId: device.storeId, ...(pick(data, CONTACT_FIELDS) as object) } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  products: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const categoryId = await resolveSyncId(tx, 'collection', data.categorySyncId as string | undefined)
    const brandId = await resolveSyncId(tx, 'collection', data.brandSyncId as string | undefined)
    const fields = { ...pick(data, PRODUCT_FIELDS), categoryId, brandId }
    const existing = await tx.product.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.product.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : (fields as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.product.create({
      data: { syncId, storeId: device.storeId, ...fields } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  product_batches: async (tx, _device, { syncId, op, data, clientUpdatedAt }) => {
    const productId = await resolveSyncId(tx, 'product', data.productSyncId as string)
    if (!productId) throw new Error('product_batches push requires productSyncId')
    const vendorId = await resolveSyncId(tx, 'contact', data.vendorSyncId as string | undefined)
    const fields = { ...pick(data, BATCH_FIELDS), productId, vendorId }
    const existing = await tx.productBatch.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.productBatch.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : (fields as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.productBatch.create({ data: { syncId, ...fields } as never })
    return { serverId: created.id, status: 'applied' }
  },

  expenses: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const sessionId = await resolveSyncId(tx, 'posSession', data.sessionSyncId as string | undefined)
    const existing = await tx.expense.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.expense.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : ({ ...pick(data, EXPENSE_FIELDS), sessionId } as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.expense.create({
      data: { syncId, storeId: device.storeId, sessionId, ...(pick(data, EXPENSE_FIELDS) as object) } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  pos_sessions: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    if (op === 'delete') throw new Error('pos_sessions cannot be deleted')
    const userId = await resolveSyncId(tx, 'user', data.userSyncId as string)
    if (!userId) throw new Error('pos_sessions push requires userSyncId')
    const fields = { ...pick(data, SESSION_FIELDS), userId }
    const existing = await tx.posSession.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.posSession.update({ where: { syncId }, data: fields as never })
      return { serverId: existing.id, status: 'applied' }
    }
    const created = await tx.posSession.create({
      data: { syncId, storeId: device.storeId, ...fields } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  quantity_adjustments: async (tx, device, { syncId, op, data }) => {
    if (op === 'delete') throw new Error('quantity_adjustments cannot be deleted')
    // Insert-only fact carrying a signed stock delta; duplicates are no-ops.
    const existing = await tx.quantityAdjustment.findUnique({ where: { syncId } })
    if (existing) return { serverId: existing.id, status: 'applied' }

    const productId = await resolveSyncId(tx, 'product', data.productSyncId as string)
    const batchId = await resolveSyncId(tx, 'productBatch', data.batchSyncId as string)
    if (!productId || !batchId) throw new Error('quantity_adjustments push requires productSyncId and batchSyncId')

    const previousQuantity = Number(data.previousQuantity ?? 0)
    const adjustedQuantity = Number(data.adjustedQuantity ?? 0)
    const delta = adjustedQuantity - previousQuantity

    // Stock converges via deltas, never absolute overwrites.
    const stock = await tx.productStock.upsert({
      where: { storeId_productId_batchId: { storeId: device.storeId, productId, batchId } },
      update: { quantity: { increment: delta } },
      create: { storeId: device.storeId, productId, batchId, quantity: Math.max(0, delta) },
    })

    const created = await tx.quantityAdjustment.create({
      data: {
        syncId,
        storeId: device.storeId,
        batchId,
        stockId: stock.id,
        previousQuantity,
        adjustedQuantity,
        reason: (data.reason as string) ?? null,
        createdBy: (data.createdBy as number) ?? null,
      },
    })
    return { serverId: created.id, status: 'applied' }
  },

  cash_logs: async (tx, device, { syncId, op, data }) => {
    if (op === 'delete') throw new Error('cash_logs cannot be deleted')
    // Insert-only drawer fact (paid-in / paid-out); duplicates are no-ops.
    const existing = await tx.cashLog.findUnique({ where: { syncId } })
    if (existing) return { serverId: existing.id, status: 'applied' }

    const sessionId = await resolveSyncId(tx, 'posSession', data.sessionSyncId as string | undefined)
    const contactId = await resolveSyncId(tx, 'contact', data.contactSyncId as string | undefined)
    const amount = Number(data.amount ?? 0)
    const transactionType = data.transactionType === 'cash_out' ? 'cash_out' : 'cash_in'
    if (amount <= 0) throw new Error('cash_logs amount must be positive')

    const created = await tx.cashLog.create({
      data: {
        syncId,
        storeId: device.storeId,
        sessionId,
        contactId,
        transactionDate: data.transactionDate ? new Date(data.transactionDate as string) : new Date(),
        transactionType,
        amount,
        source: (data.source as never) ?? (transactionType === 'cash_in' ? 'deposit' : 'withdrawal'),
        description: (data.description as string) ?? null,
        createdBy: (data.createdBy as number) ?? null,
      },
    })

    // A cash-in against a customer is a debt repayment: it reduces what the
    // customer owes (same server-accumulated balance as debt sales).
    if (contactId && transactionType === 'cash_in' && data.source === 'deposit') {
      await tx.contact.update({
        where: { id: contactId },
        data: { balance: { decrement: amount } },
      })
    }
    return { serverId: created.id, status: 'applied' }
  },

  users: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const existing = await tx.user.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.user.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date(), isActive: false } : (pick(data, USER_FIELDS) as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.user.create({
      data: {
        syncId,
        storeId: device.storeId,
        // Offline-created employees have no password yet; an empty hash can
        // never match bcrypt.compare, so the account is PIN/offline-only until
        // an admin sets a real password server-side.
        passwordHash: (data.passwordHash as string) ?? '',
        ...(pick(data, USER_FIELDS) as object),
      } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  purchases: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    if (op === 'delete') {
      const existing = await tx.purchase.findUnique({ where: { syncId } })
      if (existing) await tx.purchase.update({ where: { syncId }, data: { deletedAt: new Date() } })
      return { serverId: existing?.id ?? 0, status: 'applied' }
    }
    const contactId = await resolveSyncId(tx, 'contact', data.contactSyncId as string | undefined)
    const fields = { ...pick(data, PURCHASE_FIELDS), contactId }
    const existing = await tx.purchase.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.purchase.update({ where: { syncId }, data: fields as never })
      return { serverId: existing.id, status: 'applied' }
    }
    const created = await tx.purchase.create({
      data: { syncId, storeId: device.storeId, ...fields } as never,
    })
    const items = (data.items as Array<Record<string, unknown>>) ?? []
    for (const item of items) {
      const batchId = await resolveSyncId(tx, 'productBatch', item.batchSyncId as string | undefined)
      await tx.purchaseItem.create({
        data: {
          syncId: (item.syncId as string) ?? undefined,
          purchaseId: created.id,
          batchId,
          description: (item.description as string) ?? '',
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.unitPrice ?? 0),
          unitCost: Number(item.unitCost ?? 0),
          discount: Number(item.discount ?? 0),
          createdBy: (item.createdBy as number) ?? null,
        } as never,
      })
    }
    return { serverId: created.id, status: 'applied' }
  },
}

export async function pushChangesV2(
  device: DeviceCtx,
  changes: SyncV2Change[]
): Promise<SyncV2PushResponse> {
  const results: SyncV2ChangeResult[] = []
  const changedTables = new Set<string>()

  for (const change of changes) {
    const handler = PUSH_HANDLERS[change.table]
    if (!handler) {
      results.push({ syncId: change.syncId, status: 'error', error: `Unknown table: ${change.table}` })
      continue
    }
    try {
      // One transaction per change: a bad change fails alone and the client
      // retries it after the next pull (e.g. once a missing FK has synced).
      const outcome = await prisma.$transaction((tx) => handler(tx, device, change))
      results.push({ syncId: change.syncId, status: outcome.status, serverId: outcome.serverId })
      if (outcome.status === 'applied') changedTables.add(change.table)
    } catch (err: unknown) {
      results.push({
        syncId: change.syncId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  if (changedTables.size > 0) {
    broadcastToStore(device.storeId, 'sync:changed', { tables: [...changedTables] })
  }

  return { results, serverTime: dayjs().toISOString() }
}

// ---------------------------------------------------------------------------
// Sales push
// ---------------------------------------------------------------------------

export async function pushSalesV2(
  device: DeviceCtx,
  sales: SyncV2SalePayload[]
): Promise<SyncV2SalesPushResponse> {
  const synced: SyncV2SalesPushResponse['synced'] = []
  const errors: SyncV2SalesPushResponse['errors'] = []
  const broadcasts: Array<() => void> = []

  for (const sale of sales) {
    try {
      const existing = await prisma.sale.findUnique({ where: { syncId: sale.syncId } })
      if (existing) {
        synced.push({ syncId: sale.syncId, serverId: existing.id, invoiceNumber: existing.invoiceNumber })
        continue
      }

      const created = await prisma.$transaction(async (tx) => {
        const device_ = await tx.device.findUniqueOrThrow({ where: { id: device.deviceId } })
        const userId =
          (await resolveSyncId(tx, 'user', sale.userSyncId)) ?? device_.registeredBy
        if (!userId) throw new Error('Cannot resolve sale user (no userSyncId, device has no registrant)')
        const sessionId = await resolveSyncId(tx, 'posSession', sale.sessionSyncId)
        if (!sessionId) throw new Error('Cannot resolve sessionSyncId (push pos_sessions first)')
        const contactId = await resolveSyncId(tx, 'contact', sale.contactSyncId)
        const referenceId = await resolveSyncId(tx, 'sale', sale.referenceSyncId)

        const profitAmount = sale.items.reduce(
          (sum, item) => sum + (item.unitPrice - (item.unitCost ?? 0)) * item.quantity,
          0
        )

        const newSale = await tx.sale.create({
          data: {
            syncId: sale.syncId,
            storeId: device.storeId,
            sessionId,
            contactId,
            userId,
            deviceId: device.deviceId,
            invoiceNumber: sale.invoiceNumber,
            saleType: sale.saleType as never,
            referenceId,
            saleDate: new Date(sale.saleDate),
            saleTime: new Date(sale.saleDate),
            subtotal: sale.subtotal,
            discount: sale.discount,
            totalChargeAmount: sale.totalChargeAmount,
            totalAmount: sale.totalAmount,
            amountReceived: sale.amountReceived,
            changeAmount: sale.changeAmount,
            profitAmount,
            status: sale.status as never,
            paymentStatus: sale.paymentStatus as never,
            note: sale.note ?? null,
          },
        })

        for (const item of sale.items) {
          const productId = await resolveSyncId(tx, 'product', item.productSyncId)
          const batchId = await resolveSyncId(tx, 'productBatch', item.batchSyncId)

          await tx.saleItem.create({
            data: {
              syncId: item.syncId ?? undefined,
              saleId: newSale.id,
              itemType: (item.itemType ?? 'product') as never,
              productId,
              batchId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCost: item.unitCost ?? 0,
              discount: item.discount ?? 0,
              flatDiscount: item.flatDiscount ?? 0,
              isFree: item.isFree ?? false,
            } as never,
          })

          if (item.itemType !== 'charge' && productId && batchId) {
            // Clamp at zero instead of going negative; the discrepancy is loud
            // in logs but must not corrupt stock into negative territory.
            const stock = await tx.productStock.findUnique({
              where: { storeId_productId_batchId: { storeId: device.storeId, productId, batchId } },
            })
            if (stock) {
              // Returns put stock back; sales take it out (parity with the
              // REST checkout's return handling).
              const delta = sale.saleType === 'return' ? item.quantity : -item.quantity
              const current = Number(stock.quantity)
              const newQty = Math.max(0, current + delta)
              if (current + delta < 0) {
                console.warn(
                  `[syncV2] Stock discrepancy: store=${device.storeId} product=${productId} batch=${batchId} had ${current}, sale ${sale.invoiceNumber} took ${item.quantity}; clamped to 0`
                )
              }
              await tx.productStock.update({
                where: { id: stock.id },
                data: { quantity: newQty },
              })
              broadcasts.push(() =>
                broadcastStockUpdated(device.storeId, { productId, batchId, newQty })
              )
            }
          }
        }

        for (const payment of sale.payments) {
          await tx.paymentTransaction.create({
            data: {
              syncId: payment.syncId ?? undefined,
              saleId: newSale.id,
              storeId: device.storeId,
              contactId,
              sessionId,
              amount: payment.amount,
              paymentMethod: payment.paymentMethod as never,
              transactionType: (payment.transactionType ?? 'sale') as never,
              chargeState: 'FULLY_CHARGED',
              note: payment.note ?? null,
            } as never,
          })
        }

        // Debt travels as a delta on the customer's balance (same philosophy
        // as stock): the server accumulates it here, clients receive it back
        // via contact pulls.
        const debtTotal = sale.payments
          .filter((p) => p.paymentMethod === 'Debt')
          .reduce((s, p) => s + p.amount, 0)
        if (debtTotal !== 0 && contactId) {
          // Payment amounts carry their sign (returns are stored with negative
          // amounts), so the increment is applied as-is: a Debt sale raises
          // what the customer owes, a Debt-refunded return lowers it.
          await tx.contact.update({
            where: { id: contactId },
            data: { balance: { increment: debtTotal } },
          })
        }

        const cashPaid = sale.payments
          .filter((p) => p.paymentMethod === 'Cash')
          .reduce((s, p) => s + p.amount, 0)
        if (cashPaid > 0) {
          await tx.cashLog.create({
            data: {
              storeId: device.storeId,
              sessionId,
              transactionDate: new Date(sale.saleDate),
              transactionType: 'cash_in',
              amount: cashPaid,
              source: 'sale',
              description: `Sale ${sale.invoiceNumber}`,
              referenceId: newSale.id,
            },
          })
        }

        return newSale
      })

      broadcasts.push(() =>
        broadcastSaleCompleted(device.storeId, {
          saleId: created.id,
          invoiceNumber: created.invoiceNumber,
          terminalId: `device:${device.deviceId}`,
          total: Number(created.totalAmount),
          paymentMethod: sale.payments[0]?.paymentMethod ?? 'Cash',
        })
      )
      synced.push({ syncId: sale.syncId, serverId: created.id, invoiceNumber: created.invoiceNumber })
    } catch (err: unknown) {
      errors.push({
        syncId: sale.syncId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  // Emit only after all transactions committed.
  for (const fire of broadcasts) fire()
  if (synced.length > 0) {
    broadcastToStore(device.storeId, 'sync:changed', {
      tables: ['sales', 'product_stocks'],
    })
  }

  return { synced, errors, serverTime: dayjs().toISOString() }
}

// ---------------------------------------------------------------------------
// Invoice range leasing
// ---------------------------------------------------------------------------

export async function leaseInvoiceRange(
  device: DeviceCtx,
  count: number
): Promise<InvoiceRangeResponse> {
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new Error('count must be an integer between 1 and 10000')
  }

  return prisma.$transaction(async (tx) => {
    // The store row update is atomic; concurrent leases serialize on it.
    const store = await tx.store.update({
      where: { id: device.storeId },
      data: { currentSaleNumber: { increment: count } },
    })
    const end = store.currentSaleNumber
    const start = end - count + 1

    await tx.device.update({
      where: { id: device.deviceId },
      data: { invoiceRangeStart: start, invoiceRangeEnd: end, invoiceRangeNext: start },
    })

    return { prefix: store.salePrefix, start, end }
  })
}
