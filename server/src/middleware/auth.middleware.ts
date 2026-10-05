import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../config/database'

export interface AuthPayload {
  userId: number
  storeId: number
  role: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

// A token outlives what it says (7 days): the user is re-read on every
// request, so a deleted or deactivated account stops working at once and a
// role change applies immediately instead of when the token expires.
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.slice(7)
  let payload: AuthPayload
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
  try {
    const user = await prisma.user.findFirst({
      where: { id: payload.userId, isActive: true, deletedAt: null },
      select: { id: true, storeId: true, role: true },
    })
    if (!user) return res.status(401).json({ error: 'Invalid token' })
    req.user = { userId: user.id, storeId: user.storeId, role: user.role }
    next()
  } catch (err) {
    next(err)
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}
