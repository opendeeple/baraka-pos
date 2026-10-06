// End-to-end check of the startup reconciliation (the sync engine's
// refreshFromServer). A device's data is a cache of the server's, so after a
// server-side wipe it must drop what the server lost, keep what never reached
// the server, send the still-open register again, and never undo an edit it
// hasn't pushed yet. Runs like test:sync (ELECTRON_RUN_AS_NODE):
//   pnpm --filter client test:reconcile
// with SERVER_URL (default http://localhost:3001) and DATABASE_URL set to that
// server's database. It WIPES that database (the go-live reset migration), so
// it refuses any DATABASE_URL that isn't on localhost.
import Database from 'better-sqlite3'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { runMigrations, setDbInstance } from '../electron/services/db.service'
import {
  setTerminalToken,
  pullTableV2,
  flushOutbox,
  enqueueOutbox,
  refreshFromServer,
  PULL_TABLE_ORDER,
} from '../electron/services/sync.service'

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3001'
const DATABASE_URL = process.env.DATABASE_URL ?? ''
const SERVER_DIR = resolve(__dirname, '../../server')
const WIPE_SQL = resolve(SERVER_DIR, 'src/prisma/migrations/20261009100000_reset_all_data_again/migration.sql')

let failures = 0
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

function serverSql(sql: string): void {
  const file = join(mkdtempSync(join(tmpdir(), 'reconcile-')), 'run.sql')
  writeFileSync(file, sql)
  execSync(`npx prisma db execute --file "${file}" --schema src/prisma/schema.prisma`, {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  })
}

