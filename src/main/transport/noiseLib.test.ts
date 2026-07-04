import { describe, it, expect, vi, beforeEach } from 'vitest'

// AC4 — the async wasm-load surface. These cases mock `noise-c.wasm` so no real wasm loads and
// the module-scope memo can be reset per case (vi.resetModules + a dynamic import), exercising
// the three load-surface invariants: timeout, sync-throw classification, and reset-on-failure —
// plus the success memoization. No socket, no daemon, no key: pure loader behaviour.

// A per-case controller the mocked `createNoise` consults. `vi.mock` is hoisted, so the factory
// closes over this object by reference and reads `mode`/`calls` live at call time.
const control = {
  mode: 'success' as 'success' | 'sync-throw' | 'never',
  calls: 0,
  lib: { marker: 'noise-lib' } as unknown
}

vi.mock('noise-c.wasm', () => {
  const createNoise = (arg1: unknown, arg2?: (lib: unknown) => void): void => {
    control.calls += 1
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as (lib: unknown) => void
    if (control.mode === 'never') return // callback never fires — simulates an async wasm hang
    if (control.mode === 'sync-throw') throw new Error('RAW-WASM-ERROR-must-never-leak')
    cb(control.lib)
  }
  return { default: createNoise }
})

// A fresh module scope per case: resetModules nulls noiseLib's memoized `libPromise`, then a
// dynamic import re-evaluates it. (vi.mock registrations persist across resetModules.)
async function freshLoader(): Promise<typeof import('./noiseLib')> {
  vi.resetModules()
  return import('./noiseLib')
}

beforeEach(() => {
  control.mode = 'success'
  control.calls = 0
  control.lib = { marker: 'noise-lib' }
})

describe('noiseLib — hardened wasm loader (AC4)', () => {
  it('rejects with a wasm-load-timeout NoiseLoadError when the callback never fires (no hang)', async () => {
    control.mode = 'never'
    const { loadNoiseLib, NoiseLoadError } = await freshLoader()
    const err = await loadNoiseLib({ timeoutMs: 25 }).catch((e) => e)
    expect(err).toBeInstanceOf(NoiseLoadError)
    expect(err.reason).toBe('wasm-load-timeout')
  })

  it('rejects with wasm-load-failed on a synchronous createNoise throw — category-only message', async () => {
    control.mode = 'sync-throw'
    const { loadNoiseLib, NoiseLoadError } = await freshLoader()
    const err = await loadNoiseLib().catch((e) => e)
    expect(err).toBeInstanceOf(NoiseLoadError)
    expect(err.reason).toBe('wasm-load-failed')
    // Classify-don't-forward: the raw wasm error text is never echoed into the message.
    expect(err.message).not.toContain('RAW-WASM-ERROR')
  })

  it('resets the memo after a failed load so a later call retries a fresh load', async () => {
    control.mode = 'sync-throw'
    const { loadNoiseLib } = await freshLoader()
    await expect(loadNoiseLib()).rejects.toBeDefined()
    // The next call, now succeeding, must resolve — a failed load must not poison the memo.
    control.mode = 'success'
    await expect(loadNoiseLib()).resolves.toBe(control.lib)
  })

  it('memoizes the successful lib — two calls share one wasm init', async () => {
    const { loadNoiseLib } = await freshLoader()
    const a = await loadNoiseLib()
    const b = await loadNoiseLib()
    expect(a).toBe(b)
    expect(a).toBe(control.lib)
    expect(control.calls).toBe(1) // createNoise invoked exactly once
  })

  it('is log-free on the load-failure path — no console output on sync-throw or timeout (AC3)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      control.mode = 'sync-throw'
      const failing = await freshLoader()
      await failing.loadNoiseLib().catch(() => {})
      control.mode = 'never'
      const timing = await freshLoader()
      await timing.loadNoiseLib({ timeoutMs: 20 }).catch(() => {})
      // The loader classifies into a NoiseLoadError; it never logs (a wasm error could echo bytes).
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
