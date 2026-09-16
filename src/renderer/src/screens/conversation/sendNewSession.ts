// #1218 — the send half of the Actions menu's Reset session row: ask the daemon to kill claude in the
// open conversation and spawn a fresh one, so every stored setting applies at the spawn. Framework-free
// and React-free, co-located with the screen and mirroring `sendInterrupt` / `dropQueuedMessage` /
// `composerSend`: the single effect (the guarded outbound command) is injected, so the helper is a pure,
// deterministic function tested with a plain spy (no React, no store, no Electron).
//
// IT IS NOT A `/clear`. That text, sent as an ordinary message through `submitMessage`, makes claude clear
// its context in place while the process keeps what it holds. This sends a control frame that throws the
// process away. #1496 folded the two into one row — the menu used to offer both, and Juhana's 2026-09-06
// decision is that a conversation has exactly one reset path and it is this one — so nothing about this
// helper may be refactored towards the message-text path: the row that survived is the one that restarts
// claude, and routing it back through message text would silently restore the rejected behaviour under
// the surviving label. An operator who types `/clear` into the composer still gets the in-place clear;
// that path is `submitMessage`'s and needs nothing from here.
//
// `sendInterrupt` WITH AN ADDRESS. That helper's command is bare (one Esc, no selector); a restart kills
// claude in ONE conversation, so this one names it — and naming it is the whole safety property below.
import { newSessionCommand, type RendererCommand } from '@shared/ipc/commands'

/**
 * The single effect `sendNewSession` performs, injected so the helper stays pure and deterministic in
 * tests. `sendCommand` is `window.pyry.sendCommand` in the container.
 */
export interface SendNewSessionDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Restart claude in `conversationId`. Guarded send ONLY — no local dispatch, `sendInterrupt`'s posture
 * and for a sharper reason: the daemon answers this frame with nothing at all, not even an error, so
 * there is no optimistic state to post and nothing to retract. The observable effect, when the daemon
 * has a child to rotate, arrives on the pre-existing inbound path as a `session_transition` marker and
 * is drawn by the shipped session delimiter. A bridge failure is swallowed (`console.error`), never
 * propagated — a failed restart must not crash the window — and the error alone is logged: no
 * conversation id, no payload, the sibling helpers' content-free rule.
 *
 * IT SENDS NOTHING RATHER THAN A COMMAND NAMING NO CONVERSATION, and the two refusals are one clause
 * for two different reasons.
 *
 * `null` is `submitMessage`'s precedent and is REACHABLE at the call site: the composer footer renders
 * whether or not a conversation is open, so the menu's `conversationId` prop is `string | null` all the
 * way down from `activeConversation?.id ?? null`.
 *
 * `''` is the one that would ship looking correct. On this verb an empty id is not an unresolvable id:
 * the protocol gives no payload, `{}`, an absent id and an explicitly empty one ONE wire meaning —
 * restart whichever conversation the daemon's process-wide follow-active cursor points at, a cursor
 * every connection shares — so it is some OTHER conversation's claude killed mid-work (the
 * cross-conversation misfire pyrycode#2099 exists to close). `isNewSessionPayload` REMAINS THE
 * LOAD-BEARING REFUSAL at the untrusted renderer→main boundary; this check is defence in depth so the
 * honest client never asks, and it does not make that one redundant. Do not relax either believing the
 * other covers it: a command the boundary guard rejects is dropped in silence — no frame, no event, no
 * error — so both a `?? ''` here and a relaxed clause there compile, typecheck and pass every gate.
 */
export function sendNewSession(conversationId: string | null, deps: SendNewSessionDeps): void {
  if (conversationId === null || conversationId.length === 0) return

  try {
    deps.sendCommand(newSessionCommand({ conversation_id: conversationId }))
  } catch (error) {
    // A send-bridge failure must not crash the window. No local dispatch: there is no optimistic state.
    console.error('new session send failed', error)
  }
}
