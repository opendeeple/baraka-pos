import { env } from '../../config/env'

/** Sends a plain-text message to a chat that has already messaged the bot —
 *  the Bot API rejects sends to a chat_id it hasn't seen a message from. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token not configured')
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(data.description || 'Telegram send failed')
}

/** The one-time link a customer taps to start the bot — Telegram then POSTs
 *  the resulting /start payload to our webhook, which is how we learn their
 *  chat_id (see notifications.service.ts's handleTelegramWebhook). Returns
 *  null when no bot is configured, so callers can hide the "connect
 *  Telegram" UI instead of showing a broken link. */
export function getTelegramDeepLink(contactSyncId: string): string | null {
  if (!env.TELEGRAM_BOT_USERNAME) return null
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${contactSyncId}`
}

export function isTelegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME)
}
