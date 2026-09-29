import { ipcMain } from 'electron'
import { dbExec, dbQuery } from '../services/db.service'
import { getServerUrl } from '../services/sync.service'
import { httpRequest } from './auth.ipc'

function getSetting(key: string): string | undefined {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key=? LIMIT 1`, [key]) as Array<{ meta_value: string }>
  return rows[0]?.meta_value
}

function setSetting(key: string, value: string): void {
  dbExec(
    `INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at)
     VALUES ((SELECT COALESCE(MAX(store_id),1) FROM settings), ?, ?, ?)`,
    [key, value, new Date().toISOString()]
  )
}

// Shift calls authenticate as this terminal (the sync v2 device key), not as
// a user: the badge scan is what identifies the employee, and the server
// needs to know WHICH terminal to enforce one-cashier-per-terminal.
// Network failures and timeouts resolve to status 0 so the renderer can tell
// "offline" apart from a server-side refusal.
async function deviceRequest(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; data: unknown }> {
  const deviceId = getSetting('device_id')
  const deviceKey = getSetting('device_key')
  if (!deviceId || !deviceKey) return { status: 0, data: { code: 'DEVICE_NOT_REGISTERED' } }
  const payload = JSON.stringify(body)
  try {
    return await httpRequest(`${getServerUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Device ${deviceId}:${deviceKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload, timeoutMs)
  } catch (err) {
    return { status: 0, data: { code: 'NETWORK', error: err instanceof Error ? err.message : 'network error' } }
  }
}

// A badge scan waits out a Render free-tier cold start (~50s) — the cashier is
// looking at "Checking…" anyway. Heartbeats and queued shift ends run in the
// background and the heartbeat also gates app start-up, so they give up
// quickly and count as offline (they're retried a minute later).
const START_TIMEOUT_MS = 90_000
const BACKGROUND_TIMEOUT_MS = 20_000
const FLUSH_INTERVAL_MS = 60_000

// --- "End shift" pressed while offline -------------------------------------
// The server never ends a shift by itself, so an end it didn't hear about
// would leave the cashier's shift running (and locked to this terminal)
// forever. Ends are therefore queued locally with the time of the press and
// delivered once the server is reachable.

const PENDING_ENDS_KEY = 'pending_shift_ends'

interface PendingEnd {
  shiftId: number
  endedAt: string
}

function readPendingEnds(): PendingEnd[] {
  try { return JSON.parse(getSetting(PENDING_ENDS_KEY) ?? '[]') as PendingEnd[] } catch { return [] }
}

function writePendingEnds(ends: PendingEnd[]): void {
  if (ends.length) setSetting(PENDING_ENDS_KEY, JSON.stringify(ends))
  else dbExec(`DELETE FROM settings WHERE meta_key=?`, [PENDING_ENDS_KEY])
}

let flushing: Promise<void> | null = null

/**
 * Delivers queued ends in order; concurrent callers share one run. The queue
 * is re-read on every step so an end queued mid-run is delivered by that same
 * run — a badge scan waiting on it must not overtake it.
 */
function flushPendingEnds(): Promise<void> {
  if (!flushing) {
    flushing = (async () => {
      for (let end = readPendingEnds()[0]; end; end = readPendingEnds()[0]) {
        const res = await deviceRequest('/api/shifts/end', end, BACKGROUND_TIMEOUT_MS)
        // Offline or server trouble: keep it (and everything after it) for the next run.
        if (res.status === 0 || res.status >= 500) return
        // Delivered — or refused for good (e.g. device revoked), which retrying can't fix.
        const delivered = end
        writePendingEnds(readPendingEnds().filter((e) => e.shiftId !== delivered.shiftId))
      }
    })()
      .catch((err) => console.error('[shift] flushing queued shift ends failed:', err))
      .finally(() => { flushing = null })
  }
  return flushing
}

export function registerShiftIpc(): void {
  ipcMain.handle('shift:start', async (_e, badgeCode: string) => {
    // A shift ended here offline must reach the server first: otherwise it
    // would be closed as "replaced" at this moment instead of when it ended.
    await flushPendingEnds()
    return deviceRequest('/api/shifts/start', { badgeCode }, START_TIMEOUT_MS)
  })
  ipcMain.handle('shift:heartbeat', (_e, shiftId: number) =>
    deviceRequest('/api/shifts/heartbeat', { shiftId }, BACKGROUND_TIMEOUT_MS))
  // Returns at once: the cashier is signed out right away, online or not.
  ipcMain.handle('shift:end', (_e, shiftId: number) => {
    const ends = readPendingEnds().filter((e) => e.shiftId !== shiftId)
    writePendingEnds([...ends, { shiftId, endedAt: new Date().toISOString() }])
    void flushPendingEnds()
  })

  setInterval(() => { void flushPendingEnds() }, FLUSH_INTERVAL_MS)
}
