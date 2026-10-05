import { dbQuery, dbExec } from './db.service'
import { logger } from './logger.service'
import { sendTelegramMessage, sendTelegramDocument, isTelegramConfigured } from './telegram.service'
import { htmlToPdf } from './pdf.service'
import { documentPageHtml, fmtDate, THANKS } from './documentLayout'

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
// not every past receipt regardless of how it was paid. Below them, the
// repayments made so far and what's left — the same statement the debt
// history panel shows. Both only count rows newer than the contact's last
// cleared (deleted) debt, see debt_clearances in schema v12.
const LIST_LIMIT = 10

interface ReminderData {
  store: { name: string; address: string | null; phone: string | null }
  debtSales: Array<{ invoice_number: string; sale_date: string; amount: number }>
  repayments: Array<{ created_at: string; amount: number }>
}

function loadReminderData(contact: DebtorContact): ReminderData {
  const store = (dbQuery(`SELECT name, address, phone FROM stores LIMIT 1`) as ReminderData['store'][])[0]
    ?? { name: '', address: null, phone: null }
  const since = `COALESCE((SELECT MAX(cleared_at) FROM debt_clearances WHERE contact_id = ?), '')`
  const debtSales = dbQuery(
    `SELECT s.invoice_number, s.sale_date, SUM(pt.amount) as amount
     FROM sales s
     JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
     WHERE s.contact_id = ? AND s.status != 'cancelled' AND s.created_at > ${since}
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [contact.id, contact.id]
  ) as ReminderData['debtSales']
  // Same repayment match as client/src/lib/debt.ts REPAYMENT_FOR_CONTACT:
  // desktop 'debt_payment' rows plus 'deposit' ones pulled from other devices.
  const repayments = dbQuery(
    `SELECT created_at, amount FROM cash_logs
     WHERE transaction_type = 'cash_in' AND source IN ('debt_payment', 'deposit')
       AND (contact_id = ? OR (contact_id IS NULL AND source = 'debt_payment' AND reference_id = ?))
       AND created_at > ${since}
     ORDER BY created_at DESC`,
    [contact.id, contact.id, contact.id]
  ) as ReminderData['repayments']
  return { store, debtSales, repayments }
}

/** The statement as a PDF in the store's document layout (documentLayout.ts). */
function reminderPageHtml(contact: DebtorContact, data: ReminderData): string {
  const { debtSales, repayments } = data
  const salesTotal = debtSales.reduce((sum, s) => sum + Number(s.amount), 0)
  const paidTotal = repayments.reduce((sum, p) => sum + Number(p.amount), 0)
  const tables = [{
    title: 'Qarzga olingan xaridlar',
    columns: [{ label: '№', align: 'center' as const }, { label: 'Sana' }, { label: 'Chek №' }, { label: 'Summa', align: 'right' as const }],
    rows: debtSales.map((s, i) => [String(i + 1), fmtDate(s.sale_date), s.invoice_number, fmt(Number(s.amount))]),
    total: ['', 'Jami', '', fmt(salesTotal)],
  }]
  if (repayments.length > 0) {
    tables.push({
      title: "To'lovlar",
      columns: [{ label: '№', align: 'center' as const }, { label: 'Sana' }, { label: 'Summa', align: 'right' as const }],
      rows: repayments.map((p, i) => [String(i + 1), fmtDate(p.created_at), fmt(Number(p.amount))]),
      total: ['', 'Jami', fmt(paidTotal)],
    })
  }
  return documentPageHtml({
    storeName: data.store.name,
    storeAddress: data.store.address,
    title: `Qarzdorlik hisoboti · ${fmtDate(new Date())}`,
    info: [['Mijoz', contact.name]],
    tables,
    summary: [
      { label: 'Jami qarzga olingan', value: `UZS ${fmt(salesTotal)}` },
      ...(repayments.length > 0 ? [{ label: "Jami to'langan", value: `UZS ${fmt(paidTotal)}` }] : []),
      { label: 'Qolgan qarz', value: `UZS ${fmt(Number(contact.balance))}`, bold: true },
    ],
    phone: data.store.phone,
    thanks: THANKS,
  })
}

function buildReminderMessage(contact: DebtorContact, data: ReminderData): string {
  const { debtSales, repayments } = data
  const lines = [
    `Assalomu alaykum, ${contact.name}!`, '',
    `${data.store.name} do'konidan sizda UZS ${fmt(Number(contact.balance))} miqdorida qarz mavjud.`,
    `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`, '',
    `Qarzga olingan xaridlar:`,
  ]
  if (debtSales.length === 0) {
    lines.push("Ma'lumot topilmadi.")
  } else {
    for (const s of debtSales.slice(0, LIST_LIMIT)) lines.push(`${s.sale_date} - ${s.invoice_number} - UZS ${fmt(Number(s.amount))}`)
    if (debtSales.length > LIST_LIMIT) lines.push(`... va yana ${debtSales.length - LIST_LIMIT} ta`)
    lines.push(`Jami qarz: UZS ${fmt(debtSales.reduce((sum, s) => sum + Number(s.amount), 0))}`)
  }

  if (repayments.length > 0) {
    lines.push('', "To'lovlar:")
    for (const p of repayments.slice(0, LIST_LIMIT)) lines.push(`${p.created_at.slice(0, 10)} - UZS ${fmt(Number(p.amount))}`)
    if (repayments.length > LIST_LIMIT) lines.push(`... va yana ${repayments.length - LIST_LIMIT} ta`)
    lines.push(`Jami to'langan: UZS ${fmt(repayments.reduce((sum, p) => sum + Number(p.amount), 0))}`)
  }

  lines.push('', `Qolgan qarz: UZS ${fmt(Number(contact.balance))}`, '', 'Rahmat!')
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
        const data = loadReminderData(contact)
        body = buildReminderMessage(contact, data)
        const caption = [
          `Assalomu alaykum, ${contact.name}!`,
          `${data.store.name} do'konidan sizda UZS ${fmt(Number(contact.balance))} miqdorida qarz mavjud.`,
          `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`,
          'Batafsil hisobot ilova qilingan hujjatda.',
        ].join('\n')
        const fileName = `Qarzdorlik-${new Date().toISOString().slice(0, 10)}.pdf`
        try {
          const pdf = await htmlToPdf(reminderPageHtml(contact, data))
          await sendTelegramDocument(contact.telegram_chat_id as string, pdf, fileName, caption)
          body = `${caption}\n[PDF: ${fileName}]`
        } catch (pdfErr) {
          // The reminder still goes out — as the plain-text statement.
          logger.warn(`Reminder PDF failed for contact ${contact.id}, sending text`, pdfErr)
          await sendTelegramMessage(contact.telegram_chat_id as string, body)
        }
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
