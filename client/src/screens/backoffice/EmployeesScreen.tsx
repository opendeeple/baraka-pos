import { useState, useEffect } from 'react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import {
  Users, Plus, Search, Check, Eye, EyeOff,
  Shield, ChevronRight, Wallet, Calendar,
} from 'lucide-react'
import { fmtUZS } from '../../lib/currency'
import { Modal, Button, Input, Select, DatePicker } from '../../components/ui'

interface Employee {
  id: number
  name: string
  email?: string
  phone?: string
  role: 'super_admin' | 'admin' | 'manager' | 'cashier'
  pin_code?: string
  is_active: number
  salary?: number
  hire_date?: string
  created_at: string
}

interface SalaryRecord {
  id: number
  employee_id: number
  amount: number
  period_from: string
  period_to: string
  paid_at: string
  note?: string
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'text-red-400 bg-red-500/10',
  admin: 'text-purple-400 bg-purple-500/10',
  manager: 'text-blue-400 bg-blue-500/10',
  cashier: 'text-green-400 bg-green-500/10',
}

const ROLES = ['cashier', 'manager', 'admin'] as const

export default function EmployeesScreen() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showSalaryForm, setShowSalaryForm] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', role: 'cashier' as typeof ROLES[number],
    pin_code: '', salary: '', hire_date: '',
  })
  const [salaryForm, setSalaryForm] = useState({
    amount: '', period_from: '', period_to: '', note: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadEmployees() }, [])

  async function loadEmployees() {
    const rows = await window.electronAPI.db.query<Employee>(
      `SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name ASC`, []
    )
    setEmployees(rows)
  }

  async function selectEmployee(emp: Employee) {
    setSelectedEmp(emp)
    const records = await window.electronAPI.db.query<SalaryRecord>(
      `SELECT * FROM salary_records WHERE employee_id = ? ORDER BY paid_at DESC LIMIT 24`, [emp.id]
    )
    setSalaryRecords(records)
  }

  async function saveEmployee() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (selectedEmp) {
        await window.electronAPI.db.exec(
          `UPDATE users SET name=?, email=?, phone=?, role=?, pin_code=?, salary=?, hire_date=?, updated_at=? WHERE id=?`,
          [form.name, form.email || null, form.phone || null, form.role,
           form.pin_code || null, form.salary ? Number(form.salary) : null,
           form.hire_date || null, new Date().toISOString(), selectedEmp.id]
        )
      } else {
        // sync_id assigned for future employee sync; local users (employees
        // without a server username) are not pushed from desktop yet.
        await window.electronAPI.db.exec(
          `INSERT INTO users (sync_id, name, email, phone, role, pin_code, salary, hire_date, is_active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
          [crypto.randomUUID(), form.name, form.email || null, form.phone || null, form.role,
           form.pin_code || null, form.salary ? Number(form.salary) : null,
           form.hire_date || null, new Date().toISOString(), new Date().toISOString()]
        )
      }
      await loadEmployees()
      setShowForm(false)
      setForm({ name: '', email: '', phone: '', role: 'cashier', pin_code: '', salary: '', hire_date: '' })
    } finally { setSaving(false) }
  }

  async function toggleActive(emp: Employee) {
    await window.electronAPI.db.exec(
      `UPDATE users SET is_active=?, updated_at=? WHERE id=?`,
      [emp.is_active ? 0 : 1, new Date().toISOString(), emp.id]
    )
    loadEmployees()
    if (selectedEmp?.id === emp.id) setSelectedEmp({ ...emp, is_active: emp.is_active ? 0 : 1 })
  }

  async function saveSalary() {
    if (!selectedEmp || !salaryForm.amount || !salaryForm.period_from || !salaryForm.period_to) return
    setSaving(true)
    try {
      await window.electronAPI.db.exec(
        `INSERT INTO salary_records (employee_id, amount, period_from, period_to, paid_at, note)
         VALUES (?,?,?,?,?,?)`,
        [selectedEmp.id, Number(salaryForm.amount), salaryForm.period_from,
         salaryForm.period_to, new Date().toISOString(), salaryForm.note || null]
      )
      // Add to expenses
      await window.electronAPI.db.exec(
        `INSERT INTO expenses (expense_date, amount, category, description, reference, created_at)
         VALUES (?,?,'Salaries',?,?,?)`,
        [new Date().toISOString().split('T')[0], Number(salaryForm.amount),
         `Salary: ${selectedEmp.name}`, `SAL-${selectedEmp.id}`, new Date().toISOString()]
      )
      setSalaryForm({ amount: '', period_from: '', period_to: '', note: '' })
      setShowSalaryForm(false)
      await selectEmployee(selectedEmp)
    } finally { setSaving(false) }
  }

  const filtered = employees.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <BackOfficeLayout>
      <div className="flex items-center justify-between px-6 py-4 border-b border-dark-border shrink-0">
        <div>
          <h1 className="text-white font-bold text-xl">Employees</h1>
          <p className="text-gray-500 text-xs mt-0.5">{employees.length} staff members</p>
        </div>
        <Button icon={Plus} onClick={() => { setSelectedEmp(null); setShowForm(true) }}>
          Add Employee
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="w-72 border-r border-dark-border flex flex-col shrink-0">
          <div className="p-3 border-b border-dark-border">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees…"
                className="w-full pl-9 pr-3 py-2 bg-dark-card border border-dark-border text-white text-xs rounded-lg"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Users size={32} className="text-gray-700 mb-2" />
                <p className="text-gray-500 text-sm">
                  {search ? 'No results found' : 'No employees yet'}
                </p>
                {!search && (
                  <button
                    onClick={() => { setSelectedEmp(null); setShowForm(true) }}
                    className="mt-3 text-xs text-primary hover:text-orange-400 transition-colors"
                  >
                    + Add first employee
                  </button>
                )}
              </div>
            )}
            {filtered.map((emp) => (
              <button
                key={emp.id}
                onClick={() => selectEmployee(emp)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-dark-card text-left hover:bg-dark-card transition-colors ${
                  selectedEmp?.id === emp.id ? 'bg-dark-card' : ''
                } ${!emp.is_active ? 'opacity-50' : ''}`}
              >
                <div className="w-9 h-9 rounded-full bg-dark-border flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-white">{emp.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{emp.name}</p>
                  <p className={`text-xs font-medium px-1.5 py-0.5 rounded inline-block mt-0.5 ${ROLE_COLORS[emp.role] ?? 'text-gray-400'}`}>
                    {emp.role}
                  </p>
                </div>
                <ChevronRight size={14} className="text-gray-600 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedEmp ? (
            <div className="space-y-6">
              {/* Employee header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-dark-card border border-dark-border flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{selectedEmp.name.charAt(0)}</span>
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">{selectedEmp.name}</h2>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${ROLE_COLORS[selectedEmp.role]}`}>
                      {selectedEmp.role}
                    </span>
                    {selectedEmp.email && <p className="text-gray-400 text-sm mt-1">{selectedEmp.email}</p>}
                    {selectedEmp.phone && <p className="text-gray-400 text-sm">{selectedEmp.phone}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setForm({
                        name: selectedEmp.name, email: selectedEmp.email ?? '',
                        phone: selectedEmp.phone ?? '', role: selectedEmp.role as typeof ROLES[number],
                        pin_code: '', salary: selectedEmp.salary?.toString() ?? '',
                        hire_date: selectedEmp.hire_date ?? '',
                      })
                      setShowForm(true)
                    }}
                    className="px-3 py-1.5 bg-dark-card border border-dark-border text-gray-300 hover:text-white rounded-lg text-xs transition-colors"
                  >Edit</button>
                  <button
                    onClick={() => toggleActive(selectedEmp)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                      selectedEmp.is_active
                        ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                        : 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                    }`}
                  >
                    {selectedEmp.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              {/* Stats cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet size={14} className="text-primary" />
                    <span className="text-gray-500 text-xs">Monthly Salary</span>
                  </div>
                  <p className="text-white font-bold text-lg">
                    {selectedEmp.salary ? `UZS ${fmtUZS(Number(selectedEmp.salary))}` : '—'}
                  </p>
                </div>
                <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar size={14} className="text-blue-400" />
                    <span className="text-gray-500 text-xs">Hire Date</span>
                  </div>
                  <p className="text-white font-bold text-lg">{selectedEmp.hire_date ?? '—'}</p>
                </div>
                <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield size={14} className="text-purple-400" />
                    <span className="text-gray-500 text-xs">Role</span>
                  </div>
                  <p className="text-white font-bold text-lg capitalize">{selectedEmp.role}</p>
                </div>
              </div>

              {/* Salary history */}
              <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-sm">Salary Records</h3>
                  <button
                    onClick={() => setShowSalaryForm(true)}
                    className="flex items-center gap-1.5 bg-primary hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Plus size={12} /> Record Payment
                  </button>
                </div>
                {salaryRecords.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-8">No salary payments recorded</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-dark-border">
                        <th className="text-left pb-2">Period</th>
                        <th className="text-right pb-2">Amount</th>
                        <th className="text-right pb-2">Paid At</th>
                        <th className="text-left pb-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salaryRecords.map((r) => (
                        <tr key={r.id} className="border-b border-dark-card">
                          <td className="py-2 text-gray-300">{r.period_from} — {r.period_to}</td>
                          <td className="py-2 text-right text-white font-medium">UZS {fmtUZS(Number(r.amount))}</td>
                          <td className="py-2 text-right text-gray-400">{r.paid_at.split('T')[0]}</td>
                          <td className="py-2 text-gray-500 pl-3">{r.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
              <Users size={40} className="opacity-30" />
              <p className="text-sm">Select an employee to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Employee Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={selectedEmp ? 'Edit Employee' : 'New Employee'}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button className="flex-1" icon={Check} onClick={saveEmployee} loading={saving} disabled={!form.name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
            <div className="p-5 space-y-4">
              <Input label="Full Name *" value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Email" type="email" value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
                <Input label="Phone" value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Role">
                  <Select
                    value={form.role}
                    onChange={(v) => setForm(f => ({ ...f, role: v as typeof ROLES[number] }))}
                    options={ROLES.map(r => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))}
                  />
                </Field>
                <Input label="PIN Code" value={form.pin_code}
                  onChange={(e) => setForm(f => ({ ...f, pin_code: e.target.value }))}
                  type={showPin ? 'text' : 'password'} maxLength={6} placeholder="4-6 digits"
                  right={
                    <button type="button" onClick={() => setShowPin(p => !p)}
                      className="text-gray-500 hover:text-white">
                      {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  } />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Monthly Salary (UZS)" type="number" min="0" value={form.salary}
                  onChange={(e) => setForm(f => ({ ...f, salary: e.target.value }))} />
                <Field label="Hire Date">
                  <DatePicker value={form.hire_date} onChange={(v) => setForm(f => ({ ...f, hire_date: v }))} className="w-full" />
                </Field>
              </div>
            </div>
      </Modal>

      {/* Salary payment modal */}
      {selectedEmp && (
        <Modal
          open={showSalaryForm}
          onClose={() => setShowSalaryForm(false)}
          title="Record Salary Payment"
          maxWidth="max-w-sm"
          footer={
            <>
              <Button variant="secondary" className="flex-1" onClick={() => setShowSalaryForm(false)}>Cancel</Button>
              <Button className="flex-1" icon={Check} onClick={saveSalary} loading={saving}>
                {saving ? 'Saving…' : 'Record'}
              </Button>
            </>
          }
        >
            <div className="p-5 space-y-4">
              <p className="text-gray-400 text-sm">For: <span className="text-white font-medium">{selectedEmp.name}</span></p>
              <Input label="Amount (UZS) *" type="number" min="0" value={salaryForm.amount}
                placeholder={selectedEmp.salary ? String(selectedEmp.salary) : '0'}
                onChange={(e) => setSalaryForm(f => ({ ...f, amount: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Period From *">
                  <DatePicker value={salaryForm.period_from} onChange={(v) => setSalaryForm(f => ({ ...f, period_from: v }))} className="w-full" />
                </Field>
                <Field label="Period To *">
                  <DatePicker value={salaryForm.period_to} onChange={(v) => setSalaryForm(f => ({ ...f, period_to: v }))} className="w-full" />
                </Field>
              </div>
              <Input label="Note" placeholder="Optional" value={salaryForm.note}
                onChange={(e) => setSalaryForm(f => ({ ...f, note: e.target.value }))} />
            </div>
        </Modal>
      )}
    </BackOfficeLayout>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-gray-400 text-xs mb-1.5">{label}</label>
      {children}
    </div>
  )
}
