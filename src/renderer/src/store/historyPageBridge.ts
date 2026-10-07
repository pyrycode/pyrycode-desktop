// Typed history pages retain rows, contribution evidence and successful paging coverage.
// Opening/reconnect and explicit reader input create demand; failures never retry automatically.
import { useEffect } from 'react'
import { backgroundTaskRosterStore, type HistoryAgentPlacement } from './backgroundTaskRosterStore'
import { connectedConversationHostNow } from '../screens/conversation/conversationActionAvailability'
import { activeConversationStore } from './activeConversationStore'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, HistoryRequestFailure, HistoryTimelineEntry } from '@shared/ipc/events'
import { joinKeyFor, translateTimelineEvent } from './timelineBridge'
import { reduceTimeline, initialTimelineState } from './threadTimeline'
import type { ThreadItem } from './threadTimeline'
import {
  conversationTimelineStore,
  selectLiveJoinKeysFor,
  type ConversationSlice
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
 * page, which leaves the survivors a chronological PREFIX — plus, since #1437, the operator's own messages
 * from inside that run, which fold last and depend on nothing. `reduceHistoryPage` folds them left from
 * `initialTimelineState`, and a prefix folds against exactly the state it would have seen inside the
 * whole page: every entry a survivor could depend on is itself a survivor. Filtering entry-by-entry does
 * NOT have that property, and the two losses it admits are both real —
 *
 *   - AN ORPHANED RESULT. The live lane drew a `tool_use` but lost the `tool_result` during a disconnect
 *     (the bounded `last_event_id` replay tail may expire or be unavailable, leaving the served page
 *     as the repair path). A per-entry filter drops the page's `toolUse` and keeps its `toolResult`;
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
 * one whose key was evicted from the bounded live set, and one whose live fold changed nothing so no key
 * was ever recorded: all of them draw, along with everything older. A duplicated row is a cosmetic fault,
 * a silently dropped one is a lost message, and this is a dedup on entirely remote-supplied input.
 *
 * ⭐ THE OPERATOR'S OWN `message` IS THE ONE ENTRY STEPPED OVER (#1437), kept without ending the run, and
 * it is the exception that made the run rule wrong on its own terms. The emit never stamps
 * `messageReceived` — the daemon writes the operator's message to its log and pushes no `message` frame on
 * the interactive lane — so no live key of that type can EVER exist, and under the plain stop rule a page
 * whose newest entry was the operator's own message stopped the walk at once. In a short chat that page is
 * the whole conversation already on screen, so the reply and its tool rows survived the join and drew a
 * second time at the head, unstamped, above the message they answer. `withoutHeldEchoes` removed the
 * page's copies of the operator's own rows by `message_id` and has no such check for anything else.
 *
 * THE SURVIVORS ARE THEN A PREFIX PLUS INDEPENDENT ROWS, which is the ⭐ safety argument above reproduced
 * for the new shape rather than abandoned. Stepping over an entry inside the run means the survivors are
 * no longer a suffix of the page, so this builds its result as a FILTER rather than a `slice` — and what
 * it keeps is the chronological prefix (the stop entry and everything older) plus the message entries from
 * inside the run, which are chronologically NEWER than the stop and therefore fold LAST. The prefix folds
 * against exactly the state it would have seen inside the whole page, unchanged. The trailing message rows
 * are independent of it in both directions: `translateTimelineEvent` maps a message to a `userText` row,
 * `reduceTimeline`'s `userText` arm is a fresh tail-append that reads no existing item, and no `toolUse`,
 * `toolResult`, `assistantDelta` or `turnEnd` arm reads a `userText` row. The three pieces of state a
 * `userText` fold does touch — `localSendPending`, `stoppingBanner`, `latestTurnEnd` — are scalars, and
 * `reduceHistoryPage` folds against a scratch state and returns only `items`, so none can escape the page.
 * So NEITHER of the two losses named above becomes reachable: an orphaned result needs a dropped
 * `toolUse`, a turn read backwards needs a surviving older delta beneath a dropped newer one, and both
 * need a NON-message entry to be stepped over. None is. The whole type is safe, not just `role: 'user'`:
 * the daemon's only producer of a `message` log entry is the operator-message write, and a
 * `role: 'assistant'` one — the shape a hostile daemon would plant — folds to `null` and draws nothing.
 *
 * THE STEP-OVER IS KEYED ON THE TYPE, NEVER ON "THIS ENTRY COULD NOT BE KEYED", and the broader spelling
 * that looks equivalent is exploitable. A hostile daemon could stamp an over-length `ts` on an
 * `assistantDelta` belonging to a turn whose newer deltas it also serves; an unkeyed-step-over would walk
 * past that older delta, drop the newer ones against their real live keys, and the survivor would fold
 * into a bubble placed ABOVE the live bubble holding the newer text — A TURN READ BACKWARDS, made
 * daemon-triggerable. `event.type` is this client's own discriminant from a closed union that #1227's
 * main-side decode already narrowed; only the `ts` half is remote.
 *
 * NO HELD-ECHO INPUT, DELIBERATELY. The walk learns nothing about `message_id`: `withoutHeldEchoes` in
 * `prependHistoryFor` already decides about operator rows by that id, and one owner for that decision is
 * the point. A message with no held echo — one sent from another client — survives both and draws.
 *
 * `sessionTransition` is NOT stepped over, and since #1559 it needs no reason of its own: it joins like
 * any stamped arm. Until then `timelineTargetFor` returned `null` for it, the fan-out filed the marker
 * into the chat on screen, and `joinKeyToRecord` declined its key, so its entry always ended the run and
 * the page's copy drew a second divider beside the live one. #1559 routes the marker by its own `conversation_id`, so
 * the live key is recorded against the chat the frame named and the page's copy drops here like any
 * other keyed entry. No code in this function ever special-cased the type, so the change needed none.
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
  let inRun = true
  const next: HistoryTimelineEntry[] = []
  for (const entry of entries) {
    if (!inRun) {
      next.push(entry)
      continue
    }
    if (entry.event.type === 'messageReceived') {
      next.push(entry)
      continue
    }
    const key = joinKeyFor(entry.event.type, entry.ts)
    if (key === undefined || seen.get(key) !== 1 || !liveKeys.has(key)) {
      inRun = false
      next.push(entry)
    }
  }
  return next.length === entries.length ? entries : next
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
  liveKeys?: ReadonlySet<string>,
  collectPlacement?: (placement: HistoryAgentPlacement) => void,
  suppressOrdinary = false
): readonly ThreadItem[] {
  let state = initialTimelineState
  const drawable = suppressOrdinary ? [] : liveKeys === undefined ? entries : withoutLiveEntries(entries, liveKeys)
  const admitted = new Set(drawable)
  for (const entry of [...entries].reverse()) {
    if (entry.event.type === 'backgroundTaskStarted' || entry.event.type === 'backgroundTaskUpdated') {
      collectPlacement?.({ event: entry.event, before: state.items.length })
      continue
    }
    if (!admitted.has(entry)) continue
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
    atStart: boolean,
    placements?: readonly HistoryAgentPlacement[],
    servedIds?: readonly number[],
    entries?: readonly HistoryTimelineEntry[]
  ) => void,
  settleFailure: (
    conversationId: string,
    reason: HistoryRequestFailure,
    retryable: boolean
  ) => void,
  getLiveKeys?: (conversationId: string) => ReadonlySet<string>,
  getServedIds?: (conversationId: string) => ReadonlySet<number>,
  retainContributions = false
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'historyPageReceived') {
      const placements: HistoryAgentPlacement[] = []
      const covered = getServedIds?.(event.conversationId)
      const repeated = event.servedIds !== undefined && event.servedIds.length > 0 &&
        covered !== undefined && event.servedIds.every(id => covered.has(id))
      const items = reduceHistoryPage(event.entries, getLiveKeys?.(event.conversationId), placement => placements.push(placement), repeated)
      if (retainContributions) {
        const chronological = [...event.entries].sort((a, b) => a.id - b.id)
        const originalPlacements: HistoryAgentPlacement[] = []
        chronological.forEach((entry, before) => {
          if (entry.event.type === 'backgroundTaskStarted' || entry.event.type === 'backgroundTaskUpdated') {
            originalPlacements.push({ event: entry.event, before })
          }
        })
        applyPage(event.conversationId, items, event.cursor, event.atStart, originalPlacements, event.servedIds, event.entries)
      } else if (event.servedIds !== undefined) applyPage(event.conversationId, items, event.cursor, event.atStart, placements, event.servedIds)
      else if (placements.length === 0) applyPage(event.conversationId, items, event.cursor, event.atStart)
      else applyPage(event.conversationId, items, event.cursor, event.atStart, placements)
      return
    }
    if (event.type === 'historyRequestFailed') {
      settleFailure(event.conversationId, event.reason, event.retryable)
    }
  })
}

