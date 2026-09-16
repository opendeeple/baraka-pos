interface MiniAppState {
  id: string
  canGoBack?: boolean
  canGoForward?: boolean
  loading?: boolean
  title?: string
  error?: string
}

export interface ElectronAPI {
  miniapp: {
    open: (id: string, url: string) => Promise<void>
    hide: (id?: string) => Promise<void>
    navigate: (action: 'back' | 'forward' | 'reload') => Promise<void>
    destroy: (id: string) => Promise<void>
    getActive: () => Promise<{ id: string } | null>
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    onState: (cb: (state: MiniAppState) => void) => () => void
  }
  db: {
    query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>
    exec: (sql: string, params?: unknown[]) => Promise<void>
    transaction: (ops: Array<{ sql: string; params: unknown[] }>) => Promise<void>
  }
  printer: {
    print: (receiptData: unknown) => Promise<{ success: boolean; error?: string }>
    openCashDrawer: () => Promise<{ success: boolean }>
    testPrint: () => Promise<{ success: boolean; message?: string }>
    listPrinters: () => Promise<unknown[]>
    configure: (config: unknown) => Promise<{ success: boolean }>
  }
  session: {
    open: (openingBalance: number) => Promise<unknown>
    close: (closingData: { sessionId: number; closingBalanceActual: number }) => Promise<unknown>
    current: () => Promise<unknown | null>
  }
  sync: {
    pushPending: () => Promise<{ synced: number; errors: number; dead: number }>
    pullLatest: (table: string) => Promise<{ table: string; count: number }>
    getStatus: () => Promise<string>
    ensureDevice: (jwtToken: string) => Promise<{ registered: boolean; error?: string }>
    isDeviceRegistered: () => Promise<boolean>
    nextInvoiceNumber: () => Promise<string | null>
    enqueue: (table: string, syncId: string, op: 'upsert' | 'delete') => Promise<void>
    retryDead: () => Promise<number>
  }
  auth: {
    saveToken: (token: string) => Promise<void>
    getToken: () => Promise<string | null>
    clearToken: () => Promise<void>
    login: (serverUrl: string, username: string, password: string) => Promise<{ status: number; data: unknown }>
    me: (serverUrl: string, token: string) => Promise<{ status: number; data: unknown }>
  }
  window: {
    openCustomerDisplay: () => Promise<{ success: boolean }>
    closeCustomerDisplay: () => Promise<{ success: boolean }>
    updateCustomerDisplay: (data: unknown) => Promise<{ success: boolean }>
    openApp: (id: string, name: string, url: string) => Promise<{ success: boolean }>
    toggleFullscreen: () => Promise<{ fullscreen: boolean }>
    isFullscreen: () => Promise<{ fullscreen: boolean }>
  }
  app: {
    isTraining: () => Promise<boolean>
    getVersion: () => Promise<string>
    getLogPath: () => Promise<string>
    openLogs: () => Promise<void>
    reload: () => Promise<void>
  }
  reports: {
    fetch: (url: string, token: string) => Promise<unknown>
  }
  updater: {
    check: () => Promise<unknown>
    download: () => Promise<void>
    install: () => Promise<void>
    onUpdateAvailable: (cb: (info: unknown) => void) => () => void
    onDownloadProgress: (cb: (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => () => void
    onUpdateDownloaded: (cb: (info: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
