import { ipcMain } from 'electron';
import http from 'http';
import https from 'https';
function httpGet(url, token) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(String(res.statusCode)));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch {
                    resolve(raw);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
export function registerReportsIpc() {
    ipcMain.handle('reports:fetch', (_e, url, token) => httpGet(url, token));
}
