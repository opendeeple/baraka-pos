// Metro config for the pnpm monorepo.
//
// Workspace packages (@baraka/*) declare `"react-native": "src/index.ts"` in
// their package.json, so Metro bundles them from TS source without a global
// `source`-first main-field override (which would wrongly pick the shipped TS
// sources of published packages like expo itself). Hierarchical lookup stays
// ON — pnpm's virtual store (.pnpm/<pkg>/node_modules/<dep>) depends on it.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Singleton guard: workspace packages peer-depend on these, and pnpm's
// auto-installed peers can materialize the WRONG copy inside
// packages/*/node_modules (e.g. the desktop's react 18). Force every request
// for a runtime-singleton module to resolve from THIS app's node_modules so
// exactly one copy is ever bundled.
const SINGLETONS = new Set([
  'react',
  'react-native',
  'react-native-svg',
  'react-native-safe-area-context',
  'expo-haptics',
  'expo-sqlite',
  'expo-crypto',
  'lucide-react-native',
  'zustand',
])
const appOrigin = path.join(projectRoot, 'package.json')
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const head = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0]
  const ctx =
    SINGLETONS.has(head) && !context.originModulePath.startsWith(projectRoot)
      ? { ...context, originModulePath: appOrigin }
      : context
  return (defaultResolveRequest ?? ctx.resolveRequest)(ctx, moduleName, platform)
}

module.exports = config
