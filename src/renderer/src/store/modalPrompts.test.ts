import { describe, it, expect } from 'vitest'
import {
  reduceModal,
  initialModalState,
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

// #415: the transport (re)handshake. Payload-free — the reset needs nothing from the connect ack.
function reconnected(): ModalEvent {
  return { type: 'reconnected' }
}

/** Fold a sequence of events over the initial state — the reducer's natural exercise shape. */
function run(events: readonly ModalEvent[]): ModalState {
  return events.reduce(reduceModal, initialModalState)
}

describe('reduceModal — install', () => {
  it('holds a single shown prompt addressed by modalId, carrying its fields verbatim', () => {
    const state = run([shown('m1')])
    expect(state.outstanding).toHaveLength(1)
    const prompt: ModalPrompt = {
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

    const next = reduceModal(start, reconnected())

    // A real change: a freshly emptied resolved array.
    expect(next.resolved).not.toBe(start.resolved)
    expect(next.resolved).toEqual([])
    // Old references intact and unmutated.
    expect(start.resolved).toBe(startResolved)
    expect(start.resolved).toEqual(['m1'])
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
    const state = run([shown('m1'), shown('m2'), reconnected()])
    expect(state.outstanding).toEqual([])
  })

  it('clears the resolved slice across the reset (#510 — deliberate reversal of #415 AC3)', () => {
    // #510: `resolved` is per-CONNECTION truth, not permanent. #415 AC3 retained it across the reset
    // believing that prevented a double-show — but the daemon's connect-time reconcile enumerates only
    // STILL-OUTSTANDING modals, so retention guarded nothing and cost the swallowed-answer bug.
    const before = run([shown('m1'), dismissed('m1')])
    expect(before.resolved).toEqual(['m1'])
    const after = reduceModal(before, reconnected())
    expect(after.resolved).toEqual([])
    expect(after.resolved).not.toBe(before.resolved)
  })

  it('preserves the rejections surface by reference across the reset (AC3)', () => {
    // rejections (#249) has no daemon repopulation path — clearing it would drop a banner with nothing
    // to refill.
    const before = run([shown('m1'), rejected('r1')])
    expect(before.rejections).toEqual(['r1'])
    const after = reduceModal(before, reconnected())
    expect(after.rejections).toBe(before.rejections)
    expect(after.rejections).toEqual(['r1'])
  })

  it('returns the same state reference when outstanding is already empty — first connect (AC4)', () => {
    const after = reduceModal(initialModalState, reconnected())
    expect(after).toBe(initialModalState)
  })

  it('a reconnect with only resolved to clear returns a new state, outstanding by reference (#510)', () => {
    // #510 shifts #415 AC4's no-churn invariant to "same reference when the reconnect has NOTHING to
    // clear". Here `resolved` is non-empty, so a new state IS returned — but `outstanding` was already
    // empty and keeps its reference: PermissionModal selects it under Object.is, so minting a fresh []
    // would re-render the container for no state change.
    const before = run([shown('m1'), dismissed('m1')])
    expect(before.outstanding).toEqual([])
    const after = reduceModal(before, reconnected())
    expect(after).not.toBe(before)
    expect(after.outstanding).toBe(before.outstanding)
    expect(after.resolved).toEqual([])
  })

  it('a still-held prompt re-sent after the reset surfaces exactly once (AC2)', () => {
    const state = run([shown('m1'), reconnected(), shown('m1')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1'])
    expect(state.outstanding).toHaveLength(1)
  })

  it('a prompt answered while disconnected RE-SURFACES when re-sent after the reset (#510 AC1)', () => {
    // #510, the bug and the deliberate reversal of #415 AC3: the Allow clicked while the link was down
    // never reached the daemon (`answerModal` early-returns on a null driver), so the daemon re-sends the
    // still-outstanding prompt. The reset cleared `resolved`, so it re-surfaces instead of the user's
    // explicit answer decaying into a deny-on-timeout.
    const state = run([shown('m1'), dismissed('m1', 'allow', 'local'), reconnected(), shown('m1')])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1'])
  })

  it('the re-surfaced prompt carries the RE-DELIVERED fields, not the stale ones (#510 AC1)', () => {
    const state = run([
      shown('m1'),
      dismissed('m1', 'allow', 'local'),
      reconnected(),
      shown('m1', { title: 'Re-delivered' })
    ])
    expect(state.outstanding).toHaveLength(1)
    expect(state.outstanding[0].title).toBe('Re-delivered')
  })

  it('the re-surfaced prompt can be answered again, re-recording resolved (#510 AC1)', () => {
    const before = run([shown('m1'), dismissed('m1', 'allow', 'local'), reconnected(), shown('m1')])
    expect(before.outstanding).toHaveLength(1) // precondition: it really did re-surface
    // A live, answerable entry — not a display artefact: the re-answer genuinely REMOVES it (a new state,
    // not a no-op) and re-records `resolved`, which the NEXT reconnect clears again — so the fix
    // self-heals across repeated drops rather than working exactly once.
    const after = reduceModal(before, dismissed('m1', 'allow', 'local'))
    expect(after).not.toBe(before)
    expect(after.outstanding).toEqual([])
    expect(after.resolved).toEqual(['m1'])
  })

  it('re-surfaces the answered prompt alongside a sibling still held, exactly once each (#510 AC1)', () => {
    const state = run([
      shown('m1'),
      shown('m2'),
      dismissed('m1', 'allow', 'local'),
      reconnected(),
      shown('m1'),
      shown('m2')
    ])
    expect(state.outstanding.map((p) => p.modalId)).toEqual(['m1', 'm2'])
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
