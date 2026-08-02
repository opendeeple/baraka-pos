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

module.exports = config
