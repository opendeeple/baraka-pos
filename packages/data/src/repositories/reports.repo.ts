import type { DbAdapter } from '../adapter'

// Net of refunds: a return line counts against the product (quantities on
// returns are positive since the integrity round, negative on older rows).
const SIGN = `(CASE WHEN s.sale_type = 'return' THEN -1 ELSE 1 END)`
// A box product's quantity is a fraction of a box; it's counted in pieces.
const SOLD_UNITS = `${SIGN} * ABS(si.quantity) * (CASE WHEN p.unit = 'box' AND p.units_per_package > 0 THEN p.units_per_package ELSE 1 END)`
// discount is a percentage; flat_discount comes off the whole line.
const LINE_NET = `${SIGN} * (ABS(si.quantity) * ABS(si.unit_price) * (1 - COALESCE(si.discount, 0) / 100.0) - COALESCE(si.flat_discount, 0))`
const LINE_COST = `${SIGN} * ABS(si.quantity) * ABS(COALESCE(si.unit_cost, 0))`

export interface ProductSalesRow {
  productId: number
  name: string
  qty: number
  revenue: number
  profit: number
}

export interface DeadStockRow {
  productId: number
  name: string
  stock: number
  value: number
  lastSold: string | null
}

export interface LossRow {
  reason: string
  value: number
  count: number
}

