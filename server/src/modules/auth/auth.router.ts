import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { login, verifyPin, getMe } from './auth.service'
import { authMiddleware } from '../../middleware/auth.middleware'

const router = Router()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  storeId: z.number().optional(),
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body)
    const result = await login(body)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login failed'
    res.status(401).json({ error: msg })
  }
})

router.post('/pin-verify', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { pin } = req.body
    const result = await verifyPin(req.user!.userId, pin)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'PIN verification failed'
    res.status(401).json({ error: msg })
  }
})

router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await getMe(req.user!.userId)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load user'
    res.status(401).json({ error: msg })
  }
})

export default router
