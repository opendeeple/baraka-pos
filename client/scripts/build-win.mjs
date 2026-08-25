// Cross-builds the Windows NSIS installers (POS + Office) from macOS/Linux.
//
// Why a staging dir: electron-builder does not follow transitive dependencies
// through pnpm's symlinked node_modules — packages like bindings/fs-extra/
// iconv-lite silently vanish from the asar and the app crashes at startup on
// Windows. We stage a flat `npm install` of just the main-process runtime deps
// (renderer deps are already bundled by vite) and build from there.
//
// Also handles the two other cross-build traps:
//  - usb@3 (napi-rs) ships no binaries in the main package; the win32 binding
//    is fetched from @node-usb/usb-win32-x64-msvc and dropped next to index.js.
//  - better-sqlite3/keytar win32 prebuilds are fetched by electron-builder via
//    prebuild-install (installed transitively in the flat tree).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const clientDir = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const req = createRequire(path.join(clientDir, 'package.json'))
const clientPkg = req('./package.json')
const stage = path.join(clientDir, '.win-staging')
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })

const RUNTIME_DEPS = Object.keys(clientPkg.dependencies)
const deps = {}
const readVersion = (name) =>
  JSON.parse(fs.readFileSync(path.join(clientDir, 'node_modules', name, 'package.json'), 'utf8')).version
for (const name of RUNTIME_DEPS) deps[name] = readVersion(name)
const electronVersion = readVersion('electron')

fs.rmSync(path.join(stage, 'out'), { recursive: true, force: true })
fs.rmSync(path.join(stage, 'out-office'), { recursive: true, force: true })
fs.mkdirSync(stage, { recursive: true })
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'client',
  version: clientPkg.version,
  private: true,
  description: 'BarakaPOS',
  author: 'BarakaPOS',
  main: clientPkg.main,
  dependencies: deps,
  devDependencies: { electron: electronVersion },
  build: clientPkg.build,
}, null, 2))

for (const item of ['out', 'out-office', 'resources', 'electron-builder.office.json']) {
  fs.cpSync(path.join(clientDir, item), path.join(stage, item), { recursive: true })
}

console.log('>> npm install (flat tree, full transitive closure)')
run('npm install --ignore-scripts --no-audit --no-fund --loglevel=error', stage)
// Sanity: the exact packages whose absence crashed earlier builds.
for (const probe of ['bindings', 'fs-extra', 'iconv-lite', 'qr-image', 'prebuild-install']) {
  if (!fs.existsSync(path.join(stage, 'node_modules', probe))) {
    throw new Error(`transitive dep missing from staged tree: ${probe}`)
  }
}

console.log('>> fetching win32 usb binding')
const usbVersion = deps.usb
run(`npm pack @node-usb/usb-win32-x64-msvc@${usbVersion} --silent`, stage)
run(`tar xzf node-usb-usb-win32-x64-msvc-${usbVersion}.tgz package/usb.win32-x64-msvc.node`, stage)
fs.copyFileSync(path.join(stage, 'package/usb.win32-x64-msvc.node'),
  path.join(stage, 'node_modules/usb/usb.win32-x64-msvc.node'))

const builder = path.join(clientDir, 'node_modules/.bin/electron-builder')
console.log('>> building POS installer')
run(`"${builder}" --win --x64 --projectDir "${stage}"`, clientDir)
console.log('>> building Office installer')
run(`"${builder}" --win --x64 --config electron-builder.office.json --projectDir "${stage}"`, clientDir)

// Verify every shipped native module is a Windows PE binary.
for (const dist of ['dist', 'dist-office']) {
  const unpacked = path.join(stage, dist, 'win-unpacked/resources/app.asar.unpacked')
  const nodes = execSync(`find "${unpacked}" -name '*.node'`).toString().trim().split('\n')
  for (const n of nodes) {
    const kind = execSync(`file -b "${n}"`).toString()
    if (!kind.includes('PE32+')) throw new Error(`non-Windows binary shipped: ${n}: ${kind}`)
  }
  console.log(`>> ${dist}: ${nodes.length} native modules, all PE32+`)
}
console.log(`\nInstallers:\n  ${path.join(stage, 'dist')}\n  ${path.join(stage, 'dist-office')}`)
