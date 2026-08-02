import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import {
  getDailySummary, getTopProducts, getCategorySales,
  getHourlySales, getLowStockReport, getDashboardSummary,
} from './reports.service'

const router = Router()
router.use(authMiddleware)

router.get('/daily', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0]
    const data = await getDailySummary(req.user!.storeId, date)
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/top-products', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, limit } = req.query
    const today = new Date().toISOString().split('T')[0]
    const data = await getTopProducts(
      req.user!.storeId,
      (date_from as string) || today,
      (date_to as string) || today,
      limit ? Number(limit) : 10
    )
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/category-sales', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query
    const today = new Date().toISOString().split('T')[0]
    const data = await getCategorySales(
      req.user!.storeId,
      (date_from as string) || today,
      (date_to as string) || today
    )
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/hourly', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0]
    const data = await getHourlySales(req.user!.storeId, date)
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/dashboard-summary', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0]
    const data = await getDashboardSummary(req.user!.storeId, date)
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/low-stock', async (req: Request, res: Response) => {
  try {
    const data = await getLowStockReport(req.user!.storeId)
    res.json(data)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
