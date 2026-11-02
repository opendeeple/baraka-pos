import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ExpenseItem } from '@baraka/data'
import {
  Button,
  Chip,
  EmptyState,
  Input,
  ListRow,
  PinConfirmModal,
  Screen,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Repairs', 'Owner', 'Other']
const CATEGORY_I18N: Record<string, string> = {
  Rent: 'expenses.categoryRent',
  Utilities: 'expenses.categoryUtilities',
  Salaries: 'expenses.categorySalaries',
  Transport: 'expenses.categoryTransport',
  Supplies: 'expenses.categorySupplies',
  Repairs: 'expenses.categoryRepairs',
  Owner: 'expenses.categoryOwner',
  Other: 'expenses.categoryOther',
}
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Mobile Money']
const PAYMENT_I18N: Record<string, string> = {
  Cash: 'expenses.paymentCash',
  Card: 'expenses.paymentCard',
  'Bank Transfer': 'expenses.paymentBankTransfer',
  'Mobile Money': 'expenses.paymentMobileMoney',
}
const OWNER_CATEGORY = 'Owner'

function monthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
function today() {
  return new Date().toISOString().split('T')[0]
}

interface FormState {
  category: string
  description: string
  amount: string
  paymentMethod: string
  reference: string
}

const EMPTY_FORM: FormState = { category: 'Supplies', description: '', amount: '', paymentMethod: 'Cash', reference: '' }

export function ExpensesScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos, engine } = getServices()
  const { user, store } = useAuthStore()
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pendingSave, setPendingSave] = useState(false)
  const [ownerPin] = useState(() => repos.settings.get('owner_expense_pin'))

  const load = useCallback(() => {
    setExpenses(repos.expenses.list({ dateFrom: monthStart(), dateTo: today() }))
  }, [])

  useFocusEffect(load)

  const set = (k: keyof FormState, v: string) => setForm((prev) => ({ ...prev, [k]: v }))

  function saveExpense() {
    repos.expenses.create({
      storeId: store?.id ?? 1,
      sessionId: null,
      userId: user?.id ?? 1,
      expenseDate: today(),
      category: form.category,
      description: form.description.trim(),
      amount: Number(form.amount) || 0,
      paymentMethod: form.paymentMethod,
      reference: form.reference.trim() || null,
    })
    engine.flushOutbox().catch(() => {})
    setShowForm(false)
    setForm(EMPTY_FORM)
    toast.success(t('expenses.saved'))
    load()
  }

  // "Owner" expenses need the owner's PIN before the insert runs — mirrors
  // desktop's handleSaveClick; everything else saves immediately.
  function handleSaveClick() {
    if (!form.description.trim() || !form.amount) {
      toast.error(t('expenses.descriptionRequired'))
      return
    }
    if (form.category === OWNER_CATEGORY && ownerPin) {
      setPendingSave(true)
      return
    }
    saveExpense()
  }

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <Screen padded={false} scroll>
      <View style={styles.header}>
        <View style={styles.flex1}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>{t('expenses.thisMonth')}</Text>
          <Text style={[typeScale.lg, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(totalExpenses)}</Text>
        </View>
        <Button title={t('expenses.add')} icon="plus" size="sm" onPress={() => setShowForm(true)} />
      </View>

      <View style={styles.list}>
        {expenses.length === 0 ? (
          <EmptyState icon="receipt" title={t('expenses.noneThisMonth')} message={t('more.expensesSubtitle')} />
        ) : (
          expenses.map((e) => (
            <ListRow
              key={e.id}
              title={e.description || t(CATEGORY_I18N[e.category] ?? e.category)}
              subtitle={`${t(CATEGORY_I18N[e.category] ?? e.category)} · ${e.expenseDate} · ${t(PAYMENT_I18N[e.paymentMethod] ?? e.paymentMethod)}`}
              right={<Text style={[typeScale.money, { color: theme.text }]}>{fmtUZS(e.amount)}</Text>}
            />
          ))
        )}
      </View>

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={t('expenses.newExpense')}>
        <View style={styles.form}>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('expenses.category')}</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={t(CATEGORY_I18N[c])} selected={form.category === c} onPress={() => set('category', c)} />
            ))}
          </View>
          <Input label={t('common.description')} value={form.description} onChangeText={(v) => set('description', v)} />
          <Input
            label={t('expenses.amount')}
            value={form.amount}
            onChangeText={(v) => set('amount', v)}
            keyboardType="numeric"
          />
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('expenses.paidBy')}</Text>
          <View style={styles.chipRow}>
            {PAYMENT_METHODS.map((m) => (
              <Chip key={m} label={t(PAYMENT_I18N[m])} selected={form.paymentMethod === m} onPress={() => set('paymentMethod', m)} />
            ))}
          </View>
          <Input label={t('expenses.referenceOptional')} value={form.reference} onChangeText={(v) => set('reference', v)} />
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={handleSaveClick} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      <PinConfirmModal
        visible={pendingSave}
        expectedPin={ownerPin}
        title={t('expenses.ownerPinRequired')}
        onClose={() => setPendingSave(false)}
        onConfirmed={() => { setPendingSave(false); saveExpense() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  list: { padding: spacing.md, gap: spacing.sm, flex: 1 },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
