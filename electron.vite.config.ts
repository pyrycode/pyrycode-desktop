import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The running app's build string (#350), sourced from package.json's `version` and exposed to the
// renderer as the compile-time constant __APP_VERSION__. Read via readFileSync (not a JSON import) —
// this file is typechecked by tsconfig.node.json, which sets no resolveJsonModule, so `import pkg from
// './package.json'` would fail tsc. The SAME define lives in vitest.config.ts (that config is invisible
// to this one, so the test run needs its own copy or it throws ReferenceError at transform).
const appVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    plugins: [react()]
  }
})
