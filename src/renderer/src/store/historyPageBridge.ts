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
import { joinKeyFor, translateTimelineEvent } from './timelineBridge'
import { reduceTimeline, initialTimelineState } from './threadTimeline'
import type { ThreadItem } from './threadTimeline'
import {
  conversationTimelineStore,
  selectHistoryRequestFor,
  selectLiveJoinKeysFor,
  type HistoryRequestState
} from './conversationTimelineStore'

/**
 * Drop the RUN of entries at the page's newest end that this conversation's LIVE lane has already drawn
 * (#1225), joined on the (`type`, `ts`) key `joinKeyFor` composes. Pure over its two inputs, so the whole
 * join is unit-testable with no store, no DOM and nothing to click.
 *
 * IT RUNS ON ENTRIES, AHEAD OF THE FOLD, because rows carry no `ts` and the fold is not one-to-one — a
 * turn's deltas coalesce into a single bubble, so there is no row to attribute back to an entry once
 * `reduceTimeline` has run. The entry is the only place the key exists.
 *
 * ⭐ THE SUPPRESSED SET IS A CONTIGUOUS RUN, NEVER A SCATTER, AND THAT IS THE WHOLE SAFETY ARGUMENT.
 * `entries` arrives newest-first, so the run this walks off the FRONT is a chronological SUFFIX of the
 * page, which leaves the survivors a chronological PREFIX. `reduceHistoryPage` folds them left from
 * `initialTimelineState`, and a prefix folds against exactly the state it would have seen inside the
 * whole page: every entry a survivor could depend on is itself a survivor. Filtering entry-by-entry does
 * NOT have that property, and the two losses it admits are both real —
 *
 *   - AN ORPHANED RESULT. The live lane drew a `tool_use` but lost the `tool_result` to a reconnect
 *     (this client advertises no `last_event_id`, so a dropped live frame is gone and the served page is
 *     the only repair path). A per-entry filter drops the page's `toolUse` and keeps its `toolResult`;
 *     `fillResult` then finds no row carrying that `toolUseId` and DISCARDS the result, while the live
 *     row stays pending forever — `prependHistoryFor` reconciles nothing across the lanes.
 *   - A TURN READ BACKWARDS. The live lane drew a turn's older deltas but not its newer ones. A per-entry
 *     filter drops the older, and the surviving newer fold into a bubble `prependHistoryFor` places
 *     ABOVE the live bubble holding the older text.
 *
 * Both are content LOST or CORRUPTED, the one direction this join refuses. The run rule costs coverage
 * instead: an overlap that is a GAP in the page rather than its newest run suppresses nothing, so those
 * entries draw twice — which is precisely what they did before this ticket. THE STRONGEST STATEMENT
 * AVAILABLE ABOUT THIS FUNCTION IS THEREFORE THAT ITS OUTPUT IS EITHER THE JOINED PAGE OR THE UNJOINED
 * ONE: it can only remove duplicates, never introduce a loss or a reordering the un-joined page did not
 * already have.
 *
 * ⭐ AN AMBIGUOUS KEY SUPPRESSES NOTHING (AC4). An entry is dropped only when its key occurs EXACTLY ONCE
 * among this page's entries: the daemon mints one timestamp per logical event, so two entries sharing a
 * key are two entries this client cannot tell apart, and a comparison that cannot separate them must
 * draw both rather than guess which one the live row was. Here it also ENDS the run, which is the same
 * posture every other stop takes — an entry whose `ts` will not key (`joinKeyFor` returns `undefined`),
 * one whose key was evicted from the bounded live set, one whose live fold changed nothing so no key was
 * ever recorded, and the operator's own `message`, which the emit never stamps: all of them draw, along
 * with everything older. A duplicated row is a cosmetic fault, a silently dropped one is a lost message,
 * and this is a dedup on entirely remote-supplied input.
 *
 * IT DROPS ON THE PAGE SIDE, NEVER THE LIVE SIDE, and that is AC3 rather than an implementation
 * convenience: the live row stays exactly where the live stream put it, and the page's copy — which
 * `prependHistoryFor` would otherwise put at the HEAD, above rows that came before it — never becomes a
 * row at all. Suppressing the live row instead would move the message.
 *
 * The counting pass is bounded by the page, which arrived inside one `MAX_PLAINTEXT_BYTES` frame, so no
 * daemon-chosen number sizes an allocation here. Returns the SAME array reference when nothing was
 * dropped — `withoutHeldEchoes`' no-churn idiom — so an unchanged page reduces to the identical rows.
 */
