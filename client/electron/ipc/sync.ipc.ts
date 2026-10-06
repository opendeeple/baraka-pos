import { ipcMain } from 'electron'
import {
  pullTableV2,
  flushOutbox,
  getSyncStatus,
  setTerminalToken,
  hasTerminalToken,
  nextInvoiceNumber,
  backfillOutboxOnce,
  retryDeadLetters,
  refreshFromServer,
  enqueueOutbox,
  startOutboxLoop,
  setSyncApp,
} from '../services/sync.service'

export function registerSyncIpc(app: 'pos' | 'office' = 'pos') {
  setSyncApp(app)
  startOutboxLoop()

  ipcMain.handle('sync:pushPending', async () => {
    return flushOutbox()
  })

  ipcMain.handle('sync:pullLatest', async (_event, table: string) => {
    return pullTableV2(table)
  })

  ipcMain.handle('sync:getStatus', () => {
    return getSyncStatus()
  })

  // Called after a successful online password sign-in: that user's token
  // becomes the one this app syncs with (and, on the POS, the one badge
  // sign-in uses), and any pre-v2 local rows are enqueued for push.
  ipcMain.handle('sync:setTerminalToken', async (_event, token: string, role: string) => {
    await setTerminalToken(token, role)
    backfillOutboxOnce()
  })

  ipcMain.handle('sync:hasTerminalToken', () => {
    return hasTerminalToken()
  })

  // Next invoice number from the server-leased range; null when no range is
  // available (caller falls back to a local placeholder).
  ipcMain.handle('sync:nextInvoiceNumber', () => {
    return nextInvoiceNumber()
  })

  ipcMain.handle('sync:enqueue', (_event, table: string, syncId: string, op: 'upsert' | 'delete') => {
    enqueueOutbox(table, syncId, op)
  })

  ipcMain.handle('sync:retryDead', () => {
    return retryDeadLetters()
  })

  ipcMain.handle('sync:refreshFromServer', () => {
    return refreshFromServer()
  })
}
