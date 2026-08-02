import { useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS } from '@baraka/app-core'
import type { PaymentMethod } from '@baraka/shared'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { NumPad, applyNumKey } from '../components/NumPad'
import { CustomerPickerModal } from '../components/CustomerPickerModal'
import { printReceipt, type PrinterConfig } from '../printing'
import { colors } from '../theme'
import type { RootStackParamList } from '../navigation'
import type { ContactListItem } from '@baraka/data'

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>

const METHODS = ['Cash', 'Card', 'Click', 'Debt'] as const

// Likely banknote hand-overs for the amount due: the total rounded UP to the
// next multiple of each denomination, deduped (adapted from Lakasir).
const DENOMINATIONS = [1000, 5000, 10000, 20000, 50000, 100000]
function suggestedCash(due: number): number[] {
  const suggestions = new Set<number>()
  for (const d of DENOMINATIONS) {
    suggestions.add(Math.ceil(due / d) * d)
  }
  return [...suggestions].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 5)
}

export function PaymentScreen({ navigation }: Props) {
  const { repos, engine, useCartStore } = getServices()
  const cart = useCartStore()
  const { user, store, session } = useAuthStore()

  const total = cart.getFinalTotal()
  const [payments, setPayments] = useState<Array<{ paymentMethod: PaymentMethod; amount: number }>>([])
  const [method, setMethod] = useState<(typeof METHODS)[number]>('Cash')
  const [entry, setEntry] = useState('')
  const [processing, setProcessing] = useState(false)
  const [customer, setCustomer] = useState<ContactListItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const hasDebt = payments.some((p) => p.paymentMethod === 'Debt') || method === 'Debt'

  const paid = payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, total - paid)
  const change = Math.max(0, paid - total)
  const fullyPaid = paid >= total && total > 0

  function addPayment(amount?: number) {
    const value = amount ?? Number(entry)
    if (!value || value <= 0) return
    // Fat-finger guard (Odoo's large-amount check): a manually keyed amount
    // wildly above what's due is almost always a missed decimal or extra zero.
    if (amount === undefined && total > 0 && value > total * 100) {
      Alert.alert(
        'Confirm large amount',
        `${fmtUZS(value)} entered for a ${fmtUZS(total)} sale. Add it anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: () => {
              setPayments((prev) => [...prev, { paymentMethod: method, amount: value }])
              setEntry('')
            },
          },
        ]
      )
      return
    }
    setPayments((prev) => [...prev, { paymentMethod: method, amount: value }])
    setEntry('')
  }

  async function complete() {
    if (!fullyPaid || processing) return
    // Debt sales must be attached to a customer whose balance carries the debt.
    if (payments.some((p) => p.paymentMethod === 'Debt') && !customer) {
      Alert.alert('Customer required', 'Select a customer for debt payments')
      setPickerOpen(true)
      return
    }
    setProcessing(true)
    try {
      const invoiceNumber =
        engine.nextInvoiceNumber() ?? `INV-${Math.random().toString(16).slice(2, 10).toUpperCase()}`
      const result = repos.sales.createSale({
        storeId: store?.id ?? 1,
        sessionId: session?.id ?? 1,
        userId: user?.id ?? 1,
        contactId: customer?.id ?? null,
        items: cart.items,
        charges: cart.charges,
        discount: cart.discount,
        payments,
        invoiceNumber,
      })
      const printerConfig = repos.settings.getJson<PrinterConfig>('printer_config')
      printReceipt(
        {
          invoiceNumber: result.invoiceNumber,
          storeName: store?.name ?? 'Store',
          storeAddress: store?.address,
          storePhone: store?.phone,
          cashierName: user?.name ?? 'Cashier',
          timestamp: new Date().toISOString(),
          items: cart.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unitPrice, discount: i.discount })),
          charges: [],
          discount: cart.discount,
          total: result.total,
          payments: payments.map((p) => ({ method: p.paymentMethod, amount: p.amount })),
          change: result.changeAmount,
          openDrawer: payments.some((p) => p.paymentMethod === 'Cash'),
        },
        printerConfig
      ).catch((err) => console.warn('Print failed:', err))
      cart.clearCart()
      engine.flushOutbox().catch(() => {})
      Alert.alert(
        'Sale complete',
        `${result.invoiceNumber}\nTotal: ${fmtUZS(result.total)}${result.changeAmount > 0 ? `\nChange: ${fmtUZS(result.changeAmount)}` : ''}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      )
    } catch (err) {
      Alert.alert('Payment failed', err instanceof Error ? err.message : 'Please retry')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Row label="Total" value={fmtUZS(total)} big />
        <Row label="Paid" value={fmtUZS(paid)} />
        <Row label={change > 0 ? 'Change' : 'Remaining'} value={fmtUZS(change > 0 ? change : remaining)} accent />
      </View>

      <View style={styles.methods}>
        {METHODS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.methodBtn, method === m && styles.methodActive]}
            onPress={() => {
              setMethod(m)
              if (m === 'Debt' && !customer) setPickerOpen(true)
            }}
          >
            <Text style={[styles.methodText, method === m && { color: '#fff' }]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.customerChip, hasDebt && !customer && { borderColor: colors.danger }]}
        onPress={() => setPickerOpen(true)}
      >
        <Text style={styles.customerChipText}>
          {customer ? `👤 ${customer.name}` : hasDebt ? '👤 Select customer (required for debt)' : '👤 Add customer (optional)'}
        </Text>
        {customer && (
          <TouchableOpacity onPress={() => setCustomer(null)}>
            <Text style={{ color: colors.danger, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <CustomerPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => { setCustomer(c); setPickerOpen(false) }}
      />

      {method === 'Cash' && remaining > 0 && (
        <View style={styles.denomRow}>
          {suggestedCash(remaining).map((d) => (
            <TouchableOpacity key={d} style={styles.denomBtn} onPress={() => addPayment(d)}>
              <Text style={styles.denomText}>{d >= 1000 ? `${d / 1000}k` : d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.entry}>{entry ? fmtUZS(Number(entry)) : fmtUZS(remaining)}</Text>
      <View style={styles.padWrap}>
        <NumPad onKey={(k) => setEntry((v) => applyNumKey(v, k))} />
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => addPayment(remaining)}>
          <Text style={styles.quickText}>Exact</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => addPayment()}>
          <Text style={styles.quickText}>Add {method}</Text>
        </TouchableOpacity>
      </View>

      {payments.map((p, i) => (
        <View key={i} style={styles.paymentRow}>
          <Text style={styles.paymentText}>{p.paymentMethod}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={styles.paymentText}>{fmtUZS(p.amount)}</Text>
            <TouchableOpacity onPress={() => setPayments((prev) => prev.filter((_, j) => j !== i))}>
              <Text style={{ color: colors.danger, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.completeBtn, !fullyPaid && { opacity: 0.4 }]}
        disabled={!fullyPaid || processing}
        onPress={complete}
      >
        <Text style={styles.completeText}>{processing ? 'Processing…' : 'Complete Sale'}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

function Row({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, big && { fontSize: 16 }]}>{label}</Text>
      <Text style={[styles.rowValue, big && { fontSize: 24 }, accent && { color: colors.primary }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, maxWidth: 520, width: '100%', alignSelf: 'center' },
  summary: { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 6, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 17, fontWeight: '700' },
  methods: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  customerChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
  },
  customerChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  methodBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', minHeight: 48,
  },
  methodActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  methodText: { color: colors.textMuted, fontWeight: '700' },
  entry: { color: colors.text, fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  denomRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  denomBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  denomText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  padWrap: { alignSelf: 'center', width: '100%', maxWidth: 380 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  quickBtn: {
    flex: 1, backgroundColor: colors.border, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', minHeight: 48, justifyContent: 'center',
  },
  quickText: { color: colors.text, fontWeight: '700' },
  paymentRow: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.card,
    borderRadius: 10, padding: 12, marginTop: 8,
  },
  paymentText: { color: colors.text, fontWeight: '600' },
  completeBtn: {
    backgroundColor: colors.success, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 18, minHeight: 54, justifyContent: 'center',
  },
  completeText: { color: '#fff', fontSize: 17, fontWeight: '800' },
})
