import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { extname } from 'path'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
}

// Registered by both main.ts and main.office.ts (Products is edited from
// Office, but POS could gain the same editor later) — same pattern as
// registerFullscreenIpc in window.ipc.ts.
export function registerFilesIpc(getMainWindow: () => BrowserWindow | null) {
  // Returns the picked image as a data: URI directly — resizing/compression
  // happens in the renderer via <canvas> (Chromium has full Canvas2D there,
  // no native image-processing dependency needed on the main-process side,
  // which is exactly the class of native-module packaging risk this project
  // already spent a full session fighting for the printer/escpos deps).
  ipcMain.handle('files:pickImage', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win ?? undefined as unknown as BrowserWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'image/jpeg'
    const base64 = readFileSync(filePath).toString('base64')
    return `data:${mime};base64,${base64}`
  })
}
