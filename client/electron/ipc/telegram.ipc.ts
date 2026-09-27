import { ipcMain } from 'electron'
import { sendTelegramMessage, getTelegramDeepLink, isTelegramConfigured } from '../services/telegram.service'
import { runAutoReminderCheck } from '../services/autoReminder.service'

export function registerTelegramIpc() {
  ipcMain.handle('telegram:send', async (_e, chatId: string, text: string) => {
    try {
      await sendTelegramMessage(chatId, text)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  })

  ipcMain.handle('telegram:getDeepLink', (_e, contactSyncId: string) => getTelegramDeepLink(contactSyncId))
  ipcMain.handle('telegram:status', () => isTelegramConfigured())
  ipcMain.handle('telegram:runAutoReminders', () => runAutoReminderCheck())
}
