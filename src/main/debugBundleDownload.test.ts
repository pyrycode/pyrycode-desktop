// Unit tests for the debug-bundle download orchestrator (#169). All three deps are injected
// fakes, so no Electron / no window: `requestDebugBundle` stashes the constructed BundleConsumer
// (the test drives its terminals directly), `save` is a controllable stub, `emit` collects the
// events that would reach the renderer. The assertions pin the information-minimising boundary —
// the fail-map (AC2), progress (AC3), and single-in-flight (AC4) — and, for every failure event,
// that its `Object.keys` allowlist carries no errno / token / key / bytes.
import { describe, it, expect, vi } from 'vitest'
import { createDebugBundleDownload, type DebugBundleDownloadDeps } from './debugBundleDownload'
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import type { DaemonEvent, DebugBundleFailure } from '../shared/ipc/events'

// A deferred whose resolution the test controls — models the async-save window (AC4).
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Drain the microtask queue after a save settles, so the .then terminal has run before we assert.
// A zero-delay macrotask runs strictly after all queued microtasks (real timers, no fake clock).
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

interface Harness {
  downloader: ReturnType<typeof createDebugBundleDownload>
  emitted: DaemonEvent[]
  requestDebugBundle: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  /** The most recently constructed consumer (undefined until the first admitted request). */
  consumer(): BundleConsumer | undefined
}

// Build an orchestrator over fakes. `save` defaults to a resolved stub; `requestDebugBundle` by
// default just captures the consumer (override to model the synchronous not-connected fail).
function setup(overrides?: Partial<DebugBundleDownloadDeps>): Harness {
  const emitted: DaemonEvent[] = []
  let captured: BundleConsumer | undefined
  const requestDebugBundle = vi.fn((consumer: BundleConsumer) => {
    captured = consumer
  })
  const save = vi.fn(async () => '/downloads/pyrycode-debug-bundle.tar.gz')
  const downloader = createDebugBundleDownload({
    requestDebugBundle,
    save,
    emit: (e) => emitted.push(e),
    ...overrides
  })
  return { downloader, emitted, requestDebugBundle, save, consumer: () => captured }
}

describe('createDebugBundleDownload — fail-map (AC2)', () => {
  const cases: Array<[BundleFailReason, DebugBundleFailure]> = [
    ['daemon-error', 'unavailable'],
    ['not-connected', 'unavailable'],
    ['connection-lost', 'unavailable'],
    ['seq-mismatch', 'stream-corrupt'],
    ['total-mismatch', 'stream-corrupt']
  ]

  it.each(cases)('maps fail(%s) → debugBundleFailed:%s and leaks nothing else', (reason, category) => {
    const { downloader, emitted, consumer } = setup()
    downloader.request()
    consumer()?.fail(reason)

    expect(emitted).toEqual([{ type: 'debugBundleFailed', reason: category }])
    // Allowlist: exactly `type` + `reason` — no errno, token, key, or bytes field rides along.
    expect(Object.keys(emitted[0]).sort()).toEqual(['reason', 'type'])
  })

  it('maps a save rejection → write-failed without leaking the errno code or message', async () => {
    const errno = Object.assign(new Error('EACCES: permission denied, open /downloads/x'), {
      code: 'EACCES',
      errno: -13
    })
    const { downloader, emitted, consumer } = setup({ save: vi.fn(() => Promise.reject(errno)) })

    downloader.request()
    consumer()?.complete(new Uint8Array([1, 2, 3]))
    await flush()

    expect(emitted).toEqual([{ type: 'debugBundleFailed', reason: 'write-failed' }])
    expect(Object.keys(emitted[0]).sort()).toEqual(['reason', 'type'])
    // Neither the errno code nor the fs message appears anywhere on the channel.
    const wire = JSON.stringify(emitted)
    expect(wire).not.toContain('EACCES')
    expect(wire).not.toContain('permission denied')
  })
})

