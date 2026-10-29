import type { DbAdapter } from '../adapter'
import type { EnqueueFn } from './contact.repo'

// Staff management — mirrors desktop's client/src/screens/backoffice/EmployeesScreen.tsx.
// Badge generation/printing and the server-backed Attendance tab are not
// ported (see the mobile-parity plan).

export type EmployeeRole = 'cashier' | 'manager' | 'admin'

export interface EmployeeRow {
  id: number
  syncId: string
  name: string
  email: string | null
  phone: string | null
  role: string
  salary: number | null
  hireDate: string | null
  isActive: boolean
  syncPending: boolean
}

export interface EmployeeForm {
  name: string
  email?: string | null
  phone?: string | null
  role: EmployeeRole
  pinCode?: string | null
  salary?: number | null
  hireDate?: string | null
}

export interface SalaryRecordRow {
  id: number
  amount: number
  periodFrom: string
  periodTo: string
  paidAt: string
  note: string | null
}

function mapRow(r: Record<string, any>): EmployeeRow {
  return {
    id: r.id, syncId: r.sync_id, name: r.name, email: r.email, phone: r.phone, role: r.role,
    salary: r.salary != null ? Number(r.salary) : null, hireDate: r.hire_date,
    isActive: Boolean(r.is_active), syncPending: Boolean(r.sync_pending),
  }
}

export function createEmployeeRepository(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    list(search?: string): EmployeeRow[] {
      const clauses = ['u.deleted_at IS NULL']
      const params: unknown[] = []
      if (search?.trim()) {
        clauses.push('(u.name LIKE ? OR u.email LIKE ?)')
        params.push(`%${search.trim()}%`, `%${search.trim()}%`)
      }
      return db
        .all<Record<string, any>>(
          `SELECT u.*, EXISTS (
             SELECT 1 FROM sync_queue_local q WHERE q.sync_id = u.sync_id AND q.status IN ('pending', 'dead')
           ) AS sync_pending
           FROM users u WHERE ${clauses.join(' AND ')} ORDER BY u.name`,
          params
        )
        .map(mapRow)
    },

    /** Employees must reach the server — that's where badge/PIN logins are checked. */
    save(id: number | null, form: EmployeeForm): void {
      const now = new Date().toISOString()
      let syncId = ''
      db.transaction(() => {
        if (id) {
          const existing = db.get<{ sync_id: string }>(`SELECT sync_id FROM users WHERE id=?`, [id])
          if (!existing) throw new Error(`Employee ${id} not found`)
          syncId = existing.sync_id
          db.run(
            `UPDATE users SET name=?, email=?, phone=?, role=?, pin_code=COALESCE(?, pin_code), salary=?, hire_date=?, updated_at=? WHERE id=?`,
            [form.name, form.email || null, form.phone || null, form.role, form.pinCode || null, form.salary ?? null, form.hireDate || null, now, id]
          )
        } else {
          syncId = uuid()
          db.run(
            `INSERT INTO users (sync_id, name, email, phone, role, pin_code, salary, hire_date, is_active, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
            [syncId, form.name, form.email || null, form.phone || null, form.role, form.pinCode || null, form.salary ?? null, form.hireDate || null, now, now]
          )
        }
        enqueue('users', syncId, 'upsert')
      })
    },

    toggleActive(id: number): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        const row = db.get<{ sync_id: string; is_active: number }>(`SELECT sync_id, is_active FROM users WHERE id=?`, [id])
        if (!row) return
        // Deactivating must reach the server too, or their badge keeps working.
        db.run(`UPDATE users SET is_active=?, updated_at=? WHERE id=?`, [row.is_active ? 0 : 1, now, id])
        enqueue('users', row.sync_id, 'upsert')
      })
    },

    salaryRecords(employeeId: number, limit = 24): SalaryRecordRow[] {
      return db
        .all<Record<string, any>>(
          `SELECT * FROM salary_records WHERE employee_id=? ORDER BY paid_at DESC LIMIT ?`,
          [employeeId, limit]
        )
        .map((r) => ({
          id: r.id, amount: Number(r.amount) || 0, periodFrom: r.period_from, periodTo: r.period_to,
          paidAt: r.paid_at, note: r.note,
        }))
    },

    /** Records a payment and mirrors it into expenses (category 'Salaries') so it shows up in Reports. */
    recordSalary(employeeId: number, employeeName: string, amount: number, periodFrom: string, periodTo: string, note?: string | null): void {
      const now = new Date().toISOString()
      db.transaction(() => {
        db.run(
          `INSERT INTO salary_records (employee_id, amount, period_from, period_to, paid_at, note) VALUES (?,?,?,?,?,?)`,
          [employeeId, amount, periodFrom, periodTo, now, note || null]
        )
        const expenseSyncId = uuid()
        db.run(
          `INSERT INTO expenses (sync_id, expense_date, amount, category, description, reference, created_at, updated_at)
           VALUES (?,?,?,'Salaries',?,?,?,?)`,
          [expenseSyncId, now.split('T')[0], amount, `Salary: ${employeeName}`, `SAL-${employeeId}`, now, now]
        )
        enqueue('expenses', expenseSyncId, 'upsert')
      })
    },
  }
}

export type EmployeeRepository = ReturnType<typeof createEmployeeRepository>
