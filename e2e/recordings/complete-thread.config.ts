import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { UserConfig } from 'vite'
import normal, { buildProvenance } from '../../electron.vite.config'
import { pagingWriterTransform, pagingProtectedReadTransform, pagingAdmissionTransform, pagingTransactionTransform } from '../fixtures/pagingWriterTransform'

const renderer = normal.renderer as UserConfig
const main = normal.main as UserConfig
export default defineConfig({ ...normal,
  main: { ...main, plugins: [main.plugins?.filter(plugin => plugin && 'name' in plugin && plugin.name !== 'build-provenance'), buildProvenance('complete-thread'), {
    name: 'paging-protected-checkpoint', enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/main/indexedThreadHistory.ts')) return pagingProtectedReadTransform(source)
      if (id.endsWith('/src/main/chatHistoryHandler.ts')) return pagingAdmissionTransform(source)
      if (id.endsWith('/src/main/historyDatabase.ts')) return pagingTransactionTransform(source)
    }
  }] },
  renderer: { ...renderer, plugins: [...renderer.plugins ?? [], {
    name: 'paging-writer-checkpoints', enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/renderer/src/store/chatHistoryWriter.ts')) return pagingWriterTransform(source)
    }
  }], resolve: {
  ...renderer.resolve,
  alias: { '@renderer/threadDeliveryPolicy': resolve('e2e/recordings/completeThreadPolicy.ts'),
    ...renderer.resolve?.alias }
} } })
