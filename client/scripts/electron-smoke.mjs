import { _electron } from '@playwright/test'

async function smoke(name, mainPath) {
  const app = await _electron.launch({ args: [mainPath] })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(3000)
  const rootText = await win.evaluate(() => document.getElementById('root')?.innerText?.slice(0, 200) ?? '')
  console.log(`[${name}] rootTextLen=${rootText.length} sample=${JSON.stringify(rootText.slice(0, 60))}`)
  if (!rootText.trim()) throw new Error(`${name}: empty root — renderer failed to mount`)
  if (errors.length) throw new Error(`${name}: page errors: ${errors.join('; ')}`)
  await app.close()
  console.log(`[${name}] OK`)
}

await smoke('POS', 'out/main/index.js')
await smoke('OFFICE', 'out-office/main/index.js')
console.log('ELECTRON SMOKE PASSED')
