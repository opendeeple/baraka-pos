import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'
import { logger } from './logger.service'

export function initAutoUpdater(win: BrowserWindow): void {
  autoUpdater.logger = {
    info: (msg: string) => logger.info('[updater] ' + msg),
    warn: (msg: string) => logger.warn('[updater] ' + msg),
    error: (msg: string) => logger.error('[updater] ' + msg),
    debug: () => {},
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:update-available', info)
    logger.info('Update available', info)
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('App is up to date')
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:download-progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('updater:update-downloaded', info)
    logger.info('Update downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error', err)
    win.webContents.send('updater:error', { message: err.message })
  })

  // IPC handlers
  ipcMain.handle('updater:check', async () => {
    try {
      return await autoUpdater.checkForUpdates()
    } catch (err) {
      logger.error('Manual update check failed', err)
      return null
    }
  })

  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())

  // Check for updates after 10s (give app time to start)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)
}
