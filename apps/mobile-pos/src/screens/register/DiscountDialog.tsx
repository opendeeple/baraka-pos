import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import { Dialog, NumPad, applyNumKey, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'

interface DiscountDialogProps {
  visible: boolean
  initial: number
  /** Discount is capped at the pre-discount sale total. */
  maxAmount: number
  onApply: (amount: number) => void
  onClose: () => void
}

export function DiscountDialog({ visible, initial, maxAmount, onApply, onClose }: DiscountDialogProps) {
  const theme = useTheme()
  const { t } = useTranslation()
  const [entry, setEntry] = useState(() => (initial ? String(initial) : ''))

  function apply() {
    const value = Number(entry) || 0
    if (value > maxAmount) {
      toast.error(t('discount.tooMuch'))
      return
    }
    onApply(value)
  }

  if (!visible) return null
  return (
    <Dialog
      visible
      onClose={onClose}
      title={t('discount.title')}
      actions={[
        { label: t('discount.clear'), onPress: () => onApply(0) },
        { label: t('discount.apply'), tone: 'primary', onPress: apply },
      ]}
    >
      <Text style={[typeScale.moneyDisplay, styles.entry, { color: theme.text }]}>
        {entry ? fmtUZS(Number(entry)) : fmtUZS(0)}
      </Text>
      <NumPad onKey={(k) => setEntry((v) => applyNumKey(v, k))} />
    </Dialog>
  )
}

const styles = StyleSheet.create({
  entry: { textAlign: 'center', marginVertical: spacing.sm },
})
