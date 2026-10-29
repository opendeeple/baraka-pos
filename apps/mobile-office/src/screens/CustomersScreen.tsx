import { useCallback, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import {
  applyNumKey,
  Badge,
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  Input,
  ListRow,
  NumPad,
  PinConfirmModal,
  Screen,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { buildDebtMessage, buildHistoryMessage, sendTelegramMessage, telegramConfigured } from '../lib/telegram'

const EMPTY_FORM = { name: '', phone: '', email: '', address: '' }

export function CustomersScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<ContactListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [messageTarget, setMessageTarget] = useState<ContactListItem | null>(null)
  const [debtTarget, setDebtTarget] = useState<ContactListItem | null>(null)

  const load = useCallback(() => {
    setCustomers(repos.contacts.search(search, 100))
  }, [search])

  useFocusEffect(load)

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    const input = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
    }
    if (editId) repos.contacts.update(editId, input)
    else repos.contacts.create(input)
    engine.flushOutbox().catch(() => {})
    setShowForm(false)
    toast.success(editId ? 'Customer updated' : 'Customer created')
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search by name or phone…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title="New" icon="plus" onPress={openCreate} />
      </View>

      <FlatList
        data={customers}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.phone ?? '—'}
            onPress={() => {
              setEditId(item.id)
              setForm({
                name: item.name,
                phone: item.phone ?? '',
                email: item.email ?? '',
                address: item.address ?? '',
              })
              setShowForm(true)
            }}
            right={
              <View style={styles.rowRight}>
                {item.balance > 0 ? (
                  <IconButton
                    icon="banknote"
                    size={20}
                    color={theme.danger}
                    accessibilityLabel={`Debt history for ${item.name}`}
                    onPress={() => setDebtTarget(item)}
                  />
                ) : null}
                {item.balance > 0 ? (
                  <Badge label={`Debt ${fmtUZS(item.balance)}`} tone="danger" />
                ) : (
                  <Text style={[typeScale.sm, { color: theme.textMuted }]}>{fmtUZS(item.balance)}</Text>
                )}
                {item.telegramChatId && (
                  <IconButton
                    icon="send"
                    size={20}
                    color={theme.primary}
                    accessibilityLabel={`Message ${item.name} on Telegram`}
                    onPress={() => setMessageTarget(item)}
                  />
                )}
              </View>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={search ? 'No customers found' : 'No customers yet'}
            message={search ? 'Try a different search' : 'Customers you add appear here'}
            action={search ? undefined : { label: 'New customer', onPress: openCreate }}
          />
        }
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit customer' : 'New customer'}>
        <View style={styles.form}>
          <Input label="Name" value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Input
            label="Phone"
            value={form.phone}
            onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))}
            keyboardType="phone-pad"
            placeholder="+998 …"
          />
          <Input
            label="Email"
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input label="Address" value={form.address} onChangeText={(v) => setForm((p) => ({ ...p, address: v }))} />
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title="Save" onPress={save} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      {messageTarget && (
        <MessageSheet contact={messageTarget} onClose={() => setMessageTarget(null)} />
      )}

      {debtTarget && (
        <DebtHistorySheet
          contact={debtTarget}
          onClose={() => setDebtTarget(null)}
          onChanged={load}
        />
      )}
    </Screen>
  )
}

