import { prisma } from '../../config/database'

// `dateTo` lets the same aggregation serve both the single-day view and the
// "Date Range" tab — omit it (or pass the same value as `date`) for a
// single day.
export async function getDailySummary(storeId: number, date: string, dateTo?: string) {
  const startDate = new Date(date + 'T00:00:00.000Z')
  const endDate = new Date((dateTo ?? date) + 'T23:59:59.999Z')

  const inRange = { storeId, status: 'completed' as const, createdAt: { gte: startDate, lte: endDate } }
  const [sales, returns, payments, change, expenses, cashLogs] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...inRange, saleType: 'sale' },
      _sum: { totalAmount: true, profitAmount: true, discount: true },
      _count: { id: true },
    }),
    // Returns net out of revenue whatever sign their totals were written
    // with (Android: negative; older desktop builds: positive).
    prisma.sale.findMany({
      where: { ...inRange, saleType: 'return' },
      select: { totalAmount: true, profitAmount: true },
    }),

    // Sales and refunds per method, voided sales excluded.
    prisma.paymentTransaction.groupBy({
      by: ['paymentMethod'],
      where: { storeId, createdAt: { gte: startDate, lte: endDate }, sale: { status: 'completed' } },
      _sum: { amount: true },
    }),
    // Payment rows hold what was handed over; the change went back as cash.
    prisma.sale.aggregate({ where: { ...inRange, saleType: 'sale' }, _sum: { changeAmount: true } }),

    prisma.expense.aggregate({
      where: { storeId, deletedAt: null, expenseDate: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),

    prisma.cashLog.findMany({
      where: { storeId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const returnedTotal = returns.reduce((s, r) => s + Math.abs(Number(r.totalAmount)), 0)
  const returnedProfit = returns.reduce((s, r) => s + Math.abs(Number(r.profitAmount)), 0)
  const totalRevenue = Number(sales._sum.totalAmount ?? 0) - returnedTotal
  const totalProfit = Number(sales._sum.profitAmount ?? 0) - returnedProfit
  const totalExpenses = Number(expenses._sum.amount ?? 0)
  const changeGiven = Number(change._sum.changeAmount ?? 0)

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
      total: Number(p._sum.amount ?? 0) - (p.paymentMethod === 'Cash' ? changeGiven : 0),
    })),
    cashFlow: cashLogs.map((l) => ({
      type: l.transactionType,
      amount: Number(l.amount),
      source: l.source,
      description: l.description,
    })),
  }
}

// Returns every product with at least one completed sale in the range, with
// all three metrics (quantity, revenue, times-sold) together — the "full
// table" view needs to show all of them at once and let the owner re-sort
// locally, not refetch per column, and a shop with many products needs to
// see all of them, not just a top-N slice for a chart.
export async function getTopProducts(
  storeId: number,
  dateFrom: string,
  dateTo: string,
  limit = 500
) {
  const startDate = new Date(dateFrom + 'T00:00:00.000Z')
  const endDate = new Date(dateTo + 'T23:59:59.999Z')

  // Revenue needs SUM(quantity * unitPrice) per product — a row-level
  // product before summing, which groupBy's _sum can't express (it can only
  // sum a single column as-is) — same reason getCategorySales uses raw SQL.
  // "saleCount" (necha marta sotilgan) is how many separate sales included
  // this product at least once, as opposed to quantitySold (total units):
  // a product sold 1 unit each in 50 sales ranks high here but low by
  // quantity, and vice versa for one bulk sale of the same product.
  const rows = await prisma.$queryRaw<Array<{ productId: number; name: string; quantitySold: number; revenue: number; saleCount: number }>>`
    SELECT si."productId" as "productId", p.name as name,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(si.quantity) ELSE si.quantity END) as "quantitySold",
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(si.quantity * si."unitPrice") ELSE si.quantity * si."unitPrice" END) as revenue,
           COUNT(DISTINCT CASE WHEN s."saleType" = 'sale' THEN si."saleId" END) as "saleCount"
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    WHERE s."storeId" = ${storeId} AND s.status = 'completed'
      AND s."createdAt" >= ${startDate} AND s."createdAt" <= ${endDate}
      AND si."productId" IS NOT NULL
    GROUP BY si."productId", p.name
    ORDER BY "quantitySold" DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    quantitySold: Number(r.quantitySold),
    revenue: Number(r.revenue),
    saleCount: Number(r.saleCount),
  }))
}

export async function getCategorySales(storeId: number, dateFrom: string, dateTo: string) {
  const result = await prisma.$queryRaw<Array<{ category: string; revenue: number; qty: number }>>`
    SELECT COALESCE(c.name, 'Uncategorized') as category,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(si.quantity * si."unitPrice") ELSE si.quantity * si."unitPrice" END) as revenue,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(si.quantity) ELSE si.quantity END) as qty
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
           SUM(CASE WHEN "saleType" = 'return' THEN -ABS("totalAmount") ELSE "totalAmount" END) as revenue,
           COUNT(*) FILTER (WHERE "saleType" = 'sale') as cnt
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
      location: 'shop',
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
