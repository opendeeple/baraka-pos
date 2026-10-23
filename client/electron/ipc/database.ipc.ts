import { ipcMain, dialog, BrowserWindow } from 'electron'
import { dbQuery, dbExec, dbTransaction, backupDatabaseTo } from '../services/db.service'

export function registerDatabaseIpc(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('db:query', (_event, sql: string, params: unknown[]) => {
    return dbQuery(sql, params)
  })

  ipcMain.handle('db:exec', (_event, sql: string, params: unknown[]) => {
    return dbExec(sql, params)
  })

  ipcMain.handle(
    'db:transaction',
    (_event, ops: Array<{ sql: string; params: unknown[] }>) => {
      return dbTransaction(ops)
    }
  )

  // A manual copy the owner can point anywhere they like (a USB drive, a
  // folder synced to the cloud) — on top of, not instead of, the automatic
  // daily snapshot in db.service.ts, since that one never leaves this PC.
  ipcMain.handle('db:exportBackup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const defaultName = `baraka-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`
    const result = await dialog.showSaveDialog(win as never, {
      defaultPath: defaultName,
      filters: [{ name: 'Baraka POS backup', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      backupDatabaseTo(result.filePath)
      return { success: true, path: result.filePath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Backup failed' }
    }
  })
}
