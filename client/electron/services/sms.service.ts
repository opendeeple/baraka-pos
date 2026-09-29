import { dbQuery } from './db.service'

// SMS via a dedicated Android phone running "SMS Gateway for Android"
// (sms-gate.app) — the phone exposes a local HTTP API (Basic Auth) that
// relays a text through its own SIM. host/username/password are entered in
// Settings and read from the same 'settings' table pattern as
// telegram_config/printer_config. The exact endpoint/payload shape matches
// sms-gate.app's documented API as of this writing; if the phone app's API
// differs, this is the one place to adjust it.

interface SmsConfig {
  host: string
  username: string
  password: string
}

function getConfig(): SmsConfig | null {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='sms_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return null
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<SmsConfig>
    if (!parsed.host) return null
    return { host: parsed.host, username: parsed.username ?? '', password: parsed.password ?? '' }
  } catch {
    return null
  }
}

export function isSmsConfigured(): boolean {
  const c = getConfig()
  return Boolean(c?.host)
}

export async function sendSms(phoneNumber: string, text: string): Promise<void> {
  const c = getConfig()
  if (!c?.host) throw new Error('SMS gateway not configured')
  const base = c.host.trim().replace(/\/+$/, '')
  const url = /^https?:\/\//i.test(base) ? `${base}/message` : `http://${base}/message`
  const auth = Buffer.from(`${c.username}:${c.password}`).toString('base64')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phoneNumber] }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SMS gateway ${res.status}: ${body || res.statusText}`)
  }
}
