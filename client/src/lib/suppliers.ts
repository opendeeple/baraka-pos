import { v4 as uuidv4 } from 'uuid'
import { SUPPLIER_DEBT_SQL } from './purchases'

// Suppliers are contacts of type 'vendor' (the server's ContactType), synced
// like customers. What the shop owes one is computed from its received
// orders (purchases.total_amount − amount_paid), never kept as a counter.

export interface Supplier {
  id: number
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  /** What the shop still owes for goods received. */
  owed: number
  orders: number
  bought: number
  last_order: string | null
}

export interface SupplierForm { name: string; phone: string; address: string; notes: string }

export async function loadSuppliers(search = ''): Promise<Supplier[]> {
  const params: unknown[] = []
  let where = `c.type IN ('vendor','both') AND c.deleted_at IS NULL`
  if (search.trim()) {
    where += ` AND (c.name LIKE ? OR c.phone LIKE ?)`
    params.push(`%${search.trim()}%`, `%${search.trim()}%`)
  }
  const rows = await window.electronAPI.db.query(
    `SELECT c.id, c.name, c.phone, c.address, c.notes,
            ${SUPPLIER_DEBT_SQL} AS owed,
            (SELECT COUNT(*) FROM purchases WHERE vendor_id = c.id AND deleted_at IS NULL) AS orders,
            COALESCE((SELECT SUM(total_amount) FROM purchases WHERE vendor_id = c.id AND status = 'received' AND deleted_at IS NULL), 0) AS bought,
            (SELECT MAX(created_at) FROM purchases WHERE vendor_id = c.id AND deleted_at IS NULL) AS last_order
     FROM contacts c WHERE ${where}
     ORDER BY owed DESC, c.name`,
    params
  ) as Supplier[]
  return rows.map((r) => ({ ...r, owed: Number(r.owed), bought: Number(r.bought), orders: Number(r.orders) }))
}

/** Creates (id null) or updates a supplier and queues it for sync. Returns its id. */
export async function saveSupplier(id: number | null, form: SupplierForm): Promise<number> {
  const now = new Date().toISOString()
  const values = [form.name.trim(), form.phone.trim() || null, form.address.trim() || null, form.notes.trim() || null]
  if (id) {
    await window.electronAPI.db.exec(
      `UPDATE contacts SET name=?, phone=?, address=?, notes=?, updated_at=? WHERE id=?`, [...values, now, id]
    )
    const [row] = await window.electronAPI.db.query(`SELECT sync_id FROM contacts WHERE id=?`, [id]) as Array<{ sync_id: string }>
    if (row?.sync_id) await window.electronAPI.sync.enqueue('contacts', row.sync_id, 'upsert')
  } else {
    const syncId = uuidv4()
    await window.electronAPI.db.exec(
      `INSERT INTO contacts (sync_id, name, phone, address, notes, type, balance, loyalty_points_balance, created_at, updated_at)
       VALUES (?,?,?,?,?,'vendor',0,0,?,?)`,
      [syncId, ...values, now, now]
    )
    await window.electronAPI.sync.enqueue('contacts', syncId, 'upsert')
    const [row] = await window.electronAPI.db.query(`SELECT id FROM contacts WHERE sync_id=?`, [syncId]) as Array<{ id: number }>
    id = row.id
  }
  window.electronAPI.sync.pushPending().catch(() => {})
  return id
}
