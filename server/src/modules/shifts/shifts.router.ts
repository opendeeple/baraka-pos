import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
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

// --- terminal (terminal token): badge scan → shift lifecycle ---------------
// The terminal token (whoever last signed in on that terminal with a
// password) vouches that the call comes from one of this store's terminals;
// terminalName says which one.

router.post('/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await startShift(req.user!.storeId, req.body?.terminalName, req.body?.badgeCode))
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/heartbeat', authMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await heartbeatShift(req.user!.storeId, req.body?.terminalName, Number(req.body?.shiftId)))
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/end', authMiddleware, async (req: Request, res: Response) => {
  try {
    res.json(await endShift(req.user!.storeId, req.body?.terminalName, Number(req.body?.shiftId), req.body?.endedAt))
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
