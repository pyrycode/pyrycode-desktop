import { describe, it, expect } from 'vitest'
import {
  reduceModal,
  initialModalState,
  selectHasOutstandingFor,
  selectOutstanding,
  selectRejections,
  type ModalEvent,
  type ModalPrompt,
  type ModalState
} from './modalPrompts'

// Fixture builders — plain renderer-local events, no transport/wire involved. Mirror
// threadTimeline.test.ts's `toolUse(...)` idiom: sensible defaults, override only what a case asserts.
function shown(
  modalId: string,
  overrides: Partial<Omit<Extract<ModalEvent, { type: 'shown' }>, 'type' | 'modalId'>> = {}
): ModalEvent {
  return {
    type: 'shown',
    // Derived from, but never equal to, the modal id: both are `string`, so only distinct values can
    // catch a transposition. Supplied before the spread, which is what keeps `overrides` optional.
    conversationId: `conv-${modalId}`,
    modalId,
    class: 'permission',
    title: `Title ${modalId}`,
    prompt: `Allow ${modalId}?`,
    options: [
      { id: 'allow', label: 'Allow' },
      { id: 'deny', label: 'Deny' }
    ],
    defaultOptionId: 'deny',
    ...overrides
  }
}

function dismissed(
  modalId: string,
  outcome = 'deny',
  source: 'remote' | 'local' | 'timeout' = 'remote'
): ModalEvent {
  return { type: 'dismissed', modalId, outcome, source }
}

// #249: a round-tripped rejection (from the bridge) and its local dismissal. Both carry only `modalId`
// — the event is content-free (no daemon error text ever reaches the renderer, AC3).
function rejected(modalId: string): ModalEvent {
  return { type: 'rejected', modalId }
}

function rejectionDismissed(modalId: string): ModalEvent {
  return { type: 'rejectionDismissed', modalId }
}

// #415: the transport (re)handshake, scoped by #1140 to the reconnecting server. The caller resolves
// which conversations belong to that server (#1138's `selectConversationIdsFor`) and the event carries
// them, so every site states what it means to clear. No argument = the empty set = clear nothing, which
// is what a first connect resolves to.
function reconnected(...conversationIds: readonly string[]): ModalEvent {
  return { type: 'reconnected', conversationIds: new Set(conversationIds) }
}

// #1140: the pairing-boundary drop, dispatched locally by `clearPairingScopedState` — never by the
// bridge. Payload-free and unscoped: every slice belongs to the pairing that ended.
function reset(): ModalEvent {
  return { type: 'reset' }
}

/** Fold a sequence of events over the initial state — the reducer's natural exercise shape. */
function run(events: readonly ModalEvent[]): ModalState {
  return events.reduce(reduceModal, initialModalState)
}

it('keeps rejection ownership after optimistic removal and reconnect until Dismiss or reset', () => {
  const state = run([shown('m1'), dismissed('m1', 'deny', 'local'), rejected('m1')])
  expect(state.rejectionOwners).toEqual([{ modalId: 'm1', conversationId: 'conv-m1' }])
  const rejoined = reduceModal(state, reconnected('conv-m1'))
  expect(rejoined.resolved).toEqual([])
  expect(rejoined.rejectionOwners).toBe(state.rejectionOwners)
  expect(reduceModal(rejoined, rejectionDismissed('m1')).rejectionOwners).toEqual([])
  expect(reduceModal(rejoined, reset()).rejectionOwners).toEqual([])
})

it('copies outstanding rejection ownership without attributing unknown IDs to a chat', () => {
  const state = run([shown('m1'), rejected('m1'), rejected('unknown')])
  expect(state.rejectionOwners).toEqual([{ modalId: 'm1', conversationId: 'conv-m1' }])
  expect(reduceModal(state, rejected('m1'))).toBe(state)
})

