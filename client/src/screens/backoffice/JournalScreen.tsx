import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ScrollText, Search } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { EmptyState, PageHeader, Select } from '../../components/ui'
import { fmtUZS } from '../../lib/currency'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Entry {
  id: number; action: string; entity: string | null; entity_id: string | null
  details: string | null; user_name: string | null; occurred_at: string
}

type Group = 'all' | 'sales' | 'stock' | 'money' | 'products' | 'system'

const GROUPS: Record<Exclude<Group, 'all'>, string[]> = {
  sales: ['sale_void', 'sale_return'],
  stock: ['stock_receive', 'stock_transfer', 'stocktake', 'writeoff', 'purchase_order', 'purchase_receive'],
  money: ['expense', 'debt_payment', 'debt_clear', 'supplier_payment', 'shift_close', 'drawer_open'],
  products: ['price_change', 'product_create', 'product_delete'],
  system: ['settings_change'],
}

// Entries worth the owner's eye: money or goods leaving outside a normal sale.
const ATTENTION = new Set(['sale_void', 'writeoff', 'product_delete', 'debt_clear', 'price_change'])

const money = (v: unknown) => `UZS ${fmtUZS(Number(v) || 0)}`

function place(t: TFunction, loc: unknown) {
  return loc === 'warehouse' ? t('purchases.toWarehouse') : t('purchases.toShop')
}

/** One readable line per journal entry, from its details. */
function describe(t: TFunction, e: Entry, d: Record<string, any>): string {
  switch (e.action) {
    case 'sale_void':
      return `${e.entity_id} · ${money(d.total)} · ${t('journal.reason')}: ${d.reason ?? '—'}`
    case 'sale_return':
      return `${e.entity_id} → ${d.returnInvoice} · ${money(d.refund)} (${t(`suppliers.method_${d.method}`, { defaultValue: d.method })})`
        + (Array.isArray(d.lines) ? ` · ${d.lines.map((l: any) => `${l.product} ×${l.qty}`).join(', ')}` : '')
    case 'stock_receive':
      return `${d.product ?? ''} +${d.qty} → ${place(t, d.location)}${d.reason ? ` · ${d.reason}` : ''}`
    case 'stock_transfer':
      return `${d.product ?? ''}: ${d.qty} · ${t('journal.warehouseToShop')}`
    case 'stocktake':
      return `${place(t, d.location)} · ${t('journal.stocktakeLine', { counted: d.counted, changed: d.changed })}`
        + ` · ${t('stocktake.shortage')} ${money(d.shortageValue)} · ${t('stocktake.surplus')} ${money(d.surplusValue)}`
    case 'writeoff':
      return `${d.product}: −${d.qty} (${place(t, d.location)}) · ${t(`writeoff.reason_${d.reason}`, { defaultValue: d.reason })}`
        + `${d.note ? ` — ${d.note}` : ''} · ${t('writeoff.loss')} ${money(d.value)}`
    case 'purchase_order':
      return `${e.entity_id} · ${t('journal.linesCount', { count: d.lines })} · ${money(d.total)}`
    case 'purchase_receive':
      return `${e.entity_id} → ${place(t, d.location)}${d.total != null ? ` · ${money(d.total)}` : ''}`
    case 'supplier_payment':
      return `${d.supplier ? `${d.supplier}: ` : ''}${money(d.amount)} · ${t(`suppliers.method_${d.method}`, { defaultValue: d.method })}${Array.isArray(d.orders) ? ` · ${d.orders.join(', ')}` : ''}`
    case 'price_change':
      return `${d.product}: ${money(d.from)} → ${money(d.to)}`
    case 'product_create':
      return `${d.product} · ${money(d.price)}`
    case 'product_delete':
      return `${d.product}${d.stock != null ? ` · ${t('journal.stockLeft', { qty: d.stock })}` : ''}`
    case 'expense':
      return `${d.category ?? ''} · ${money(d.amount)}${d.description ? ` · ${d.description}` : ''}`
    case 'debt_payment':
      return `${d.customer}: ${money(d.amount)} (${t(`suppliers.method_${d.method}`, { defaultValue: d.method ?? '' })}) · ${t('journal.debtLeft', { amount: fmtUZS(Number(d.balanceAfter) || 0) })}`
    case 'debt_clear':
      return `${d.customer}: ${money(d.totalDebt)}`
    case 'shift_close':
      return `${t('shift.expected')} ${money(d.expected)} · ${t('shift.counted')} ${money(d.counted)} · ${t('journal.variance')} ${money(d.variance)}`
    case 'settings_change':
      return t(`journal.setting_${e.entity_id}`, { defaultValue: e.entity_id ?? '' })
    default:
      return ''
  }
}

