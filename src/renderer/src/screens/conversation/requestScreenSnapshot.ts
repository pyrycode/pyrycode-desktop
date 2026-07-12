// The screen-snapshot request effect — framework-free and React-free, co-located with the screen and
// mirroring sendInterrupt.ts / composerSend.ts: the single effect (the guarded outbound command) is
// injected, so the helper is a pure, deterministic function tested with a plain spy (no React, no store,
// no Electron). ScreenSnapshotControl is thin glue over this.
//
// Fires the EXISTING requestSnapshot command (#180) — the same inline literal requestRunConfigSnapshot
// sends — so requesting the daemon screen adds no new command or IPC wiring (#324). The daemon answers via
// the `screenSnapshotReceived` path #316/#323 already wire into the screen-snapshot store, so there is no
// request/response correlation to track here. The sendInterrupt guarded-send posture (try/catch +
// console.error, no local dispatch) is the closer precedent than requestRunConfigSnapshot's unguarded
// fire-from-useEffect, because this is a click-driven, fire-and-forget send that must never crash the
// window on a bridge failure.
import type { RendererCommand } from '@shared/ipc/commands'
import { MILESTONE_CONVERSATION_ID } from './composerSend'

/**
 * The single effect requestScreenSnapshot performs, injected so the helper stays pure and deterministic
 * in tests. `sendCommand` is `window.pyry.sendCommand` in the container.
 */
export interface RequestScreenSnapshotDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Fire exactly one `requestSnapshot` for the milestone conversation (AC1). The command is an inline literal
 * typed as RendererCommand — no constructor added, exactly as requestRunConfigSnapshot fires it, keeping
 * the change renderer-contained (no main-process or IPC change here). `MILESTONE_CONVERSATION_ID` is the
 * single source of truth a future conversation-selection ticket replaces. Guarded send ONLY, no local
 * dispatch: a bridge failure is swallowed (`console.error`), never rethrown — a failed request must not
 * crash the window (the sendInterrupt / submitMessage posture). Fire-and-forget: `sendCommand` is `void`,
 * so there is nothing to await; the reply arrives on the store's own path.
 */
export function requestScreenSnapshot(deps: RequestScreenSnapshotDeps): void {
  try {
    deps.sendCommand({
      type: 'requestSnapshot',
      payload: { conversation_id: MILESTONE_CONVERSATION_ID }
    })
  } catch (error) {
    // A send-bridge failure must not crash the window. No local dispatch (fire-and-forget request).
    console.error('screen snapshot request failed', error)
  }
}
