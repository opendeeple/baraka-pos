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

// Uzbek + Russian Cyrillic → Uzbek Latin (official 1995 alphabet, ASCII
// apostrophe for o'/g').
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
}

const PUNCTUATION: Record<string, string> = {
  '‘': "'", '’': "'", 'ʻ': "'", 'ʼ': "'", '`': "'", '´': "'",
  '“': '"', '”': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '−': '-', '•': '-', '·': '-',
  '…': '...', '×': 'x', '№': 'N', ' ': ' ',
}

/**
 * Reduces text to plain printable ASCII before it goes out as an SMS. Anything
 * outside the GSM 7-bit alphabet (em dashes, bullets, curly apostrophes,
 * Cyrillic, emoji) arrived on customers' phones as garbage characters, and it
 * also forces UCS-2 encoding — 70 chars per SMS part instead of 160.
 */
export function toSmsText(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    if (CYRILLIC[lower] !== undefined) {
      const latin = CYRILLIC[lower]
      out += ch !== lower && latin ? latin[0].toUpperCase() + latin.slice(1) : latin
    } else if (PUNCTUATION[ch] !== undefined) {
      out += PUNCTUATION[ch]
    } else {
      out += ch
    }
  }
  return out
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // é → e
    .replace(/[^\n\x20-\x7E]/g, '')
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
      'Content-Type': 'application/json; charset=utf-8',
      ...(c.token ? { Authorization: c.token } : {}),
    },
    body: JSON.stringify({ to: phoneNumber, message: toSmsText(text) }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SMS gateway ${res.status}: ${body || res.statusText}`)
  }
}
