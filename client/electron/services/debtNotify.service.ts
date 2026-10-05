import { dbQuery, dbExec } from './db.service'
import { logger } from './logger.service'
import { sendTelegramMessage, isTelegramConfigured } from './telegram.service'
import { sendSms, isSmsConfigured, toSmsText } from './sms.service'

// Instant "you just took this on credit" message, sent right after a sale
// with a Debt payment is committed (PaymentScreen → notify:debtSale). Unlike
// autoReminder.service.ts (periodic, Telegram-only) this fires once per sale
// and falls back to SMS when the contact never connected Telegram.

interface DebtNotifyConfig {
  enabled: boolean
}

// On unless turned off in Settings — the owner asked for this to happen
// automatically, so a fresh install shouldn't need an extra toggle first.
const DEFAULT_CONFIG: DebtNotifyConfig = { enabled: true }

function getConfig(): DebtNotifyConfig {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='debt_sale_notify_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return DEFAULT_CONFIG
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<DebtNotifyConfig>
    return { enabled: parsed.enabled !== false }
  } catch {
    return DEFAULT_CONFIG
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

// Keeps a big basket from turning into a 10-part SMS; the totals below the
// list still carry the full amounts.
const MAX_ITEM_LINES = 10

export type DebtNotifyResult =
  | { status: 'sent'; channel: 'telegram' | 'sms' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; channel: 'telegram' | 'sms'; error: string }

export async function notifyDebtSale(saleSyncId: string): Promise<DebtNotifyResult> {
  if (!getConfig().enabled) return { status: 'skipped', reason: 'disabled' }

  const sale = (dbQuery(
    `SELECT id, contact_id, total_amount FROM sales WHERE sync_id=? LIMIT 1`, [saleSyncId]
  ) as Array<{ id: number; contact_id: number | null; total_amount: number }>)[0]
  if (!sale?.contact_id) return { status: 'skipped', reason: 'no contact' }

  const debtRow = (dbQuery(
    `SELECT COALESCE(SUM(amount), 0) as amount FROM payment_transactions WHERE sale_id=? AND payment_method='Debt'`,
    [sale.id]
  ) as Array<{ amount: number }>)[0]
  const debtAmount = Number(debtRow?.amount ?? 0)
  if (debtAmount <= 0) return { status: 'skipped', reason: 'no debt' }

  const contact = (dbQuery(
    `SELECT id, name, phone, balance, telegram_chat_id FROM contacts WHERE id=? LIMIT 1`, [sale.contact_id]
  ) as Array<{ id: number; name: string; phone: string | null; balance: number; telegram_chat_id: string | null }>)[0]
  if (!contact) return { status: 'skipped', reason: 'contact not found' }

  // Telegram first (free, no SIM credit); SMS only for contacts who never
  // tapped the /start link.
  let channel: 'telegram' | 'sms'
  if (contact.telegram_chat_id && isTelegramConfigured()) channel = 'telegram'
  else if (contact.phone && isSmsConfigured()) channel = 'sms'
  else return { status: 'skipped', reason: 'no channel' }

  const items = dbQuery(
    `SELECT description, quantity, unit_price, discount FROM sale_items WHERE sale_id=? ORDER BY id`, [sale.id]
  ) as Array<{ description: string; quantity: number; unit_price: number; discount: number }>
  const storeName = (dbQuery(`SELECT name FROM stores LIMIT 1`) as Array<{ name: string }>)[0]?.name ?? ''

  const lines = [
    `Assalomu alaykum, ${contact.name}!`, '',
    `${storeName} do'konidan qarzga olgan narsalaringiz:`,
  ]
  for (const item of items.slice(0, MAX_ITEM_LINES)) {
    // Same line total as the cart: unit price × qty, less the per-item % discount.
    const lineTotal = Number(item.unit_price) * Number(item.quantity) * (1 - Number(item.discount || 0) / 100)
    lines.push(`- ${item.description} x${Number(item.quantity)} - UZS ${fmt(lineTotal)}`)
  }
  if (items.length > MAX_ITEM_LINES) lines.push(`... va yana ${items.length - MAX_ITEM_LINES} ta mahsulot`)
  lines.push('')
  if (debtAmount < Number(sale.total_amount)) lines.push(`Xarid summasi: UZS ${fmt(Number(sale.total_amount))}`)
  lines.push(
    `Qarzga yozildi: UZS ${fmt(debtAmount)}`,
    `Umumiy qarzingiz: UZS ${fmt(Number(contact.balance))}`, '',
    'Rahmat!',
  )
  // Logged exactly as the customer receives it.
  const body = channel === 'sms' ? toSmsText(lines.join('\n')) : lines.join('\n')

  try {
    if (channel === 'telegram') await sendTelegramMessage(contact.telegram_chat_id as string, body)
    else await sendSms(contact.phone as string, body)
    dbExec(
      `INSERT INTO message_log (contact_id, channel, body, status, error, created_at, trigger) VALUES (?,?,?,?,?,?,?)`,
      [contact.id, channel, body, 'sent', null, new Date().toISOString(), 'debt_sale']
    )
    return { status: 'sent', channel }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    dbExec(
      `INSERT INTO message_log (contact_id, channel, body, status, error, created_at, trigger) VALUES (?,?,?,?,?,?,?)`,
      [contact.id, channel, body, 'failed', error, new Date().toISOString(), 'debt_sale']
    )
    logger.warn(`Debt-sale notification failed for contact ${contact.id}`, err)
    return { status: 'failed', channel, error }
  }
}
