import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

export interface CategoryRow {
  id: number
  name: string
  description: string | null
  productCount: number
}

/** Plain CRUD for product categories (collections where collection_type='category') — mirrors desktop's client/src/screens/backoffice/CategoriesScreen.tsx. */
export function createCategoryRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(search?: string): CategoryRow[] {
      const clauses = [`c.collection_type='category'`, `c.deleted_at IS NULL`]
      const params: unknown[] = []
      if (search?.trim()) {
        clauses.push('c.name LIKE ?')
        params.push(`%${search.trim()}%`)
      }
      return db
        .all<Record<string, any>>(
          `SELECT c.id, c.name, c.description,
                  (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
           FROM collections c WHERE ${clauses.join(' AND ')} ORDER BY c.name`,
          params
        )
        .map((r) => ({ id: r.id, name: r.name, description: r.description, productCount: Number(r.product_count) || 0 }))
    },

    create(name: string, description?: string | null): void {
      const now = new Date().toISOString()
      const syncId = uuid()
      db.transaction(() => {
        db.run(
          `INSERT INTO collections (sync_id, collection_type, name, description, sort_order, created_at, updated_at)
           VALUES (?, 'category', ?, ?, 0, ?, ?)`,
          [syncId, name.trim(), description?.trim() || null, now, now]
        )
        enqueue('collections', syncId, 'upsert')
      })
    },

    update(id: number, name: string, description?: string | null): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        db.run(`UPDATE collections SET name=?, description=?, updated_at=? WHERE id=?`, [name.trim(), description?.trim() || null, now, id])
        const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM collections WHERE id=?`, [id])
        if (row?.sync_id) enqueue('collections', row.sync_id, 'upsert')
      })
    },

    softDelete(id: number): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        const row = db.get<{ sync_id: string }>(`SELECT sync_id FROM collections WHERE id=?`, [id])
        db.run(`UPDATE collections SET deleted_at=?, updated_at=? WHERE id=?`, [now, now, id])
        if (row?.sync_id) enqueue('collections', row.sync_id, 'delete')
      })
    },
  }
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>
