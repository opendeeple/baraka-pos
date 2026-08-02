import { useEffect, useState } from 'react'
import { Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { NumPad, applyNumKey } from './NumPad'
import { CustomerPickerModal } from './CustomerPickerModal'
import { colors } from '../theme'

// Reason picklists (analysis takeaway: free text alone makes Z-reports
// unreadable — a short picklist plus an optional note reads at a glance).
const REASONS: Record<'cash_in' | 'cash_out', string[]> = {
  cash_in: ['Float top-up', 'Customer debt payment', 'Other'],
  cash_out: ['Supplier payment', 'Owner draw', 'Bank drop', 'Correction', 'Other'],
}

interface Props {
  type: 'cash_in' | 'cash_out' | null
  onClose: () => void
  onDone: () => void
}

export function CashMovementModal({ type, onClose, onDone }: Props) {
  const { repos } = getServices()
  const { user, store, session } = useAuthStore()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [customer, setCustomer] = useState<ContactListItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (type) {
      setAmount('')
      setNote('')
      setCustomer(null)
      setReason(REASONS[type][0])
    }
  }, [type])

  if (!type) return null
  const isDebtPayment = type === 'cash_in' && reason === 'Customer debt payment'

  function save() {
    const value = Number(amount) || 0
    if (value <= 0) {
      Alert.alert('Enter an amount')
      return
    }
    if (isDebtPayment && !customer) {
      Alert.alert('Customer required', 'Select whose debt is being paid')
      setPickerOpen(true)
      return
    }
    try {
      repos.sessions.cashMovement({
        sessionId: session?.id ?? 0,
        storeId: store?.id ?? 1,
        userId: user?.id ?? 1,
        type: type!,
        amount: value,
        reason,
        note: note.trim() || null,
        contactId: isDebtPayment ? customer!.id : null,
      })
      onDone()
    } catch (err) {
      Alert.alert('Cannot record', err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{type === 'cash_in' ? '↓ Cash In' : '↑ Cash Out'}</Text>

          <View style={styles.reasonRow}>
            {REASONS[type].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.reasonChip, reason === r && styles.reasonActive]}
                onPress={() => {
                  setReason(r)
                  if (type === 'cash_in' && r === 'Customer debt payment' && !customer) setPickerOpen(true)
                }}
              >
                <Text style={[styles.reasonText, reason === r && { color: '#fff' }]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {isDebtPayment && (
            <TouchableOpacity style={styles.customerChip} onPress={() => setPickerOpen(true)}>
              <Text style={styles.customerText}>
                {customer
                  ? `👤 ${customer.name} — owes ${fmtUZS(customer.balance)}`
                  : '👤 Select customer'}
              </Text>
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional)"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.amount}>{amount ? fmtUZS(Number(amount)) : '0.00'}</Text>
          <NumPad onKey={(k) => setAmount((v) => applyNumKey(v, k))} />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.border }]} onPress={onClose}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: type === 'cash_in' ? colors.success : colors.danger, flex: 2 }]}
              onPress={save}
            >
              <Text style={styles.btnText}>Record</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <CustomerPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => { setCustomer(c); setPickerOpen(false) }}
      />
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  sheet: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, width: '100%', maxWidth: 400 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  reasonChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  reasonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  customerChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  customerText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  noteInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, color: colors.text, marginBottom: 10,
  },
  amount: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center', marginVertical: 10 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
})
