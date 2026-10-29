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
    toast.success('Saved')
    load()
  }

  function doReturn() {
    if (!returnTarget) return
    repos.creditors.markReturned(returnTarget.id)
    toast.success(`${returnTarget.name} — marked returned`)
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
      return <Badge label={`Returned ${c.returnedAt ?? ''}`} tone="success" />
    }
    const days = daysUntil(c.dueDate)
    const label = days > 0 ? `${days}d left` : days === 0 ? 'Due today' : `${-days}d overdue`
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
          placeholder="Search by name or phone…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title="New" icon="plus" onPress={openCreate} />
      </View>

      <View style={styles.chipRow}>
        <Chip label="Open" selected={status === 'open'} onPress={() => setStatus('open')} />
        <Chip label="Returned" selected={status === 'returned'} onPress={() => setStatus('returned')} />
        <Chip label="All" selected={status === 'all'} onPress={() => setStatus('all')} />
      </View>

      {(totalUzs > 0 || totalUsd > 0) && (
        <View style={styles.totalBar}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>Total we owe</Text>
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
                  <IconButton icon="check" size={20} color={theme.success} accessibilityLabel="Mark returned" onPress={() => setReturnTarget(item)} />
                )}
                <IconButton icon="trash" size={20} color={theme.danger} accessibilityLabel="Delete" onPress={() => setDeleteTarget(item)} />
              </View>
            }
          />
        )}
        ListEmptyComponent={<EmptyState icon="banknote" title="No creditors" message="Money or goods taken from a customer, owed back later" />}
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit creditor' : 'New creditor'}>
        <View style={styles.form}>
          <Input label="Name" value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label="Phone" value={form.phone} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" />
          <View style={styles.row2}>
            <Input label="Amount" value={form.amount} onChangeText={(v) => setForm((p) => ({ ...p, amount: v }))} keyboardType="numeric" containerStyle={styles.flex1} />
            <View style={styles.chipRow}>
              <Chip label="UZS" selected={form.currency === 'UZS'} onPress={() => setForm((p) => ({ ...p, currency: 'UZS' }))} />
              <Chip label="USD" selected={form.currency === 'USD'} onPress={() => setForm((p) => ({ ...p, currency: 'USD' }))} />
            </View>
          </View>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Return as</Text>
          <View style={styles.chipRow}>
            <Chip label="Money" selected={form.returnType === 'money'} onPress={() => setForm((p) => ({ ...p, returnType: 'money' }))} />
            <Chip label="Product" selected={form.returnType === 'product'} onPress={() => setForm((p) => ({ ...p, returnType: 'product' }))} />
          </View>
          {form.returnType === 'product' && (
            <Input label="What product" value={form.productNote} onChangeText={(v) => setForm((p) => ({ ...p, productNote: v }))} />
          )}
          <View style={styles.row2}>
            <Input label="Received (YYYY-MM-DD)" value={form.receivedAt} onChangeText={(v) => setForm((p) => ({ ...p, receivedAt: v }))} containerStyle={styles.flex1} />
            <Input label="Due (YYYY-MM-DD)" value={form.dueDate} onChangeText={(v) => setForm((p) => ({ ...p, dueDate: v }))} containerStyle={styles.flex1} />
          </View>
          <Input
            label="Remind this many days before due"
            value={form.remindDays}
            onChangeText={(v) => setForm((p) => ({ ...p, remindDays: v }))}
            keyboardType="numeric"
          />
          <Input label="Note (optional)" value={form.note} onChangeText={(v) => setForm((p) => ({ ...p, note: v }))} />
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title="Save" disabled={!formValid} onPress={save} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      <Dialog
        visible={returnTarget !== null}
        onClose={() => setReturnTarget(null)}
        title="Mark returned?"
        message={returnTarget ? `${returnTarget.name} — ${fmtCreditorAmount(returnTarget.amount, returnTarget.currency)}` : ''}
        actions={[
          { label: 'Cancel', onPress: () => setReturnTarget(null) },
          { label: 'Confirm', tone: 'primary', onPress: doReturn },
        ]}
      />

      <Dialog
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete creditor?"
        message={deleteTarget ? deleteTarget.name : ''}
        actions={[
          { label: 'Cancel', onPress: () => setDeleteTarget(null) },
          { label: 'Delete', tone: 'danger', onPress: doDelete },
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
