import { describe, it, expect } from 'vitest'
import { resolveConversationStatus } from './conversationStatus'
import type { ConversationActivityEntry } from './conversationActivityStore'

// The join between the two facts the sidebar row holds (#799, split from #676). Every scenario calls the
// resolver DIRECTLY with literal inputs — no store, no port, no singleton in scope, which is only possible
// because the module under test has zero runtime imports (its one import is `import type`).
// `environment: 'node'` is already global at vitest.config.ts, so this file adds no environment pragma.
//
// Three properties here are invisible to `tsc` and break no other assertion, which is why each has a named
// test of its own:
//
//   - THE PRECEDENCE ORDER. Testing `unread` before the activity facts compiles clean and passes every
//     other test in this file; only the working-AND-unread test catches it.
//   - A DROPPED CLAUSE in the four-way disjunction. Typechecks clean, and each of the four single-fact
//     tests is the only assertion in the file that catches its own clause.
//   - AN `&&` FOR A `||`. Fails at least two single-fact tests and nothing else.
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
    expect(resolveConversationStatus(activity({ turnRunning: true }), false)).toBe('working')
  })

  it('reads working when stalled alone is true (AC3)', () => {
    // A stalled turn is the assistant mid-work, not idle — reading it as idle is a false negative on the
    // one state the operator most wants to see.
    expect(resolveConversationStatus(activity({ stalled: true }), false)).toBe('working')
  })

  it('reads working when apiRetrying alone is true (AC3)', () => {
    expect(resolveConversationStatus(activity({ apiRetrying: true }), false)).toBe('working')
  })

  it('reads working when compacting alone is true (AC3)', () => {
    expect(resolveConversationStatus(activity({ compacting: true }), false)).toBe('working')
  })

  it('reads working when all four facts are true (AC3)', () => {
    // Pins that the four-way predicate is a disjunction read forwards, not an `&&` chain.
    expect(
      resolveConversationStatus(
        activity({ turnRunning: true, stalled: true, apiRetrying: true, compacting: true }),
        false
      )
    ).toBe('working')
  })

  it('reads idle when no frame has ever arrived for the conversation (AC3, the absent key)', () => {
    // `selectActivityFor` hands back `null` for an absent key. That is an ORDINARY input here, not an
    // error: the resolver must accept it without assuming an entry exists.
    expect(resolveConversationStatus(null, false)).toBe('idle')
  })

  it('reads idle for a present all-false entry — observed, nothing happening (AC3)', () => {
    // The other half of the pair AC3 asks for by name. The activity store keeps this reading distinct
    // from the absent key upstream on purpose; for THIS resolver the two agree, and both are not-working.
    expect(resolveConversationStatus(activity(), false)).toBe('idle')
  })

  it('reads working when the conversation is both working and unread (AC2)', () => {
    // THE PRECEDENCE TEST. An implementation that checks `unread` first compiles clean, passes every
    // other test in this file, and fails only here.
    expect(resolveConversationStatus(activity({ turnRunning: true }), true)).toBe('working')
  })

  it('reads new-messages when unread with no frame ever seen (AC2)', () => {
    expect(resolveConversationStatus(null, true)).toBe('new-messages')
  })

  it('reads new-messages when unread with a present all-false entry (AC2)', () => {
    // Pins that the new-messages branch does not require an activity entry to exist — or to be absent.
    expect(resolveConversationStatus(activity(), true)).toBe('new-messages')
  })
})
