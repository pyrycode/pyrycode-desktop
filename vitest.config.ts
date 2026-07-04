import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Mirrors the renderer aliases in electron.vite.config.ts so TSX tests resolve
// the same @renderer/@shared imports the app uses. Node environment: the render
// tests use renderToStaticMarkup, so no DOM harness is needed yet (deferred to #2).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    // Scope the unit run to src/ so vitest never walks e2e/ (Playwright specs).
    // vitest `include` REPLACES the default glob (not additive); every existing
    // *.test.ts(x) lives under src/, so none is dropped. This is one half of the
    // two-way separation from e2e; the other is testDir: './e2e' in playwright.config.ts.
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  }
})
