import { useCallback, useMemo, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { JOURNAL_ATTENTION, type JournalEntry, type JournalGroup } from '@baraka/data'
import { Chip, EmptyState, Input, ListRow, Screen, useTheme } from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

const GROUPS: JournalGroup[] = ['all', 'sales', 'stock', 'money', 'products', 'system']
const PERIODS: Array<{ label: string; value: number | 'all' }> = [
  { label: 'Today', value: 1 },
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'All time', value: 'all' },
]

const money = (v: unknown) => `UZS ${Math.round(Number(v) || 0).toLocaleString('en-US')}`
const place = (loc: unknown) => (loc === 'warehouse' ? 'warehouse' : 'shop')

/** One readable line per journal entry — ported from desktop's JournalScreen.tsx describe(). */
function describe(e: JournalEntry, d: Record<string, any>): string {
  switch (e.action) {
    case 'sale_void':
      return `${e.entityId} · ${money(d.total)} · reason: ${d.reason ?? '—'}`
    case 'sale_return':
      return `${e.entityId} → ${d.returnInvoice} · ${money(d.refund)} (${d.method ?? ''})`
        + (Array.isArray(d.lines) ? ` · ${d.lines.map((l: any) => `${l.product} ×${l.qty}`).join(', ')}` : '')
    case 'stock_receive':
      return `${d.product ?? ''} +${d.qty} → ${place(d.location)}${d.reason ? ` · ${d.reason}` : ''}`
    case 'stock_transfer':
      return `${d.product ?? ''}: ${d.qty} · warehouse to shop`
    case 'stocktake':
      return `${place(d.location)} · counted ${d.counted}, changed ${d.changed} · shortage ${money(d.shortageValue)} · surplus ${money(d.surplusValue)}`
    case 'writeoff':
      return `${d.product}: −${d.qty} (${place(d.location)}) · ${d.reason ?? ''}${d.note ? ` — ${d.note}` : ''} · loss ${money(d.value)}`
    case 'purchase_order':
      return `${e.entityId} · ${d.lines} line(s) · ${money(d.total)}`
    case 'purchase_receive':
      return `${e.entityId} → ${place(d.location)}${d.total != null ? ` · ${money(d.total)}` : ''}`
    case 'supplier_payment':
      return `${d.supplier ? `${d.supplier}: ` : ''}${money(d.amount)} · ${d.method ?? ''}${Array.isArray(d.orders) ? ` · ${d.orders.join(', ')}` : ''}`
    case 'price_change':
      return `${d.product}: ${money(d.from)} → ${money(d.to)}`
    case 'product_create':
      return `${d.product} · ${money(d.price)}`
    case 'product_delete':
      return `${d.product}${d.stock != null ? ` · ${d.stock} left in stock` : ''}`
    case 'expense':
      return `${d.category ?? ''} · ${money(d.amount)}${d.description ? ` · ${d.description}` : ''}`
    case 'debt_payment':
      return `${d.customer}: ${money(d.amount)} (${d.method ?? ''}) · ${money(d.balanceAfter)} left`
    case 'debt_clear':
      return `${d.customer}: ${money(d.totalDebt)}`
    case 'contact_delete':
      return d.customer ?? ''
    case 'debt_reminder':
      return `${d.customer}: ${money(d.balance)}`
    case 'shift_close':
      return `expected ${money(d.expected)} · counted ${money(d.counted)} · variance ${money(d.variance)}`
    case 'settings_change':
      return e.entityId ?? ''
    default:
      return ''
  }
}

export function JournalScreen() {
  const theme = useTheme()
  const { repos } = getServices()
  const [group, setGroup] = useState<JournalGroup>('all')
  const [period, setPeriod] = useState<number | 'all'>(7)
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<JournalEntry[]>([])

  const load = useCallback(() => {
    setEntries(repos.journal.list({ periodDays: period, group, search: search || undefined }))
  }, [period, group, search])

  useFocusEffect(load)

  const parsed = useMemo(() => entries.map((e) => {
    let d: Record<string, any> = {}
    try { d = e.details ? JSON.parse(e.details) : {} } catch { /* keep empty */ }
    const shortShift = e.action === 'shift_close' && Number(d.variance) < 0
    return { e, text: describe(e, d), attention: JOURNAL_ATTENTION.has(e.action) || shortShift }
  }), [entries])

  return (
    <Screen padded={false}>
      <View style={styles.filterArea}>
        <View style={styles.chipRow}>
          {GROUPS.map((g) => (
            <Chip key={g} label={g} selected={group === g} onPress={() => setGroup(g)} />
          ))}
        </View>
        <View style={styles.chipRow}>
          {PERIODS.map((p) => (
            <Chip key={String(p.value)} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />
          ))}
        </View>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search…"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={parsed}
        keyExtractor={({ e }) => String(e.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item: { e, text, attention } }) => (
          <ListRow
            title={e.action}
            subtitle={`${String(e.occurredAt).slice(0, 16).replace('T', ' ')} · ${e.userName ?? '—'}`}
            right={
              <Text style={[typeScale.sm, { color: attention ? theme.danger : theme.textMuted, maxWidth: 160, textAlign: 'right' }]} numberOfLines={3}>
                {text}
              </Text>
            }
          />
        )}
        ListEmptyComponent={<EmptyState icon="history" title="No journal entries" message="Voids, write-offs, price changes and more show up here" />}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  filterArea: { padding: spacing.md, gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
})
