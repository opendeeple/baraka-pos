import { Router, Request, Response } from 'express'
import { apiKeyMiddleware } from '../../middleware/apiKey.middleware'
import { authMiddleware } from '../../middleware/auth.middleware'
import { pullTable, pushSales } from './sync.service'
import { SyncEntityType } from '@baraka/shared'

const router = Router()

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

router.get(
  '/',
  apiKeyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { table, last_sync, store_id } = req.query
      const result = await pullTable(
        table as SyncEntityType,
        Number(store_id),
        last_sync as string | undefined
      )
      res.json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      res.status(400).json({ error: msg })
    }
  }
)

router.post(
  '/sales',
  apiKeyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { storeId, terminalId, sales } = req.body
      const result = await pushSales(storeId, terminalId, sales)
      res.json(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync push failed'
      res.status(400).json({ error: msg })
    }
  }
)

export default router
