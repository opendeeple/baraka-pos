import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import { registerDevice, listDevices, revokeDevice } from './devices.service'

const router = Router()

router.use(authMiddleware, requireRole('admin', 'manager', 'super_admin'))

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.enum(['android-pos', 'android-office', 'electron-pos', 'electron-office']),
})

router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body)
    const result = await registerDevice(req.user!.storeId, req.user!.userId, body)
    res.status(201).json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Device registration failed'
    res.status(400).json({ error: msg })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ devices: await listDevices(req.user!.storeId) })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to list devices'
    res.status(500).json({ error: msg })
  }
})

router.put('/:id/revoke', async (req: Request, res: Response) => {
  try {
    await revokeDevice(req.user!.storeId, Number(req.params.id))
    res.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to revoke device'
    res.status(400).json({ error: msg })
  }
})

export default router
