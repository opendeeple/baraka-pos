// End-to-end harness for the Electron sync engine v2. Runs headless via
// ELECTRON_RUN_AS_NODE (matching the project better-sqlite3 ABI):
//   pnpm --filter client test:sync
// Exercises:
// fresh DB migration → device registration → full pull → local sale + contact
// creation → outbox flush → server verification → incremental pull.
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { runMigrations, setDbInstance, getDb } from '../electron/services/db.service'
import {
  ensureDeviceRegistered,
  pullTableV2,
  flushOutbox,
  enqueueOutbox,
  nextInvoiceNumber,
  PULL_TABLE_ORDER,
  backfillOutboxOnce,
} from '../electron/services/sync.service'

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3001'
let failures = 0
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function main() {
  // Fresh in-memory DB, full migration chain
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  setDbInstance(db as never)
  runMigrations(db as never)

  const now = new Date().toISOString()
  const setSetting = (k: string, v: string) =>
    db.prepare(`INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (1,?,?,?)`).run(k, v, now)
  setSetting('server_url', SERVER)
  setSetting('store_id', '1')
  setSetting('terminal_id', 'E2E-HARNESS-1')

  // 1. Login as admin (JWT) and register the device
  const loginRes = await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const login = await loginRes.json() as any
  check('admin login', loginRes.status === 200)

  const reg = await ensureDeviceRegistered(login.token, 'electron-pos')
  check('device registration', reg.registered, reg.error)
  backfillOutboxOnce()

  // 2. Full pull of all tables in dependency order
  for (const table of PULL_TABLE_ORDER) {
    const r = await pullTableV2(table)
    console.log(`   pulled ${r.table}: ${r.count}`)
  }
  const productCount = (db.prepare(`SELECT COUNT(*) c FROM products`).get() as any).c
  const userCount = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c
  check('products pulled', productCount >= 20, `${productCount}`)
  check('users pulled (offline login enabler)', userCount >= 2, `${userCount}`)
  const sampleProduct = db.prepare(`SELECT id, sync_id, server_id, category_id FROM products WHERE server_id=1`).get() as any
  check('pulled product keeps sync_id + server_id', Boolean(sampleProduct?.sync_id && sampleProduct?.server_id === 1))
  check('pulled product FK rewired to local collection id', sampleProduct?.category_id !== null)

  // Sales replicate with their children (office dashboards read these locally)
  const saleCount = (db.prepare(`SELECT COUNT(*) c FROM sales`).get() as any).c
  if (saleCount > 0) {
    const orphanSales = (db.prepare(
      `SELECT COUNT(*) c FROM sales s WHERE NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id)`
    ).get() as any).c
    check('every pulled sale has items', orphanSales === 0, `${orphanSales} of ${saleCount} missing items`)
    const unresolvedSessions = (db.prepare(
      `SELECT COUNT(*) c FROM sales WHERE session_id IS NULL`
    ).get() as any).c
    check('pulled sales resolve session FK locally', unresolvedSessions === 0, `${unresolvedSessions}`)
    const badDates = (db.prepare(
      `SELECT COUNT(*) c FROM sales WHERE length(sale_date) != 10`
    ).get() as any).c
    check('pulled sales use date-only sale_date', badDates === 0, `${badDates} ISO-timestamp rows`)
    const todayStr = new Date().toISOString().split('T')[0]
    const todayCount = (db.prepare(
      `SELECT COUNT(*) c FROM sales WHERE sale_date = ? AND status = 'completed'`
    ).get(todayStr) as any).c
    check('today-filter matches pulled sales (dashboard query)', todayCount >= 1, `${todayCount} for ${todayStr}`)
  }

  // 3. Incremental pull returns nothing new
  const inc = await pullTableV2('products')
  check('incremental pull is empty', inc.count === 0, `${inc.count}`)

  // 4. Invoice range leased at registration
  const inv1 = nextInvoiceNumber()
  check('invoice number from leased range', Boolean(inv1 && /-\d{6}$/.test(inv1!)), inv1 ?? 'null')

  // 5. Create local entities the way the screens do
  const contactSyncId = randomUUID()
  db.prepare(
    `INSERT INTO contacts (sync_id,name,phone,type,balance,loyalty_points_balance,created_at,updated_at)
     VALUES (?,?,?,'customer',0,0,?,?)`
  ).run(contactSyncId, 'Harness Customer', '+998 90 000 00 00', now, now)
  enqueueOutbox('contacts', contactSyncId, 'upsert')

  const sessionSyncId = randomUUID()
  db.prepare(
    `INSERT INTO pos_sessions (sync_id, store_id, terminal_id, user_id, state, opening_balance, opened_at, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,'opened',50000,?,?,?,'pending')`
  ).run(sessionSyncId, 1, 'E2E-HARNESS-1', login.user.id, now, now, now)
  enqueueOutbox('pos_sessions', sessionSyncId, 'upsert')

  // A sale against the first pulled product/batch/stock
  const stock = db.prepare(
    `SELECT ps.product_id, ps.batch_id, ps.quantity, p.name, b.price, b.cost
     FROM product_stocks ps JOIN products p ON p.id=ps.product_id JOIN product_batches b ON b.id=ps.batch_id
     WHERE ps.quantity > 5 LIMIT 1`
  ).get() as any
  check('found stocked product for sale', Boolean(stock))

  const saleSyncId = randomUUID()
  const invoiceNumber = nextInvoiceNumber()!
  const sessionRow = db.prepare(`SELECT id FROM pos_sessions WHERE sync_id=?`).get(sessionSyncId) as any
  const contactRow = db.prepare(`SELECT id FROM contacts WHERE sync_id=?`).get(contactSyncId) as any
  const total = stock.price * 2
  db.prepare(
    `INSERT INTO sales (sync_id, store_id, session_id, contact_id, user_id, invoice_number, sale_type,
      subtotal, discount, total_charge_amount, total_amount, amount_received, change_amount,
      status, payment_status, sale_date, sale_time, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,'sale',?,0,0,?,?,0,'completed','fully_paid',?,?,?,?,'pending')`
  ).run(saleSyncId, 1, sessionRow.id, contactRow.id, login.user.id, invoiceNumber,
    total, total, total, now.split('T')[0], now, now, now)
  const saleRow = db.prepare(`SELECT id FROM sales WHERE sync_id=?`).get(saleSyncId) as any
  db.prepare(
    `INSERT INTO sale_items (sale_id, item_type, product_id, batch_id, description, quantity, unit_price, unit_cost, created_at)
     VALUES (?,'product',?,?,?,2,?,?,?)`
  ).run(saleRow.id, stock.product_id, stock.batch_id, stock.name, stock.price, stock.cost ?? 0, now)
  db.prepare(
    `INSERT INTO payment_transactions (sale_id, store_id, session_id, transaction_date, amount, payment_method, transaction_type, charge_state, created_at)
     VALUES (?,?,?,?,?,'Cash','sale','FULLY_CHARGED',?)`
  ).run(saleRow.id, 1, sessionRow.id, now, total, now)
  enqueueOutbox('sales', saleSyncId, 'upsert')

  // 6. Flush and verify ordering handled contact+session before the sale
  const flush = await flushOutbox()
  console.log('   flush result:', JSON.stringify(flush))
  check('flush synced everything', flush.errors === 0 && flush.synced >= 3, `synced=${flush.synced} errors=${flush.errors}`)

  const contactAfter = db.prepare(`SELECT server_id FROM contacts WHERE sync_id=?`).get(contactSyncId) as any
  const sessionAfter = db.prepare(`SELECT server_id FROM pos_sessions WHERE sync_id=?`).get(sessionSyncId) as any
  const saleAfter = db.prepare(`SELECT server_id, sync_status, invoice_number FROM sales WHERE sync_id=?`).get(saleSyncId) as any
  check('contact got server_id', Boolean(contactAfter?.server_id))
  check('session got server_id', Boolean(sessionAfter?.server_id))
  check('sale synced with final invoice intact', saleAfter?.sync_status === 'synced' && saleAfter?.invoice_number === invoiceNumber,
    `${saleAfter?.invoice_number} vs ${invoiceNumber}`)

  // 7. Idempotent re-flush (mark row pending again → server must dedupe)
  db.prepare(`UPDATE sync_queue_local SET status='pending', next_retry_at=NULL WHERE sync_id=?`).run(saleSyncId)
  const reflush = await flushOutbox()
  check('re-flush idempotent', reflush.errors === 0, JSON.stringify(reflush))

  // 8. Server-side verification
  const verify = await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }).then((r) => r.json()) as any
  const saleCheck = await fetch(`${SERVER}/api/sales?page=1`, {
    headers: { Authorization: `Bearer ${verify.token}` },
  }).then((r) => r.json()) as any
  const serverSale = (saleCheck.items ?? saleCheck.sales ?? []).find?.((s: any) => s.syncId === saleSyncId)
  check('sale visible via server REST API', Boolean(serverSale), serverSale?.invoiceNumber)

  console.log(failures === 0 ? '\n🎉 ALL CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
