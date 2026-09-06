import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import {
  mapHostLabel,
  loadHostLabelFor,
  startHostLabelLoads,
  HostLabelData
} from './hostLabelLoader'
import { createHostLabelStore, selectHostLabelFor } from './hostLabelStore'

// Pure-map tests + injected-fake-bridge tests (the serverInfoLoader.test idiom): no React, no Electron.
// The real store is wired only for the loading → held seam test. The one departure from that template
// is the extracted one-shot guard: StrictMode's effect → cleanup → effect sequence is driven directly
// as three calls, so "exactly one write per server" is proven rather than asserted by inspection.
//
// #1199 made every write PER SERVER, so the two claims this file now has to keep apart are "the value
// landed" and "it landed under the id it was QUERIED with". The response union carries no id (the
// preload bridge deliberately never echoes it), so a write keyed off anything but the argument would put
// one machine's answer on another's row — hence the two-server cases below rather than one-server ones.

const stored: HostLabelResult = { status: 'stored', label: 'pyrybox' }
const notStored: HostLabelResult = { status: 'not-stored' }
const errored: HostLabelResult = { status: 'error' }

const A = 'server-a'
const B = 'server-b'

/** A test-controlled promise, so a load can be left in flight across a cancel. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    settle = res
  })
  return { promise, resolve: (value) => settle(value) }
}

/** Let the `.then` continuations inside loadHostLabelFor run. No timers on this path. */
async function flush(): Promise<void> {
  await Promise.resolve()
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

describe('loadHostLabelFor', () => {
  it('asks for the named server and writes the stored value under that id exactly once (AC2)', async () => {
    const invokeFor = vi.fn(async () => stored)
    const setFor = vi.fn()

    await loadHostLabelFor(invokeFor, A, setFor)

    expect(invokeFor).toHaveBeenCalledTimes(1)
    expect(invokeFor).toHaveBeenCalledWith(A)
    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'stored', label: 'pyrybox' })
  })

  it('writes the never-stored value under the queried id exactly once (AC2)', async () => {
    const invokeFor = vi.fn(async () => notStored)
    const setFor = vi.fn()

    await loadHostLabelFor(invokeFor, A, setFor)

    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'not-stored' })
  })

  it('writes the unreadable value under the queried id exactly once (AC2)', async () => {
    const invokeFor = vi.fn(async () => errored)
    const setFor = vi.fn()

    await loadHostLabelFor(invokeFor, A, setFor)

    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'error' })
  })

  it('settles a rejected invoke into error under that id, never never-stored, and never rejects (AC2)', async () => {
    const invokeFor = vi.fn(async (): Promise<HostLabelResult> => {
      throw new Error('handler absent')
    })
    const setFor = vi.fn()

    // The returned promise resolves — the loader swallows the rejection.
    await expect(loadHostLabelFor(invokeFor, A, setFor)).resolves.toBeUndefined()

    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'error' })
    expect(setFor).not.toHaveBeenCalledWith(A, { status: 'not-stored' })
  })

  it('keys the write off the ARGUMENT, never off a response that claims another id (AC2)', async () => {
    // The response union carries no id, so nothing legitimate can contradict the argument — this pins
    // that a future edit cannot start trusting one. A hostile-shaped payload naming server B must still
    // land on the server that was asked about.
    const liar = { status: 'stored', label: 'macbook', serverId: B } as unknown as HostLabelResult
    const invokeFor = vi.fn(async () => liar)
    const setFor = vi.fn()

    await loadHostLabelFor(invokeFor, A, setFor)

    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'stored', label: 'macbook' })
    expect(setFor).not.toHaveBeenCalledWith(B, expect.anything())
  })

  it('drives a real store from unread to a held stored value via the real setter (seam, AC1)', async () => {
    const store = createHostLabelStore()
    const invokeFor = vi.fn(async () => stored)

    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'loading' })
    await loadHostLabelFor(invokeFor, A, store.getState().setHostLabelFor)
    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
  })
})

