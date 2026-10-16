import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'linux' && process.platform !== 'darwin') {
  console.error('history-native-smoke: unsupported-platform')
  process.exit(1)
}
const { build: bundle } = await import('vite')
const { default: builder } = await import('electron-builder')

// Packaging evidence only: no Linux/macOS release target or publication is added.
const root = resolve(process.argv[2] ?? `/tmp/builder-1979/native-${Date.now()}`)
const stage = join(root, 'app')
mkdirSync(stage, { recursive: true, mode: 0o700 })
const require = createRequire(import.meta.url)
const dependencies = new Set()
function copyDependency(name) {
  if (dependencies.has(name)) return
  dependencies.add(name)
  const source = require.resolve.paths('better-sqlite3').map(base => join(base, name)).find(path => existsSync(join(path, 'package.json')))
  if (!source) throw new Error('Missing smoke dependency')
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  cpSync(source, join(stage, 'node_modules', name), { recursive: true })
  for (const dependency of Object.keys(pkg.dependencies ?? {})) copyDependency(dependency)
}
copyDependency('better-sqlite3')
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'history-native-smoke', version: '0.0.0',
  description: 'Protected history packaged runtime check', author: 'Pyrycode', main: 'main.cjs',
  dependencies: { 'better-sqlite3': '12.4.1' } }))
await bundle({ configFile: false, logLevel: 'warn', build: { ssr: resolve('src/main/historyNativeSmoke.ts'),
  outDir: stage, emptyOutDir: false, rollupOptions: { external: ['electron', 'better-sqlite3'],
    output: { format: 'cjs', entryFileNames: 'main.cjs' } } } })
const platform = process.platform === 'darwin' ? builder.Platform.MAC : builder.Platform.LINUX
await builder.build({ projectDir: stage, targets: platform.createTarget('dir'), publish: 'never', config: {
  extends: null, appId: 'dev.pyrycode.history-smoke', productName: 'History Native Smoke',
  electronVersion: require('electron/package.json').version, directories: { app: stage, output: join(root, 'package') },
  files: ['main.cjs', 'package.json'], asar: true, asarUnpack: ['node_modules/better-sqlite3/**'],
  npmRebuild: true, mac: { identity: null }, linux: { executableName: 'history-native-smoke' } } })
const executable = process.platform === 'darwin'
  ? join(root, 'package', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'History Native Smoke.app', 'Contents/MacOS/History Native Smoke')
  : join(root, 'package', 'linux-unpacked', 'history-native-smoke')
const result = spawnSync(executable, [`--user-data-dir=${join(root, 'profile')}`], { encoding: 'utf8', timeout: 60000 })
writeFileSync(join(root, 'runtime.stdout'), result.stdout ?? '')
writeFileSync(join(root, 'runtime.stderr'), result.stderr ?? '')
const evidence = (result.stdout ?? '').split('\n').flatMap(line => {
  try { const value = JSON.parse(line); return value.executed === 1 ? [value] : [] } catch { return [] }
}).at(-1)
if (evidence) console.log(JSON.stringify(evidence))
console.log(`Evidence: ${root}`)
if (result.status !== 0 || !evidence || evidence.passed !== 1 || evidence.failed !== 0 || evidence.skipped !== 0) process.exit(1)
