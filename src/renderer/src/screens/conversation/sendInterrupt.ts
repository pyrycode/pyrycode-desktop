// The send-interrupt effect — framework-free and React-free, co-located with the screen and mirroring
// sendNewSession.ts / dropQueuedMessage.ts / composerSend.ts: the single effect (the guarded outbound
// command) is injected, so the helper is a pure, deterministic function tested with a plain spy (no
// React, no store, no Electron). The two Stop affordances in `Composer` — the Escape branch of the
// keydown handler (#1072) and the send button's stop variant (#678) — are thin glue over this.
//
// IT NAMES THE CONVERSATION NOW (#1092). The command was BARE from #306 until this ticket, on the
// premise that the daemon mapped it to a single Esc with no conversation selector. It did — into
// whichever conversation its own process-wide follow-active cursor pointed at, a cursor only a routed
// `send_message` stamps and every connection shares. With the sidebar making "switch chats without
// sending" ordinary, that was the last chat ANY client messaged rather than the one on screen, so Stop
// pressed on chat B stopped chat A's turn, or nothing at all. pyrycode#2103 published the optional
// `conversation_id` and this helper always fills it.
//
// `sendNewSession`'s TWIN, down to the refusal below: that helper restarts claude in one conversation,
// this one stops the turn in one conversation, and both take the id the container already holds.
import { interruptCommand, type RendererCommand } from '@shared/ipc/commands'

/**
 * The single effect sendInterrupt performs, injected so the helper stays pure and deterministic in
 * tests. `sendCommand` is `window.pyry.sendCommand` in the container.
 */
export interface SendInterruptDeps {
  sendCommand: (command: RendererCommand) => void
}

/**
 * Stop the running turn in `conversationId`. Guarded send ONLY — no local dispatch: interrupt is not
 * optimistic, so no "stopping" state is posted here; the control retracts when the daemon's next
 * `turn_state{idle}` returns `phase` to idle, which the live store subscription renders. A bridge
 * failure is swallowed (`console.error`), never propagated — a failed interrupt must not crash the
 * window (the dropQueuedMessage / submitMessage posture); the turn simply keeps running and the
 * control stays visible, which is the honest state (the daemon never received the frame). The error
 * alone is logged: no conversation id, no payload, the sibling helpers' content-free rule.
 *
 * IT SENDS NOTHING RATHER THAN A COMMAND NAMING NO CONVERSATION, and the two refusals are one clause
 * for two different reasons — `sendNewSession`'s clause verbatim, for the twin verb.
 *
 * `null` is `submitMessage`'s precedent and is REACHABLE at the call site: the composer footer renders
 * whether or not a conversation is open, so `activeConversationId` is `activeConversation?.id ?? null`
 * all the way down.
 *
 * `''` is the one that would ship looking correct. On this verb an empty id is not an unresolvable id:
 * the protocol gives no payload, `{}`, an absent id and an explicitly empty one ONE wire meaning —
 * stop the turn in whichever conversation the daemon's follow-active cursor points at — so it is
 * exactly the cross-conversation misfire this ticket exists to close, restored by accident.
 * `isInterruptPayload` REMAINS THE LOAD-BEARING REFUSAL at the untrusted renderer→main boundary; this
 * check is defence in depth so the honest client never asks, and it does not make that one redundant.
 * Do not relax either believing the other covers it: a command the boundary guard rejects is dropped
 * in silence — no frame, no event, no error — so both a `?? ''` here and a relaxed clause there
 * compile, typecheck and pass every gate.
 */
export function sendInterrupt(conversationId: string | null, deps: SendInterruptDeps): void {
  if (conversationId === null || conversationId.length === 0) return

  try {
    deps.sendCommand(interruptCommand({ conversation_id: conversationId }))
  } catch (error) {
    // A send-bridge failure must not crash the window. No local dispatch (no optimistic state).
    console.error('interrupt send failed', error)
  }
}
