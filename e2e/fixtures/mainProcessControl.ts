import { randomUUID } from 'node:crypto'
import { serialize, deserialize } from 'node:v8'
import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss } from './mainProcessRead'

type Session = { send(method: string, params: { expression: string; includeCommandLineAPI: boolean;
  returnByValue: boolean; awaitPromise: boolean }): Promise<{ result: { value?: unknown }; exceptionDetails?: unknown }> }
type Request = { registry: string; id: string; source: string; argument: string; expires: number }
type Receipt = { state: 'pending' | 'expired' } | { state: 'completed' | 'failed'; result: string }

// Serialized into the local application's inspector. Every runtime dependency is owned here.
// The inspector only returns synchronous receipts; it never owns an awaited operation promise.
// Register before calling the callback, and retain its outcome until this operation's deadline.
function dispatch(request: Request): Receipt {
  if (Date.now() >= request.expires) return { state: 'expired' }
  const host = globalThis as any
  const registry = host[request.registry] ??= new Map()
  let entry = registry.get(request.id)
  if (entry) return entry.receipt
  entry = { receipt: { state: 'pending' } }
  registry.set(request.id, entry)
  const timer = setTimeout(() => {
    registry.delete(request.id)
    if (registry.size === 0) delete host[request.registry]
  }, request.expires - Date.now())
  timer.unref?.()
  const { serialize, deserialize } = require('node:v8')
  const finish = (state: 'completed' | 'failed', value: unknown): void => {
    try { entry.receipt = { state, result: serialize(value).toString('base64') } }
    // Match ElectronApplication.evaluate: a non-serializable return (e.g. EventEmitter returned
    // by removeListener) is undefined. A thrown non-serializable value is still a failure.
    catch { entry.receipt = state === 'completed'
      ? { state, result: serialize(undefined).toString('base64') }
      : { state: 'failed', result: serialize(Error('Main-process callback failed')).toString('base64') } }
  }
  try {
    const callback = (0, eval)(`(${request.source})`)
    const value = callback(require('electron'), deserialize(Buffer.from(request.argument, 'base64')))
    if (value && typeof value.then === 'function') {
      // A strong app-owned reference also covers operations pending across several receipt reads.
      entry.promise = Promise.resolve(value).then(value => finish('completed', value), error => finish('failed', error))
    } else finish('completed', value)
  } catch (error) { finish('failed', error) }
  return entry.receipt
}

/** Client-owned callbacks only. The registry is unique to this launched application. */
export function createMainProcessControl(session: Session, options: { timeoutMs?: number; pollMs?: number } = {}) {
  const registry = `__pyryTestControl_${randomUUID()}`
  return {
    async evaluate<T, A = undefined>(callback: (electron: typeof import('electron'), arg: A) => T | Promise<T>, argument?: A): Promise<T> {
      const timeoutMs = options.timeoutMs ?? 30_000
      const request: Request = { registry, id: randomUUID(), source: callback.toString(),
        argument: serialize(argument).toString('base64'), expires: Date.now() + timeoutMs }
      const expression = `(${dispatch.toString()})(${JSON.stringify(request)})`
      const expired = (): Error => Error('Main-process control timed out')
      for (;;) {
        const remaining = request.expires - Date.now()
        if (remaining <= 0) throw expired()
        let timer: ReturnType<typeof setTimeout> | undefined
        let receipt: Receipt | undefined
        try {
          const response = await Promise.race([
            session.send('Runtime.evaluate', { expression, includeCommandLineAPI: true, returnByValue: true, awaitPromise: false }),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(expired()), remaining) })
          ])
          if (response.exceptionDetails !== undefined) throw Error('Main-process control dispatch failed')
          receipt = response.result.value as Receipt
          if (!receipt || receipt.state === 'expired') throw expired()
        } catch (error) {
          if (!isTransientContextLoss(error) && !(error instanceof Error &&
            error.message.includes('Protocol error') && error.message.includes('Promise was collected'))) throw error
        } finally { clearTimeout(timer) }
        // Callback errors are outcomes, never transport-loss signals authorizing another dispatch.
        if (receipt?.state === 'completed' || receipt?.state === 'failed') {
          const result = deserialize(Buffer.from(receipt.result, 'base64'))
          if (receipt.state === 'failed') throw result
          return result as T
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(options.pollMs ?? 20, Math.max(0, request.expires - Date.now()))))
      }
    }
  }
}

/** Install once at the common launch boundary; DOM input and BrowserWindow handles stay Playwright-owned. */
export function installMainProcessControl(app: ElectronApplication): void {
  const implementation = (app as unknown as { _connection: { toImpl(app: ElectronApplication): { _nodeSession: Session } } })
    ._connection.toImpl(app)
  const control = createMainProcessControl(implementation._nodeSession)
  app.evaluate = control.evaluate as ElectronApplication['evaluate']
}
