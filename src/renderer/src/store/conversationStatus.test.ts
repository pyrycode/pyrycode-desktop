import { describe, it, expect } from 'vitest'
import { resolveConversationStatus } from './conversationStatus'
import type { ConversationActivityEntry } from './conversationActivityStore'

// The join between the facts the sidebar row holds (#799, split from #676; the input-required fact added by
// #873). Every scenario calls the resolver DIRECTLY with literal inputs — no store, no port, no singleton in
// scope, which is only possible because the module under test has zero runtime imports (its one import is
// `import type`). `environment: 'node'` is already global at vitest.config.ts, so this file adds no
// environment pragma.
//
// Four properties here are invisible to `tsc` and break no other assertion, which is why each has a named
// test of its own:
//
//   - THE PRECEDENCE ORDER, AT TWO LEVELS. Testing `unread` before the activity facts compiles clean and
//     passes every other test in this file; only the working-AND-unread test catches it. Likewise checking
//     `isWorking` before `inputRequired` compiles clean and fails only the input-required-AND-working test.
//   - A DROPPED CLAUSE in the four-way disjunction. Typechecks clean, and each of the four single-fact
//     tests is the only assertion in the file that catches its own clause.
//   - AN `&&` FOR A `||`. Fails at least two single-fact tests and nothing else.
//   - A TRANSPOSED `inputRequired`/`unread` ARGUMENT. Both parameters are `boolean`, so `tsc` cannot see a
//     swap at any call site; the literal `false` passed at EVERY call below is what keeps the argument this
//     ticket adds visible to these tests. Never introduce a wrapper that defaults it.
//
// One property NO test here can defend: annotating the return as `string` instead of `ConversationStatus`
// typechecks and passes everything. #800's dot-component prop type is what defends it.

/** Spread over an all-false base so a fifth fact added to `ConversationActivityEntry` later breaks in ONE
 *  place rather than in every test. Never `Object.values`-style construction — each fact is named. */
function activity(facts: Partial<ConversationActivityEntry> = {}): ConversationActivityEntry {
  return { turnRunning: false, stalled: false, apiRetrying: false, compacting: false, ...facts }
}

describe('resolveConversationStatus', () => {
  it('reads working when turnRunning alone is true (AC3)', () => {
    // One of four separate single-fact tests: a dropped `turnRunning` clause fails exactly this one.
    expect(resolveConversationStatus(false, activity({ turnRunning: true }), false)).toBe('working')
  })

  it('reads working when stalled alone is true (AC3)', () => {
    // A stalled turn is the assistant mid-work, not idle — reading it as idle is a false negative on the
    // one state the operator most wants to see.
    expect(resolveConversationStatus(false, activity({ stalled: true }), false)).toBe('working')
  })

  it('reads working when apiRetrying alone is true (AC3)', () => {
    expect(resolveConversationStatus(false, activity({ apiRetrying: true }), false)).toBe('working')
  })

  it('reads working when compacting alone is true (AC3)', () => {
    expect(resolveConversationStatus(false, activity({ compacting: true }), false)).toBe('working')
  })

  it('reads working when all four facts are true (AC3)', () => {
    // Pins that the four-way predicate is a disjunction read forwards, not an `&&` chain.
    expect(
      resolveConversationStatus(
        false,
        activity({ turnRunning: true, stalled: true, apiRetrying: true, compacting: true }),
        false
      )
    ).toBe('working')
  })

  it('reads idle when no frame has ever arrived for the conversation (AC3, the absent key)', () => {
    // `selectActivityFor` hands back `null` for an absent key. That is an ORDINARY input here, not an
    // error: the resolver must accept it without assuming an entry exists.
    expect(resolveConversationStatus(false, null, false)).toBe('idle')
  })

  it('reads idle for a present all-false entry — observed, nothing happening (AC3)', () => {
    // The other half of the pair AC3 asks for by name. The activity store keeps this reading distinct
    // from the absent key upstream on purpose; for THIS resolver the two agree, and both are not-working.
    expect(resolveConversationStatus(false, activity(), false)).toBe('idle')
  })

  it('reads working when the conversation is both working and unread (AC2)', () => {
    // THE PRECEDENCE TEST for levels 1 and 2. An implementation that checks `unread` first compiles clean,
    // passes every other test in this file, and fails only here. It additionally pins that an
    // `inputRequired: false` does not hijack a conversation that is genuinely working.
    expect(resolveConversationStatus(false, activity({ turnRunning: true }), true)).toBe('working')
  })

  it('reads new-messages when unread with no frame ever seen (AC2)', () => {
    expect(resolveConversationStatus(false, null, true)).toBe('new-messages')
  })

  it('reads new-messages when unread with a present all-false entry (AC2)', () => {
    // Pins that the new-messages branch does not require an activity entry to exist — or to be absent.
    expect(resolveConversationStatus(false, activity(), true)).toBe('new-messages')
  })

  it('reads input-required from the fact alone, with nothing else true (#873 AC2)', () => {
    // The floor of the new level: no activity entry, not unread. Fails if the branch is missing entirely.
    expect(resolveConversationStatus(true, null, false)).toBe('input-required')
  })

  it('reads input-required when the conversation is ALSO working (#873 AC2, precedence 0)', () => {
    // THE PRECEDENCE-0 TEST. An implementation that checks `isWorking` first compiles clean, passes every
    // other test in this file, and fails only here and in the all-facts case below. Input required is the
    // one state blocked on the operator, so it must never hide behind a busier-looking one.
    expect(resolveConversationStatus(true, activity({ turnRunning: true }), false)).toBe(
      'input-required'
    )
  })

  it('reads input-required when the conversation is ALSO unread (#873 AC2)', () => {
    // Outranks new messages with no activity entry in play, so this level is pinned against BOTH of the
    // statuses below it and not only against the nearest one.
    expect(resolveConversationStatus(true, null, true)).toBe('input-required')
  })

  it('reads input-required with all four activity facts true AND unread (#873 AC2, full strength)', () => {
    // AC2's "including when that conversation is also working, also unread, or both" at its loudest: every
    // other input says a lower status.
    expect(
      resolveConversationStatus(
        true,
        activity({ turnRunning: true, stalled: true, apiRetrying: true, compacting: true }),
        true
      )
    ).toBe('input-required')
  })
})
