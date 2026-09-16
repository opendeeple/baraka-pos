import { ipcMain } from 'electron';
import { dbQuery, dbExec, dbTransaction } from '../services/db.service';
export function registerDatabaseIpc() {
    ipcMain.handle('db:query', (_event, sql, params) => {
        return dbQuery(sql, params);
    });
    ipcMain.handle('db:exec', (_event, sql, params) => {
        return dbExec(sql, params);
    });
    ipcMain.handle('db:transaction', (_event, ops) => {
        return dbTransaction(ops);
    });
}
