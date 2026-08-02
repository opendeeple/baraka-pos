import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { LoginRequest } from '@baraka/shared'
import { Store, User } from '@prisma/client'

function toAuthResponse(user: User & { store: Store }) {
  return {
    user: {
      id: user.id,
      storeId: user.storeId,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
    },
    store: {
      id: user.store.id,
      name: user.store.name,
      address: user.store.address,
      phone: user.store.phone,
      salePrefix: user.store.salePrefix,
    },
  }
}

export async function login(data: LoginRequest) {
  const user = await prisma.user.findFirst({
    where: {
      username: data.username,
      isActive: true,
      deletedAt: null,
      ...(data.storeId ? { storeId: data.storeId } : {}),
    },
    include: { store: true },
  })

  if (!user) throw new Error('Invalid credentials')

  const valid = await bcrypt.compare(data.password, user.passwordHash)
  if (!valid) throw new Error('Invalid credentials')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign(
    { userId: user.id, storeId: user.storeId, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  )

  return {
    token,
    syncApiKey: env.SYNC_API_KEY,
    ...toAuthResponse(user),
  }
}

export async function getMe(userId: number) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    include: { store: true },
  })
  if (!user) throw new Error('User not found')

  return toAuthResponse(user)
}

export async function verifyPin(userId: number, pin: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.pinCode) throw new Error('No PIN set')
  if (user.pinCode !== pin) throw new Error('Invalid PIN')
  return { id: user.id, name: user.name, role: user.role }
}
