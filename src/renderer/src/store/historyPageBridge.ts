// The drawing half of conversation history (#1223): one served page of decoded entries in, timeline
// ROWS out, prepended onto the conversation's held slice. #1222 built the ask, the correlation and the
// page transport; #1227 turned each stored `{type, payload}` entry into a typed `HistoryTimelineEvent`.
// This module is where a page becomes something the operator sees.
//
// A FIFTH INDEPENDENT SUBSCRIBER on the daemon-event channel, beside the session, timeline, modal and
// question bridges — not a widening of `subscribeTimeline`'s injected dispatch, which would cascade
// over its 20 existing call sites to buy nothing (the arithmetic that function's own docblock records).
// It owns exactly the `historyPageReceived` arm, which is why `translateTimelineEvent`'s case for it
// stays `null` and needed no edit. `historyRequestFailed` is deliberately NOT claimed here: a refusal
// drives the walk, and the walk is #1224's.
//
// Nothing here touches keys, sockets, ipcRenderer or raw frames — it subscribes through the preload
// bridge and writes typed rows, like every other bridge in this directory.
import { useEffect } from 'react'
import type { DaemonEvent, HistoryTimelineEntry } from '@shared/ipc/events'
import { translateTimelineEvent } from './timelineBridge'
import { reduceTimeline, initialTimelineState } from './threadTimeline'
import type { ThreadItem } from './threadTimeline'
import { conversationTimelineStore } from './conversationTimelineStore'

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
 * swallowed it here would hide "a page arrived and drew nothing" from a consumer that needs the fact.
 */
export function subscribeHistoryPage(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  applyPage: (conversationId: string, items: readonly ThreadItem[]) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type !== 'historyPageReceived') return
    applyPage(event.conversationId, reduceHistoryPage(event.entries))
  })
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
 * Ships with no producer: nothing asks for a page until #1224 walks one, so this listener is live and
 * idle in production today. That is the same posture every bridge in this directory shipped in.
 */
export function useHistoryPageBridge(): void {
  useEffect(
    () =>
      subscribeHistoryPage(window.pyry.onDaemonEvent, (conversationId, items) => {
        conversationTimelineStore.getState().prependHistoryFor(conversationId, items)
      }),
    []
  )
}
