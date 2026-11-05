import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import {
  daysUntil, fmtCreditorAmount, todayYmd,
  type CreditorCurrency, type CreditorForm, type CreditorReturnType, type CreditorRow, type CreditorStatus,
} from '@baraka/data'
import {
  Badge,
  Button,
  Chip,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
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

function emptyForm(): CreditorForm {
  return {
    name: '', phone: '', amount: 0, currency: 'UZS', returnType: 'money', productNote: '',
    receivedAt: todayYmd(), dueDate: '', remindDays: 3, note: '',
  }
}

interface EditState {
  name: string
  phone: string
  amount: string
  currency: CreditorCurrency
  returnType: CreditorReturnType
  productNote: string
  receivedAt: string
  dueDate: string
  remindDays: string
  note: string
}

function toEditState(f: CreditorForm): EditState {
  return {
    name: f.name, phone: f.phone ?? '', amount: f.amount ? String(f.amount) : '', currency: f.currency,
    returnType: f.returnType, productNote: f.productNote ?? '', receivedAt: f.receivedAt, dueDate: f.dueDate,
    remindDays: String(f.remindDays), note: f.note ?? '',
  }
}

export function CreditorsScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CreditorStatus | 'all'>('open')
  const [rows, setRows] = useState<CreditorRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<EditState>(toEditState(emptyForm()))
  const [returnTarget, setReturnTarget] = useState<CreditorRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CreditorRow | null>(null)

  const load = useCallback(() => {
    setRows(repos.creditors.list({ status, search: search || undefined }))
  }, [search, status])

  useFocusEffect(load)

  const open = rows.filter((r) => r.status === 'open')
  const totalUzs = open.filter((r) => r.currency !== 'USD').reduce((s, r) => s + r.amount, 0)
  const totalUsd = open.filter((r) => r.currency === 'USD').reduce((s, r) => s + r.amount, 0)

  function openCreate() {
    setEditId(null)
    setForm(toEditState(emptyForm()))
    setShowForm(true)
  }

  function openEdit(c: CreditorRow) {
    setEditId(c.id)
    setForm(toEditState({
      name: c.name, phone: c.phone, amount: c.amount, currency: c.currency, returnType: c.returnType,
      productNote: c.productNote, receivedAt: c.receivedAt, dueDate: c.dueDate, remindDays: c.remindDays, note: c.note,
    }))
    setShowForm(true)
  }

  const formValid = form.name.trim() !== '' && Number(form.amount) > 0 && form.dueDate.trim() !== ''
    && form.receivedAt.trim() !== '' && form.dueDate >= form.receivedAt

  function save() {
    if (!formValid) return
    repos.creditors.save(editId, {
      name: form.name,
      phone: form.phone || null,
      amount: Number(form.amount) || 0,
      currency: form.currency,
      returnType: form.returnType,
      productNote: form.productNote || null,
      receivedAt: form.receivedAt,
      dueDate: form.dueDate,
      remindDays: Number(form.remindDays) || 0,
      note: form.note || null,
    }, user?.id ?? null)
    setShowForm(false)
    toast.success(t('creditors.saved'))
    load()
  }

  function doReturn() {
    if (!returnTarget) return
    repos.creditors.markReturned(returnTarget.id)
    toast.success(t('creditors.returnedToast', { name: returnTarget.name }))
    setReturnTarget(null)
    load()
  }

  function doDelete() {
    if (!deleteTarget) return
    repos.creditors.softDelete(deleteTarget.id)
    setDeleteTarget(null)
    load()
  }

  function remaining(c: CreditorRow) {
    if (c.status === 'returned') {
      return <Badge label={t('creditors.returnedOn', { date: c.returnedAt ?? '' })} tone="success" />
    }
    const days = daysUntil(c.dueDate)
    const label = days > 0 ? t('creditors.daysLeft', { count: days }) : days === 0 ? t('creditors.dueToday') : t('creditors.daysOverdue', { count: -days })
    const tone = days <= 0 ? 'danger' : days <= c.remindDays ? 'warning' : 'neutral'
    return <Badge label={label} tone={tone} />
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

      <View style={styles.chipRow}>
        <Chip label={t('creditors.filterOpen')} selected={status === 'open'} onPress={() => setStatus('open')} />
        <Chip label={t('creditors.filterReturned')} selected={status === 'returned'} onPress={() => setStatus('returned')} />
        <Chip label={t('creditors.filterAll')} selected={status === 'all'} onPress={() => setStatus('all')} />
      </View>

      {(totalUzs > 0 || totalUsd > 0) && (
        <View style={styles.totalBar}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>{t('creditors.totalWeOwe')}</Text>
          <Text style={[typeScale.md, { color: theme.warning, fontWeight: '700' }]}>
            {totalUzs > 0 ? fmtCreditorAmount(totalUzs, 'UZS') : ''}
            {totalUzs > 0 && totalUsd > 0 ? ' + ' : ''}
            {totalUsd > 0 ? fmtCreditorAmount(totalUsd, 'USD') : ''}
          </Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${fmtCreditorAmount(item.amount, item.currency)} · Due ${item.dueDate}`}
            onPress={() => openEdit(item)}
            right={
              <View style={styles.rowRight}>
                {remaining(item)}
                {item.status === 'open' && (
                  <IconButton icon="check" size={20} color={theme.success} accessibilityLabel={t('creditors.markReturned')} onPress={() => setReturnTarget(item)} />
                )}
                <IconButton icon="trash" size={20} color={theme.danger} accessibilityLabel={t('common.delete')} onPress={() => setDeleteTarget(item)} />
              </View>
            }
          />
        )}
        ListEmptyComponent={<EmptyState icon="banknote" title={t('creditors.none')} message={t('more.creditorsSubtitle')} />}
      />

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('creditors.editCreditor') : t('creditors.newCreditor')}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} disabled={!formValid} onPress={save} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label={t('common.phone')} value={form.phone} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" />
          <View style={styles.row2}>
            <Input label={t('creditors.amount')} value={form.amount} onChangeText={(v) => setForm((p) => ({ ...p, amount: v }))} keyboardType="numeric" containerStyle={styles.flex1} />
            <View style={styles.chipRow}>
              <Chip label="UZS" selected={form.currency === 'UZS'} onPress={() => setForm((p) => ({ ...p, currency: 'UZS' }))} />
              <Chip label="USD" selected={form.currency === 'USD'} onPress={() => setForm((p) => ({ ...p, currency: 'USD' }))} />
            </View>
          </View>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('creditors.returnAs')}</Text>
          <View style={styles.chipRow}>
            <Chip label={t('creditors.asMoney')} selected={form.returnType === 'money'} onPress={() => setForm((p) => ({ ...p, returnType: 'money' }))} />
            <Chip label={t('creditors.asGoods')} selected={form.returnType === 'product'} onPress={() => setForm((p) => ({ ...p, returnType: 'product' }))} />
          </View>
          {form.returnType === 'product' && (
            <Input label={t('creditors.whichGoods')} value={form.productNote} onChangeText={(v) => setForm((p) => ({ ...p, productNote: v }))} />
          )}
          <View style={styles.row2}>
            <Input label={t('creditors.receivedOn', { format: 'YYYY-MM-DD' })} value={form.receivedAt} onChangeText={(v) => setForm((p) => ({ ...p, receivedAt: v }))} containerStyle={styles.flex1} />
            <Input label={t('creditors.dueDate', { format: 'YYYY-MM-DD' })} value={form.dueDate} onChangeText={(v) => setForm((p) => ({ ...p, dueDate: v }))} containerStyle={styles.flex1} />
          </View>
          <Input
            label={t('creditors.remindDays')}
            value={form.remindDays}
            onChangeText={(v) => setForm((p) => ({ ...p, remindDays: v }))}
            keyboardType="numeric"
          />
          <Input label={t('common.noteOptional')} value={form.note} onChangeText={(v) => setForm((p) => ({ ...p, note: v }))} />
        </View>
      </Sheet>

      <Dialog
        visible={returnTarget !== null}
        onClose={() => setReturnTarget(null)}
        title={t('creditors.markReturnedTitle')}
        message={returnTarget ? t('creditors.returnConfirm', { amount: fmtCreditorAmount(returnTarget.amount, returnTarget.currency), name: returnTarget.name }) : ''}
        actions={[
          { label: t('common.cancel'), onPress: () => setReturnTarget(null) },
          { label: t('common.confirm'), tone: 'primary', onPress: doReturn },
        ]}
      />

      <Dialog
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('creditors.deleteTitle')}
        message={deleteTarget ? t('creditors.deleteConfirm', { name: deleteTarget.name }) : ''}
        actions={[
          { label: t('common.cancel'), onPress: () => setDeleteTarget(null) },
          { label: t('common.delete'), tone: 'danger', onPress: doDelete },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm, flexWrap: 'wrap' },
  totalBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  row2: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
