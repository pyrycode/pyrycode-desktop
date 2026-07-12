// The send-interrupt effect — framework-free and React-free, co-located with the screen and mirroring
// dropQueuedMessage.ts / composerSend.ts: the single effect (the guarded outbound command) is injected,
// so the helper is a pure, deterministic function tested with a plain spy (no React, no store, no
// Electron). InterruptControl is thin glue over this.
//
// A strict simplification of dropQueuedMessage: the same guarded-send-no-local-dispatch posture, but the
// interrupt command is BARE — no ids to thread (daemon SSOT pyrycode #707: one Esc, fire-and-forget, no
// conversation selector). Extracted like every sibling guarded send (submitMessage, dropQueuedMessage,
// answerPrompt, runUnpair) rather than inlined in the container.
import { interruptCommand, type RendererCommand } from '@shared/ipc/commands'

/**
 * The single effect sendInterrupt performs, injected so the helper stays pure and deterministic in
 * tests. `sendCommand` is `window.pyry.sendCommand` in the container.
 */
export interface SendInterruptDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Stop the running turn (#306's bare `interrupt`). Guarded send ONLY — no local dispatch: interrupt is
 * not optimistic (AC3), so no "stopping" state is posted here; the control retracts when the daemon's
 * next `turn_state{idle}` returns `phase` to idle, which the live store subscription renders. A bridge
 * failure is swallowed (`console.error`), never propagated — a failed interrupt must not crash the
 * window (the dropQueuedMessage / submitMessage AC posture); the turn simply keeps running and the
 * control stays visible, which is the honest state (the daemon never received the Esc).
 */
export function sendInterrupt(deps: SendInterruptDeps): void {
  try {
    deps.sendCommand(interruptCommand())
  } catch (error) {
    // A send-bridge failure must not crash the window. No local dispatch (AC3: no optimistic state).
    console.error('interrupt send failed', error)
  }
}
