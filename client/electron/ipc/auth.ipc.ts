import { ipcMain } from 'electron'
import { saveToken, getToken, clearToken } from '../services/auth.service'
import http from 'http'
import https from 'https'

function httpRequest(url: string, options: http.RequestOptions, body?: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.request(url, options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:saveToken', (_e, token: string) => saveToken(token))
  ipcMain.handle('auth:getToken', () => getToken())
  ipcMain.handle('auth:clearToken', () => clearToken())

  ipcMain.handle('auth:login', async (_e, serverUrl: string, username: string, password: string) => {
    const body = JSON.stringify({ username, password })
    const result = await httpRequest(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body)
    return result
  })

  ipcMain.handle('auth:me', async (_e, serverUrl: string, token: string) => {
    const result = await httpRequest(`${serverUrl}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    return result
  })
}
