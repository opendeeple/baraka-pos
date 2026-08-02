import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import { listPurchases, getPurchase, createPurchase, receivePurchase } from './purchases.service'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, page } = req.query
    const result = await listPurchases(req.user!.storeId, {
      status: status as string,
      page: page ? Number(page) : 1,
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const purchase = await getPurchase(Number(req.params.id), req.user!.storeId)
    if (!purchase) return res.status(404).json({ error: 'Not found' })
    res.json(purchase)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/', requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const purchase = await createPurchase(req.user!.storeId, req.body, req.user!.userId)
    res.status(201).json(purchase)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id/receive', requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const purchase = await receivePurchase(Number(req.params.id), req.user!.storeId)
    res.json(purchase)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
