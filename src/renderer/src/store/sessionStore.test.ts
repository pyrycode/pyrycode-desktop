import { describe, it, expect } from 'vitest'
import type { HelloAckPayload, MessagePayload } from '@shared/wire/types'
import {
  reduceSession,
  createSessionStore,
  initialSessionState,
  selectStatus,
  selectMessages,
  type ConnectionError,
  type SessionState
} from './sessionStore'

// Fixtures — plain wire-shaped data, no transport involved.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const connError: ConnectionError = {
  code: 'transport',
  message: 'relay socket dropped',
  retryable: true
}

function msg(message_id: string, role: MessagePayload['role'] = 'assistant'): MessagePayload {
  return { conversation_id: 'conv-1', message_id, role, text: `text ${message_id}` }
}

describe('reduceSession — status transitions', () => {
  it('moves disconnected → connecting', () => {
    const next = reduceSession(initialSessionState, { type: 'connecting' })
    expect(next.status).toEqual({ type: 'connecting' })
  })

  it('moves connecting → connected carrying the exact ack', () => {
    const connecting = reduceSession(initialSessionState, { type: 'connecting' })
    const connected = reduceSession(connecting, { type: 'connected', ack })
    expect(connected.status).toEqual({ type: 'connected', ack })
    if (connected.status.type === 'connected') {
      expect(connected.status.ack).toBe(ack)
    }
  })

  it('moves connecting → error carrying the exact ConnectionError', () => {
    const connecting = reduceSession(initialSessionState, { type: 'connecting' })
    const failed = reduceSession(connecting, { type: 'failed', error: connError })
    expect(failed.status).toEqual({ type: 'error', error: connError })
    if (failed.status.type === 'error') {
      expect(failed.status.error).toBe(connError)
    }
  })

  it('moves connected → disconnected', () => {
    const connected = reduceSession(initialSessionState, { type: 'connected', ack })
    const disconnected = reduceSession(connected, { type: 'disconnected' })
    expect(disconnected.status).toEqual({ type: 'disconnected' })
  })
})

