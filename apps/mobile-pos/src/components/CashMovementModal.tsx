import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import {
  Button,
  Chip,
  Dialog,
  Input,
  NumPad,
  applyNumKey,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { CustomerPickerModal } from './CustomerPickerModal'

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
  const theme = useTheme()
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
      toast.error('Enter an amount')
      return
    }
    if (isDebtPayment && !customer) {
      toast.error('Select whose debt is being paid')
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
      toast.success(`${type === 'cash_in' ? 'Cash in' : 'Cash out'} recorded — ${fmtUZS(value)}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cannot record movement')
    }
  }

  return (
    <>
      <Dialog
        visible={!pickerOpen}
        onClose={onClose}
        title={type === 'cash_in' ? 'Cash In' : 'Cash Out'}
        actions={[
          { label: 'Cancel', onPress: onClose },
          { label: 'Record', tone: type === 'cash_in' ? 'primary' : 'danger', onPress: save },
        ]}
      >
        <View style={styles.reasonRow}>
          {REASONS[type].map((r) => (
            <Chip
              key={r}
              label={r}
              selected={reason === r}
              onPress={() => {
                setReason(r)
                if (type === 'cash_in' && r === 'Customer debt payment' && !customer) setPickerOpen(true)
              }}
            />
          ))}
        </View>

        {isDebtPayment && (
          <Button
            title={customer ? `${customer.name} — owes ${fmtUZS(customer.balance)}` : 'Select customer'}
            variant="secondary"
            icon="user"
            size="sm"
            onPress={() => setPickerOpen(true)}
          />
        )}

        <Input value={note} onChangeText={setNote} placeholder="Note (optional)" />

        <Text
          style={[typeScale.moneyDisplay, styles.amount, { color: theme.text }]}
          accessibilityLabel={`Amount ${amount || '0'}`}
        >
          {amount ? fmtUZS(Number(amount)) : fmtUZS(0)}
        </Text>
        <NumPad onKey={(k) => setAmount((v) => applyNumKey(v, k))} />
      </Dialog>

      <CustomerPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => {
          setCustomer(c)
          setPickerOpen(false)
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  amount: { textAlign: 'center', marginVertical: spacing.sm },
})
