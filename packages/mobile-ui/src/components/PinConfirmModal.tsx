import { useState } from 'react'
import { Dialog } from './Dialog'
import { Input } from './Input'
import { spacing } from '@baraka/ui-tokens'

export interface PinConfirmModalProps {
  visible: boolean
  /** The correct PIN to check against — caller reads it from settings
   *  (desktop's `owner_expense_pin`, synced, so whatever the owner sets on
   *  desktop also gates the same actions on mobile) and passes it in. */
  expectedPin: string
  title?: string
  onClose: () => void
  onConfirmed: () => void
}

/**
 * PIN gate for an action that needs the owner (not just whoever is holding
 * the phone) to explicitly authorize it — mirrors desktop's
 * client/src/components/ui/PinConfirmModal.tsx.
 */
export function PinConfirmModal({ visible, expectedPin, title, onClose, onConfirmed }: PinConfirmModalProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  function reset() {
    setPin('')
    setError(false)
  }

  function submit() {
    if (pin && expectedPin && pin === expectedPin) {
      reset()
      onConfirmed()
    } else {
      setError(true)
    }
  }

  return (
    <Dialog
      visible={visible}
      onClose={() => { reset(); onClose() }}
      title={title ?? 'Owner PIN'}
      actions={[
        { label: 'Cancel', onPress: () => { reset(); onClose() } },
        { label: 'Confirm', tone: 'primary', onPress: submit },
      ]}
    >
      <Input
        value={pin}
        onChangeText={(v) => { setPin(v.replace(/\D/g, '').slice(0, 6)); setError(false) }}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus
        onSubmitEditing={submit}
        error={error ? 'Wrong PIN' : null}
        containerStyle={{ marginTop: spacing.sm }}
      />
    </Dialog>
  )
}
