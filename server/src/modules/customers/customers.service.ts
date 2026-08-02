import { prisma } from '../../config/database'

export async function listCustomers(storeId: number, search?: string) {
  return prisma.contact.findMany({
    where: {
      storeId,
      deletedAt: null,
      type: { in: ['customer', 'both'] },
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    orderBy: { name: 'asc' },
    take: 50,
  })
}

export async function getCustomer(id: number, storeId: number) {
  return prisma.contact.findFirst({
    where: { id, storeId, deletedAt: null },
    include: {
      sales: { orderBy: { createdAt: 'desc' }, take: 10 },
      loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
}

export async function createCustomer(storeId: number, data: {
  name: string
  phone?: string
  email?: string
  address?: string
  type?: 'customer' | 'vendor' | 'both'
}) {
  return prisma.contact.create({
    data: { storeId, ...data, type: data.type ?? 'customer' },
  })
}

export async function updateCustomer(id: number, storeId: number, data: Partial<{
  name: string
  phone: string
  email: string
  address: string
  balance: number
}>) {
  return prisma.contact.update({ where: { id }, data })
}

export async function getLoyaltyHistory(contactId: number, storeId: number) {
  return prisma.loyaltyPointTransaction.findMany({
    where: { contactId, storeId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function redeemLoyaltyPoints(contactId: number, storeId: number, points: number, createdBy: number) {
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })
  if (Number(contact.loyaltyPointsBalance) < points) throw new Error('Insufficient loyalty points')

  return prisma.$transaction(async (tx) => {
    await tx.loyaltyPointTransaction.create({
      data: { contactId, storeId, points: -points, type: 'redeem', description: 'Points redeemed at POS', createdBy },
    })
    return tx.contact.update({
      where: { id: contactId },
      data: { loyaltyPointsBalance: { decrement: points } },
    })
  })
}
