import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { encodeEnvelope } from '../../src/main/transport/codec'
import { RecordedExchange, type Recording } from './recordedExchange'
import { clientAppLifecycle } from './clientAppLifecycle'
import { withIsolatedElectronApp } from './realDaemon'
import { test as registered } from './clientScenario'
import { withEffortScenarioProof } from './effortScenarioProof'
import { access } from 'node:fs/promises'

vi.hoisted(() => { vi.stubEnv('PYRY_CLIENT_MODE', 'replay') })
vi.mock('@playwright/test', async original => {
  const actual = await original<typeof import('@playwright/test')>()
  const extend = (fixtures: object) => ({ ...fixtures, extend })
  return { ...actual, test: { extend } }
})
const boundary = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('./electronLaunch', () => ({ electron: { launch: boundary.launch } }))
vi.mock('./desktopIsolation', () => ({
  RENDERER_THROTTLING_SWITCHES: [], e2eShowsWindow: () => false,
  appWindow: async (app: ElectronApplication) => app.firstWindow(), expectDesktopIsolated: async () => {}
}))
vi.mock('./replayNativeStorage', () => ({ assertReplayNativeStorage: async () => {} }))

const message = (id: number, type: string) => ({ id, type, ts: '2026-10-16T00:00:00Z', payload: {} })
const recording = (): Recording => ({
  format: 'pyrycode.daemon-exchange', version: 2,
  source: { capturedAt: '2026-10-16T00:00:00Z', desktopRevision: 'a'.repeat(40),
    daemonRevision: 'b'.repeat(40), daemonBinarySha256: 'c'.repeat(64), claudeVersion: 'unit' },
  scenario: { id: 'retirement-unit', inputs: { nonce: 1 } }, capabilities: ['thread', 'interactive'],
  deviceId: 'saved', devices: ['saved', 'saved', 'independent'],
  wire: [
    { connection: 1, direction: 'client', message: message(2, 'list_conversations') },
    { connection: 1, direction: 'daemon', message: message(3, 'conversations') },
    { connection: 2, direction: 'client', message: message(2, 'thread_catch_up') },
    { connection: 2, direction: 'daemon', message: message(3, 'thread_items') },
    { connection: 2, direction: 'client', message: message(4, 'list_conversations') },
    { connection: 2, direction: 'daemon', message: message(5, 'conversations') },
    { connection: 2, direction: 'daemon', message: message(6, 'conversations') },
    { connection: 3, direction: 'client', message: message(2, 'list_conversations') },
    { connection: 3, direction: 'daemon', message: message(3, 'conversations') }
  ]
})
type ReplayHook = (deps: { daemon: object; exchange: RecordedExchange; recording: Recording;
  relay?: { whenServerFramesForwarded: (count: number) => Promise<void> } },
  use: () => Promise<void>) => Promise<void>
const registeredHook = (registered as unknown as { _clientReplay: [ReplayHook, object] })._clientReplay[0]
const replayHook: ReplayHook = (deps, use) => registeredHook({ ...deps,
  relay: deps.relay ?? { whenServerFramesForwarded: async () => {} } } as any, use)

afterAll(() => { vi.unstubAllEnvs() })
afterEach(() => {
  delete clientAppLifecycle.opened
  delete clientAppLifecycle.closing
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function processes(order: string[]) {
  const apps: { app: ElectronApplication; child: { exitCode: number | null; signalCode: null } }[] = []
  boundary.launch.mockImplementation(async () => {
    const ordinal = apps.length + 1
    const child = { exitCode: null as number | null, signalCode: null }
    const page = { evaluate: async () => ({ ok: true, deviceId: ordinal < 3 ? 'saved' : 'independent' }) } as unknown as Page
    const app = { process: () => child, firstWindow: async () => page, close: async () => {
      order.push(`exit-${ordinal}`); child.exitCode = 0
    } } as unknown as ElectronApplication
    apps.push({ app, child })
    return app
  })
  return apps
}

it('settles the delayed resumed list and sends both replies before exit and independent connection', async () => {
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture)
  await replayHook({ daemon: {}, exchange, recording: capture }, async () => {
    await withIsolatedElectronApp(async initial => {
      exchange.reply(encodeEnvelope(message(2, 'list_conversations')))
      const resumed = await initial.relaunch()
      exchange.reconnect()
      exchange.reply(encodeEnvelope(message(2, 'thread_catch_up')))
      order.push('visible-history-assertions')
      // Natural application work is already scheduled; close must keep its process alive.
      const outgoing = nextTurn().then(() => {
        if (apps[1].child.exitCode !== null) return
        order.push('resumed-list')
        // Mirror handleTransport: match first, synchronously send the complete returned batch.
        for (const _frame of exchange.reply(encodeEnvelope(message(4, 'list_conversations')))) order.push('outbound-reply')
      })
      await resumed.close()
      await outgoing
      await withIsolatedElectronApp(async () => {
        order.push('independent-connection')
        console.info(JSON.stringify({ retirementOrdering: order, ...exchange.stats() }))
        exchange.reconnect()
        exchange.reply(encodeEnvelope(message(2, 'list_conversations')))
      })
    })
  })
  expect(order).toEqual(['exit-1', 'visible-history-assertions', 'resumed-list',
    'outbound-reply', 'outbound-reply', 'exit-2', 'independent-connection', 'exit-3'])
  expect(exchange.stats().remainingRequests).toBe(0)
  exchange.assertComplete()
  expect(clientAppLifecycle.opened).toBeUndefined()
  expect(clientAppLifecycle.closing).toBeUndefined()
})

it('failure cleanup bypasses settlement and preserves the scenario error', async () => {
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture), primary = new Error('scenario failure')
  await expect(replayHook({ daemon: {}, exchange, recording: capture }, () =>
    withIsolatedElectronApp(async () => { throw primary }))).rejects.toBe(primary)
  expect(apps[0].child.exitCode).toBe(0)
  expect(order).toEqual(['exit-1'])
  expect(clientAppLifecycle.closing).toBeUndefined()
})

