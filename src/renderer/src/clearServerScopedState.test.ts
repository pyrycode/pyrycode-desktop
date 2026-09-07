import { describe, it, expect, vi } from 'vitest'
import type { ConversationCreatedPayload } from '@shared/wire/types'
import {
  clearServerScopedState,
  type ClearServerScopedStateDeps
} from './clearServerScopedState'

// Plain-function tests over injected spies — the clearPairingScopedState.test / exitActiveConversation
// .test idiom. No React, no store, no Electron: the helper is pure by construction and every effect it
// performs is a spy here.

const conversation = (id: string): ConversationCreatedPayload => ({
  id,
  is_promoted: true,
  cwd: '/home/pyry/project',
  name: 'Design review',
  last_used_at: '2026-09-07T09:00:00Z'
})

/** All nine effects as spies, with the departed set and the open conversation as the two knobs. */
function deps(
  over: {
    departed?: readonly string[]
    open?: ConversationCreatedPayload | null
  } = {}
): ClearServerScopedStateDeps & { [K in keyof ClearServerScopedStateDeps]: ReturnType<typeof vi.fn> } {
  const departed = new Set(over.departed ?? [])
  return {
    getDepartedConversationIds: vi.fn(() => departed),
    clearConversationsFor: vi.fn(),
    getActiveConversation: vi.fn(() => over.open ?? null),
    dispatchTimeline: vi.fn(),
    clearTimelineFor: vi.fn(),
    clearActiveConversation: vi.fn(),
    clearSessionId: vi.fn(),
    clearRunConfig: vi.fn(),
    clearLastReadFor: vi.fn(),
    navigateToList: vi.fn()
  } as never
}

