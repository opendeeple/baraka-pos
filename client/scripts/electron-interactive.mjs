// Deeper desktop check than electron-smoke: drives the REAL office app
// through login → backoffice → opens and closes a migrated ui/Modal,
// asserting dialog semantics (role, focus trap entry, Escape-to-close).
// Needs the dev server running (SERVER_URL, default http://localhost:3002).
import { _electron } from '@playwright/test'

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3002'
const results = []
function check(label, cond, extra = '') {
  results.push([label, cond])
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
}

const app = await _electron.launch({ args: ['out-office/main/index.js'] })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)

// Login (restore may auto-skip if a cached session exists)
const loginVisible = await win.locator('input[type="password"]').count()
if (loginVisible) {
  const url = win.locator('input').first()
  await url.fill(SERVER)
  await win.locator('input').nth(1).fill('admin')
  await win.locator('input[type="password"]').fill('admin123')
  await win.locator('button[type="submit"], button:has-text("Sign")').first().click()
  await win.waitForTimeout(4000)
}
check('office logged in (backoffice visible)', (await win.locator('text=Dashboard').count()) > 0)

// Products screen → open the migrated Modal
await win.locator('a:has-text("Products"), [href*="products"]').first().click()
await win.waitForTimeout(1200)
const addBtn = win.locator('button:has-text("Add"), button:has-text("New")').first()
check('products screen has an add button', (await addBtn.count()) > 0)
await addBtn.click()
await win.waitForTimeout(600)

const dialog = win.locator('[role="dialog"]')
check('modal opens with role="dialog"', (await dialog.count()) > 0)
check('modal is aria-modal', (await dialog.first().getAttribute('aria-modal')) === 'true')

// Focus trap entry: focused element must be INSIDE the dialog
const focusInside = await win.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return d ? d.contains(document.activeElement) : false
})
check('focus moved inside the modal', focusInside)

// Escape closes it
await win.keyboard.press('Escape')
await win.waitForTimeout(500)
check('Escape closes the modal', (await win.locator('[role="dialog"]').count()) === 0)

// Body scroll unlock restored
const bodyOverflow = await win.evaluate(() => document.body.style.overflow)
check('body scroll restored after close', bodyOverflow !== 'hidden')

await app.close()
const failed = results.filter(([, ok]) => !ok)
if (failed.length) {
  console.error(`\n${failed.length} FAILED`)
  process.exit(1)
}
console.log('\n🎉 DESKTOP INTERACTIVE CHECKS PASSED')
