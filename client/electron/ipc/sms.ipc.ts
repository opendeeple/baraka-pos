import { ipcMain } from 'electron'
import { sendSms, isSmsConfigured } from '../services/sms.service'

export function registerSmsIpc() {
  ipcMain.handle('sms:send', async (_e, phoneNumber: string, text: string) => {
    try {
      await sendSms(phoneNumber, text)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  })

  ipcMain.handle('sms:status', () => isSmsConfigured())
}
