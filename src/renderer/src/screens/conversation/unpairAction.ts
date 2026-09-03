// The unpair interaction's decision logic — framework-free and React-free, co-located with the
// screen and mirroring composerSend.ts: the effects are injected so the helper is a pure,
// deterministic function tested with plain spies (no React, no store, no Electron). The container's
// UnpairControl is thin glue over this — the confirm-phase useState is untested screen-local glue,
// but the ok/error branching lives here where a server-render test can't drive an async click.
import type { UnpairResult } from '@shared/ipc/unpair'
import type { ConnectionError, SessionAction } from '../../store/sessionStore'

/**
 * The three effects runUnpair performs, injected to keep it pure:
 *  - `unpair`     — window.pyry.unpair in the container: clears the stored pairing in main (#173).
 *  - `dispatch`   — the session store dispatch: {failed} on error. Error-path only since #531.
 *  - `onUnpaired` — the App route flip → 'pairing', mirroring onPaired's flip in reverse.
 */
export interface UnpairDeps {
  unpair: () => Promise<UnpairResult>
  dispatch: (action: SessionAction) => void
  onUnpaired: () => void
}

/**
 * AC5's synthesized failure, reusing the existing ConnectionError shape so the composer's error
 * affordance surfaces it verbatim. `composerAvailability` maps ANY `error` status to a disabled send and
 * nothing else — it does not read `.message`, and since #968 it returns no string at all — so `message`
 * populates the store shape for a future banner only. `code: 'unpair'` distinguishes the source in
 * diagnostics.
 */
const UNPAIR_FAILED_ERROR: ConnectionError = {
  code: 'unpair',
  message: 'Could not forget this pairing.',
  retryable: false
}

/**
 * Perform the unpair effects and report the outcome so the container can reset its confirm phase.
 *
 * Fail-safe by construction: the route flips (via onUnpaired) ONLY on `result: 'ok'`. A `result:
 * 'error'` or a rejected invoke (handler absent) is coerced to the error path — dispatch `failed`,
 * stay on the conversation screen, never flip. This upholds AC5's "no cleared-in-UI-but-still-on-
 * disk half-state".
 *
 * #531 moved the success-path clear OUT of here. The ok branch's contract is now exactly "flip the
 * route via onUnpaired", whose PairedShell wrapper runs the shared clearPairingScopedState — the
 * session store plus the thread rows, the active conversation and the daemon session id — before App
 * re-routes, so neither the pairing screen nor an immediate relaunch observes the ended pairing's
 * state. Keeping a duplicate reset here would be runtime-harmless (the arm returns the shared
 * `initialSessionState` by reference) but would give the session store two owners on one path, and the
 * pair-another-server path would silently lose its clear the moment someone deleted the "redundant"
 * one from the helper. That the flip is ok-only is also what extends this fail-safe posture to the new
 * clears at zero cost: no `onUnpaired`, no wrapper, no clear — which the error tests below already pin.
 */
export async function runUnpair(deps: UnpairDeps): Promise<'ok' | 'error'> {
  let result: UnpairResult
  try {
    result = await deps.unpair()
  } catch {
    // A rejected invoke never reaches the window: coerce to the same error outcome as result:error.
    deps.dispatch({ type: 'failed', error: UNPAIR_FAILED_ERROR })
    return 'error'
  }

  if (result.result === 'ok') {
    deps.onUnpaired()
    return 'ok'
  }

  deps.dispatch({ type: 'failed', error: UNPAIR_FAILED_ERROR })
  return 'error'
}
