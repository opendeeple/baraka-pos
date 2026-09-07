// Both REAL desktop apps vs the PRODUCTION server. Run WITHOUT the sandbox
// (node/electron network egress is blocked under it; curl is not).
import { _electron } from '@playwright/test'
const SERVER = 'https://barakapos-server.onrender.com'
const PASS = process.env.PROD_ADMIN_PASSWORD
if (!PASS) throw new Error('PROD_ADMIN_PASSWORD required')
const results = []
const check = (l, c, e = '') => { results.push([l, c]); console.log(`${c ? '✅' : '❌'} ${l}${e ? ` — ${e}` : ''}`) }

async function login(win) {
  await win.waitForTimeout(2500)
  if (await win.locator('input[type="password"]').count()) {
    await win.locator('input').first().fill(SERVER)
    await win.locator('input').nth(1).fill('admin')
    await win.locator('input[type="password"]').fill(PASS)
    await win.locator('button:has-text("Sign")').first().click()
  }
  // wait out cold start + first sync
  for (let i = 0; i < 40; i++) {
    if (!(await win.locator('input[type="password"]').count())) break
    await win.waitForTimeout(3000)
  }
}
async function waitForText(win, needle, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if ((await win.locator('body').innerText()).includes(needle)) return true
    await win.waitForTimeout(3000)
  }
  return false
}

// OFFICE
{
  const app = await _electron.launch({ args: ['out-office/main/index.js'] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await login(win)
  check('office logged in vs production', (await win.locator('body').innerText()).includes('Dashboard'))
  // products replicate through sync — navigate then poll
  await win.locator('nav >> text=Products, a:has-text("Products")').first().click({ timeout: 60000 }).catch(async () => {
    await win.locator('text=Products').first().click({ timeout: 60000 }).catch(() => {})
  })
  const gotProducts = await waitForText(win, 'Non (patir)')
  const t = await win.locator('body').innerText()
  check('office replicated all 3 production products', gotProducts && t.includes('Choy Ahmad 100g') && t.includes('Suv Hydrolife 1.5L'))
  check('office shows post-sale stock (48)', /\b48\b/.test(t))
  await win.locator('text=Sales').first().click({ timeout: 60000 }).catch(() => {})
  check('office sales shows BRK-000001', await waitForText(win, 'BRK-000001'))
  await app.close()
}

// POS
{
  const app = await _electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await login(win)
  check('pos logged in vs production (no password field)', (await win.locator('input[type="password"]').count()) === 0)
  const gotGrid = await waitForText(win, 'Non (patir)')
  const t = await win.locator('body').innerText()
  check('pos product grid shows production items', gotGrid && t.includes('Choy Ahmad 100g'))
  if (!gotGrid) console.log('POS sample:', t.slice(0, 300).replace(/\n+/g, ' | '))
  await app.close()
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length ? `\n💥 ${failed.length} FAILED` : '\n🎉 DESKTOP PRODUCTION CHECKS PASSED')
process.exit(failed.length ? 1 : 0)
