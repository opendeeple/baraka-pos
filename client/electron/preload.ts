import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  miniapp: {
    open: (id: string, url: string) => ipcRenderer.invoke('miniapp:open', { id, url }),
    hide: (id?: string) => ipcRenderer.invoke('miniapp:hide', id),
    navigate: (action: 'back' | 'forward' | 'reload') => ipcRenderer.invoke('miniapp:navigate', action),
    destroy: (id: string) => ipcRenderer.invoke('miniapp:destroy', id),
    getActive: () => ipcRenderer.invoke('miniapp:getActive'),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('miniapp:setBounds', bounds),
    onState: (cb: (state: { id: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean; title?: string; error?: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, s: unknown) =>
        cb(s as { id: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean; title?: string; error?: string })
      ipcRenderer.on('miniapp:state', listener)
      return () => ipcRenderer.off('miniapp:state', listener)
    },
  },
  db: {
    query: (sql: string, params: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params),
    exec: (sql: string, params: unknown[]) =>
      ipcRenderer.invoke('db:exec', sql, params),
    transaction: (ops: Array<{ sql: string; params: unknown[] }>) =>
      ipcRenderer.invoke('db:transaction', ops),
  },
  printer: {
    print: (receiptData: unknown) => ipcRenderer.invoke('printer:print', receiptData),
    openCashDrawer: () => ipcRenderer.invoke('printer:openCashDrawer'),
    testPrint: () => ipcRenderer.invoke('printer:testPrint'),
    listPrinters: () => ipcRenderer.invoke('printer:listPrinters'),
    configure: (config: unknown) => ipcRenderer.invoke('printer:configure', config),
  },
  session: {
    open: (openingBalance: number) => ipcRenderer.invoke('session:open', openingBalance),
    close: (closingData: unknown) => ipcRenderer.invoke('session:close', closingData),
    current: () => ipcRenderer.invoke('session:current'),
  },
  sync: {
    pushPending: () => ipcRenderer.invoke('sync:pushPending'),
    pullLatest: (table: string) => ipcRenderer.invoke('sync:pullLatest', table),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    ensureDevice: (jwtToken: string) => ipcRenderer.invoke('sync:ensureDevice', jwtToken),
    isDeviceRegistered: () => ipcRenderer.invoke('sync:isDeviceRegistered'),
    nextInvoiceNumber: () => ipcRenderer.invoke('sync:nextInvoiceNumber'),
    enqueue: (table: string, syncId: string, op: 'upsert' | 'delete') =>
      ipcRenderer.invoke('sync:enqueue', table, syncId, op),
    retryDead: () => ipcRenderer.invoke('sync:retryDead'),
  },
  auth: {
    saveToken: (token: string) => ipcRenderer.invoke('auth:saveToken', token),
    getToken: () => ipcRenderer.invoke('auth:getToken'),
    clearToken: () => ipcRenderer.invoke('auth:clearToken'),
    login: (serverUrl: string, username: string, password: string) =>
      ipcRenderer.invoke('auth:login', serverUrl, username, password),
    me: (serverUrl: string, token: string) =>
      ipcRenderer.invoke('auth:me', serverUrl, token),
  },
  window: {
    openCustomerDisplay: () => ipcRenderer.invoke('window:openCustomerDisplay'),
    closeCustomerDisplay: () => ipcRenderer.invoke('window:closeCustomerDisplay'),
    updateCustomerDisplay: (data: unknown) =>
      ipcRenderer.invoke('window:updateCustomerDisplay', data),
    openApp: (id: string, name: string, url: string) =>
      ipcRenderer.invoke('window:openApp', { id, name, url }),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  },
  files: {
    pickImage: () => ipcRenderer.invoke('files:pickImage') as Promise<string | null>,
  },
  app: {
    isTraining: () => ipcRenderer.invoke('app:isTraining'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
    openLogs: () => ipcRenderer.invoke('app:openLogs'),
    reload: () => ipcRenderer.invoke('app:reload'),
  },
  reports: {
    fetch: (url: string, token: string) => ipcRenderer.invoke('reports:fetch', url, token),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (cb: (info: unknown) => void) => {
      ipcRenderer.on('updater:update-available', (_, info) => cb(info))
      return () => ipcRenderer.removeAllListeners('updater:update-available')
    },
    onDownloadProgress: (cb: (progress: unknown) => void) => {
      ipcRenderer.on('updater:download-progress', (_, p) => cb(p))
      return () => ipcRenderer.removeAllListeners('updater:download-progress')
    },
    onUpdateDownloaded: (cb: (info: unknown) => void) => {
      ipcRenderer.on('updater:update-downloaded', (_, info) => cb(info))
      return () => ipcRenderer.removeAllListeners('updater:update-downloaded')
    },
  },
})
