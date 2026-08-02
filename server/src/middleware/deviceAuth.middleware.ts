import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../config/database'

export interface DeviceAuthContext {
  deviceId: number
  storeId: number
}

declare global {
  namespace Express {
    interface Request {
      device?: DeviceAuthContext
    }
  }
}

// Authorization: Device <deviceId>:<deviceKey>
// The key is compared against the bcrypt hash stored at registration; store
// scope for all sync v2 routes derives from the device row, never the request.
export async function deviceAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Device ')) {
    return res.status(401).json({ error: 'Device authorization required' })
  }
  const credentials = header.slice(7)
  const sep = credentials.indexOf(':')
  const deviceId = Number(credentials.slice(0, sep))
  const deviceKey = credentials.slice(sep + 1)
  if (sep < 1 || !Number.isInteger(deviceId) || !deviceKey) {
    return res.status(401).json({ error: 'Malformed device credentials' })
  }

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } })
    if (!device || device.revokedAt) {
      return res.status(401).json({ error: 'Unknown or revoked device' })
    }
    const valid = await bcrypt.compare(deviceKey, device.keyHash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid device key' })
    }

    req.device = { deviceId: device.id, storeId: device.storeId }

    // Best-effort liveness marker; never blocks the request.
    prisma.device
      .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {})

    next()
  } catch (err) {
    next(err)
  }
}
