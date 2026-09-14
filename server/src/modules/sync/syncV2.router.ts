import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { deviceAuthMiddleware } from '../../middleware/deviceAuth.middleware'
import { pullTableV2, pushChangesV2, pushSalesV2, leaseInvoiceRange } from './syncV2.service'
import type { SyncV2PullTable } from '@baraka/shared'

const router = Router()

const PULL_TABLES: SyncV2PullTable[] = [
  'products', 'product_batches', 'product_stocks', 'contacts', 'collections',
  'collection_product', 'charges', 'settings', 'stores', 'users',
  'pos_sessions', 'expenses', 'purchases', 'quantity_adjustments', 'sales',
]

const PUSH_TABLES = [
  'contacts', 'products', 'product_batches', 'collections', 'expenses', 'purchases',
  'pos_sessions', 'quantity_adjustments', 'users', 'cash_logs',
] as const

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: 2, timestamp: new Date().toISOString() })
})

router.use(deviceAuthMiddleware)

router.get('/pull', async (req: Request, res: Response) => {
  try {
    const table = req.query.table as SyncV2PullTable
    if (!PULL_TABLES.includes(table)) {
      return res.status(400).json({ error: `Unknown table: ${table}` })
    }
    const cursor = (req.query.cursor as string) || undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const result = await pullTableV2(req.device!, table, cursor, limit)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Pull failed'
    res.status(400).json({ error: msg })
  }
})

const changeSchema = z.object({
  table: z.enum(PUSH_TABLES),
  syncId: z.string().uuid(),
  op: z.enum(['upsert', 'delete']),
  data: z.record(z.unknown()),
  clientUpdatedAt: z.string().datetime({ offset: true }),
})

const pushSchema = z.object({
  changes: z.array(changeSchema).max(500),
})

router.post('/push', async (req: Request, res: Response) => {
  try {
    const body = pushSchema.parse(req.body)
    const result = await pushChangesV2(req.device!, body.changes as never)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Push failed'
    res.status(400).json({ error: msg })
  }
})

const salesSchema = z.object({
  sales: z
    .array(
      z.object({
        syncId: z.string().uuid(),
        invoiceNumber: z.string().min(1),
        items: z.array(z.record(z.unknown())).min(1),
        payments: z.array(z.record(z.unknown())),
      }).passthrough()
    )
    .max(100),
})

router.post('/sales', async (req: Request, res: Response) => {
  try {
    const body = salesSchema.parse(req.body)
    const result = await pushSalesV2(req.device!, body.sales as never)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sales push failed'
    res.status(400).json({ error: msg })
  }
})

const invoiceRangeSchema = z.object({ count: z.number().int().min(1).max(10000) })

router.post('/invoice-range', async (req: Request, res: Response) => {
  try {
    const { count } = invoiceRangeSchema.parse(req.body)
    const result = await leaseInvoiceRange(req.device!, count)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invoice range lease failed'
    res.status(400).json({ error: msg })
  }
})

export default router
