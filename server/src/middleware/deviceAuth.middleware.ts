import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../config/database'

export interface DeviceAuthContext {
  deviceId: number
  storeId: number
  /** electron-pos | electron-office | android-pos | android-office */
  platform: string
}

declare global {
  namespace Express {
    interface Request {
      device?: DeviceAuthContext
    }
  }
}

// A device key is 256 random bits, so bcrypt (made for guessable passwords)
// buys nothing here, and costs ~70 ms of CPU per call — every sync pulls 15
// tables from every device, which on a small instance means seconds per
// sync. The key is checked with bcrypt once, then remembered (as its SHA-256)
// for this process. The device row is still read on every request, so a
// revoked or deleted device is refused at once.
const verifiedKeys = new Map<string, string>()
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// lastSeenAt is informational; writing it on every request doubled the
// database writes of a sync.
const LAST_SEEN_EVERY_MS = 60_000
const lastSeenWritten = new Map<number, number>()

/** Writes a device timestamp at most once a minute. */
export function touchDevice(deviceId: number, field: 'lastSeenAt' | 'lastPulledAt'): void {
  const key = field === 'lastSeenAt' ? deviceId : -deviceId
  const now = Date.now()
  if (now - (lastSeenWritten.get(key) ?? 0) < LAST_SEEN_EVERY_MS) return
  lastSeenWritten.set(key, now)
  prisma.device.update({ where: { id: deviceId }, data: { [field]: new Date() } }).catch(() => {})
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
    const cacheKey = `${device.id}:${device.keyHash}`
    const digest = sha256(deviceKey)
    if (verifiedKeys.get(cacheKey) !== digest) {
      const valid = await bcrypt.compare(deviceKey, device.keyHash)
      if (!valid) {
        return res.status(401).json({ error: 'Invalid device key' })
      }
      verifiedKeys.set(cacheKey, digest)
    }

    req.device = { deviceId: device.id, storeId: device.storeId, platform: device.platform }
    touchDevice(device.id, 'lastSeenAt')
    next()
  } catch (err) {
    next(err)
  }
}
