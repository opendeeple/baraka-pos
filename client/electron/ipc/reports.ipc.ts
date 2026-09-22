import { ipcMain } from 'electron'
import http from 'http'
import https from 'https'

function httpRequest(method: string, url: string, token: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = lib.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(String(res.statusCode)))
          return
        }
        try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

export function registerReportsIpc() {
  ipcMain.handle('reports:fetch', (_e, url: string, token: string) => httpRequest('GET', url, token))
  ipcMain.handle('reports:post', (_e, url: string, token: string, body: unknown) => httpRequest('POST', url, token, body))
}
