import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Mirrors the renderer aliases in electron.vite.config.ts so TSX tests resolve
// the same @renderer/@shared imports the app uses. Node environment: the render
// tests use renderToStaticMarkup, so no DOM harness is needed yet (deferred to #2).

// __APP_VERSION__ (#350): this config is a SEPARATE Vite config from electron.vite.config.ts, so its
// `define` is invisible here. Without this mirror the renderer's __APP_VERSION__ reference is undefined
// at transform time and the test throws ReferenceError. Read from package.json exactly as the sibling.
const appVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    // vitest `include` REPLACES the default glob (not additive), so every file
    // that must run here has to be named by a pattern below.
    //
    // The separation from Playwright used to be by DIRECTORY (src/ vs e2e/). #933
    // needs a pure harness decision — declared capabilities in, skip-or-not out —
    // covered by unit tests while the function itself lives beside the fixture that
    // calls it, so the separation is now by SUFFIX inside e2e/: `.test.ts` is
    // vitest's, `.spec.ts` is Playwright's. Deliberately NOT `e2e/**/*.spec.ts` —
    // that glob would hand vitest the whole Playwright suite. The other half of the
    // invariant is the matching `testMatch` in playwright.config.ts.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.test.ts', 'scripts/**/*.test.ts']
  }
})
