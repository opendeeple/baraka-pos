import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'
import { DEFAULT_SERVER_URL, type UserRole } from '@baraka/shared'

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL
// Only the store's own owner-level account can stand in for a forgotten
// PIN — a manager also gets Office access but isn't who the PIN exists to
// hold accountable, so their own valid login must still be rejected here.
const OWNER_ROLES = new Set<UserRole>(['admin', 'super_admin'])

interface Props {
  title?: string
  onClose: () => void
  onConfirmed: () => void
}

/**
 * Proves it's the shop owner — not just whoever is at the till — by
 * checking their account username/password fresh against the server,
 * without touching the already-logged-in session. Used to recover a
 * forgotten owner PIN: the PIN and the account password are independent
 * secrets, so forgetting one doesn't lock out the other.
 */
export function OwnerReauthModal({ title, onClose, onConfirmed }: Props) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!username.trim() || !password || checking) return
    setChecking(true)
    setError('')
    try {
      const result = await window.electronAPI.auth.login(SERVER_URL, username.trim(), password)
      if (result.status !== 200) {
        setError((result.data as Record<string, string> | null)?.error || t('auth.loginFailed'))
        return
      }
      const role = (result.data as { user?: { role?: UserRole } } | null)?.user?.role
      if (!role || !OWNER_ROLES.has(role)) {
        setError(t('settings.ownerOnlyReset'))
        return
      }
      onConfirmed()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.loginFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? t('settings.ownerReauthTitle')}
      maxWidth="max-w-xs"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" onClick={submit} loading={checking} disabled={!username.trim() || !password}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock size={20} className="text-primary" />
          </div>
        </div>
        <p className="text-xs text-gray-500 text-center">{t('settings.ownerReauthHint')}</p>
        <Input label={t('auth.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Input label={t('auth.password')} type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>
    </Modal>
  )
}
