import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/database'
import type { DeviceRegisterRequest, DeviceRegisterResponse } from '@baraka/shared'

export async function registerDevice(
  storeId: number,
  userId: number,
  input: DeviceRegisterRequest
): Promise<DeviceRegisterResponse> {
  const deviceKey = crypto.randomBytes(32).toString('base64url')
  const keyHash = await bcrypt.hash(deviceKey, 10)

  const device = await prisma.device.create({
    data: {
      storeId,
      name: input.name,
      platform: input.platform,
      keyHash,
      registeredBy: userId,
    },
  })

  // The plaintext key is returned exactly once; only the hash is stored.
  return {
    deviceId: device.id,
    deviceSyncId: device.syncId,
    deviceKey,
    storeId,
  }
}

export async function listDevices(storeId: number) {
  return prisma.device.findMany({
    where: { storeId },
    select: {
      id: true,
      syncId: true,
      name: true,
      platform: true,
      lastSeenAt: true,
      lastPulledAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function revokeDevice(storeId: number, deviceId: number) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, storeId } })
  if (!device) throw new Error('Device not found')
  return prisma.device.update({
    where: { id: deviceId },
    data: { revokedAt: new Date() },
  })
}