function MessageSheet({ contact, onClose }: { contact: ContactListItem; onClose: () => void }) {
  const theme = useTheme()
  const { repos } = getServices()
  const { store } = useAuthStore()
  const [template, setTemplate] = useState<'debt' | 'history'>(contact.balance > 0 ? 'debt' : 'history')
  const [sending, setSending] = useState(false)

  const configured = telegramConfigured()
  const preview = !configured || !contact.telegramChatId
    ? ''
    : template === 'debt'
      ? buildDebtMessage(contact.id, store?.name ?? '')
      : buildHistoryMessage(contact.id)

  async function send() {
    if (!contact.telegramChatId || sending) return
    setSending(true)
    try {
      const result = await sendTelegramMessage(contact.telegramChatId, preview)
      repos.contacts.logMessage(contact.id, 'telegram', preview, result.success ? 'sent' : 'failed', result.error)
      if (result.success) {
        toast.success('Message sent')
        onClose()
      } else {
        toast.error(result.error || 'Send failed')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet visible onClose={onClose} title={`Message — ${contact.name}`}>
      <View style={styles.form}>
        {!configured ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            Telegram bot isn't configured yet — set it up in desktop Settings first.
          </Text>
        ) : !contact.telegramChatId ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            This customer hasn't connected Telegram yet — send them the bot link from desktop.
          </Text>
        ) : (
          <>
            <View style={styles.chipRow}>
              <Chip label="Debt reminder" selected={template === 'debt'} onPress={() => setTemplate('debt')} />
              <Chip label="Purchase history" selected={template === 'history'} onPress={() => setTemplate('history')} />
            </View>
            <View style={[styles.preview, { borderColor: theme.border }]}>
              <Text style={[typeScale.xs, { color: theme.textMuted }]}>{preview}</Text>
            </View>
          </>
        )}
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button
            title="Send"
            icon="send"
            onPress={send}
            loading={sending}
            disabled={!configured || !contact.telegramChatId}
            style={styles.flex2}
          />
        </View>
      </View>
    </Sheet>
  )
}

function DebtHistorySheet({
  contact, onClose, onChanged,
}: {
  contact: ContactListItem
  onClose: () => void
  onChanged: () => void
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
  const [confirmClear, setConfirmClear] = useState(false)
  const [showDeletePin, setShowDeletePin] = useState(false)
  const [ownerPin] = useState(() => repos.settings.get('owner_expense_pin'))

  const totalDebt = statement.debts.reduce((s, d) => s + d.amount, 0)
  const totalPaid = statement.payments.reduce((s, p) => s + p.amount, 0)
  const fullyPaid = balance <= 0
  const hasHistory = statement.debts.length > 0 || statement.payments.length > 0
  const entered = Number(entry) || 0
  const change = method === 'Cash' ? Math.max(0, entered - Math.max(0, balance)) : 0

  function refresh() {
    setStatement(repos.contacts.debtStatement(contact.id))
    const fresh = repos.contacts.byId(contact.id)
    if (fresh) setBalance(fresh.balance)
  }

  function confirmPay() {
    if (!entered || entered <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setPaying(true)
    try {
      const result = repos.contacts.payDebt(contact.id, entered, method, { storeId: store?.id ?? 1, userId: user?.id ?? 1 })
      setBalance(result.newBalance)
      setView('statement')
      setEntry('')
      refresh()
      onChanged()
      toast.success(result.change > 0 ? `Paid — change ${fmtUZS(result.change)}` : 'Payment recorded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  function doClear() {
    try {
      repos.contacts.clearDebt(contact.id, totalDebt, totalPaid, user?.id ?? 1)
      toast.success('Debt history cleared')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear')
    }
  }

  function doDelete() {
    repos.contacts.delete(contact.id, user?.id ?? 1)
    toast.success(`${contact.name} deleted`)
    onChanged()
    onClose()
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

        {hasHistory && (confirmClear ? (
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setConfirmClear(false)} style={styles.flex1} />
            <Button title="Yes, clear" variant="danger" onPress={doClear} style={styles.flex2} />
          </View>
        ) : (
          <Button
            title="Clear debt history"
            variant="secondary"
            icon="trash"
            disabled={!fullyPaid}
            onPress={() => setConfirmClear(true)}
          />
        ))}

        <Button
          title="Delete customer"
          variant="ghost"
          icon="trash"
          onPress={() => (ownerPin ? setShowDeletePin(true) : doDelete())}
        />
      </View>

      <PinConfirmModal
        visible={showDeletePin}
        expectedPin={ownerPin}
        title="Owner PIN required to delete"
        onClose={() => setShowDeletePin(false)}
        onConfirmed={() => { setShowDeletePin(false); doDelete() }}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  preview: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, maxHeight: 220 },
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
