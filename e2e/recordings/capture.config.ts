import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { UserConfig } from 'vite'
import normal from '../../electron.vite.config'

// A separate build entry point prevents a runtime flag from enabling plaintext
// capture in a normal app. The command runner restores the normal build on exit.
const main = normal.main as UserConfig
export default defineConfig({ ...normal, main: { ...main, plugins: [
  ...main.plugins ?? [],
  { name: 'test-only-exchange-capture', enforce: 'pre', resolveId(source, importer) {
    if (source === './noiseSession' && importer?.replaceAll('\\', '/').endsWith('/src/main/transport/noiseRelayDriver.ts'))
      return resolve('e2e/fixtures/captureNoiseSession.ts')
    return null
  } }
] } })
