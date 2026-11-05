import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem, SaleReceiptData } from '@baraka/data'
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
  SaleDetailSheet,
  Screen,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { buildDebtMessage, buildHistoryMessage, sendTelegramMessage, telegramConfigured } from '../lib/telegram'

const EMPTY_FORM = { name: '', phone: '', email: '', address: '' }
const METHOD_I18N: Record<'Cash' | 'Card' | 'Click', string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
}

export function CustomersScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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
      toast.error(t('common.nameRequired'))
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
    toast.success(editId ? t('customers.updated') : t('customers.created'))
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder={t('pos.searchNameOrPhone')}
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title={t('common.new')} icon="plus" onPress={openCreate} />
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
            meta={
              item.balance > 0 ? (
                <Badge label={t('pos.debtBadge', { amount: fmtUZS(item.balance) })} tone="danger" />
              ) : null
            }
            right={
              <View style={styles.rowRight}>
                {item.balance > 0 ? (
                  <IconButton
                    icon="banknote"
                    size={20}
                    color={theme.danger}
                    accessibilityLabel={t('customers.debtHistoryFor', { name: item.name })}
                    onPress={() => setDebtTarget(item)}
                  />
                ) : null}
                {item.telegramChatId && (
                  <IconButton
                    icon="send"
                    size={20}
                    color={theme.primary}
                    accessibilityLabel={t('customers.messageOnTelegram', { name: item.name })}
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
            title={search ? t('customers.noneFound') : t('customers.noneYet')}
            message={search ? t('common.tryDifferentSearch') : t('customers.emptyHint')}
            action={search ? undefined : { label: t('customers.newCustomer'), onPress: openCreate }}
          />
        }
      />

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('customers.editCustomer') : t('customers.newCustomer')}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={save} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Input
            label={t('common.phone')}
            value={form.phone}
            onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))}
            keyboardType="phone-pad"
            placeholder={t('customers.phonePlaceholder')}
          />
          <Input
            label={t('common.email')}
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input label={t('common.address')} value={form.address} onChangeText={(v) => setForm((p) => ({ ...p, address: v }))} />
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
  const { t } = useTranslation()
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
        toast.success(t('customers.messageSent'))
        onClose()
      } else {
        toast.error(result.error || t('customers.sendFailed'))
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t('customers.messageTitle', { name: contact.name })}
      footer={
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button
            title={t('customers.send')}
            icon="send"
            onPress={send}
            loading={sending}
            disabled={!configured || !contact.telegramChatId}
            style={styles.flex2}
          />
        </View>
      }
    >
      <View style={styles.form}>
        {!configured ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            {t('customers.botNotConfigured')}
          </Text>
        ) : !contact.telegramChatId ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            {t('customers.notConnectedYet')}
          </Text>
        ) : (
          <>
            <View style={styles.chipRow}>
              <Chip label={t('customers.debtReminder')} selected={template === 'debt'} onPress={() => setTemplate('debt')} />
              <Chip label={t('customers.purchaseHistory')} selected={template === 'history'} onPress={() => setTemplate('history')} />
            </View>
            <View style={[styles.preview, { borderColor: theme.border }]}>
              <Text style={[typeScale.xs, { color: theme.textMuted }]}>{preview}</Text>
            </View>
          </>
        )}
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
  const { t } = useTranslation()
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
  const [saleDetail, setSaleDetail] = useState<SaleReceiptData | null>(null)

  function openSale(saleId: number) {
    const data = repos.sales.receiptData(saleId)
    if (data) setSaleDetail(data)
    else toast.error(t('saleDetail.notFound'))
  }

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
      toast.error(t('debt.enterValidAmount'))
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
      toast.success(result.change > 0 ? t('debt.paid', { change: fmtUZS(result.change) }) : t('debt.recorded'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('debt.paymentFailed'))
    } finally {
      setPaying(false)
    }
  }

  function doClear() {
    try {
      repos.contacts.clearDebt(contact.id, totalDebt, totalPaid, user?.id ?? 1)
      toast.success(t('customers.debtHistoryCleared'))
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('customers.clearFailed'))
    }
  }

  function doDelete() {
    repos.contacts.delete(contact.id, user?.id ?? 1)
    toast.success(t('customers.deleted', { name: contact.name }))
    onChanged()
    onClose()
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
      // Balance + Pay stay pinned; the whole history above scrolls (it used
      // to sit in a nested ScrollView that Android wouldn't scroll).
      footer={
        <View style={styles.footer}>
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

        {hasHistory && (confirmClear ? (
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setConfirmClear(false)} style={styles.flex1} />
            <Button title={t('customers.yesClear')} variant="danger" onPress={doClear} style={styles.flex2} />
          </View>
        ) : (
          <Button
            title={t('customers.clearDebtHistory')}
            variant="secondary"
            icon="trash"
            disabled={!fullyPaid}
            onPress={() => setConfirmClear(true)}
          />
        ))}

        <Button
          title={t('customers.deleteCustomer')}
          variant="ghost"
          icon="trash"
          onPress={() => (ownerPin ? setShowDeletePin(true) : doDelete())}
        />
      </View>

      <SaleDetailSheet data={saleDetail} onClose={() => setSaleDetail(null)} formatMoney={fmtUZS} />

      <PinConfirmModal
        visible={showDeletePin}
        expectedPin={ownerPin}
        title={t('customers.ownerPinToDelete')}
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
  footer: { gap: spacing.sm, marginTop: spacing.sm },
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
