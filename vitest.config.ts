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
    environment: 'node'
  }
})
