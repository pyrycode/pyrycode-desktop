import { describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { assertReplayNativeStorage, probeReplayNativeStorage, readReplayMainProcess } from './replayNativeStorage'
import { NOT_YET_AVAILABLE } from './mainProcessRead'

const electron = { app: { getAppPath: () => '/fixture/app' } }

function inspectedApp(send: (method: string, params: any) => Promise<any>) {
  return { _connection: { toImpl: () => ({ _nodeSession: { send } }) } } as unknown as ElectronApplication
}

function runProbe(load: Parameters<typeof probeReplayNativeStorage>[1]) {
  return inspectedApp(async (_method, params) => {
    const value = new Function('require', 'process', `return ${params.expression}`)(
      () => electron, { getBuiltinModule: () => ({ createRequire: () => load }) })
    return { result: { value } }
  })
}

describe('replay native storage prerequisite', () => {
  it('checks storage when the inspector loses every awaitPromise acknowledgement', async () => {
    const send = vi.fn(async (_method: string, params: { awaitPromise: boolean }) => {
      if (params.awaitPromise) throw new Error('Protocol error (Runtime.evaluate): Promise was collected')
      return { result: { type: 'boolean', value: true } }
    })
    const app = {
      evaluate: async () => { throw new Error('Execution context was destroyed') },
      _connection: { toImpl: () => ({ _nodeSession: { send } }) }
    }
    await expect(assertReplayNativeStorage(app as unknown as ElectronApplication)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][1].awaitPromise).toBe(false)
  })

  it.each(['load', 'open'])('rejects native addon %s failure without exposing its error', async phase => {
    class UnavailableDatabase {
      constructor() { throw new Error('PRIVATE_NATIVE_ABI_ERROR') }
      prepare() { return { get: () => undefined } }
      close() {}
    }
    const load = () => {
      if (phase === 'load') throw new Error('PRIVATE_NATIVE_LOADER_PATH')
      return UnavailableDatabase
    }
    await expect(assertReplayNativeStorage(runProbe(load)))
      .rejects.toThrow(/^Replay requires working Electron SQLite; run npm run rebuild:electron before replay\.$/)
  })

  it('opens, queries and closes a fresh database for each process probe', () => {
    const operations: string[] = []
    class Database {
      constructor(path: string) { operations.push(path) }
      prepare(sql: string) { operations.push(sql); return { get: () => ({ value: 1 }) } }
      close() { operations.push('close') }
    }
    const paths: string[] = []
    const load = (path: string) => { paths.push(path); return Database }
    expect(probeReplayNativeStorage(electron, load)).toBe(true)
    expect(probeReplayNativeStorage(electron, load)).toBe(true)
    expect(paths).toEqual(['/fixture/app/package.json', '/fixture/app/package.json'])
    expect(operations).toEqual([':memory:', 'SELECT 1', 'close', ':memory:', 'SELECT 1', 'close'])
  })

  it('closes an opened database when its query fails and reports only failure', () => {
    let closed = 0
    class Database {
      prepare() { return { get: () => { throw new Error('PRIVATE_QUERY_FAILURE') } } }
      close() { closed++ }
    }
    expect(probeReplayNativeStorage(electron, () => Database)).toBe(false)
    expect(closed).toBe(1)
  })

  it('accepts a healthy Electron probe', async () => {
    await expect(assertReplayNativeStorage(inspectedApp(async () => ({ result: { value: true } }))))
      .resolves.toBeUndefined()
  })

  it('bounds persistent inspection loss without claiming the addon is unavailable', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn(async () => { throw new Error('Execution context was destroyed') })
      const result = assertReplayNativeStorage(inspectedApp(send))
      const failure = expect(result).rejects.toThrow('Replay main-process inspection unavailable')
      await vi.advanceTimersByTimeAsync(5_000)
      await failure
      expect(send).toHaveBeenCalledTimes(51)
    } finally { vi.useRealTimers() }
  })

  it('still rejects a valid false addon result after an unavailable inspection', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn().mockRejectedValueOnce(new Error('Execution context was destroyed'))
        .mockResolvedValue({ result: { value: false } })
      const result = assertReplayNativeStorage(inspectedApp(send))
      const failure = expect(result).rejects.toThrow('run npm run rebuild:electron before replay.')
      await vi.advanceTimersByTimeAsync(100)
      await failure
      expect(send).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
})

describe('synchronous replay inspection', () => {
  it.each([false, 0, null, undefined, []])('preserves a valid blank result: %j', async value => {
    const send = vi.fn(async () => ({ result: { value } }))
    expect(await readReplayMainProcess(inspectedApp(send), () => null)).toEqual(value)
    expect(send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({
      awaitPromise: false, returnByValue: true, includeCommandLineAPI: true
    }))
  })

  it.each(['Execution context was destroyed', 'Protocol error (Runtime.evaluate): Promise was collected'])(
    'distinguishes unavailable inspection from a value: %s', async message => {
      const send = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue({ result: { value: [] } })
      const app = inspectedApp(send)
      expect(await readReplayMainProcess(app, () => [])).toBe(NOT_YET_AVAILABLE)
      expect(await readReplayMainProcess(app, () => [])).toEqual([])
    })

  it('propagates unrelated fatal errors unchanged and once', async () => {
    const fatal = new Error('Target closed')
    const send = vi.fn().mockRejectedValue(fatal)
    await expect(readReplayMainProcess(inspectedApp(send), () => true)).rejects.toBe(fatal)
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not turn a callback exception into empty successful evidence', async () => {
    const app = inspectedApp(async () => ({ result: {}, exceptionDetails: { text: 'PRIVATE_VALUE' } }))
    await expect(readReplayMainProcess(app, () => true)).rejects.toThrow(/^Replay main-process inspection failed$/)
  })

  it('executes the supplied synchronous callback and refuses promise results', async () => {
    const app = inspectedApp(async (_method, params) => {
      try {
        return { result: { value: new Function('require', `return ${params.expression}`)(() => electron) } }
      } catch { return { result: {}, exceptionDetails: {} } }
    })
    expect(await readReplayMainProcess(app, ({ app }) => app.getAppPath())).toBe('/fixture/app')
    await expect(readReplayMainProcess(app, () => Promise.resolve(true))).rejects.toThrow('Replay main-process inspection failed')
  })

  it('uses the new process session when a profile is relaunched', async () => {
    const first = vi.fn(async () => ({ result: { value: 1 } }))
    const reopened = vi.fn(async () => ({ result: { value: 2 } }))
    expect(await readReplayMainProcess(inspectedApp(first), () => 0)).toBe(1)
    expect(await readReplayMainProcess(inspectedApp(reopened), () => 0)).toBe(2)
    expect(first).toHaveBeenCalledOnce()
    expect(reopened).toHaveBeenCalledOnce()
  })
})
