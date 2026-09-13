# Conversation timeline store — internals

The store itself, the translator and React binding that feed it from the daemon event stream, and the flow between them.

Part of [Conversation timeline store](conversation-timeline-store.md); see that document for what the package does, its edge cases and its links.

# How it works

## The store (`src/renderer/src/store/timelineStore.ts`)

```ts
export type TimelineStore = TimelineState & { dispatch: (event: ThreadEvent) => void }

createTimelineStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
timelineStore                 // app-wide singleton
useTimelineStore(selector)    // narrow-slice React binding: useStore(timelineStore, selector)
export { selectItems, selectPhase, selectStalled, selectApiRetry, selectCompacting, selectLocalSendPending } from './threadTimeline'   // re-exported, never redefined
```

Mirrors `createSessionStore`'s DI-factory → singleton → hook → selectors structure (ADR 0004), but
wraps a real reducer + `dispatch` — `set((s) => reduceTimeline(s, event))` — rather than
`runConfigStore`'s single setter, because `ThreadEvent` is a real five-member union to reduce, not a
"latest value wins" replace. No `observe?` param: the #134 diagnostics seam is session-only, and a
speculative observer here would defend an unobserved need.

## The translator + binding (`src/renderer/src/store/timelineBridge.ts`)

```ts
translateTimelineEvent(event: DaemonEvent | HistoryTimelineEvent): ThreadEvent | null
// Owns exactly assistantDelta / turnEnd / turnState / toolUse / toolResult (#229) / stallDetected
// (#317) / apiRetry (#493) / compacting / compactionBoundary / connected->reconnected (#538) / messageReceived->
// userText (#1223) / thinkingProgress (#1314), each rebuilt as a fresh named-field literal (never `return event`, never a spread
// — for stallDetected and connected->reconnected, both sides are nullary, so the "literal" is
// arm-selection only; apiRetry and compacting carry data, so each is a filter-and-copy like
// toolUse/toolResult — apiRetry's DaemonEvent side also carries conversationId since #737, which the
// bridge drops; compacting's DaemonEvent side carries it too, since #742, likewise dropped here). Every
// other arm -> null via explicit fall-through, then default: assertNever(event) — a HARD guard, not a
// soft catch-all default.
//
// #1223 WIDENS THE PARAMETER, not the switch's case count over DaemonEvent alone: every
// HistoryTimelineEvent arm is its live twin minus the conversationId no case reads, so every existing
// case body is unchanged and total. messageReceived is the one case gated on more than `event.type`:
// case 'messageReceived': return event.message.role === 'user'
//   ? { type: 'userText', text: event.message.text, messageId: event.message.message_id } : null
// role: 'assistant' -> null, always — a stored assistant message is not a user row, and assistant
// content already reaches the timeline via assistantDelta. No createdAt (the clock is read only on
// assistantDelta, and a page reduces with no clock at all — historyPageBridge.ts, below); no
// attachments (MessagePayload carries none). timelineTargetFor is deliberately NOT widened for this
// arm — a live messageReceived (this daemon sends none) still resolves to no keyed target and reaches
// the flat timelineStore only, whose items no screen reads.

timelineTargetFor(event: DaemonEvent): string | null   // #756
// switch (event.type) { case 'assistantDelta': ... case 'unrecognizedMessage': case 'thinkingProgress':
//   return event.conversationId
//   case 'sessionTransition': case 'connected': return null
//   default: return null }
// The ten id-carrying owned arms (#784 moved `unrecognizedMessage` into this group, #1314 moved
// `thinkingProgress` in beside it) share one `return event.conversationId` (non-nullable: a missing or
// non-string conversation_id already fails the decode without emitting) — #1314's arm resolves from this
// group with no cast and no probe, since the field is required on it, and it routes by the frame's own
// conversation rather than through `timelineWriteTarget`'s open-conversation fallback. The two id-less
// owned arms — `sessionTransition` and `connected`, and
// neither will ever gain a wire conversation id — share one `return null`: not dormant, just nothing to
// attribute. `default` is unreachable in production: subscribeTimeline only calls this on
// translateTimelineEvent's non-null path. Unchanged in signature, body, and both design-oracle tests
// since #756 — #785 resolves the open-conversation fallback downstream, in `timelineWriteTarget`, never
// here.

timelineWriteTarget(event: ThreadEvent, conversationId: string | null, getOpenConversationId): string | null   // #785
// if (conversationId !== null) return conversationId                       // the event's own attribution always wins
// switch (event.type) {
//   case 'sessionBoundary': case 'reconnected': return getOpenConversationId()  // the two arms with no key of their own
//   default: return null                                                   // enumerated fallback, never a blanket `??`
// }
// The write-key half of the routing contract, a second pure function beside `timelineTargetFor`:
// that one answers "what did the event say", this one answers "where does the fan-out write it".
// `getOpenConversationId` is a GETTER — read at dispatch time, not captured at subscribe time, since one
// app-lifetime listener outlives any number of chat switches. Called AT MOST ONCE per event and never
// for an id-carrying arm, pinned by a spy assertion — the strongest available statement of
// "no misattribution". A future wire widening of `sessionTransition` is safe with no edit here: step 1
// (the event's own id) is checked first, so it would win over the switch rather than being overridden by it.

subscribeTimeline(onDaemonEvent, dispatch): () => void
// onDaemonEvent(event => { const te = translateTimelineEvent(event); if (te) dispatch(te, timelineTargetFor(event)) })
// dispatch: (event: ThreadEvent, conversationId: string | null) => void   — widened by ARITY (#756),
// not a new parameter, so all 20+ existing call sites kept compiling and running unedited. Byte-identical
// since #756 — #785's resolution lives one layer up, inside the injected `dispatch` callback.
// returns the exact off handle (the subscribeRunConfig idiom) — pure, spy-testable, no React, no store
// import, no fan-out of its own.

useTimelineBridge(getOpenConversationId: () => string | null): void   // parameter added #785
// useEffect(() => subscribeTimeline(window.pyry.onDaemonEvent, (e, conversationId) => {
//   timelineStore.getState().dispatch(e)                                            // flat, unconditional, first
//   const target = timelineWriteTarget(e, conversationId, getOpenConversationId)     // #785
//   if (target !== null) conversationTimelineStore.getState().dispatchFor(target, e) // keyed, guarded on the RESOLVED target
// }), [getOpenConversationId])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener. Flat-first is not
// cosmetic — it is what keeps the flat store's AC4 guarantee true even if the keyed write were to throw.
// The dependency array names `getOpenConversationId` rather than staying `[]` (honest about the one new
// dependency) — the caller (`App.tsx`) supplies a module-level constant, so this still nets one subscribe
// for the app's lifetime; an inline arrow at the call site would resubscribe every render.
```