describe('createDebugBundleDownload — success + progress', () => {
  it('routes complete bytes to save and emits debugBundleSaved with the resolved path (no bytes)', async () => {
    const save = vi.fn(async () => '/downloads/pyrycode-debug-bundle.tar.gz')
    const { downloader, emitted, consumer } = setup({ save })
    const bytes = new Uint8Array([9, 8, 7])

    downloader.request()
    consumer()?.complete(bytes)
    await flush()

    // The bytes go only to save (disk) — never onto the channel.
    expect(save).toHaveBeenCalledWith(bytes)
    expect(emitted).toEqual([{ type: 'debugBundleSaved', path: '/downloads/pyrycode-debug-bundle.tar.gz' }])
    expect(Object.keys(emitted[0]).sort()).toEqual(['path', 'type'])
  })

  it('emits the running chunk count as progress and nothing else (AC3)', () => {
    const { downloader, emitted, consumer } = setup()
    downloader.request()

    consumer()?.progress?.(1)
    consumer()?.progress?.(2)
    consumer()?.progress?.(3)

    expect(emitted).toEqual([
      { type: 'debugBundleProgress', chunksReceived: 1 },
      { type: 'debugBundleProgress', chunksReceived: 2 },
      { type: 'debugBundleProgress', chunksReceived: 3 }
    ])
    expect(Object.keys(emitted[2]).sort()).toEqual(['chunksReceived', 'type'])
  })

  it('progress is not terminal — a request during a stream is still short-circuited', () => {
    const { downloader, requestDebugBundle, consumer } = setup()
    downloader.request()
    consumer()?.progress?.(1)

    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(1)
  })
})

describe('createDebugBundleDownload — single-in-flight (AC4)', () => {
  it('short-circuits a concurrent request and admits a fresh one only after the terminal', () => {
    const { downloader, emitted, requestDebugBundle, consumer } = setup()

    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(1)
    const first = consumer()

    // Second request while the first is in flight: no transport call, no new consumer, no terminal.
    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(1)
    expect(consumer()).toBe(first)
    expect(emitted).toEqual([])

    // The first still settles to exactly one terminal.
    first?.fail('daemon-error')
    expect(emitted).toEqual([{ type: 'debugBundleFailed', reason: 'unavailable' }])

    // After the first settles, a later request starts a fresh download.
    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(2)
  })

  it('stays locked across the async save window and admits the next request only after it settles', async () => {
    const gate = deferred<string>()
    const { downloader, requestDebugBundle, consumer } = setup({ save: vi.fn(() => gate.promise) })

    downloader.request()
    consumer()?.complete(new Uint8Array([1]))

    // Between complete and save-resolve the flag is still held — a second request is ignored.
    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(1)

    gate.resolve('/downloads/pyrycode-debug-bundle.tar.gz')
    await flush()

    // Once the save terminal emits, a fresh download is admitted.
    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(2)
  })

  it('clears the flag when requestDebugBundle fails the consumer synchronously (not-connected)', () => {
    // Models daemonConnection.requestDebugBundle failing the consumer synchronously with no driver:
    // the set-active-before-call ordering must not leave the flag stuck true.
    const emitted: DaemonEvent[] = []
    const requestDebugBundle = vi.fn((c: BundleConsumer) => c.fail('not-connected'))
    const downloader = createDebugBundleDownload({
      requestDebugBundle,
      save: vi.fn(async () => '/x'),
      emit: (e) => emitted.push(e)
    })

    downloader.request()
    expect(emitted).toEqual([{ type: 'debugBundleFailed', reason: 'unavailable' }])

    // The flag cleared synchronously, so the next request is admitted.
    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(2)
  })
})

describe('createDebugBundleDownload — a destroyed window cannot strand the flag (#518)', () => {
  // The orchestrator gets NO guard of its own: every terminal emits BEFORE clearing `active`, so a
  // throw out of `emit` would leave the flag stuck true for the rest of the process lifetime. The
  // guard lives in emitDaemonEvent, which is why this one test composes the composition root's real
  // wiring (`emit: e => emitDaemonEvent(mainWindow, e)`) instead of the plain collector every other
  // test here uses — it is the only place the second-order fault is observable.
  it('clears the flag when a terminal emits into a destroyed window, so a later request starts', () => {
    const destroyed: DaemonEventSink = {
      isDestroyed: () => true,
      // A real destroyed BrowserWindow throws from the `webContents` accessor itself.
      get webContents(): { send(channel: string, event: DaemonEvent): void } {
        throw new Error('Object has been destroyed')
      }
    }
    const { downloader, requestDebugBundle, consumer } = setup({
      emit: (e) => emitDaemonEvent(destroyed, e)
    })

    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(1)

    // The synchronous terminal — the simplest of the three. Before the guard this threw.
    expect(() => consumer()?.fail('daemon-error')).not.toThrow()

    downloader.request()
    expect(requestDebugBundle).toHaveBeenCalledTimes(2)
  })
})
