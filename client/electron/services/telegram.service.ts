import { dbQuery, dbExec } from './db.service'
import { logger } from './logger.service'

interface TelegramConfig {
  botToken: string
  botUsername: string
}

function getConfig(): TelegramConfig | null {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='telegram_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return null
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<TelegramConfig>
    if (!parsed.botToken) return null
    return { botToken: parsed.botToken, botUsername: parsed.botUsername ?? '' }
  } catch {
    return null
  }
}

export function isTelegramConfigured(): boolean {
  const c = getConfig()
  return Boolean(c?.botToken && c?.botUsername)
}

/** The one-time link a customer taps to start the bot — this app then learns
 *  their chat_id via the polling loop below when they hit /start. */
export function getTelegramDeepLink(contactSyncId: string): string | null {
  const c = getConfig()
  if (!c?.botUsername) return null
  return `https://t.me/${c.botUsername}?start=${contactSyncId}`
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const c = getConfig()
  if (!c?.botToken) throw new Error('Telegram bot token not configured')
  const res = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(data.description || 'Telegram send failed')
}

// ─── Polling ────────────────────────────────────────────────────────────────
// Runs entirely client-side (no server deploy needed): short-polls
// getUpdates every few seconds, looking for a /start <contactSyncId> from a
// customer who tapped their deep link, and records the resulting chat_id
// locally. Telegram bots can use either this OR a webhook, never both —
// don't register a webhook for this bot while this is running.

let pollOffset = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let polling = false // re-entrancy guard, same pattern as useSync.ts's inFlightRef

async function pollOnce(): Promise<void> {
  if (polling) return
  const c = getConfig()
  if (!c?.botToken) return
  polling = true
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${c.botToken}/getUpdates?offset=${pollOffset + 1}&timeout=0`
    )
    const data = await res.json() as { ok: boolean; result?: Array<{ update_id: number; message?: { text?: string; chat?: { id: number } } }> }
    if (!data.ok || !data.result) return
    for (const update of data.result) {
      pollOffset = Math.max(pollOffset, update.update_id)
      const text = update.message?.text
      const chatId = update.message?.chat?.id
      if (text?.startsWith('/start ') && chatId) {
        const contactSyncId = text.slice('/start '.length).trim()
        dbExec(`UPDATE contacts SET telegram_chat_id=? WHERE sync_id=?`, [String(chatId), contactSyncId])
      }
    }
  } catch (err) {
    // Transient network hiccup — the next tick retries, same tolerance as
    // the rest of this app's polling loops (sync interval, etc.).
    logger.warn('Telegram poll failed', err)
  } finally {
    polling = false
  }
}

export function startTelegramPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => { pollOnce() }, 4000)
}

export function stopTelegramPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
