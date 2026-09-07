import { _electron } from '@playwright/test'
const APP = process.env.APP // 'pos' | 'office'
const MAIN = APP === 'office' ? 'out-office/main/index.js' : 'out/main/index.js'
const SERVER = 'https://barakapos-server.onrender.com'
const PASS = process.env.PROD_ADMIN_PASSWORD
const results = []
const check = (l, c, e='') => { results.push([l,c]); console.log(`${c?'✅':'❌'} ${l}${e?` — ${e}`:''}`) }

const app = await _electron.launch({ args: [MAIN] })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(3000)

// Server URL field must be GONE — only username + password inputs remain.
const inputCount = await win.locator('input').count()
const bodyText0 = await win.locator('body').innerText()
check(`${APP}: no Server URL field on login`, !/Server URL/i.test(bodyText0))
check(`${APP}: login form has exactly 2 inputs (user+pass)`, inputCount === 2, `found ${inputCount}`)

// Log in (username + password only)
await win.locator('input').first().fill('admin')
await win.locator('input[type="password"]').fill(PASS)
await win.locator('button:has-text("Sign")').first().click()

// Wait for post-login (password field disappears)
let loggedIn = false
for (let i=0;i<25;i++){ if(!(await win.locator('input[type="password"]').count())){loggedIn=true;break} await win.waitForTimeout(2000) }
check(`${APP}: logged in against production`, loggedIn)

// Wait for production products to replicate
let seen = false
for (let i=0;i<40;i++){ if((await win.locator('body').innerText()).includes('Non (patir)')){seen=true;break} await win.waitForTimeout(2000) }
if (APP === 'office') {
  // office starts on dashboard — navigate to products
  if (!seen) { await win.locator('text=Products').first().click({timeout:15000}).catch(()=>{}); for (let i=0;i<25;i++){ if((await win.locator('body').innerText()).includes('Non (patir)')){seen=true;break} await win.waitForTimeout(2000) } }
}
const t = await win.locator('body').innerText()
check(`${APP}: replicated production products (Non/Choy/Suv)`, seen && t.includes('Choy Ahmad 100g') && t.includes('Suv Hydrolife 1.5L'))
check(`${APP}: NO stale local data (no Coca-Cola)`, !t.includes('Coca-Cola'))
if (!seen) console.log(`${APP} sample:`, t.slice(0,260).replace(/\n+/g,' | '))

await app.close()
const failed = results.filter(([,ok])=>!ok)
console.log(failed.length ? `\n💥 ${APP}: ${failed.length} FAILED` : `\n🎉 ${APP.toUpperCase()} PRODUCTION OK`)
process.exit(failed.length?1:0)
