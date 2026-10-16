import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

// A lost acknowledgement does not tell us whether registration ran. Confirm the actual
// handler before activation; only conclusive absence permits another guarded installation.
export async function installHeldThreadRead(app: Pick<ElectronApplication, 'evaluate'>, operation = 'openThreadPage', skip = 0) {
  const evidence = { installationAttempts: 0, inspectionAttempts: 0, contextLosses: 0 }
  for (let attempt = 0; attempt < 2; attempt++) {
    let lost = false
    evidence.installationAttempts++
    try {
      await app.evaluate(({ ipcMain }, { operation, skip }) => {
        const state = globalThis as any
        const handlers = (ipcMain as any)._invokeHandlers as Map<string, Function>
        const original = handlers.get('pyry:chat-history')
        const existing = state.__heldThreadRead
        if (existing !== undefined) {
          const expected = existing.phase === 'released' ? existing.original : existing.handler
          if (original !== expected) throw new Error('Held thread read registration changed')
          return // Includes late execution while held or after restoration; never reset the counter.
        }
        if (original === undefined) throw new Error('Missing chat history handler')
        const marker = { original, handler: undefined as Function | undefined, phase: 'armed' }
        const handler = async (event: unknown, request: { operation: string }) => {
          const matches = request.operation === operation && marker.phase === 'armed'
          const hold = matches && skip-- <= 0
          if (hold) marker.phase = 'held' // Claim before awaiting the original; concurrent reads delegate.
          const result = await original(event, request)
          if (hold) {
            state.heldThreadReads++
            await new Promise<void>(resolve => ipcMain.once('test:release-thread-read', () => resolve()))
            ipcMain.removeHandler('pyry:chat-history')
            ipcMain.handle('pyry:chat-history', original)
            marker.phase = 'released'
          }
          return result
        }
        marker.handler = handler
        ipcMain.removeHandler('pyry:chat-history')
        ipcMain.handle('pyry:chat-history', handler)
        state.heldThreadReads = 0
        state.__heldThreadRead = marker
      }, { operation, skip })
    } catch (error) {
      if (!isTransientContextLoss(error)) throw new Error('Held thread read installation failed')
      lost = true
      evidence.contextLosses++
    }

    let installed: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      evidence.inspectionAttempts++
      try {
        installed = await readMainProcess<boolean>(app, ({ ipcMain }) => {
          const marker = (globalThis as any).__heldThreadRead
          if (marker === undefined) return false
          if (marker.phase !== 'armed' || (ipcMain as any)._invokeHandlers.get('pyry:chat-history') !== marker.handler)
            throw new Error('Held thread read registration changed')
          return true
        })
      } catch {
        throw new Error('Held thread read inspection failed')
      }
      if (installed !== NOT_YET_AVAILABLE) break
      evidence.contextLosses++
    }
    if (installed === true) return evidence
    if (installed === NOT_YET_AVAILABLE) throw new Error('Could not inspect held thread read handler')
    if (!lost) throw new Error('Held thread read handler missing after installation')
    if (attempt === 1) throw new Error('Could not install held thread read handler')
  }
  throw new Error('Unreachable held thread read setup state')
}
