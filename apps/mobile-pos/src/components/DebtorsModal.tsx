import { useEffect, useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
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
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

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
    <Sheet visible onClose={onClose} title="Debtors">
      <View style={styles.form}>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone…"
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
            <EmptyState icon="banknote" title="No outstanding debts" message="Customers who owe money appear here" />
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
  const { repos } = getServices()
  const { user, store } = useAuthStore()
  const [statement, setStatement] = useState(() => repos.contacts.debtStatement(contact.id))
  const [balance, setBalance] = useState(contact.balance)
  const [view, setView] = useState<'statement' | 'pay'>('statement')
  const [entry, setEntry] = useState('')
  const [method, setMethod] = useState<'Cash' | 'Card' | 'Click'>('Cash')
  const [paying, setPaying] = useState(false)

  const hasHistory = statement.debts.length > 0 || statement.payments.length > 0
  const fullyPaid = balance <= 0
  const entered = Number(entry) || 0
  const change = method === 'Cash' ? Math.max(0, entered - Math.max(0, balance)) : 0

  function confirmPay() {
    if (!entered || entered <= 0) {
      toast.error('Enter a valid amount')
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
      toast.success(result.change > 0 ? `Paid — change ${fmtUZS(result.change)}` : 'Payment recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  if (view === 'pay') {
    return (
      <Sheet visible onClose={() => setView('statement')} title={`Pay debt — ${contact.name}`}>
        <View style={styles.form}>
          <View style={styles.chipRow}>
            {(['Cash', 'Card', 'Click'] as const).map((m) => (
              <Chip key={m} label={m} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </View>
          <Text style={[typeScale.moneyLg, { color: theme.text, textAlign: 'center' }]}>
            {entry ? fmtUZS(entered) : fmtUZS(0)}
          </Text>
          <NumPad onKey={(k) => setEntry((v) => applyNumKey(v, k))} />
          {change > 0 && (
            <View style={[styles.summaryBox, { borderColor: theme.success }]}>
              <View style={styles.rowBetween}>
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>Payment</Text>
                <Text style={[typeScale.sm, { color: theme.text, fontWeight: '700' }]}>{fmtUZS(Math.max(0, balance))}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={[typeScale.md, { color: theme.success, fontWeight: '700' }]}>Change</Text>
                <Text style={[typeScale.md, { color: theme.success, fontWeight: '700' }]}>{fmtUZS(change)}</Text>
              </View>
            </View>
          )}
          <View style={styles.actions}>
            <Button title="Back" variant="secondary" onPress={() => setView('statement')} style={styles.flex1} />
            <Button title="Confirm payment" onPress={confirmPay} loading={paying} disabled={!entered} style={styles.flex2} />
          </View>
        </View>
      </Sheet>
    )
  }

  return (
    <Sheet visible onClose={onClose} title={contact.name}>
      <View style={styles.form}>
        <Button title="Back to list" variant="ghost" onPress={onBack} />
        {!hasHistory ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>No debt records</Text>
        ) : (
          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListInner}>
            {statement.debts.length > 0 && (
              <>
                <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Debts taken</Text>
                {statement.debts.map((d, i) => (
                  <View key={i} style={[styles.rowItem, { borderColor: theme.border }]}>
                    <View style={styles.flex1}>
                      <Text style={[typeScale.sm, { color: theme.text }]}>{d.label}</Text>
                      <Text style={[typeScale.xs, { color: theme.textFaint }]}>{String(d.date).slice(0, 16).replace('T', ' ')}</Text>
                    </View>
                    <Text style={[typeScale.sm, { color: theme.warning, fontWeight: '700' }]}>{fmtUZS(d.amount)}</Text>
                  </View>
                ))}
              </>
            )}
            {statement.payments.length > 0 && (
              <>
                <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Payments</Text>
                {statement.payments.map((p, i) => (
                  <View key={i} style={[styles.rowItem, { borderColor: theme.border }]}>
                    <Text style={[typeScale.xs, { color: theme.textFaint }]}>{String(p.date).slice(0, 16).replace('T', ' ')}</Text>
                    <Text style={[typeScale.sm, { color: theme.success, fontWeight: '700' }]}>{fmtUZS(p.amount)}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )}

        <View style={[styles.summaryBox, { borderColor: fullyPaid ? theme.success : theme.danger }]}>
          <Text style={[typeScale.md, { color: fullyPaid ? theme.success : theme.danger, fontWeight: '700' }]}>
            {fullyPaid ? 'Fully paid' : `Remaining: ${fmtUZS(Math.max(0, balance))}`}
          </Text>
        </View>

        {!fullyPaid && (
          <Button title="Pay debt" icon="banknote" onPress={() => setView('pay')} fullWidth />
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  list: { maxHeight: 420 },
  listInner: { gap: spacing.xs },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  summaryBox: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, gap: spacing.xs },
  historyList: { maxHeight: 320 },
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
