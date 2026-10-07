import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

export const WELCOME_STALL_ATTACHMENT = 'welcome-stall'
const TRIGGER_MS = 5_000
const CAPTURE_MS = 2_000
const SAMPLE_MS = 750
type Reading = { status: 'available'; value: unknown } | { status: 'timed-out' | 'failed' | 'unavailable' | 'cancelled' }
const observers = new WeakMap<Page, (click: () => Promise<void>) => Promise<void>>()

// Preserve the shared pairing helper's contract; only the default launch fixture registers here.
export function observeWelcomeClick(page: Page, click: () => Promise<void>): Promise<void> {
  return observers.get(page)?.(click) ?? click()
}

async function bounded(read: () => Promise<unknown>, deadline: number, signal?: AbortSignal): Promise<Reading> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => {}
  try {
    if (signal?.aborted) return { status: 'cancelled' }
    return await Promise.race([
      Promise.resolve().then(read).then((value): Reading => ({ status: 'available', value }), (): Reading => ({ status: 'failed' })),
      new Promise<Reading>((resolve) => { timer = setTimeout(() => resolve({ status: 'timed-out' }), Math.max(0, deadline - Date.now())) }),
      new Promise<Reading>((resolve) => {
        cancel = () => resolve({ status: 'cancelled' })
        signal?.addEventListener('abort', cancel, { once: true })
      })
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : undefined
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function bounds(value: unknown) {
  const r = record(value)
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return undefined
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}
function nativeValue(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const windows = value.map((entry: unknown) => {
    const r = record(entry), box = bounds(r?.bounds)
    if (!r || !box || typeof r.visible !== 'boolean' || typeof r.minimized !== 'boolean' || typeof r.focused !== 'boolean') return undefined
    return { visible: r.visible, minimized: r.minimized, focused: r.focused, bounds: box }
  })
  return windows.every((window) => window !== undefined) ? windows : undefined
}
function rendererValue(value: unknown) {
  const r = record(value), control = record(r?.control)
  if (!r || !control || !finite(r.intervalMs) || r.intervalMs < 0 || r.intervalMs > 1_000 ||
    !finite(r.frames) || !Number.isInteger(r.frames) || r.frames < 0 ||
    !finite(r.timers) || !Number.isInteger(r.timers) || r.timers < 0 || typeof control.present !== 'boolean') return undefined
  if (!control.present) return { intervalMs: r.intervalMs, frames: r.frames, timers: r.timers, control: { present: false } }
  const box = bounds(control.bounds)
  if (!box || typeof control.enabled !== 'boolean') return undefined
  return { intervalMs: r.intervalMs, frames: r.frames, timers: r.timers, control: { present: true, enabled: control.enabled, bounds: box } }
}
function allowlisted(reading: Reading, parse: (value: unknown) => unknown): Reading {
  if (reading.status !== 'available') return reading
  const value = parse(reading.value)
  return value === undefined ? { status: 'unavailable' } : { status: 'available', value }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

async function capture(page: Page, app: ElectronApplication, signal: AbortSignal) {
  const started = Date.now(), deadline = started + CAPTURE_MS
  const native = bounded(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), bounds: window.getBounds()
  }))), deadline, signal)
  let abandoned = false
  const installation = page.evaluateHandle(({ expiresAt, sampleMs }) => {
    // A request queued behind a stalled renderer must not install an observer after its deadline.
    if (Date.now() >= expiresAt) return undefined
    const startedAt = performance.now()
    const button = document.querySelector<HTMLButtonElement>('button.welcome__pair')
    const box = button?.getBoundingClientRect()
    const control = button && box ? {
      present: true, enabled: !button.disabled,
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height }
    } : { present: false }
    let frames = 0, timers = 0, stoppedAt: number | undefined
    let frame = 0, timer = 0, expiry = 0
    const stop = () => {
      stoppedAt ??= performance.now()
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(expiry)
      return { intervalMs: stoppedAt - startedAt, frames, timers, control }
    }
    const active = () => stoppedAt === undefined && performance.now() - startedAt < sampleMs && Date.now() < expiresAt
    const onFrame = () => { if (!active()) { stop(); return }; frames++; frame = requestAnimationFrame(onFrame) }
    const onTimer = () => { if (!active()) { stop(); return }; timers++; timer = window.setTimeout(onTimer, 50) }
    frame = requestAnimationFrame(onFrame)
    timer = window.setTimeout(onTimer, 50)
    expiry = window.setTimeout(stop, sampleMs)
    return { stop }
  }, { expiresAt: deadline, sampleMs: SAMPLE_MS })
  let handle: Awaited<typeof installation> | undefined
  // A timed-out acquisition can still arrive later. Stop/dispose it, without observing more state.
  void installation.then(async (late) => {
    if (abandoned) {
      await bounded(() => late.evaluate((value) => value?.stop()), Date.now() + 200)
      await bounded(() => late.dispose(), Date.now() + 200)
    }
  }, () => {}) // Rejection is classified by the bounded acquisition below.
  const installed = await bounded(async () => { handle = await installation }, deadline - 200, signal)
  let renderer: Reading = installed.status === 'available' ? { status: 'unavailable' } : installed
  let cleanup: Reading = { status: 'unavailable' }
  if (handle) {
    await pause(Math.min(SAMPLE_MS, Math.max(0, deadline - 200 - Date.now())), signal)
    renderer = await bounded(() => handle?.evaluate((value) => value?.stop()) ?? Promise.resolve(), deadline - 100)
    cleanup = await bounded(() => handle?.dispose() ?? Promise.resolve(), deadline)
  } else {
    abandoned = true
  }
  return {
    captureMs: Date.now() - started,
    native: allowlisted(await native, nativeValue),
    renderer: allowlisted(renderer, rendererValue), cleanup: cleanup.status
  }
}

export async function withWelcomeDiagnostics<T>(
  page: Page, app: ElectronApplication, sink: Pick<TestInfo, 'attach'>, launchIndex: number,
  run: () => Promise<T>
): Promise<T> {
  observers.set(page, async (click) => {
    const stop = new AbortController()
    let diagnostic: Promise<void> | undefined
    const start = (trigger: 'pending' | 'failed') => {
      diagnostic ??= (async () => {
        try {
          const report = await capture(page, app, stop.signal)
          await bounded(() => sink.attach(WELCOME_STALL_ATTACHMENT, {
            body: Buffer.from(JSON.stringify({ launchIndex, trigger, ...report })), contentType: 'application/json'
          }), Date.now() + 200)
        } catch { /* Diagnostics must preserve the original click outcome and existing teardown. */ }
      })()
    }
    const timer = setTimeout(() => start('pending'), TRIGGER_MS)
    try {
      await click()
      stop.abort()
    } catch (error) {
      if (!diagnostic) start('failed')
      else stop.abort()
      await diagnostic
      throw error
    } finally {
      clearTimeout(timer)
      await diagnostic
      stop.abort()
    }
  })
  try { return await run() } finally { observers.delete(page) }
}
