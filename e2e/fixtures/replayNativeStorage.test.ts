import { describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { assertReplayNativeStorage, probeReplayNativeStorage, readReplayMainProcess } from './replayNativeStorage'
import { NOT_YET_AVAILABLE } from './mainProcessRead'
import { createRequire } from 'node:module'

const electron = { app: { getAppPath: () => '/fixture/app' } }

function inspectedApp(send: (method: string, params: any) => Promise<any>) {
  return { _connection: { toImpl: () => ({ _nodeSession: { send } }) } } as unknown as ElectronApplication
}

function runProbe(load: Parameters<typeof probeReplayNativeStorage>[1]) {
  return inspectedApp(async (_method, params) => {
    const value = new Function('require', 'process', `return ${params.expression}`)(
      () => electron, { getBuiltinModule: (name: string) => name === 'path' ? { dirname: () => '/fixture/app' } :
        { createRequire: () => Object.assign(
          (id: string) => id === 'bindings' ? () => ({}) : load!('/fixture/app/package.json', () => {}),
          { resolve: () => 'better-sqlite3' }) } })
    return { result: { value } }
  })
}

describe('replay native storage prerequisite', () => {
  it('classifies first-use lazy native binding failure through the default adapter as load', () => {
    const require = createRequire(import.meta.url)
    const binding = require.resolve('bindings', { paths: [require.resolve('better-sqlite3')] })
    const loader = require(binding)
    const cached = require.cache[binding]!
    cached.exports = () => { throw Object.assign(new Error('PRIVATE_LAZY_NATIVE_PATH'), { code: 'ERR_DLOPEN_FAILED' }) }
    try {
      expect(probeReplayNativeStorage({ app: { getAppPath: () => process.cwd() } }))
        .toEqual({ ready: false, stage: 'load', category: 'native-load' })
    } finally { cached.exports = loader }
  })

  it('establishes cold native readiness during an active V8 stack formatter', () => {
    const previous = Error.prepareStackTrace
    let observation: unknown
    Error.prepareStackTrace = () => {
      observation = probeReplayNativeStorage({ app: { getAppPath: () => process.cwd() } })
      return ''
    }
    try { void new Error().stack } finally { Error.prepareStackTrace = previous }
    expect(observation).toEqual({ ready: true, stage: 'complete' })
  })

  it('distinguishes a loaded binding rejecting a genuine open through the default adapter', () => {
    const require = createRequire(import.meta.url)
    const binding = require.resolve('bindings', { paths: [require.resolve('better-sqlite3')] })
    const loader = require(binding)
    const cached = require.cache[binding]!
    cached.exports = () => ({ isInitialized: true, Database: class {
      constructor() { throw new Error('PRIVATE_SQLITE_OPEN') }
    } })
    try {
      expect(probeReplayNativeStorage({ app: { getAppPath: () => process.cwd() } }))
        .toEqual({ ready: false, stage: 'open', category: 'error' })
    } finally { cached.exports = loader }
  })

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
      .rejects.toThrow(/^Replay requires working Electron SQLite \((load|open)\/error\); run npm run rebuild:electron before replay\.$/)
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
    expect(probeReplayNativeStorage(electron, load)).toEqual({ ready: true, stage: 'complete' })
    expect(probeReplayNativeStorage(electron, load)).toEqual({ ready: true, stage: 'complete' })
    expect(paths).toEqual(['/fixture/app/package.json', '/fixture/app/package.json'])
    expect(operations).toEqual([':memory:', 'SELECT 1', 'close', ':memory:', 'SELECT 1', 'close'])
  })

  it('closes an opened database when its query fails and reports only failure', () => {
    let closed = 0
    class Database {
      prepare() { return { get: () => { throw new Error('PRIVATE_QUERY_FAILURE') } } }
      close() { closed++ }
    }
    expect(probeReplayNativeStorage(electron, () => Database)).toEqual({ ready: false, stage: 'query', category: 'error' })
    expect(closed).toBe(1)
  })

  it('accepts a healthy Electron probe', async () => {
    await expect(assertReplayNativeStorage(inspectedApp(async () => ({ result: { value: true } }))))
      .resolves.toBeUndefined()
  })

  const inconclusive = [{}, { value: undefined }, { value: null }, { value: 0 },
    { value: '' }, { value: [] }, { value: {} }, { value: 'true' }, { value: 1 }]

  it.each(inconclusive)('waits for a conclusive boolean after an absent or non-boolean observation: %j', async result => {
    vi.useFakeTimers()
    try {
      const send = vi.fn().mockResolvedValueOnce({ result }).mockResolvedValue({ result: { value: true } })
      const ready = assertReplayNativeStorage(inspectedApp(send))
      await Promise.all([vi.advanceTimersByTimeAsync(100), expect(ready).resolves.toBeUndefined()])
      expect(send).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it.each(inconclusive)('bounds non-boolean inspection without diagnosing SQLite: %j', async result => {
    vi.useFakeTimers()
    try {
      const send = vi.fn().mockResolvedValue({ result })
      const outcome = assertReplayNativeStorage(inspectedApp(send)).catch(error => error)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(send).toHaveBeenCalledTimes(50)
      await vi.advanceTimersByTimeAsync(1)
      expect(await outcome).toEqual(new Error('Replay main-process inspection unavailable'))
      expect(send).toHaveBeenCalledTimes(51)
    } finally { vi.useRealTimers() }
  })

  it('rejects conclusive false immediately after absence', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn().mockResolvedValueOnce({ result: {} }).mockResolvedValue({ result: { value: false } })
      const result = assertReplayNativeStorage(inspectedApp(send))
      await Promise.all([vi.advanceTimersByTimeAsync(100), expect(result)
        .rejects.toThrow(/^Replay requires working Electron SQLite; run npm run rebuild:electron before replay\.$/)])
      expect(send).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('propagates fatal prerequisite errors without polling', async () => {
    const fatal = new Error('Target closed')
    const send = vi.fn().mockRejectedValue(fatal)
    await expect(assertReplayNativeStorage(inspectedApp(send))).rejects.toBe(fatal)
    expect(send).toHaveBeenCalledOnce()
  })

  it('rejects conclusive false without polling', async () => {
    const send = vi.fn().mockResolvedValue({ result: { value: false } })
    await expect(assertReplayNativeStorage(inspectedApp(send))).rejects.toThrow('Replay requires working Electron SQLite')
    expect(send).toHaveBeenCalledOnce()
  })

  it('reports native close failure as false', () => {
    class Database {
      prepare() { return { get: () => 1 } }
      close() { throw new Error('PRIVATE_CLOSE_FAILURE') }
    }
    expect(probeReplayNativeStorage(electron, () => Database)).toEqual({ ready: false, stage: 'close', category: 'error' })
  })

  it.each(['resolve', 'load', 'open', 'query', 'close'] as const)('classifies %s failure without native details', stage => {
    const fail = () => { throw Object.assign(new Error('PRIVATE_NATIVE_PATH'), { code: 'MODULE_NOT_FOUND' }) }
    class Database {
      constructor() { if (stage === 'open') fail() }
      prepare() { if (stage === 'query') fail(); return { get: () => 1 } }
      close() { if (stage === 'close') fail() }
    }
    const result = probeReplayNativeStorage(electron, (_path, mark) => {
      mark(stage === 'resolve' ? 'resolve' : 'load')
      if (stage === 'load' || stage === 'resolve') fail()
      return Database
    })
    expect(result).toEqual({ ready: false, stage, category: 'module-not-found' })
  })

  it('preserves query failure when close also throws', () => {
    class Database {
      prepare(): never { throw new TypeError('PRIVATE_QUERY') }
      close() { throw new Error('PRIVATE_CLOSE') }
    }
    expect(probeReplayNativeStorage(electron, () => Database)).toEqual({
      ready: false, stage: 'query', category: 'type-error', cleanup: 'error'
    })
  })

  it.each([
    ['native loader', Object.assign(new Error('PRIVATE_PATH'), { code: 'ERR_DLOPEN_FAILED' }), 'native-load'],
    ['unknown code', Object.assign(new Error('PRIVATE_PATH'), { code: 'PRIVATE_CODE' }), 'error'],
    ['non-error', { path: 'PRIVATE_PATH' }, 'non-error']
  ])('keeps %s exception categories content-free', (_name, error, category) => {
    expect(probeReplayNativeStorage(electron, (_path, mark) => {
      mark('load'); throw error
    })).toEqual({ ready: false, stage: 'load', category })
  })

  it('rejects a classified native failure immediately and only observes static fields', async () => {
    const observe = vi.fn()
    const send = vi.fn(async () => ({ result: { value: {
      ready: false, stage: 'open', category: 'native-load', path: 'PRIVATE_PATH', stack: 'PRIVATE_STACK'
    } } }))
    await expect(assertReplayNativeStorage(inspectedApp(send), observe))
      .rejects.toThrow('Replay requires working Electron SQLite (open/native-load)')
    expect(observe).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledWith({ ready: false, stage: 'open', category: 'native-load' })
    expect(send).toHaveBeenCalledOnce()
  })

  it('distinguishes unavailable and failed inspection without forwarding inspector content', async () => {
    vi.useFakeTimers()
    try {
      const observe = vi.fn()
      const send = vi.fn().mockResolvedValueOnce({ result: { value: 'PRIVATE_VALUE' } })
        .mockResolvedValue({ result: {}, exceptionDetails: { text: 'PRIVATE_EXCEPTION' } })
      const outcome = assertReplayNativeStorage(inspectedApp(send), observe).catch(error => error)
      await vi.advanceTimersByTimeAsync(100)
      expect((await outcome).message).toBe('Replay main-process inspection failed')
      expect(observe.mock.calls).toEqual([[{ stage: 'unavailable' }], [{ stage: 'inspection-failed' }]])
    } finally { vi.useRealTimers() }
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
  it.each([false, 0, null, undefined, '', [], {}].map(value => [value]))('preserves a valid blank result: %j', async value => {
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
