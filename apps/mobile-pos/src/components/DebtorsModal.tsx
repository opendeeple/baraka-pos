import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem, SaleReceiptData } from '@baraka/data'
import {
  applyNumKey,
  Badge,
  Button,
  Chip,
  EmptyState,
  Icon,
  Input,
  ListRow,
  NumPad,
  SaleDetailSheet,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

const METHOD_I18N: Record<'Cash' | 'Card' | 'Click', string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
}

interface Props {
  onClose: () => void
}

/**
 * The till's debtor lookup: find a customer who owes money and pay down
 * their debt without ringing up a sale. Mirrors desktop's CartPanel.tsx
 * debtor dropdown + DebtHistoryDrawer.tsx with allowAdminActions={false} —
 * a cashier can view the statement and record a payment, but can't clear
 * debt history or delete the contact (those stay Office-only, same as
 * mobile-office's CustomersScreen).
 */
export function DebtorsModal({ onClose }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const [search, setSearch] = useState('')
  const [debtors, setDebtors] = useState<ContactListItem[]>([])
  const [selected, setSelected] = useState<ContactListItem | null>(null)

  function load() {
    setDebtors(repos.contacts.debtors())
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return debtors
    return debtors.filter((d) => d.name.toLowerCase().includes(q) || (d.phone ?? '').includes(q))
  }, [debtors, search])

  if (selected) {
    return (
      <DebtorPayPanel
        contact={selected}
        onBack={() => setSelected(null)}
        onClose={onClose}
        onPaid={load}
      />
    )
  }

  return (
    <Sheet visible onClose={onClose} title={t('pos.debtors')}>
      <View style={styles.form}>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder={t('pos.searchNameOrPhone')}
          autoFocus
          left={<Icon name="search" size={16} color={theme.textFaint} />}
        />
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          style={styles.list}
          contentContainerStyle={styles.listInner}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={item.phone ?? '—'}
              left={<Icon name="user" color={theme.warning} />}
              right={<Badge label={fmtUZS(item.balance)} tone={item.balance > 0 ? 'warning' : 'neutral'} />}
              onPress={() => setSelected(item)}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="banknote" title={t('pos.debtorsNone')} message={t('pos.debtorsNoneHint')} />
          }
        />
      </View>
    </Sheet>
  )
}

