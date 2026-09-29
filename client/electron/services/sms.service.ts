import { dbQuery } from './db.service'

// SMS via a dedicated Android phone running "Traccar SMS Gateway" (by Anton
// Tananaev, github.com/traccar/traccar-sms-gateway) — its "Local Service"
// exposes a token-authenticated HTTP endpoint on the phone's own network
// (shown in-app as "Endpoints"), relaying a text through the phone's SIM.
// host/token are entered in Settings and read from the same 'settings'
// table pattern as telegram_config/printer_config.
//
// Confirmed request shape (per traccar.org's HTTP SMS API docs and forum
// posts describing this exact app): POST to the endpoint root, body
// {"to": "<phone>", "message": "<text>"}, and the Authorization header
// carries the raw token with NO "Bearer " prefix.

interface SmsConfig {
  host: string
  token: string
}

function getConfig(): SmsConfig | null {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='sms_config' LIMIT 1`) as Array<{ meta_value: string }>
  if (!rows.length) return null
  try {
    const parsed = JSON.parse(rows[0].meta_value) as Partial<SmsConfig>
    if (!parsed.host) return null
    return { host: parsed.host, token: parsed.token ?? '' }
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
  const url = /^https?:\/\//i.test(base) ? base : `http://${base}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(c.token ? { Authorization: c.token } : {}),
    },
    body: JSON.stringify({ to: phoneNumber, message: text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SMS gateway ${res.status}: ${body || res.statusText}`)
  }
}
