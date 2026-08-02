import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

/** Grid/list row shape the POS register works with (snake_case-free). */
export interface ProductListItem {
  id: number
  name: string
  sku: string | null
  barcode: string | null
  categoryId: number | null
  productType: string
  isStockManaged: boolean
  isActive: boolean
  isFeatured: boolean
  alertQuantity: number
  imageUrl: string | null
  batchId: number | null
  price: number
  cost: number
  stock: number
}

export interface CategoryItem {
  id: number
  name: string
  parentId: number | null
  sortOrder: number
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.sku, p.barcode, p.category_id, p.product_type,
         p.is_stock_managed, p.is_active, p.is_featured, p.alert_quantity, p.image_url,
         b.id AS batch_id, COALESCE(b.price, 0) AS price, COALESCE(b.cost, 0) AS cost,
         COALESCE(s.quantity, 0) AS stock
  FROM products p
  LEFT JOIN product_batches b ON b.product_id = p.id AND b.is_active = 1
  LEFT JOIN product_stocks s ON s.product_id = p.id AND s.batch_id = b.id
  WHERE p.is_active = 1 AND (p.deleted_at IS NULL)`

function mapProduct(row: Record<string, any>): ProductListItem {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    categoryId: row.category_id,
    productType: row.product_type,
    isStockManaged: Boolean(row.is_stock_managed),
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    alertQuantity: Number(row.alert_quantity) || 0,
    imageUrl: row.image_url,
    batchId: row.batch_id,
    price: Number(row.price) || 0,
    cost: Number(row.cost) || 0,
    stock: Number(row.stock) || 0,
  }
}

export interface ProductInput {
  name: string
  sku?: string | null
  barcode?: string | null
  categoryId?: number | null
  price: number
  cost?: number
  alertQuantity?: number
  isStockManaged?: boolean
  isActive?: boolean
}

export function createProductRepository(db: DbAdapter, uuid?: () => string, enqueue?: EnqueueFn) {
  return {
    /** Creates product + default batch + zero stock row, all enqueued for push. */
    create(input: ProductInput): number {
      if (!uuid || !enqueue) throw new Error('Product repository is read-only without uuid/enqueue deps')
      const now = new Date().toISOString()
      const productSyncId = uuid()
      const batchSyncId = uuid()
      let productId = 0
      db.transaction(() => {
        db.run(
          `INSERT INTO products (sync_id,name,sku,barcode,category_id,is_stock_managed,alert_quantity,is_active,product_type,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'simple',?,?)`,
          [
            productSyncId, input.name, input.sku ?? null, input.barcode ?? null, input.categoryId ?? null,
            input.isStockManaged === false ? 0 : 1, input.alertQuantity ?? 0, input.isActive === false ? 0 : 1,
            now, now,
          ]
        )
        productId = db.get<{ id: number }>(`SELECT id FROM products WHERE sync_id=?`, [productSyncId])!.id
        db.run(
          `INSERT INTO product_batches (sync_id,product_id,price,cost,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`,
          [batchSyncId, productId, input.price, input.cost ?? 0, now, now]
        )
        const batchId = db.get<{ id: number }>(`SELECT id FROM product_batches WHERE sync_id=?`, [batchSyncId])!.id
        db.run(
          `INSERT INTO product_stocks (sync_id,product_id,batch_id,quantity,updated_at) VALUES (?,?,?,0,?)`,
          [uuid(), productId, batchId, now]
        )
        enqueue('products', productSyncId, 'upsert')
        enqueue('product_batches', batchSyncId, 'upsert')
      })
      return productId
    },

    update(productId: number, patch: Partial<ProductInput>): void {
      if (!uuid || !enqueue) throw new Error('Product repository is read-only without uuid/enqueue deps')
      const now = new Date().toISOString()
      db.transaction(() => {
        const existing = db.get<Record<string, any>>(`SELECT * FROM products WHERE id=?`, [productId])
        if (!existing) throw new Error(`Product ${productId} not found`)
        db.run(
          `UPDATE products SET name=?, sku=?, barcode=?, category_id=?, is_stock_managed=?, is_active=?, alert_quantity=?, updated_at=? WHERE id=?`,
          [
            patch.name ?? existing.name,
            patch.sku !== undefined ? patch.sku : existing.sku,
            patch.barcode !== undefined ? patch.barcode : existing.barcode,
            patch.categoryId !== undefined ? patch.categoryId : existing.category_id,
            patch.isStockManaged !== undefined ? (patch.isStockManaged ? 1 : 0) : existing.is_stock_managed,
            patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.is_active,
            patch.alertQuantity !== undefined ? patch.alertQuantity : existing.alert_quantity,
            now, productId,
          ]
        )
        if (patch.price !== undefined || patch.cost !== undefined) {
          db.run(
            `UPDATE product_batches SET price=COALESCE(?, price), cost=COALESCE(?, cost), updated_at=? WHERE product_id=? AND is_active=1`,
            [patch.price ?? null, patch.cost ?? null, now, productId]
          )
        }
        enqueue('products', existing.sync_id, 'upsert')
        const batch = db.get<{ sync_id: string }>(
          `SELECT sync_id FROM product_batches WHERE product_id=? AND is_active=1 LIMIT 1`, [productId]
        )
        if (batch?.sync_id) enqueue('product_batches', batch.sync_id, 'upsert')
      })
    },
    list(opts: { search?: string; categoryId?: number; limit?: number } = {}): ProductListItem[] {
      const clauses: string[] = []
      const params: unknown[] = []
      if (opts.search) {
        clauses.push(`(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)`)
        const like = `%${opts.search}%`
        params.push(like, like, like)
      }
      if (opts.categoryId) {
        clauses.push(`p.category_id = ?`)
        params.push(opts.categoryId)
      }
      const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : ''
      // Featured products lead the grid — fewest taps for the biggest sellers.
      const limit = ` ORDER BY p.is_featured DESC, p.name LIMIT ${Math.min(opts.limit ?? 200, 1000)}`
      return db.all<Record<string, any>>(PRODUCT_SELECT + where + limit, params).map(mapProduct)
    },

    findByBarcode(barcode: string): ProductListItem | null {
      const row = db.get<Record<string, any>>(`${PRODUCT_SELECT} AND p.barcode = ? LIMIT 1`, [barcode])
      return row ? mapProduct(row) : null
    },

    categories(): CategoryItem[] {
      return db
        .all<Record<string, any>>(
          `SELECT id, name, parent_id, sort_order FROM collections
           WHERE collection_type = 'category' ORDER BY sort_order, name`
        )
        .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, sortOrder: r.sort_order ?? 0 }))
    },
  }
}

export type ProductRepository = ReturnType<typeof createProductRepository>
