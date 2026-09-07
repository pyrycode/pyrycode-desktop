import { describe, it, expect } from 'vitest'
import {
  createSystemPromptWriteStore,
  selectSystemPromptWriteFor,
  type SystemPromptWriteState
} from './systemPromptWriteStore'
import type { SystemPromptWriteFailure } from '@shared/ipc/events'

// Plain-function store tests over isolated createSystemPromptWriteStore() instances — the
// runSettingsWriteStore.test idiom. No React, no bridge: the store is pure renderer state driven by a
// sealed event union through one `dispatch`. Correlation here is by CONVERSATION ID, not by a
// renderer-minted change id, which is this store's one departure from that analogue.

const A = 'conv-a'
const B = 'conv-b'

const read = (s: SystemPromptWriteState, id: string) => selectSystemPromptWriteFor(id)(s)

describe('systemPromptWriteStore reducer', () => {
  it('starts with no write known for any conversation', () => {
    const store = createSystemPromptWriteStore()
    expect(store.getState().writes.size).toBe(0)
    expect(read(store.getState(), A)).toBeNull()
  })

  it('writeSubmitted reports that conversation in flight and no other (AC1)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    expect(read(store.getState(), A)).toEqual({ status: 'in-flight' })
    expect(read(store.getState(), B)).toBeNull()
  })

  it('holds no submitted text, so a value / an empty value / a clear are one state here (AC3)', () => {
    // The tri-state's proof lives in the bridge spec, where the outbound payload is observable. What
    // this store must show is that nothing about the text survives the submit: the event has no field
    // to carry it and the held marker has no key for it.
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    expect(Object.keys(read(store.getState(), A) ?? {})).toEqual(['status'])
  })

  it('keeps in flight until an outcome arrives (AC1)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: B })
    store.getState().dispatch({ type: 'writeRejected', conversationId: B, reason: 'unclassified' })
    expect(read(store.getState(), A)).toEqual({ status: 'in-flight' })
  })

  it('writeConfirmed settles the write it names and no other (AC2)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: B })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: A })
    expect(read(store.getState(), A)).toEqual({ status: 'confirmed' })
    expect(read(store.getState(), B)).toEqual({ status: 'in-flight' })
  })

  const reasons: SystemPromptWriteFailure[] = [
    'prompt-too-long',
    'protocol-malformed',
    'conversation-not-found',
    'unclassified'
  ]
  for (const reason of reasons) {
    it(`writeRejected replaces the in-flight state with '${reason}' (AC2)`, () => {
      const store = createSystemPromptWriteStore()
      store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
      store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason })
      expect(read(store.getState(), A)).toEqual({ status: 'rejected', reason })
    })
  }

  it('an outcome naming a conversation with nothing in flight changes nothing (AC2)', () => {
    const store = createSystemPromptWriteStore()
    const before = store.getState()
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: A })
    expect(store.getState().writes).toBe(before.writes)
    store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason: 'unclassified' })
    expect(store.getState().writes).toBe(before.writes)
    expect(read(store.getState(), A)).toBeNull()
  })

  it('a replayed outcome cannot re-settle a write already settled (AC2)', () => {
    // Both main-side arms consume the SAME correlation entry, so a second outcome for one write is
    // either a relay duplicate or a confused daemon. An ungated arm would flip a confirmed write to
    // rejected — a lie about a value the daemon stored.
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: A })
    const settled = store.getState()
    store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason: 'unclassified' })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: A })
    expect(store.getState().writes).toBe(settled.writes)
    expect(read(store.getState(), A)).toEqual({ status: 'confirmed' })
  })

  it('a standing refusal survives until the next write for that conversation (AC2)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason: 'prompt-too-long' })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: B })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: B })
    expect(read(store.getState(), A)).toEqual({ status: 'rejected', reason: 'prompt-too-long' })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    expect(read(store.getState(), A)).toEqual({ status: 'in-flight' })
  })

  it('reconnected drops in-flight markers and preserves settled ones (AC4)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason: 'protocol-malformed' })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: B })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: B })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: 'conv-c' })
    store.getState().dispatch({ type: 'reconnected' })
    expect(read(store.getState(), 'conv-c')).toBeNull()
    expect(read(store.getState(), A)).toEqual({ status: 'rejected', reason: 'protocol-malformed' })
    expect(read(store.getState(), B)).toEqual({ status: 'confirmed' })
  })

  it('reconnected with nothing in flight returns the SAME state object (AC4)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeConfirmed', conversationId: A })
    const before = store.getState()
    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState().writes).toBe(before.writes)
  })

  it('conversationSwitched drops everything, settled markers included (AC4)', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    store.getState().dispatch({ type: 'writeRejected', conversationId: A, reason: 'conversation-not-found' })
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: B })
    store.getState().dispatch({ type: 'conversationSwitched' })
    expect(store.getState().writes.size).toBe(0)
    expect(read(store.getState(), A)).toBeNull()
    expect(read(store.getState(), B)).toBeNull()
  })

  it('conversationSwitched on an empty store returns the SAME state object', () => {
    const store = createSystemPromptWriteStore()
    const before = store.getState()
    store.getState().dispatch({ type: 'conversationSwitched' })
    expect(store.getState().writes).toBe(before.writes)
  })
})

describe('selectSystemPromptWriteFor', () => {
  it('returns null for an unknown conversation and the held marker by reference for a known one', () => {
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: A })
    expect(read(store.getState(), B)).toBeNull()
    // Reference-stable across reads, so a narrow-slice subscriber does not wake on an unrelated
    // dispatch.
    expect(read(store.getState(), A)).toBe(read(store.getState(), A))
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: B })
    expect(read(store.getState(), A)).toBe(store.getState().writes.get(A))
  })

  it('holds a conversation id in a Map, never a plain-object index', () => {
    // The event arm's own security docblock prescribes a Map for any index on this field. A Map has
    // no prototype chain, so these are ordinary keys reaching nothing.
    const store = createSystemPromptWriteStore()
    store.getState().dispatch({ type: 'writeSubmitted', conversationId: '__proto__' })
    expect(store.getState().writes).toBeInstanceOf(Map)
    expect(read(store.getState(), '__proto__')).toEqual({ status: 'in-flight' })
    expect(read(store.getState(), 'constructor')).toBeNull()
  })
})
