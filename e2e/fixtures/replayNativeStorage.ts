import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE } from './mainProcessRead'

type Database = { prepare(sql: string): { get(): unknown }; close(): void }
type Stage = 'resolve' | 'load' | 'open' | 'query' | 'close'
type Category = 'module-not-found' | 'native-load' | 'type-error' | 'error' | 'non-error'
type NativeObservation = { ready: true; stage: 'complete' } |
  { ready: false; stage: Stage; category: Category; cleanup?: Category }
type LoadDatabase = (packagePath: string, mark: (stage: Stage) => void) => new (path: string) => Database

type InspectorApplication = {
  _connection: { toImpl(app: ElectronApplication): { _nodeSession: {
    send(method: string, params: object): Promise<{ result: { value?: unknown }; exceptionDetails?: unknown }>
  } } }
}

/** Only client-owned synchronous reads: never pass a mutation or daemon-supplied source. */
export async function readReplayMainProcess<T>(
  app: ElectronApplication, read: (electron: typeof import('electron')) => T
): Promise<T | typeof NOT_YET_AVAILABLE> {
  // Playwright's public evaluate/evaluateHandle both unconditionally await an inspector promise.
  // Electron can lose that promise repeatedly even for synchronous results. Keep this internal
  // session access local to replay inspection; get it from this app, never cache across relaunch.
  const session = (app as unknown as InspectorApplication)._connection.toImpl(app)._nodeSession
  try {
    const response = await session.send('Runtime.evaluate', {
      expression: `(() => {
        const value = (${read.toString()})(require('electron'));
        if (value && typeof value.then === 'function') throw new Error('Synchronous replay inspection required');
        return value;
      })()`,
      includeCommandLineAPI: true, returnByValue: true, awaitPromise: false
    })
    if (response.exceptionDetails !== undefined) throw new Error('Replay main-process inspection failed')
    return response.result.value as T
  } catch (error) {
    if (isTransientContextLoss(error) || (error instanceof Error &&
      error.message.includes('Protocol error') && error.message.includes('Promise was collected'))) return NOT_YET_AVAILABLE
    throw error
  }
}

export function probeReplayNativeStorage(
  { app }: { app: { getAppPath(): string } },
  load: LoadDatabase = (packagePath, mark) => {
    const require = process.getBuiltinModule('module').createRequire(packagePath)
    const resolved = require.resolve('better-sqlite3')
    mark('load')
    return require(resolved)
  }
): NativeObservation {
  // Serialized into Electron: keep every runtime dependency inside this function.
  let stage: Stage = 'resolve'
  const category = (error: unknown): Category => {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'MODULE_NOT_FOUND') return 'module-not-found'
    if (code === 'ERR_DLOPEN_FAILED') return 'native-load'
    if (error instanceof TypeError) return 'type-error'
    return error instanceof Error ? 'error' : 'non-error'
  }
  try {
    const Database = load(`${app.getAppPath()}/package.json`, value => { stage = value })
    stage = 'open'
    const database = new Database(':memory:')
    let failure: NativeObservation | undefined
    try {
      stage = 'query'
      database.prepare('SELECT 1').get()
    } catch (error) { failure = { ready: false, stage, category: category(error) } }
    try { database.close() } catch (error) {
      if (failure && !failure.ready) return { ...failure, cleanup: category(error) }
      return { ready: false, stage: 'close', category: category(error) }
    }
    return failure ?? { ready: true, stage: 'complete' }
  } catch (error) { return { ready: false, stage, category: category(error) } }
}

export async function assertReplayNativeStorage(
  app: ElectronApplication, observe: (value: NativeObservation | { stage: 'unavailable' | 'inspection-failed' }) => void = () => {}
): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    let ready: unknown
    try { ready = await readReplayMainProcess(app, probeReplayNativeStorage) }
    catch (error) { observe({ stage: 'inspection-failed' }); throw error }
    if (ready && typeof ready === 'object' && 'ready' in ready && 'stage' in ready) {
      if (ready.ready === true && ready.stage === 'complete') {
        observe({ ready: true, stage: 'complete' }); return
      }
      const stages: readonly unknown[] = ['resolve', 'load', 'open', 'query', 'close']
      const categories: readonly unknown[] = ['module-not-found', 'native-load', 'type-error', 'error', 'non-error']
      if (ready.ready === false && stages.includes(ready.stage) && 'category' in ready && categories.includes(ready.category)) {
        // Reconstruct from the static vocabulary; never forward arbitrary inspector fields.
        const value = { ready: false, stage: ready.stage, category: ready.category,
          ...('cleanup' in ready && categories.includes(ready.cleanup) ? { cleanup: ready.cleanup } : {}) } as NativeObservation
        observe(value)
        throw new Error(`Replay requires working Electron SQLite (${value.stage}/${'category' in value ? value.category : 'error'}); run npm run rebuild:electron before replay.`)
      }
    }
    // Preserve conclusive boolean observations as well as the classified probe result.
    if (ready === true) return
    if (ready === false) throw new Error('Replay requires working Electron SQLite; run npm run rebuild:electron before replay.')
    observe({ stage: 'unavailable' })
    if (Date.now() >= deadline) throw new Error('Replay main-process inspection unavailable')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
