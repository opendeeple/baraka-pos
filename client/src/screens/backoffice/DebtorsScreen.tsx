import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Users2, MessageCircle, CheckCircle2, XCircle } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { PageHeader, EmptyState, SkeletonRow, Select } from '../../components/ui'
import { SendMessageModal } from '../../components/backoffice/SendMessageModal'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Debtor {
  id: number; server_id: number | null; name: string; phone: string | null
  balance: number; last_sale_at: string | null; telegram_chat_id: string | null
}

type SortBy = 'balance_desc' | 'balance_asc' | 'name'

/**
 * Separate, filterable view of customers who owe money — pulled out of the
 * general Customers list per the owner's request, with a "send message"
 * action reusing the same Telegram/SMS flow as CustomersScreen.
 */
export default function DebtorsScreen() {
  const { t } = useTranslation()
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('balance_desc')
  const [loading, setLoading] = useState(true)
  const [messageTarget, setMessageTarget] = useState<Debtor | null>(null)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { loadDebtors() }, [debouncedSearch, sortBy])
  useEffect(() => {
    // Telegram connection happens outside this screen (customer taps the
    // deep link in their own Telegram), so refresh periodically to reflect it.
    const timer = setInterval(() => { loadDebtors(true) }, 5000)
    return () => clearInterval(timer)
  }, [debouncedSearch, sortBy])

  async function loadDebtors(silent = false) {
    let sql = `
      SELECT c.id, c.server_id, c.name, c.phone, c.balance, c.telegram_chat_id,
             (SELECT MAX(s.created_at) FROM sales s WHERE s.contact_id = c.id) as last_sale_at
      FROM contacts c
      WHERE c.type IN ('customer','both') AND c.deleted_at IS NULL AND c.balance > 0`
    const params: unknown[] = []
    if (debouncedSearch.trim()) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ?)`
      const q = `%${debouncedSearch}%`; params.push(q, q)
    }
    sql += sortBy === 'balance_asc' ? ` ORDER BY c.balance ASC`
      : sortBy === 'name' ? ` ORDER BY c.name ASC`
      : ` ORDER BY c.balance DESC`
    sql += ` LIMIT 200`
    if (!silent) setLoading(true)
    try {
      setDebtors(await window.electronAPI.db.query(sql, params) as Debtor[])
    } finally { if (!silent) setLoading(false) }
  }

  const totalDebt = debtors.reduce((sum, d) => sum + Number(d.balance), 0)

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.debtors')}
        subtitle={<>{t('common.total')}: <span className="text-red-400 font-semibold">UZS {fmtUZS(totalDebt)}</span></>}
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('customers.searchByNameOrPhone')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
        <Select
          value={sortBy}
          onChange={(v) => setSortBy(v as SortBy)}
          className="w-44 shrink-0"
          options={[
            { value: 'balance_desc', label: t('debtors.sortBalanceDesc') },
            { value: 'balance_asc', label: t('debtors.sortBalanceAsc') },
            { value: 'name', label: t('debtors.sortName') },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.name'), t('common.phone'), t('debtors.lastPurchase'), t('customers.balanceCol'), t('debtors.telegramCol'), ''].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={6} />)}
            {!loading && debtors.map((d) => (
              <tr key={d.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3 text-white text-sm font-medium">{d.name}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{d.phone ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">
                  {d.last_sale_at ? new Date(d.last_sale_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-red-400 text-sm font-semibold">UZS {fmtUZS(Number(d.balance))}</td>
                <td className="px-4 py-3">
                  {d.telegram_chat_id ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
                      <CheckCircle2 size={13} /> {t('notifications.telegramConnected')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                      <XCircle size={13} /> {t('debtors.notConnected')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setMessageTarget(d)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MessageCircle size={13} /> {t('notifications.sendMessage')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && debtors.length === 0 && (
          <EmptyState icon={Users2} title={t('debtors.noDebtors')} />
        )}
      </div>

      {messageTarget && (
        <SendMessageModal
          contactId={messageTarget.id}
          contactName={messageTarget.name}
          hasDebt
          onClose={() => setMessageTarget(null)}
        />
      )}
    </BackOfficeLayout>
  )
}
