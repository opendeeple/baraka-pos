/// <reference lib="dom" />
// Runs inside every mini-app webview before page scripts.
// Restores sessionStorage from disk so auth survives POS restarts.
const { ipcRenderer } = require('electron')

try {
  const origin = window.location.origin
  if (origin && origin !== 'null') {
    const data = ipcRenderer.sendSync('webview:get-session', origin) as Record<string, string> | null
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([k, v]) => {
        try { sessionStorage.setItem(k, v) } catch {}
      })
    }
  }
} catch {}
