import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { PayMethod, SupplierForm, SupplierOrderRow, SupplierPaymentRow, SupplierRow } from '@baraka/data'
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  Icon,
  Input,
  ListRow,
  Screen,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

const EMPTY_FORM: SupplierForm = { name: '', phone: '', address: '', notes: '' }
const METHODS: PayMethod[] = ['Cash', 'Card', 'Click', 'Transfer']
const METHOD_I18N: Record<PayMethod, string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
  Transfer: 'payment.methodTransfer',
}

export function SuppliersScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const { user, store } = useAuthStore()
  const [search, setSearch] = useState('')
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM)
  const [detailTarget, setDetailTarget] = useState<SupplierRow | null>(null)
  const [payTarget, setPayTarget] = useState<SupplierRow | null>(null)

  const load = useCallback(() => {
    setSuppliers(repos.suppliers.list(search || undefined))
  }, [search])

  useFocusEffect(load)

  const totalOwed = suppliers.reduce((s, r) => s + r.owed, 0)

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
    repos.suppliers.save(editId, form)
    setShowForm(false)
    toast.success(editId ? t('suppliers.updated') : t('suppliers.created'))
    load()
  }

  function afterPaid() {
    setPayTarget(null)
    load()
    toast.success(t('suppliers.paymentRecorded'))
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder={t('suppliers.searchPlaceholder')}
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title={t('common.new')} icon="plus" onPress={openCreate} />
      </View>

      {totalOwed > 0 && (
        <View style={styles.totalBar}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>{t('suppliers.totalWeOwe')}</Text>
          <Text style={[typeScale.md, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(totalOwed)}</Text>
        </View>
      )}

      <FlatList
        data={suppliers}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.phone ?? '—'} · ${t('suppliers.ordersCount', { count: item.orders })}`}
            onPress={() => setDetailTarget(item)}
            right={
              item.owed > 0 ? (
                <Badge label={t('suppliers.owe', { amount: fmtUZS(item.owed) })} tone="danger" />
              ) : (
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>{fmtUZS(item.bought)}</Text>
              )
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="truck"
            title={search ? t('suppliers.noneFound') : t('suppliers.noneYet')}
            message={search ? t('common.tryDifferentSearch') : t('suppliers.emptyHint')}
            action={search ? undefined : { label: t('suppliers.newSupplier'), onPress: openCreate }}
          />
        }
      />

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('suppliers.editSupplier') : t('suppliers.newSupplier')}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={save} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label={t('common.phone')} value={form.phone ?? ''} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" />
          <Input label={t('common.address')} value={form.address ?? ''} onChangeText={(v) => setForm((p) => ({ ...p, address: v }))} />
          <Input label={t('common.note')} value={form.notes ?? ''} onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))} />
        </View>
      </Sheet>

      {detailTarget && (
        <SupplierDetailSheet
          supplier={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            setEditId(detailTarget.id)
            setForm({ name: detailTarget.name, phone: detailTarget.phone ?? '', address: detailTarget.address ?? '', notes: detailTarget.notes ?? '' })
            setDetailTarget(null)
            setShowForm(true)
          }}
          onPay={() => { setPayTarget(detailTarget); setDetailTarget(null) }}
        />
      )}

      {payTarget && (
        <SupplierPaySheet
          supplier={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={(amount, method, note) => {
            try {
              const result = repos.suppliers.pay(payTarget.id, amount, method, { userId: user?.id ?? null, storeId: store?.id ?? 1, note })
              afterPaid()
              toast.success(t('suppliers.paidTo', { amount: fmtUZS(result.applied), name: payTarget.name }))
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t('suppliers.paymentFailed'))
            }
          }}
        />
      )}
    </Screen>
  )
}

function SupplierDetailSheet({
  supplier, onClose, onEdit, onPay,
}: {
  supplier: SupplierRow
  onClose: () => void
  onEdit: () => void
  onPay: () => void
}) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const [orders] = useState<SupplierOrderRow[]>(() => repos.suppliers.orders(supplier.id))
  const [payments] = useState<SupplierPaymentRow[]>(() => repos.suppliers.payments(supplier.id))

  return (
    <Sheet visible onClose={onClose} title={supplier.name} scrollBody>
      <View style={styles.form}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('suppliers.bought')}</Text>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>{fmtUZS(supplier.bought)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('suppliers.weOwe')}</Text>
            <Text style={[typeScale.md, { color: supplier.owed > 0 ? theme.danger : theme.success, fontWeight: '700' }]}>
              {fmtUZS(supplier.owed)}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button title={t('suppliers.edit')} variant="secondary" onPress={onEdit} style={styles.flex1} />
          {supplier.owed > 0 && <Button title={t('suppliers.pay')} onPress={onPay} style={styles.flex2} />}
        </View>

        <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('suppliers.orders')}</Text>
        {orders.length === 0 ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>{t('suppliers.noOrdersYet')}</Text>
        ) : (
          orders.map((o) => {
            const due = o.totalAmount - o.amountPaid
            return (
              <View key={o.id} style={[styles.rowItem, { borderColor: theme.border }]}>
                <Text style={[typeScale.sm, { color: theme.text }]}>{o.referenceNumber ?? o.id}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[typeScale.sm, { color: theme.text }]}>{fmtUZS(o.totalAmount)}</Text>
                  <Text style={[typeScale.xs, { color: o.status !== 'received' ? theme.warning : due > 0.001 ? theme.danger : theme.success }]}>
                    {o.status !== 'received' ? t('suppliers.pendingStatus') : due > 0.001 ? t('suppliers.due', { amount: fmtUZS(due) }) : t('suppliers.paidInFull')}
                  </Text>
                </View>
              </View>
            )
          })
        )}

        {payments.length > 0 && (
          <>
            <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('suppliers.payments')}</Text>
            {payments.map((p) => (
              <View key={p.id} style={[styles.rowItem, { borderColor: theme.border }]}>
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>
                  {String(p.createdAt).slice(0, 10)} · {t(METHOD_I18N[(p.paymentMethod as PayMethod) ?? 'Cash'])}
                </Text>
                <Text style={[typeScale.sm, { color: theme.success, fontWeight: '600' }]}>{fmtUZS(p.amount)}</Text>
              </View>
            ))}
          </>
        )}
      </View>
    </Sheet>
  )
}

function SupplierPaySheet({
  supplier, onClose, onPaid,
}: {
  supplier: SupplierRow
  onClose: () => void
  onPaid: (amount: number, method: PayMethod, note: string) => void
}) {
  const theme = useTheme()
  const { t } = useTranslation()
  const [amount, setAmount] = useState(String(Math.round(supplier.owed * 100) / 100))
  const [method, setMethod] = useState<PayMethod>('Cash')
  const [note, setNote] = useState('')

  const value = Number(amount)
  const valid = Number.isFinite(value) && value > 0 && value <= supplier.owed + 0.001

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t('suppliers.payTitle', { name: supplier.name })}
      footer={
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button title={t('suppliers.pay')} disabled={!valid} onPress={() => onPaid(value, method, note)} style={styles.flex2} />
        </View>
      }
    >
      <View style={styles.form}>
        <View style={[styles.statCard, styles.fullWidthCard]}>
          <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('suppliers.weOwe')}</Text>
          <Text style={[typeScale.lg, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(supplier.owed)}</Text>
        </View>
        <Input
          label={t('suppliers.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          error={amount && !valid ? t('suppliers.amountTooBig') : null}
        />
        <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('suppliers.method')}</Text>
        <View style={styles.chipRow}>
          {METHODS.map((m) => (
            <Chip key={m} label={t(METHOD_I18N[m])} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        <Input label={t('common.noteOptional')} value={note} onChangeText={setNote} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  totalBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, borderRadius: 8, padding: spacing.sm, backgroundColor: 'rgba(255,255,255,0.04)' },
  fullWidthCard: { flex: 0 },
  rowItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderRadius: 8, padding: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
