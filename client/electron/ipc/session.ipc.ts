import { ipcMain, app } from 'electron'
import { randomUUID } from 'crypto'
import { dbQuery, dbExec, dbTransaction } from '../services/db.service'
import { enqueueOutbox, flushOutbox } from '../services/sync.service'

export function registerSessionIpc(isTraining = false) {
  ipcMain.handle('session:open', (_event, openingBalance: number) => {
    const now = new Date().toISOString()
    const terminalId = getTerminalId()
    const storeId = getStoreId()
    const userId = getCachedUserId()
    const syncId = randomUUID()

    // Close any open sessions for this terminal
    dbExec(
      `UPDATE pos_sessions SET state='closed', closed_at=? WHERE terminal_id=? AND state IN ('opened','opening_control')`,
      [now, terminalId]
    )

    dbExec(
      `INSERT INTO pos_sessions (sync_id, store_id, terminal_id, user_id, state, opening_balance, opened_at, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, 'opened', ?, ?, ?, ?, 'pending')`,
      [syncId, storeId, terminalId, userId, openingBalance, now, now, now]
    )
    enqueueOutbox('pos_sessions', syncId, 'upsert')
    flushOutbox().catch(() => {})

    const session = dbQuery(
      `SELECT * FROM pos_sessions WHERE terminal_id=? AND state='opened' ORDER BY id DESC LIMIT 1`,
      [terminalId]
    )
    return session[0]
  })

  ipcMain.handle('session:close', (_event, closingData: { sessionId: number; closingBalanceActual: number }) => {
    const now = new Date().toISOString()
    const session = dbQuery(
      `SELECT * FROM pos_sessions WHERE id=?`,
      [closingData.sessionId]
    )[0] as { id: number; opening_balance: number }

    // Expected cash = opening + cash sales − cash refunds ± drawer movements
    const cashRow = dbQuery(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payment_transactions WHERE session_id=? AND payment_method='Cash' AND transaction_type IN ('sale','return')`,
      [closingData.sessionId]
    )[0] as { total: number }
    const movementRow = dbQuery(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='cash_in' THEN amount ELSE -amount END), 0) as total
       FROM cash_logs WHERE session_id=? AND source IN ('deposit','withdrawal')`,
      [closingData.sessionId]
    )[0] as { total: number }

    const theoretical = Number(session.opening_balance) + Number(cashRow.total) + Number(movementRow.total)
    const variance = closingData.closingBalanceActual - theoretical

    dbExec(
      `UPDATE pos_sessions SET state='closed', closing_balance_theoretical=?, closing_balance_actual=?, variance=?, closed_at=?, updated_at=?, sync_status='pending' WHERE id=?`,
      [theoretical, closingData.closingBalanceActual, variance, now, now, closingData.sessionId]
    )
    const closed = dbQuery(`SELECT * FROM pos_sessions WHERE id=?`, [closingData.sessionId])[0] as {
      sync_id?: string
    }
    if (closed?.sync_id) {
      enqueueOutbox('pos_sessions', closed.sync_id, 'upsert')
      flushOutbox().catch(() => {})
    }
    return closed
  })

  ipcMain.handle('session:current', () => {
    const terminalId = getTerminalId()
    const result = dbQuery(
      `SELECT * FROM pos_sessions WHERE terminal_id=? AND state IN ('opened','opening_control') ORDER BY id DESC LIMIT 1`,
      [terminalId]
    )
    return result[0] ?? null
  })

  ipcMain.handle('app:isTraining', () => isTraining)
  ipcMain.handle('app:getVersion', () => app.getVersion())
}

function getTerminalId(): string {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='terminal_id' LIMIT 1`, [])
  return (rows[0] as { meta_value: string })?.meta_value ?? 'TERMINAL-001'
}

function getStoreId(): number {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='store_id' LIMIT 1`, [])
  return Number((rows[0] as { meta_value: string })?.meta_value ?? 1)
}

// Sessions record the SERVER user id of the logged-in cashier (the same id the
// login response returned); the sync layer resolves it to a userSyncId on push.
function getCachedUserId(): number {
  const rows = dbQuery(`SELECT meta_value FROM settings WHERE meta_key='cached_user' LIMIT 1`, [])
  try {
    const user = JSON.parse((rows[0] as { meta_value: string })?.meta_value ?? '')
    return Number(user?.id) || 1
  } catch {
    return 1
  }
}
