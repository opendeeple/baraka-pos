import { Page } from '@playwright/test'

export const BASE_URL = 'http://localhost:4173'
export const OFFICE_BASE_URL = 'http://localhost:4174'

export const MOCK_ELECTRON_API = () => {
  const mockDb = {
    query: async (_sql: string) => [] as unknown[],
    exec: async () => {},
    transaction: async (fn: (db: unknown) => unknown) => fn({}),
  }
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    db: mockDb,
    printer: {
      print: async () => {},
      openCashDrawer: async () => {},
      listPrinters: async () => ['USB001'],
      testPrint: async () => {},
      configure: async () => {},
    },
    session: {
      current: async () => null,
      open: async () => ({ id: 1 }),
      close: async () => ({}),
    },
    sync: {
      pushPending: async () => ({ synced: 0, errors: 0, dead: 0 }),
      pullLatest: async () => {},
      getStatus: async () => ({ pendingCount: 0 }),
      ensureDevice: async () => ({ registered: true }),
      isDeviceRegistered: async () => true,
      nextInvoiceNumber: async () => 'BRK-000001',
      enqueue: async () => {},
      retryDead: async () => 0,
    },
    auth: {
      login: async () => ({}),
      logout: async () => {},
      getToken: async () => null,
      me: async () => ({ status: 401, data: {} }),
      saveToken: async () => {},
      clearToken: async () => {},
    },
    barcode: {
      manualScan: async () => null,
      onScan: () => () => {},
    },
    window: {
      openCustomerDisplay: async () => {},
      closeCustomerDisplay: async () => {},
      updateCustomerDisplay: async () => {},
    },
    app: {
      isTraining: async () => false,
      getVersion: async () => '1.0.0',
      getLogPath: async () => '/logs/baraka.log',
      openLogs: async () => {},
      reload: async () => {},
    },
    updater: {
      check: async () => {},
      download: async () => {},
      install: async () => {},
      onUpdateAvailable: () => () => {},
      onDownloadProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
    },
  }
}

export async function loadApp(page: Page) {
  await page.addInitScript(MOCK_ELECTRON_API)
  await page.goto(`${BASE_URL}/#/login`)
  await page.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 10_000 })
}

const MOCK_PRODUCTS = [
  { id: 1, name: 'Coca Cola 500ml', barcode: '5000112637922', price: 60, cost: 45, stock: 50, is_active: 1, batch_id: 1, batchId: 1 },
  { id: 2, name: 'Bread Loaf', barcode: '1234567890123', price: 55, cost: 40, stock: 30, is_active: 1, batch_id: 1, batchId: 1 },
  { id: 3, name: 'Milk 500ml', barcode: '9876543210001', price: 65, cost: 50, stock: 0, is_active: 1, batch_id: 1, batchId: 1 },
]

// The app has no localStorage-persisted auth — it restores sessions via
// window.electronAPI.auth.getToken() + a server/db round-trip (see
// screens/auth/LoginScreen.tsx and office/LoginScreen.tsx). So "authenticated"
// e2e fixtures must mock that real restore path, then land on /login and let
// the app's own redirect run — not seed inert localStorage keys.
type MockApi = { db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }; auth: Record<string, unknown>; session: Record<string, unknown> }

export async function loadAuthenticatedPOS(page: Page) {
  await page.addInitScript(MOCK_ELECTRON_API)
  await page.addInitScript((products) => {
    const api = (window as unknown as { electronAPI: MockApi }).electronAPI
    api.auth.getToken = async () => 'mock-token'
    api.session.current = async () => ({
      id: 1, store_id: 1, terminal_id: 'TERMINAL-001', user_id: 1,
      state: 'opened', opening_balance: 1000,
      opened_at: '2025-01-01T00:00:00.000Z', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
    })
    api.db.query = async (sql: string) => {
      if (sql.includes('cached_user')) {
        return [
          { meta_key: 'cached_user', meta_value: JSON.stringify({ id: 1, name: 'Test Cashier', role: 'cashier', email: 'test@example.com' }) },
          { meta_key: 'cached_store', meta_value: JSON.stringify({ id: 1, name: 'Baraka Mini Market', salePrefix: 'BRK' }) },
          { meta_key: 'server_url', meta_value: 'http://localhost:3001' },
        ]
      }
      if (sql.includes('FROM products') || sql.includes('FROM product_batches')) return products
      if (sql.includes('FROM settings')) return [{ meta_value: 'Baraka Mini Market' }]
      if (sql.includes('FROM collections')) return [{ id: 1, name: 'All', collection_type: 'category' }]
      if (sql.includes('FROM pos_sessions')) return [{ id: 1, state: 'opened', opening_balance: 1000 }]
      if (sql.includes('FROM users')) return [{ id: 1, name: 'Test Cashier', role: 'cashier' }]
      return []
    }
  }, MOCK_PRODUCTS)

  await page.goto(`${BASE_URL}/#/login`)
  await page.waitForFunction(() => window.location.hash === '#/pos' || window.location.hash === '#/session/open', { timeout: 10_000 })
  await page.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 10_000 })
}

export async function loadAuthenticatedBackOffice(page: Page, route: string) {
  await page.addInitScript(MOCK_ELECTRON_API)
  await page.addInitScript(() => {
    const api = (window as unknown as { electronAPI: MockApi }).electronAPI
    api.auth.getToken = async () => 'mock-token'
    api.auth.me = async () => ({ status: 200, data: { id: 1, name: 'Admin', role: 'admin', email: 'admin@example.com', storeId: 1 } })
    api.db.query = async (sql: string) => {
      if (sql.includes('FROM sales')) return [{ id: 1, invoice_number: 'INV-001', total_amount: 1500, status: 'completed', sale_date: '2025-01-01', user_id: 1 }]
      if (sql.includes('FROM products') || sql.includes('FROM product_batches')) return [{ id: 1, name: 'Test Product', price: 100, stock: 10, is_active: 1, category_id: null }]
      if (sql.includes('FROM expenses')) return []
      if (sql.includes('FROM contacts')) return [{ id: 1, name: 'Test Customer', type: 'customer', loyalty_points_balance: 0 }]
      if (sql.includes('FROM collections')) return [{ id: 1, name: 'All', collection_type: 'category' }]
      if (sql.includes('FROM settings')) return [{ meta_key: 'store_name', meta_value: 'Baraka Mini Market' }]
      if (sql.includes('FROM users')) return [{ id: 1, name: 'Admin', role: 'admin', is_active: 1 }]
      if (sql.includes('FROM salary_records')) return []
      if (sql.includes('FROM purchases')) return []
      if (sql.includes('COUNT(')) return [{ count: 5 }]
      if (sql.includes('SUM(')) return [{ total: 5000 }]
      return []
    }
  })

  // office/LoginScreen.tsx always redirects to /backoffice (the dashboard)
  // after a successful restore — it doesn't preserve the originally
  // requested deep link. Land there first, then move within the SPA
  // (hash-only, no reload) to the screen under test so auth state survives.
  await page.goto(`${OFFICE_BASE_URL}/#/login`)
  await page.waitForFunction(() => window.location.hash === '#/backoffice', { timeout: 10_000 })
  if (route !== '/backoffice') {
    await page.evaluate((r) => { window.location.hash = r }, route)
  }
  await page.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 10_000 })
}
