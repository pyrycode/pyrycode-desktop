import type { ElectronApplication } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { isTransientContextLoss } from './mainProcessRead'

type Kind = 'resume' | 'page'

/** A lost inspector acknowledgement cannot justify installing a second IPC listener. */
export async function installHistoryQueryEvidence(app: Pick<ElectronApplication, 'evaluate'>, kind: Kind): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let lost = false
    try {
      await app.evaluate(({ ipcMain }, kind) => {
        const state = globalThis as any
        const key = kind === 'resume' ? '__threadHistoryEvidence' : '__threadPageEvidence'
        const previous = state[key]
        if (previous !== undefined) {
          if (!ipcMain.listeners('pyry:command').includes(previous.listener)) throw new Error('History evidence registration changed')
          return // A late first evaluation cannot reset observations or duplicate the listener.
        }
        const asks: unknown[] = []
        const listener = (_event: unknown, command: any) => {
          if (command.type === 'queryThread') asks.push(kind === 'resume'
            ? { type: command.query.type, version: command.query.payload.version } : command.query.type)
          if (command.type === 'requestHistory') asks.push(kind === 'resume' ? { type: 'legacy' } : 'legacy')
        }
        state[key] = { listener }
        state[kind === 'resume' ? '__threadHistoryAsks' : '__threadPageAsks'] = asks
        ipcMain.on('pyry:command', listener)
      }, kind)
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      lost = true
    }
    const deadline = Date.now() + 5_000
    let installed: boolean
    for (;;) {
      try {
        installed = await app.evaluate(({ ipcMain }, kind) => {
          const state = (globalThis as any)[kind === 'resume' ? '__threadHistoryEvidence' : '__threadPageEvidence']
          if (state === undefined) return false
          if (!ipcMain.listeners('pyry:command').includes(state.listener)) throw new Error('History evidence registration changed')
          return true
        }, kind)
        break
      } catch (error) {
        if (!isTransientContextLoss(error) || Date.now() >= deadline) throw error
        await delay(100)
      }
    }
    if (installed) return
    if (!lost || attempt === 1) throw new Error('History evidence registration missing')
    // Conclusive absence permits a guarded installation. If the first evaluation
    // arrives late, the in-process identity check makes either ordering idempotent.
  }
}
