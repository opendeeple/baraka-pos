import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Send, Copy, CheckCircle2 } from 'lucide-react'
import { Modal, Button } from '../ui'

interface Props {
  /** Local SQLite contact id. */
  contactId: number
  contactName: string
  hasDebt: boolean
  onClose: () => void
}

type Channel = 'telegram' | 'sms'
type Template = 'debt' | 'history'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Channel + template picker for sending a customer a debt reminder or their
 * purchase/debt history. Runs entirely client-side (no server round trip) —
 * the Electron main process talks to Telegram directly and polls for
 * /start updates (see electron/services/telegram.service.ts), and message
 * content is composed from the local SQLite sales/cash_logs already synced
 * to this device. SMS ships once a gateway/modem is configured.
 */
export function SendMessageModal({ contactId, contactName, hasDebt, onClose }: Props) {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<Channel>('telegram')
  const [template, setTemplate] = useState<Template>(hasDebt ? 'debt' : 'history')
  const [preview, setPreview] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [telegramConfigured, setTelegramConfigured] = useState(true)

  useEffect(() => {
    loadConnectionInfo()
    // Customer connects by tapping the deep link outside this app (in
    // Telegram), so re-check while the modal stays open instead of only once.
    const timer = setInterval(() => { loadConnectionInfo() }, 3000)
    return () => clearInterval(timer)
  }, [contactId])
  useEffect(() => { buildPreview() }, [contactId, template])

  async function loadConnectionInfo() {
    const rows = await window.electronAPI.db.query(
      `SELECT sync_id, telegram_chat_id FROM contacts WHERE id=?`, [contactId]
    ) as Array<{ sync_id: string; telegram_chat_id: string | null }>
    const row = rows[0]
    if (!row) return
    setTelegramConnected(Boolean(row.telegram_chat_id))
    const configured = await window.electronAPI.telegram.status()
    setTelegramConfigured(configured)
    if (configured) setDeepLink(await window.electronAPI.telegram.getDeepLink(row.sync_id))
  }

  async function buildPreview() {
    setLoadingPreview(true)
    try {
      if (template === 'debt') {
        const [contactRows, storeRows] = await Promise.all([
          window.electronAPI.db.query(`SELECT name, balance FROM contacts WHERE id=?`, [contactId]),
          window.electronAPI.db.query(`SELECT name FROM stores LIMIT 1`, []),
        ]) as [Array<{ name: string; balance: number }>, Array<{ name: string }>]
        const c = contactRows[0]
        const storeName = storeRows[0]?.name ?? ''
        if (!c) { setPreview(''); return }
        setPreview([
          `Assalomu alaykum, ${c.name}!`, '',
          `${storeName} do'konidan sizda UZS ${fmt(Number(c.balance))} miqdorida qarz mavjud.`,
          `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`, '',
          `Rahmat!`,
        ].join('\n'))
      } else {
        const [contactRows, sales, payments] = await Promise.all([
          window.electronAPI.db.query(`SELECT name FROM contacts WHERE id=?`, [contactId]),
          window.electronAPI.db.query(
            `SELECT id, invoice_number, total_amount, sale_date FROM sales
             WHERE contact_id=? AND status='completed' ORDER BY created_at DESC LIMIT 10`, [contactId]
          ),
          window.electronAPI.db.query(
            `SELECT amount, created_at FROM cash_logs
             WHERE contact_id=? AND source='deposit' ORDER BY created_at DESC LIMIT 10`, [contactId]
          ),
        ]) as [Array<{ name: string }>, Array<{ id: number; invoice_number: string; total_amount: number; sale_date: string }>, Array<{ amount: number; created_at: string }>]

        const contactName2 = contactRows[0]?.name ?? ''
        const lines = [`${contactName2} — xarid va to'lov tarixi`, '']

        for (const sale of sales) {
          const items = await window.electronAPI.db.query(
            `SELECT description, quantity, unit_price FROM sale_items WHERE sale_id=?`, [sale.id]
          ) as Array<{ description: string; quantity: number; unit_price: number }>
          lines.push(`${sale.sale_date} — ${sale.invoice_number} — UZS ${fmt(Number(sale.total_amount))}`)
          // unit_price is the price recorded at sale time, not the product's
          // current price — keeps old messages accurate after price changes.
          for (const item of items) lines.push(`  • ${item.description} x${Number(item.quantity)} — UZS ${fmt(Number(item.unit_price))}`)
        }
        if (sales.length === 0) lines.push('Xaridlar topilmadi.')

        if (payments.length > 0) {
          lines.push('', "To'lovlar:")
          for (const p of payments) lines.push(`${p.created_at.slice(0, 10)} — UZS ${fmt(Number(p.amount))}`)
        }
        setPreview(lines.join('\n'))
      }
    } finally { setLoadingPreview(false) }
  }

  async function logMessage(status: 'sent' | 'failed', error?: string) {
    await window.electronAPI.db.exec(
      `INSERT INTO message_log (contact_id, channel, body, status, error, created_at) VALUES (?,?,?,?,?,?)`,
      [contactId, channel, preview, status, error ?? null, new Date().toISOString()]
    )
  }

  async function send() {
    setSending(true)
    try {
      if (channel === 'telegram') {
        const rows = await window.electronAPI.db.query(
          `SELECT telegram_chat_id FROM contacts WHERE id=?`, [contactId]
        ) as Array<{ telegram_chat_id: string | null }>
        const chatId = rows[0]?.telegram_chat_id
        if (!chatId) { toast.error(t('notifications.telegramNotConnected')); return }
        const result = await window.electronAPI.telegram.send(chatId, preview)
        await logMessage(result.success ? 'sent' : 'failed', result.error)
        if (result.success) {
          toast.success(t('notifications.sent'))
          onClose()
        } else {
          toast.error(result.error || t('notifications.sendFailed'))
        }
      } else {
        toast.error(t('notifications.smsNotReady'))
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

        {channel === 'telegram' && !telegramConfigured && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">{t('notifications.botNotConfigured')}</p>
          </div>
        )}
        {channel === 'telegram' && telegramConfigured && !telegramConnected && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 space-y-2">
            <p className="text-xs text-yellow-200">{t('notifications.telegramNotConnected')}</p>
            {deepLink && (
              <button onClick={copyLink} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Copy size={12} /> {t('notifications.copyLink')}
              </button>
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
