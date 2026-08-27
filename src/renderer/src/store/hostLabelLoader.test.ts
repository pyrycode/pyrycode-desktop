import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import {
  mapHostLabel,
  loadHostLabel,
  startHostLabelLoad,
  HostLabelData
} from './hostLabelLoader'
import { createHostLabelStore, selectHostLabel } from './hostLabelStore'

// Pure-map tests + injected-fake-bridge tests (the serverInfoLoader.test idiom): no React, no Electron.
// The real store is wired only for the loading → held seam test. The one departure from that template
// is the extracted one-shot guard: StrictMode's effect → cleanup → effect sequence is driven directly
// as three calls, so AC4's "exactly one write" is proven rather than asserted by inspection.

const stored: HostLabelResult = { status: 'stored', label: 'pyrybox' }
const notStored: HostLabelResult = { status: 'not-stored' }
const errored: HostLabelResult = { status: 'error' }

/** A test-controlled promise, so a load can be left in flight across a cancel. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    settle = res
  })
  return { promise, resolve: (value) => settle(value) }
}

/** Let the `.then` continuation inside loadHostLabel run. No timers on this path. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('mapHostLabel', () => {
  it('maps a stored response to a fresh stored value, holding the label verbatim (AC2)', () => {
    const mapped = mapHostLabel(stored)
    expect(mapped).toEqual({ status: 'stored', label: 'pyrybox' })
    // Reconstructed, not passed through — nothing undeclared rides an IPC payload into the store.
    expect(mapped).not.toBe(stored)
    expect(Object.keys(mapped).sort()).toEqual(['label', 'status'])
  })

  it('maps a stored empty label to a stored value, not to absence (AC2)', () => {
    const mapped = mapHostLabel({ status: 'stored', label: '' })
    expect(mapped).toEqual({ status: 'stored', label: '' })
    expect(mapped).not.toEqual({ status: 'not-stored' })
    expect(mapped).not.toEqual({ status: 'error' })
  })

  it('maps a not-stored response to the never-stored value (AC2)', () => {
    expect(mapHostLabel(notStored)).toEqual({ status: 'not-stored' })
  })

  it('maps an error response to the unreadable value, distinct from never-stored (AC2)', () => {
    const mapped = mapHostLabel(errored)
    expect(mapped).toEqual({ status: 'error' })
    expect(mapped).not.toEqual({ status: 'not-stored' })
  })

  it('never returns the pre-settle loading arm for any response', () => {
    for (const res of [stored, notStored, errored]) {
      expect(mapHostLabel(res).status).not.toBe('loading')
    }
  })

  it('degrades an unrecognised status to error, never to not-stored (ADR 0005)', () => {
    const rogue = { status: 'something-new', label: 'x' } as unknown as HostLabelResult
    const mapped = mapHostLabel(rogue)
    expect(mapped).toEqual({ status: 'error' })
    expect(mapped).not.toEqual({ status: 'not-stored' })
  })
})

describe('loadHostLabel', () => {
  it('writes the stored value exactly once (AC1)', async () => {
    const invoke = vi.fn(async () => stored)
    const setHostLabel = vi.fn()

    await loadHostLabel(invoke, setHostLabel)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'stored', label: 'pyrybox' })
  })

  it('writes the never-stored value exactly once (AC2)', async () => {
    const invoke = vi.fn(async () => notStored)
    const setHostLabel = vi.fn()

    await loadHostLabel(invoke, setHostLabel)

    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'not-stored' })
  })

  it('writes the unreadable value exactly once (AC2)', async () => {
    const invoke = vi.fn(async () => errored)
    const setHostLabel = vi.fn()

    await loadHostLabel(invoke, setHostLabel)

    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'error' })
  })

  it('settles a rejected invoke into error, never never-stored, and never rejects (AC3)', async () => {
    const invoke = vi.fn(async (): Promise<HostLabelResult> => {
      throw new Error('handler absent')
    })
    const setHostLabel = vi.fn()

    // The returned promise resolves — the loader swallows the rejection.
    await expect(loadHostLabel(invoke, setHostLabel)).resolves.toBeUndefined()

    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'error' })
    expect(setHostLabel).not.toHaveBeenCalledWith({ status: 'not-stored' })
  })

  it('drives a real store from loading to a held stored value via the real setter (seam, AC1)', async () => {
    const store = createHostLabelStore()
    const invoke = vi.fn(async () => stored)

    expect(selectHostLabel(store.getState())).toEqual({ status: 'loading' })
    await loadHostLabel(invoke, store.getState().setHostLabel)
    expect(selectHostLabel(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
  })
})

describe('startHostLabelLoad', () => {
  it('applies exactly one write across a StrictMode double-mount — the second mount wins (AC4)', async () => {
    const first = deferred<HostLabelResult>()
    const second = deferred<HostLabelResult>()
    const pending = [first.promise, second.promise]
    let call = 0
    const invoke = vi.fn((): Promise<HostLabelResult> => pending[call++])
    const setHostLabel = vi.fn()

    const cancel = startHostLabelLoad(invoke, setHostLabel) // mount 1
    cancel() // StrictMode cleanup
    startHostLabelLoad(invoke, setHostLabel) // mount 2

    // Distinct arms, so the surviving write is identifiable — a matching count alone would not prove
    // that the FIRST mount's write is the one that was dropped.
    first.resolve(stored)
    second.resolve(notStored)
    await flush()

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'not-stored' })
  })

  it('applies the write on a plain mount with no cancel (AC1)', async () => {
    const invoke = vi.fn(async () => stored)
    const setHostLabel = vi.fn()

    startHostLabelLoad(invoke, setHostLabel)
    await flush()

    expect(setHostLabel).toHaveBeenCalledTimes(1)
    expect(setHostLabel).toHaveBeenCalledWith({ status: 'stored', label: 'pyrybox' })
  })

  it('drops a write that resolves after the cancel', async () => {
    const late = deferred<HostLabelResult>()
    const invoke = vi.fn(() => late.promise)
    const setHostLabel = vi.fn()

    const cancel = startHostLabelLoad(invoke, setHostLabel)
    cancel()
    late.resolve(stored)
    await flush()

    expect(setHostLabel).not.toHaveBeenCalled()
  })

  it('drops a rejection that settles after the cancel, without an unhandled rejection (AC3)', async () => {
    const late = deferred<HostLabelResult>()
    const invoke = vi.fn(() => late.promise.then(() => Promise.reject(new Error('main died'))))
    const setHostLabel = vi.fn()

    const cancel = startHostLabelLoad(invoke, setHostLabel)
    cancel()
    late.resolve(stored)
    await flush()

    expect(setHostLabel).not.toHaveBeenCalled()
  })
})

describe('HostLabelData (container)', () => {
  // Server-render sanity — the ServerInfoData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(HostLabelData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
