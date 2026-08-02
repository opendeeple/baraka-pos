/**
 * Sync protocol v2 smoke suite. Runs against a live dev server + database
 * (default http://localhost:3001, seeded admin/admin123) and cleans up after
 * itself. Usage: pnpm --filter server test:syncv2
 */
import { randomUUID } from 'crypto'

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3001'
let failures = 0

function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function json(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any }
}

async function main() {
  // --- auth + registration ---
  const login = await json('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
  check('admin login', login.status === 200)
  const jwt = { Authorization: `Bearer ${login.data.token}` }

  const unauth = await json('GET', '/api/sync/v2/pull?table=products')
  check('pull without device auth → 401', unauth.status === 401)

  const reg = await json('POST', '/api/devices/register', { name: 'SMOKE-DEVICE', platform: 'android-pos' }, jwt)
  check('device registration → 201 with one-time key', reg.status === 201 && Boolean(reg.data.deviceKey))
  const dev = { Authorization: `Device ${reg.data.deviceId}:${reg.data.deviceKey}` }

  const badKey = await json('GET', '/api/sync/v2/pull?table=products', undefined, {
    Authorization: `Device ${reg.data.deviceId}:wrong-key`,
  })
  check('wrong device key → 401', badKey.status === 401)

  // --- pull: store scoping, pagination, cursor ---
  const pull1 = await json('GET', '/api/sync/v2/pull?table=products&limit=5', undefined, dev)
  check('paginated pull', pull1.status === 200 && pull1.data.records.length === 5 && pull1.data.hasMore === true)
  check('records carry syncId + serverId', pull1.data.records.every((r: any) => r.syncId && r.id))
  check('records store-scoped to device store', pull1.data.records.every((r: any) => r.storeId === reg.data.storeId))

  const pull2 = await json(
    'GET',
    `/api/sync/v2/pull?table=products&cursor=${encodeURIComponent(pull1.data.nextCursor)}`,
    undefined,
    dev
  )
  const page1Ids = new Set(pull1.data.records.map((r: any) => r.id))
  check('cursor page 2 has no overlap with page 1', pull2.status === 200 && pull2.data.records.every((r: any) => !page1Ids.has(r.id)))

  const users = await json('GET', '/api/sync/v2/pull?table=users', undefined, dev)
  check('users pullable without passwordHash', users.status === 200 && users.data.records.length > 0 &&
    users.data.records.every((u: any) => !('passwordHash' in u)))

  // --- generic push: idempotency + LWW ---
  const contactSyncId = randomUUID()
  const t1 = new Date().toISOString()
  const push1 = await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'contacts', syncId: contactSyncId, op: 'upsert', clientUpdatedAt: t1,
      data: { name: 'Smoke Contact', type: 'customer' } }],
  }, dev)
  check('contact push applied', push1.status === 200 && push1.data.results[0].status === 'applied' && push1.data.results[0].serverId > 0)

  const pushStale = await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'contacts', syncId: contactSyncId, op: 'upsert', clientUpdatedAt: t1,
      data: { name: 'Stale Rename' } }],
  }, dev)
  check('stale re-push skipped (LWW) with serverId', pushStale.data.results[0].status === 'skipped-stale' &&
    pushStale.data.results[0].serverId === push1.data.results[0].serverId)

  const t2 = new Date(Date.now() + 60_000).toISOString()
  const pushNewer = await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'contacts', syncId: contactSyncId, op: 'upsert', clientUpdatedAt: t2,
      data: { name: 'Newer Rename' } }],
  }, dev)
  check('newer edit applied (LWW)', pushNewer.data.results[0].status === 'applied')

  const badFk = await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'product_batches', syncId: randomUUID(), op: 'upsert', clientUpdatedAt: t2,
      data: { productSyncId: randomUUID(), price: 1 } }],
  }, dev)
  check('unresolvable FK → per-change error', badFk.status === 200 && badFk.data.results[0].status === 'error')

  // --- tombstones ---
  const del = await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'contacts', syncId: contactSyncId, op: 'delete', clientUpdatedAt: new Date(Date.now() + 120_000).toISOString(), data: {} }],
  }, dev)
  check('delete push applied', del.data.results[0].status === 'applied')
  const contactsPull = await json('GET', '/api/sync/v2/pull?table=contacts', undefined, dev)
  const tombstone = contactsPull.data.records.find((c: any) => c.syncId === contactSyncId)
  check('tombstone visible in pull (deletedAt set)', Boolean(tombstone?.deletedAt))

  // --- invoice range: two leases never overlap ---
  const [lease1, lease2] = await Promise.all([
    json('POST', '/api/sync/v2/invoice-range', { count: 100 }, dev),
    json('POST', '/api/sync/v2/invoice-range', { count: 100 }, dev),
  ])
  const overlap = Math.max(lease1.data.start, lease2.data.start) <= Math.min(lease1.data.end, lease2.data.end)
  check('concurrent invoice leases disjoint', lease1.status === 200 && lease2.status === 200 && !overlap,
    `[${lease1.data.start}-${lease1.data.end}] vs [${lease2.data.start}-${lease2.data.end}]`)

  // --- sales push: session FK + idempotency + stock clamp path ---
  const sessionSyncId = randomUUID()
  const userSyncId = users.data.records[0].syncId
  await json('POST', '/api/sync/v2/push', {
    changes: [{ table: 'pos_sessions', syncId: sessionSyncId, op: 'upsert', clientUpdatedAt: t2,
      data: { userSyncId, terminalId: 'SMOKE-T1', state: 'opened', openingBalance: 0 } }],
  }, dev)
  const stocks = await json('GET', '/api/sync/v2/pull?table=product_stocks&limit=1', undefined, dev)
  const stockRec = stocks.data.records[0]
  const saleSyncId = randomUUID()
  const sale = {
    syncId: saleSyncId, userSyncId, sessionSyncId,
    invoiceNumber: `SMK-${Date.now()}`,
    saleType: 'sale', saleDate: new Date().toISOString(),
    subtotal: 10, discount: 0, totalChargeAmount: 0, totalAmount: 10,
    amountReceived: 10, changeAmount: 0, status: 'completed', paymentStatus: 'fully_paid',
    items: [{ productSyncId: stockRec.productSyncId, batchSyncId: stockRec.batchSyncId,
      description: 'smoke item', quantity: 1, unitPrice: 10, unitCost: 5 }],
    payments: [{ paymentMethod: 'Cash', amount: 10 }],
  }
  const salePush = await json('POST', '/api/sync/v2/sales', { sales: [sale] }, dev)
  check('sale push synced with client-final invoice', salePush.status === 200 &&
    salePush.data.synced[0]?.invoiceNumber === sale.invoiceNumber)
  const salePush2 = await json('POST', '/api/sync/v2/sales', { sales: [sale] }, dev)
  check('sale re-push idempotent (same serverId)', salePush2.data.synced[0]?.serverId === salePush.data.synced[0]?.serverId)

  const noSession = await json('POST', '/api/sync/v2/sales', {
    sales: [{ ...sale, syncId: randomUUID(), invoiceNumber: `SMK-X-${Date.now()}`, sessionSyncId: randomUUID() }],
  }, dev)
  check('sale with unknown session → per-sale error', noSession.data.errors.length === 1)

  // --- revocation ---
  await json('PUT', `/api/devices/${reg.data.deviceId}/revoke`, {}, jwt)
  const revoked = await json('GET', '/api/sync/v2/pull?table=products', undefined, dev)
  check('revoked device → 401', revoked.status === 401)

  // --- cleanup (direct prisma) ---
  const { prisma } = await import('../src/config/database')
  const saleId = salePush.data.synced[0]?.serverId
  if (saleId) {
    await prisma.cashLog.deleteMany({ where: { referenceId: saleId, source: 'sale' } })
    await prisma.paymentTransaction.deleteMany({ where: { saleId } })
    await prisma.saleItem.deleteMany({ where: { saleId } })
    await prisma.sale.delete({ where: { id: saleId } }).catch(() => {})
    // restore the decremented stock
    const productId = (await prisma.product.findUnique({ where: { syncId: stockRec.productSyncId } }))?.id
    const batchId = (await prisma.productBatch.findUnique({ where: { syncId: stockRec.batchSyncId } }))?.id
    if (productId && batchId) {
      await prisma.productStock.updateMany({
        where: { storeId: reg.data.storeId, productId, batchId },
        data: { quantity: { increment: 1 } },
      })
    }
  }
  await prisma.posSession.deleteMany({ where: { syncId: sessionSyncId } })
  await prisma.contact.deleteMany({ where: { syncId: contactSyncId } })
  await prisma.device.delete({ where: { id: reg.data.deviceId } }).catch(() => {})
  await prisma.$disconnect()

  console.log(failures === 0 ? '\n🎉 ALL SYNC V2 CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
