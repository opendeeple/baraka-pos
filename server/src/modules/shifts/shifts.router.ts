import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import { deviceAuthMiddleware } from '../../middleware/deviceAuth.middleware'
import {
  ShiftError, startShift, heartbeatShift, endShift, listShifts, adminEndShift,
} from './shifts.service'

const router = Router()

function sendError(res: Response, err: unknown) {
  if (err instanceof ShiftError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...err.details })
  }
  res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
}

// --- terminal (device-authenticated): badge scan → shift lifecycle ---------

router.post('/start', deviceAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await startShift(req.device!, req.body?.badgeCode))
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/heartbeat', deviceAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await heartbeatShift(req.device!, Number(req.body?.shiftId)))
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/end', deviceAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await endShift(req.device!, Number(req.body?.shiftId), req.body?.endedAt))
  } catch (err) {
    sendError(res, err)
  }
})

// --- back office (manager JWT): attendance report + override ----------------

router.get('/', authMiddleware, requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const from = new Date(String(req.query.from))
    const to = new Date(String(req.query.to))
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'from and to must be ISO dates' })
    }
    res.json({ shifts: await listShifts(req.user!.storeId, from, to) })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/:id/end', authMiddleware, requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    res.json(await adminEndShift(req.user!.storeId, Number(req.params.id)))
  } catch (err) {
    sendError(res, err)
  }
})

export default router