describe('reduceModal — install', () => {
  it('preserves an explicitly false focus hint as an own property', () => {
    const state = reduceModal(initialModalState, shown('context', { defaultToNo: false }))
    expect(state.outstanding[0]).toHaveProperty('defaultToNo', false)
  })

  it('retains only a continuous, identical ordered offer, including batched removal/restoration', () => {
    const offer = { offered: true, rules: ['Read', 'Bash(touch:*)'] }
    const first = reduceModal(initialModalState, shown('offer', { alwaysAllow: offer }))
    const same = reduceModal(first, shown('offer', { alwaysAllow: { ...offer, rules: [...offer.rules] } }))
    expect(same.outstanding[0].alwaysAllow).toBe(first.outstanding[0].alwaysAllow)
    for (const replacement of [{}, { alwaysAllow: { offered: false, rules: [] } },
      { alwaysAllow: { offered: true, rules: [...offer.rules].reverse() } },
      { alwaysAllow: { offered: true, rules: ['Changed'] } }, { class: 'trust' as const, alwaysAllow: offer }]) {
      const changed = reduceModal(same, shown('offer', replacement))
      const restored = reduceModal(changed, shown('offer', { alwaysAllow: { ...offer } }))
      expect(restored.outstanding[0].alwaysAllow).not.toBe(first.outstanding[0].alwaysAllow)
    }
    expect(reduceModal(first, shown('offer')).outstanding[0]).not.toHaveProperty('alwaysAllow')
  })

  it.each(['plain reason', { checks: [false, 0, null] }, null, false, 0])('holds context and drops it on replacement: %j', (reason) => {
    const context = { reason, reasonType: 'rule', blockedPath: '/workspace/file',
      description: 'Additional context', defaultToNo: true }
    const state = reduceModal(initialModalState, shown('context', context))
    expect(state.outstanding[0]).toMatchObject(context)
    const replaced = reduceModal(state, shown('context'))
    expect(replaced.outstanding).toHaveLength(1)
    for (const key of Object.keys(context)) expect(replaced.outstanding[0]).not.toHaveProperty(key)
  })

  it('holds a single shown prompt addressed by modalId, carrying its fields verbatim', () => {
    const state = run([shown('m1')])
    expect(state.outstanding).toHaveLength(1)
    const prompt: ModalPrompt = {
      conversationId: 'conv-m1',
      modalId: 'm1',
      class: 'permission',
      title: 'Title m1',
      prompt: 'Allow m1?',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      defaultOptionId: 'deny'
    }
    expect(state.outstanding[0]).toEqual(prompt)
  })

  it('carries a trust class through unchanged', () => {
    const state = run([shown('m1', { class: 'trust' })])
    expect(state.outstanding[0].class).toBe('trust')
  })
})

describe('reduceModal — the held prompt carries its conversation (#878 AC1)', () => {
  it('COPIES the event conversation id, never derives one from the modal id', () => {
    // The override moves `conversationId` off the fixture's `conv-${modalId}` default, so a production
    // derivation would produce `conv-m1` here and fail. The `modalId` nonce is the sole answer-
    // correlation key (ADR 0009) and must never leak into the scoping value.
    const state = run([shown('m1', { conversationId: 'conv-other' })])
    expect(state.outstanding[0].conversationId).toBe('conv-other')
    expect(state.outstanding[0].modalId).toBe('m1')
  })

  it('a re-delivery carrying a different conversation id replaces in place (position preserved)', () => {
    const state = run([shown('m1'), shown('m2'), shown('m1', { conversationId: 'conv-moved' })])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
    expect(state.outstanding).toHaveLength(2)
    // Match-and-replace takes the RE-DELIVERED conversation, exactly as it takes the re-delivered title.
    expect(state.outstanding[0].conversationId).toBe('conv-moved')
  })
})