it('effort replacement prerequisite rejection survives final proof and isolated-profile cleanup', async () => {
  const order: string[] = [], apps = processes(order)
  const primary = new Error('replacement prerequisite'), snapshots = vi.fn()
  let profile = '', opened = 0
  clientAppLifecycle.opened = async () => { if (++opened === 2) throw primary }
  await expect(withIsolatedElectronApp(async handles => {
    profile = handles.userDataDir
    const page = handles.page
    page.isClosed = () => apps[0].child.exitCode !== null
    await withEffortScenarioProof(page, async () => ({
      samples: [], snapshot: async () => {
        snapshots()
        if (page.isClosed()) throw new Error('closed page masks prerequisite')
        return { events: [], footer: '' }
      }, dispose: async () => { order.push('proof-disposed') }
    }), async () => {}, async (_, handoff) => { await handoff(handles.relaunch) })
  })).rejects.toBe(primary)
  expect(snapshots).toHaveBeenCalledTimes(1)
  expect(order).toEqual(['proof-disposed', 'exit-1', 'exit-2'])
  expect(apps.every(({ child }) => child.exitCode === 0)).toBe(true)
  await expect(access(profile)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['forwarded', 'failed'] as const)('retirement waits for relay forwarding: %s', async mode => {
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture), primary = new Error('relay delivery failed')
  let confirm = () => {}, fail = (_error: Error) => {}, started = () => {}
  const forwarding = new Promise<void>((resolve, reject) => { confirm = resolve; fail = reject })
  const observed = new Promise<void>(resolve => { started = resolve })
  const relay = { whenServerFramesForwarded: vi.fn((_count: number) => {
    order.push('relay-wait'); started(); return forwarding
  }) }
  const outcome = replayHook({ daemon: {}, exchange, recording: capture, relay }, () =>
    withIsolatedElectronApp(async profile => {
      exchange.reply(encodeEnvelope(message(2, 'list_conversations')))
      order.push('prefix-complete')
      await profile.close()
    })).then(() => undefined, error => error)
  await observed
  // Matching/emission alone cannot retire the process: the relay has not confirmed its writes.
  expect(relay.whenServerFramesForwarded).toHaveBeenCalledTimes(1)
  expect(relay.whenServerFramesForwarded).toHaveBeenCalledWith(2)
  expect(exchange.stats()).toEqual({ matchedRequests: 1, emittedFrames: 1, remainingRequests: 3 })
  expect(apps[0].child.exitCode).toBeNull()
  expect(order).toEqual(['prefix-complete', 'relay-wait'])
  order.push(mode === 'forwarded' ? 'relay-forwarded' : 'relay-failed')
  if (mode === 'forwarded') confirm()
  else fail(primary)
  expect(await outcome).toBe(mode === 'forwarded' ? undefined : primary)
  expect(apps[0].child.exitCode).toBe(0)
  expect(order.at(-1)).toBe('exit-1')
  expect(clientAppLifecycle.opened).toBeUndefined()
  expect(clientAppLifecycle.closing).toBeUndefined()
})

it('failed explicit retirement closes once, retains its causal mismatch and disposes hooks', async () => {
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture)
  let primary: unknown
  try { exchange.reply(encodeEnvelope(message(2, 'unexpected'))) } catch (error) { primary = error }
  await expect(replayHook({ daemon: {}, exchange, recording: capture }, () =>
    withIsolatedElectronApp(async profile => { await profile.close() }))).rejects.toBe(primary)
  expect(apps[0].child.exitCode).toBe(0)
  expect(order).toEqual(['exit-1'])
  expect(clientAppLifecycle.closing).toBeUndefined()
  // A following non-replay case must not inherit the failed exchange.
  await withIsolatedElectronApp(async () => {})
  expect(order).toEqual(['exit-1', 'exit-2'])
})

it.each(['explicit', 'callback'] as const)('missing prefix fails %s retirement within its bound and still exits', async mode => {
  vi.useFakeTimers()
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture)
  const attempt = replayHook({ daemon: {}, exchange, recording: capture }, () =>
    withIsolatedElectronApp(async profile => { if (mode === 'explicit') await profile.close() }))
  const failure = expect(attempt).rejects.toThrow('connection prefix incomplete')
  // Filesystem setup is real; wait for the profile/retirement hook, not wall time.
  while (apps.length === 0 || vi.getTimerCount() === 0) await nextTurn()
  await vi.advanceTimersByTimeAsync(5_000)
  await failure
  expect(order).toEqual(['exit-1'])
  expect(apps[0].child.exitCode).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(clientAppLifecycle.closing).toBeUndefined()
})

it('preserves the retirement mismatch even when Electron close also rejects', async () => {
  const order: string[] = [], apps = processes(order), capture = recording()
  const exchange = new RecordedExchange(capture)
  let primary: unknown
  try { exchange.reconnect() } catch (error) { primary = error }
  await expect(replayHook({ daemon: {}, exchange, recording: capture }, () =>
    withIsolatedElectronApp(async profile => {
      vi.spyOn(profile.app, 'close').mockImplementation(async () => {
        apps[0].child.exitCode = 0
        order.push('exit-1')
        throw new Error('secondary close failure')
      })
      await profile.close()
    }))).rejects.toBe(primary)
  expect(order).toEqual(['exit-1'])
  expect(clientAppLifecycle.closing).toBeUndefined()
})
