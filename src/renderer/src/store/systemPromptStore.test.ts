import { describe, it, expect } from 'vitest'
import {
  createSystemPromptStore,
  initialSystemPromptState,
  selectSystemPromptReading,
  type SystemPromptReading
} from './systemPromptStore'

// Plain-function store tests over isolated createSystemPromptStore() instances — the runConfigStore.test
// idiom. No React, no bridge: the store is pure renderer state with two independent whole-value
// mutations.
//
// The tri-state is the subject of most of these cases, so `systemPrompt` is never incidental here the
// way runConfigStore.test's usage figures are: absent, empty and text are three DIFFERENT held values
// and each has its own case. `sessionPromptStatus` is varied independently of it on purpose — the two
// fields are not derived from one another, so the pairs a real daemon would rarely send are exactly the
// ones worth asserting.

const reading = (
  systemPrompt: string | undefined,
  sessionPromptStatus: SystemPromptReading['sessionPromptStatus']
): SystemPromptReading => ({ systemPrompt, sessionPromptStatus })

describe('systemPromptStore', () => {
  it('starts with a null reading — nothing has arrived yet (AC2)', () => {
    const store = createSystemPromptStore()
    expect(store.getState().reading).toBeNull()
    expect(selectSystemPromptReading(store.getState())).toBeNull()
  })

  it('setReading records the reading; selectSystemPromptReading returns it (AC2)', () => {
    const store = createSystemPromptStore()
    const held = reading('You are a helpful assistant.', 'matches')
    store.getState().setReading(held)
    expect(selectSystemPromptReading(store.getState())).toEqual(held)
  })

  // The tri-state, one case each. `toEqual` ignores an undefined property and fails on a defined one,
  // so the absent case asserts the KEY's presence explicitly rather than leaning on the matcher.
  it('holds an absent prompt as undefined — no prompt is stored (AC2)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading(undefined, 'no_session'))
    const held = selectSystemPromptReading(store.getState())
    expect(held?.systemPrompt).toBeUndefined()
    expect(held !== null && 'systemPrompt' in held).toBe(true)
  })

  it('holds an explicitly empty prompt as "" — NOT collapsed into absent (AC2)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading('', 'matches'))
    const held = selectSystemPromptReading(store.getState())
    expect(held?.systemPrompt).toBe('')
    expect(held?.systemPrompt).not.toBeUndefined()
  })

  it('holds prompt text verbatim — never trimmed, normalised or bounded (AC2)', () => {
    const store = createSystemPromptStore()
    // Leading/trailing whitespace and a newline: operator-authored text is held as written. A store
    // that trimmed would silently change a value #1078 writes back through set_system_prompt.
    const text = '  Be terse.\nAnswer in one line.  '
    store.getState().setReading(reading(text, 'differs'))
    expect(selectSystemPromptReading(store.getState())?.systemPrompt).toBe(text)
  })

  // The two fields are independent and neither is derived from the other, so the pairs asserted here
  // are deliberately the ones that would look contradictory to a reader who thought one implied the
  // other: text beside `no_session` is the ordinary "configured, applies at the next session start"
  // reading, and an absent prompt beside `matches` is a conversation holding nothing whose session
  // spawned with nothing.
  it.each([
    ['matches' as const, undefined],
    ['differs' as const, 'Be terse.'],
    ['no_session' as const, 'Be terse.'],
    ['no_session' as const, ''],
    ['matches' as const, '']
  ])('holds sessionPromptStatus %s verbatim beside prompt %j (AC2)', (status, prompt) => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading(prompt, status))
    const held = selectSystemPromptReading(store.getState())
    expect(held?.sessionPromptStatus).toBe(status)
    expect(held?.systemPrompt).toBe(prompt)
  })

  it('setReading replaces the WHOLE reading — most recent wins, no merge (AC2)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading('First prompt.', 'differs'))
    store.getState().setReading(reading(undefined, 'no_session'))
    const held = selectSystemPromptReading(store.getState())
    // A merge would have left the first prompt standing under the second status.
    expect(held).toEqual({ systemPrompt: undefined, sessionPromptStatus: 'no_session' })
    expect(held?.systemPrompt).toBeUndefined()
  })

  it('holds the reading BY REFERENCE — no per-field mapping on the way in', () => {
    const store = createSystemPromptStore()
    const held = reading('Be terse.', 'matches')
    store.getState().setReading(held)
    expect(selectSystemPromptReading(store.getState())).toBe(held)
  })

  it('clearReading returns to the DISTINCT not-loaded state, never a zero-valued reading (AC3)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading('Be terse.', 'differs'))
    store.getState().clearReading()
    // Null, not `{ systemPrompt: '', sessionPromptStatus: 'no_session' }` — `''` and `no_session` are
    // real daemon readings, so a cleared store that produced them could not be told from a chat that
    // genuinely holds an empty prompt with no live session.
    expect(selectSystemPromptReading(store.getState())).toBeNull()
  })

  it('clearReading returns initialSystemPromptState by reference (idempotence)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading('Be terse.', 'matches'))
    store.getState().clearReading()
    const first = store.getState()
    store.getState().clearReading()
    // Same state object across two clears from different starting states, so a whole-state selector is
    // Object.is-true and no subscriber wakes on a redundant clear.
    expect(store.getState().reading).toBe(initialSystemPromptState.reading)
    expect(store.getState().reading).toBe(first.reading)
  })

  it('clearing an already-clear store is a no-op (AC3)', () => {
    const store = createSystemPromptStore()
    store.getState().clearReading()
    expect(selectSystemPromptReading(store.getState())).toBeNull()
  })

  it('a cleared store is not latched — the next reading lands normally (AC3)', () => {
    const store = createSystemPromptStore()
    store.getState().setReading(reading('First chat.', 'matches'))
    store.getState().clearReading()
    const next = reading('Second chat.', 'differs')
    store.getState().setReading(next)
    expect(selectSystemPromptReading(store.getState())).toEqual(next)
  })

  it('seeds from an injected initial state (DI factory)', () => {
    const held = reading('Seeded.', 'no_session')
    const store = createSystemPromptStore({ reading: held })
    expect(selectSystemPromptReading(store.getState())).toBe(held)
  })
})
