import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAppUpdateController, registerAppUpdate, selectAppUpdateEligibility, createQuitDrain } from './appUpdate'
import { validateUpdateVersion } from '../shared/ipc/appUpdate'

function fixture(isPackaged = true, platform = 'win32') {
  const updater = Object.assign(new EventEmitter(), {
    logger: {}, autoDownload: false, autoInstallOnAppQuit: false, disableWebInstaller: false,
    checkForUpdates: vi.fn(async (): Promise<any> => null), quitAndInstall: vi.fn()
  })
  const beforeInstall = vi.fn(async () => {})
  const log = { event: vi.fn() }
  const construct = vi.fn(() => updater)
  const controller = createAppUpdateController({ isPackaged, platform, construct, beforeInstall, log })
  return { controller, updater, construct, beforeInstall, log }
}
const ready = (f: ReturnType<typeof fixture>, version: unknown = '1.2.3') => {
  f.updater.emit('update-available')
  f.updater.emit('update-downloaded', { version, releaseNotes: 'PRIVATE', path: 'PRIVATE' })
}
const settled = () => new Promise(resolve => setImmediate(resolve))

describe('Windows app updater', () => {
  it('is false-first and never constructs on dev or other platforms', async () => {
    expect(selectAppUpdateEligibility({ isPackaged: false, get platform(): string { throw Error('must not read') } })).toBe(false)
    for (const [packaged, platform] of [[false, 'win32'], [true, 'darwin'], [true, 'linux']] as const) {
      const f = fixture(packaged, platform)
      await f.controller.start()
      expect(f.construct).not.toHaveBeenCalled()
      expect(f.controller.snapshot()).toEqual({ type: 'idle' })
      await f.controller.command({ type: 'restart' })
      expect(f.beforeInstall).not.toHaveBeenCalled()
    }
  })
  it('checks once, configures silence and only downloaded becomes ready; late subscriber receives current', async () => {
    const f = fixture()
    await f.controller.start(); await f.controller.start()
    expect(f.construct).toHaveBeenCalledTimes(1)
    expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(f.updater).toMatchObject({ logger: null, autoDownload: true, autoInstallOnAppQuit: true, disableWebInstaller: true })
    f.updater.emit('update-downloaded', { version: '9.9.9' })
    expect(f.controller.snapshot()).toEqual({ type: 'idle' })
    ready(f)
    expect(f.controller.snapshot()).toEqual({ type: 'ready', version: '1.2.3' })
    const subscriber = vi.fn()
    const off = f.controller.subscribe(subscriber)
    expect(subscriber).toHaveBeenLastCalledWith({ type: 'ready', version: '1.2.3' })
    off(); await f.controller.command({ type: 'dismiss' })
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.log.event.mock.calls)).not.toMatch(/PRIVATE|1\.2\.3/)
  })
  it('check event/rejection stays invisible, download event/rejection fails once and dismissal latches', async () => {
    const check = fixture()
    check.updater.checkForUpdates.mockImplementation(async () => { check.updater.emit('error', Error('PRIVATE')); throw Error('PRIVATE') })
    await check.controller.start()
    expect(check.controller.snapshot()).toEqual({ type: 'idle' })
    for (const rejection of [false, true]) {
      const f = fixture()
      f.updater.checkForUpdates.mockImplementation(async () => {
        f.updater.emit('update-available')
        return { downloadPromise: rejection ? Promise.reject(Error('PRIVATE')) : Promise.resolve([]) }
      })
      await f.controller.start()
      if (!rejection) f.updater.emit('error', Error('PRIVATE'))
      expect(f.controller.snapshot()).toEqual({ type: 'failed' })
      await f.controller.command({ type: 'dismiss' })
      f.updater.emit('error', Error('PRIVATE')); f.updater.emit('update-downloaded', { version: '1.2.3' })
      expect(f.controller.snapshot()).toEqual({ type: 'idle' })
      await f.controller.command({ type: 'restart' })
      expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
      expect(JSON.stringify(f.log.event.mock.calls)).not.toContain('PRIVATE')
    }
    const nextLaunch = fixture(); await nextLaunch.controller.start(); ready(nextLaunch)
    expect(nextLaunch.controller.snapshot().type).toBe('ready')
  })
  it('Later preserves quit installation and verified authority; restart drains and installs exactly once', async () => {
    const f = fixture(); await f.controller.start()
    await f.controller.command({ type: 'restart' }); await f.controller.command({ type: 'evil', url: 'PRIVATE' })
    expect(f.beforeInstall).not.toHaveBeenCalled()
    ready(f, 'v1.2.3')
    expect(f.controller.snapshot()).toEqual({ type: 'ready', version: null })
    await f.controller.command({ type: 'dismiss' }); ready(f)
    expect(f.controller.snapshot()).toEqual({ type: 'idle' })
    expect(f.updater.autoInstallOnAppQuit).toBe(true)
    let drain!: () => void
    f.beforeInstall.mockImplementation(() => new Promise<void>(resolve => { drain = resolve }))
    const restart = f.controller.command({ type: 'restart' })
    await f.controller.command({ type: 'restart' })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    drain(); await restart
    expect(f.updater.quitAndInstall.mock.calls).toEqual([[true, true]])
    expect(f.beforeInstall).toHaveBeenCalledTimes(1)
  })
  it('contains startup/install errors and cancels/removes listeners on disposal', async () => {
    const f = fixture(); const cancel = vi.fn()
    f.updater.checkForUpdates.mockResolvedValue({ cancellationToken: { cancel }, downloadPromise: Promise.resolve([]) })
    await f.controller.start(); ready(f)
    f.updater.quitAndInstall.mockImplementation(() => { throw Error('PRIVATE') })
    await f.controller.command({ type: 'restart' })
    expect(f.controller.snapshot()).toEqual({ type: 'failed' })
    f.controller.dispose(); expect(cancel).toHaveBeenCalledOnce()
    expect(f.updater.listenerCount('update-downloaded')).toBe(0)
    const broken = fixture(); broken.construct.mockImplementation(() => { throw Error('PRIVATE') })
    await broken.controller.start(); expect(broken.controller.snapshot()).toEqual({ type: 'idle' })
    await settled()
  })
  it('IPC rejects untrusted senders and malformed commands and cleans up', async () => {
    const f = fixture(); await f.controller.start(); ready(f)
    const target = Object.assign(new EventEmitter(), { handle: vi.fn(), removeHandler: vi.fn() })
    const emit = vi.fn()
    const off = registerAppUpdate(target as any, f.controller, e => (e as unknown) === 'trusted', emit)
    const query = target.handle.mock.calls[0][1]
    expect(query('untrusted')).toEqual({ type: 'idle' })
    expect(query('trusted')).toEqual({ type: 'ready', version: '1.2.3' })
    target.emit('pyry:app-update-action', 'untrusted', { type: 'restart' })
    target.emit('pyry:app-update-action', 'trusted', { type: 'restart', path: 'PRIVATE' })
    await settled(); expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    target.emit('pyry:app-update-action', 'trusted', { type: 'dismiss' })
    expect(emit).toHaveBeenLastCalledWith({ type: 'idle' })
    off(); expect(target.listenerCount('pyry:app-update-action')).toBe(0)
  })
})

