import { prisma } from '../../config/database'

export async function listPurchases(storeId: number, opts: { status?: string; page?: number }) {
  const { status, page = 1 } = opts
  const limit = 50
  const skip = (page - 1) * limit

  const where = {
    storeId,
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
  }

  const [purchases, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { contact: true, items: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.purchase.count({ where }),
  ])

  return { purchases, total, page, limit }
}

export async function getPurchase(id: number, storeId: number) {
  return prisma.purchase.findFirst({
    where: { id, storeId, deletedAt: null },
    include: { contact: true, items: { include: { batch: true } } },
  })
}

export async function createPurchase(storeId: number, data: {
  contactId?: number
  referenceNo?: string
  note?: string
  items: Array<{
    productId?: number
    batchId?: number
    description: string
    quantity: number
    unitPrice: number
    unitCost: number
    discount?: number
  }>
}, createdBy: number) {
  if (!data.items?.length) throw new Error('At least one item is required')

  const totalAmount = data.items.reduce((s, i) => {
    const line = i.unitCost * i.quantity
    return s + line - line * ((i.discount ?? 0) / 100)
  }, 0)

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        storeId,
        contactId: data.contactId,
        referenceNo: data.referenceNo,
        note: data.note,
        totalAmount,
        status: 'draft',
        createdBy,
      },
    })

    for (const item of data.items) {
      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          productId: item.productId,
          batchId: item.batchId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.unitCost,
          discount: item.discount ?? 0,
          createdBy,
        },
      })
    }

    return tx.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { items: true, contact: true },
    })
  })
}

export async function receivePurchase(id: number, storeId: number) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirst({
      where: { id, storeId, deletedAt: null },
      include: { items: true },
    })
    if (!purchase) throw new Error('Purchase not found')
    if (purchase.status === 'received') throw new Error('Purchase already received')

    for (const item of purchase.items) {
      if (!item.productId || !item.batchId) continue
      await tx.productStock.upsert({
        where: { storeId_productId_batchId: { storeId, productId: item.productId, batchId: item.batchId } },
        create: { storeId, productId: item.productId, batchId: item.batchId, quantity: item.quantity },
        update: { quantity: { increment: item.quantity } },
      })
    }

    return tx.purchase.update({
      where: { id },
      data: { status: 'received' },
      include: { items: true },
    })
  })
}
