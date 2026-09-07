// The drawing half of conversation history (#1223): one served page of decoded entries in, timeline
// ROWS out, prepended onto the conversation's held slice. #1222 built the ask, the correlation and the
// page transport; #1227 turned each stored `{type, payload}` entry into a typed `HistoryTimelineEvent`.
// This module is where a page becomes something the operator sees.
//
// #1259 MADE IT THE WHOLE OPENING ROUND TRIP: the ask goes out from here too, and BOTH arms are now
// claimed. #1224 was split after this header was written, and its two successors are #1259 — the
// opening ask, the failure arm, and the per-conversation state that stops a second ask — and #1260, the
// scroll-back walk that consumes the `cursor` and `atStart` this module records but does not read.
//
// A FIFTH INDEPENDENT SUBSCRIBER on the daemon-event channel, beside the session, timeline, modal and
// question bridges — not a widening of `subscribeTimeline`'s injected dispatch, which would cascade
// over its 20 existing call sites to buy nothing (the arithmetic that function's own docblock records).
// It owns exactly the `historyPageReceived` and `historyRequestFailed` arms, which is why
// `translateTimelineEvent`'s cases for them stay `null` and needed no edit.
//
// WHY THE FAILURE ARM COULD NOT WAIT FOR THE WALK, which is what the pre-split header assumed. An ask
// that neither draws a page nor settles leaves its conversation permanently asking, so the arm belongs
// to whichever ticket first sends a request — this one. All six refusals settle IDENTICALLY here: the
// conversation stops asking and nothing is drawn. There is no banner, no unrecognized row, no timer and
// no automatic re-ask; `history.unavailable`'s `retryable` flag is recorded for #1260 and read nowhere.
//
// Nothing here touches keys, sockets, ipcRenderer or raw frames — it subscribes through the preload
// bridge, writes typed rows, and hands one three-scalar payload to `sendCommand`.
import { useEffect } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, HistoryRequestFailure, HistoryTimelineEntry } from '@shared/ipc/events'
import { translateTimelineEvent } from './timelineBridge'
import { reduceTimeline, initialTimelineState } from './threadTimeline'
import type { ThreadItem } from './threadTimeline'
import {
  conversationTimelineStore,
  selectHistoryRequestFor,
  type HistoryRequestState
} from './conversationTimelineStore'

/**
 * Fold one served page into the rows it draws (#1223) — a pure function of the page, so it stays
 * unit-testable under `environment: 'node'` with no DOM and nothing to click.
 *
 * OLDEST-FIRST, FROM A NEWEST-FIRST PAGE. The wire serves `entries` newest-first (protocol-mobile.md
 * § Conversation history), and every arm of `reduceTimeline` appends, so a page folded in the order it
 * arrives produces the right rows in exactly the wrong order — a failure that draws a complete-looking
 * transcript and is caught by nothing but an assertion on order. The reversal runs on a COPY: reversing
 * in place would silently re-order an array the caller still holds.
 *
 * ROWS ONLY, AND THAT IS AC3 — the whole of it, for all five scalars at once. The fold runs against a
 * SCRATCH state seeded from `initialTimelineState` and returns only its `items`, so `phase`, `stalled`,
 * `apiRetry`, `compacting` and `localSendPending` are structurally unable to escape it, whatever a
 * stored `turn_state`, `stall`, `api_retry` or `compacting` entry among the page's rows says. This is
 * the third answer to the question `threadTimeline.ts`'s `userText` arm poses — it asks whether a
 * history backfill needs a distinct event or a flag on the arm, and the answer is NEITHER: the page
 * never reaches the held state's reducer at all, so that arm's `localSendPending: true` lands in a
 * state that is thrown away. A flag would have needed one clause per scalar and left the next one to be
 * remembered; `reduceTimeline` is untouched by this ticket, which is the strongest available statement
 * that a page produces the rows the live stream would have.
 *
 * NO CLOCK IS PASSED, and that is AC5: `translateTimelineEvent` reads its optional `now` on the
 * `assistantDelta` arm and its stated contract is that an absent clock means no stamp, so no replayed
 * row is dated with the moment it was drawn and the same page reduced an hour later is identical. An
 * entry's own `ts` is the daemon's real timestamp, but no typed event in this app carries a wire
 * timestamp and wiring one is a separate change — history rows carrying no creation stamp is the
 * correct outcome here, not a workaround.
 *
 * Total over its input: an entry the translator does not own folds to nothing, so an empty page and a
 * page of undrawn entries both yield `[]` and neither is an error. Nothing is parsed here — #1227
 * decoded the payloads main-side and fail-closed — and no prompt can arrive to be re-raised, because
 * that decode has no arm for `modal_shown` or `question_shown`.
 */
