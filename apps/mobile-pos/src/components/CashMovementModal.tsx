import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
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
  Text,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { CustomerPickerModal } from './CustomerPickerModal'

// Reason picklists (analysis takeaway: free text alone makes Z-reports
// unreadable — a short picklist plus an optional note reads at a glance).
// Keys, not display text — translated at render time; the stored `reason`
// stays this English key either way (sessions.repo.ts/reports read it as
// plain data, same convention as desktop's writeoff/stocktake reasons).
const REASON_KEYS: Record<'cash_in' | 'cash_out', string[]> = {
  cash_in: ['Float top-up', 'Customer debt payment', 'Other'],
  cash_out: ['Supplier payment', 'Owner draw', 'Bank drop', 'Correction', 'Other'],
}
const REASON_I18N: Record<string, string> = {
  'Float top-up': 'cashMovement.reasonFloatTopUp',
  'Customer debt payment': 'cashMovement.reasonDebtPayment',
  'Supplier payment': 'cashMovement.reasonSupplierPayment',
  'Owner draw': 'cashMovement.reasonOwnerDraw',
  'Bank drop': 'cashMovement.reasonBankDrop',
  Correction: 'cashMovement.reasonCorrection',
  Other: 'cashMovement.reasonOther',
}

interface Props {
  type: 'cash_in' | 'cash_out' | null
  onClose: () => void
  onDone: () => void
}

export function CashMovementModal({ type, onClose, onDone }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
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
      setReason(REASON_KEYS[type][0])
    }
  }, [type])

  if (!type) return null
  const isDebtPayment = type === 'cash_in' && reason === 'Customer debt payment'

  function save() {
    const value = Number(amount) || 0
    if (value <= 0) {
      toast.error(t('cashMovement.enterAmount'))
      return
    }
    if (isDebtPayment && !customer) {
      toast.error(t('cashMovement.selectCustomerForDebt'))
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
      toast.success(t('cashMovement.recorded', { type: type === 'cash_in' ? t('session.cashIn') : t('session.cashOut'), amount: fmtUZS(value) }))
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cashMovement.cannotRecord'))
    }
  }

  return (
    <>
      <Dialog
        visible={!pickerOpen}
        onClose={onClose}
        title={type === 'cash_in' ? t('cashMovement.cashInTitle') : t('cashMovement.cashOutTitle')}
        actions={[
          { label: t('common.cancel'), onPress: onClose },
          { label: t('common.record'), tone: type === 'cash_in' ? 'primary' : 'danger', onPress: save },
        ]}
      >
        <View style={styles.reasonRow}>
          {REASON_KEYS[type].map((r) => (
            <Chip
              key={r}
              label={t(REASON_I18N[r])}
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
            title={customer ? t('cashMovement.owes', { name: customer.name, amount: fmtUZS(customer.balance) }) : t('cashMovement.selectCustomer')}
            variant="secondary"
            icon="user"
            size="sm"
            onPress={() => setPickerOpen(true)}
          />
        )}

        <Input value={note} onChangeText={setNote} placeholder={t('cashMovement.notePlaceholder')} />

        <Text
          style={[typeScale.moneyDisplay, styles.amount, { color: theme.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
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
