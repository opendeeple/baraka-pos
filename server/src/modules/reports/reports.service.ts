import { prisma } from '../../config/database'

// `dateTo` lets the same aggregation serve both the single-day view and the
// "Date Range" tab — omit it (or pass the same value as `date`) for a
// single day.
export async function getDailySummary(storeId: number, date: string, dateTo?: string) {
  const startDate = new Date(date + 'T00:00:00.000Z')
  const endDate = new Date((dateTo ?? date) + 'T23:59:59.999Z')

  const [sales, payments, expenses, cashLogs] = await Promise.all([
    prisma.sale.aggregate({
      where: { storeId, status: 'completed', createdAt: { gte: startDate, lte: endDate } },
      _sum: { totalAmount: true, profitAmount: true, discount: true },
      _count: { id: true },
    }),

    prisma.paymentTransaction.groupBy({
      by: ['paymentMethod'],
      where: { storeId, transactionType: 'sale', createdAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),

    prisma.expense.aggregate({
      where: { storeId, deletedAt: null, expenseDate: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),

    prisma.cashLog.findMany({
      where: { storeId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const totalRevenue = Number(sales._sum.totalAmount ?? 0)
  const totalProfit = Number(sales._sum.profitAmount ?? 0)
  const totalExpenses = Number(expenses._sum.amount ?? 0)

  return {
    date,
    totalRevenue,
    totalProfit,
    netProfit: totalProfit - totalExpenses,
    totalDiscount: Number(sales._sum.discount ?? 0),
    transactionCount: sales._count.id,
    totalExpenses,
    paymentBreakdown: payments.map((p) => ({
      method: p.paymentMethod,
      total: Number(p._sum.amount ?? 0),
    })),
    cashFlow: cashLogs.map((l) => ({
      type: l.transactionType,
      amount: Number(l.amount),
      source: l.source,
      description: l.description,
    })),
  }
}

export async function getTopProducts(storeId: number, dateFrom: string, dateTo: string, limit = 10) {
  const items = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        storeId,
        status: 'completed',
        createdAt: {
          gte: new Date(dateFrom + 'T00:00:00.000Z'),
          lte: new Date(dateTo + 'T23:59:59.999Z'),
        },
      },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  })

  const productIds = items.map((i) => i.productId).filter(Boolean) as number[]
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  })

  const nameMap = Object.fromEntries(products.map((p) => [p.id, p.name]))

  return items.map((i) => ({
    productId: i.productId,
    name: nameMap[i.productId as number] ?? 'Unknown',
    quantitySold: Number(i._sum.quantity ?? 0),
  }))
}

export async function getCategorySales(storeId: number, dateFrom: string, dateTo: string) {
  const result = await prisma.$queryRaw<Array<{ category: string; revenue: number; qty: number }>>`
    SELECT COALESCE(c.name, 'Uncategorized') as category,
           SUM(si."quantity" * si."unitPrice") as revenue,
           SUM(si."quantity") as qty
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    LEFT JOIN collections c ON c.id = p."categoryId"
    WHERE s."storeId" = ${storeId}
      AND s.status = 'completed'
      AND s."createdAt" >= ${new Date(dateFrom + 'T00:00:00.000Z')}
      AND s."createdAt" <= ${new Date(dateTo + 'T23:59:59.999Z')}
    GROUP BY c.name
    ORDER BY revenue DESC
  `
  return result.map((r) => ({
    category: r.category,
    revenue: Number(r.revenue),
    qty: Number(r.qty),
  }))
}

export async function getHourlySales(storeId: number, date: string) {
  const result = await prisma.$queryRaw<Array<{ hour: number; revenue: number; cnt: number }>>`
    SELECT EXTRACT(HOUR FROM "createdAt") as hour,
           SUM("totalAmount") as revenue,
           COUNT(*) as cnt
    FROM sales
    WHERE "storeId" = ${storeId}
      AND status = 'completed'
      AND DATE("createdAt") = ${date}::date
    GROUP BY hour
    ORDER BY hour
  `
  return result.map((r) => ({
    hour: Number(r.hour),
    label: `${String(Number(r.hour)).padStart(2, '0')}:00`,
    revenue: Number(r.revenue),
    transactions: Number(r.cnt),
  }))
}

export async function getDashboardSummary(storeId: number, date: string) {
  const [daily, topProducts, lowStock] = await Promise.all([
    getDailySummary(storeId, date),
    getTopProducts(storeId, date, date, 5),
    getLowStockReport(storeId),
  ])

  return { daily, topProducts, lowStock }
}

export async function getLowStockReport(storeId: number) {
  const rows = await prisma.productStock.findMany({
    where: {
      storeId,
      product: { isStockManaged: true, deletedAt: null, isActive: true },
    },
    include: {
      product: { select: { name: true, sku: true, alertQuantity: true } },
      batch: { select: { price: true, cost: true } },
    },
    orderBy: { quantity: 'asc' },
  })

  return rows
    .filter((r) => Number(r.quantity) <= Number(r.product.alertQuantity ?? 5))
    .map((r) => ({
      productId: r.productId,
      name: r.product.name,
      sku: r.product.sku,
      stock: Number(r.quantity),
      alertQuantity: Number(r.product.alertQuantity ?? 5),
      price: Number(r.batch?.price ?? 0),
      cost: Number(r.batch?.cost ?? 0),
    }))
}
