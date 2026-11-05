import { useCallback, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { EmployeeForm, EmployeeRole, EmployeeRow, SalaryRecordRow } from '@baraka/data'
import {
  Badge,
  Button,
  Chip,
  Dialog,
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

const ROLES: EmployeeRole[] = ['cashier', 'manager', 'admin']
const ROLE_I18N: Record<string, string> = {
  cashier: 'employees.roleCashier', manager: 'employees.roleManager', admin: 'employees.roleAdmin',
}
const ROLE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  cashier: 'success', manager: 'info', admin: 'warning',
}

interface EditState {
  name: string
  email: string
  phone: string
  role: EmployeeRole
  pinCode: string
  salary: string
  hireDate: string
}

const EMPTY_EDIT: EditState = { name: '', email: '', phone: '', role: 'cashier', pinCode: '', salary: '', hireDate: '' }

export function EmployeesScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const [search, setSearch] = useState('')
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<EditState>(EMPTY_EDIT)
  const [detailTarget, setDetailTarget] = useState<EmployeeRow | null>(null)

  const load = useCallback(() => {
    setEmployees(repos.employees.list(search || undefined))
  }, [search])

  useFocusEffect(load)

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_EDIT)
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim()) {
      toast.error(t('common.nameRequired'))
      return
    }
    const input: EmployeeForm = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      role: form.role,
      pinCode: form.pinCode.trim() || null,
      salary: form.salary.trim() ? Number(form.salary) : null,
      hireDate: form.hireDate.trim() || null,
    }
    repos.employees.save(editId, input)
    setShowForm(false)
    toast.success(editId ? t('employees.updated') : t('employees.added'))
    load()
    if (detailTarget) {
      const fresh = repos.employees.list().find((e) => e.id === detailTarget.id)
      if (fresh) setDetailTarget(fresh)
    }
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder={t('employees.searchPlaceholder')}
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title={t('common.new')} icon="plus" onPress={openCreate} />
      </View>

      <FlatList
        data={employees}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.email ?? item.phone ?? '—'}
            onPress={() => setDetailTarget(item)}
            meta={
              <>
                <Badge label={t(ROLE_I18N[item.role] ?? item.role)} tone={ROLE_TONE[item.role] ?? 'neutral'} />
                {!item.isActive && <Badge label={t('employees.inactive')} tone="neutral" />}
              </>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={search ? t('employees.noneFound') : t('employees.noneYet')}
            message={search ? t('common.tryDifferentSearch') : t('employees.emptyHint')}
            action={search ? undefined : { label: t('employees.newEmployee'), onPress: openCreate }}
          />
        }
      />

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('employees.editEmployee') : t('employees.newEmployee')}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={save} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label={t('common.email')} value={form.email} onChangeText={(v) => setForm((p) => ({ ...p, email: v }))} autoCapitalize="none" keyboardType="email-address" />
          <Input label={t('common.phone')} value={form.phone} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" />
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('employees.role')}</Text>
          <View style={styles.chipRow}>
            {ROLES.map((r) => (
              <Chip key={r} label={t(ROLE_I18N[r])} selected={form.role === r} onPress={() => setForm((p) => ({ ...p, role: r }))} />
            ))}
          </View>
          <Input
            label={t('employees.pinCode')}
            value={form.pinCode}
            onChangeText={(v) => setForm((p) => ({ ...p, pinCode: v.replace(/\D/g, '').slice(0, 6) }))}
            keyboardType="number-pad"
            secureTextEntry
          />
          <View style={styles.row2}>
            <Input label={t('employees.monthlySalary')} value={form.salary} onChangeText={(v) => setForm((p) => ({ ...p, salary: v }))} keyboardType="numeric" containerStyle={styles.flex1} />
            <Input label={t('employees.hireDate')} value={form.hireDate} onChangeText={(v) => setForm((p) => ({ ...p, hireDate: v }))} containerStyle={styles.flex1} />
          </View>
        </View>
      </Sheet>

      {detailTarget && (
        <EmployeeDetailSheet
          employee={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            setEditId(detailTarget.id)
            setForm({
              name: detailTarget.name, email: detailTarget.email ?? '', phone: detailTarget.phone ?? '',
              role: (detailTarget.role as EmployeeRole) ?? 'cashier', pinCode: '',
              salary: detailTarget.salary ? String(detailTarget.salary) : '', hireDate: detailTarget.hireDate ?? '',
            })
            setDetailTarget(null)
            setShowForm(true)
          }}
          onToggleActive={() => {
            repos.employees.toggleActive(detailTarget.id)
            load()
            setDetailTarget(null)
          }}
        />
      )}
    </Screen>
  )
}