describe('reduceModal — multiple outstanding', () => {
  it('holds two distinct-id prompts in arrival (oldest-first) order', () => {
    const state = run([shown('m1'), shown('m2')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
    expect(selectOutstanding(state)).toHaveLength(2)
  })
})

describe('reduceModal — clear by id', () => {
  it('removes exactly the matching prompt, leaving the others', () => {
    const state = run([shown('m1'), shown('m2'), shown('m3'), dismissed('m2')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm3'])
  })
})

describe('reduceModal — re-delivery / reconcile-on-connect (#195)', () => {
  it('a re-delivered shown for an outstanding id updates in place — no duplicate, position preserved (AC2)', () => {
    const state = run([shown('m1'), shown('m2'), shown('m1', { title: 'Updated' })])
    // Still two prompts, in arrival order — the re-send did NOT append a duplicate.
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
    // Match-and-replace takes the RE-DELIVERED fields (the latest), not the stale first ones.
    expect(state.outstanding[0].title).toBe('Updated')
  })

  it('a re-delivered shown after resolution is a same-reference no-op (AC3)', () => {
    // The answer path dispatches `dismissed` locally (#237), so a resolved id covers "already
    // answered OR dismissed" in one place — dismissal is the single choke point.
    const base = run([shown('m1'), dismissed('m1')])
    expect(base.outstanding).toEqual([])
    const after = reduceModal(base, shown('m1'))
    expect(after).toBe(base) // no re-append, no selector churn
    expect(after.outstanding).toEqual([])
  })

  it('answered locally, then daemon-dismissed, then re-shown stays suppressed in one connection (#510 AC2)', () => {
    // The second required ordering, WITHOUT a reconnect: the user's local answer records `resolved`; the
    // daemon's own `dismissed` for the same id hits the never-outstanding early-out (records nothing);
    // the re-delivered `shown` is still suppressed by the within-connection dedupe #510 keeps intact.
    // `'local'` is passed explicitly on the user's answer — the fixture defaults to `'remote'`.
    const base = run([shown('m1'), dismissed('m1', 'allow', 'local'), dismissed('m1')])
    expect(base.outstanding).toEqual([])
    const after = reduceModal(base, shown('m1'))
    expect(after).toBe(base) // same-reference no-op — no re-append, no selector churn
    expect(after.outstanding).toEqual([])
  })

  it('a dismiss for a never-outstanding id does not suppress a later legitimate shown (ordering edge)', () => {
    // The never-outstanding `dismissed('ghost')` must NOT record `ghost` as resolved, or the later
    // real `shown('ghost')` would be wrongly no-op'd (Technical Notes ordering edge).
    const state = run([dismissed('ghost'), shown('ghost')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['ghost'])
  })

  it('does not mutate the input state or its outstanding array on a re-delivery in place', () => {
    const start = run([shown('m1')])
    const startOutstanding = start.outstanding
    const startPrompt = start.outstanding[0]

    const next = reduceModal(start, shown('m1', { title: 'Updated' }))

    // A real change: new outstanding array + a freshly built entry.
    expect(next.outstanding).not.toBe(start.outstanding)
    expect(next.outstanding[0].title).toBe('Updated')
    // Old references intact and unmutated.
    expect(start.outstanding).toBe(startOutstanding)
    expect(start.outstanding[0]).toBe(startPrompt)
    expect(start.outstanding[0].title).toBe('Title m1')
  })
})

describe('reduceModal — unknown-id no-op (AC4)', () => {
  it('returns the same state reference when dismissing against an empty set', () => {
    const after = reduceModal(initialModalState, dismissed('nope'))
    expect(after).toBe(initialModalState)
    expect(() => reduceModal(initialModalState, dismissed('nope'))).not.toThrow()
  })

  it('returns the same state reference when no outstanding id matches', () => {
    const populated = run([shown('m1'), shown('m2')])
    const after = reduceModal(populated, dismissed('nope'))
    expect(after).toBe(populated)
    expect(after.outstanding).toBe(populated.outstanding)
  })
})

describe('reduceModal — options / default preserved', () => {
  it('round-trips options order and defaultOptionId into the held prompt unchanged', () => {
    const options = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
      { id: 'always', label: 'Always' }
    ]
    const state = run([shown('m1', { options, defaultOptionId: 'no' })])
    expect(state.outstanding[0].options).toEqual(options)
    expect(state.outstanding[0].defaultOptionId).toBe('no')
  })
})

describe('reduceModal — dismissed keys only on modalId', () => {
  it('clears identically regardless of outcome/source', () => {
    const base = run([shown('m1')])
    const a = reduceModal(base, dismissed('m1', 'allow', 'remote'))
    const b = reduceModal(base, dismissed('m1', 'timeout-default', 'timeout'))
    expect(a.outstanding).toEqual([])
    expect(b.outstanding).toEqual([])
  })
})

describe('reduceModal — purity', () => {
  it('does not mutate the input state or its outstanding array on shown', () => {
    const start = run([shown('m1')])
    const startOutstanding = start.outstanding
    const startPrompt = start.outstanding[0]

    const next = reduceModal(start, shown('m2'))

    // New references where a change occurred.
    expect(next.outstanding).not.toBe(start.outstanding)
    // Old references intact and unmutated.
    expect(start.outstanding).toBe(startOutstanding)
    expect(start.outstanding).toHaveLength(1)
    expect(start.outstanding[0]).toBe(startPrompt)
  })

  it('does not mutate the surviving prompt when dismissing another', () => {
    const start = run([shown('m1'), shown('m2')])
    const survivor = start.outstanding[0]
    const next = reduceModal(start, dismissed('m2'))

    expect(next.outstanding).not.toBe(start.outstanding)
    expect(start.outstanding).toHaveLength(2)
    expect(next.outstanding[0]).toBe(survivor)
  })

  it('does not mutate the input state or its resolved array on the reconnect reset (#510)', () => {
    const start = run([shown('m1'), dismissed('m1')])
    const startResolved = start.resolved

    const next = reduceModal(start, reconnected('conv-m1'))

    // A real change: a freshly emptied resolved array.
    expect(next.resolved).not.toBe(start.resolved)
    expect(next.resolved).toEqual([])
    // Old references intact and unmutated.
    expect(start.resolved).toBe(startResolved)
    expect(start.resolved).toEqual([{ conversationId: 'conv-m1', modalId: 'm1' }])
  })
})

describe('reduceModal — rejection surface (#249)', () => {
  it('rejected appends the modalId to rejections, leaving outstanding untouched', () => {
    const state = run([shown('m1'), rejected('m2')])
    expect(state.rejections).toEqual(['m2'])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1'])
  })

  it('records a rejection even though the answered prompt is already gone (AC2)', () => {
    // The answer path clears the modal optimistically (#237), so the prompt is gone before the
    // rejection round-trips back. The surface must not depend on `outstanding`.
    const state = run([shown('m1'), dismissed('m1'), rejected('m1')])
    expect(state.outstanding).toEqual([])
    expect(state.rejections).toEqual(['m1'])
  })

  it('stacks multiple rejections in arrival (FIFO) order', () => {
    const state = run([rejected('m1'), rejected('m2')])
    expect(state.rejections).toEqual(['m1', 'm2'])
  })

  it('dedups a repeated rejection and returns the same state reference (no churn)', () => {
    const before = run([rejected('m1')])
    const after = reduceModal(before, rejected('m1'))
    expect(after).toBe(before)
    expect(after.rejections).toEqual(['m1'])
  })

  it('rejectionDismissed removes exactly the matching rejection (AC5)', () => {
    const state = run([rejected('m1'), rejected('m2'), rejectionDismissed('m1')])
    expect(state.rejections).toEqual(['m2'])
  })

  it('rejectionDismissed against an absent id is a same-reference no-op, never throws', () => {
    const before = run([rejected('m1')])
    const after = reduceModal(before, rejectionDismissed('nope'))
    expect(after).toBe(before)
    expect(after.rejections).toBe(before.rejections)
    expect(() => reduceModal(before, rejectionDismissed('nope'))).not.toThrow()
  })
})

describe('reduceModal — the two surfaces are orthogonal', () => {
  it('a shown after a rejected preserves rejections by reference (outstanding grows only)', () => {
    const before = run([rejected('m1')])
    const after = reduceModal(before, shown('m2'))
    expect(after.rejections).toBe(before.rejections)
    expect(after.outstanding.map((p) => p.modalId)).toEqual(['m2'])
  })

  it('a rejected after a shown preserves outstanding by reference (rejections grows only)', () => {
    const before = run([shown('m1')])
    const after = reduceModal(before, rejected('m2'))
    expect(after.outstanding).toBe(before.outstanding)
    expect(after.rejections).toEqual(['m2'])
  })
})

describe('reduceModal — reconnect reconcile (#415)', () => {
  it('clears outstanding on reconnect (resolved-while-away → cleared, AC1/AC2)', () => {
    const state = run([shown('m1'), shown('m2'), reconnected('conv-m1', 'conv-m2')])
    expect(state.outstanding).toEqual([])
  })

  it('clears the resolved slice across the reset (#510 — deliberate reversal of #415 AC3)', () => {
    // #510: `resolved` is per-CONNECTION truth, not permanent. #415 AC3 retained it across the reset
    // believing that prevented a double-show — but the daemon's connect-time reconcile enumerates only
    // STILL-OUTSTANDING modals, so retention guarded nothing and cost the swallowed-answer bug.
    const before = run([shown('m1'), dismissed('m1')])
    expect(before.resolved).toEqual([{ conversationId: 'conv-m1', modalId: 'm1' }])
    const after = reduceModal(before, reconnected('conv-m1'))
    expect(after.resolved).toEqual([])
    expect(after.resolved).not.toBe(before.resolved)
  })

  it('preserves the rejections surface by reference across the reset (AC3)', () => {
    // rejections (#249) has no daemon repopulation path — clearing it would drop a banner with nothing
    // to refill.
    const before = run([shown('m1'), rejected('r1')])
    expect(before.rejections).toEqual(['r1'])
    const after = reduceModal(before, reconnected('conv-m1'))
    expect(after.rejections).toBe(before.rejections)
    expect(after.rejections).toEqual(['r1'])
  })

  it('returns the same state reference when outstanding is already empty — first connect (AC4)', () => {
    // The set names a conversation on purpose: what makes this a no-op is that the store holds
    // nothing, not that the reconnecting server resolved to nothing.
    const after = reduceModal(initialModalState, reconnected('conv-m1'))
    expect(after).toBe(initialModalState)
  })

  it('a reconnect with only resolved to clear returns a new state, outstanding by reference (#510)', () => {
    // #510 shifts #415 AC4's no-churn invariant to "same reference when the reconnect has NOTHING to
    // clear". Here `resolved` is non-empty, so a new state IS returned — but `outstanding` was already
    // empty and keeps its reference: PermissionModal selects it under Object.is, so minting a fresh []
    // would re-render the container for no state change.
    const before = run([shown('m1'), dismissed('m1')])
    expect(before.outstanding).toEqual([])
    const after = reduceModal(before, reconnected('conv-m1'))
    expect(after).not.toBe(before)
    expect(after.outstanding).toBe(before.outstanding)
    expect(after.resolved).toEqual([])
  })

  it('a still-held prompt re-sent after the reset surfaces exactly once (AC2)', () => {
    const state = run([shown('m1'), reconnected('conv-m1'), shown('m1')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1'])
    expect(state.outstanding).toHaveLength(1)
  })

  it('a prompt answered while disconnected RE-SURFACES when re-sent after the reset (#510 AC1)', () => {
    // #510, the bug and the deliberate reversal of #415 AC3: the Allow clicked while the link was down
    // never reached the daemon (`answerModal` early-returns on a null driver), so the daemon re-sends the
    // still-outstanding prompt. The reset cleared `resolved`, so it re-surfaces instead of the user's
    // explicit answer decaying into a deny-on-timeout.
    const state = run([shown('m1'), dismissed('m1', 'allow', 'local'), reconnected('conv-m1'), shown('m1')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1'])
  })

  it('the re-surfaced prompt carries the RE-DELIVERED fields, not the stale ones (#510 AC1)', () => {
    const state = run([
      shown('m1'),
      dismissed('m1', 'allow', 'local'),
      reconnected('conv-m1'),
      shown('m1', { title: 'Re-delivered' })
    ])
    expect(state.outstanding).toHaveLength(1)
    expect(state.outstanding[0].title).toBe('Re-delivered')
  })

  it('the re-surfaced prompt can be answered again, re-recording resolved (#510 AC1)', () => {
    const before = run([shown('m1'), dismissed('m1', 'allow', 'local'), reconnected('conv-m1'), shown('m1')])
    expect(before.outstanding).toHaveLength(1) // precondition: it really did re-surface
    // A live, answerable entry — not a display artefact: the re-answer genuinely REMOVES it (a new state,
    // not a no-op) and re-records `resolved`, which the NEXT reconnect clears again — so the fix
    // self-heals across repeated drops rather than working exactly once.
    const after = reduceModal(before, dismissed('m1', 'allow', 'local'))
    expect(after).not.toBe(before)
    expect(after.outstanding).toEqual([])
    expect(after.resolved).toEqual([{ conversationId: 'conv-m1', modalId: 'm1' }])
  })

  it('re-surfaces the answered prompt alongside a sibling still held, exactly once each (#510 AC1)', () => {
    const state = run([
      shown('m1'),
      shown('m2'),
      dismissed('m1', 'allow', 'local'),
      reconnected('conv-m1', 'conv-m2'),
      shown('m1'),
      shown('m2')
    ])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
  })
})

describe('reduceModal — the reconnect clear is scoped to one server (#1140)', () => {
  // Two servers, one conversation each. `shown`'s fixture derives `conv-<modalId>`, so these override
  // the conversation explicitly: the point of every case here is that the prompt's conversation, not its
  // modal id, decides whether a clear reaches it.
  const promptOnA = shown('m-a', { conversationId: 'conv-a' })
  const promptOnB = shown('m-b', { conversationId: 'conv-b' })

  it("a reconnect on B leaves A's prompt outstanding and clears B's (AC1)", () => {
    const before = run([promptOnA, promptOnB])
    const after = reduceModal(before, reconnected('conv-b'))
    expect(after.outstanding.map((p) => p.modalId)).toEqual(['m-a'])
  })

  it("B's reconnect keeps A's suppression while B's prompt re-surfaces (AC2)", () => {
    // The half that would ship green if only `outstanding` were scoped: A answered its prompt
    // (optimistically, #237) and B answered its own, so both ids are suppressed. B reconnects.
    const before = run([
      promptOnA,
      promptOnB,
      dismissed('m-a', 'allow', 'local'),
      dismissed('m-b', 'allow', 'local')
    ])
    const after = reduceModal(before, reconnected('conv-b'))
    // A's connection never dropped, so a duplicate delivery there must STILL be suppressed — clearing
    // `resolved` wholesale would re-surface a prompt the operator already answered (#195's bug).
    expect(reduceModal(after, promptOnA)).toBe(after)
    // B genuinely reconnected, so its daemon's re-send is unanswered work and must re-surface (#510).
    expect(reduceModal(after, promptOnB).outstanding.map((p) => p.modalId)).toEqual(['m-b'])
  })

  it('a reconnect resolving no conversations clears nothing and returns the SAME state object (AC3)', () => {
    // What a first connect resolves to: the server's slot holds no list yet, so
    // `selectConversationIdsFor` answers `EMPTY_CONVERSATION_IDS`. Same object ⇒ zustand's
    // `Object.is(next, state)` fires and no selector re-renders (#415's AC4).
    const before = run([promptOnA, promptOnB, dismissed('m-a', 'allow', 'local')])
    const after = reduceModal(before, reconnected())
    expect(after).toBe(before)
  })

  it('leaves a prompt whose conversation is in NO list alone, and its suppression with it (AC3)', () => {
    // The accepted consequence of scoping by the conversation list, pinned so a later widening is a
    // deliberate change rather than drift: a prompt can be raised for a conversation whose
    // `list_conversations` reply has not landed. Nothing but the pairing clear ever collects it.
    const orphan = shown('m-x', { conversationId: 'conv-unlisted' })
    const before = run([orphan, shown('m-y', { conversationId: 'conv-unlisted' }), dismissed('m-y')])
    const after = reduceModal(before, reconnected('conv-a', 'conv-b'))
    expect(after).toBe(before)
    expect(after.outstanding.map((p) => p.modalId)).toEqual(['m-x'])
    expect(after.resolved).toEqual([{ conversationId: 'conv-unlisted', modalId: 'm-y' }])
  })

  it('clears both slices for the named server in one step', () => {
    const before = run([promptOnA, promptOnB, dismissed('m-b', 'allow', 'local')])
    const after = reduceModal(before, reconnected('conv-b'))
    expect(after.outstanding.map((p) => p.modalId)).toEqual(['m-a'])
    expect(after.resolved).toEqual([])
  })

  it('keeps an unchanged slice BY REFERENCE when only the other one matches', () => {
    // PermissionModal selects `outstanding` under Object.is, so a fresh [] would re-render it for no
    // state change. Here only B's suppression entry matches — B answered its prompt, so it holds
    // nothing outstanding — and `outstanding` must come back by reference even though the state changed.
    const before = run([promptOnA, promptOnB, dismissed('m-b', 'allow', 'local')])
    const after = reduceModal(before, reconnected('conv-b'))
    expect(after).not.toBe(before)
    expect(after.outstanding).toBe(before.outstanding)
    expect(after.resolved).toEqual([])
  })

  it('records the held prompt’s conversation when it is dismissed', () => {
    // Where the suppression entry gets its conversation: the `dismissed` arm removes the prompt whose
    // conversation id it is, so the information is already in hand. A never-outstanding dismissal
    // records nothing, so no conversation is invented for an id that was never held.
    const state = run([promptOnA, dismissed('m-a', 'allow', 'local'), dismissed('ghost')])
    expect(state.resolved).toEqual([{ conversationId: 'conv-a', modalId: 'm-a' }])
  })

  it('does not mutate the input state or either array on a scoped clear', () => {
    // Both slices genuinely move here: B holds one outstanding prompt AND one answered.
    const answeredOnB = shown('m-b2', { conversationId: 'conv-b' })
    const before = run([promptOnA, promptOnB, answeredOnB, dismissed('m-b2', 'allow', 'local')])
    const startOutstanding = before.outstanding
    const startResolved = before.resolved
    const survivor = before.outstanding[0]

    const after = reduceModal(before, reconnected('conv-b'))

    expect(after.outstanding.map((p) => p.modalId)).toEqual(['m-a'])
    expect(after.resolved).toEqual([])
    // Old references intact and unmutated.
    expect(before.outstanding).toBe(startOutstanding)
    expect(before.outstanding).toHaveLength(2)
    expect(before.resolved).toBe(startResolved)
    expect(before.resolved).toEqual([{ conversationId: 'conv-b', modalId: 'm-b2' }])
    // The surviving prompt is carried across by reference, never rebuilt.
    expect(after.outstanding[0]).toBe(survivor)
  })

  it('preserves rejections by reference across a scoped clear', () => {
    // Unchanged from #415: `rejections` has no daemon repopulation path, so the reconnect edge never
    // touches it. Only the pairing clear below does.
    const before = run([promptOnB, rejected('r1')])
    const after = reduceModal(before, reconnected('conv-b'))
    expect(after.rejections).toBe(before.rejections)
  })
})

describe('reduceModal — the pairing-ended clear (#1140)', () => {
  it('drops every prompt, suppression entry and rejection, whatever their conversation (AC4)', () => {
    // Including a prompt held for a conversation no server's list ever carried — the one thing no
    // scoped clear can reach, and the reason this arm is unscoped rather than a wider reconnect.
    const before = run([
      shown('m-a', { conversationId: 'conv-a' }),
      shown('m-x', { conversationId: 'conv-unlisted' }),
      dismissed('m-a', 'allow', 'local'),
      rejected('r1')
    ])
    const after = reduceModal(before, reset())
    expect(after.outstanding).toEqual([])
    expect(after.resolved).toEqual([])
    expect(after.rejections).toEqual([])
  })

  it('returns initialModalState BY REFERENCE, so a redundant clear wakes no listener', () => {
    const before = run([shown('m-a', { conversationId: 'conv-a' })])
    expect(reduceModal(before, reset())).toBe(initialModalState)
    expect(reduceModal(initialModalState, reset())).toBe(initialModalState)
  })

  it('takes no daemon-supplied id: the action is payload-free (AC4)', () => {
    // The `dispatchSession({ type: 'reset' })` shape. Nothing on the wire can steer which of a departed
    // daemon's prompts outlive the pairing, because the arm has nothing to steer.
    expect(reset()).toEqual({ type: 'reset' })
  })

  it('does not mutate the input state', () => {
    const before = run([shown('m-a', { conversationId: 'conv-a' }), rejected('r1')])
    reduceModal(before, reset())
    expect(before.outstanding).toHaveLength(1)
    expect(before.rejections).toEqual(['r1'])
  })
})

describe('initial state + selector', () => {
  it('initialModalState is an empty outstanding set', () => {
    expect(initialModalState.outstanding).toEqual([])
  })

  it('initialModalState is an empty rejection set', () => {
    expect(initialModalState.rejections).toEqual([])
  })

  it('initialModalState is an empty resolved set', () => {
    expect(initialModalState.resolved).toEqual([])
  })

  it('selectOutstanding returns the current slice by reference', () => {
    const state = run([shown('m1')])
    expect(selectOutstanding(state)).toBe(state.outstanding)
  })

  it('selectRejections returns the current slice by reference', () => {
    const state = run([rejected('m1')])
    expect(selectRejections(state)).toBe(state.rejections)
  })
})

describe('selectHasOutstandingFor — the per-conversation read (#878)', () => {
  // Inherited `Object.prototype` member names, queried as ordinary conversation ids. The array scan
  // compares own field VALUES, so none of them can resolve onto the prototype — these pin that against
  // a future refactor to a container keyed by the (daemon-asserted) conversation id.
  const INHERITED_NAMES = ['__proto__', 'constructor', 'toString'] as const

  it('reports true for the conversation that raised the held prompt (AC2)', () => {
    const state = run([shown('m1')])
    expect(selectHasOutstandingFor('conv-m1')(state)).toBe(true)
  })

  it('reports true with two prompts held for the SAME conversation (AC2)', () => {
    const state = run([
      shown('m1', { conversationId: 'conv-a' }),
      shown('m2', { conversationId: 'conv-a' })
    ])
    expect(selectHasOutstandingFor('conv-a')(state)).toBe(true)
  })

  it('reports false against the initial, empty state (AC3)', () => {
    expect(selectHasOutstandingFor('conv-m1')(initialModalState)).toBe(false)
  })

  it('reports false for a conversation with no outstanding prompt (AC3)', () => {
    const state = run([shown('m1')])
    expect(selectHasOutstandingFor('conv-m2')(state)).toBe(false)
  })

  it("reports false once that conversation's only prompt has been dismissed (AC3)", () => {
    const state = run([shown('m1'), dismissed('m1')])
    expect(selectHasOutstandingFor('conv-m1')(state)).toBe(false)
  })

  it('stays true while a sibling prompt on the same conversation is still held (AC3)', () => {
    // Per-conversation, not per-prompt: dismissing one of two must not clear the row's dot.
    const state = run([
      shown('m1', { conversationId: 'conv-a' }),
      shown('m2', { conversationId: 'conv-a' }),
      dismissed('m1')
    ])
    expect(selectHasOutstandingFor('conv-a')(state)).toBe(true)
  })

  it('reports false after a reconnect clears outstanding (AC3)', () => {
    const before = run([shown('m1')])
    expect(selectHasOutstandingFor('conv-m1')(before)).toBe(true)
    const after = reduceModal(before, reconnected('conv-m1'))
    expect(selectHasOutstandingFor('conv-m1')(after)).toBe(false)
  })

  it('still reports true for a conversation the reconnecting server does not list (#1140)', () => {
    // The sidebar's input-required dot reads this selector, so scoping the clear is what decides
    // whether the dot survives another server's reconnect — the visible half of AC1.
    const before = run([
      shown('m1', { conversationId: 'conv-a' }),
      shown('m2', { conversationId: 'conv-b' })
    ])
    const after = reduceModal(before, reconnected('conv-b'))
    expect(selectHasOutstandingFor('conv-a')(after)).toBe(true)
    expect(selectHasOutstandingFor('conv-b')(after)).toBe(false)
  })

  it('answers two conversations independently — one prompt never answers for another (AC4)', () => {
    const state = run([
      shown('m1', { conversationId: 'conv-a' }),
      shown('m2', { conversationId: 'conv-b' })
    ])
    expect(selectHasOutstandingFor('conv-a')(state)).toBe(true)
    expect(selectHasOutstandingFor('conv-b')(state)).toBe(true)
    expect(selectHasOutstandingFor('conv-c')(state)).toBe(false)
  })

  it('reads back TRUE under the exact inherited-property-name id held (AC4)', () => {
    // A positive read-back, not an absence check: an absence check passes vacuously against an
    // implementation that silently dropped the entry.
    for (const name of INHERITED_NAMES) {
      const state = run([shown('m1', { conversationId: name })])
      expect(selectHasOutstandingFor(name)(state)).toBe(true)
      // And it is still only that one conversation's prompt — no neighbour answers for it.
      expect(selectHasOutstandingFor('conv-m1')(state)).toBe(false)
    }
  })

  it('reports false for an inherited property name with no prompt held for it (AC4)', () => {
    const state = run([shown('m1')])
    for (const name of INHERITED_NAMES) {
      expect(selectHasOutstandingFor(name)(state)).toBe(false)
    }
  })

  it('installing a `__proto__` conversation id pollutes no prototype (AC4)', () => {
    const state = run([shown('m1', { conversationId: '__proto__' })])
    expect(state.outstanding[0].conversationId).toBe('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('conv-m1')
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('m1')
  })
})

describe('permission resolution feedback', () => {
  it.each(['remote', 'timeout'] as const)('records %s only from a held prompt, with its owner', source => {
    const state = run([shown('opaque', { conversationId: '__proto__' }), dismissed('opaque', 'DAEMON_OUTCOME', source)])
    expect(state.resolutions).toEqual([{ conversationId: '__proto__', kind: source, phase: 'pending' }])
    expect(reduceModal(state, dismissed('opaque', 'DAEMON_OUTCOME', source))).toBe(state)
    expect(reduceModal(state, dismissed('unknown', '', source))).toBe(state)
  })

  it.each(['allow', 'cancel'])('local %s and its later daemon dismissal stay silent', outcome => {
    const state = run([shown('local'), dismissed('local', outcome, 'local'), dismissed('local', outcome, 'remote')])
    expect(state.resolutions).toEqual([])
  })

  it('an unrecognized source cannot create feedback', () => {
    // Simulate a buggy caller outside the typed bridge; source never becomes DOM copy.
    const event = { type: 'dismissed', modalId: 'held', outcome: 'DAEMON_OUTCOME', source: 'unknown' } as unknown as ModalEvent
    expect(reduceModal(run([shown('held')]), event).resolutions).toEqual([])
  })

  it('keeps only the latest per chat without disturbing another chat', () => {
    const first = run([shown('one', { conversationId: 'a' }), dismissed('one', '', 'remote'),
      shown('two', { conversationId: 'b' }), dismissed('two', '', 'timeout')])
    const old = first.resolutions[0]
    const next = [shown('three', { conversationId: 'a' }), dismissed('three', '', 'timeout')].reduce(reduceModal, first)
    expect(next.resolutions).toEqual([{ conversationId: 'b', kind: 'timeout', phase: 'pending' },
      { conversationId: 'a', kind: 'timeout', phase: 'pending' }])
    expect(next.resolutions[0]).toBe(first.resolutions[1])
    expect(reduceModal(next, { type: 'resolutionDisplayed', resolution: old })).toBe(next)
    expect(reduceModal(next, { type: 'resolutionDismissed', resolution: old })).toBe(next)
  })

  it('guards display and dismissal by identity, including a replaced displayed notice', () => {
    const pending = run([shown('one'), dismissed('one', '', 'remote')])
    const notice = pending.resolutions[0]
    const displayed = reduceModal(pending, { type: 'resolutionDisplayed', resolution: notice })
    expect(displayed.resolutions[0].phase).toBe('displayed')
    expect(reduceModal(displayed, { type: 'resolutionDisplayed', resolution: notice })).toBe(displayed)
    const active = displayed.resolutions[0]
    expect(reduceModal(displayed, { type: 'resolutionDisplayed', resolution: active })).toBe(displayed)
    expect(reduceModal(displayed, { type: 'resolutionDismissed', resolution: { ...active } })).toBe(displayed)
    const replacement = [shown('two', { conversationId: 'conv-one' }), dismissed('two', '', 'timeout')].reduce(reduceModal, displayed)
    expect(reduceModal(replacement, { type: 'resolutionDismissed', resolution: active })).toBe(replacement)
    const cleared = reduceModal(displayed, { type: 'resolutionDismissed', resolution: active })
    expect(cleared.resolutions).toEqual([])
    expect(reduceModal(cleared, { type: 'resolutionDismissed', resolution: active })).toBe(cleared)
  })

  it('reconnect neither manufactures nor discards feedback; reset clears pending and displayed', () => {
    const state = run([shown('held'), shown('one'), dismissed('one', '', 'remote'),
      shown('two'), dismissed('two', '', 'timeout')])
    const displayed = reduceModal(state, { type: 'resolutionDisplayed', resolution: state.resolutions[0] })
    const rejoined = reduceModal(displayed, reconnected('conv-held', 'conv-one', 'conv-two'))
    expect(rejoined.outstanding).toEqual([])
    expect(rejoined.resolutions).toBe(displayed.resolutions)
    expect(reduceModal(rejoined, dismissed('held', '', 'timeout'))).toBe(rejoined)
    expect(reduceModal(rejoined, reset()).resolutions).toEqual([])
  })
})