/**
 * The journal: every sensitive action — voids, refunds, stock corrections,
 * write-offs, price changes, cash out of the drawer, deleted debts — with who
 * did it, when and why. Synced from every device, so the owner sees it all here.
 */
export default function JournalScreen() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<Entry[]>([])
  const [period, setPeriod] = useState('7')
  const [group, setGroup] = useState<Group>('all')
  const [user, setUser] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)

  useEffect(() => {
    let sql = `SELECT id, action, entity, entity_id, details, user_name, occurred_at FROM audit_logs WHERE 1=1`
    const params: unknown[] = []
    if (period !== 'all') {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - (Number(period) - 1))
      sql += ` AND occurred_at >= ?`
      params.push(from.toISOString())
    }
    if (group !== 'all') {
      sql += ` AND action IN (${GROUPS[group].map(() => '?').join(',')})`
      params.push(...GROUPS[group])
    }
    if (user) { sql += ` AND user_name = ?`; params.push(user) }
    if (debounced.trim()) {
      sql += ` AND (details LIKE ? OR entity_id LIKE ?)`
      params.push(`%${debounced.trim()}%`, `%${debounced.trim()}%`)
    }
    sql += ` ORDER BY occurred_at DESC LIMIT 500`
    window.electronAPI.db.query(sql, params).then((rows) => setEntries(rows as Entry[]))
  }, [period, group, user, debounced])

  const [users, setUsers] = useState<string[]>([])
  useEffect(() => {
    window.electronAPI.db.query(`SELECT DISTINCT user_name FROM audit_logs WHERE user_name IS NOT NULL ORDER BY user_name`, [])
      .then((rows) => setUsers((rows as Array<{ user_name: string }>).map((r) => r.user_name)))
  }, [])

  const parsed = useMemo(() => entries.map((e) => {
    let d: Record<string, any> = {}
    try { d = e.details ? JSON.parse(e.details) : {} } catch { /* keep empty */ }
    const shortShift = e.action === 'shift_close' && Number(d.variance) < 0
    return { e, text: describe(t, e, d), attention: ATTENTION.has(e.action) || shortShift }
  }), [entries, t])

  return (
    <BackOfficeLayout>
      <PageHeader title={t('nav.journal')} subtitle={t('pageHints.journal')} />
      <div className="shrink-0 px-6 py-3 border-b border-dark-border space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'sales', 'stock', 'money', 'products', 'system'] as Group[]).map((g) => (
            <button key={g} onClick={() => setGroup(g)}
              className={`h-9 px-4 rounded-full text-sm border ${group === g ? 'border-primary bg-primary/15 text-primary' : 'border-dark-border text-gray-400 hover:text-white'}`}>
              {t(`journal.group_${g}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44">
            <Select value={period} onChange={setPeriod} options={[
              { value: '1', label: t('journal.today') }, { value: '7', label: t('journal.last7') },
              { value: '30', label: t('journal.last30') }, { value: 'all', label: t('journal.allTime') },
            ]} />
          </div>
          <div className="w-48">
            <Select value={user} onChange={setUser} options={[{ value: '', label: t('journal.allUsers') }, ...users.map((u) => ({ value: u, label: u }))]} />
          </div>
          <div className="relative w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('journal.search')}
              className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
          </div>
          <span className="ml-auto text-xs text-gray-500">{t('journal.count', { count: entries.length })}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {parsed.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('journal.empty')} />
        ) : (
          <div className="divide-y divide-dark-border">
            {parsed.map(({ e, text, attention }) => (
              <div key={e.id} className={`px-6 py-3 flex gap-4 items-start ${attention ? 'bg-red-500/5' : ''}`}>
                <div className="w-28 shrink-0">
                  <p className="text-xs text-gray-300">{new Date(e.occurred_at).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-500">{new Date(e.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="w-48 shrink-0">
                  <p className={`text-sm font-medium ${attention ? 'text-red-300' : 'text-white'}`}>{t(`journal.action_${e.action}`, { defaultValue: e.action })}</p>
                  <p className="text-xs text-gray-500">{e.user_name ?? '—'}</p>
                </div>
                <p className="flex-1 text-sm text-gray-300 break-words">{text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </BackOfficeLayout>
  )
}
