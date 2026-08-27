import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerHostLabelHandler, type HostLabelHandleTarget } from './hostLabelHandler'
import { HOST_LABEL_CHANNEL } from '../shared/ipc/hostLabel'
import { MAX_HOST_LABEL_LENGTH } from '../shared/ipc/pairing'
import { MalformedHostLabelError, type HostLabelStore } from './hostLabelStore'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain (the
// serverInfoHandler.test idiom).
function fakeTarget(): HostLabelHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The invoke listener the handler registers, pulled from the fake target and typed for direct
// driving (extract target.handle.mock.calls[0][1] and call it — no request arg, the query has no body).
function listenerOf(target: ReturnType<typeof fakeTarget>): (event: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A fake store exercising only load() — the sole method the handler is even typed to reach.
function storeWithLoad(load: HostLabelStore['load']): Pick<HostLabelStore, 'load'> {
  return { load }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerHostLabelHandler', () => {
  it('registers exactly one handler on the host-label channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerHostLabelHandler(target, { store: storeWithLoad(vi.fn()) })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(HOST_LABEL_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(HOST_LABEL_CHANNEL)
  })

  it('a stored label crosses verbatim on the stored arm', async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => 'Pyrybox')) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'stored', label: 'Pyrybox' })
    // Structural pin: the stored arm carries exactly status + label, nothing else.
    expect(Object.keys(response as object).sort()).toEqual(['label', 'status'])
  })

  it('an awkward-but-valid label crosses byte-identically — no trim, no normalize, no fallback', async () => {
    // Leading/trailing whitespace, a leading BOM (hostLabelStore decodes with ignoreBOM so it
    // survives the store), and an emoji. Each would be lost by a "helpful" transformation.
    const AWKWARD = '﻿  pyrybox — office 🛰  '
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => AWKWARD)) })

    expect(await listenerOf(target)({})).toEqual({ status: 'stored', label: AWKWARD })
  })

  it("stored empty is STORED, not absent — a truthiness check must fail here and nowhere else", async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => '')) })

    // `''` is falsy: `if (!label) return { status: 'not-stored' }` type-checks, reads naturally, and
    // silently collapses a stored empty label into absence at the LAST boundary where #822/#823's
    // never-stored vs stored-empty distinction still exists. This test is that line's regression pin.
    expect(await listenerOf(target)({})).toEqual({ status: 'stored', label: '' })
  })

  it('null is absent, and the not-stored arm carries no label key at all', async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => null)) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'not-stored' })
    // NOT `label === undefined`: Electron's IPC uses structured clone, which PRESERVES an own
    // property whose value is undefined, so `{ status: 'not-stored', label: undefined }` would arrive
    // with `'label' in response` true and a renderer's `in` test would misread absence.
    expect('label' in (response as object)).toBe(false)
    expect(Object.keys(response as object)).toEqual(['status'])
  })

  it('the read bound agrees with the write guard: exactly MAX_HOST_LABEL_LENGTH crosses, one over does not', async () => {
    const atBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH)
    const overBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)

    const atTarget = fakeTarget()
    registerHostLabelHandler(atTarget, { store: storeWithLoad(vi.fn(async () => atBound)) })
    expect(await listenerOf(atTarget)({})).toEqual({ status: 'stored', label: atBound })

    const overTarget = fakeTarget()
    registerHostLabelHandler(overTarget, { store: storeWithLoad(vi.fn(async () => overBound)) })
    expect(await listenerOf(overTarget)({})).toEqual({ status: 'error' })
  })

  it('an over-long label leaves no residue — never a truncated value', async () => {
    // A distinctive sentinel, so a truncated prefix riding out on the response would be visible.
    const SENTINEL = 'LEAKME-host-label-'.repeat(20)
    expect(SENTINEL.length).toBeGreaterThan(MAX_HOST_LABEL_LENGTH)
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => SENTINEL)) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'error' })
    expect(JSON.stringify(response)).not.toContain(SENTINEL.slice(0, 16))
    expect('label' in (response as object)).toBe(false)
  })

  it('MalformedHostLabelError → error (resolves, never rejects)', async () => {
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new MalformedHostLabelError()
    })
    registerHostLabelHandler(target, { store: storeWithLoad(load) })

    // resolves, never rejects — handle must produce a value.
    await expect(listenerOf(target)({})).resolves.toEqual({ status: 'error' })
  })

  it('propagated decrypt failure (a plain Error, NOT MalformedHostLabelError) → error, no detail crosses', async () => {
    // A generic Error simulates the decrypt failure propagating out of secureStore.get, carrying a
    // secret-shaped keychain path in its message. Asserting a plain Error proves the handler maps
    // EVERY throw to `error` without branching on the type.
    const KEYCHAIN_PATH = '/Users/x/Library/Keychains/login.keychain-db'
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new Error(`decrypt failed: ${KEYCHAIN_PATH}`)
    })
    registerHostLabelHandler(target, { store: storeWithLoad(load) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'error' })
    // The caught error is dropped, not surfaced — no path detail rides out on the error arm.
    expect(JSON.stringify(response)).not.toContain(KEYCHAIN_PATH)
  })

  it('is log-free on every branch, including every error branch', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loads: Array<HostLabelStore['load']> = [
      vi.fn(async () => null),
      vi.fn(async () => ''),
      vi.fn(async () => 'Pyrybox'),
      vi.fn(async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)),
      vi.fn(async () => {
        throw new MalformedHostLabelError()
      }),
      vi.fn(async () => {
        throw new Error('decrypt failed: /Users/x/Library/Keychains/login.keychain-db')
      })
    ]
    for (const load of loads) {
      const target = fakeTarget()
      registerHostLabelHandler(target, { store: storeWithLoad(load) })
      await listenerOf(target)({})
    }

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('never writes: neither save nor clear is called on any branch', async () => {
    // The Pick<HostLabelStore, 'load'> dep type already makes this unrepresentable; this pins it at
    // runtime against a future widening of the dep type — a read channel must never mutate at-rest state.
    const save = vi.fn(async () => {})
    const clear = vi.fn(async () => {})
    const loads: Array<HostLabelStore['load']> = [
      vi.fn(async () => null),
      vi.fn(async () => ''),
      vi.fn(async () => 'Pyrybox'),
      vi.fn(async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)),
      vi.fn(async () => {
        throw new MalformedHostLabelError()
      })
    ]
    for (const load of loads) {
      const target = fakeTarget()
      const store: HostLabelStore = { save, load, clear }
      registerHostLabelHandler(target, { store })
      await listenerOf(target)({})
    }

    expect(save).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('reads through on every invoke — no cache', async () => {
    const target = fakeTarget()
    const load = vi
      .fn<HostLabelStore['load']>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    registerHostLabelHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ status: 'stored', label: 'first' })
    expect(await listener({})).toEqual({ status: 'stored', label: 'second' })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
