import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database'

dayjs.extend(utc)
dayjs.extend(timezone)

// Every report counts a sale on the day and at the hour it happened in the
// shop: by saleTime (the selling device's clock — an offline sale can reach
// the server hours later, and createdAt is that arrival) and in the store's
// timezone (a UTC day starts at 05:00 in Tashkent, and the hourly chart was
// five hours off). Stored timestamps are UTC without a zone.
//
// The Store.timezone column defaults to 'UTC' — a value nobody chose — so
// that default means the shop's own zone.
const SHOP_TIMEZONE = 'Asia/Tashkent'

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

async function storeTimezone(storeId: number): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  const tz = store?.timezone
  return tz && tz !== 'UTC' && isTimezone(tz) ? tz : SHOP_TIMEZONE
}

/** [start, end) in UTC for the local days `from`..`to` (YYYY-MM-DD) in `tz`. */
function dayRange(tz: string, from: string, to = from): { start: Date; end: Date } {
  return {
    start: dayjs.tz(`${from} 00:00:00`, tz).toDate(),
    end: dayjs.tz(`${to} 00:00:00`, tz).add(1, 'day').toDate(),
  }
}

// Raw SQL compares naive-UTC columns with these: an explicit cast keeps the
// comparison in UTC whatever the database session's TimeZone is.
const utcParam = (d: Date) => d.toISOString()

// Per sale_items row (si, product p), for the raw-SQL reports. A box
// product's quantity is stored as a fraction of a box, so it's counted in
// pieces; what a line brought in is after its own % and flat discounts.
const SOLD_UNITS = Prisma.sql`(CASE WHEN p.unit = 'box' AND p."unitsPerPackage" > 0
  THEN si.quantity * p."unitsPerPackage" ELSE si.quantity END)`
const LINE_NET = Prisma.sql`(si.quantity * si."unitPrice" * (1 - COALESCE(si.discount, 0) / 100) - COALESCE(si."flatDiscount", 0))`

// `dateTo` lets the same aggregation serve both the single-day view and the
// "Date Range" tab — omit it (or pass the same value as `date`) for a
// single day.
export async function getDailySummary(storeId: number, date: string, dateTo?: string) {
  const { start, end } = dayRange(await storeTimezone(storeId), date, dateTo ?? date)
  const when = { gte: start, lt: end }

  const inRange = { storeId, status: 'completed' as const, saleTime: when }
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
      where: { storeId, sale: { status: 'completed', saleTime: when } },
      _sum: { amount: true },
    }),
    // Payment rows hold what was handed over; the change went back as cash.
    prisma.sale.aggregate({ where: { ...inRange, saleType: 'sale' }, _sum: { changeAmount: true } }),

    // Expense dates are date-only (UTC midnight of the local day), which
    // falls inside that local day's range.
    prisma.expense.aggregate({
      where: { storeId, deletedAt: null, expenseDate: when },
      _sum: { amount: true },
    }),

    prisma.cashLog.findMany({
      where: { storeId, transactionDate: when },
      orderBy: { transactionDate: 'asc' },
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
  const { start, end } = dayRange(await storeTimezone(storeId), dateFrom, dateTo)

  // Revenue needs SUM(quantity * unitPrice) per product — a row-level
  // product before summing, which groupBy's _sum can't express (it can only
  // sum a single column as-is) — same reason getCategorySales uses raw SQL.
  // "saleCount" (necha marta sotilgan) is how many separate sales included
  // this product at least once, as opposed to quantitySold (total units):
  // a product sold 1 unit each in 50 sales ranks high here but low by
  // quantity, and vice versa for one bulk sale of the same product.
  // quantitySold is in the product's selling unit: pieces (box products
  // too), or kg — `unit` says which.
  const rows = await prisma.$queryRaw<Array<{ productId: number; name: string; unit: string; quantitySold: number; revenue: number; saleCount: number }>>`
    SELECT si."productId" as "productId", p.name as name,
           CASE WHEN p.unit = 'kg' THEN 'kg' ELSE 'piece' END as unit,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(${SOLD_UNITS}) ELSE ${SOLD_UNITS} END) as "quantitySold",
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(${LINE_NET}) ELSE ${LINE_NET} END) as revenue,
           COUNT(DISTINCT CASE WHEN s."saleType" = 'sale' THEN si."saleId" END) as "saleCount"
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    WHERE s."storeId" = ${storeId} AND s.status = 'completed'
      AND s."saleTime" >= (${utcParam(start)}::timestamptz AT TIME ZONE 'UTC')
      AND s."saleTime" < (${utcParam(end)}::timestamptz AT TIME ZONE 'UTC')
      AND si."productId" IS NOT NULL
    GROUP BY si."productId", p.name, p.unit
    ORDER BY "quantitySold" DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    unit: r.unit,
    quantitySold: Math.round(Number(r.quantitySold) * 1000) / 1000,
    revenue: Math.round(Number(r.revenue)),
    saleCount: Number(r.saleCount),
  }))
}

export async function getCategorySales(storeId: number, dateFrom: string, dateTo: string) {
  const { start, end } = dayRange(await storeTimezone(storeId), dateFrom, dateTo)
  const result = await prisma.$queryRaw<Array<{ category: string; revenue: number; qty: number }>>`
    SELECT COALESCE(c.name, 'Uncategorized') as category,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(${LINE_NET}) ELSE ${LINE_NET} END) as revenue,
           SUM(CASE WHEN s."saleType" = 'return' THEN -ABS(${SOLD_UNITS}) ELSE ${SOLD_UNITS} END) as qty
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    LEFT JOIN collections c ON c.id = p."categoryId"
    WHERE s."storeId" = ${storeId}
      AND s.status = 'completed'
      AND s."saleTime" >= (${utcParam(start)}::timestamptz AT TIME ZONE 'UTC')
      AND s."saleTime" < (${utcParam(end)}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY c.name
    ORDER BY revenue DESC
  `
  return result.map((r) => ({
    category: r.category,
    revenue: Math.round(Number(r.revenue)),
    qty: Math.round(Number(r.qty) * 1000) / 1000,
  }))
}

export async function getHourlySales(storeId: number, date: string) {
  const tz = await storeTimezone(storeId)
  const { start, end } = dayRange(tz, date)
  // The hour on the shop's clock: the naive-UTC saleTime read as UTC, then
  // shown in the store's zone.
  const result = await prisma.$queryRaw<Array<{ hour: number; revenue: number; cnt: number }>>`
    SELECT EXTRACT(HOUR FROM (("saleTime" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})) as hour,
           SUM(CASE WHEN "saleType" = 'return' THEN -ABS("totalAmount") ELSE "totalAmount" END) as revenue,
           COUNT(*) FILTER (WHERE "saleType" = 'sale') as cnt
    FROM sales
    WHERE "storeId" = ${storeId}
      AND status = 'completed'
      AND "saleTime" >= (${utcParam(start)}::timestamptz AT TIME ZONE 'UTC')
      AND "saleTime" < (${utcParam(end)}::timestamptz AT TIME ZONE 'UTC')
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
