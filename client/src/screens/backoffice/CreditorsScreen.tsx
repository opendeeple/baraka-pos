import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Search, Landmark, CheckCircle2, Pencil, Trash2, BellRing, Banknote, Package } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { useAuthStore } from '../../store/auth.store'
import { Modal, Button, Input, EmptyState, PageHeader, Select, DatePicker, SkeletonRow } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { daysUntil, fmtCreditorAmount, todayYmd, type CreditorCurrency } from '../../lib/creditors'

interface Creditor {
  id: number; sync_id: string; name: string; phone: string | null
  amount: number; currency: CreditorCurrency; return_type: 'money' | 'product'; product_note: string | null
  received_at: string; due_date: string; remind_days: number
  status: 'open' | 'returned'; returned_at: string | null; note: string | null
}

type StatusFilter = 'open' | 'returned' | 'all'

interface FormState {
  name: string; phone: string; amount: string; currency: CreditorCurrency
  return_type: 'money' | 'product'; product_note: string
  received_at: string; due_date: string; remind_days: string; note: string
}

function emptyForm(): FormState {
  return {
    name: '', phone: '', amount: '', currency: 'UZS', return_type: 'money', product_note: '',
    received_at: todayYmd(), due_date: '', remind_days: '3', note: '',
  }
}

/**
 * Haqdorlar — money the shop took from customers and must give back by a
 * due date, as money or as goods. The owner is warned ahead of the due date
 * (creditorReminder.service.ts); this list shows how long each one has left.
 */
