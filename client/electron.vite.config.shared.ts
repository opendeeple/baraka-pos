import { loadEnv, type Plugin } from 'vite'

const PROD_SERVER = 'https://barakapos-server.onrender.com'

/**
 * The CSP in index.html names the production server. A build pointed at
 * another one (VITE_SERVER_URL, e.g. the demo build from .env.demo) must allow
 * that server instead, or the renderer's socket.io connection is blocked.
 * Demo builds also get "DEMO" in the window title.
 */
export function serverUrlHtml(mode: string): Plugin {
  const env = loadEnv(mode, __dirname, 'VITE_')
  const server = env.VITE_SERVER_URL?.replace(/\/+$/, '')
  const isDemo = env.VITE_APP_ENV === 'demo'
  return {
    name: 'baraka-server-url-html',
    transformIndexHtml(html) {
      let out = html
      if (server && server !== PROD_SERVER) {
        out = out
          .replaceAll(PROD_SERVER, server)
          .replaceAll(PROD_SERVER.replace(/^https/, 'wss'), server.replace(/^http/, 'ws'))
      }
      if (isDemo) out = out.replace(/<title>(.*?)<\/title>/, '<title>$1 DEMO</title>')
      return out
    },
  }
}
