import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { checkout, listSales, getSale, voidSale } from './sales.service'

const router = Router()
router.use(authMiddleware)

router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const sale = await checkout(req.body, req.user!.userId)
    res.json(sale)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Checkout failed' })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, status, page } = req.query
    const result = await listSales(req.user!.storeId, {
      dateFrom: date_from as string,
      dateTo: date_to as string,
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
    const sale = await getSale(Number(req.params.id), req.user!.storeId)
    if (!sale) return res.status(404).json({ error: 'Not found' })
    res.json(sale)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id/void', async (req: Request, res: Response) => {
  try {
    const sale = await voidSale(Number(req.params.id), req.user!.storeId, req.user!.userId)
    res.json(sale)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
