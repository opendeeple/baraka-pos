import { app, BrowserWindow, shell, ipcMain, screen, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase } from './services/db.service'
import { logger } from './services/logger.service'
import { initAutoUpdater } from './services/updater.service'
import { registerDatabaseIpc } from './ipc/database.ipc'
import { registerPrinterIpc } from './ipc/printer.ipc'
import { registerSessionIpc } from './ipc/session.ipc'
import { registerSyncIpc } from './ipc/sync.ipc'
import { registerWindowIpc, hideAllMiniapps } from './ipc/window.ipc'
import { registerBarcodeIpc } from './ipc/barcode.ipc'
import { registerAuthIpc } from './ipc/auth.ipc'

const isTraining = process.argv.includes('--training')

let mainWindow: BrowserWindow | null = null
let customerWindow: BrowserWindow | null = null

// Catch unhandled exceptions and write to log
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in main process', err)
})

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: isTraining ? 'BarakaPOS [TRAINING MODE]' : 'BarakaPOS',
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: !is.dev, // allow cross-origin fetch in dev (Vite→Express)
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (is.dev) mainWindow!.webContents.openDevTools({ mode: 'detach' })
    logger.info('Main window ready', { training: isTraining, version: app.getVersion() })
  })

  // When renderer reloads (Cmd+R in dev, or renderer crash recovery),
  // hide any WebContentsViews — React state is reset so they'd be orphaned.
  mainWindow.webContents.on('did-finish-load', hideAllMiniapps)

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    logger.error('Renderer failed to load', { errorCode, errorDescription })
  })

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    hideAllMiniapps()
    logger.error('Renderer process gone', details)
    dialog.showErrorBox('BarakaPOS crashed', 'The application encountered an error. Please restart.\n\nLogs: ' + logger.getLogPath())
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

export function createCustomerWindow(): BrowserWindow {
  const displays = screen.getAllDisplays()
  const secondary = displays.find((d) => d.id !== screen.getPrimaryDisplay().id)
  const bounds = secondary ? secondary.bounds : { x: 100, y: 100, width: 800, height: 600 }

  customerWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    kiosk: !!secondary,
    title: 'Customer Display',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  const url = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}#/customer-display`
    : `file://${join(__dirname, '../renderer/index.html')}#/customer-display`

  customerWindow.loadURL(url)
  customerWindow.on('closed', () => { customerWindow = null })

  return customerWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.baraka.pos')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  logger.info('App starting', { version: app.getVersion(), training: isTraining })

  try {
    await initDatabase(isTraining)
  } catch (err) {
    logger.error('Database init failed', err)
    dialog.showErrorBox('Database Error', 'Failed to initialize the database. Please reinstall the app.\n\n' + String(err))
    app.quit()
    return
  }

  // Register all IPC handlers
  registerDatabaseIpc()
  registerPrinterIpc()
  registerSessionIpc(isTraining)
  registerSyncIpc('electron-pos')
  registerWindowIpc(createCustomerWindow, () => customerWindow)
  registerBarcodeIpc(mainWindow)
  registerAuthIpc()

  // App-level IPC (getVersion and isTraining are in session.ipc.ts — only add extras here)
  ipcMain.handle('app:getLogPath', () => logger.getLogPath())
  ipcMain.handle('app:openLogs', () => shell.showItemInFolder(logger.getLogPath()))
  ipcMain.handle('app:reload', () => mainWindow?.reload())

  const win = createMainWindow()

  // Auto-updater (only in production)
  if (!is.dev) {
    initAutoUpdater(win)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  logger.info('All windows closed, quitting')
  logger.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  hideAllMiniapps()
  logger.close()
})

export { mainWindow, customerWindow, isTraining }
