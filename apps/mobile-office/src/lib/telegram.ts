import { getServices } from '../platform/services'

// Debt reminders and purchase-history messages over Telegram, sent straight
// from this device — mirrors desktop's electron/services/telegram.service.ts
// + components/backoffice/SendMessageModal.tsx. The bot token
// (telegram_config, store-wide, synced) and a contact's telegram_chat_id
// (learnt once a customer taps the bot's /start link — also synced, see
// contact.repo.ts) both already reach this device through the normal
// settings/contacts pull; only SENDING was missing. The /start deep-link
// flow itself stays desktop-only — this only messages an already-connected
// contact.

interface TelegramConfig {
  botToken: string
  botUsername?: string
}

function getConfig(): TelegramConfig | null {
  const { repos } = getServices()
  const raw = repos.settings.getJson<Partial<TelegramConfig>>('telegram_config')
  if (!raw?.botToken) return null
  return { botToken: raw.botToken, botUsername: raw.botUsername }
}

export function telegramConfigured(): boolean {
  return getConfig() !== null
}

// Same plain thousand-comma format desktop's message templates use (not
// mobile's own fmtUZS, which adds .00 decimals) — this text goes to the
// customer, so it should read exactly like the desktop-sent version.
const money = (n: number) => Math.round(n).toLocaleString('en-US')

export function buildDebtMessage(contactId: number, storeName: string): string {
  const { repos } = getServices()
  const contact = repos.contacts.byId(contactId)
  if (!contact) return ''
  return [
    `Assalomu alaykum, ${contact.name}!`, '',
    `${storeName} do'konidan sizda UZS ${money(contact.balance)} miqdorida qarz mavjud.`,
    `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`, '',
    `Rahmat!`,
  ].join('\n')
}

export function buildHistoryMessage(contactId: number): string {
  const { repos } = getServices()
  const contact = repos.contacts.byId(contactId)
  if (!contact) return ''
  const sales = repos.sales.history({ contactId, limit: 10 })
  const payments = repos.contacts.repayments(contactId, 10)

  const lines = [`${contact.name} - xarid va to'lov tarixi`, '']
  for (const sale of sales) {
    const items = repos.sales.items(sale.id)
    lines.push(`${String(sale.saleTime).slice(0, 10)} - ${sale.invoiceNumber} - UZS ${money(sale.totalAmount)}`)
    // unitPrice is the price recorded at sale time, not the product's
    // current price — keeps old messages accurate after price changes.
    for (const item of items) lines.push(`  - ${item.description} x${item.quantity} - UZS ${money(item.unitPrice)}`)
  }
  if (sales.length === 0) lines.push('Xaridlar topilmadi.')

  if (payments.length > 0) {
    lines.push('', "To'lovlar:")
    for (const p of payments) lines.push(`${p.createdAt.slice(0, 10)} - UZS ${money(p.amount)}`)
  }
  if (contact.balance > 0) lines.push('', `Qolgan qarz: UZS ${money(contact.balance)}`)
  return lines.join('\n')
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<{ success: boolean; error?: string }> {
  const config = getConfig()
  if (!config) return { success: false, error: 'Telegram bot token not configured' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) return { success: false, error: data.description || 'Telegram send failed' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
