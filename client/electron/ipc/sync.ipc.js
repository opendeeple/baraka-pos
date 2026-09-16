import { ipcMain } from 'electron';
import { pullTableV2, flushOutbox, getSyncStatus, ensureDeviceRegistered, isDeviceRegistered, nextInvoiceNumber, backfillOutboxOnce, retryDeadLetters, enqueueOutbox, } from '../services/sync.service';
export function registerSyncIpc(platform = 'electron-pos') {
    ipcMain.handle('sync:pushPending', async () => {
        return flushOutbox();
    });
    ipcMain.handle('sync:pullLatest', async (_event, table) => {
        return pullTableV2(table);
    });
    ipcMain.handle('sync:getStatus', () => {
        return getSyncStatus();
    });
    // Called after a successful online login: registers this device with the
    // server (needs a manager/admin JWT the first time) and enqueues any
    // pre-v2 local rows for push.
    ipcMain.handle('sync:ensureDevice', async (_event, jwtToken) => {
        const result = await ensureDeviceRegistered(jwtToken, platform);
        if (result.registered)
            backfillOutboxOnce();
        return result;
    });
    ipcMain.handle('sync:isDeviceRegistered', () => {
        return isDeviceRegistered();
    });
    // Next invoice number from the server-leased range; null when no range is
    // available (caller falls back to a local placeholder).
    ipcMain.handle('sync:nextInvoiceNumber', () => {
        return nextInvoiceNumber();
    });
    ipcMain.handle('sync:enqueue', (_event, table, syncId, op) => {
        enqueueOutbox(table, syncId, op);
    });
    ipcMain.handle('sync:retryDead', () => {
        return retryDeadLetters();
    });
}
