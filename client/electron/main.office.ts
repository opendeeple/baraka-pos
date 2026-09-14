import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase } from './services/db.service'
import { logger } from './services/logger.service'
import { initAutoUpdater } from './services/updater.service'
import { registerDatabaseIpc } from './ipc/database.ipc'
import { registerPrinterIpc } from './ipc/printer.ipc'
import { registerSessionIpc } from './ipc/session.ipc'
import { registerSyncIpc } from './ipc/sync.ipc'
import { registerAuthIpc } from './ipc/auth.ipc'
import { registerReportsIpc } from './ipc/reports.ipc'

// Deliberately the SAME name as main.ts: for now POS and Office are meant to
// share one local SQLite replica on a single machine (so data added in one
// shows up in the other immediately, without round-tripping through the
// server). Must run before userData is first touched (initDatabase, logger,
// settings) — package.json's "name" alone resolves inconsistently depending
// on how the app is launched.
app.setName('baraka-pos')

let mainWindow: BrowserWindow | null = null

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in office main process', err)
})

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'BarakaPOS Office',
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: !is.dev,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (is.dev) mainWindow!.webContents.openDevTools({ mode: 'detach' })
    logger.info('Office window ready', { version: app.getVersion() })
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    logger.error('Office renderer failed to load', { errorCode, errorDescription })
  })

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    logger.error('Office renderer process gone', details)
    dialog.showErrorBox('BarakaPOS Office crashed', 'The application encountered an error. Please restart.\n\nLogs: ' + logger.getLogPath())
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.baraka.office')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  logger.info('Office app starting', { version: app.getVersion() })

  try {
    await initDatabase(false)
  } catch (err) {
    logger.error('Database init failed', err)
    dialog.showErrorBox('Database Error', 'Failed to initialize the database. Please reinstall the app.\n\n' + String(err))
    app.quit()
    return
  }

  registerDatabaseIpc()
  registerPrinterIpc()
  registerSessionIpc()
  registerSyncIpc('electron-office')
  registerAuthIpc()
  registerReportsIpc()

  ipcMain.handle('app:getLogPath', () => logger.getLogPath())
  ipcMain.handle('app:openLogs', () => shell.showItemInFolder(logger.getLogPath()))
  ipcMain.handle('app:reload', () => mainWindow?.reload())

  const win = createMainWindow()

  if (!is.dev) {
    initAutoUpdater(win)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  logger.info('Office: all windows closed, quitting')
  logger.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  logger.close()
})

export { mainWindow }