export function reduceHistoryPage(entries: readonly HistoryTimelineEntry[]): readonly ThreadItem[] {
  let state = initialTimelineState
  for (const entry of [...entries].reverse()) {
    const event = translateTimelineEvent(entry.event)
    if (event) state = reduceTimeline(state, event)
  }
  return state.items
}

/**
 * Subscribe via the injected `onDaemonEvent`; every `historyPageReceived` reduces to rows and is handed
 * to `applyPage` under the id the event carries, every other arm no-ops. Returns the exact unsubscribe
 * handle from `onDaemonEvent` (the `subscribeTimeline` idiom) so the React binding can use it as its
 * effect cleanup. Injecting both callbacks keeps it React-free and unit-testable with plain spies.
 *
 * `event.conversationId` is REQUIRED and CLIENT-OWNED — the id this app put in its own outbound
 * `request_history`, held in main-process memory and handed back by #1222's correlation, never a string
 * parsed out of an inbound payload. So it is used as-is and there is no `?? openConversation` anywhere:
 * that fallback is the misattribution the required field exists to prevent, and a page that cannot be
 * placed is dropped rather than guessed at. Nothing else off the event is read — `cursor` and `atStart`
 * drive the walk (#1224), not the drawing.
 *
 * An EMPTY page is forwarded rather than filtered. The store owns the no-op, and a subscriber that
 * swallowed it here would hide "a page arrived and drew nothing" from a consumer that needs the fact —
 * which since #1259 is exactly how a conversation predating the log SETTLES rather than staying
 * permanently in flight.
 *
 * TWO CALLBACKS, TWO ARMS (#1259). `applyPage` carries the page's `cursor` and `atStart` alongside its
 * rows; `settleFailure` carries the refusal's `reason` and `retryable`. Both are copied off the event
 * and NEITHER is interpreted here: nothing parses the cursor, nothing branches on the reason, and
 * nothing re-derives retryability from the reason — that flag is computed at the single emit precisely
 * so a walk driver cannot get it wrong into a retry loop against a relay that is merely withholding a
 * frame.
 *
 * A CROSS-WIRE SWAP OF THE TWO IS A COMPILE ERROR, and that is worth stating because the pair is the
 * exact shape `subscribeSystemPrompt`'s docblock warns about. Under `strictFunctionTypes` the second
 * parameter slots are checked contravariantly and `readonly ThreadItem[]` and `HistoryRequestFailure`
 * are mutually unassignable, so neither direction compiles. Re-run that check before adding a third
 * callback — the property is about this pair, not about either slot alone.
 */
export function subscribeHistoryPage(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  applyPage: (
    conversationId: string,
    items: readonly ThreadItem[],
    cursor: string,
    atStart: boolean
  ) => void,
  settleFailure: (
    conversationId: string,
    reason: HistoryRequestFailure,
    retryable: boolean
  ) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'historyPageReceived') {
      applyPage(
        event.conversationId,
        reduceHistoryPage(event.entries),
        event.cursor,
        event.atStart
      )
      return
    }
    if (event.type === 'historyRequestFailed') {
      settleFailure(event.conversationId, event.reason, event.retryable)
    }
  })
}

/**
 * The effects `requestOpeningHistory` performs, injected so the decision is a pure, deterministic
 * function tested with plain spies — which it has to be, because `vitest.config.ts` is
 * `environment: 'node'`, no renderer spec in this repo runs an effect, and the activation seam's own
 * wiring is therefore structurally uncoverable.
 *
 * `getHeld` is a GETTER called per invocation, never a value threaded in by the caller: the production
 * deps object below is module-scope and app-lifetime, so a reading captured once would freeze at
 * whatever the store held when the module loaded.
 */
export interface OpeningHistoryDeps {
  sendCommand: (command: RendererCommand) => void
  getHeld: (conversationId: string) => HistoryRequestState | null
  markRequested: (conversationId: string) => void
}

