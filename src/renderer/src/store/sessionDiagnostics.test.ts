import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HelloAckPayload, MessagePayload } from '@shared/wire/types'
import { createSessionStore, initialSessionState, type SessionState } from './sessionStore'
import { toDiagnosticRecord, logSessionTransition } from './sessionDiagnostics'

// Fixtures — plain wire-shaped data, mirroring sessionStore.test.ts. No transport involved.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

function msg(message_id: string, text = `text ${message_id}`): MessagePayload {
  return { conversation_id: 'conv-1', message_id, role: 'assistant', text }
}

function stateWith(...messages: MessagePayload[]): SessionState {
  return { status: { type: 'disconnected' }, messages }
}

describe('toDiagnosticRecord — content-free record shape', () => {
  it('maps a message transition to {event, code=type, count} (AC1)', () => {
    const record = toDiagnosticRecord(
      { type: 'messageReceived', message: msg('m1') },
      stateWith(msg('m1'))
    )
    expect(record).toEqual({ event: 'store-transition', code: 'messageReceived', count: 1 })
  })

  it('maps a status transition, carrying the post-reduce message count (AC1)', () => {
    const record = toDiagnosticRecord({ type: 'connected', ack }, stateWith(msg('m1'), msg('m2')))
    expect(record).toEqual({ event: 'store-transition', code: 'connected', count: 2 })
  })

  it('carries none of the message payload — no planted secret (AC4)', () => {
    const record = toDiagnosticRecord(
      { type: 'messageReceived', message: msg('m1', 'PLANTED_SECRET') },
      stateWith(msg('m1', 'PLANTED_SECRET'))
    )
    expect(JSON.stringify(record)).not.toContain('PLANTED_SECRET')
  })

  it("emits no store-supplied seq — ordering is the logger's job (AC2)", () => {
    const record = toDiagnosticRecord({ type: 'connecting' }, initialSessionState)
    expect('seq' in record).toBe(false)
  })
})

describe('logSessionTransition — emits through window.pyry.sendDiagnostic', () => {
  let sendDiagnostic: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendDiagnostic = vi.fn()
    globalThis.window = { pyry: { sendDiagnostic } } as unknown as Window & typeof globalThis
  })
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('emits exactly one content-free record per dispatch, secret-free (AC4)', () => {
    const store = createSessionStore(initialSessionState, logSessionTransition)
    store.getState().dispatch({ type: 'messageReceived', message: msg('m1', 'PLANTED_SECRET') })

    expect(sendDiagnostic).toHaveBeenCalledTimes(1)
    const record = sendDiagnostic.mock.calls[0][0]
    const serialized = JSON.stringify(record)
    expect(serialized).toContain('store-transition')
    expect(serialized).toContain('messageReceived')
    expect(record.count).toBe(1)
    expect(serialized).not.toContain('PLANTED_SECRET')
  })

  it('logs every dispatch, including a same-state dedup — the choke-point, not .subscribe (AC3)', () => {
    const store = createSessionStore(initialSessionState, logSessionTransition)
    // The same message_id dispatched twice: appendUnique drops the second (no state change) ...
    store.getState().dispatch({ type: 'messageReceived', message: msg('m1') })
    store.getState().dispatch({ type: 'messageReceived', message: msg('m1') })

    expect(store.getState().messages).toHaveLength(1)
    // ... yet the observer fires on both — a .subscribe-based observer would miss the second.
    expect(sendDiagnostic).toHaveBeenCalledTimes(2)
    expect(sendDiagnostic.mock.calls[1][0]).toEqual({
      event: 'store-transition',
      code: 'messageReceived',
      count: 1
    })
  })
})

describe('logSessionTransition — degrades to a no-op when the channel is unavailable (AC5)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('does not throw and still reduces when window is absent', () => {
    const store = createSessionStore(initialSessionState, logSessionTransition)
    expect(() => store.getState().dispatch({ type: 'connecting' })).not.toThrow()
    expect(store.getState().status).toEqual({ type: 'connecting' })
  })

  it('does not throw when called directly with no window', () => {
    expect(() => logSessionTransition({ type: 'connecting' }, initialSessionState)).not.toThrow()
  })

  it('does not throw when window exists but has no sendDiagnostic', () => {
    globalThis.window = { pyry: {} } as unknown as Window & typeof globalThis
    try {
      const store = createSessionStore(initialSessionState, logSessionTransition)
      expect(() => store.getState().dispatch({ type: 'connecting' })).not.toThrow()
      expect(() =>
        logSessionTransition({ type: 'connecting' }, initialSessionState)
      ).not.toThrow()
    } finally {
      Reflect.deleteProperty(globalThis, 'window')
    }
  })
})
