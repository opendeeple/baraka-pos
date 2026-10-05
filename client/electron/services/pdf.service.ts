import { BrowserWindow } from 'electron'

/**
 * Renders an HTML document to an A4 PDF in a hidden window — the documents
 * sent to customers over Telegram (see documentLayout.ts).
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, width: 800, height: 1100 })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  } finally {
    win.destroy()
  }
}