describe('reduceSession — message append order', () => {
  it('appends a single received message', () => {
    const next = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    expect(next.messages.map((m) => m.message_id)).toEqual(['m1'])
  })

  it('preserves arrival order across two single appends', () => {
    const s1 = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    const s2 = reduceSession(s1, { type: 'messageReceived', message: msg('m2') })
    expect(s2.messages.map((m) => m.message_id)).toEqual(['m1', 'm2'])
  })

  it('appends a batch in order', () => {
    const batch = [msg('m1'), msg('m2'), msg('m3')]
    const next = reduceSession(initialSessionState, { type: 'messagesReceived', messages: batch })
    expect(next.messages.map((m) => m.message_id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('preserves order when a batch follows an existing message', () => {
    const s1 = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m0') })
    const s2 = reduceSession(s1, { type: 'messagesReceived', messages: [msg('m1'), msg('m2')] })
    expect(s2.messages.map((m) => m.message_id)).toEqual(['m0', 'm1', 'm2'])
  })

  it('dedups by message_id: a re-delivered message is not appended twice', () => {
    const s1 = reduceSession(initialSessionState, { type: 'messagesReceived', messages: [msg('m1'), msg('m2')] })
    // Backfill overlap re-delivers m2 and adds m3; only m3 is new.
    const s2 = reduceSession(s1, { type: 'messagesReceived', messages: [msg('m2'), msg('m3')] })
    expect(s2.messages.map((m) => m.message_id)).toEqual(['m1', 'm2', 'm3'])
    // A pure duplicate keeps the same array reference (no selector churn).
    const s3 = reduceSession(s2, { type: 'messageReceived', message: msg('m3') })
    expect(s3.messages).toBe(s2.messages)
  })
})

describe('reduceSession — optimistic send (messageSent)', () => {
  it('appends the optimistically-sent message and leaves status untouched', () => {
    const connected = reduceSession(initialSessionState, { type: 'connected', ack })
    const next = reduceSession(connected, { type: 'messageSent', message: msg('m1', 'user') })
    expect(next.messages.map((m) => m.message_id)).toEqual(['m1'])
    expect(next.status).toBe(connected.status)
  })

  it('dedupes the daemon echo of an optimistically-sent message by message_id (the AC3 invariant)', () => {
    const sent = reduceSession(initialSessionState, { type: 'messageSent', message: msg('m1', 'user') })
    // The daemon later echoes the same message_id back as a received message.
    const echoed = reduceSession(sent, { type: 'messageReceived', message: msg('m1', 'user') })
    expect(echoed.messages.map((m) => m.message_id)).toEqual(['m1'])
    // A pure duplicate keeps the same array reference (no selector churn).
    expect(echoed.messages).toBe(sent.messages)
  })
})

describe('reduceSession — orthogonality', () => {
  it('a message action leaves status untouched', () => {
    const connecting = reduceSession(initialSessionState, { type: 'connecting' })
    const next = reduceSession(connecting, { type: 'messageReceived', message: msg('m1') })
    expect(next.status).toBe(connecting.status)
  })

  it('a status action leaves the messages array untouched by reference', () => {
    const withMsg = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    const next = reduceSession(withMsg, { type: 'connecting' })
    expect(next.messages).toBe(withMsg.messages)
  })
})

describe('reduceSession — purity', () => {
  it('does not mutate the input state or its messages array on append', () => {
    const start: SessionState = { status: { type: 'disconnected' }, messages: [msg('m1')] }
    const startMessages = start.messages
    const next = reduceSession(start, { type: 'messageReceived', message: msg('m2') })

    expect(next.messages).not.toBe(start.messages)
    expect(start.messages).toBe(startMessages)
    expect(start.messages.map((m) => m.message_id)).toEqual(['m1'])
    expect(next.messages.map((m) => m.message_id)).toEqual(['m1', 'm2'])
  })
})

describe('selectors', () => {
  it('selectStatus returns the current status slice', () => {
    const connecting = reduceSession(initialSessionState, { type: 'connecting' })
    expect(selectStatus(connecting)).toBe(connecting.status)
  })

  it('selectMessages returns the current messages slice', () => {
    const withMsg = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    expect(selectMessages(withMsg)).toBe(withMsg.messages)
  })

  it('selectMessages returns the same reference across a status-only change', () => {
    const withMsg = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    const afterStatus = reduceSession(withMsg, { type: 'connecting' })
    expect(selectMessages(afterStatus)).toBe(selectMessages(withMsg))
  })

  it('selectMessages returns a new reference after an append', () => {
    const withMsg = reduceSession(initialSessionState, { type: 'messageReceived', message: msg('m1') })
    const afterAppend = reduceSession(withMsg, { type: 'messageReceived', message: msg('m2') })
    expect(selectMessages(afterAppend)).not.toBe(selectMessages(withMsg))
  })
})

describe('createSessionStore — wiring', () => {
  it('starts at the initial state', () => {
    const store = createSessionStore()
    expect(store.getState().status).toEqual({ type: 'disconnected' })
    expect(store.getState().messages).toEqual([])
  })

  it('dispatch moves the observable state', () => {
    const store = createSessionStore()
    store.getState().dispatch({ type: 'connecting' })
    store.getState().dispatch({ type: 'connected', ack })
    expect(store.getState().status).toEqual({ type: 'connected', ack })

    store.getState().dispatch({ type: 'messageReceived', message: msg('m1') })
    expect(store.getState().messages.map((m) => m.message_id)).toEqual(['m1'])
  })

  it('keeps two stores independent', () => {
    const a = createSessionStore()
    const b = createSessionStore()
    a.getState().dispatch({ type: 'messageReceived', message: msg('m1') })
    expect(a.getState().messages).toHaveLength(1)
    expect(b.getState().messages).toHaveLength(0)
  })

  it('keeps the dispatch reference stable across updates', () => {
    const store = createSessionStore()
    const before = store.getState().dispatch
    store.getState().dispatch({ type: 'connecting' })
    expect(store.getState().dispatch).toBe(before)
  })
})
