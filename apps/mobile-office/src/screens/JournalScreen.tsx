import { useCallback, useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { JOURNAL_ATTENTION, type JournalEntry, type JournalGroup } from '@baraka/data'
import { Chip, EmptyState, Input, ListRow, Screen, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

const GROUPS: JournalGroup[] = ['all', 'sales', 'stock', 'money', 'products', 'system']
const GROUP_I18N: Record<JournalGroup, string> = {
  all: 'journal.groupAll', sales: 'journal.groupSales', stock: 'journal.groupStock',
  money: 'journal.groupMoney', products: 'journal.groupProducts', system: 'journal.groupSystem',
}
const PERIODS: Array<{ i18nKey: string; value: number | 'all' }> = [
  { i18nKey: 'journal.today', value: 1 },
  { i18nKey: 'journal.last7', value: 7 },
  { i18nKey: 'journal.last30', value: 30 },
  { i18nKey: 'journal.allTime', value: 'all' },
]
const ACTION_I18N: Record<string, string> = {
  sale_void: 'journal.actionSaleVoid',
  sale_return: 'journal.actionSaleReturn',
  stock_receive: 'journal.actionStockReceive',
  stock_transfer: 'journal.actionStockTransfer',
  stocktake: 'journal.actionStocktake',
  writeoff: 'journal.actionWriteoff',
  purchase_order: 'journal.actionPurchaseOrder',
  purchase_receive: 'journal.actionPurchaseReceive',
  supplier_payment: 'journal.actionSupplierPayment',
  price_change: 'journal.actionPriceChange',
  product_create: 'journal.actionProductCreate',
  product_delete: 'journal.actionProductDelete',
  expense: 'journal.actionExpense',
  debt_payment: 'journal.actionDebtPayment',
  debt_clear: 'journal.actionDebtClear',
  contact_delete: 'journal.actionContactDelete',
  debt_reminder: 'journal.actionDebtReminder',
  shift_close: 'journal.actionShiftClose',
  settings_change: 'journal.actionSettingsChange',
  drawer_open: 'journal.actionDrawerOpen',
  discount: 'journal.actionDiscount',
}

const money = (v: unknown) => `UZS ${Math.round(Number(v) || 0).toLocaleString('en-US')}`
type TFn = (key: string, opts?: Record<string, unknown>) => string

const place = (t: TFn, loc: unknown) => (loc === 'warehouse' ? t('journalDesc.toWarehouse') : t('journalDesc.toShop'))
const method = (t: TFn, m: unknown) => (m ? t(`journalDesc.method_${m}`, { defaultValue: String(m) }) : '')

/** One readable line per journal entry — ported from desktop's JournalScreen.tsx describe(). */
function describe(t: TFn, e: JournalEntry, d: Record<string, any>): string {
  switch (e.action) {
    case 'sale_void':
      return `${e.entityId} · ${money(d.total)} · ${t('journalDesc.reason')}: ${d.reason ?? '—'}`
    case 'sale_return':
      return `${e.entityId} → ${d.returnInvoice} · ${money(d.refund)} (${method(t, d.method)})`
        + (Array.isArray(d.lines) ? ` · ${d.lines.map((l: any) => `${l.product} ×${l.qty}`).join(', ')}` : '')
    case 'stock_receive':
      return `${d.product ?? ''} +${d.qty} → ${place(t, d.location)}${d.reason ? ` · ${d.reason}` : ''}`
    case 'stock_transfer':
      return `${d.product ?? ''}: ${d.qty} · ${t('journalDesc.warehouseToShop')}`
    case 'stocktake':
      return `${place(t, d.location)} · ${t('journalDesc.stocktakeLine', { counted: d.counted, changed: d.changed })}`
        + ` · ${t('journalDesc.shortage')} ${money(d.shortageValue)} · ${t('journalDesc.surplus')} ${money(d.surplusValue)}`
    case 'writeoff':
      return `${d.product}: −${d.qty} (${place(t, d.location)}) · ${t(`journalDesc.wo_${d.reason}`, { defaultValue: d.reason ?? '' })}`
        + `${d.note ? ` — ${d.note}` : ''} · ${t('journalDesc.loss')} ${money(d.value)}`
    case 'purchase_order':
      return `${e.entityId} · ${t('journalDesc.linesCount', { count: d.lines })} · ${money(d.total)}`
    case 'purchase_receive':
      return `${e.entityId} → ${place(t, d.location)}${d.total != null ? ` · ${money(d.total)}` : ''}`
    case 'supplier_payment':
      return `${d.supplier ? `${d.supplier}: ` : ''}${money(d.amount)} · ${method(t, d.method)}${Array.isArray(d.orders) ? ` · ${d.orders.join(', ')}` : ''}`
    case 'price_change':
      return `${d.product}: ${money(d.from)} → ${money(d.to)}`
    case 'product_create':
      return `${d.product} · ${money(d.price)}`
    case 'product_delete':
      return `${d.product}${d.stock != null ? ` · ${t('journalDesc.stockLeft', { qty: d.stock })}` : ''}`
    case 'expense':
      return `${d.category ?? ''} · ${money(d.amount)}${d.description ? ` · ${d.description}` : ''}`
    case 'debt_payment':
      return `${d.customer}: ${money(d.amount)} (${method(t, d.method)}) · ${t('journalDesc.debtLeft', { amount: Math.round(Number(d.balanceAfter) || 0).toLocaleString('en-US') })}`
    case 'debt_clear':
      return `${d.customer}: ${money(d.totalDebt)}`
    case 'contact_delete':
      return d.customer ?? ''
    case 'debt_reminder':
      return `${d.customer}: ${money(d.balance)}`
    case 'shift_close':
      return `${t('journalDesc.expected')} ${money(d.expected)} · ${t('journalDesc.counted')} ${money(d.counted)} · ${t('journalDesc.variance')} ${money(d.variance)}`
    case 'settings_change':
      return t(`journalDesc.setting_${e.entityId}`, { defaultValue: e.entityId ?? '' })
    default:
      return ''
  }
}

export function JournalScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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
    return { e, text: describe(t as TFn, e, d), attention: JOURNAL_ATTENTION.has(e.action) || shortShift }
  }), [entries, t])

  return (
    <Screen padded={false}>
      <View style={styles.filterArea}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {GROUPS.map((g) => (
            <Chip key={g} label={t(GROUP_I18N[g])} selected={group === g} onPress={() => setGroup(g)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {PERIODS.map((p) => (
            <Chip key={String(p.value)} label={t(p.i18nKey)} selected={period === p.value} onPress={() => setPeriod(p.value)} />
          ))}
        </ScrollView>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder={t('journal.searchPlaceholder')}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={parsed}
        keyExtractor={({ e }) => String(e.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item: { e, text, attention } }) => (
          <ListRow
            title={ACTION_I18N[e.action] ? t(ACTION_I18N[e.action]) : e.action}
            subtitle={`${String(e.occurredAt).slice(0, 16).replace('T', ' ')} · ${e.userName ?? '—'}`}
            meta={
              text ? (
                <Text style={[typeScale.sm, { color: attention ? theme.danger : theme.textMuted, flexShrink: 1 }]} numberOfLines={4}>
                  {text}
                </Text>
              ) : null
            }
          />
        )}
        ListEmptyComponent={<EmptyState icon="history" title={t('journal.empty')} message={t('journal.emptyHint')} />}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  filterArea: { padding: spacing.md, gap: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.lg },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
})
