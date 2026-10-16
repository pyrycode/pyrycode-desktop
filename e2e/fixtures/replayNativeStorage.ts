import type { ElectronApplication } from '@playwright/test'
import { isTransientContextLoss, NOT_YET_AVAILABLE } from './mainProcessRead'

type Database = { prepare(sql: string): { get(): unknown }; close(): void }
type LoadDatabase = (packagePath: string) => new (path: string) => Database

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
  load: LoadDatabase = packagePath => process.getBuiltinModule('module').createRequire(packagePath)('better-sqlite3')
): boolean {
  // Serialized into Electron by app.evaluate: keep every runtime dependency inside this function.
  try {
    const Database = load(`${app.getAppPath()}/package.json`)
    const database = new Database(':memory:')
    try {
      database.prepare('SELECT 1').get()
      return true
    } finally { database.close() }
  } catch { return false }
}

export async function assertReplayNativeStorage(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const ready = await readReplayMainProcess(app, probeReplayNativeStorage)
    if (ready !== NOT_YET_AVAILABLE) {
      if (!ready) throw new Error('Replay requires working Electron SQLite; run npm run rebuild:electron before replay.')
      return
    }
    if (Date.now() >= deadline) throw new Error('Replay main-process inspection unavailable')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