/** Read current coverage only when a user asks; pending demand is discarded. */
export interface HistoryAskDeps {
  sendCommand: (command: RendererCommand) => void
  getHeld: (conversationId: string) => Pick<ConversationSlice, 'history' | 'coverage' | 'localRead'> | null
  markRequested: (conversationId: string, cursor?: string, purpose?: 'older' | 'newest') => void
  canRequest?: (conversationId: string) => boolean
}

/**
 * Entries asked for per older-history page (#1752), on every ask including Retry. The daemon clamps a
 * limit above its own ceiling rather than rejecting it (pyrycode `docs/protocol-mobile.md` § Page size),
 * so this is a request, not a promise; a page can still come back shorter.
 */
export const HISTORY_PAGE_LIMIT = 200

export function requestHistoryPage(deps: HistoryAskDeps, conversationId: string, cursor: string,
  purpose: 'older' | 'newest'): void {
  if (deps.canRequest?.(conversationId) === false) return
  const held = deps.getHeld(conversationId)
  if (held?.localRead === 'loading' || held?.history?.status === 'requested') return
  deps.markRequested(conversationId, cursor, purpose)
  deps.sendCommand({ type: 'requestHistory', payload: {
    conversation_id: conversationId, cursor, limit: HISTORY_PAGE_LIMIT
  } })
}

