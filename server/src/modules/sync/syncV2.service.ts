import { CashLogSource, Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { prisma } from '../../config/database'
import { broadcastSaleCompleted, broadcastStockUpdated, broadcastToStore } from '../../socket'
import { touchDevice } from '../../middleware/deviceAuth.middleware'
import { SHARED_SETTING_KEYS } from '@baraka/shared'
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
  platform?: string
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
    // The Telegram chat a customer linked by tapping /start — learnt by
    // whichever back office polls the bot and pushed from there, so every
    // till can message that customer. Sent only once known: null here means
    // "not learnt yet", never "unlinked", and a null would wipe a device's own
    // copy that hasn't been pushed yet (older builds overwrite on pull).
    map: ({ telegramChatId, ...row }) => (telegramChatId ? { ...row, telegramChatId } : row),
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
          badgeCode: true,
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
    // Devices call the category `category` and keep the date date-only
    // (their filters compare 'YYYY-MM-DD' strings).
    map: ({ session, source, ...row }) => ({
      ...row,
      category: source ?? 'Other',
      expenseDate: row.expenseDate instanceof Date ? row.expenseDate.toISOString().slice(0, 10) : row.expenseDate,
      sessionSyncId: session?.syncId ?? null,
    }),
  },
  audit_logs: {
    fetch: (storeId, where, take) =>
      prisma.auditLog.findMany({
        where: { storeId, ...where },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
  },
  purchases: {
    fetch: (storeId, where, take) =>
      prisma.purchase.findMany({
        where: { storeId, ...where },
        include: {
          contact: { select: { syncId: true } },
          items: { include: { batch: { select: { syncId: true, product: { select: { syncId: true } } } } } },
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
        productSyncId: batch?.product?.syncId ?? null,
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
      // When the sale happened (the selling device's clock), not when the
      // server received it — devices compare it with debt-clearance cut-offs
      // stamped by device clocks, and an offline push can land hours later.
      createdAt: row.saleTime ?? row.createdAt,
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
  // Only customer debt repayments (a cash-in against a contact), which every
  // device needs for that customer's debt history. Desktop pushes its
  // 'debt_payment' rows as 'deposit' (see the cash_logs push handler), so this
  // is the whole repayment set. Drawer movements and the server's own per-sale
  // cash rows stay out: they're per-terminal facts, and the per-sale rows have
  // no client-side twin, so pulling them would double-count cash.
  cash_logs: {
    fetch: (storeId, where, take) =>
      prisma.cashLog.findMany({
        where: { storeId, contactId: { not: null }, transactionType: 'cash_in', source: 'deposit', ...where },
        include: {
          contact: { select: { syncId: true } },
          session: { select: { syncId: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    // createdAt is when the server received it; the repayment happened at
    // transactionDate (the paying device's clock), which is what history
    // shows. referenceId is a server int with no meaning on a device.
    map: ({ contact, session, referenceId, ...row }) => ({
      ...row,
      createdAt: row.transactionDate,
      contactSyncId: contact?.syncId ?? null,
      sessionSyncId: session?.syncId ?? null,
    }),
  },
  debt_clearances: {
    fetch: (storeId, where, take) =>
      prisma.debtClearance.findMany({
        where: { storeId, ...where },
        include: { contact: { select: { syncId: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    // Devices call the column cleared_by (who deleted the debt).
    map: ({ contact, createdBy, ...row }) => ({ ...row, clearedBy: createdBy, contactSyncId: contact.syncId }),
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

  touchDevice(device.deviceId, 'lastPulledAt')

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
function slugify(name: string, syncId: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'category'}-${syncId.slice(0, 8)}`
}

const CONTACT_FIELDS = ['name', 'email', 'phone', 'whatsapp', 'address', 'type', 'notes', 'metaData']
const COLLECTION_FIELDS = ['collectionType', 'name', 'description', 'sortOrder']
const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcode', 'imageUrl', 'unit', 'unitsPerPackage', 'productType', 'isStockManaged', 'isActive', 'isFeatured', 'alertQuantity', 'discount', 'metaData']
const BATCH_FIELDS = ['batchNumber', 'expiryDate', 'cost', 'price', 'discount', 'isActive', 'isFeatured']
const EXPENSE_FIELDS = ['description', 'amount', 'expenseDate', 'source', 'createdBy']
const SESSION_FIELDS = ['terminalId', 'state', 'openingBalance', 'closingBalanceTheoretical', 'closingBalanceActual', 'variance', 'openedAt', 'closedAt']
const USER_FIELDS = ['name', 'email', 'username', 'role', 'pinCode', 'badgeCode', 'isActive']
const CASH_LOG_SOURCES = new Set<string>(Object.values(CashLogSource))
// Settings that are the same for the whole store (@baraka/shared). Printer,
// paper layout and UI language stay per device and are never pushed.
const SHARED_SETTINGS = new Set(SHARED_SETTING_KEYS)
// amountPaid / paymentStatus are absent: they follow from supplier payments
// (allocateSupplierPayment), never from a device's absolute copy.
const PURCHASE_FIELDS = ['purchaseDate', 'referenceNo', 'totalAmount', 'discount', 'status', 'note', 'createdBy']

const PUSH_HANDLERS: Record<string, PushHandler> = {
  contacts: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    // A linked Telegram chat only ever gets set (see the pull map above); a
    // device that doesn't know it sends null, which must not unlink it.
    const fields = {
      ...pick(data, CONTACT_FIELDS),
      ...(typeof data.telegramChatId === 'string' && data.telegramChatId ? { telegramChatId: data.telegramChatId } : {}),
    }
    const existing = await tx.contact.findUnique({ where: { syncId } })
    if (existing) {
      // Learning the chat is never stale: it can only fill a blank.
      if (isStale(existing.updatedAt, clientUpdatedAt)) {
        if (fields.telegramChatId && !existing.telegramChatId) {
          await tx.contact.update({ where: { syncId }, data: { telegramChatId: fields.telegramChatId as string } })
          return { serverId: existing.id, status: 'applied' }
        }
        return { serverId: existing.id, status: 'skipped-stale' }
      }
      await tx.contact.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : (fields as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.contact.create({
      data: { syncId, storeId: device.storeId, ...(fields as object) } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  collections: async (tx, _device, { syncId, op, data, clientUpdatedAt }) => {
    const parentId = await resolveSyncId(tx, 'collection', data.parentSyncId as string | undefined)
    const fields = { ...pick(data, COLLECTION_FIELDS), parentId }
    const existing = await tx.collection.findUnique({ where: { syncId } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.collection.update({
        where: { syncId },
        data: op === 'delete' ? { deletedAt: new Date() } : (fields as never),
      })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const name = data.name as string | undefined
    const created = await tx.collection.create({
      data: {
        syncId,
        collectionType: (data.collectionType as 'category' | 'brand' | 'tag' | undefined) ?? 'category',
        slug: slugify(name ?? '', syncId),
        ...fields,
      } as never,
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
      if (op === 'delete') {
        // Cascade so other devices' next pull tombstones these batches too —
        // otherwise they linger as "still active" server-side and a later
        // product that recycles the deleted product's local SQLite id
        // silently inherits them (fans out into duplicate rows wherever a
        // product is joined to its active batch).
        await tx.productBatch.updateMany({ where: { productId: existing.id, deletedAt: null }, data: { deletedAt: new Date() } })
        await tx.product.update({ where: { syncId }, data: { deletedAt: new Date() } })
      } else {
        await tx.product.update({ where: { syncId }, data: fields as never })
      }
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
    // Older clients (pre-warehouse-module) never send this — 'shop' matches
    // the only location that existed before.
    const location = (data.location as string) || 'shop'

    // Stock converges via deltas, never absolute overwrites.
    const stock = await applyStockDelta(tx, { storeId: device.storeId, productId, batchId, location }, delta)

    const created = await tx.quantityAdjustment.create({
      data: {
        syncId,
        storeId: device.storeId,
        batchId,
        stockId: stock.stockId,
        previousQuantity,
        adjustedQuantity,
        reason: (data.reason as string) ?? null,
        createdBy: (data.createdBy as number) ?? null,
        location,
        kind: typeof data.kind === 'string' ? data.kind : null,
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
    // Clients send sources the enum doesn't have (desktop debt repayments are
    // 'debt_payment'); passing one through made Prisma reject the row on every
    // retry until it dead-lettered, so repayments never reached the server.
    const source = CASH_LOG_SOURCES.has(data.source as string)
      ? (data.source as CashLogSource)
      : transactionType === 'cash_in' ? 'deposit' : 'withdrawal'

    const created = await tx.cashLog.create({
      data: {
        syncId,
        storeId: device.storeId,
        sessionId,
        contactId,
        transactionDate: data.transactionDate ? new Date(data.transactionDate as string) : new Date(),
        transactionType,
        amount,
        source,
        paymentMethod: typeof data.paymentMethod === 'string' ? data.paymentMethod : null,
        description: (data.description as string) ?? null,
        createdBy: (data.createdBy as number) ?? null,
      },
    })

    // A cash-in against a customer is a debt repayment: it reduces what the
    // customer owes (same server-accumulated balance as debt sales).
    if (contactId && transactionType === 'cash_in' && (data.source === 'deposit' || data.source === 'debt_payment')) {
      await tx.contact.update({
        where: { id: contactId },
        data: { balance: { decrement: amount } },
      })
    }
    // Paid out to a supplier: it settles their received orders.
    if (contactId && transactionType === 'cash_out' && source === 'purchase') {
      await allocateSupplierPayment(tx, device.storeId, contactId, amount)
    }
    return { serverId: created.id, status: 'applied' }
  },

  // Store-wide settings (receipt text, Telegram/SMS, reminders, owner PIN …)
  // so every till and office behaves the same. Device-specific ones (printer,
  // paper layout, language) never come here — see SHARED_SETTING_KEYS.
  settings: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const metaKey = String(data.metaKey ?? '')
    if (!SHARED_SETTINGS.has(metaKey)) return { serverId: 0, status: 'skipped-stale' }
    const existing = await tx.setting.findUnique({ where: { storeId_metaKey: { storeId: device.storeId, metaKey } } })
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      if (op === 'delete') await tx.setting.delete({ where: { id: existing.id } })
      else await tx.setting.update({ where: { id: existing.id }, data: { metaValue: (data.metaValue ?? '') as never } })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.setting.create({
      data: { syncId, storeId: device.storeId, metaKey, metaValue: (data.metaValue ?? '') as never },
    })
    return { serverId: created.id, status: 'applied' }
  },

  // The device's own store: name/address/phone print on every receipt.
  // No last-writer-wins check: the store row's updatedAt also moves with every
  // invoice-range lease, so it says nothing about when these fields changed.
  stores: async (tx, device, { data }) => {
    const store = await tx.store.findUniqueOrThrow({ where: { id: device.storeId } })
    await tx.store.update({ where: { id: store.id }, data: pick(data, ['name', 'address', 'phone']) as never })
    return { serverId: store.id, status: 'applied' }
  },

  // Service charges switched on/off in Settings apply on every till.
  charges: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    const existing = await tx.charge.findUnique({ where: { syncId } })
    const fields = pick(data, ['name', 'rateValue', 'description', 'isActive', 'isDefault'])
    if (existing) {
      if (isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      await tx.charge.update({ where: { syncId }, data: (op === 'delete' ? { isActive: false } : fields) as never })
      return { serverId: existing.id, status: 'applied' }
    }
    if (op === 'delete') return { serverId: 0, status: 'applied' }
    const created = await tx.charge.create({
      data: {
        syncId, storeId: device.storeId,
        chargeType: (data.chargeType as never) ?? 'custom',
        rateType: (data.rateType as never) ?? 'percentage',
        ...fields,
      } as never,
    })
    return { serverId: created.id, status: 'applied' }
  },

  audit_logs: async (tx, device, { syncId, op, data }) => {
    if (op === 'delete') throw new Error('audit_logs cannot be deleted')
    const existing = await tx.auditLog.findUnique({ where: { syncId } })
    if (existing) return { serverId: existing.id, status: 'applied' }
    let details: unknown = data.details ?? null
    if (typeof details === 'string') { try { details = JSON.parse(details) } catch { /* keep as text */ } }
    const userId = Number(data.userId)
    const created = await tx.auditLog.create({
      data: {
        syncId,
        storeId: device.storeId,
        action: String(data.action ?? 'unknown'),
        entity: (data.entity as string) ?? null,
        entityId: data.entityId == null ? null : String(data.entityId),
        details: details as never,
        userId: Number.isInteger(userId) && userId > 0 ? userId : null,
        userName: (data.userName as string) ?? null,
        occurredAt: data.occurredAt ? new Date(data.occurredAt as string) : new Date(),
      },
    })
    return { serverId: created.id, status: 'applied' }
  },

  debt_clearances: async (tx, device, { syncId, op, data }) => {
    if (op === 'delete') throw new Error('debt_clearances cannot be deleted')
    // Insert-only fact (a cut-off timestamp); duplicates are no-ops. Accepted
    // even if the balance here is above 0 by now — debt added after
    // clearedAt still shows everywhere, and rejecting would only strand the
    // clearing device's row in retries.
    const existing = await tx.debtClearance.findUnique({ where: { syncId } })
    if (existing) return { serverId: existing.id, status: 'applied' }

    const contactId = await resolveSyncId(tx, 'contact', data.contactSyncId as string | undefined)
    if (!contactId) throw new Error('debt_clearances push requires contactSyncId')
    const clearedBy = Number(data.clearedBy)

    const created = await tx.debtClearance.create({
      data: {
        syncId,
        storeId: device.storeId,
        contactId,
        clearedAt: data.clearedAt ? new Date(data.clearedAt as string) : new Date(),
        totalDebt: Number(data.totalDebt ?? 0),
        totalPaid: Number(data.totalPaid ?? 0),
        createdBy: Number.isInteger(clearedBy) && clearedBy > 0 ? clearedBy : null,
      },
    })
    return { serverId: created.id, status: 'applied' }
  },

  // Staff come from the back office (pushChangesV2 refuses this table from a
  // till). Even so a device can't hand out or touch the owner account, and
  // never sets a password: those only change on the server.
  users: async (tx, device, { syncId, op, data, clientUpdatedAt }) => {
    if (data.role === 'super_admin') throw new Error('The super_admin role cannot be assigned from a device')
    const existing = await tx.user.findUnique({ where: { syncId } })
    if (existing) {
      if (existing.role === 'super_admin') throw new Error('The owner account cannot be changed from a device')
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
        // Offline-created employees have no password; an empty hash can never
        // match bcrypt.compare, so the account is PIN/badge-only until an
        // admin sets a real password server-side.
        passwordHash: '',
        // Back-office employees have no login name (they sign in with their
        // badge); username is required + unique, so derive one from syncId.
        username: `emp-${syncId.slice(0, 8)}`,
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
    // Only builds with the receiving workflow send receivedLocation; for them
    // the server puts the goods into stock. Older builds push their own
    // quantity_adjustments for that, so their 'received' stays a plain flag.
    const location = data.receivedLocation as string | undefined
    const receivesHere = data.status === 'received' && RECEIVE_LOCATIONS.has(location ?? '')
    const existing = await tx.purchase.findUnique({ where: { syncId } })
    if (existing) {
      const receiving = receivesHere && existing.status !== 'received'
      // A receipt must land even if another device edited the order since.
      if (!receiving && isStale(existing.updatedAt, clientUpdatedAt)) return { serverId: existing.id, status: 'skipped-stale' }
      // A received order never reopens: a second device's late copy can
      // neither flip it back nor receive it (and its stock) again.
      const update = existing.status === 'received' ? { ...fields, status: undefined } : fields
      await tx.purchase.update({ where: { syncId }, data: update as never })
      if (receiving) await applyPurchaseReceipt(tx, device, existing.id, data, location!)
      return { serverId: existing.id, status: 'applied' }
    }
    const created = await tx.purchase.create({
      data: { syncId, storeId: device.storeId, ...fields } as never,
    })
    const items = (data.items as Array<Record<string, unknown>>) ?? []
    for (const item of items) {
      const batchId = await resolveSyncId(tx, 'productBatch', item.batchSyncId as string | undefined)
      const productId = (await resolveSyncId(tx, 'product', item.productSyncId as string | undefined))
        ?? (batchId ? (await tx.productBatch.findUnique({ where: { id: batchId }, select: { productId: true } }))?.productId ?? null : null)
      await tx.purchaseItem.create({
        data: {
          syncId: (item.syncId as string) ?? undefined,
          purchaseId: created.id,
          productId,
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
    // Ordered and received offline in one go: first push already carries the receipt.
    if (receivesHere) await applyPurchaseReceipt(tx, device, created.id, data, location!)
    return { serverId: created.id, status: 'applied' }
  },
}

type StockKey = { storeId: number; productId: number; batchId: number; location: string }

/**
 * The one way the server moves stock: the row is locked, the change applied
 * to what's there at that moment, and the result never goes below zero (the
 * shop's rule: goods are in the system before they're sold). Reading a figure
 * and writing back an absolute one lost one of two sales pushed at the same
 * time; with the lock the second waits for the first and sees its result.
 */
async function applyStockDelta(
  tx: Tx,
  key: StockKey,
  delta: number
): Promise<{ stockId: number; previous: number; current: number }> {
  const row = await tx.productStock.upsert({
    where: { storeId_productId_batchId_location: key },
    update: {},
    create: { ...key, quantity: 0 },
    select: { id: true },
  })
  const [locked] = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
    SELECT quantity FROM product_stocks WHERE id = ${row.id} FOR UPDATE`
  const previous = Number(locked?.quantity ?? 0)
  const current = Math.max(0, previous + delta)
  if (current !== previous) await tx.productStock.update({ where: { id: row.id }, data: { quantity: current } })
  return { stockId: row.id, previous, current }
}

/**
 * Undoes everything a sale did: its goods go back on the shop shelf (a voided
 * return takes them off again), the debt it put on a customer comes off, and
 * the cash it brought into the drawer goes back out. Called only on the
 * transition into 'cancelled', so it runs once per sale.
 */
async function voidSaleEffects(tx: Tx, storeId: number, saleId: number): Promise<void> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true, payments: true } })
  const isReturn = sale.saleType === 'return'
  for (const item of sale.items) {
    if (item.itemType === 'charge' || !item.productId || !item.batchId) continue
    const qty = Math.abs(Number(item.quantity))
    const delta = isReturn ? -qty : qty
    const key = { storeId, productId: item.productId, batchId: item.batchId, location: 'shop' }
    const stock = await applyStockDelta(tx, key, delta)
    await tx.quantityAdjustment.create({
      data: {
        storeId, batchId: item.batchId, stockId: stock.stockId, previousQuantity: stock.previous,
        adjustedQuantity: stock.current, reason: `Void ${sale.invoiceNumber}`, location: 'shop', kind: 'sale_void',
      },
    })
  }
  const debt = sale.payments.filter((p) => p.paymentMethod === 'Debt').reduce((s, p) => s + Number(p.amount), 0)
  if (debt !== 0 && sale.contactId) {
    await tx.contact.update({ where: { id: sale.contactId }, data: { balance: { decrement: debt } } })
  }
  const cash = sale.payments.filter((p) => p.paymentMethod === 'Cash').reduce((s, p) => s + Number(p.amount), 0)
    - (isReturn ? 0 : Number(sale.changeAmount))
  if (cash !== 0) {
    await tx.cashLog.create({
      data: {
        storeId, sessionId: sale.sessionId, transactionType: cash > 0 ? 'cash_out' : 'cash_in',
        amount: Math.abs(cash), source: 'sale', description: `Void ${sale.invoiceNumber}`, referenceId: sale.id,
      },
    })
  }
  await tx.sale.update({ where: { id: saleId }, data: { status: 'cancelled', deletedAt: new Date() } })
}

const RECEIVE_LOCATIONS = new Set(['shop', 'warehouse'])

/**
 * Puts a received purchase's goods into stock. Callers invoke it only on the
 * transition into 'received', so it runs once per purchase no matter how
 * many devices receive the same order. Per line, what actually arrived
 * (receivedQuantity, else the ordered quantity) lands in `location` as a
 * stock increment plus an audit adjustment row, and the batch's cost price
 * follows what the order says was paid. Peers see it through their next
 * product_stocks pull, which the push's sync:changed broadcast triggers.
 */
async function applyPurchaseReceipt(
  tx: Tx,
  device: DeviceCtx,
  purchaseId: number,
  data: Record<string, unknown>,
  location: string
): Promise<void> {
  const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { items: true } })
  const sent = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
  const batchIdBySyncId = new Map<string, number>()
  for (const s of sent) {
    const key = s.batchSyncId as string | undefined
    if (!key || batchIdBySyncId.has(key)) continue
    const id = await resolveSyncId(tx, 'productBatch', key).catch(() => null)
    if (id) batchIdBySyncId.set(key, id)
  }
  const receivedBy = Number(data.receivedBy)
  const createdBy = Number.isInteger(receivedBy) && receivedBy > 0 ? receivedBy : null
  const used = new Set<Record<string, unknown>>()

  for (const item of purchase.items) {
    // The device's copy of this line: same syncId, else same batch (lines
    // pushed by older builds got a server-minted syncId the device never saw).
    const mine =
      sent.find((s) => !used.has(s) && s.syncId === item.syncId) ??
      sent.find((s) => !used.has(s) && item.batchId != null && batchIdBySyncId.get(s.batchSyncId as string) === item.batchId)
    if (mine) used.add(mine)
    const sentQty = mine?.receivedQuantity
    const received = sentQty != null && Number.isFinite(Number(sentQty)) ? Math.max(0, Number(sentQty)) : Number(item.quantity)
    const note = typeof mine?.discrepancyNote === 'string' && mine.discrepancyNote.trim() ? mine.discrepancyNote.trim() : null
    // The price on the supplier's invoice, when the receiver corrected the
    // order's estimate; it's what the supplier is owed and what the goods cost.
    const sentCost = Number(mine?.unitCost)
    const unitCost = Number.isFinite(sentCost) && sentCost >= 0 && mine?.unitCost != null ? sentCost : Number(item.unitCost)
    const expiry = typeof mine?.expiryDate === 'string' && !Number.isNaN(Date.parse(mine.expiryDate)) ? new Date(mine.expiryDate) : null
    await tx.purchaseItem.update({
      where: { id: item.id },
      data: { receivedQuantity: received, discrepancyNote: note, unitCost, unitPrice: unitCost, expiryDate: expiry },
    })

    if (!item.batchId || received <= 0) continue
    const batch = await tx.productBatch.findUnique({ where: { id: item.batchId }, select: { productId: true, cost: true, expiryDate: true } })
    if (!batch) continue
    // Stock on hand everywhere (shop + warehouse) before this delivery — the
    // weight of the old cost price in the new average.
    const onHand = await tx.productStock.aggregate({
      where: { storeId: device.storeId, productId: batch.productId, batchId: item.batchId },
      _sum: { quantity: true },
    })
    const oldQty = Math.max(0, Number(onHand._sum.quantity ?? 0))
    const key = { storeId: device.storeId, productId: batch.productId, batchId: item.batchId, location }
    const stock = await applyStockDelta(tx, key, received)
    await tx.quantityAdjustment.create({
      data: {
        storeId: device.storeId,
        batchId: item.batchId,
        stockId: stock.stockId,
        previousQuantity: stock.previous,
        adjustedQuantity: stock.current,
        reason: `Purchase ${purchase.referenceNo ?? purchase.id} received${note ? `: ${note}` : ''}`,
        location,
        kind: 'purchase',
        createdBy,
      },
    })
    // Weighted average cost: goods already on the shelf keep what they
    // cost, the new ones add theirs — so profit isn't skewed by the latest
    // delivery's price.
    const batchUpdate: { cost?: number; expiryDate?: Date } = {}
    if (unitCost > 0) {
      const avg = oldQty > 0 ? (oldQty * Number(batch.cost) + received * unitCost) / (oldQty + received) : unitCost
      const rounded = Math.round(avg * 100) / 100
      if (rounded !== Number(batch.cost)) batchUpdate.cost = rounded
    }
    // The batch shows the nearest expiry among goods on hand: older stock
    // that expires sooner keeps its date; with nothing left, the new one counts.
    if (expiry) {
      const keepOld = oldQty > 0 && batch.expiryDate && batch.expiryDate < expiry
      if (!keepOld) batchUpdate.expiryDate = expiry
    }
    if (Object.keys(batchUpdate).length) await tx.productBatch.update({ where: { id: item.batchId }, data: batchUpdate })
  }

  await tx.purchase.update({
    where: { id: purchaseId },
    data: {
      status: 'received',
      receivedLocation: location,
      receivedAt: data.receivedAt ? new Date(data.receivedAt as string) : new Date(),
      receiptId: typeof data.receiptId === 'string' ? data.receiptId : null,
      // The total is now what actually arrived; payments made before
      // delivery count against it.
      paymentStatus: paymentStatusOf(Number(purchase.amountPaid), Number(purchase.totalAmount)),
    },
  })
}

function paymentStatusOf(paid: number, total: number): 'pending' | 'partially_paid' | 'fully_paid' {
  if (paid > 0 && paid >= total) return 'fully_paid'
  return paid > 0 ? 'partially_paid' : 'pending'
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * A supplier payment settles that supplier's received orders, oldest first —
 * worked out here from the payment itself (an insert-only cash_logs fact).
 * Orders used to carry amountPaid as an absolute figure pushed by the paying
 * device, so of two payments made around the same time on two devices the
 * later push overwrote the earlier: the cash was out, the debt not reduced.
 */
async function allocateSupplierPayment(tx: Tx, storeId: number, vendorId: number, amount: number): Promise<void> {
  const orders = await tx.purchase.findMany({
    where: { storeId, contactId: vendorId, status: 'received', deletedAt: null },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  })
  let left = round2(amount)
  for (const order of orders) {
    if (left <= 0) break
    const total = Number(order.totalAmount)
    const paidBefore = Number(order.amountPaid)
    const due = round2(total - paidBefore)
    if (due <= 0) continue
    const part = Math.min(due, left)
    left = round2(left - part)
    const paid = round2(paidBefore + part)
    await tx.purchase.update({ where: { id: order.id }, data: { amountPaid: paid, paymentStatus: paymentStatusOf(paid, total) } })
  }
}

// Staff and store-wide configuration are managed in the back office. A till's
// device key sits on a shared counter PC; through these tables it could mint
// an admin or rewrite the owner PIN, so they're refused from POS devices.
const OFFICE_ONLY_TABLES = new Set(['users', 'settings', 'stores', 'charges'])
const isOfficeDevice = (device: DeviceCtx) => !device.platform || device.platform.endsWith('-office')

// What else a pushed change alters on the server, so the sync:changed event
// names every table devices should re-pull (they pull only those).
const ALSO_CHANGES: Record<string, string[]> = {
  products: ['product_batches', 'product_stocks'],
  quantity_adjustments: ['product_stocks'],
  purchases: ['product_stocks', 'product_batches'],
  cash_logs: ['contacts', 'purchases'],
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
    if (OFFICE_ONLY_TABLES.has(change.table) && !isOfficeDevice(device)) {
      results.push({ syncId: change.syncId, status: 'error', error: `${change.table} can only be changed from the back office` })
      continue
    }
    try {
      // One transaction per change: a bad change fails alone and the client
      // retries it after the next pull (e.g. once a missing FK has synced).
      const outcome = await prisma.$transaction((tx) => handler(tx, device, change))
      results.push({ syncId: change.syncId, status: outcome.status, serverId: outcome.serverId })
      if (outcome.status === 'applied') {
        changedTables.add(change.table)
        for (const t of ALSO_CHANGES[change.table] ?? []) changedTables.add(t)
      }
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
        // Re-pushing a sale the server already has is a no-op — except a void
        // done afterwards (Back office > Sales): that undoes everything the
        // sale did, exactly once (only on the transition into cancelled).
        if (sale.status === 'cancelled' && existing.status !== 'cancelled' && existing.storeId === device.storeId) {
          await prisma.$transaction((tx) => voidSaleEffects(tx, device.storeId, existing.id))
        }
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
        // Voided on the device before it ever reached the server (offline):
        // kept for the history, but it moved no goods, debt or money — the
        // void-on-transition below never runs for a sale born cancelled.
        const bornCancelled = sale.status === 'cancelled'

        // What each line actually brought in — its own % discount and flat
        // discount off — less what the goods cost, then the sale-level
        // discount off the whole. Charges (tax) aren't profit. Returns carry
        // negative prices and costs, so theirs comes out negative.
        const profitAmount = sale.items
          .filter((item) => item.itemType !== 'charge')
          .reduce((sum, item) => {
            const qty = Number(item.quantity)
            const net = Number(item.unitPrice) * qty * (1 - Number(item.discount ?? 0) / 100) - Number(item.flatDiscount ?? 0)
            return sum + net - Number(item.unitCost ?? 0) * qty
          }, 0) - Number(sale.discount ?? 0)

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
            // Tombstoned like a server-side void, so pulls treat it the same.
            deletedAt: bornCancelled ? new Date() : null,
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

          if (!bornCancelled && item.itemType !== 'charge' && productId && batchId) {
            // Returns put stock back; sales take it out. By magnitude: a
            // return line may carry its quantity as negative (older desktop
            // builds) or positive with a negative price (Android) — either
            // way the goods come back. Never below zero (applyStockDelta);
            // the discrepancy is loud in logs.
            const qty = Math.abs(Number(item.quantity))
            const delta = sale.saleType === 'return' ? qty : -qty
            const stock = await applyStockDelta(tx, { storeId: device.storeId, productId, batchId, location: 'shop' }, delta)
            if (stock.previous + delta < 0) {
              console.warn(
                `[syncV2] Stock discrepancy: store=${device.storeId} product=${productId} batch=${batchId} had ${stock.previous}, sale ${sale.invoiceNumber} took ${qty}; clamped to 0`
              )
            }
            broadcasts.push(() =>
              broadcastStockUpdated(device.storeId, { productId, batchId, newQty: stock.current })
            )
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
        if (!bornCancelled && debtTotal !== 0 && contactId) {
          // Payment amounts carry their sign (returns are stored with negative
          // amounts), so the increment is applied as-is: a Debt sale raises
          // what the customer owes, a Debt-refunded return lowers it.
          await tx.contact.update({
            where: { id: contactId },
            data: { balance: { increment: debtTotal } },
          })
        }

        // Payment rows hold what the customer handed over; the change went
        // back out of the same drawer, so the drawer only gained the net.
        const cashPaid = sale.payments
          .filter((p) => p.paymentMethod === 'Cash')
          .reduce((s, p) => s + p.amount, 0) - (sale.saleType === 'return' ? 0 : Number(sale.changeAmount ?? 0))
        // A cash refund (negative) left the drawer just the same.
        if (!bornCancelled && cashPaid !== 0) {
          await tx.cashLog.create({
            data: {
              storeId: device.storeId,
              sessionId,
              transactionDate: new Date(sale.saleDate),
              transactionType: cashPaid > 0 ? 'cash_in' : 'cash_out',
              amount: Math.abs(cashPaid),
              source: 'sale',
              description: `${cashPaid > 0 ? 'Sale' : 'Refund'} ${sale.invoiceNumber}`,
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
      // A debt sale or refund moves the customer's balance too.
      tables: ['sales', 'product_stocks', 'contacts'],
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
