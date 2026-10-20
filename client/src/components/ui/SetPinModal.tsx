import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

interface Props {
  title?: string
  onClose: () => void
  onConfirmed: (pin: string) => void
}

/** Picks a new 4–6 digit PIN, typed twice so a typo doesn't lock the owner out of their own PIN. */
export function SetPinModal({ title, onClose, onConfirmed }: Props) {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  function submit() {
    if (pin.length < 4) { setError(t('settings.pinTooShort')); return }
    if (pin !== confirm) { setError(t('settings.pinMismatch')); return }
    onConfirmed(pin)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? t('settings.setNewPin')}
      maxWidth="max-w-xs"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={submit} disabled={!pin || !confirm}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound size={20} className="text-primary" />
          </div>
        </div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
          placeholder={t('settings.newPin')}
          className="w-full text-center text-2xl tracking-[0.5em] bg-dark-card border border-dark-border rounded-lg px-3 py-3 text-white focus:outline-none focus:border-primary"
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value.replace(/\D/g, '')); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder={t('settings.confirmPin')}
          className="w-full text-center text-2xl tracking-[0.5em] bg-dark-card border border-dark-border rounded-lg px-3 py-3 text-white focus:outline-none focus:border-primary"
        />
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>
    </Modal>
  )
}
