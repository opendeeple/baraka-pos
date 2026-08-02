import type { DbAdapter } from '../adapter'

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

    lowStock(limit = 50): Array<{ productId: number; name: string; stock: number; alertQuantity: number }> {
      return db
        .all<Record<string, any>>(
          `SELECT p.id AS product_id, p.name, COALESCE(SUM(s.quantity),0) AS stock, p.alert_quantity
           FROM products p LEFT JOIN product_stocks s ON s.product_id = p.id
           WHERE p.is_stock_managed = 1 AND p.is_active = 1 AND p.deleted_at IS NULL
           GROUP BY p.id HAVING stock <= COALESCE(p.alert_quantity, 0) AND p.alert_quantity > 0
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
  }
}

export type ReportsRepository = ReturnType<typeof createReportsRepository>
