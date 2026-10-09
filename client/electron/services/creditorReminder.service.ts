import { Notification } from 'electron'
import { dbQuery, dbExec } from './db.service'
import { logger } from './logger.service'
import { enqueueOutbox } from './sync.service'
import { sendSms, isSmsConfigured } from './sms.service'

// Creditors ("haqdorlar") due-date warnings for the shop owner. Runs in the
// back office like autoReminder.service.ts. Each open creditor is warned at
// most twice: once when it enters its "remind N days before" window
// (reminder_sent_at), once on/after the due day (overdue_sent_at). The stamps
// sync, so a second back office doesn't warn again. Warnings go out as a
// Windows notification plus one SMS to the owner's phone listing them all.

interface CreditorReminderConfig {
  enabled: boolean
  ownerPhone: string
}

// On by default: a desktop notification costs nothing, and the SMS still
// needs an owner phone and a configured gateway.
const DEFAULT_CONFIG: CreditorReminderConfig = { enabled: true, ownerPhone: '' }

function getConfig(): CreditorReminderConfig {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='creditor_reminder_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return DEFAULT_CONFIG
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<CreditorReminderConfig>
    return { enabled: parsed.enabled !== false, ownerPhone: (parsed.ownerPhone ?? '').trim() }
  } catch {
    return DEFAULT_CONFIG
  }
}

interface CreditorRow {
  id: number
  sync_id: string
  name: string
  phone: string | null
  amount: number
  currency: string
  return_type: string
  product_note: string | null
  due_date: string
  remind_days: number
  reminder_sent_at: string | null
  overdue_sent_at: string | null
}

type Stage = 'soon' | 'due'

function localYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days from today to `ymd` (negative once it has passed). */
export function daysUntil(ymd: string, today = localYmd(new Date())): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(ymd) - toUtc(today)) / 86_400_000)
}

function fmtAmount(c: CreditorRow): string {
  const n = Number(c.amount)
  return c.currency === 'USD'
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : `${Math.round(n).toLocaleString('en-US')} so'm`
}

function describe(c: CreditorRow, days: number): string {
  const what = c.return_type === 'product'
    ? `mahsulot${c.product_note ? ` (${c.product_note})` : ''}`
    : 'pul'
  const when = days > 0 ? `${days} kun qoldi` : days === 0 ? 'muddat bugun' : `${-days} kun o'tdi`
  return `${c.name}${c.phone ? ` ${c.phone}` : ''} - ${fmtAmount(c)}, ${what} qaytarish, ${c.due_date} (${when})`
}

function markSent(c: CreditorRow, stage: Stage): void {
  const now = new Date().toISOString()
  const column = stage === 'due' ? 'overdue_sent_at' : 'reminder_sent_at'
  // Reaching the due day also covers the "soon" warning it would have had.
  const alsoSoon = stage === 'due' ? ', reminder_sent_at = COALESCE(reminder_sent_at, ?)' : ''
  dbExec(
    `UPDATE creditors SET ${column}=?${alsoSoon}, updated_at=? WHERE id=?`,
    stage === 'due' ? [now, now, now, c.id] : [now, now, c.id]
  )
  enqueueOutbox('creditors', c.sync_id, 'upsert')
}

const SMS_LIST_LIMIT = 8

let running = false

export async function runCreditorReminderCheck(): Promise<{ notified: number; sms: 'sent' | 'skipped' | 'failed' }> {
  const result = { notified: 0, sms: 'skipped' as 'sent' | 'skipped' | 'failed' }
  if (running) return result
  running = true
  try {
    const config = getConfig()
    if (!config.enabled) return result

    const rows = dbQuery(
      `SELECT id, sync_id, name, phone, amount, currency, return_type, product_note, due_date, remind_days,
              reminder_sent_at, overdue_sent_at
       FROM creditors WHERE status='open' AND deleted_at IS NULL ORDER BY due_date`
    ) as CreditorRow[]

    const today = localYmd(new Date())
    const pending: Array<{ c: CreditorRow; stage: Stage; days: number }> = []
    for (const c of rows) {
      const days = daysUntil(c.due_date, today)
      if (days <= 0 && !c.overdue_sent_at) pending.push({ c, stage: 'due', days })
      else if (days > 0 && days <= Number(c.remind_days || 0) && !c.reminder_sent_at) pending.push({ c, stage: 'soon', days })
    }
    if (!pending.length) return result

    const lines = pending.map(({ c, days }) => describe(c, days))

    if (Notification.isSupported()) {
      const body = lines.length === 1 ? lines[0] : `${lines.slice(0, 3).join('\n')}${lines.length > 3 ? `\n... va yana ${lines.length - 3} ta` : ''}`
      new Notification({ title: `Haqdorlar: ${pending.length} ta muddat yaqin`, body }).show()
    }

    const store = (dbQuery(`SELECT name, phone FROM stores LIMIT 1`) as Array<{ name: string; phone: string | null }>)[0]
    const ownerPhone = config.ownerPhone || store?.phone || ''
    if (ownerPhone && isSmsConfigured()) {
      const text = [
        `${store?.name ?? 'Do\'kon'}: haqdorlar muddati`,
        ...lines.slice(0, SMS_LIST_LIMIT),
        ...(lines.length > SMS_LIST_LIMIT ? [`... va yana ${lines.length - SMS_LIST_LIMIT} ta`] : []),
      ].join('\n')
      try {
        await sendSms(ownerPhone, text)
        result.sms = 'sent'
      } catch (err) {
        // Not stamped: the next hourly check tries the SMS again.
        result.sms = 'failed'
        logger.warn('Creditor reminder SMS failed', err)
        return result
      }
    }

    for (const { c, stage } of pending) markSent(c, stage)
    result.notified = pending.length
    logger.info(`Creditor reminders: ${pending.length} warned, SMS ${result.sms}`)
  } finally {
    running = false
  }
  return result
}

let timer: ReturnType<typeof setInterval> | null = null
const CHECK_INTERVAL_MS = 60 * 60 * 1000
// Give the first sync a moment to bring other devices' creditors and stamps.
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000

export function startCreditorReminderScheduler(): void {
  if (timer) return
  const run = () => { runCreditorReminderCheck().catch((err) => logger.warn('Creditor reminder check failed', err)) }
  setTimeout(run, FIRST_CHECK_DELAY_MS)
  timer = setInterval(run, CHECK_INTERVAL_MS)
}