function EmployeeDetailSheet({
  employee, onClose, onEdit, onToggleActive,
}: {
  employee: EmployeeRow
  onClose: () => void
  onEdit: () => void
  onToggleActive: () => void
}) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos } = getServices()
  const [records, setRecords] = useState<SalaryRecordRow[]>(() => repos.employees.salaryRecords(employee.id))
  const [showSalaryForm, setShowSalaryForm] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  return (
    <Sheet visible onClose={onClose} title={employee.name}>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Badge label={t(ROLE_I18N[employee.role] ?? employee.role)} tone={ROLE_TONE[employee.role] ?? 'neutral'} />
        {employee.email && <Text style={[typeScale.sm, { color: theme.textMuted }]}>{employee.email}</Text>}
        {employee.phone && <Text style={[typeScale.sm, { color: theme.textMuted }]}>{employee.phone}</Text>}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('employees.monthlySalary')}</Text>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>{employee.salary ? fmtUZS(employee.salary) : '—'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('employees.hired')}</Text>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>{employee.hireDate ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Button title={t('suppliers.edit')} variant="secondary" onPress={onEdit} style={styles.flex1} />
          <Button
            title={employee.isActive ? t('employees.deactivate') : t('employees.activate')}
            variant={employee.isActive ? 'danger' : 'secondary'}
            onPress={() => (employee.isActive ? setConfirmDeactivate(true) : onToggleActive())}
            style={styles.flex1}
          />
        </View>

        <View style={styles.rowBetween}>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('employees.salaryPayments')}</Text>
          <Button title={t('employees.recordPayment')} icon="plus" size="sm" variant="secondary" onPress={() => setShowSalaryForm(true)} />
        </View>
        {records.length === 0 ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>{t('employees.noSalaryYet')}</Text>
        ) : (
          records.map((r) => (
            <View key={r.id} style={[styles.rowItem, { borderColor: theme.border }]}>
              <View style={styles.flex1}>
                <Text style={[typeScale.sm, { color: theme.text }]}>{r.periodFrom} — {r.periodTo}</Text>
                <Text style={[typeScale.xs, { color: theme.textFaint }]}>{String(r.paidAt).slice(0, 10)}{r.note ? ` · ${r.note}` : ''}</Text>
              </View>
              <Text style={[typeScale.sm, { color: theme.success, fontWeight: '700' }]}>{fmtUZS(r.amount)}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {showSalaryForm && (
        <SalaryPaymentSheet
          employee={employee}
          onClose={() => setShowSalaryForm(false)}
          onRecorded={() => {
            setShowSalaryForm(false)
            setRecords(repos.employees.salaryRecords(employee.id))
          }}
        />
      )}

      <Dialog
        visible={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title={t('employees.deactivateTitle')}
        message={t('employees.deactivateConfirm', { name: employee.name })}
        actions={[
          { label: t('common.cancel'), onPress: () => setConfirmDeactivate(false) },
          { label: t('employees.deactivate'), tone: 'danger', onPress: () => { setConfirmDeactivate(false); onToggleActive() } },
        ]}
      />
    </Sheet>
  )
}

function SalaryPaymentSheet({
  employee, onClose, onRecorded,
}: {
  employee: EmployeeRow
  onClose: () => void
  onRecorded: () => void
}) {
  const { t } = useTranslation()
  const { repos } = getServices()
  const [amount, setAmount] = useState(employee.salary ? String(employee.salary) : '')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [note, setNote] = useState('')

  const valid = Number(amount) > 0 && periodFrom.trim() !== '' && periodTo.trim() !== ''

  function save() {
    if (!valid) return
    repos.employees.recordSalary(employee.id, employee.name, Number(amount), periodFrom, periodTo, note || null)
    toast.success(t('employees.recorded', { amount: fmtUZS(Number(amount)), name: employee.name }))
    onRecorded()
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t('employees.payTitle', { name: employee.name })}
      footer={
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button title={t('employees.record')} disabled={!valid} onPress={save} style={styles.flex2} />
        </View>
      }
    >
      <View style={styles.form}>
        <Input label={t('employees.amountUzs')} value={amount} onChangeText={setAmount} keyboardType="numeric" autoFocus />
        <View style={styles.row2}>
          <Input label={t('employees.periodFrom')} value={periodFrom} onChangeText={setPeriodFrom} containerStyle={styles.flex1} />
          <Input label={t('employees.periodTo')} value={periodTo} onChangeText={setPeriodTo} containerStyle={styles.flex1} />
        </View>
        <Input label={t('common.noteOptional')} value={note} onChangeText={setNote} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  formScroll: { maxHeight: 480 },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  row2: { flexDirection: 'row', gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, borderRadius: 8, padding: spacing.sm, backgroundColor: 'rgba(255,255,255,0.04)' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  rowItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 8, padding: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