This is the deliberate mirror image of [`daemonEventBridge`](daemon-event-bridge.md): that bridge's
`assertNever`-guarded switch returns `null` for these same six arms and owns the rest; this bridge
owns exactly these six and returns `null` for the rest — and, since [#223](../codebase/223.md), a
**third** independent exhaustive switch, [modal store + bridge](modal-store-bridge.md)'s `modalBridge.ts`,
returns `null` for them too. Three independent subscribers on the same `window.pyry.onDaemonEvent`
channel, each with its own hard exhaustiveness guard — so a future `DaemonEvent` member is a compile
error in *all three* files until each decides its mapping. [#214](../codebase/214.md) was the first
ticket to pay that doubled cost: adding `turnState` forced a new case in both this file and
`daemonEventBridge.ts` at once. [#217](../codebase/217.md) paid it a second time for `toolUse`.
[#229](../codebase/229.md) paid the now-**tripled** cost for `toolResult` — `modalBridge.ts` existed by
then, so the touchpoint floor for any new arm is 3 bridges, not 2 (see [#229 codebase
notes](../codebase/229.md) § Lessons learned).

Both `assistantDelta` and `turnEnd` were field-for-field identical between `DaemonEvent` and
`ThreadEvent` at ship time (`turnId`/`seq`/`text`, `turnId`/`stopReason`) — arm selection plus a
fresh copy, no field mapping. [#751](../codebase/751.md) widened `DaemonEvent.assistantDelta` with
`conversationId`, and [#752](../codebase/752.md) did the same for `DaemonEvent.turnEnd` next, the
same routing-key widening the four status arms below already had; both bridge cases are now
filters (drop the id), and `ThreadEvent.assistantDelta`/`ThreadEvent.turnEnd` are the sides that
stay three-field and two-field respectively. `turnState` is the same shape of
filter-not-rename: `event.state` (`WireTurnState`) assigns to the `ThreadEvent` arm's `state`
(`TurnPhase`) with no cast, because the two are the same literal union declared on either side of the
shared/renderer boundary (see [#214](../codebase/214.md)). `toolUse` ([#217](../codebase/217.md)) and
`toolResult` ([#229](../codebase/229.md)) were, at ship time, likewise pure filter-and-copy —
`DaemonEvent.toolUse`/`toolResult` and their `ThreadEvent` counterparts field-for-field identical, a
deliberate lockstep design from ADR 0008. [#763](../codebase/763.md) widened `DaemonEvent.toolUse` with
`conversationId`, the same routing-key widening `assistantDelta`/`turnEnd` got from #751/#752 above; the
bridge case is now a filter (drops the id), and `ThreadEvent.toolUse` is the side that stays five-field.
[#766](../codebase/766.md) later widened `DaemonEvent.toolResult` the same way, completing the #675
family (all eight arms now carry `conversationId`) — its bridge case is now a filter too, and
`ThreadEvent.toolResult` is the side that stays four-field. `toolUse` is the first owned arm whose `ThreadEvent` counterpart `reduceTimeline`
folds into an **appended `ThreadItem`** (a `toolCall`) rather than a text delta or a scalar; `toolResult`
is the first to **resolve** one already appended — `reduceTimeline`'s `fillResult` (#121) correlates it to
the pending `toolCall` by `toolUseId` and fills `result` in place, a same-reference no-op on an orphan or
duplicate. `stallDetected` ([#317](../codebase/317.md)) was, at ship time, the first arm where **both** sides of
the mapping were nullary — `DaemonEvent.stallDetected` and `ThreadEvent.stallDetected` both
`{ type: 'stallDetected' }`, so the case was pure arm-selection with no field to filter or copy.
[#732](../codebase/732.md) widened `DaemonEvent.stallDetected` with `conversationId`; the bridge case
is now a filter (drops the id), and `ThreadEvent.stallDetected` is the only side still nullary.
`apiRetry` ([#493](../codebase/493.md)) returned to the filter-and-copy shape at ship time —
`DaemonEvent.apiRetry` and `ThreadEvent.apiRetry` were field-for-field identical (`active`/`current`/
`total`) — and is the first status-liveness arm (after `stallDetected`) whose `reduceTimeline` handling
translates an **edge into a presence**: the event always carries `active`, but the state holds
`ApiRetryStatus | null`, collapsing the wire's rising/falling edges into one representation with no
field left over to leak a stale counter. [#737](../codebase/737.md) later widened `DaemonEvent.apiRetry`
with `conversationId`, the same routing-key widening `stallDetected` got from #732 above; the bridge
case is now a filter, not a plain copy, and `ThreadEvent.apiRetry` is the side that stays four-field.
`compacting` copies `active`, `compactResult` and `compactError`; `compactionBoundary`
copies `trigger`, `preTokens` and `postTokens`. Both omit the conversation id from the
`ThreadEvent`; live routing uses the original event's id. The reducer owns edge detection,
failure classification and [delayed metadata association](conversation-timeline-store.md#what-it-does);
the bridge neither synthesizes completion on reconnect nor correlates by row index.

`thinkingProgress` ([#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313), decoded at
[#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) is now an owned arm, claimed by
[#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) — filter-and-copy like `apiRetry`/
`compacting` (drops `conversationId`, copies `estimatedTokens` verbatim into a fresh literal), but the
translation it feeds is unlike either: `apiRetry`/`compacting` fold an edge into a presence
(`reduceTimeline` decides what `active` means), while this frame carries no edge at all — the state
literally *is* the payload, so `reduceTimeline`'s `thinkingProgress` arm assigns rather than branches. See
[Thread timeline § The reducer](thread-timeline-internals.md#the-reducer) for the `thinkingTokens` scalar's three
clearing edges, none of which live in this bridge. Between #1313 and #1314 it sat dormantly in the `null`
fall-through group below, the member of that group a reader was most likely to want owned here.

**The reducer's `assertNever` default is a live secret sink, not a formality — #1314's own RED proved
it.** `reduceTimeline`'s exhaustive `switch` over `ThreadEvent` ends `default: assertNever(event)`, whose
job is `JSON.stringify`-ing whatever reaches it into an `Unhandled thread event: …` `Error`. Before the
`thinkingProgress` case existed, driving one frame through the newly-owned bridge arm hit exactly that
default with `{"type":"thinkingProgress","estimatedTokens":120}` — the reading, a side-channel on how much
claude thought about private work, landed in an Error message on the spot. Adding the reducer case is what
keeps it out; folding a future arm into a bare `default` rather than a named case would reopen the same
hole silently.

## The opening ask (#1259)

The original opening ask was removed by
[#1394](https://github.com/pyrycode/pyrycode-desktop/issues/1394). The heading remains
for existing links; the current policy is [user-demand paging](chat-history.md#received-state-admission-and-ownership).
`PairedShell` no longer calls a history helper during activation.

`ConversationSlice` owns transient `history` alongside successful `coverage`.
`markHistoryRequested(id, serverId)` marks before send, preserving same-host rows
and coverage; a differently owned slice starts empty. `recordHistoryPage` updates
coverage only after page admission, even for an empty page. `recordHistoryFailure`
retains coverage and rows, rejects a conflicting receipt host, and releases pending
state without retrying. These request-state writes do not create absent slices or
reorder the holder. Restoration seeds coverage through its explicit read handle.

`requestOlderHistory(deps, conversationId, nearTop)` is the sole asker. It declines
unaddressable ids, input outside the band, pending local reads/requests and received
`atStart`. Otherwise it marks synchronously before sending the exact successful
cursor, or `''` for unknown coverage, with `limit: 0`. The production dependency
reads current host ownership on each invocation; no coverage is captured at mount.

`subscribeHistoryPage` owns both page and failure events independently of the live
bridges. Pages are drawn before recording successful coverage. All failure reasons
settle identically; neither `reason` nor `retryable` initiates or prevents a later
qualifying connected user request. Main also settles interrupted correlations, so
abandonment without a server reply cannot leave the renderer permanently pending.

## The history/live join (#1225)

The last slice of the #1088 family: an entry present both in a served page and in what the live stream
already drew for that conversation must draw once, joined on **(`type`, `ts`)** — never the entry's `id`
(the durable on-disk log id; the live lane has no such field), never `event_id` (the in-memory replay
ring's, per-process and reset by a restart), never `turn_id` + `seq` (only turn-scoped payloads carry a
`turn_id`, and `session_transition` — the one type the log is the sole retention for — carries none), and
never text. The daemon mints one timestamp per logical event above the per-connection fan-out and hands
that same value to the log entry and to every outbound envelope, which is what makes the pair a real key
rather than a heuristic.

**A dedup on entirely remote-supplied input is a suppression primitive**, so every piece below is built to
fail OPEN — a duplicated row, never a dropped one — on anything it cannot resolve.

### The key

```ts
// timelineBridge.ts
export function joinKeyFor(type: string, ts: string): string | undefined   // `${type} ${ts}`, or
  // undefined when ts.length is 0 or exceeds MAX_JOIN_TS_CHARS (64 — an RFC3339 timestamp with
  // nanoseconds and a numeric offset is under 40)
export function liveJoinKeyFor(event: DaemonEvent): string | undefined
  // event.daemonTs === undefined ? undefined : joinKeyFor(event.type, event.daemonTs)
```

One composer for the whole join. The separator is unambiguous because the TYPE half is a client-owned
literal from a closed union and provably contains no NUL, so no hostile `ts` can spell a different
`(type, ts)` pair. An over-length `ts` yields no key rather than a truncated one — truncation would MERGE
distinct timestamps onto one key, and a key matching more than it should is a suppressor, not a safer
fallback.

### The live half — where the keys are held

`ConversationSlice` (§ The opening ask above) gains a third field:

```ts
export interface ConversationSlice {
  timeline: TimelineState
  history: HistoryRequestState | null
  liveKeys: ReadonlySet<string>
}
export const MAX_LIVE_JOIN_KEYS = 512
```

Beside `history` and `prependedRows`, for the same reason both live there: the set must die with the
timeline it describes, which membership on the slice makes structural rather than a fourth thing to clear
in the existing eviction and both wipes. A `Set`, never a bare object — the keys are daemon-supplied
strings, and a `Set` cannot be prototype-polluted the way a bare-object map could. `withJoinKey(held,
joinKey)` adds one key, evicting the OLDEST first once the set exceeds `MAX_LIVE_JOIN_KEYS` (a `Set`
preserves insertion order) — oldest-first because the newest page overlaps the newest live keys, so an
eviction should cost coverage on the entries least likely to still be in flight. `undefined` or an
already-held key is a no-op, returning the same reference.

`dispatchFor` gains an **optional trailing** third parameter, `joinKey?: string` — `subscribeTimeline`'s
own #756/#1013 arity-widening idiom a third time: a required parameter cascades over every call site, an
optional one over none. **The key is recorded only when the fold actually changed the timeline** — both
of `dispatchFor`'s branches (the slice-exists update AND the slice-doesn't-exist create) compare their
`reduceTimeline` result against what they started from before deciding to record. This is the load-bearing
safety property: a live key exists only where the live lane actually changed what the operator sees, so an
orphan or duplicate `toolResult` that drew nothing can never suppress the page entry that would have drawn
it. **A verifier MUST FIX caught the create branch stamping unconditionally on the first pass** — `toolResult`
against a fresh `initialTimelineState` no-ops by reference (`reduceTimeline`'s orphan/duplicate guard,
\#121), so an orphan result as a conversation's first live frame minted a key for a row nobody was shown,
and the served page's own copy of that result would then have been suppressed by it. Both branches now ask
the same question.

**⭐ Only an event's own attribution may mint a key.** `useTimelineBridge`'s fan-out calls
`subscribeTimeline`, which now computes the key via a module-private `joinKeyToRecord(event,
conversationId)`:

```ts
function joinKeyToRecord(event: DaemonEvent, conversationId: string | null): string | undefined {
  return conversationId === null ? undefined : liveJoinKeyFor(event)
}
```

`timelineTargetFor` (above) returns `null` for `sessionTransition` and `connected` — the two owned arms
with no wire id of their own — and `timelineWriteTarget` then routes those into whichever conversation is
ON SCREEN. A live `session_transition` belonging to conversation B would, absent this guard, mint a key on
conversation A's slice purely because A happened to be open; a same-millisecond same-type collision could
then suppress A's OWN page entry — a dropped row, the one direction this whole design refuses. So the key
is passed only when the event's own `conversationId` resolved non-null; an inferred write target never
mints one. The cost, stated rather than hidden: `sessionTransition` contributes no live key at all, so its
page twin always draws — a duplicate `Session reset` divider, the fail-open side. (This guard was planned
as a conditional inside `useTimelineBridge`'s callback and implemented one layer down, in
`subscribeTimeline`, instead — see `docs/specs/architecture/1225-history-live-join.md`'s Revisions for why:
`useTimelineBridge` mounts as a React effect and nothing in this repo can exercise one under
`environment: 'node'`, so a guard living there could only be asserted by reading the source.
`subscribeTimeline` already computes `timelineTargetFor(event)` for its second argument, so the same
decision is available one call earlier, at a seam plain spies reach.)

### The page half — the join

```ts
// historyPageBridge.ts
export function withoutLiveEntries(
  entries: readonly HistoryTimelineEntry[],
  liveKeys: ReadonlySet<string>
): readonly HistoryTimelineEntry[]

export function reduceHistoryPage(
  entries: readonly HistoryTimelineEntry[],
  liveKeys?: ReadonlySet<string>
): readonly ThreadItem[]
```

`reduceHistoryPage` runs `withoutLiveEntries` ahead of its existing reverse-and-fold; absent `liveKeys`
(the optional-trailing idiom again) suppresses nothing, which is both the pre-#1225 behaviour and the
fail-open default. Dropping happens on the PAGE side, never the live side — AC3: the live row stays
exactly where the live stream put it, and the page's copy — which `prependHistoryFor` would otherwise put
at the HEAD, above rows that came before it — never becomes a row at all.

**The suppressed set is a contiguous RUN at the page's newest end, not a scatter — a verifier MUST FIX on
the rework leg.** The first cut walked every entry independently: matching, unique-within-the-page, and
resolvable meant drop, wherever it sat. That is wrong, because `reduceHistoryPage`'s fold is not
entry-independent — `fillResult` writes a result into a `toolCall` row an earlier entry created, and a
turn's deltas coalesce in the order they fold. Two content-losing failures followed, both reproduced as
failing tests before the fix:

- **An orphaned result.** The live lane drew a `tool_use` and lost the `tool_result` to a reconnect (this
  client advertises no `last_event_id`, so a dropped live frame is gone and the served page is the only
  repair path). Dropping the page's `toolUse` while keeping its `toolResult` left `fillResult` with no row
  to write into — the result was discarded, and the live row stayed pending forever.
- **A turn read backwards.** The live lane drew a turn's older deltas but not its newer ones. Dropping the
  older while keeping the newer folded the surviving text into a bubble `prependHistoryFor` places ABOVE
  the live bubble holding the earlier half — `reduceHistoryPage` returned `'world'` where the turn read
  `'hello world'`.

Both are fail-**CLOSED** — content lost or corrupted — in exactly the reconnect scenario the served page
exists to repair, the one direction this whole ticket refuses. The fix: walk `entries` from its newest end
(the wire serves newest-first) and drop while an entry's key is defined, held, and unique among the page's
own entries; **stop at the first entry that fails any of the three**, and keep it and everything older.
Because the survivors are a chronological PREFIX of a newest-first page, no survivor can depend on an
entry the filter dropped — the run rule closes both failures structurally rather than by special-casing
either. **What it costs, stated rather than hidden:** an overlap shaped like a GAP — live drew something in
the middle of the page but not the newest entry — now suppresses nothing, and those entries draw twice,
exactly what they did before this ticket. The strongest available statement about this function: its
output is either the joined page or the un-joined one, never a page with new content lost or reordered.

`subscribeHistoryPage` gains a fourth, **optional trailing** parameter, `getLiveKeys?: (conversationId:
string) => ReadonlySet<string>` — the same idiom a third time, deliberately not a third callback
alongside `applyPage`/`settleFailure`. `useHistoryPageBridge` supplies it from a new
`selectLiveJoinKeysFor(conversationId)` selector, read AFRESH per page rather than captured at subscribe
time — the existing bridge idiom, since one app-lifetime subscription must see every conversation's
current keys, not whichever were live when it mounted.

### Error handling — every row fails open

| Condition | Result |
|---|---|
| Event carries no `daemonTs` (no envelope behind it, or an arm outside the ten) | No live key. |
| `ts` over `MAX_JOIN_TS_CHARS` on either lane | No key composed. |
| Live key set at its bound, oldest evicted | Nothing suppressed for the evicted key. |
| Two page entries share one key | Neither suppressed (AC4). |
| Live fold changed nothing, in either `dispatchFor` branch | No key recorded. |
| Slice resolved from the screen, not the event's own attribution | No key recorded (the ⭐ guard). |
| The overlap is a GAP rather than the page's newest run | The run stops there; the gap and everything older draw twice. |

Every row draws a duplicate rather than dropping a message — a cosmetic fault, never a lost one.

## Data flow

```
daemon frame ─(#199/#214/#217/#229/#315/#492/#495 transport, snake→camel, conversation_id dropped)→
   DaemonEvent{assistantDelta|turnEnd|turnState|toolUse|toolResult|stallDetected|apiRetry|compacting}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeTimeline listener → translateTimelineEvent → ThreadEvent (or null → skip)
   → timelineStore.dispatch → reduceTimeline → TimelineState
   → selectItems / selectPhase / selectStalled / selectApiRetry / selectCompacting
                                   (selectItems read by #203's Timeline view, now also carrying pending
                                   toolCall items from #217 with results resolved by #229; selectPhase
                                   read by #215's ThinkingIndicator view, narrowed by #493's and #496's
                                   shouldShowThinking clauses; selectStalled read by #317's StallIndicator
                                   view; selectApiRetry read by #493's ApiRetryIndicator view;
                                   selectCompacting read by #496's CompactingIndicator view)

fresh handshake ─(daemonConnection.ts:483, handshake-complete)→ DaemonEvent{connected, ack}
   → window.pyry.onDaemonEvent → subscribeTimeline → translateTimelineEvent → { type: 'reconnected' }
   → timelineStore.dispatch → reduceTimeline → phase/stalled/apiRetry/compacting/localSendPending cleared,
                                                 items untouched
   → timelineWriteTarget(event, null, getOpenConversationId) → the open conversation's id, or null if none
   → if non-null: conversationTimelineStore.dispatchFor(id, event) → that slice's chrome reconciled the
                                                 same way, its items untouched by reference (#785)
   (#538 — a separate, connection-lifecycle path alongside the stream path above, not a stream arrival;
    #785 gives it its first write into the keyed holder, addressed to the conversation on screen)

session boundary ─(sessionTransition, #286)→ translateTimelineEvent → { type: 'sessionBoundary', ... }
   → timelineStore.dispatch → reduceTimeline → a fresh sessionBoundary row tail-appended
   → timelineWriteTarget(event, null, getOpenConversationId) → same resolution as reconnected above
   → if non-null: conversationTimelineStore.dispatchFor(id, event) → the same row tail-appended into
                                                 that conversation's retained slice (#785)
   (the wire carries no conversation_id for this arm and never will — types.ts:664 — so this is the
    OTHER arm `timelineWriteTarget`'s fallback names, alongside reconnected)

operator presses Enter ─(composerSend.ts, submitMessage, guard passed)→ optimistic echo
   → timelineStore.dispatch({ type: 'userText', text }) → reduceTimeline → localSendPending: true
   → selectLocalSendPending (read by ConversationScreen's workingIndicatorStateWithLocalSend, composed
                              on top of #215's shouldShowThinking/workingIndicatorState gate)
   (#650 — renderer-sourced, no daemon frame, no bridge involvement; closed by the next turnState,
    reconnected, or reset arm above, never by a fourth path of its own)

trusted upward thread input near top, connected owner →
   requestOlderHistory(historyAskDeps, conversationId, nearTop)
   → pending local read/request or received atStart ? return
     : markHistoryRequested(id, host)
       → sendCommand(requestHistory, cursor: last successful cursor or '', limit: 0)
   // Opening, scroll events, page settlement and reconnect do not initiate requests.

served history page ─(#1222 ask + transport decode, #1227 per-entry decode)→ DaemonEvent{historyPageReceived,
   conversationId, entries: HistoryTimelineEntry[], cursor, atStart}
   → window.pyry.onDaemonEvent (SAME channel, a FIFTH independent listener — historyPageBridge.ts, not
                                 subscribeTimeline)
   → subscribeHistoryPage → reduceHistoryPage(entries, getLiveKeys?.(conversationId)):
        withoutLiveEntries(entries, liveKeys)                 // #1225 — drops the page's newest RUN of
        [...drawable].reverse()                              //   entries already drawn live; a GAP-shaped
        .map(entry => translateTimelineEvent(entry.event))   //   overlap or an absent liveKeys drops nothing
        .reduce(reduceTimeline, initialTimelineState)         // against a SCRATCH state, discarded
        → .items                                              // only the rows survive the fold
   → conversationTimelineStore.getState().prependHistoryFor(conversationId, items)        [draw, #1223]
        → held slice spread with items: [...fresh, ...held.items]   // fresh = items minus held-echo dupes
        → chrome (phase/stalled/apiRetry/compacting/localSendPending) carried by the spread, untouched
   → conversationTimelineStore.getState().recordHistoryPage(conversationId, cursor, atStart)   [settle, #1259]
   (#1223 — no reader wiring needed beyond the existing selectTimelineFor(conversationId): the keyed
    holder's read surface does not distinguish a live-appended row from a prepended one. Draw runs BEFORE
    settle so a page for a since-evicted slice still finds a key to record against.)

refused history ask ─(daemon-error tier's fourth member — see Request history send § Correlation)→
   DaemonEvent{historyRequestFailed, conversationId, reason, retryable}
   → window.pyry.onDaemonEvent → subscribeHistoryPage's settleFailure arm
   → conversationTimelineStore.getState().recordHistoryFailure(conversationId, reason, retryable)   (#1259)
   (all six `reason` members land here identically — nothing drawn, no banner, no timer, no re-ask;
    `retryable` is carried for #1260's walk and read by nothing in this slice)
```