/** Local-first report aggregates (work fully offline, instant). */
export function createReportsRepository(db: DbAdapter) {
  return {
    dailySummary(date: string): {
      salesCount: number
      grossSales: number
      discounts: number
      byMethod: Array<{ paymentMethod: string; total: number }>
    } {
      const totals = db.get<Record<string, any>>(
        `SELECT COUNT(*) AS sales_count, COALESCE(SUM(total_amount),0) AS gross, COALESCE(SUM(discount),0) AS discounts
         FROM sales WHERE sale_date = ? AND status = 'completed'`,
        [date]
      )
      const byMethod = db.all<Record<string, any>>(
        `SELECT pt.payment_method, COALESCE(SUM(pt.amount),0) AS total
         FROM payment_transactions pt JOIN sales s ON s.id = pt.sale_id
         WHERE s.sale_date = ? AND s.status = 'completed'
         GROUP BY pt.payment_method`,
        [date]
      )
      return {
        salesCount: totals?.sales_count ?? 0,
        grossSales: Number(totals?.gross) || 0,
        discounts: Number(totals?.discounts) || 0,
        byMethod: byMethod.map((r) => ({ paymentMethod: r.payment_method, total: Number(r.total) || 0 })),
      }
    },

    /** Revenue and sale count per day (inclusive range, gaps filled with 0). */
    revenueSeries(dateFrom: string, dateTo: string): Array<{ date: string; revenue: number; salesCount: number }> {
      const rows = db.all<Record<string, any>>(
        `SELECT sale_date, COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS sales_count
         FROM sales WHERE sale_date BETWEEN ? AND ? AND status = 'completed'
         GROUP BY sale_date`,
        [dateFrom, dateTo]
      )
      const byDate = new Map(rows.map((r) => [r.sale_date, r]))
      const out: Array<{ date: string; revenue: number; salesCount: number }> = []
      for (let d = new Date(`${dateFrom}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10)
        if (key > dateTo) break
        const row = byDate.get(key)
        out.push({ date: key, revenue: Number(row?.revenue) || 0, salesCount: row?.sales_count ?? 0 })
      }
      return out
    },

    topProducts(dateFrom: string, dateTo: string, limit = 10): Array<{ productId: number; name: string; quantity: number; revenue: number }> {
      return db
        .all<Record<string, any>>(
          `SELECT si.product_id, si.description AS name,
                  SUM(si.quantity) AS quantity, SUM(si.quantity * si.unit_price) AS revenue
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE s.sale_date BETWEEN ? AND ? AND s.status = 'completed' AND si.product_id IS NOT NULL
           GROUP BY si.product_id, si.description ORDER BY revenue DESC LIMIT ?`,
          [dateFrom, dateTo, limit]
        )
        .map((r) => ({
          productId: r.product_id,
          name: r.name,
          quantity: Number(r.quantity) || 0,
          revenue: Number(r.revenue) || 0,
        }))
    },

    // Shop-floor stock only (matches desktop's DashboardScreen low-stock
    // card) — warehouse stock existing doesn't mean the shop floor isn't
    // about to run dry, which is what this alert is for.
    lowStock(limit = 50): Array<{ productId: number; name: string; stock: number; alertQuantity: number }> {
      return db
        .all<Record<string, any>>(
          `SELECT p.id AS product_id, p.name, COALESCE(s.quantity, 0) AS stock, p.alert_quantity
           FROM products p
           LEFT JOIN product_batches b ON b.id = (
             SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
           )
           LEFT JOIN product_stocks s ON s.id = (
             SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = b.id AND location = 'shop' ORDER BY id DESC LIMIT 1
           )
           WHERE p.is_stock_managed = 1 AND p.is_active = 1 AND p.deleted_at IS NULL
             AND COALESCE(s.quantity, 0) <= COALESCE(p.alert_quantity, 0) AND p.alert_quantity > 0
           ORDER BY stock ASC LIMIT ?`,
          [limit]
        )
        .map((r) => ({
          productId: r.product_id,
          name: r.name,
          stock: Number(r.stock) || 0,
          alertQuantity: Number(r.alert_quantity) || 0,
        }))
    },

    /** Per-product sold/revenue/profit over a range — the screen classifies A/B/C itself, same as desktop's ProductAnalysis.tsx. */
    productSales(dateFrom: string, dateTo: string): ProductSalesRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT p.id, p.name,
                  SUM(${SOLD_UNITS}) AS qty,
                  SUM(${LINE_NET}) AS revenue,
                  SUM(${LINE_NET} - ${LINE_COST}) AS profit
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           JOIN products p ON p.id = si.product_id
           WHERE s.status != 'cancelled' AND si.item_type = 'product' AND s.sale_date BETWEEN ? AND ?
           GROUP BY p.id HAVING revenue > 0 ORDER BY revenue DESC`,
          [dateFrom, dateTo]
        )
        .map((r) => ({ productId: r.id, name: r.name, qty: Number(r.qty) || 0, revenue: Number(r.revenue) || 0, profit: Number(r.profit) || 0 }))
    },

    /** Stock-managed products with stock on hand that haven't sold in `days` — money frozen on the shelf. */
    deadStock(days: number): DeadStockRow[] {
      const limit = new Date()
      limit.setDate(limit.getDate() - days)
      const cutoff = limit.toISOString().slice(0, 10)
      return db
        .all<Record<string, any>>(
          `SELECT p.id, p.name,
                  COALESCE((SELECT SUM(quantity) FROM product_stocks ps WHERE ps.product_id = p.id), 0) AS stock,
                  COALESCE((SELECT SUM(quantity) FROM product_stocks ps WHERE ps.product_id = p.id), 0)
                    * COALESCE((SELECT cost FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1), 0) AS value,
                  (SELECT MAX(s.sale_date) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                   WHERE si.product_id = p.id AND s.status != 'cancelled' AND s.sale_type = 'sale') AS last_sold
           FROM products p
           WHERE p.deleted_at IS NULL AND COALESCE(p.is_stock_managed, 1) = 1`
        )
        .map((r) => ({ productId: r.id, name: r.name, stock: Number(r.stock) || 0, value: Number(r.value) || 0, lastSold: r.last_sold }))
        .filter((r) => r.stock > 0 && (!r.lastSold || r.lastSold < cutoff))
        .sort((a, b) => b.value - a.value)
    },

    /** Write-offs by reason + net stocktake shortage/surplus over a range, from the journal. */
    losses(dateFrom: string, dateTo: string): { byReason: LossRow[]; stocktakeShortage: number; stocktakeSurplus: number; stocktakeCount: number } {
      const rows = db.all<{ action: string; details: string | null }>(
        `SELECT action, details FROM audit_logs WHERE action IN ('writeoff', 'stocktake') AND occurred_at BETWEEN ? AND ?`,
        [`${dateFrom}T00:00:00`, `${dateTo}T23:59:59.999`]
      )
      const byReason = new Map<string, LossRow>()
      let stocktakeShortage = 0
      let stocktakeSurplus = 0
      let stocktakeCount = 0
      for (const r of rows) {
        let d: Record<string, any> = {}
        try { d = r.details ? JSON.parse(r.details) : {} } catch { /* skip */ }
        if (r.action === 'writeoff') {
          const key = String(d.reason ?? 'other')
          const row = byReason.get(key) ?? { reason: key, value: 0, count: 0 }
          row.value += Number(d.value) || 0
          row.count += 1
          byReason.set(key, row)
        } else {
          stocktakeShortage += Number(d.shortageValue) || 0
          stocktakeSurplus += Number(d.surplusValue) || 0
          stocktakeCount += 1
        }
      }
      return { byReason: [...byReason.values()].sort((a, b) => b.value - a.value), stocktakeShortage, stocktakeSurplus, stocktakeCount }
    },
  }
}

export type ReportsRepository = ReturnType<typeof createReportsRepository>
