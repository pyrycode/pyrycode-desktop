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
translateTimelineEvent(event: DaemonEvent): ThreadEvent | null
// Owns exactly assistantDelta / turnEnd / turnState / toolUse / toolResult (#229) / stallDetected
// (#317) / apiRetry (#493) / compacting (#496) / connected->reconnected (#538), each rebuilt as a fresh
// named-field literal (never `return event`, never a spread — for stallDetected and connected->
// reconnected, both sides are nullary, so the "literal" is arm-selection only; apiRetry and compacting
// carry data, so each is a filter-and-copy like toolUse/toolResult — apiRetry's DaemonEvent side also
// carries conversationId since #737, which the bridge drops; compacting's DaemonEvent side carries it
// too, since #742, likewise dropped here). Every other arm -> null via
// explicit fall-through, then default: assertNever(event) — a HARD guard, not a soft catch-all default.

timelineTargetFor(event: DaemonEvent): string | null   // #756
// switch (event.type) { case 'assistantDelta': ... case 'unrecognizedMessage': return event.conversationId
//   case 'sessionTransition': case 'connected': return null
//   default: return null }
// The nine id-carrying owned arms (#784 moved `unrecognizedMessage` into this group) share one
// `return event.conversationId` (non-nullable: a missing or non-string conversation_id already fails
// the decode without emitting). The two id-less owned arms — `sessionTransition` and `connected`, and
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
`compacting` ([#496](../codebase/496.md)) is `apiRetry`'s structural twin minus the counter — also
filter-and-copy (`active` only), but the state holds a plain `boolean` rather than `Status | null`, since
there's no counter to discard on the falling edge. The reducer arm collapses to a single
`state.compacting === event.active ? state : {…}` ternary — the edge *is* the state, with no
rising/falling branch split needed.

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
```
