import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

// A lost acknowledgement may follow a completed registration. Inspect listener identity
// before retrying setup; late callbacks must never reset the count or add a listener.
export async function installSavedTraversalReads(app: Pick<ElectronApplication, 'evaluate'>) {
  const evidence = { installationAttempts: 0, inspectionAttempts: 0, contextLosses: 0 }
  for (let attempt = 0; attempt < 2; attempt++) {
    let lost = false
    evidence.installationAttempts++
    try {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis as any
        if (state.__savedTraversalReads !== undefined) return
        const listener = (_event: unknown, record: { event: string; code?: string }) => {
          if (record.event === 'history-timeline-restore' && record.code === 'stored') state.savedReads++
        }
        state.savedReads = 0
        ipcMain.on('pyry:diagnostic', listener)
        state.__savedTraversalReads = listener
      })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      lost = true
      evidence.contextLosses++
    }
    let installed: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      evidence.inspectionAttempts++
      installed = await readMainProcess(app, ({ ipcMain }) => {
        const listener = (globalThis as any).__savedTraversalReads
        if (listener === undefined) return false
        if (ipcMain.listeners('pyry:diagnostic').filter(value => value === listener).length !== 1)
          throw new Error('Saved traversal listener changed')
        return true
      })
      if (installed !== NOT_YET_AVAILABLE) break
      evidence.contextLosses++
    }
    if (installed === true) return evidence
    if (installed === NOT_YET_AVAILABLE) throw new Error('Could not inspect saved traversal listener')
    if (!lost) throw new Error('Saved traversal listener missing after installation')
  }
  throw new Error('Could not install saved traversal listener')
}
