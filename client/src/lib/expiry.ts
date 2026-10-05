// Shelf life: a batch's expiry_date is the nearest expiry among the goods on
// hand, written when a delivery is received (ReceivePurchaseModal). Products
// expiring within EXPIRING_DAYS (or already expired) and still in stock are
// flagged on the dashboard and next to "Ombor va qoldiq" in the menu.

export const EXPIRING_DAYS = 7

export interface ExpiringRow {
  product_id: number
  batch_id: number
  name: string
  expiry_date: string
  stock: number
  cost: number
  /** Whole days left; negative once expired. */
  days_left: number
}

export async function loadExpiring(days = EXPIRING_DAYS): Promise<ExpiringRow[]> {
  const rows = await window.electronAPI.db.query(
    `SELECT pb.product_id, pb.id AS batch_id, p.name, substr(pb.expiry_date, 1, 10) AS expiry_date,
            COALESCE(pb.cost, 0) AS cost,
            COALESCE((SELECT SUM(quantity) FROM product_stocks s WHERE s.batch_id = pb.id), 0) AS stock,
            CAST(julianday(substr(pb.expiry_date, 1, 10)) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id AND p.deleted_at IS NULL
     WHERE pb.expiry_date IS NOT NULL AND substr(pb.expiry_date, 1, 10) <= date('now', 'localtime', '+' || ? || ' days')
     ORDER BY substr(pb.expiry_date, 1, 10), p.name`,
    [days]
  ) as ExpiringRow[]
  return rows
    .map((r) => ({ ...r, stock: Number(r.stock), cost: Number(r.cost), days_left: Number(r.days_left) }))
    .filter((r) => r.stock > 0)
}
