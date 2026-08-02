import { ipcMain } from 'electron'
import { dbQuery, dbExec, dbTransaction } from '../services/db.service'

export function registerDatabaseIpc() {
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
}