export function requestOlderHistory(
  deps: HistoryAskDeps,
  conversationId: string | null,
  nearTop: boolean
): void {
  if (!nearTop || !conversationId) return
  const held = deps.getHeld(conversationId)
  if (held?.localRead === 'loading' || held?.history?.status === 'requested') return
  const coverage = held?.coverage
  if (coverage?.status === 'received' && coverage.atStart) return
  requestHistoryPage(deps, conversationId, coverage?.status === 'received' ? coverage.cursor : '', 'older')
}

export const historyAskDeps: HistoryAskDeps = {
  sendCommand: (command) => window.pyry.sendCommand(command),
  canRequest: conversationId => activeConversationStore.getState().activeConversation?.id === conversationId &&
    connectedConversationHostNow(conversationId) !== null,
  getHeld: (conversationId) => {
    const host = connectedConversationHostNow(conversationId)
    const held = conversationTimelineStore.getState().timelines.get(conversationId)
    return held?.serverId !== undefined && held.serverId !== host ? null : held ?? null
  },
  markRequested: (conversationId, cursor, purpose) => {
    const host = connectedConversationHostNow(conversationId)
    if (host !== null) conversationTimelineStore.getState().markHistoryRequested(conversationId, host, cursor, purpose)
  }
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
 * Pages come from opening/reconnect demand, explicit upward input, or Retry.
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
        (conversationId, items, cursor, atStart, placements = [], servedIds, entries) => {
          const keys = conversationTimelineStore.getState().prependHistoryFor(conversationId, items, placements.length > 0, entries)
          backgroundTaskRosterStore.getState().recordHistoryPlacements(conversationId, placements.flatMap(placement => {
            const before = keys[placement.before]
            return before === undefined ? [] : [{ ...placement, before }]
          }))
          conversationTimelineStore.getState().recordHistoryPage(conversationId, cursor, atStart, servedIds)
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
          selectLiveJoinKeysFor(conversationId)(conversationTimelineStore.getState()),
        conversationId => {
          const host = window.pyry.chatHistoryReceipt()?.serverId
          const held = conversationTimelineStore.getState().timelines.get(conversationId)
          return new Set(typeof host === 'string' && held?.serverId === host ? held.served?.ids : [])
        },
        true
      ),
    []
  )
}
