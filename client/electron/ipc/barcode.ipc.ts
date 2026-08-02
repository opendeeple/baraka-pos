import { ipcMain, BrowserWindow } from 'electron'

export function registerBarcodeIpc(mainWindow: BrowserWindow | null) {
  // Barcode scanners present as HID keyboard devices.
  // They send characters rapidly then a carriage return.
  // We listen for the 'input-event' from the renderer's keydown listener instead.
  ipcMain.handle('barcode:manualScan', (_event, barcode: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('barcode:scan', barcode)
    }
    return { success: true }
  })
}