describe('clearServerScopedState', () => {
  // THE ORDERING THIS CAN SILENTLY HALF-WORK ON. The departed conversation ids are reachable only
  // through the slot being dropped, and the exclusivity filter behind them additionally needs every
  // OTHER slot still in place to know what another machine claims. Read after the drop, the set is
  // empty, every thread survives, and AC1 still passes on its own — so this is pinned on CALL ORDER,
  // not on the effects.
  it('reads the departed ids BEFORE dropping the list slot', () => {
    const d = deps({ departed: ['c1'] })
    clearServerScopedState(d, 'srv-a')
    expect(d.getDepartedConversationIds.mock.invocationCallOrder[0]).toBeLessThan(
      d.clearConversationsFor.mock.invocationCallOrder[0]
    )
  })

  it('drops the departed server’s list slot, and asks for exactly that server (AC1)', () => {
    const d = deps()
    clearServerScopedState(d, 'srv-a')
    expect(d.getDepartedConversationIds).toHaveBeenCalledWith('srv-a')
    expect(d.clearConversationsFor).toHaveBeenCalledTimes(1)
    expect(d.clearConversationsFor).toHaveBeenCalledWith('srv-a')
  })

  it('clears EVERY departed conversation’s thread, not only the one on screen (AC2)', () => {
    // The half exitActiveConversation cannot cover: its id gate fires for at most one conversation, so
    // looping it alone would leave every background thread of the departed machine held.
    const d = deps({ departed: ['c1', 'c2', 'c3'], open: conversation('c2') })
    clearServerScopedState(d, 'srv-a')
    const cleared = d.clearTimelineFor.mock.calls.map(([id]) => id)
    expect(new Set(cleared)).toEqual(new Set(['c1', 'c2', 'c3']))
  })

  it('leaves a still-paired server’s threads alone — it only ever names the departed ids (AC2)', () => {
    const d = deps({ departed: ['c1'] })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearTimelineFor.mock.calls.map(([id]) => id)).toEqual(['c1'])
  })

  it('closes the open conversation and navigates when it belongs to the departed server (AC3)', () => {
    const d = deps({ departed: ['c1', 'c2'], open: conversation('c2') })
    clearServerScopedState(d, 'srv-a')
    // The whole of exitActiveConversation's set, inherited rather than re-derived — including the two
    // that are its security payload (a cleared session id makes the Run configuration controls inert).
    expect(d.dispatchTimeline).toHaveBeenCalledWith({ type: 'reset' })
    expect(d.clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(d.clearSessionId).toHaveBeenCalledTimes(1)
    expect(d.clearRunConfig).toHaveBeenCalledTimes(1)
    expect(d.navigateToList).toHaveBeenCalledTimes(1)
  })

  it('leaves an open conversation belonging to a STILL-PAIRED server open (AC3)', () => {
    const d = deps({ departed: ['c1'], open: conversation('survivor') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.clearSessionId).not.toHaveBeenCalled()
    expect(d.clearRunConfig).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
    // The departed thread still goes — AC2 is independent of whichever chat happens to be on screen.
    expect(d.clearTimelineFor).toHaveBeenCalledWith('c1')
  })

  it('exits at most once even when several conversations depart', () => {
    // The gate is delegated whole and it is the ID: only the one iteration naming the conversation on
    // screen does anything, and in production `clearActiveConversation` makes even that idempotent.
    const d = deps({ departed: ['c1', 'c2', 'c3'], open: conversation('c1') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).toHaveBeenCalledTimes(1)
    expect(d.navigateToList).toHaveBeenCalledTimes(1)
  })

  it('nothing open is a plain no-exit, not a special case', () => {
    const d = deps({ departed: ['c1'], open: null })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
  })

  it('a server holding no rows still drops its slot and touches nothing else', () => {
    const d = deps({ departed: [], open: conversation('survivor') })
    clearServerScopedState(d, 'srv-never-listed')
    expect(d.clearConversationsFor).toHaveBeenCalledTimes(1)
    expect(d.clearConversationsFor).toHaveBeenCalledWith('srv-never-listed')
    expect(d.clearTimelineFor).not.toHaveBeenCalled()
    expect(d.clearActiveConversation).not.toHaveBeenCalled()
    expect(d.navigateToList).not.toHaveBeenCalled()
    // The marks drop is UNCONDITIONAL — no `departed.size` gate here. The guard lives in the store,
    // which is the only place that can answer the question that actually matters ("did any HELD mark
    // leave?"); a gate here would be a second, weaker copy of it, blind to a non-empty set naming
    // nothing held.
    expect(d.clearLastReadFor).toHaveBeenCalledTimes(1)
    expect(d.clearLastReadFor).toHaveBeenCalledWith(new Set())
  })

  it('drops the last-read marks of the departed conversations, and only those (#1197 AC1)', () => {
    const d = deps({ departed: ['c1', 'c2'], open: conversation('survivor') })
    clearServerScopedState(d, 'srv-a')
    expect(d.clearLastReadFor).toHaveBeenCalledTimes(1)
    // The set the helper ALREADY computed, handed straight on — not a fresh read, and never a widening
    // to `selectConversationIdsFor`. These ids are the DEPARTING daemon's own claim, so the exclusivity
    // filter behind `getDepartedConversationIds` is what stops "forget machine A" from destroying
    // machine B's marks, which have no backfill any more than B's threads do.
    expect(d.clearLastReadFor).toHaveBeenCalledWith(d.getDepartedConversationIds.mock.results[0].value)
    expect(d.clearLastReadFor).toHaveBeenCalledWith(new Set(['c1', 'c2']))
  })

  it('the marks drop runs AFTER every departed thread clear (#1197 AC4)', () => {
    // THE ordering this can silently half-work on, and it is LOOP-shaped. Each `clearTimelineFor`
    // notifies `conversationTimelineStore`'s subscribers synchronously, and among them is #777's bridge,
    // which re-stamps whatever chat is open and — finding the slice gone — records a mark of `0` for it,
    // persisting a departed conversation's id to disk while every in-memory assertion stays green.
    // Because that fires on EVERY iteration, a drop placed inside the loop is re-minted by a later one.
    // The re-stamp lives in a React effect and `vitest.config.ts` is `environment: 'node'` globally, so
    // no test in this repo runs that subscription: the re-mint cannot be driven end-to-end and an
    // end-state storage assertion would pass with the bug. Pinned on call ORDER, as
    // `clearPairingScopedState.test.ts` pins the identical constraint for the whole-app boundary.
    const d = deps({ departed: ['c1', 'c2', 'c3'], open: conversation('c1') })
    clearServerScopedState(d, 'srv-a')
    // The LAST thread clear, not the first — `Math.max` is what makes this "after the loop" rather than
    // "after the first iteration", which is the placement that actually re-mints.
    expect(Math.max(...d.clearTimelineFor.mock.invocationCallOrder)).toBeLessThan(
      d.clearLastReadFor.mock.invocationCallOrder[0]
    )
  })

  it('returns nothing and reports nothing — total, like both clear helpers beside it', () => {
    expect(clearServerScopedState(deps({ departed: ['c1'] }), 'srv-a')).toBeUndefined()
  })
})