describe('startHostLabelLoads', () => {
  it('issues one keyed read per paired server and writes each under its own id (AC2)', async () => {
    const invokeFor = vi.fn(async (serverId: string) =>
      serverId === A ? stored : (notStored as HostLabelResult)
    )
    const setFor = vi.fn()

    startHostLabelLoads([A, B], invokeFor, setFor)
    await flush()

    expect(invokeFor.mock.calls.map(([id]) => id)).toEqual([A, B])
    expect(setFor).toHaveBeenCalledTimes(2)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'stored', label: 'pyrybox' })
    expect(setFor).toHaveBeenCalledWith(B, { status: 'not-stored' })
  })

  it('confines one server rejection to that server, leaving the other untouched (AC2)', async () => {
    // AC2's whole second half, driven through the REAL store so "untouched" is a held value and a
    // reference, not a spy's absence of a call.
    const store = createHostLabelStore()
    const invokeFor = vi.fn(async (serverId: string) => {
      if (serverId === B) throw new Error('invoke rejected')
      return stored
    })

    startHostLabelLoads([A, B], invokeFor, store.getState().setHostLabelFor)
    await flush()

    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(B)(store.getState())).toEqual({ status: 'error' })
  })

  it('lands both writes when two reads resolve in the same tick (AC1)', async () => {
    // The functional-updater guarantee: a setter capturing the map outside zustand's updater would read
    // a stale copy for the second resolution and silently drop the first server's slot.
    const store = createHostLabelStore()
    const invokeFor = vi.fn(async (serverId: string) =>
      serverId === A ? stored : (notStored as HostLabelResult)
    )

    startHostLabelLoads([A, B], invokeFor, store.getState().setHostLabelFor)
    await flush()

    expect(selectHostLabelFor(A)(store.getState())).toEqual({ status: 'stored', label: 'pyrybox' })
    expect(selectHostLabelFor(B)(store.getState())).toEqual({ status: 'not-stored' })
  })

  it('reads nothing at all for an empty paired-server list (AC5)', async () => {
    const invokeFor = vi.fn(async () => stored)
    const setFor = vi.fn()

    startHostLabelLoads([], invokeFor, setFor)
    await flush()

    expect(invokeFor).not.toHaveBeenCalled()
    expect(setFor).not.toHaveBeenCalled()
  })

  it('applies exactly one write per server across a StrictMode double-mount — mount 2 wins', async () => {
    const first = deferred<HostLabelResult>()
    const second = deferred<HostLabelResult>()
    const pending = [first.promise, second.promise]
    let call = 0
    const invokeFor = vi.fn((): Promise<HostLabelResult> => pending[call++])
    const setFor = vi.fn()

    const cancel = startHostLabelLoads([A], invokeFor, setFor) // mount 1
    cancel() // StrictMode cleanup
    startHostLabelLoads([A], invokeFor, setFor) // mount 2

    // Distinct arms, so the surviving write is identifiable — a matching count alone would not prove
    // that the FIRST mount's write is the one that was dropped.
    first.resolve(stored)
    second.resolve(notStored)
    await flush()

    expect(invokeFor).toHaveBeenCalledTimes(2)
    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'not-stored' })
  })

  it('applies the writes on a plain mount with no cancel (AC1)', async () => {
    const invokeFor = vi.fn(async () => stored)
    const setFor = vi.fn()

    startHostLabelLoads([A], invokeFor, setFor)
    await flush()

    expect(setFor).toHaveBeenCalledTimes(1)
    expect(setFor).toHaveBeenCalledWith(A, { status: 'stored', label: 'pyrybox' })
  })

  it('drops EVERY server write that resolves after the cancel', async () => {
    const late = deferred<HostLabelResult>()
    const invokeFor = vi.fn(() => late.promise)
    const setFor = vi.fn()

    const cancel = startHostLabelLoads([A, B], invokeFor, setFor)
    cancel()
    late.resolve(stored)
    await flush()

    expect(setFor).not.toHaveBeenCalled()
  })

  it('drops a rejection that settles after the cancel, without an unhandled rejection (AC2)', async () => {
    const late = deferred<HostLabelResult>()
    const invokeFor = vi.fn(() => late.promise.then(() => Promise.reject(new Error('main died'))))
    const setFor = vi.fn()

    const cancel = startHostLabelLoads([A], invokeFor, setFor)
    cancel()
    late.resolve(stored)
    await flush()

    expect(setFor).not.toHaveBeenCalled()
  })
})

describe('HostLabelData (container)', () => {
  // Server-render sanity — the ServerInfoData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Since #1199 it also READS `serverInfoStore` during render, which
  // is safe under the same harness for the reason every store-bound container in this repo is: zustand
  // serves the state captured at store creation, so the read yields the empty paired-server list.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(HostLabelData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
