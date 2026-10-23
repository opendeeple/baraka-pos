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
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Repairs', 'Owner', 'Other']
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Mobile Money']
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
    toast.success('Expense saved')
    load()
  }

  // "Owner" expenses need the owner's PIN before the insert runs — mirrors
  // desktop's handleSaveClick; everything else saves immediately.
  function handleSaveClick() {
    if (!form.description.trim() || !form.amount) {
      toast.error('Description and amount are required')
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
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>This month</Text>
          <Text style={[typeScale.lg, { color: theme.danger, fontWeight: '700' }]}>{fmtUZS(totalExpenses)}</Text>
        </View>
        <Button title="Add" icon="plus" size="sm" onPress={() => setShowForm(true)} />
      </View>

      <View style={styles.list}>
        {expenses.length === 0 ? (
          <EmptyState icon="receipt" title="No expenses this month" message="Rent, utilities, salaries, supplies…" />
        ) : (
          expenses.map((e) => (
            <ListRow
              key={e.id}
              title={e.description || e.category}
              subtitle={`${e.category} · ${e.expenseDate} · ${e.paymentMethod}`}
              right={<Text style={[typeScale.money, { color: theme.text }]}>{fmtUZS(e.amount)}</Text>}
            />
          ))
        )}
      </View>

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title="New expense">
        <View style={styles.form}>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={c} selected={form.category === c} onPress={() => set('category', c)} />
            ))}
          </View>
          <Input label="Description" value={form.description} onChangeText={(v) => set('description', v)} />
          <Input
            label="Amount"
            value={form.amount}
            onChangeText={(v) => set('amount', v)}
            keyboardType="numeric"
          />
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Paid by</Text>
          <View style={styles.chipRow}>
            {PAYMENT_METHODS.map((m) => (
              <Chip key={m} label={m} selected={form.paymentMethod === m} onPress={() => set('paymentMethod', m)} />
            ))}
          </View>
          <Input label="Reference (optional)" value={form.reference} onChangeText={(v) => set('reference', v)} />
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title="Save" onPress={handleSaveClick} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      <PinConfirmModal
        visible={pendingSave}
        expectedPin={ownerPin}
        title="Owner PIN required"
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
