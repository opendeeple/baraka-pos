import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key']
  if (key !== env.SYNC_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' })
  }
  next()
}
