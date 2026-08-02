import { prisma } from '../../config/database'

export async function listProducts(storeId: number, opts: {
  search?: string
  categoryId?: number
  page?: number
  limit?: number
  featured?: boolean
}) {
  const { search, categoryId, page = 1, limit = 100, featured } = opts
  const skip = (page - 1) * limit

  const where = {
    storeId,
    isActive: true,
    deletedAt: null,
    ...(categoryId ? { categoryId } : {}),
    ...(featured ? { isFeatured: true } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search } },
      ],
    } : {}),
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        batches: { where: { isActive: true, deletedAt: null } },
        stocks: { where: { storeId } },
        category: true,
      },
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page, limit }
}

export async function getProductByBarcode(barcode: string, storeId: number) {
  return prisma.product.findFirst({
    where: { barcode, storeId, isActive: true, deletedAt: null },
    include: {
      batches: { where: { isActive: true, deletedAt: null } },
      stocks: { where: { storeId } },
    },
  })
}

export async function getProductById(id: number, storeId: number) {
  return prisma.product.findFirst({
    where: { id, storeId, deletedAt: null },
    include: {
      batches: { where: { deletedAt: null } },
      stocks: { where: { storeId } },
      category: true,
    },
  })
}

export async function createProduct(storeId: number, data: {
  name: string
  sku?: string
  barcode?: string
  categoryId?: number
  unit?: string
  productType?: string
  isStockManaged?: boolean
  alertQuantity?: number
  cost: number
  price: number
}) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        storeId,
        name: data.name,
        sku: data.sku,
        barcode: data.barcode,
        categoryId: data.categoryId,
        unit: data.unit,
        productType: (data.productType as never) ?? 'simple',
        isStockManaged: data.isStockManaged ?? true,
        alertQuantity: data.alertQuantity,
      },
    })

    const batch = await tx.productBatch.create({
      data: {
        productId: product.id,
        cost: data.cost,
        price: data.price,
        isActive: true,
      },
    })

    await tx.productStock.create({
      data: { storeId, productId: product.id, batchId: batch.id, quantity: 0 },
    })

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { batches: true, stocks: true },
    })
  })
}

export async function updateProduct(id: number, storeId: number, data: Partial<{
  name: string
  sku: string
  barcode: string
  categoryId: number
  isActive: boolean
  isFeatured: boolean
  alertQuantity: number
}>) {
  return prisma.product.update({
    where: { id },
    data,
    include: { batches: true, stocks: { where: { storeId } } },
  })
}

export async function adjustStock(storeId: number, productId: number, batchId: number, quantity: number, reason: string, userId: number) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.productStock.findFirst({ where: { storeId, productId, batchId } })
    if (!stock) throw new Error('Stock record not found')

    const previous = Number(stock.quantity)
    await tx.productStock.update({
      where: { id: stock.id },
      data: { quantity },
    })

    await tx.quantityAdjustment.create({
      data: {
        storeId,
        batchId,
        stockId: stock.id,
        previousQuantity: previous,
        adjustedQuantity: quantity,
        reason,
        createdBy: userId,
      },
    })

    return { previousQuantity: previous, adjustedQuantity: quantity }
  })
}
