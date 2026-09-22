import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

interface Props {
  /** The correct PIN to check against — caller reads it from wherever it's
   *  stored (e.g. the `settings` table) and passes it in. */
  expectedPin: string
  title?: string
  onClose: () => void
  onConfirmed: () => void
}

/**
 * First step-up-confirmation modal in the app — a PIN gate reused anywhere
 * an action needs the owner (not just any logged-in admin) to explicitly
 * authorize it, starting with the "Personal (Owner)" expense category.
 */
export function PinConfirmModal({ expectedPin, title, onClose, onConfirmed }: Props) {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  function submit() {
    if (pin === expectedPin && expectedPin) {
      onConfirmed()
    } else {
      setError(true)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? t('settings.pinCode')}
      maxWidth="max-w-xs"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={submit} disabled={!pin}>{t('common.confirm')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock size={20} className="text-primary" />
          </div>
        </div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="••••"
          className="w-full text-center text-2xl tracking-[0.5em] bg-dark-card border border-dark-border rounded-lg px-3 py-3 text-white focus:outline-none focus:border-primary"
        />
        {error && <p className="text-xs text-red-400 text-center">{t('settings.wrongPin')}</p>}
      </div>
    </Modal>
  )
}
