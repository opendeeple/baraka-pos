import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import {
  openSession,
  closeSession,
  getCurrentSession,
  getSessionSummary,
} from './sessions.service'

const router = Router()
router.use(authMiddleware)

router.post('/open', async (req: Request, res: Response) => {
  try {
    const session = await openSession(req.body, req.user!.userId)
    res.json(session)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id/close', async (req: Request, res: Response) => {
  try {
    const session = await closeSession(
      { sessionId: Number(req.params.id), closingBalanceActual: req.body.closingBalanceActual },
      req.user!.userId
    )
    res.json(session)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/current', async (req: Request, res: Response) => {
  try {
    const { terminal_id } = req.query
    const session = await getCurrentSession(terminal_id as string, req.user!.storeId)
    res.json(session)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getSessionSummary(Number(req.params.id))
    res.json(summary)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
