import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Send, Copy, CheckCircle2 } from 'lucide-react'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { Modal, Button } from '../ui'
import { useAuthStore } from '../../store/auth.store'

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL
const API = `${SERVER_URL}/api/notifications`

interface Props {
  /** The SERVER-side (Postgres) contact id — NOT the local SQLite row id.
   *  Messaging only works once this contact has synced, since the server
   *  composes the message from already-synced sales/payments. */
  serverContactId: number | null
  contactName: string
  hasDebt: boolean
  onClose: () => void
}

type Channel = 'telegram' | 'sms'
type Template = 'debt' | 'history'

/**
 * Channel + template picker for sending a customer a debt reminder or their
 * purchase/debt history via Telegram (SMS ships once a gateway is
 * configured — the server rejects it clearly in the meantime rather than
 * pretending to send).
 */
export function SendMessageModal({ serverContactId, contactName, hasDebt, onClose }: Props) {
  const { t } = useTranslation()
  const { token } = useAuthStore()
  const [channel, setChannel] = useState<Channel>('telegram')
  const [template, setTemplate] = useState<Template>(hasDebt ? 'debt' : 'history')
  const [preview, setPreview] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [telegramConnected, setTelegramConnected] = useState(false)

  useEffect(() => { if (serverContactId) loadDeepLink() }, [serverContactId])
  useEffect(() => { if (serverContactId) loadPreview() }, [serverContactId, template])

  async function loadDeepLink() {
    try {
      const res = await window.electronAPI.reports.fetch(`${API}/deep-link/${serverContactId}`, token!) as { link: string | null; connected: boolean }
      setDeepLink(res.link)
      setTelegramConnected(res.connected)
    } catch { /* server unreachable — leave deep link unset */ }
  }

  async function loadPreview() {
    setLoadingPreview(true)
    try {
      const res = await window.electronAPI.reports.post(`${API}/preview`, token!, { contactId: serverContactId, template }) as { body: string }
      setPreview(res.body)
    } catch {
      setPreview('')
    } finally { setLoadingPreview(false) }
  }

  async function send() {
    setSending(true)
    try {
      const res = await window.electronAPI.reports.post(`${API}/send`, token!, { contactId: serverContactId, channel, template }) as { success: boolean; error?: string }
      if (res.success) {
        toast.success(t('notifications.sent'))
        onClose()
      } else {
        toast.error(res.error || t('notifications.sendFailed'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('notifications.sendFailed'))
    } finally { setSending(false) }
  }

  function copyLink() {
    if (!deepLink) return
    navigator.clipboard.writeText(deepLink)
    toast.success(t('notifications.linkCopied'))
  }

  if (!serverContactId) {
    return (
      <Modal open onClose={onClose} title={t('notifications.sendMessage')} maxWidth="max-w-sm">
        <div className="p-5 text-sm text-gray-400">{t('notifications.notSyncedYet')}</div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('notifications.sendMessage')} — ${contactName}`}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button className="flex-1" icon={Send} onClick={send} loading={sending} disabled={channel === 'telegram' && !telegramConnected}>
            {t('notifications.send')}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div className="flex bg-dark-card border border-dark-border rounded-lg p-1 text-sm">
          <button onClick={() => setChannel('telegram')} className={`flex-1 py-1.5 rounded-md transition-colors ${channel === 'telegram' ? 'bg-primary text-white' : 'text-gray-400'}`}>Telegram</button>
          <button onClick={() => setChannel('sms')} className={`flex-1 py-1.5 rounded-md transition-colors ${channel === 'sms' ? 'bg-primary text-white' : 'text-gray-400'}`}>SMS</button>
        </div>

        {channel === 'telegram' && !telegramConnected && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 space-y-2">
            <p className="text-xs text-yellow-200">{t('notifications.telegramNotConnected')}</p>
            {deepLink ? (
              <button onClick={copyLink} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Copy size={12} /> {t('notifications.copyLink')}
              </button>
            ) : (
              <p className="text-xs text-gray-500">{t('notifications.botNotConfigured')}</p>
            )}
          </div>
        )}
        {channel === 'telegram' && telegramConnected && (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 size={12} /> {t('notifications.telegramConnected')}
          </div>
        )}
        {channel === 'sms' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">{t('notifications.smsNotReady')}</p>
          </div>
        )}

        <div className="flex bg-dark-card border border-dark-border rounded-lg p-1 text-sm">
          <button onClick={() => setTemplate('debt')} className={`flex-1 py-1.5 rounded-md transition-colors ${template === 'debt' ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {t('notifications.templateDebt')}
          </button>
          <button onClick={() => setTemplate('history')} className={`flex-1 py-1.5 rounded-md transition-colors ${template === 'history' ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {t('notifications.templateHistory')}
          </button>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t('notifications.preview')}</label>
          <pre className="whitespace-pre-wrap text-xs text-gray-300 bg-dark-card border border-dark-border rounded-lg p-3 max-h-48 overflow-y-auto font-sans">
            {loadingPreview ? t('common.loading') : preview || t('notifications.noContent')}
          </pre>
        </div>
      </div>
    </Modal>
  )
}
