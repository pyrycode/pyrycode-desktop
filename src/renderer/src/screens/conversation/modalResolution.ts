// The modal-resolution effects — framework-free and React-free, co-located with the screen and
// mirroring composerSend.ts's submitMessage: the two effects (the guarded outbound command + the
// local `dismissed` dispatch) are injected, so each helper is a pure, deterministic function tested
// with plain spies (no React, no store, no Electron). The PermissionModal container is thin glue over
// these. This is where the AC4 guarded-send + unconditional-clear logic lives so it is unit-testable
// under the `node` test environment (the view cannot be — no DOM to fire clicks).
import { answerModalCommand, cancelModalCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ModalEvent } from '../../store/modalPrompts'

/**
 * The `outcome` a cancel records on the local `dismissed` event. The reduce ignores `outcome` (it
 * clears on `modalId` alone), so the value is a forward carry for #227's resolution toast; it matches
 * the daemon's own `OutcomeCancelled` wire vocabulary (pyrycode #727 / #701) so #227 can reconcile the
 * local-optimistic and daemon-sent dismissals under one vocabulary. An answer records the chosen
 * `option_id` as its outcome instead.
 */
export const MODAL_CANCEL_OUTCOME = 'cancelled'

/**
 * The two effects answerPrompt / cancelPrompt perform, injected so the helpers stay pure and
 * deterministic in tests. `sendCommand` is `window.pyry.sendCommand` in the container; `dispatch` is
 * the modalStore's `dispatch`.
 */
export interface ModalResolveDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ModalEvent) => void
}

/**
 * Answer an outstanding prompt with the chosen option, then clear it locally (optimistic). The
 * camelCase → snake_case rename to the wire vocabulary (`modalId`/`optionId` → `modal_id`/`option_id`)
 * happens HERE, at the dispatch site — the store's untrusted camelCase and the wire vocabulary stay
 * apart. The send is guarded (AC4): a bridge failure is swallowed, never propagated. The `dispatch` is
 * OUTSIDE the try, so a send-bridge throw never prevents the local clear — the prompt always clears on
 * a click, exactly like submitMessage's optimistic echo. The `answer_token` is minted MAIN-side
 * (#236, daemonConnection.answerModal); this payload carries only `modal_id` + `option_id`.
 */
export function answerPrompt(modalId: string, optionId: string, deps: ModalResolveDeps): void {
  try {
    deps.sendCommand(answerModalCommand({ modal_id: modalId, option_id: optionId }))
  } catch (error) {
    // AC4: a send-bridge failure must not crash the window. The local clear still posts.
    console.error('modal answer send failed', error)
  }

  deps.dispatch({ type: 'dismissed', modalId, outcome: optionId, source: 'local' })
}

/**
 * Cancel an outstanding prompt, then clear it locally (optimistic). Same guarded-send + unconditional
 * local-clear shape as answerPrompt; records the MODAL_CANCEL_OUTCOME sentinel as its outcome.
 */
export function cancelPrompt(modalId: string, deps: ModalResolveDeps): void {
  try {
    deps.sendCommand(cancelModalCommand({ modal_id: modalId }))
  } catch (error) {
    // AC4: a send-bridge failure must not crash the window. The local clear still posts.
    console.error('modal cancel send failed', error)
  }

  deps.dispatch({ type: 'dismissed', modalId, outcome: MODAL_CANCEL_OUTCOME, source: 'local' })
}
