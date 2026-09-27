import { dbQuery, dbExec } from './db.service'
import { logger } from './logger.service'
import { sendTelegramMessage, isTelegramConfigured } from './telegram.service'

// Automatic debt reminders — runs entirely client-side like the rest of the
// Telegram integration (see telegram.service.ts). A contact is only ever
// reminded while balance > 0; once they pay off (balance reaches 0) the
// query below simply stops selecting them, so there's no separate "mark as
// paid, don't resend" bookkeeping needed.

interface AutoReminderConfig {
  enabled: boolean
  intervalDays: number
}

const DEFAULT_CONFIG: AutoReminderConfig = { enabled: false, intervalDays: 3 }

function getConfig(): AutoReminderConfig {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='auto_reminder_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return DEFAULT_CONFIG
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<AutoReminderConfig>
    return {
      enabled: Boolean(parsed.enabled),
      intervalDays: parsed.intervalDays && parsed.intervalDays > 0 ? parsed.intervalDays : DEFAULT_CONFIG.intervalDays,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

interface DebtorContact {
  id: number
  sync_id: string
  name: string
  balance: number
  telegram_chat_id: string | null
  reminder_interval_days: number | null
}

// Lists the sales that carried a debt portion (payment_transactions with
// method 'Debt') rather than the customer's whole purchase history — this
// is what the owner asked for: "which purchases were taken on credit",
// not every past receipt regardless of how it was paid.
function buildReminderMessage(contact: DebtorContact): string {
  const storeRows = dbQuery(`SELECT name FROM stores LIMIT 1`) as Array<{ name: string }>
  const storeName = storeRows[0]?.name ?? ''
  const lines = [
    `Assalomu alaykum, ${contact.name}!`, '',
    `${storeName} do'konidan sizda UZS ${fmt(Number(contact.balance))} miqdorida qarz mavjud.`,
    `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`, '',
    `Qarzga olingan xaridlar:`,
  ]
  const debtSales = dbQuery(
    `SELECT s.invoice_number, s.sale_date, SUM(pt.amount) as amount
     FROM sales s
     JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
     WHERE s.contact_id = ? AND s.status != 'cancelled'
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT 10`,
    [contact.id]
  ) as Array<{ invoice_number: string; sale_date: string; amount: number }>
  if (debtSales.length === 0) {
    lines.push("Ma'lumot topilmadi.")
  } else {
    for (const s of debtSales) lines.push(`${s.sale_date} — ${s.invoice_number} — UZS ${fmt(Number(s.amount))}`)
  }
  lines.push('', 'Rahmat!')
  return lines.join('\n')
}

let running = false // re-entrancy guard, same pattern as telegram.service.ts's pollOnce

export async function runAutoReminderCheck(): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 }
  if (running) return result
  running = true
  try {
    const config = getConfig()
    if (!config.enabled || !isTelegramConfigured()) return result

    const contacts = dbQuery(
      `SELECT id, sync_id, name, balance, telegram_chat_id, reminder_interval_days FROM contacts
       WHERE type IN ('customer','both') AND deleted_at IS NULL AND balance > 0 AND telegram_chat_id IS NOT NULL`
    ) as DebtorContact[]

    const now = Date.now()

    for (const contact of contacts) {
      let body = ''
      try {
        // A contact's own override wins when set; otherwise fall back to
        // the global Settings interval.
        const days = contact.reminder_interval_days && contact.reminder_interval_days > 0
          ? contact.reminder_interval_days
          : config.intervalDays
        const intervalMs = days * 24 * 60 * 60 * 1000
        const lastRows = dbQuery(
          `SELECT MAX(created_at) as last FROM message_log WHERE contact_id=? AND channel='telegram'`,
          [contact.id]
        ) as Array<{ last: string | null }>
        const last = lastRows[0]?.last
        if (last && now - new Date(last).getTime() < intervalMs) {
          result.skipped++
          continue
        }
        body = buildReminderMessage(contact)
        await sendTelegramMessage(contact.telegram_chat_id as string, body)
        dbExec(
          `INSERT INTO message_log (contact_id, channel, body, status, error, created_at, trigger) VALUES (?,?,?,?,?,?,?)`,
          [contact.id, 'telegram', body, 'sent', null, new Date().toISOString(), 'auto']
        )
        result.sent++
      } catch (err) {
        result.failed++
        dbExec(
          `INSERT INTO message_log (contact_id, channel, body, status, error, created_at, trigger) VALUES (?,?,?,?,?,?,?)`,
          [contact.id, 'telegram', body, 'failed', err instanceof Error ? err.message : 'Unknown error', new Date().toISOString(), 'auto']
        )
        logger.warn(`Auto reminder failed for contact ${contact.id}`, err)
      }
    }
  } finally {
    running = false
  }
  return result
}

let timer: ReturnType<typeof setInterval> | null = null
// Hourly is coarser than most sensible intervalDays values, but the check
// itself is cheap (a handful of local queries) and the interval-days gate
// above is what actually controls send cadence — this just needs to run
// often enough that a due reminder doesn't wait long past its interval.
const CHECK_INTERVAL_MS = 60 * 60 * 1000

export function startAutoReminderScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    runAutoReminderCheck().catch((err) => logger.warn('Auto reminder check failed', err))
  }, CHECK_INTERVAL_MS)
}

export function stopAutoReminderScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}
