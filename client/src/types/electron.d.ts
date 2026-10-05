export type ReportLine = { label: string; value?: string; bold?: boolean } | { divider: true }
export interface ReportDoc { title: string; subtitle?: string; lines: ReportLine[] }

export interface SessionReport {
  sessionId: number
  terminalId: string | null
  openedAt: string | null
  closedAt: string | null
  openingBalance: number
  saleCount: number
  salesTotal: number
  returnCount: number
  cancelledCount: number
  byMethod: Array<{ method: string; amount: number }>
  cashSales: number
  cashRefunds: number
  debtRepaymentsCash: number
  deposits: number
  withdrawals: number
  expensesCash: number
  supplierPaymentsCash: number
  expectedCash: number
  closingBalanceActual: number | null
}

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
    /** The exact HTML the Windows-printer path prints, for on-screen preview. */
    receiptHtml: (receiptData: unknown) => Promise<{ html: string; paperWidthMm: number }>
    /** Prints an employee badge page through the system print dialog. */
    printBadge: (html: string) => Promise<{ success: boolean; error?: string }>
    /** Prints a name/qty/estimated-cost list on the receipt printer; `meta` titles and numbers it (a purchase order prints as "BUYURTMA", No: ZK-…). */
    printShoppingList: (items: Array<{ name: string; qty: number; cost: number }>, meta?: { title?: string; reference?: string; supplier?: string | null }) => Promise<{ success: boolean; error?: string }>
    /** Label/value report on the receipt printer (X/Z shift reports, stocktake results). */
    printReport: (doc: ReportDoc) => Promise<{ success: boolean; error?: string }>
    openCashDrawer: () => Promise<{ success: boolean; error?: string }>
    testPrint: () => Promise<{ success: boolean; message?: string }>
    listPrinters: () => Promise<unknown[]>
    configure: (config: unknown) => Promise<{ success: boolean }>
  }
  session: {
    open: (openingBalance: number) => Promise<unknown>
    close: (closingData: { sessionId: number; closingBalanceActual: number }) => Promise<unknown>
    current: () => Promise<unknown | null>
    /** Everything the X/Z report shows; expectedCash is exactly what the close stores. */
    report: (sessionId: number) => Promise<SessionReport>
  }
  sync: {
    pushPending: () => Promise<{ synced: number; errors: number; dead: number }>
    pullLatest: (table: string) => Promise<{ table: string; count: number }>
    getStatus: () => Promise<string>
    /** After an online password sign-in: this app syncs (and badge sign-in works) with that token. */
    setTerminalToken: (token: string, role: string) => Promise<void>
    hasTerminalToken: () => Promise<boolean>
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
  /** Badge-scan shifts (POS only). status 0 = offline / device not registered (see data.code). */
  shift: {
    start: (badgeCode: string) => Promise<{ status: number; data: unknown }>
    heartbeat: (shiftId: number) => Promise<{ status: number; data: unknown }>
    /** Queued and delivered in the background (retried while offline), so it resolves at once. */
    end: (shiftId: number) => Promise<void>
  }
  window: {
    openCustomerDisplay: () => Promise<{ success: boolean }>
    closeCustomerDisplay: () => Promise<{ success: boolean }>
    updateCustomerDisplay: (data: unknown) => Promise<{ success: boolean }>
    openApp: (id: string, name: string, url: string) => Promise<{ success: boolean }>
    toggleFullscreen: () => Promise<{ fullscreen: boolean }>
    isFullscreen: () => Promise<{ fullscreen: boolean }>
  }
  files: {
    /** Opens a native file picker filtered to images; returns a data: URI of
     *  the picked file, or null if cancelled. */
    pickImage: () => Promise<string | null>
  }
  telegram: {
    send: (chatId: string, text: string) => Promise<{ success: boolean; error?: string }>
    getDeepLink: (contactSyncId: string) => Promise<string | null>
    status: () => Promise<boolean>
    runAutoReminders: () => Promise<{ sent: number; skipped: number; failed: number }>
  }
  sms: {
    send: (phoneNumber: string, text: string) => Promise<{ success: boolean; error?: string }>
    status: () => Promise<boolean>
  }
  notify: {
    /** Messages the sale's contact what they just took on credit + their new total debt (Telegram, else SMS). Never throws on a send failure — it's logged to message_log instead. */
    debtSale: (saleSyncId: string) => Promise<
      | { status: 'sent'; channel: 'telegram' | 'sms' }
      | { status: 'skipped'; reason: string }
      | { status: 'failed'; channel: 'telegram' | 'sms'; error: string }
    >
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
    post: (url: string, token: string, body: unknown) => Promise<unknown>
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
