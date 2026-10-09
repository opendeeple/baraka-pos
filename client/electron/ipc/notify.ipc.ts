import { ipcMain } from 'electron'
import { notifyDebtSale } from '../services/debtNotify.service'
import { runCreditorReminderCheck } from '../services/creditorReminder.service'

// Training-mode sales are practice runs — never message a real customer.
export function registerNotifyIpc(isTraining = false) {
  ipcMain.handle('notify:debtSale', async (_e, saleSyncId: string) => {
    if (isTraining) return { status: 'skipped', reason: 'training' }
    return notifyDebtSale(saleSyncId)
  })

  ipcMain.handle('notify:creditors', async () => {
    if (isTraining) return { notified: 0, sms: 'skipped' }
    return runCreditorReminderCheck()
  })
}
