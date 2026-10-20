import { afterEach, expect, it, vi } from 'vitest'
import { reconnectPhase, watchPhaseReconnect } from './phaseReconnectEvidence'
import { RecordedExchange, type Recording } from './recordedExchange'
import { encodeEnvelope } from '../../src/main/transport/codec'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import type { Page } from '@playwright/test'

afterEach(() => vi.unstubAllGlobals())
const message = (id: number, type: string) => ({ id, type, ts: '2026-10-20T00:00:00Z', payload: {} })
const recording = (): Recording => ({
  format: 'pyrycode.daemon-exchange', version: 2,
  source: { capturedAt: '2026-10-20T00:00:00Z', desktopRevision: 'a'.repeat(40), daemonRevision: 'b'.repeat(40),
    daemonBinarySha256: 'c'.repeat(64), claudeVersion: 'test' },
  scenario: { id: 'reconnect-ordering', inputs: { nonce: 1 } }, capabilities: ['interactive', 'thread'],
  deviceId: 'device', devices: ['device', 'device'],
  closures: [{ before: 1, connection: 1, code: 4413 }],
  wire: [
    { direction: 'client', connection: 1, message: message(2, 'list_conversations') },
    { direction: 'client', connection: 2, message: message(2, 'new_session') }
  ]
})

async function observer(reconnect: () => Promise<void>) {
  let deliver = (_event: DaemonEvent) => {}
  const window = { pyry: { onDaemonEvent: (listener: typeof deliver) => { deliver = listener; return () => {} },
    reconnectServer: reconnect }, phaseReconnectEvidence: undefined as unknown as { snapshot(): { connections: number } } }
  vi.stubGlobal('window', window)
  // This fixture callback is browser-independent; exercise the actual page observer body.
  await watchPhaseReconnect({ evaluate: async (run: () => void) => run() } as unknown as Page)
  const connected = () => deliver({ type: 'connected', ack: { protocol_version: '2', server_id: 'host', conn_id: 'connection',
    capabilities: ['interactive', 'thread'] } })
  connected()
  return { connected, snapshot: window.phaseReconnectEvidence.snapshot }
}

it('does not dispatch a third handshake after the captured reconnect already completed during the reply phase', async () => {
  const exchange = new RecordedExchange(recording())
  exchange.setTransportCloseObserver(() => {})
  const dispatch = vi.fn(async () => { exchange.reconnect() })
  const phase = await observer(dispatch)
  const before = phase.snapshot()
  exchange.reply(encodeEnvelope(message(20, 'list_conversations')))
  exchange.reconnect()
  phase.connected()
  // The actual next request still belongs to connection 2: reconnect must not skip it.
  expect(await reconnectPhase({ host: 'host', connections: before.connections })).toMatchObject({ connections: 2, dispatched: false })
  expect(dispatch).not.toHaveBeenCalled()
  expect(phase.snapshot().connections).toBeGreaterThan(before.connections)
  exchange.reply(encodeEnvelope(message(20, 'new_session')))
  exchange.assertComplete()
  expect(exchange.stats()).toEqual({ matchedRequests: 2, emittedFrames: 0, remainingRequests: 0 })
})

it('dispatches the explicit reconnect while the original connection is still current', async () => {
  const dispatch = vi.fn(async () => {})
  const phase = await observer(dispatch)
  await reconnectPhase({ host: 'host', connections: phase.snapshot().connections })
  expect(dispatch).toHaveBeenCalledOnce()
  // Dispatch does not invent an observer event; only authenticated delivery advances it.
  expect(phase.snapshot().connections).toBe(1)
  phase.connected()
  expect(phase.snapshot().connections).toBe(2)
})

it('keeps an incomplete or wrong-connection transition strictly rejected with the original error', () => {
  const exchange = new RecordedExchange(recording())
  let original: unknown
  try { exchange.reconnect() } catch (error) { original = error }
  expect(original).toEqual(new Error('Recorded exchange connection mismatch'))
  expect(() => exchange.reply(encodeEnvelope(message(20, 'new_session')))).toThrow(original as Error)
  expect(() => exchange.assertComplete()).toThrow(original as Error)
  expect(exchange.stats()).toEqual({ matchedRequests: 0, emittedFrames: 0, remainingRequests: 2 })
})

it('preserves a dispatch failure without turning it into observed progress', async () => {
  const original = new Error('test-owned dispatch failure')
  const phase = await observer(async () => { throw original })
  await expect(reconnectPhase({ host: 'host', connections: phase.snapshot().connections })).rejects.toBe(original)
  expect(phase.snapshot().connections).toBe(1)
})

it('starts a new baseline for a later phase instead of suppressing every subsequent reconnect', async () => {
  const dispatch = vi.fn(async () => {})
  const phase = await observer(dispatch)
  phase.connected()
  const before = phase.snapshot()
  await reconnectPhase({ host: 'host', connections: before.connections })
  expect(dispatch).toHaveBeenCalledOnce()
  expect(phase.snapshot().connections).toBe(2)
})
