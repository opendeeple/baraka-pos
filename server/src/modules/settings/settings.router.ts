import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import { getSetting, listSettings, upsertSetting } from './settings.service'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response) => {
  try {
    const settings = await listSettings(req.user!.storeId)
    res.json(settings)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:key', async (req: Request, res: Response) => {
  try {
    const setting = await getSetting(req.user!.storeId, req.params.key)
    res.json(setting)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:key', requireRole('admin', 'manager', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const setting = await upsertSetting(req.user!.storeId, req.params.key, req.body.value)
    res.json(setting)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