async function main() {
  const host = (() => { try { return new URL(DATABASE_URL).hostname } catch { return '' } })()
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    console.error('Refusing to run: DATABASE_URL must point at a local test database — this harness wipes it.')
    process.exit(2)
  }

  const db = new Database(':memory:')
  setDbInstance(db as never)
  runMigrations(db as never)
  const now = () => new Date().toISOString()
  const get = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as any
  const count = (sql: string, ...params: unknown[]) => get(sql, ...params).c as number
  const pullAll = async () => { for (const table of PULL_TABLE_ORDER) await pullTableV2(table) }
  for (const [k, v] of [['server_url', SERVER], ['store_id', '1'], ['terminal_id', 'E2E-RECONCILE-1']]) {
    db.prepare(`INSERT OR REPLACE INTO settings (store_id, meta_key, meta_value, updated_at) VALUES (1,?,?,?)`).run(k, v, now())
  }

  // 1. Sign in and take a full copy
  const login = await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' }),
  }).then((r) => r.json()) as any
  check('admin login', Boolean(login.token))
  await setTerminalToken(login.token, login.user.role)
  await pullAll()
  const products = count(`SELECT COUNT(*) c FROM products`)
  check('products pulled', products >= 20, `${products}`)

  // 2. Server and device agree: nothing is dropped
  const calm = await refreshFromServer()
  await pullAll()
  check('nothing dropped while server and device agree', !calm.skipped && Object.keys(calm.removed).length === 0, JSON.stringify(calm))
  check('products intact after the startup re-pull', count(`SELECT COUNT(*) c FROM products`) === products)

  // 3. A server change no cursor sees (older updatedAt): only the startup re-pull brings it
  const drift = get(`SELECT sync_id FROM products ORDER BY id LIMIT 1`).sync_id as string
  serverSql(`UPDATE products SET name = 'Drifted on server', "updatedAt" = '2000-01-01' WHERE "syncId" = '${drift}';`)
  await pullTableV2('products')
  check('incremental pull misses the drift', get(`SELECT name FROM products WHERE sync_id=?`, drift).name !== 'Drifted on server')
  await refreshFromServer()
  await pullTableV2('products')
  check('startup re-pull brings the drift', get(`SELECT name FROM products WHERE sync_id=?`, drift).name === 'Drifted on server')

  // 4. An edit not pushed yet (the till is offline) survives the re-pull
  const edited = get(`SELECT id, sync_id FROM products ORDER BY id LIMIT 1 OFFSET 1`)
  db.prepare(`UPDATE products SET name='Edited here', updated_at=? WHERE id=?`).run(now(), edited.id)
  enqueueOutbox('products', edited.sync_id, 'upsert')
  db.prepare(`UPDATE sync_queue_local SET next_retry_at='2999-01-01T00:00:00.000Z' WHERE sync_id=? AND status='pending'`).run(edited.sync_id)
  const held = await refreshFromServer()
  check('reconcile waits while something is unsent', held.skipped === 'unsent-changes', JSON.stringify(held))
  await pullTableV2('products')
  check('unsent edit not overwritten by the re-pull', get(`SELECT name FROM products WHERE id=?`, edited.id).name === 'Edited here')
  db.prepare(`UPDATE sync_queue_local SET next_retry_at=NULL WHERE sync_id=?`).run(edited.sync_id)
  const sentEdit = await flushOutbox()
  check('held edit pushed once back online', sentEdit.errors === 0 && sentEdit.synced >= 1, JSON.stringify(sentEdit))

  // 5. Rows a wipe must treat differently
  const contactSyncId = randomUUID()
  db.prepare(
    `INSERT INTO contacts (sync_id, name, phone, type, balance, loyalty_points_balance, created_at, updated_at)
     VALUES (?, 'Reconcile Customer', '+998 90 111 11 11', 'customer', 0, 0, ?, ?)`
  ).run(contactSyncId, now(), now())
  enqueueOutbox('contacts', contactSyncId, 'upsert')
  const closedSyncId = randomUUID()
  db.prepare(
    `INSERT INTO pos_sessions (sync_id, store_id, terminal_id, user_id, state, opening_balance, opened_at, closed_at, created_at, updated_at)
     VALUES (?, 1, 'E2E-RECONCILE-1', ?, 'closed', 0, ?, ?, ?, ?)`
  ).run(closedSyncId, login.user.id, now(), now(), now(), now())
  enqueueOutbox('pos_sessions', closedSyncId, 'upsert')
  const openSyncId = randomUUID()
  db.prepare(
    `INSERT INTO pos_sessions (sync_id, store_id, terminal_id, user_id, state, opening_balance, opened_at, created_at, updated_at)
     VALUES (?, 1, 'E2E-RECONCILE-1', ?, 'opened', 50000, ?, ?, ?)`
  ).run(openSyncId, login.user.id, now(), now(), now())
  enqueueOutbox('pos_sessions', openSyncId, 'upsert')
  const openId = get(`SELECT id FROM pos_sessions WHERE sync_id=?`, openSyncId).id
  const cashSyncId = randomUUID()
  db.prepare(
    `INSERT INTO cash_logs (sync_id, store_id, session_id, transaction_type, amount, source, description, created_by, created_at, updated_at)
     VALUES (?, 1, ?, 'cash_in', 10000, 'deposit', 'Float top-up', ?, ?, ?)`
  ).run(cashSyncId, openId, login.user.id, now(), now())
  enqueueOutbox('cash_logs', cashSyncId, 'upsert')
  const contactId = get(`SELECT id FROM contacts WHERE sync_id=?`, contactSyncId).id
  // A device's own debt baseline: never sent anywhere, by design.
  const baselineSyncId = randomUUID()
  db.prepare(`INSERT INTO debt_clearances (sync_id, contact_id, cleared_at) VALUES (?, ?, ?)`).run(baselineSyncId, contactId, now())
  const sent = await flushOutbox()
  check('test rows pushed', sent.errors === 0 && sent.synced >= 4, JSON.stringify(sent))

  // 6. The server is wiped. Rows written on the server in the last few
  // seconds before an id listing are left for the next start to judge (the
  // engine's RECONCILE_COMMIT_SLACK_MS), so let a freshly seeded server age.
  await new Promise((r) => setTimeout(r, 11_000))
  serverSql(readFileSync(WIPE_SQL, 'utf8'))
  const wiped = await refreshFromServer()
  console.log('   after wipe:', JSON.stringify(wiped))
  check('products the server lost are dropped', (wiped.removed.products ?? 0) >= products && count(`SELECT COUNT(*) c FROM products`) === 0,
    `${count(`SELECT COUNT(*) c FROM products`)} left`)
  check('their batches and stock go with them', count(`SELECT COUNT(*) c FROM product_batches`) === 0 && count(`SELECT COUNT(*) c FROM product_stocks`) === 0)
  check('pushed customer the server lost is dropped', count(`SELECT COUNT(*) c FROM contacts WHERE sync_id=?`, contactSyncId) === 0)
  check('closed register the server lost is dropped', count(`SELECT COUNT(*) c FROM pos_sessions WHERE sync_id=?`, closedSyncId) === 0)
  check('open register kept', count(`SELECT COUNT(*) c FROM pos_sessions WHERE sync_id=?`, openSyncId) === 1)
  check('its cash movement kept', count(`SELECT COUNT(*) c FROM cash_logs WHERE sync_id=?`, cashSyncId) === 1)
  check('both queued to be sent again, nothing else', wiped.resent === 2 &&
    count(`SELECT COUNT(*) c FROM sync_queue_local WHERE status='pending' AND sync_id IN (?, ?)`, openSyncId, cashSyncId) === 2)
  check('local-only debt baseline kept', count(`SELECT COUNT(*) c FROM debt_clearances WHERE sync_id=?`, baselineSyncId) === 1)

  const resent = await flushOutbox()
  check('open register re-sent', resent.errors === 0 && resent.synced >= 2, JSON.stringify(resent))
  const listed = await fetch(`${SERVER}/api/sync/v2/ids?table=pos_sessions`, {
    headers: { Authorization: `Bearer ${login.token}` },
  }).then((r) => r.json()) as any
  check('server has the open register again', (listed.ids ?? []).includes(openSyncId))

  // 7. The next start finds nothing to drop
  const again = await refreshFromServer()
  check('next start drops nothing', !again.skipped && Object.keys(again.removed).length === 0, JSON.stringify(again))

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