/**
 * Ask for a conversation's NEWEST page of history, exactly once per opening (#1259).
 *
 * ONE ASK PER OPENING IS THIS FUNCTION'S JOB, NOT THE SEAM'S, and that is the one place this diverges
 * from its `requestSystemPrompt` / `requestModelList` / `requestRunConfigSnapshot` neighbours.
 * `requestConversationConfig` fires on EVERY activation including a re-click of the row already open,
 * and all three neighbours are whole-value replaces for which a duplicate costs nothing. A duplicate
 * page does not replace anything — it PREPENDS its rows a second time (`prependHistoryFor` is
 * documented as deliberately non-idempotent, since only `userText` rows carry a key to dedup on), so
 * the gate has to live here, where a spy can reach it.
 *
 * THE GATE IS "NOTHING IS HELD", and every terminal reading is non-null, which is what makes a retry
 * loop structurally unreachable rather than merely absent. `requested` means an ask is already on the
 * wire; `loaded` means the page is drawn (AC2); `failed` means the daemon refused and the conversation
 * stops asking (AC4) — including for `history-unavailable`, whose `retryable` flag is recorded and not
 * acted on. The one reading that asks is `null`, which an EVICTED slice produces exactly as a
 * never-opened one does, and that is AC3: re-opening a conversation whose timeline was evicted refills
 * it from history instead of starting empty.
 *
 * MARK BEFORE SEND. The invariant that matters is "never ask twice", so the mark must be in place
 * before anything can re-enter; a mark left standing over a send that threw costs that one conversation
 * its backfill until the next eviction, where a double ask duplicates rows the operator can see. Both
 * calls are synchronous with no `await` between the read and the write, so on the renderer's single
 * thread there is no gap for a concurrent handler to interleave into.
 *
 * The falsy-id guard is `requestSystemPrompt`'s verbatim and for the same reason: an unaddressable id
 * must not reach the wire, and `''` is the same failure spelled differently rather than a second case.
 * It returns BEFORE consulting the store, so an unusable id cannot mint or read a reading either.
 *
 * A FRESH THREE-KEY LITERAL, never a spread — the bound `buildRequestHistory` keeps on the wire side,
 * held here too so nothing can widen the payload from the renderer. `cursor: ''` is the published
 * OPENING position of a walk, not a missing value; `limit: 0` is the published "you choose", which
 * `buildRequestHistory` normalises any non-positive ask to anyway. The id is a client-held conversation
 * id used as a payload VALUE only — never a key, a path, a filename, a cache lookup or a log field, and
 * nothing on this branch logs at all. Fire-and-forget: `sendCommand` is `void`, so there is no promise,
 * no timer and nothing to cancel.
 */
export function requestOpeningHistory(
  deps: OpeningHistoryDeps,
  conversationId: string | null
): void {
  if (!conversationId) return
  if (deps.getHeld(conversationId) !== null) return
  deps.markRequested(conversationId)
  deps.sendCommand({
    type: 'requestHistory',
    payload: { conversation_id: conversationId, cursor: '', limit: 0 }
  })
}

/**
 * The production wiring — module scope, the `conversationLastReadDeps` shape, so `PairedShell` gains
 * ONE line inside `requestConversationConfig` rather than a fourth `getState()` arrow with a branch in
 * it. Every member reaches its singleton inside the arrow BODY, so nothing is dereferenced at module
 * load and `window.pyry` is never touched during render.
 */
export const openingHistoryDeps: OpeningHistoryDeps = {
  sendCommand: (command) => window.pyry.sendCommand(command),
  getHeld: (conversationId) =>
    selectHistoryRequestFor(conversationId)(conversationTimelineStore.getState()),
  markRequested: (conversationId) =>
    conversationTimelineStore.getState().markHistoryRequested(conversationId)
}

/**
 * Wire the daemon-event channel into the keyed timeline holder for the lifetime of the mounting
 * component (`App` mounts it beside the other bridges). Subscribes on mount and returns the off handle
 * as the effect cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets exactly one
 * live listener — mirroring `useTimelineBridge`. `window.pyry` is dereferenced only inside the effect,
 * never during render, and the dependency array is empty because nothing this hook closes over changes.
 *
 * Writes the KEYED holder only, unlike `useTimelineBridge`'s fan-out: the flat `timelineStore` has no
 * per-conversation key, so a page — which always names one — has nowhere correct to land in it, and no
 * screen reads that store's `items` anyway.
 *
 * SINCE #1259 IT HAS A PRODUCER: `requestOpeningHistory`, fired from the conversation-activation path
 * in `PairedShell`. The header's old "live and idle" posture is gone.
 *
 * DRAW FIRST, THEN SETTLE, and the order is load-bearing rather than stylistic. `prependHistoryFor`'s
 * absent-key branch CREATES the slice, and all three of the store's request-state paths are absent-key
 * no-ops, so a page for a conversation whose slice was evicted mid-flight lands its rows and then finds
 * a key to record against. Reversed, the record would no-op and the conversation would re-ask on its
 * next opening for a page it has already drawn. Two writes rather than one store method: they are two
 * independent operations on two halves of a slice, React batches them into one commit, and folding
 * them together would have meant rewriting #1223's `prependHistoryFor` contract for no gain.
 *
 * `getState()` is called afresh per write — the bridge idiom — rather than a snapshot reused across
 * both, so neither call can read a stale action set.
 */
export function useHistoryPageBridge(): void {
  useEffect(
    () =>
      subscribeHistoryPage(
        window.pyry.onDaemonEvent,
        (conversationId, items, cursor, atStart) => {
          conversationTimelineStore.getState().prependHistoryFor(conversationId, items)
          conversationTimelineStore.getState().recordHistoryPage(conversationId, cursor, atStart)
        },
        (conversationId, reason, retryable) => {
          conversationTimelineStore
            .getState()
            .recordHistoryFailure(conversationId, reason, retryable)
        }
      ),
    []
  )
}
