import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

// Single-consumer setup: an ambiguous mutation acknowledgement needs actual registration evidence.
// Never pass the installation callback to readMainProcess or retry it without confirmed absence.
export async function installUnreadableLocalList(app: Pick<ElectronApplication, 'evaluate'>) {
  const evidence = { installationAttempts: 0, inspectionAttempts: 0, contextLosses: 0 }
  for (let attempt = 0; attempt < 2; attempt++) {
    let installationLoss: unknown
    evidence.installationAttempts++
    try {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis as typeof globalThis & { __localListFailureHandler?: Function }
        const handlers = (ipcMain as any)._invokeHandlers as Map<string, Function>
        const current = handlers.get('pyry:chat-history')
        if (state.__localListFailureHandler !== undefined) {
          if (current !== state.__localListFailureHandler) throw new Error('Local-list failure handler changed')
          return // A late callback must not wrap an already-installed wrapper.
        }
        if (current === undefined) throw new Error('Missing chat history handler')
        const handler = (event: unknown, request: { operation: string }) => request.operation === 'readList'
          ? { status: 'error', code: 'unreadable' }
          : current(event, request)
        ipcMain.removeHandler('pyry:chat-history')
        ipcMain.handle('pyry:chat-history', handler)
        state.__localListFailureHandler = handler
      })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      installationLoss = error
      evidence.contextLosses++
    }

    let installed: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      evidence.inspectionAttempts++
      installed = await readMainProcess(app, ({ ipcMain }) => {
        const state = globalThis as typeof globalThis & { __localListFailureHandler?: Function }
        if (state.__localListFailureHandler === undefined) return false
        const current = (ipcMain as any)._invokeHandlers.get('pyry:chat-history')
        if (current !== state.__localListFailureHandler) throw new Error('Local-list failure handler changed')
        return true
      })
      if (installed !== NOT_YET_AVAILABLE) break
      evidence.contextLosses++
    }
    if (installed === true) return evidence
    if (installed === NOT_YET_AVAILABLE) throw new Error('Could not inspect unreadable local-list handler')
    if (installationLoss === undefined) throw new Error('Unreadable local-list handler missing after installation')
    if (attempt === 1) throw new Error('Could not install unreadable local-list handler', { cause: installationLoss })
    // Explicit absence is the only path to another guarded installation evaluation.
  }
  throw new Error('Unreachable local-list setup state')
}