export function withoutLiveEntries(
  entries: readonly HistoryTimelineEntry[],
  liveKeys: ReadonlySet<string>
): readonly HistoryTimelineEntry[] {
  if (liveKeys.size === 0) return entries
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const key = joinKeyFor(entry.event.type, entry.ts)
    if (key !== undefined) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  let drawn = 0
  for (const entry of entries) {
    const key = joinKeyFor(entry.event.type, entry.ts)
    if (key === undefined || seen.get(key) !== 1 || !liveKeys.has(key)) break
    drawn += 1
  }
  return drawn === 0 ? entries : entries.slice(drawn)
}

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
 * row is dated with the moment it was drawn and the same page reduced an hour later is identical.
 *
 * #1225 IS THE SEPARATE CHANGE this paragraph used to defer, and it changed nothing about the clock. A
 * typed daemon event now DOES carry the wire timestamp (`daemonTs`), but only as the live half of the
 * join key `withoutLiveEntries` reads above — it is a comparand, never a creation stamp, so replayed
 * rows still carry no `createdAt` and `now` is still the only thing that mints one.
 *
 * `liveKeys` IS OPTIONAL AND TRAILING, `subscribeTimeline`'s `now` arithmetic applied a third time: a
 * required parameter cascades over every existing call site, an optional one over none. Absent means
 * nothing is suppressed, which is both the pre-#1225 behaviour and the fail-open default the whole join
 * is built around.
 *
 * Total over its input: an entry the translator does not own folds to nothing, so an empty page and a
 * page of undrawn entries both yield `[]` and neither is an error. Nothing is parsed here — #1227
 * decoded the payloads main-side and fail-closed — and no prompt can arrive to be re-raised, because
 * that decode has no arm for `modal_shown` or `question_shown`.
 */
export function reduceHistoryPage(
  entries: readonly HistoryTimelineEntry[],
  liveKeys?: ReadonlySet<string>
): readonly ThreadItem[] {
  let state = initialTimelineState
  const drawable = liveKeys === undefined ? entries : withoutLiveEntries(entries, liveKeys)
  for (const entry of [...drawable].reverse()) {
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
  ) => void,
  getLiveKeys?: (conversationId: string) => ReadonlySet<string>
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'historyPageReceived') {
      applyPage(
        event.conversationId,
        reduceHistoryPage(event.entries, getLiveKeys?.(event.conversationId)),
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
 * The effects the two askers below perform, injected so the decision is a pure, deterministic
 * function tested with plain spies — which it has to be, because `vitest.config.ts` is
 * `environment: 'node'`, no renderer spec in this repo runs an effect, and the activation seam's own
 * wiring is therefore structurally uncoverable.
 *
 * `getHeld` is a GETTER called per invocation, never a value threaded in by the caller: the production
 * deps object below is module-scope and app-lifetime, so a reading captured once would freeze at
 * whatever the store held when the module loaded.
 */
export interface HistoryAskDeps {
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
  deps: HistoryAskDeps,
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
/**
 * Ask for the page BEFORE a conversation's oldest loaded entry — the scroll-back walk (#1260).
 *
 * `nearTop` is a PARAMETER, not a measurement taken here, and that is the split this module depends on.
 * The geometry is `threadScrollPosition`'s `isNearTop`, a pure function of three numbers; the readings
 * are this one. Taking the boolean is what lets a plain vitest spy exercise every reading against both
 * positions with no DOM — and it leaves the scroll handler with no branch of its own, which is the shape
 * `onScroll`'s own docblock asks for.
 *
 * FOUR READINGS, THREE OF WHICH DECLINE, and the one that asks is the narrowest. `requested` means an ask
 * is already on the wire — that is what holds this to ONE ask in flight while a reader parked in the band
 * fires the handler at frame rate, and what keeps the deliberately non-idempotent `prependHistoryFor`
 * from applying one page twice. `failed` is terminal: nothing branches on `reason` and nothing reads
 * `retryable`, so there is no timer, no backoff and no automatic re-ask anywhere in this family. `null` —
 * nothing held, because the slice was evicted or never opened — belongs to `requestOpeningHistory`
 * instead: a walk never restarts itself mid-screen from an empty cursor.
 *
 * ⭐ `atStart` IS THE ONLY STOP. A page that fills exactly at the log's first entry reports `at_start`
 * false with a usable cursor, and the daemon re-asks its own log at a smaller size rather than truncating
 * to fit the envelope cap — so an EMPTY page and a SHORT page each leave the walk running. Nothing here
 * counts entries or compares a page against the limit it asked with, which is what makes "a short page is
 * not an end-of-log signal" structural rather than remembered.
 *
 * THE CURSOR IS ECHOED VERBATIM: read off the held reading, placed in the payload, and touched by nothing
 * in between. It is not parsed, split, compared, derived from, reused across conversations or logged, and
 * it never becomes a key, a path or a React key. The daemon merges its cursor failure causes into one
 * indistinguishable answer on purpose, so there is deliberately no attempt to tell them apart; the repair
 * for all of them is a fresh walk from an empty cursor, which is the next opening's job.
 *
 * Mark before send, the falsy-id guard before the store read, and a fresh three-key literal rather than a
 * spread — all three carried from `requestOpeningHistory` above, for the reasons its docblock gives.
 */
export function requestOlderHistory(
  deps: HistoryAskDeps,
  conversationId: string | null,
  nearTop: boolean
): void {
  if (!nearTop) return
  if (!conversationId) return
  const held = deps.getHeld(conversationId)
  if (held === null || held.status !== 'loaded' || held.atStart) return
  deps.markRequested(conversationId)
  deps.sendCommand({
    type: 'requestHistory',
    payload: { conversation_id: conversationId, cursor: held.cursor, limit: 0 }
  })
}

export const historyAskDeps: HistoryAskDeps = {
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
        },
        // #1225 — the live keys for the page's OWN conversation, read afresh per page (the bridge
        // idiom) rather than snapshotted at subscribe time: one app-lifetime listener outlives any
        // number of chat switches, and a captured reading would join every later page against whatever
        // the store held when this effect ran.
        (conversationId) =>
          selectLiveJoinKeysFor(conversationId)(conversationTimelineStore.getState())
      ),
    []
  )
}
