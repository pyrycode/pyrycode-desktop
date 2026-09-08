import { describe, it, expect, vi } from 'vitest'
import {
  applyPairingChange,
  type PairingChange,
  type PairingChangeDeps
} from './applyPairingChange'

// applyPairingChange is a pure, React-free helper (the activateConversation / exitActiveConversation
// / unpairAction / composerSend precedent): its four effects are injected, so the wiring is exercised
// here with plain spies. No React, no DOM, no store, no Electron bridge.
//
// This file is where #1141's deliverable is OBSERVABLE. The deliverable is a negative — pairing
// another server clears nothing — and until the wiring was lifted out of PairedShell's JSX there was
// nowhere for a negative to land: `vitest.config.ts` is `environment: 'node'`, so renderer specs are
// static server renders with no DOM, no effects and no event handlers, and PairedShell.test.tsx says
// so in as many words. An inline arrow held in a prop can never be called, so "the call is gone"
// could only ever be read, never asserted. Put the clear back on the pair-another arm and the second
// case below fails; that is the whole point of it.

/** The four spies, and `deps` typed against the real interface so a member added to
 *  `PairingChangeDeps` is a compile error here until it is wired and asserted. */
function spyDeps(): {
  deps: PairingChangeDeps
  clearPairingScopedState: ReturnType<typeof vi.fn>
  navigateToPairingScreen: ReturnType<typeof vi.fn>
  navigateToNewServerList: ReturnType<typeof vi.fn>
  returnToPairingOrigin: ReturnType<typeof vi.fn>
} {
  const clearPairingScopedState = vi.fn()
  const navigateToPairingScreen = vi.fn()
  const navigateToNewServerList = vi.fn()
  const returnToPairingOrigin = vi.fn()
  return {
    deps: {
      clearPairingScopedState,
      navigateToPairingScreen,
      navigateToNewServerList,
      returnToPairingOrigin
    },
    clearPairingScopedState,
    navigateToPairingScreen,
    navigateToNewServerList,
    returnToPairingOrigin
  }
}

/** The nav half of each arm's contract, named so the table below can address one spy by key. */
type NavEffect = 'navigateToPairingScreen' | 'navigateToNewServerList' | 'returnToPairingOrigin'

/**
 * WHAT EACH PAIRING CHANGE OWES — the whole decision this module makes, in one table.
 *
 * `Record<PairingChange, …>` rather than an array is the tripwire: a FOURTH member added to the
 * union fails to compile here until someone states whether it clears and where it navigates, which
 * is the same obligation `ClearPairingScopedStateDeps`' thirteen-key pin creates one layer down. The
 * helper's `assertNever` forces the arm to exist; this forces its contract to be declared.
 */
const EXPECTED: Record<PairingChange, { clears: boolean; navigates: NavEffect }> = {
  unpaired: { clears: true, navigates: 'navigateToPairingScreen' },
  pairedAnotherServer: { clears: false, navigates: 'navigateToNewServerList' },
  cancelledPairAnotherServer: { clears: false, navigates: 'returnToPairingOrigin' }
}

const NAV_EFFECTS: readonly NavEffect[] = [
  'navigateToPairingScreen',
  'navigateToNewServerList',
  'returnToPairingOrigin'
]

describe('applyPairingChange', () => {
  it('unpair clears the pairing-scoped state, THEN flips the App route (#531 ordering, #1141 AC2)', () => {
    // Unpair is the path that genuinely ends a pairing, so it keeps the whole thirteen-store clear —
    // this helper decides WHETHER, never WHAT, so one call to the injected clear is the whole
    // assertion; the set itself, its ordering constraint and its membership rule stay pinned in
    // clearPairingScopedState.test.ts.
    //
    // The call ORDER is the half that has had no executable assertion since #531 moved the clear out
    // of runUnpair and took the one case that pinned it: the paired-shell overview records that
    // residual as "worth restoring the moment a jsdom harness lands". No harness was needed in the
    // end — lifting the wiring into a pure function was enough. Clear-then-navigate is what stops any
    // observer seeing the pairing screen rendered against the ended pairing's rows, conversation id
    // or session.
    const { deps, clearPairingScopedState, navigateToPairingScreen } = spyDeps()

    applyPairingChange(deps, 'unpaired')

    expect(clearPairingScopedState).toHaveBeenCalledTimes(1)
    expect(navigateToPairingScreen).toHaveBeenCalledTimes(1)
    expect(clearPairingScopedState.mock.invocationCallOrder[0]).toBeLessThan(
      navigateToPairingScreen.mock.invocationCallOrder[0]
    )
  })

  it('pairing another server clears NOTHING and lands on the new server’s list (#1141 AC1)', () => {
    // THE DELIVERABLE, and the case that fails if the call is put back (AC4). Adding a server ends no
    // pairing: since #1117 and #1084 the background process holds one live connection per paired
    // record, so the servers already paired stay paired and stay connected, and all thirteen slices
    // belong to them — the conversation the operator was reading, the session being driven, every
    // queued item, background task, outstanding prompt and read mark.
    //
    // A whole-store assertion is the right shape here even though the clear is nullary: this helper
    // cannot see WHICH stores would go, so "none of them, because the effect never ran" is the only
    // statement it can make — and it is exactly the statement the ticket asks for.
    const { deps, clearPairingScopedState, navigateToNewServerList } = spyDeps()

    applyPairingChange(deps, 'pairedAnotherServer')

    expect(clearPairingScopedState).not.toHaveBeenCalled()
    expect(navigateToNewServerList).toHaveBeenCalledTimes(1)
  })

  it('cancelling out of the pair-another flow clears nothing and returns to the launching surface (#1141 AC3)', () => {
    // #1303 renamed the dep from `returnToSettings`: with a second entry the destination is no longer
    // Settings by definition, it is wherever pairing was launched from. WHICH surface that is stays
    // outside this module — the container records it and the reducer's payload carries it — so what is
    // asserted here is unchanged and deliberately destination-blind: the cancel arm drives this one
    // effect, once, and clears nothing.
    //
    // Unchanged behaviour, newly assertable. Before the lift this arm was a bare `dispatch` inline in
    // the JSX and "cancel clears nothing" was proven by the ABSENCE of a wrapper around it — true, and
    // invisible to every test in the repo. Routing it through the same helper as its two siblings
    // turns that absence into a positive assertion, which is what stops a later reader "restoring
    // symmetry" by wrapping all three.
    const { deps, clearPairingScopedState, returnToPairingOrigin } = spyDeps()

    applyPairingChange(deps, 'cancelledPairAnotherServer')

    expect(clearPairingScopedState).not.toHaveBeenCalled()
    expect(returnToPairingOrigin).toHaveBeenCalledTimes(1)
  })

  it('every change clears exactly as the table says and drives exactly ONE of the three navs', () => {
    // The exhaustiveness half (see EXPECTED above), plus the cross-wiring guard the three cases above
    // cannot give on their own: each of them asserts its own nav, so a second nav fired by the same
    // arm would pass all three. Here the two destinations an arm must NOT reach are asserted
    // untouched, so no future edit can quietly land two transitions on one destination.
    for (const change of Object.keys(EXPECTED) as PairingChange[]) {
      const expected = EXPECTED[change]
      const spies = spyDeps()

      applyPairingChange(spies.deps, change)

      expect(spies.clearPairingScopedState).toHaveBeenCalledTimes(expected.clears ? 1 : 0)
      for (const nav of NAV_EFFECTS) {
        expect(spies[nav]).toHaveBeenCalledTimes(nav === expected.navigates ? 1 : 0)
      }
    }
  })
})
