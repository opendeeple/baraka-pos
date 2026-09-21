// Single source of truth for the local SQLite schema used by every BarakaPOS
// client (Electron POS/Office, Android POS/Office). Platform-agnostic: the
// runner only needs the minimal synchronous SchemaDb surface below, which both
// better-sqlite3 and expo-sqlite (sync API) can provide.

export interface SchemaDb {
  exec(sql: string): void
  all<T = Record<string, unknown>>(sql: string): T[]
  getUserVersion(): number
  setUserVersion(version: number): void
  transaction(fn: () => void): void
}

// ---------------------------------------------------------------------------
// Schema v1 — legacy bootstrap. Idempotent: CREATE IF NOT EXISTS + tolerated
// duplicate-column ALTERs. Do not append here — add a versioned migration.
// ---------------------------------------------------------------------------

export const LEGACY_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    sku TEXT,
    barcode TEXT,
    image_url TEXT,
    unit TEXT,
    category_id INTEGER,
    brand_id INTEGER,
    product_type TEXT DEFAULT 'simple',
    is_stock_managed INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    is_featured INTEGER DEFAULT 0,
    alert_quantity REAL,
    discount REAL DEFAULT 0,
    meta_data TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    sync_status TEXT DEFAULT 'synced',
    server_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS product_batches (
    id INTEGER PRIMARY KEY,
    product_id INTEGER,
    batch_number TEXT,
    expiry_date TEXT,
    cost REAL DEFAULT 0,
    price REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_featured INTEGER DEFAULT 0,
    vendor_id INTEGER,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    sync_status TEXT DEFAULT 'synced'
  )`,
  `CREATE TABLE IF NOT EXISTS product_stocks (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    product_id INTEGER,
    batch_id INTEGER,
    quantity REAL DEFAULT 0,
    updated_at TEXT,
    UNIQUE(store_id, product_id, batch_id)
  )`,
  `CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    collection_type TEXT,
    name TEXT,
    slug TEXT,
    description TEXT,
    parent_id INTEGER,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    type TEXT DEFAULT 'customer',
    balance REAL DEFAULT 0,
    loyalty_points_balance REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    sync_status TEXT DEFAULT 'synced'
  )`,
  `CREATE TABLE IF NOT EXISTS charges (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    name TEXT,
    charge_type TEXT,
    rate_type TEXT,
    rate_value REAL,
    is_active INTEGER DEFAULT 1,
    is_default INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    sale_prefix TEXT DEFAULT 'INV',
    current_sale_number INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    meta_key TEXT,
    meta_value TEXT,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(meta_key)
  )`,
  `CREATE TABLE IF NOT EXISTS pos_sessions (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    terminal_id TEXT,
    user_id INTEGER,
    state TEXT DEFAULT 'opened',
    opening_balance REAL DEFAULT 0,
    closing_balance_theoretical REAL,
    closing_balance_actual REAL,
    variance REAL,
    opened_at TEXT,
    closed_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    sync_status TEXT DEFAULT 'synced',
    server_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT NOT NULL UNIQUE,
    store_id INTEGER,
    session_id INTEGER,
    contact_id INTEGER,
    user_id INTEGER,
    invoice_number TEXT,
    sale_type TEXT DEFAULT 'sale',
    reference_id INTEGER,
    sale_date TEXT,
    sale_time TEXT,
    subtotal REAL,
    discount REAL DEFAULT 0,
    total_charge_amount REAL DEFAULT 0,
    total_amount REAL,
    amount_received REAL DEFAULT 0,
    change_amount REAL DEFAULT 0,
    profit_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'completed',
    payment_status TEXT DEFAULT 'fully_paid',
    note TEXT,
    cart_snapshot TEXT,
    created_at TEXT,
    updated_at TEXT,
    sync_status TEXT DEFAULT 'pending',
    server_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    item_type TEXT DEFAULT 'product',
    product_id INTEGER,
    batch_id INTEGER,
    charge_id INTEGER,
    description TEXT,
    quantity REAL,
    free_quantity REAL DEFAULT 0,
    unit_price REAL,
    unit_cost REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    flat_discount REAL DEFAULT 0,
    is_free INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    store_id INTEGER,
    contact_id INTEGER,
    session_id INTEGER,
    transaction_date TEXT,
    amount REAL,
    payment_method TEXT,
    transaction_type TEXT DEFAULT 'sale',
    charge_state TEXT DEFAULT 'FULLY_CHARGED',
    payment_terminal_ref TEXT,
    note TEXT,
    created_at TEXT,
    sync_status TEXT DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    store_id INTEGER,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT DEFAULT 'cashier',
    pin_code TEXT,
    salary REAL,
    hire_date TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    sync_status TEXT DEFAULT 'synced',
    server_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    vendor_id INTEGER,
    reference_number TEXT,
    note TEXT,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    batch_id INTEGER,
    quantity REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    session_id INTEGER,
    expense_date TEXT NOT NULL,
    category TEXT DEFAULT 'Other',
    description TEXT,
    amount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    reference TEXT,
    created_by INTEGER,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    store_id INTEGER,
    sale_id INTEGER,
    points REAL DEFAULT 0,
    type TEXT DEFAULT 'earn',
    description TEXT,
    created_by INTEGER,
    created_at TEXT,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS quantity_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    batch_id INTEGER,
    stock_id INTEGER,
    previous_quantity REAL DEFAULT 0,
    adjusted_quantity REAL DEFAULT 0,
    reason TEXT,
    created_by INTEGER,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_queue_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT,
    status TEXT DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS held_carts (
    id TEXT PRIMARY KEY,
    label TEXT,
    items TEXT NOT NULL,
    charges TEXT,
    discount REAL DEFAULT 0,
    contact_id INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cash_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    session_id INTEGER,
    transaction_type TEXT DEFAULT 'sale',
    amount REAL NOT NULL,
    source TEXT,
    description TEXT,
    reference_id INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS salary_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    paid_at TEXT NOT NULL,
    note TEXT,
    created_at TEXT
  )`,
  /* ALTER TABLE upgrades — tolerated as duplicates on existing DBs */
  `ALTER TABLE users ADD COLUMN phone TEXT`,
  `ALTER TABLE users ADD COLUMN pin_code TEXT`,
  `ALTER TABLE users ADD COLUMN salary REAL`,
  `ALTER TABLE users ADD COLUMN hire_date TEXT`,
  `ALTER TABLE users ADD COLUMN deleted_at TEXT`,
  `ALTER TABLE users ADD COLUMN server_id INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_sync_id ON sales(sync_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(sync_status)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue_local(status)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loyalty_contact ON loyalty_point_transactions(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cash_logs_session ON cash_logs(session_id)`,
  // sale_items/payment_transactions/sales grow unboundedly with usage and are
  // hit on every sale-detail view, void, return, and session close.
  `CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_tx_sale ON payment_transactions(sale_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_tx_session ON payment_transactions(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_contact ON sales(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id)`,
]

// ---------------------------------------------------------------------------
// Versioned migrations (PRAGMA user_version)
// ---------------------------------------------------------------------------

// SQLite has no gen_random_uuid(); this expression builds a spec-compliant
// UUIDv4 from randomblob(), usable in set-based UPDATEs.
export const SQL_UUID4 =
  "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))"

function columnExists(db: SchemaDb, table: string, column: string): boolean {
  const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
  return cols.some((c) => c.name === column)
}

function addColumnIfMissing(db: SchemaDb, table: string, column: string, def: string) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
  }
}

// Schema v2 — sync protocol v2 identity:
// every syncable row gets a sync_id UUID; conflict resolution targets sync_id,
// never the device-local integer id; server_id mirrors the server PK.
function migrateToV2(db: SchemaDb): void {
  const SYNC_ID_TABLES = [
    'products', 'product_batches', 'product_stocks', 'collections', 'contacts',
    'charges', 'pos_sessions', 'users', 'sale_items', 'payment_transactions',
    'purchases', 'purchase_items', 'expenses', 'quantity_adjustments',
  ]
  const SERVER_ID_TABLES = [
    'products', 'product_batches', 'product_stocks', 'collections', 'contacts',
    'charges', 'pos_sessions', 'users', 'purchases', 'expenses',
    'quantity_adjustments', 'stores',
  ]
  // Tables v1 pull replicated by raw id: existing rows are assumed to be
  // server copies, so server_id = id. Rows that never match a v2-pulled record
  // after the first full pull are local-only orphans; the sync engine sweeps
  // them back to server_id = NULL and enqueues them for push.
  const V1_PULLED_TABLES = [
    'products', 'product_batches', 'product_stocks', 'collections', 'contacts',
    'charges', 'stores',
  ]

  for (const table of SYNC_ID_TABLES) {
    addColumnIfMissing(db, table, 'sync_id', 'TEXT')
    db.exec(`UPDATE ${table} SET sync_id = ${SQL_UUID4} WHERE sync_id IS NULL`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_sync_id ON ${table}(sync_id)`)
  }
  for (const table of SERVER_ID_TABLES) {
    addColumnIfMissing(db, table, 'server_id', 'INTEGER')
  }
  for (const table of V1_PULLED_TABLES) {
    db.exec(`UPDATE ${table} SET server_id = id WHERE server_id IS NULL`)
  }

  // Columns the v2 protocol needs that v1 tables lack.
  addColumnIfMissing(db, 'charges', 'updated_at', 'TEXT')
  addColumnIfMissing(db, 'charges', 'created_at', 'TEXT')
  addColumnIfMissing(db, 'sales', 'deleted_at', 'TEXT')
  addColumnIfMissing(db, 'quantity_adjustments', 'updated_at', 'TEXT')
  addColumnIfMissing(db, 'purchases', 'updated_at', 'TEXT')

  // sync_queue_local becomes a real outbox with retry/backoff bookkeeping.
  addColumnIfMissing(db, 'sync_queue_local', 'table_name', 'TEXT')
  addColumnIfMissing(db, 'sync_queue_local', 'op', "TEXT DEFAULT 'upsert'")
  addColumnIfMissing(db, 'sync_queue_local', 'attempt_count', 'INTEGER DEFAULT 0')
  addColumnIfMissing(db, 'sync_queue_local', 'next_retry_at', 'TEXT')
  addColumnIfMissing(db, 'sync_queue_local', 'last_error', 'TEXT')
  db.exec(`UPDATE sync_queue_local SET table_name = 'sales' WHERE table_name IS NULL AND entity_type = 'sale'`)
  // v1 stranded failed pushes in a terminal 'error' state; v2 retries them.
  db.exec(`UPDATE sync_queue_local SET status = 'pending', attempt_count = 0, next_retry_at = NULL WHERE status = 'error'`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_retry ON sync_queue_local(status, next_retry_at)`)
}

// Schema v3 — cash movements become syncable facts (paid-in / paid-out with
// optional customer for debt repayments).
function migrateToV3(db: SchemaDb): void {
  addColumnIfMissing(db, 'cash_logs', 'sync_id', 'TEXT')
  db.exec(`UPDATE cash_logs SET sync_id = ${SQL_UUID4} WHERE sync_id IS NULL`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_logs_sync_id ON cash_logs(sync_id)`)
  addColumnIfMissing(db, 'cash_logs', 'contact_id', 'INTEGER')
  addColumnIfMissing(db, 'cash_logs', 'updated_at', 'TEXT')
  addColumnIfMissing(db, 'cash_logs', 'server_id', 'INTEGER')
}

// Schema v4 — collections (categories/brands/tags) become soft-deletable so
// a server tombstone (deletedAt) has a local column to arrive with, matching
// how products/contacts already signal deletion without losing the row.
function migrateToV4(db: SchemaDb): void {
  addColumnIfMissing(db, 'collections', 'deleted_at', 'TEXT')
}

// Schema v5 — box/kg unit pricing: `unit` (piece/kg/box) already existed but
// was never surfaced in the UI; `units_per_package` is how many pieces one
// box contains, only meaningful when unit='box' (a 'kg' product's existing
// `price` already means "price per kg", nothing extra needed for that case).
function migrateToV5(db: SchemaDb): void {
  addColumnIfMissing(db, 'products', 'units_per_package', 'REAL')
}

export const VERSIONED_MIGRATIONS: Array<{ version: number; apply: (db: SchemaDb) => void }> = [
  { version: 2, apply: migrateToV2 },
  { version: 3, apply: migrateToV3 },
  { version: 4, apply: migrateToV4 },
  { version: 5, apply: migrateToV5 },
]

export const CURRENT_SCHEMA_VERSION = VERSIONED_MIGRATIONS[VERSIONED_MIGRATIONS.length - 1].version

/**
 * Brings a database to the current schema: idempotent v1 bootstrap, then any
 * versioned migrations newer than PRAGMA user_version, each in a transaction.
 */
export function runMigrations(db: SchemaDb): void {
  for (const migration of LEGACY_MIGRATIONS) {
    try {
      db.exec(migration)
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('duplicate column'))) {
        throw err
      }
    }
  }
  const baseline = db.getUserVersion() || 1

  for (const { version, apply } of VERSIONED_MIGRATIONS) {
    if (version <= baseline) continue
    db.transaction(() => {
      apply(db)
      db.setUserVersion(version)
    })
  }
}
