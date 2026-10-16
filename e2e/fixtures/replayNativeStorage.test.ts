import { describe, expect, it } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { assertReplayNativeStorage, probeReplayNativeStorage } from './replayNativeStorage'

const electron = { app: { getAppPath: () => '/fixture/app' } }

describe('replay native storage prerequisite', () => {
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
    const app = { evaluate: async (probe: typeof probeReplayNativeStorage) => probe(electron, load) }
    await expect(assertReplayNativeStorage(app as unknown as ElectronApplication))
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
    const app = { evaluate: async () => true }
    await expect(assertReplayNativeStorage(app as unknown as ElectronApplication)).resolves.toBeUndefined()
  })
})
