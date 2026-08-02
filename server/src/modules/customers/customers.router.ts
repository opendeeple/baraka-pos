import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import {
  listCustomers, getCustomer, createCustomer,
  updateCustomer, getLoyaltyHistory, redeemLoyaltyPoints,
} from './customers.service'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response) => {
  try {
    const customers = await listCustomers(req.user!.storeId, req.query.search as string)
    res.json(customers)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const customer = await createCustomer(req.user!.storeId, req.body)
    res.status(201).json(customer)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const customer = await getCustomer(Number(req.params.id), req.user!.storeId)
    if (!customer) return res.status(404).json({ error: 'Not found' })
    res.json(customer)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const customer = await updateCustomer(Number(req.params.id), req.user!.storeId, req.body)
    res.json(customer)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id/loyalty', async (req: Request, res: Response) => {
  try {
    const history = await getLoyaltyHistory(Number(req.params.id), req.user!.storeId)
    res.json(history)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/:id/loyalty/redeem', async (req: Request, res: Response) => {
  try {
    const result = await redeemLoyaltyPoints(
      Number(req.params.id), req.user!.storeId, req.body.points, req.user!.userId
    )
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
