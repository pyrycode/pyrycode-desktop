import { describe, it, expect } from 'vitest'
import type { HelloAckPayload, MessagePayload } from '@shared/wire/types'
import {
  reduceSession,
  createSessionStore,
  initialSessionState,
  selectStatus,
  selectStatusFor,
  selectMessages,
  type ConnectionError,
  type SessionAction,
  type SessionState,
  type StatusOrigin
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

describe('reduceSession — reset', () => {
  it('reset from a populated, connected state returns to initialSessionState (AC4)', () => {
    const populated = reduceSession(
      reduceSession(initialSessionState, { type: 'connected', ack }),
      { type: 'messageSent', message: msg('m1', 'user') }
    )
    // Precondition: a genuinely non-empty, non-disconnected state — otherwise reset proves nothing.
    expect(populated.messages.length).toBeGreaterThan(0)
    expect(populated.status.type).not.toBe('disconnected')

    const next = reduceSession(populated, { type: 'reset' })

    // Both facets clear in one step: `disconnected` deliberately preserves messages, so reset is a
    // distinct mutation path. Returning the shared const makes a second reset a no-op reference.
    expect(next.status).toEqual({ type: 'disconnected' })
    expect(next.messages).toHaveLength(0)
    expect(next).toBe(initialSessionState)
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
    const start: SessionState = {
      status: { type: 'disconnected' },
      statuses: new Map(),
      messages: [msg('m1')]
    }
    const startMessages = start.messages
    const next = reduceSession(start, { type: 'messageReceived', message: msg('m2') })

    expect(next.messages).not.toBe(start.messages)
    expect(start.messages).toBe(startMessages)
    expect(start.messages.map((m) => m.message_id)).toEqual(['m1'])
    expect(next.messages.map((m) => m.message_id)).toEqual(['m1', 'm2'])
  })
})

// Two paired servers, the world this store now has to describe (#1117 dials one connection each).
const A = 'srv-a'
const B = 'srv-b'

/** Read one server's slot the way a consumer will: through the factory selector. */
function statusFor(state: SessionState, origin: StatusOrigin) {
  return selectStatusFor(origin)(state)
}

describe('reduceSession — the per-server status index', () => {
  it('keeps two servers independent across every status action (AC1)', () => {
    const s1 = reduceSession(initialSessionState, { type: 'connecting', serverId: A })
    const s2 = reduceSession(s1, { type: 'connected', ack, serverId: B })
    expect(statusFor(s2, A)).toEqual({ type: 'connecting' })
    expect(statusFor(s2, B)).toEqual({ type: 'connected', ack })

    // Untouched BY REFERENCE, not merely equal: that is what keeps a component watching B from
    // re-rendering when A moves, and it is the property the single cell could not offer.
    const s3 = reduceSession(s2, { type: 'failed', error: connError, serverId: A })
    expect(statusFor(s3, B)).toBe(statusFor(s2, B))
    expect(statusFor(s3, A)).toEqual({ type: 'error', error: connError })

    const s4 = reduceSession(s3, { type: 'disconnected', serverId: B })
    expect(statusFor(s4, A)).toBe(statusFor(s3, A))
    expect(statusFor(s4, B)).toEqual({ type: 'disconnected' })
  })

  it('holds a healthy server steady while another server churns (AC1)', () => {
    // The defect this replaces: A connects and then never changes again — on a healthy connection
    // the next status change is never — so under the single cell A's leg read whatever B last said.
    const connected = reduceSession(initialSessionState, { type: 'connected', ack, serverId: A })
    const churn: SessionAction[] = [
      { type: 'connecting', serverId: B },
      { type: 'failed', error: connError, serverId: B },
      { type: 'disconnected', serverId: B }
    ]
    const final = churn.reduce((s, action) => reduceSession(s, action), connected)
    expect(statusFor(final, A)).toBe(connected.status)
  })

  it('tells a server that has reported nothing from one that has (AC2)', () => {
    const seen = reduceSession(initialSessionState, { type: 'disconnected', serverId: A })
    // Known-disconnected and never-heard-from are different answers, not the same one.
    expect(statusFor(seen, A)).toEqual({ type: 'disconnected' })
    expect(statusFor(seen, B)).toBeUndefined()
  })

  it('keeps a present-null origin and an absent origin in separate slots', () => {
    // The registry's not-paired stand-in dials with `serverId: null` and its failure genuinely
    // lands here; an action with no origin at all is a third case, not a synonym for that one.
    const s1 = reduceSession(initialSessionState, { type: 'connecting', serverId: null })
    const s2 = reduceSession(s1, { type: 'disconnected' })
    expect(statusFor(s2, null)).toEqual({ type: 'connecting' })
    expect(statusFor(s2, undefined)).toEqual({ type: 'disconnected' })
    expect(statusFor(s2, A)).toBeUndefined()
  })

  it('leaves the app-wide status the most recently written value (AC3)', () => {
    const s1 = reduceSession(initialSessionState, { type: 'connected', ack, serverId: A })
    expect(selectStatus(s1)).toEqual({ type: 'connected', ack })
    const s2 = reduceSession(s1, { type: 'failed', error: connError, serverId: B })
    expect(selectStatus(s2)).toEqual({ type: 'error', error: connError })
    // One object in both places, so no consumer can catch the cell and its slot disagreeing.
    expect(selectStatus(s2)).toBe(statusFor(s2, B))
  })

  it('does not mutate the input state’s index on a status write (purity)', () => {
    const s1 = reduceSession(initialSessionState, { type: 'connecting', serverId: A })
    const before = s1.statuses
    const s2 = reduceSession(s1, { type: 'connecting', serverId: B })
    expect(s2.statuses).not.toBe(before)
    expect(before.has(B)).toBe(false)
    expect(s1.statuses).toBe(before)
  })

  it('leaves the index untouched by reference on a message action (orthogonality)', () => {
    const s1 = reduceSession(initialSessionState, { type: 'connecting', serverId: A })
    const s2 = reduceSession(s1, { type: 'messageReceived', message: msg('m1') })
    expect(s2.statuses).toBe(s1.statuses)
  })

  it('reset empties the index and still returns initialSessionState by reference', () => {
    const populated = reduceSession(initialSessionState, { type: 'connected', ack, serverId: A })
    expect(populated.statuses.size).toBe(1)
    const next = reduceSession(populated, { type: 'reset' })
    expect(next.statuses.size).toBe(0)
    expect(next).toBe(initialSessionState)
  })
})

describe('selectors', () => {
  it('selectStatus returns the current status slice', () => {
    const connecting = reduceSession(initialSessionState, { type: 'connecting' })
    expect(selectStatus(connecting)).toBe(connecting.status)
  })

  it('selectStatusFor returns the slot for a known origin and undefined for an unknown one', () => {
    const s = reduceSession(initialSessionState, { type: 'connecting', serverId: A })
    expect(selectStatusFor(A)(s)).toBe(s.status)
    expect(selectStatusFor(B)(s)).toBeUndefined()
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