it('validates only bounded ASCII stable version text', () => {
  for (const version of ['0.0.0', '1.20.300', '1'.repeat(60) + '.0.0']) expect(validateUpdateVersion(version)).toBe(version)
  for (const version of [null, 2, '01.2.3', '1.02.3', '1.2.03', 'v1.2.3', '1.2.3 ', '1.2.3\n', '1.2.3\r', ' 1.2.3', '1.2.3-rc', '1.2.3+meta', '١.2.3', '1'.repeat(61) + '.0.0']) expect(validateUpdateVersion(version)).toBeNull()
})

it('shares the real quit drain across restart and ordinary quit, stopping before flushing', async () => {
  let finish!: () => void
  const order: string[] = []
  const drain = createQuitDrain(() => { order.push('stop') }, () => {
    order.push('flush'); return new Promise<void>(resolve => { finish = resolve })
  })
  const first = drain(), second = drain()
  expect(first).toBe(second); expect(order).toEqual(['stop', 'flush'])
  finish(); await first; await drain(); expect(order).toEqual(['stop', 'flush'])
})

it('handles event-based install errors and drain rejection without exposing exception text', async () => {
  for (const failDrain of [false, true]) {
    const f = fixture(); await f.controller.start(); ready(f)
    if (failDrain) f.beforeInstall.mockRejectedValue(Error('PRIVATE'))
    else f.updater.quitAndInstall.mockImplementation(() => { f.updater.emit('error', Error('PRIVATE')) })
    await f.controller.command({ type: 'restart' })
    expect(f.controller.snapshot()).toEqual({ type: 'failed' })
    await f.controller.command({ type: 'restart' })
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(failDrain ? 0 : 1)
    expect(JSON.stringify(f.log.event.mock.calls)).not.toContain('PRIVATE')
  }
})
it('cancels a late check result after disposal and ignores late completion', async () => {
  const f = fixture(); let resolve!: (value: unknown) => void
  f.updater.checkForUpdates.mockImplementation(() => new Promise<any>(r => { resolve = r }))
  const pending = f.controller.start(); f.controller.dispose()
  const cancel = vi.fn(); resolve({ cancellationToken: { cancel }, downloadPromise: Promise.resolve([]) })
  await pending; expect(cancel).toHaveBeenCalledOnce()
  f.updater.emit('update-downloaded', { version: '1.2.3' }); f.updater.emit('error', Error('PRIVATE'))
  expect(f.controller.snapshot()).toEqual({ type: 'idle' })
})