export default function CreditorsScreen() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const [rows, setRows] = useState<Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [editing, setEditing] = useState<Creditor | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [returnTarget, setReturnTarget] = useState<Creditor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Creditor | null>(null)
  const [checking, setChecking] = useState(false)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { load() }, [debouncedSearch, status])
  useEffect(() => {
    // Other devices' changes arrive through sync; the remaining days also tick over at midnight.
    const timer = setInterval(() => load(true), 30_000)
    return () => clearInterval(timer)
  }, [debouncedSearch, status])

  async function load(silent = false) {
    let sql = `SELECT id, sync_id, name, phone, amount, currency, return_type, product_note, received_at, due_date,
                      remind_days, status, returned_at, note
               FROM creditors WHERE deleted_at IS NULL`
    const params: unknown[] = []
    if (status !== 'all') { sql += ` AND status = ?`; params.push(status) }
    if (debouncedSearch.trim()) {
      sql += ` AND (name LIKE ? OR phone LIKE ?)`
      const q = `%${debouncedSearch.trim()}%`; params.push(q, q)
    }
    sql += status === 'returned' ? ` ORDER BY returned_at DESC` : ` ORDER BY status = 'returned', due_date ASC`
    sql += ` LIMIT 500`
    if (!silent) setLoading(true)
    try {
      setRows(await window.electronAPI.db.query(sql, params) as Creditor[])
    } finally { if (!silent) setLoading(false) }
  }

  const open = rows.filter((r) => r.status === 'open')
  const totalUzs = open.filter((r) => r.currency !== 'USD').reduce((s, r) => s + Number(r.amount), 0)
  const totalUsd = open.filter((r) => r.currency === 'USD').reduce((s, r) => s + Number(r.amount), 0)

  function openAdd() {
    setEditing(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(c: Creditor) {
    setEditing(c)
    setForm({
      name: c.name, phone: c.phone ?? '', amount: String(c.amount), currency: c.currency,
      return_type: c.return_type, product_note: c.product_note ?? '',
      received_at: c.received_at, due_date: c.due_date, remind_days: String(c.remind_days), note: c.note ?? '',
    })
    setShowForm(true)
  }

  const formValid = form.name.trim() !== '' && Number(form.amount) > 0 && form.due_date !== ''
    && form.received_at !== '' && form.due_date >= form.received_at

  async function save() {
    if (!formValid) return
    setSaving(true)
    const now = new Date().toISOString()
    const remindDays = Math.max(0, Math.floor(Number(form.remind_days) || 0))
    const values = [
      form.name.trim(), form.phone.trim() || null, Number(form.amount), form.currency, form.return_type,
      form.return_type === 'product' ? (form.product_note.trim() || null) : null,
      form.received_at, form.due_date, remindDays, form.note.trim() || null,
    ]
    try {
      let syncId: string
      if (editing) {
        syncId = editing.sync_id
        // A new due date or warning window means the owner should be warned again.
        const rescheduled = editing.due_date !== form.due_date || Number(editing.remind_days) !== remindDays
        await window.electronAPI.db.exec(
          `UPDATE creditors SET name=?, phone=?, amount=?, currency=?, return_type=?, product_note=?, received_at=?,
             due_date=?, remind_days=?, note=?, updated_at=?
             ${rescheduled ? ', reminder_sent_at=NULL, overdue_sent_at=NULL' : ''}
           WHERE id=?`,
          [...values, now, editing.id]
        )
      } else {
        syncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO creditors (name, phone, amount, currency, return_type, product_note, received_at, due_date,
             remind_days, note, sync_id, status, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`,
          [...values, syncId, user?.id ?? null, now, now]
        )
      }
      await window.electronAPI.sync.enqueue('creditors', syncId, 'upsert')
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('creditors.saved'))
      setShowForm(false)
      load(true)
    } catch (e) {
      toast.error(String(e))
    } finally { setSaving(false) }
  }

  async function markReturned(c: Creditor) {
    const now = new Date().toISOString()
    await window.electronAPI.db.exec(
      `UPDATE creditors SET status='returned', returned_at=?, updated_at=? WHERE id=?`, [todayYmd(), now, c.id]
    )
    await window.electronAPI.sync.enqueue('creditors', c.sync_id, 'upsert')
    window.electronAPI.sync.pushPending().catch(() => {})
    setReturnTarget(null)
    toast.success(t('creditors.returnedToast', { name: c.name }))
    load(true)
  }

  async function remove(c: Creditor) {
    const now = new Date().toISOString()
    await window.electronAPI.db.exec(`UPDATE creditors SET deleted_at=?, updated_at=? WHERE id=?`, [now, now, c.id])
    await window.electronAPI.sync.enqueue('creditors', c.sync_id, 'delete')
    window.electronAPI.sync.pushPending().catch(() => {})
    setDeleteTarget(null)
    load(true)
  }

  async function checkNow() {
    setChecking(true)
    try {
      const r = await window.electronAPI.notify.creditors()
      toast.success(r.notified > 0
        ? t('creditors.checkResult', { count: r.notified, sms: t(`creditors.sms_${r.sms}`) })
        : t('creditors.checkNothing'))
    } catch (e) {
      toast.error(String(e))
    } finally { setChecking(false) }
  }

  function remaining(c: Creditor) {
    if (c.status === 'returned') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle2 size={13} /> {t('creditors.returnedOn', { date: c.returned_at ?? '' })}
        </span>
      )
    }
    const days = daysUntil(c.due_date)
    const label = days > 0 ? t('creditors.daysLeft', { count: days })
      : days === 0 ? t('creditors.dueToday')
      : t('creditors.daysOverdue', { count: -days })
    const tone = days <= 0 ? 'bg-red-500/20 text-red-300'
      : days <= Number(c.remind_days) ? 'bg-yellow-500/20 text-yellow-300'
      : 'bg-dark-card text-gray-300 border border-dark-border'
    return <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${tone}`}>{label}</span>
  }

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.creditors')}
        subtitle={<>
          {t('pageHints.creditors')} · {t('common.total')}:{' '}
          <span className="text-yellow-300 font-semibold">{fmtCreditorAmount(totalUzs, 'UZS')}</span>
          {totalUsd > 0 && <> + <span className="text-yellow-300 font-semibold">{fmtCreditorAmount(totalUsd, 'USD')}</span></>}
        </>}
        actions={<>
          <Button variant="secondary" icon={BellRing} loading={checking} onClick={checkNow}>{t('creditors.checkNow')}</Button>
          <Button icon={Plus} onClick={openAdd}>{t('creditors.add')}</Button>
        </>}
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('customers.searchByNameOrPhone')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <Select
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          className="w-44 shrink-0"
          options={[
            { value: 'open', label: t('creditors.filterOpen') },
            { value: 'returned', label: t('creditors.filterReturned') },
            { value: 'all', label: t('creditors.filterAll') },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.name'), t('common.phone'), t('common.amount'), t('creditors.returnAs'), t('creditors.receivedAt'),
              t('creditors.dueDate'), t('creditors.remaining'), ''].map((h, i) => (
              <th key={i} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={8} />)}
            {!loading && rows.map((c) => (
              <tr key={c.id} className="hover:bg-dark-card/40">
                <td className="px-4 py-3 text-sm">
                  <p className="text-white font-medium">{c.name}</p>
                  {c.note && <p className="text-xs text-gray-500 truncate max-w-[220px]" title={c.note}>{c.note}</p>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-sm font-semibold text-yellow-300 whitespace-nowrap">{fmtCreditorAmount(Number(c.amount), c.currency)}</td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  <span className="inline-flex items-center gap-1.5">
                    {c.return_type === 'product' ? <Package size={13} /> : <Banknote size={13} />}
                    {c.return_type === 'product' ? t('creditors.asProduct') : t('creditors.asMoney')}
                  </span>
                  {c.return_type === 'product' && c.product_note && (
                    <p className="text-xs text-gray-500 truncate max-w-[200px]" title={c.product_note}>{c.product_note}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">{c.received_at}</td>
                <td className="px-4 py-3 text-gray-300 text-sm whitespace-nowrap">{c.due_date}</td>
                <td className="px-4 py-3">{remaining(c)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 justify-end">
                    {c.status === 'open' && (
                      <button onClick={() => setReturnTarget(c)} className="flex items-center gap-1.5 text-xs text-green-400 hover:underline whitespace-nowrap">
                        <CheckCircle2 size={13} /> {t('creditors.markReturned')}
                      </button>
                    )}
                    <button onClick={() => openEdit(c)} title={t('common.edit')} className="text-gray-400 hover:text-white">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget(c)} title={t('common.delete')} className="text-gray-400 hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <EmptyState icon={Landmark} title={t('creditors.none')} />}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t('creditors.edit') : t('creditors.add')}
        maxWidth="max-w-md"
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={save} loading={saving} disabled={!formValid}>{t('common.save')}</Button>
        </>}
      >
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('creditors.nameRequired')} value={form.name} autoFocus
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input label={t('common.phone')} value={form.phone} placeholder="+998 90 123 45 67"
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <Input label={t('creditors.amountRequired')} type="number" min={0} value={form.amount} placeholder="0"
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
            <div className="flex rounded-lg border border-dark-border overflow-hidden h-[42px]">
              {(['UZS', 'USD'] as const).map((cur) => (
                <button key={cur} type="button" onClick={() => setForm((p) => ({ ...p, currency: cur }))}
                  className={`px-4 text-sm font-semibold ${form.currency === cur ? 'bg-primary text-white' : 'bg-dark-card text-gray-400 hover:text-white'}`}>
                  {cur === 'UZS' ? t('creditors.uzs') : t('creditors.usd')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('creditors.returnAs')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['money', 'product'] as const).map((rt) => (
                <button key={rt} type="button" onClick={() => setForm((p) => ({ ...p, return_type: rt }))}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm ${
                    form.return_type === rt ? 'border-primary bg-primary/15 text-white' : 'border-dark-border bg-dark-card text-gray-400 hover:text-white'
                  }`}>
                  {rt === 'money' ? <Banknote size={15} /> : <Package size={15} />}
                  {rt === 'money' ? t('creditors.asMoney') : t('creditors.asProduct')}
                </button>
              ))}
            </div>
          </div>
          {form.return_type === 'product' && (
            <Input label={t('creditors.productNote')} value={form.product_note} placeholder={t('creditors.productNotePlaceholder')}
              onChange={(e) => setForm((p) => ({ ...p, product_note: e.target.value }))} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('creditors.receivedAt')}</label>
              <DatePicker value={form.received_at} onChange={(v) => setForm((p) => ({ ...p, received_at: v }))} className="w-full" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('creditors.dueDateRequired')}</label>
              <DatePicker value={form.due_date} min={form.received_at} placeholder={t('creditors.pickDate')}
                onChange={(v) => setForm((p) => ({ ...p, due_date: v }))} className="w-full" />
            </div>
          </div>
          <Input label={t('creditors.remindDays')} type="number" min={0} value={form.remind_days}
            onChange={(e) => setForm((p) => ({ ...p, remind_days: e.target.value }))} />
          <p className="text-xs text-gray-500 -mt-1">{t('creditors.remindDaysHint')}</p>
          <Input label={t('creditors.note')} value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        title={t('creditors.markReturned')}
        maxWidth="max-w-sm"
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setReturnTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="success" className="flex-1" onClick={() => returnTarget && markReturned(returnTarget)}>{t('common.confirm')}</Button>
        </>}
      >
        {returnTarget && (
          <p className="p-5 text-sm text-gray-300">
            {t('creditors.returnConfirm', {
              name: returnTarget.name,
              amount: fmtCreditorAmount(Number(returnTarget.amount), returnTarget.currency),
            })}
          </p>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('common.delete')}
        maxWidth="max-w-sm"
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" className="flex-1" onClick={() => deleteTarget && remove(deleteTarget)}>{t('common.delete')}</Button>
        </>}
      >
        {deleteTarget && <p className="p-5 text-sm text-gray-300">{t('creditors.deleteConfirm', { name: deleteTarget.name })}</p>}
      </Modal>
    </BackOfficeLayout>
  )
}