function DebtorPayPanel({
  contact, onBack, onClose, onPaid,
}: {
  contact: ContactListItem
  onBack: () => void
  onClose: () => void
  onPaid: () => void
}) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const { user, store } = useAuthStore()
  const [statement, setStatement] = useState(() => repos.contacts.debtStatement(contact.id))
  const [balance, setBalance] = useState(contact.balance)
  const [view, setView] = useState<'statement' | 'pay'>('statement')
  const [entry, setEntry] = useState('')
  const [method, setMethod] = useState<'Cash' | 'Card' | 'Click'>('Cash')
  const [paying, setPaying] = useState(false)
  const [saleDetail, setSaleDetail] = useState<SaleReceiptData | null>(null)

  function openSale(saleId: number) {
    const data = repos.sales.receiptData(saleId)
    if (data) setSaleDetail(data)
    else toast.error(t('saleDetail.notFound'))
  }

  const hasHistory = statement.debts.length > 0 || statement.payments.length > 0
  const fullyPaid = balance <= 0
  const entered = Number(entry) || 0
  const change = method === 'Cash' ? Math.max(0, entered - Math.max(0, balance)) : 0

  function confirmPay() {
    if (!entered || entered <= 0) {
      toast.error(t('debt.enterValidAmount'))
      return
    }
    setPaying(true)
    try {
      const result = repos.contacts.payDebt(contact.id, entered, method, { storeId: store?.id ?? 1, userId: user?.id ?? 1 })
      setBalance(result.newBalance)
      setStatement(repos.contacts.debtStatement(contact.id))
      setView('statement')
      setEntry('')
      onPaid()
      toast.success(result.change > 0 ? t('debt.paid', { change: fmtUZS(result.change) }) : t('debt.recorded'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('debt.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  if (view === 'pay') {
    return (
      <Sheet
        visible
        onClose={() => setView('statement')}
        title={t('debt.payDebtTitle', { name: contact.name })}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.back')} variant="secondary" onPress={() => setView('statement')} style={styles.flex1} />
            <Button title={t('debt.confirmPayment')} onPress={confirmPay} loading={paying} disabled={!entered} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <View style={styles.chipRow}>
            {(['Cash', 'Card', 'Click'] as const).map((m) => (
              <Chip key={m} label={t(METHOD_I18N[m])} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </View>
          <Text style={[typeScale.moneyLg, { color: theme.text, textAlign: 'center' }]}>
            {entry ? fmtUZS(entered) : fmtUZS(0)}
          </Text>
          <NumPad onKey={(k) => setEntry((v) => applyNumKey(v, k))} />
          {change > 0 && (
            <View style={[styles.summaryBox, { borderColor: theme.success }]}>
              <View style={styles.rowBetween}>
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>{t('debt.payment')}</Text>
                <Text style={[typeScale.sm, { color: theme.text, fontWeight: '700' }]}>{fmtUZS(Math.max(0, balance))}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={[typeScale.md, { color: theme.success, fontWeight: '700' }]}>{t('payment.change')}</Text>
                <Text style={[typeScale.md, { color: theme.success, fontWeight: '700' }]}>{fmtUZS(change)}</Text>
              </View>
            </View>
          )}
        </View>
      </Sheet>
    )
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={contact.name}
      footer={
        <View style={styles.form}>
          <View style={[styles.summaryBox, { borderColor: fullyPaid ? theme.success : theme.danger }]}>
            <Text style={[typeScale.md, { color: fullyPaid ? theme.success : theme.danger, fontWeight: '700' }]}>
              {fullyPaid ? t('debt.fullyPaid') : t('debt.remaining', { amount: fmtUZS(Math.max(0, balance)) })}
            </Text>
          </View>
          {!fullyPaid && (
            <Button title={t('debt.payDebt')} icon="banknote" onPress={() => setView('pay')} fullWidth />
          )}
        </View>
      }
    >
      <View style={styles.form}>
        <Button title={t('pos.backToList')} variant="ghost" onPress={onBack} />
        {!hasHistory ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>{t('debt.noRecords')}</Text>
        ) : (
          <View style={styles.historyListInner}>
            {statement.debts.length > 0 && (
              <>
                <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('debt.debtsTaken')}</Text>
                {statement.debts.map((d, i) => (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={d.label}
                    onPress={() => openSale(d.saleId)}
                    style={({ pressed }) => [styles.rowItem, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={styles.flex1}>
                      <Text style={[typeScale.sm, { color: theme.text }]} numberOfLines={1}>{d.label}</Text>
                      <Text style={[typeScale.xs, { color: theme.textFaint }]}>{String(d.date).slice(0, 16).replace('T', ' ')}</Text>
                    </View>
                    <Text style={[typeScale.sm, { color: theme.warning, fontWeight: '700' }]}>{fmtUZS(d.amount)}</Text>
                    <Icon name="chevronRight" size={16} color={theme.textFaint} />
                  </Pressable>
                ))}
              </>
            )}
            {statement.payments.length > 0 && (
              <>
                <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('debt.payments')}</Text>
                {statement.payments.map((p, i) => (
                  <View key={i} style={[styles.rowItem, { borderColor: theme.border }]}>
                    <Text style={[typeScale.xs, { color: theme.textFaint }]}>{String(p.date).slice(0, 16).replace('T', ' ')}</Text>
                    <Text style={[typeScale.sm, { color: theme.success, fontWeight: '700' }]}>{fmtUZS(p.amount)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </View>
      <SaleDetailSheet data={saleDetail} onClose={() => setSaleDetail(null)} formatMoney={fmtUZS} />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  list: { maxHeight: 420 },
  listInner: { gap: spacing.xs },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  summaryBox: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, gap: spacing.xs },
  historyListInner: { gap: spacing.xs },
  rowItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderRadius: 8, padding: spacing.sm,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
