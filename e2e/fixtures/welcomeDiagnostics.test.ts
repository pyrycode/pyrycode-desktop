import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { observeWelcomeClick, withWelcomeDiagnostics } from './welcomeDiagnostics'

const bounds = { x: 1, y: 2, width: 400, height: 50 }
const sample = { intervalMs: 750, frames: 0, timers: 12, control: { present: true, enabled: false, bounds } }
function harness() {
  const handle = { evaluate: vi.fn(async () => sample), dispose: vi.fn(async () => {}) }
  const page = { evaluateHandle: vi.fn(async () => handle) }
  const app = { evaluate: vi.fn(async () => [{ visible: true, minimized: false, focused: false, bounds }]) }
  const attach = vi.fn(async () => {})
  const run = (click: () => Promise<void>) => withWelcomeDiagnostics(
    page as unknown as Page, app as unknown as ElectronApplication,
    { attach } as unknown as TestInfo, 2,
    () => observeWelcomeClick(page as unknown as Page, click)
  )
  const report = () => JSON.parse((attach.mock.calls[0] as unknown as [string, { body: Buffer }])[1].body.toString())
  return { handle, page, app, attach, run, report }
}
function deferred() {
  let resolve = () => {}
  let reject = (_error: Error) => {}
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('fast success performs no probes, attachment or leftover timer and unregisters the page', async () => {
  const h = harness()
  await h.run(async () => {})
  expect(h.page.evaluateHandle).not.toHaveBeenCalled()
  expect(h.app.evaluate).not.toHaveBeenCalled()
  expect(h.attach).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  await observeWelcomeClick(h.page as unknown as Page, async () => { throw new Error('outside') }).catch(() => {})
  expect(h.app.evaluate).not.toHaveBeenCalled()
})

it('starts only after five pending seconds and records advancing timers with zero frames', async () => {
  const h = harness(), click = deferred()
  const result = h.run(() => click.promise)
  await vi.advanceTimersByTimeAsync(4999)
  expect(h.page.evaluateHandle).not.toHaveBeenCalled()
  expect(h.app.evaluate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(751)
  expect(h.report()).toMatchObject({ launchIndex: 2, trigger: 'pending', renderer: { status: 'available', value: sample } })
  click.resolve()
  await result
  expect(h.handle.dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('captures early rejection before returning the identical original error', async () => {
  const h = harness(), error = new Error('private token /path argv environment')
  const result = h.run(async () => { throw error })
  const checked = expect(result).rejects.toBe(error)
  await vi.advanceTimersByTimeAsync(750)
  await checked
  expect(h.report().trigger).toBe('failed')
  expect(h.report().native.status).toBe('available')
  expect(JSON.stringify(h.report())).not.toContain('private')
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds a nonresponsive renderer while retaining independent native evidence', async () => {
  const h = harness(), error = new Error('original')
  h.page.evaluateHandle.mockImplementation(() => new Promise(() => {}))
  const result = h.run(async () => { throw error })
  const checked = expect(result).rejects.toBe(error)
  await vi.advanceTimersByTimeAsync(2000)
  await checked
  expect(h.report().renderer).toEqual({ status: 'timed-out' })
  expect(h.report().native).toMatchObject({ status: 'available', value: [{ visible: true }] })
  expect(h.report().captureMs).toBeLessThanOrEqual(2000)
  expect(vi.getTimerCount()).toBe(0)
})

it('stops sampling at click completion and cleans up before the pairing tail', async () => {
  const h = harness(), click = deferred()
  const result = h.run(() => click.promise)
  await vi.advanceTimersByTimeAsync(5100)
  click.resolve()
  await result
  expect(h.handle.evaluate).toHaveBeenCalledOnce()
  expect(h.handle.dispose).toHaveBeenCalledOnce()
  expect(h.report().trigger).toBe('pending')
  expect(vi.getTimerCount()).toBe(0)
})

it('classifies failed and missing reads and ignores cleanup and attachment failures', async () => {
  const h = harness(), error = new Error('original secret')
  h.app.evaluate.mockRejectedValue(new Error('/secret argv'))
  h.handle.evaluate.mockResolvedValue(undefined as unknown as typeof sample)
  h.handle.dispose.mockRejectedValue(new Error('cleanup secret'))
  h.attach.mockRejectedValue(new Error('attachment secret'))
  const result = h.run(async () => { throw error })
  const checked = expect(result).rejects.toBe(error)
  await vi.advanceTimersByTimeAsync(750)
  await checked
  expect(h.report().native).toEqual({ status: 'failed' })
  expect(h.report().renderer).toEqual({ status: 'unavailable' })
  expect(h.report().cleanup).toBe('failed')
  expect(JSON.stringify(h.report())).not.toContain('secret')
  expect(vi.getTimerCount()).toBe(0)
})

it('reconstructs allowlisted primitives and drops arbitrary secret-bearing extra fields', async () => {
  const h = harness()
  h.handle.evaluate.mockResolvedValue({ ...sample, token: 'private', control: { ...sample.control, text: 'private', bounds: { ...bounds, path: '/private' } } } as typeof sample)
  h.app.evaluate.mockResolvedValue([{ visible: true, minimized: false, focused: false, bounds, argv: '/private' }] as never)
  const result = h.run(async () => { throw new Error('private') })
  const checked = expect(result).rejects.toThrow('private')
  await vi.advanceTimersByTimeAsync(750)
  await checked
  expect(h.report().renderer.value).toEqual(sample)
  expect(JSON.stringify(h.report())).not.toContain('private')
})

it('keeps acquisition ownership after click completion and stops/disposes its late handle', async () => {
  const h = harness(), click = deferred()
  let release = (_handle: typeof h.handle) => {}
  h.page.evaluateHandle.mockImplementation(() => new Promise((resolve) => { release = resolve }))
  const result = h.run(() => click.promise)
  const settled = vi.fn()
  void result.then(settled) // Prove the pairing tail cannot resume before renderer cleanup.
  await vi.advanceTimersByTimeAsync(5100)
  click.resolve()
  await vi.advanceTimersByTimeAsync(100)
  expect(settled).not.toHaveBeenCalled()
  release(h.handle)
  await result
  await vi.advanceTimersByTimeAsync(0)
  expect(h.handle.evaluate).toHaveBeenCalledOnce()
  expect(h.handle.dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('an acquisition arriving after its deadline is disposed without installing renderer callbacks', async () => {
  const h = harness(), click = deferred()
  let release = () => {}
  const requestFrame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  h.page.evaluateHandle.mockImplementation((...args: unknown[]) => new Promise((resolve) => {
    release = () => {
      const install = args[0] as (params: unknown) => unknown
      expect(install(args[1])).toBeUndefined()
      resolve(h.handle)
    }
  }))
  const result = h.run(() => click.promise)
  await vi.advanceTimersByTimeAsync(5100)
  click.resolve()
  await vi.advanceTimersByTimeAsync(1700)
  await result
  expect(h.report().renderer).toEqual({ status: 'timed-out' })
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(requestFrame).not.toHaveBeenCalled()
  expect(h.handle.dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds a stalled snapshot and cleanup without reporting zero progress', async () => {
  const h = harness(), error = new Error('original')
  h.handle.evaluate.mockImplementation(() => new Promise(() => {}))
  h.handle.dispose.mockImplementation(() => new Promise(() => {}))
  const result = h.run(async () => { throw error })
  const checked = expect(result).rejects.toBe(error)
  await vi.advanceTimersByTimeAsync(2000)
  await checked
  expect(h.report().renderer).toEqual({ status: 'timed-out' })
  expect(h.report().cleanup).toBe('timed-out')
  expect(h.report().captureMs).toBe(2000)
  expect(vi.getTimerCount()).toBe(0)
})

it('the actual renderer sampler cancels both callback chains when the click completes', async () => {
  const h = harness(), click = deferred()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubGlobal('document', { querySelector: () => ({ disabled: false, getBoundingClientRect: () => bounds }) })
  const requestFrame = vi.fn((callback: () => void) => setTimeout(callback, 16))
  const cancelFrame = vi.fn((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer))
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  h.page.evaluateHandle.mockImplementation(async (...args: unknown[]) => {
    const install = args[0] as (params: unknown) => { stop: () => typeof sample }
    const observer = install(args[1])
    h.handle.evaluate.mockImplementation(async (...stopArgs: unknown[]) => (stopArgs[0] as (value: typeof observer) => typeof sample)(observer))
    return h.handle
  })
  const result = h.run(() => click.promise)
  await vi.advanceTimersByTimeAsync(5100)
  expect(requestFrame).toHaveBeenCalled()
  click.resolve()
  await result
  expect(h.report().renderer.value).toMatchObject({ intervalMs: 100, control: { enabled: true } })
  expect(h.report().renderer.value.frames).toBeGreaterThan(0)
  expect(h.report().renderer.value.timers).toBeGreaterThan(0)
  expect(cancelFrame).toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  const frameCalls = requestFrame.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(requestFrame.mock.calls).toHaveLength(frameCalls)
})
