import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import { listExpenses, createExpense } from './expenses.service'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, page } = req.query
    const result = await listExpenses(req.user!.storeId, {
      dateFrom: date_from as string,
      dateTo: date_to as string,
      page: page ? Number(page) : 1,
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/', requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const expense = await createExpense(req.user!.storeId, req.body, req.user!.userId)
    res.status(201).json(expense)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
