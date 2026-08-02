import { ipcMain, BrowserWindow, app, WebContentsView, session as electronSession } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const sessionsFile = join(app.getPath('userData'), 'webview-sessions.json')

function readSessions(): Record<string, Record<string, string>> {
  try {
    if (existsSync(sessionsFile)) return JSON.parse(readFileSync(sessionsFile, 'utf-8'))
  } catch {}
  return {}
}

function writeSessions(data: Record<string, Record<string, string>>) {
  try { writeFileSync(sessionsFile, JSON.stringify(data)) } catch {}
}

const sessions = readSessions()

// ─── Mini-app WebContentsView management ─────────────────────────────────────

interface MiniAppEntry {
  view: WebContentsView
  added: boolean
}

const miniappViews = new Map<string, MiniAppEntry>()
let activeViewId: string | null = null

export function hideAllMiniapps() {
  const win = getMainWin()
  for (const [, entry] of miniappViews) {
    if (entry.added) {
      try { win?.contentView.removeChildView(entry.view) } catch {}
      entry.added = false
    }
  }
  activeViewId = null
}

function getMainWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ?? null
}

function calcBounds(win: BrowserWindow) {
  const [w, h] = win.getContentSize()
  return { x: 56, y: 108, width: Math.max(w - 56, 100), height: Math.max(h - 108, 100) }
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerWindowIpc(
  createCustomerWindow: () => BrowserWindow,
  getCustomerWindow: () => BrowserWindow | null
) {
  ipcMain.handle('window:openCustomerDisplay', () => {
    if (!getCustomerWindow()) createCustomerWindow()
    return { success: true }
  })

  ipcMain.handle('window:closeCustomerDisplay', () => {
    getCustomerWindow()?.close()
    return { success: true }
  })

  ipcMain.handle('window:updateCustomerDisplay', (_event, data: unknown) => {
    getCustomerWindow()?.webContents.send('customer-display:update', data)
    return { success: true }
  })

  // Sync IPC — webview preload calls this before page scripts run
  ipcMain.on('webview:get-session', (event, origin: string) => {
    event.returnValue = sessions[origin] ?? null
  })

  ipcMain.handle('webview:save-session', (_event, origin: string, data: Record<string, string>) => {
    sessions[origin] = data
    writeSessions(sessions)
  })

  const openAppWindows = new Map<string, BrowserWindow>()

  ipcMain.handle('window:openApp', (_event, { id, name, url }: { id: string; name: string; url: string }) => {
    const existing = openAppWindows.get(id)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return { success: true }
    }
    const appWin = new BrowserWindow({
      width: 500,
      height: 750,
      title: name,
      autoHideMenuBar: true,
      webPreferences: {
        partition: `persist:app-${id}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    openAppWindows.set(id, appWin)
    appWin.on('closed', () => openAppWindows.delete(id))
    appWin.loadURL(url)
    return { success: true }
  })

  // ─── Embedded mini-app browser via WebContentsView ─────────────────────────

  ipcMain.handle('miniapp:open', (_event, { id, url }: { id: string; url: string }) => {
    const win = getMainWin()
    if (!win) return

    let entry = miniappViews.get(id)

    if (!entry || entry.view.webContents.isDestroyed()) {
      const viewSession = electronSession.fromPartition(`persist:miniapp-${id}`)
      const view = new WebContentsView({
        webPreferences: {
          session: viewSession,
          // __dirname is out/main/; webview.js is in out/preload/
          preload: join(__dirname, '../preload/webview.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      })

      const sendState = () => {
        if (win.isDestroyed()) return
        win.webContents.send('miniapp:state', {
          id,
          canGoBack: view.webContents.canGoBack(),
          canGoForward: view.webContents.canGoForward(),
          loading: view.webContents.isLoading(),
          title: view.webContents.getTitle() || url,
        })
      }

      view.webContents.on('did-start-loading', () => {
        if (!win.isDestroyed()) win.webContents.send('miniapp:state', { id, loading: true, error: undefined })
      })

      view.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
        if (win.isDestroyed() || errorCode === -3) return  // -3 = aborted navigation, ignore
        win.webContents.send('miniapp:state', { id, loading: false, error: errorDescription })
      })

      let saveTimer: ReturnType<typeof setTimeout> | null = null
      view.webContents.on('did-stop-loading', async () => {
        sendState()
        // Debounce sessionStorage save — did-stop-loading fires on every SPA route change
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(async () => {
          try {
            const ssJson = await view.webContents.executeJavaScript(
              'JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))'
            ) as string
            const ss = JSON.parse(ssJson) as Record<string, string>
            const pageUrl = view.webContents.getURL()
            if (pageUrl && Object.keys(ss).length > 0) {
              sessions[new URL(pageUrl).origin] = ss
              writeSessions(sessions)
            }
          } catch {}
        }, 500)
      })

      view.webContents.on('page-title-updated', (_, title) => {
        if (!win.isDestroyed()) win.webContents.send('miniapp:state', { id, title })
      })

      view.webContents.on('did-navigate', sendState)
      view.webContents.on('did-navigate-in-page', sendState)

      view.webContents.loadURL(url)
      entry = { view, added: false }
      miniappViews.set(id, entry)
    }

    // Hide all other views
    for (const [vid, e] of miniappViews) {
      if (vid !== id && e.added) {
        try { win.contentView.removeChildView(e.view) } catch {}
        e.added = false
      }
    }

    // Show this view
    if (!entry.added) {
      win.contentView.addChildView(entry.view)
      entry.added = true
    }
    try { entry.view.setBounds(calcBounds(win)) } catch {}
    activeViewId = id

    // Send current state immediately so toolbar renders correctly
    win.webContents.send('miniapp:state', {
      id,
      canGoBack: entry.view.webContents.canGoBack(),
      canGoForward: entry.view.webContents.canGoForward(),
      loading: entry.view.webContents.isLoading(),
      title: entry.view.webContents.getTitle() || url,
    })
  })

  ipcMain.handle('miniapp:hide', (_event, id?: string) => {
    // If a specific id is given, only hide if that view is the active one
    if (id && activeViewId !== id) return
    if (!activeViewId) return

    const win = getMainWin()
    const entry = miniappViews.get(activeViewId)
    if (win && entry?.added) {
      try { win.contentView.removeChildView(entry.view) } catch {}
      entry.added = false
    }
    activeViewId = null
  })

  ipcMain.handle('miniapp:navigate', (_event, action: 'back' | 'forward' | 'reload') => {
    if (!activeViewId) return
    const entry = miniappViews.get(activeViewId)
    if (!entry) return
    const wc = entry.view.webContents
    if (action === 'back' && wc.canGoBack()) wc.goBack()
    else if (action === 'forward' && wc.canGoForward()) wc.goForward()
    else if (action === 'reload') wc.reload()
  })

  ipcMain.handle('miniapp:destroy', (_event, id: string) => {
    const win = getMainWin()
    const entry = miniappViews.get(id)
    if (!entry) return
    // Prune session data for this app's origin
    try {
      const pageUrl = entry.view.webContents.getURL()
      if (pageUrl) {
        delete sessions[new URL(pageUrl).origin]
        writeSessions(sessions)
      }
    } catch {}
    entry.view.webContents.removeAllListeners()
    if (win && entry.added) {
      try { win.contentView.removeChildView(entry.view) } catch {}
    }
    try { entry.view.webContents.close() } catch {}
    miniappViews.delete(id)
    if (activeViewId === id) activeViewId = null
  })

  ipcMain.handle('miniapp:getActive', () => {
    return activeViewId ? { id: activeViewId } : null
  })

  ipcMain.handle('miniapp:setBounds', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!activeViewId) return
    const entry = miniappViews.get(activeViewId)
    if (entry?.added) {
      try { entry.view.setBounds(bounds) } catch {}
    }
  })
}
