import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

// Single-consumer interception for disconnected-message-delivery.spec.ts. This function is
// serialized by Playwright; its dependencies must all come from the Electron main process.
export function installDeliveryInterception({ ipcMain, app: electronApp }: typeof import('electron')): void {
  const listeners = ipcMain.listeners('pyry:command') as Parameters<typeof ipcMain.on>[1][]
  ipcMain.removeAllListeners('pyry:command')
  const pending: { event: import('electron').IpcMainEvent; command: any }[] = []
  ipcMain.on('pyry:command', (event, command) => {
    if (command.type === 'sendMessage') pending.push({ event, command })
    else for (const listener of listeners) listener(event, command)
  })
  const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
  const { createRequire } = process.getBuiltinModule('module') as typeof import('node:module')
  const { WebSocket } = createRequire(`${electronApp.getAppPath()}/package.json`)('ws')
  const originalSend = WebSocket.prototype.send
  let socketWrites = 0
  WebSocket.prototype.send = function (...args: any[]) {
    socketWrites += 1
    return originalSend.apply(this, args)
  }
  const original = fs.readFile
  let release: () => void = () => {}
  let reject: () => void = () => {}
  let released = false
  let restored = false
  const gate = new Promise<void>((resolve, fail) => {
    release = () => { released = true; resolve() }
    reject = () => { released = true; fail(new Error('synthetic pairing read failure')) }
  })
  const pairingFile = Buffer.from('pyrycode.paired_server').toString('base64url') + '.bin'
  fs.readFile = (async (file: any, options: any) => {
    if (String(file).endsWith(pairingFile)) await gate
    return original(file, options)
  }) as typeof fs.readFile
  ;(globalThis as any).__delivery1853 = {
    pending,
    socketWrites: () => socketWrites,
    forward: () => { for (const { event, command } of pending.splice(0)) for (const listener of listeners) listener(event, command) },
    resume: (fail: boolean) => { fs.readFile = original; if (fail) reject(); else release() },
    restore: () => {
      if (restored) return // A late evaluation must not register the original listeners twice.
      fs.readFile = original
      WebSocket.prototype.send = originalSend
      release()
      ipcMain.removeAllListeners('pyry:command')
      for (const listener of listeners) ipcMain.on('pyry:command', listener)
      restored = true
    },
    isRestored: () => {
      const current = ipcMain.listeners('pyry:command')
      return restored && released && fs.readFile === original && WebSocket.prototype.send === originalSend
        && current.length === listeners.length && current.every((listener, index) => listener === listeners[index])
    }
  }
}

export async function readDeliveryObservation<T>(app: Pick<ElectronApplication, 'evaluate'>,
  read: (electron: typeof import('electron')) => T): Promise<T> {
  for (let inspection = 0; inspection < 3; inspection++) {
    const value = await readMainProcess<T>(app, read)
    if (value !== NOT_YET_AVAILABLE) return value
  }
  throw new Error('Could not inspect delivery observation')
}

async function restoreDelivery(app: Pick<ElectronApplication, 'evaluate'>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let lost = false
    try {
      await app.evaluate(() => (globalThis as any).__delivery1853?.restore())
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
      lost = true
    }
    let confirmed: boolean | typeof NOT_YET_AVAILABLE = NOT_YET_AVAILABLE
    for (let inspection = 0; inspection < 3; inspection++) {
      confirmed = await readMainProcess<boolean>(app, () => {
        const marker = (globalThis as any).__delivery1853
        return marker === undefined || marker.isRestored()
      })
      if (confirmed !== NOT_YET_AVAILABLE) break
    }
    if (confirmed === true) return
    if (confirmed === NOT_YET_AVAILABLE) throw new Error('Could not confirm delivery cleanup')
    // Only conclusive non-restoration after a lost acknowledgement allows guarded recovery.
    if (!lost || attempt === 1) throw new Error('Delivery cleanup did not restore interception')
  }
}

export async function withDeliveryCleanup(app: Pick<ElectronApplication, 'evaluate'>,
  body: () => Promise<void>): Promise<void> {
  let failed = false
  let primary: unknown
  try { await body() }
  catch (error) { failed = true; primary = error }
  try { await restoreDelivery(app) }
  catch (cleanup) {
    if (failed) {
      // Playwright retains message/stack, not AggregateError.errors. Include both original stacks
      // in the report as well as keeping the original thrown values for structured inspection.
      const details = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error)
      throw new AggregateError([primary, cleanup], [
        'Delivery scenario and cleanup both failed',
        'Original failure:', details(primary), 'Cleanup failure:', details(cleanup)
      ].join('\n'))
    }
    throw cleanup
  }
  if (failed) throw primary
}
