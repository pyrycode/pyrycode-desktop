# Conversation timeline store

The renderer's read/write surface over the [thread timeline](thread-timeline.md) model: a dedicated,
unidirectional Zustand store wrapping the pure `reduceTimeline` reducer, plus a
`daemonEventBridge`-shaped translator + React binding that feeds it from the two v2 interactive-stream
`DaemonEvent` arms. Together, the store and bridge are what the render slice
([#203](../codebase/203.md), shipped) mounts and paints — the "single, ordered source of truth" #203's
spec called for.

Introduced in [#202](../codebase/202.md), the L2 (store) slice of the Phase-2 structured-streaming
vertical, blocked-by [#199](../codebase/199.md) (the L1 transport slice, shipped) and built directly
on [#121](../codebase/121.md) (the pure model, shipped). Purely additive, Strangler Fig: nothing in
the coarse `message`/`message_chunk` path imports or is changed by either new file. [#203](../codebase/203.md)
(shipped) is now the sole reader — the store's read surface (`selectItems`/`selectPhase`) and
`useTimelineBridge()` mount are otherwise unchanged from what #202 shipped.

[#214](../codebase/214.md) added a third arm to `translateTimelineEvent`'s owned block, `turnState` —
the transport slice that finally feeds `phase` a live value. `selectPhase` now has a real upstream
source; [#215](../codebase/215.md) gave it its first reader, `ConversationScreen`'s `ThinkingIndicator`
(see [Conversation shell § Thinking indicator](conversation-shell.md#thinking-indicator-215)).

[#217](../codebase/217.md) added a fourth arm, `toolUse` — the tool-call enrichment of the same v2
interactive stream. Unlike the three arms before it, this is the first whose mapping produces a
durable, appended `ThreadItem` (a `toolCall`, `result: null`) rather than growing text or setting a
scalar: `reduceTimeline`'s pre-existing `toolUse` arm (#121) splits the turn's text into
`[assistantText, toolCall, assistantText]`. `selectItems` now has a second content kind to expose
beyond `assistantText`; nothing in the renderer paints a `toolCall` row yet — that is the sibling slice
[#218](https://github.com/pyrycode/pyrycode-desktop/issues/218).

[#201](../codebase/201.md) added `modalShown` / `modalDismissed` to `translateTimelineEvent`'s
**inverse-filter** `null` list (alongside `conversationsReceived`), **not** its owned block — the first
`DaemonEvent` pair since this bridge existed that this store does **not** consume. A modal is neither a
session action nor a timeline event; the real consumer is the third, independent [modal store +
bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md).
This forced a matching `null` case in `daemonEventBridge.ts` at the same time — the third pair of arms
to force both `assertNever`-guarded switches at once (after `turnState` #214 and `toolUse` #217).

[#229](../codebase/229.md) added a fifth owned arm, `toolResult` — the outcome half of the `tool_use`
enrichment (#217), the last transport slice of the vertical. Unlike every prior owned arm, this one
**resolves** an existing `ThreadItem` rather than appending or setting a scalar: `reduceTimeline`'s
pre-existing `toolResult` arm folds it through `fillResult` (#121), correlating by `toolUseId` and filling
the matching `toolCall`'s `result` in place; an orphan or duplicate is a deterministic same-reference
no-op. `DaemonEvent.toolResult` and `ThreadEvent.toolResult` are field-for-field identical, so the mapping
is again a pure filter-and-copy. This also forced a case in a **third** exhaustive `DaemonEvent` switch —
[modal store + bridge](modal-store-bridge.md)'s `modalBridge.ts` (#223) — a cost the #229 spec's own scope
self-check (written before #223 merged) undercounted by one file; see [#229 codebase
notes](../codebase/229.md) § Lessons learned. `selectItems` now exposes a `toolCall`'s resolved outcome;
no render yet — that's the sibling slice [#230](https://github.com/pyrycode/pyrycode-desktop/issues/230).

[#317](../codebase/317.md) added a sixth owned arm, `stallDetected` — the daemon's onset-only stall
liveness signal ([#315](../codebase/315.md)), moved out of the inverse-filter `null` list it shipped
dormant in. Unlike every prior owned arm, both the `DaemonEvent` and the `ThreadEvent` sides are
**nullary** (`{ type: 'stallDetected' }`), so the mapping is arm-selection only — no field to filter or
copy. `reduceTimeline`'s new arm sets a second scalar, `stalled: boolean`, beside `phase`; the four
other owned arms (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) now also clear it as a side
effect of being turn activity. `selectStalled` joins `selectItems`/`selectPhase` as the read surface.

[#493](../codebase/493.md) added a seventh owned arm, `apiRetry` — the daemon's api-retry status signal
([#492](../codebase/492.md)), also moved out of the inverse-filter `null` list it shipped dormant in.
Unlike `stallDetected`, this arm carries data, so `DaemonEvent.apiRetry` and `ThreadEvent.apiRetry` are
field-for-field identical (a filter-and-copy, the `toolUse`/`toolResult` shape) rather than
arm-selection-only. `reduceTimeline`'s new arm sets a third scalar, `apiRetry: ApiRetryStatus | null`,
beside `phase`/`stalled` — but with the **clear semantics inverted** from `stalled`: the four
turn-activity arms carry it through unchanged (compile-forced, one line each) rather than clearing it,
since `api_retry` has an explicit wire falling edge (`active: false`) and `stall` does not. The falling
edge sets the scalar to `null` unconditionally, discarding any counter on that event by construction.
`selectApiRetry` joins `selectItems`/`selectPhase`/`selectStalled` as the read surface.

[#496](../codebase/496.md) added an eighth owned arm, `compacting` — the daemon's compaction-liveness
signal ([#495](../codebase/495.md)), also moved out of the inverse-filter `null` list it shipped dormant
in. Like `apiRetry`, this arm carries data (`active`), so `DaemonEvent.compacting` and
`ThreadEvent.compacting` are field-for-field identical — a filter-and-copy, not `stallDetected`'s
arm-selection-only shape. `reduceTimeline`'s new arm sets a fourth scalar, **`compacting: boolean`**,
beside `phase`/`stalled`/`apiRetry` — deliberately **not** `| null`: unlike `apiRetry` there is no
counter to hide on clear, so a plain boolean is the honest representation and `boolean | null` would
invent a state the wire cannot produce. The clear semantics match `apiRetry`'s inversion of `stalled`:
the four turn-activity arms carry it through unchanged, and it clears only on its own explicit falling
edge (`active: false`). Both edges collapse into one same-reference-or-fresh-state ternary — simpler
than `apiRetry`'s two-branch body, since there's no counter to compare. `selectCompacting` joins
`selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry` as the read surface.

[#538](../codebase/538.md) added a ninth owned arm, `connected`→`reconnected` — unlike every arm before
it, this one is **connection-lifecycle, not stream content**: it moves `connected` out of the null
fall-through cluster into its own case, ahead of where the cluster opens, and returns a payload-free
`{ type: 'reconnected' }`, ignoring the `connected` `DaemonEvent`'s `HelloAckPayload` entirely — there is
no field to filter or copy, so like `stallDetected` this is arm-selection only. `reduceTimeline`'s new
arm implements `docs/protocol-mobile.md`'s Mode B reset-on-reconnect contract for the timeline's two
two-edged chrome scalars (`apiRetry`, `compacting`), which were otherwise stuck forever once their wire
falling edge was lost to a disconnect: it clears `phase`/`stalled`/`apiRetry`/`compacting` in one step
via a hand-written five-field literal (not a spread of `initialTimelineState`, so a future sixth field
is a compile error here rather than cleared for free) while preserving `items` **by reference** — the
same Mode A (cursor-backfill transcript) / Mode B (reset-and-rebuild control state) split the wire
contract draws. `daemonEventBridge.ts` and `sessionStore.ts` remain independent consumers of the same
`connected` edge, untouched by this ticket — this is the [`modalStore` #415](../codebase/415.md) /
`queueStore` #197 reconcile shape applied a third time, not a centralisation of the edge.

[#650](../codebase/650.md) added a sixth `TimelineState` scalar, `localSendPending: boolean`, but
**not** a tenth owned arm — no new `DaemonEvent`, no new bridge case. It is the first chrome scalar
written by a renderer-sourced event rather than a daemon one: the existing `userText` arm (the
composer's optimistic echo, live since [#179](../codebase/179.md)) now also sets
`localSendPending: true`, opening the working indicator's window the moment the composer accepts a
submit rather than a network round-trip later. Every other arm classifies it: `turnState` and
`reconnected` close it (the daemon speaking, or a reconcile, is authoritative), `reset` clears it
for free via the shared constant, and the eight turn-content arms (`assistantDelta`/`toolUse`/
`toolResult`/`turnEnd`/`sessionBoundary`/`stallDetected`/`apiRetry`/`compacting`) all carry it
through unchanged — the deliberate inverse of `stalled`, since content can arrive before any
`turn_state` and clearing on it would blank the indicator mid-turn. Both of the reducer's
compiler-invisible early-outs (`turnState`'s no-churn guard, `reconnected`'s `nothingLive`
predicate) gained a matching widened clause, the same shape as `stalled`'s guard in #317.
`selectLocalSendPending` joins the read surface. See [Conversation shell § Thinking / working
indicator](conversation-shell.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649)
for the view-side composition.

[#643](../codebase/643.md) widened the fourth owned arm, `toolUse` ([#217](../codebase/217.md)) — no
new arm, one field added to both the `DaemonEvent` and `ThreadEvent` sides: the tool's input map
carried to the IPC boundary by [#642](../codebase/642.md). Unlike every prior widen on this arm, this
one also widens the `ThreadItem` the reducer appends (`toolCall.input`), not just the event — the
bridge's fresh literal and the reducer's appended literal each gained one line, `input: event.input`,
unconditional and by reference. Absence (a pre-pyrycode#1678 daemon) and an empty map stay distinct
facts at both hops, pinned by tests asserting `=== undefined` rather than `'input' in …`. `fillResult`
needed no change — its existing spread already preserves the field. Ships dormant: `selectItems`
carries the field but nothing reads it yet — that's [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645).

## What it does

Turns the nine owned `DaemonEvent` arms into `ThreadEvent`s and folds them into `TimelineState` via
`reduceTimeline`, exposing `selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/
`selectCompacting`/`selectLocalSendPending` as the read surface. A stream arrival (an
`assistant_delta` chunk, a `turn_end` marker, a `tool_use` call, its `tool_result` outcome, a `stall`
onset, an `api_retry` edge, a `compacting` edge) re-renders only components selecting a timeline
slice — orthogonal to `sessionStore` and `runConfigStore`. The ninth arm, `connected`→`reconnected`
([#538](../codebase/538.md)), is not stream content at all — it is the connection-lifecycle reconcile
that clears the timeline's transient chrome on a fresh handshake. `localSendPending`
([#650](../codebase/650.md)) is written by neither path: it is set by the renderer-sourced `userText`
event the composer dispatches directly (see below), the store's one non-bridge write source.

## How it works

### The store (`src/renderer/src/store/timelineStore.ts`)

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

### The translator + binding (`src/renderer/src/store/timelineBridge.ts`)

```ts
translateTimelineEvent(event: DaemonEvent): ThreadEvent | null
// Owns exactly assistantDelta / turnEnd / turnState / toolUse / toolResult (#229) / stallDetected
// (#317) / apiRetry (#493) / compacting (#496) / connected->reconnected (#538), each rebuilt as a fresh
// named-field literal (never `return event`, never a spread — for stallDetected and connected->
// reconnected, both sides are nullary, so the "literal" is arm-selection only; apiRetry and compacting
// carry data, so each is a filter-and-copy like toolUse/toolResult). Every other arm -> null via
// explicit fall-through, then default: assertNever(event) — a HARD guard, not a soft catch-all default.

subscribeTimeline(onDaemonEvent, dispatch): () => void
// onDaemonEvent(event => { const te = translateTimelineEvent(event); if (te) dispatch(te) })
// returns the exact off handle (the subscribeRunConfig idiom) — pure, spy-testable, no React.

useTimelineBridge(): void
// useEffect(() => subscribeTimeline(window.pyry.onDaemonEvent, e => timelineStore.getState().dispatch(e)), [])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener.
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

The `assistantDelta`/`turnEnd` arms are field-for-field identical between `DaemonEvent` and
`ThreadEvent` (`turnId`/`seq`/`text`, `turnId`/`stopReason`), so mapping them is a **filter, not a
rename** — arm selection plus a fresh copy, no field mapping. `turnState` is the same shape of
filter-not-rename: `event.state` (`WireTurnState`) assigns to the `ThreadEvent` arm's `state`
(`TurnPhase`) with no cast, because the two are the same literal union declared on either side of the
shared/renderer boundary (see [#214](../codebase/214.md)). `toolUse` ([#217](../codebase/217.md)) and
`toolResult` ([#229](../codebase/229.md)) are likewise pure filter-and-copy — `DaemonEvent.toolUse`/
`toolResult` and their `ThreadEvent` counterparts are field-for-field identical, a deliberate lockstep
design from ADR 0008. `toolUse` is the first owned arm whose `ThreadEvent` counterpart `reduceTimeline`
folds into an **appended `ThreadItem`** (a `toolCall`) rather than a text delta or a scalar; `toolResult`
is the first to **resolve** one already appended — `reduceTimeline`'s `fillResult` (#121) correlates it to
the pending `toolCall` by `toolUseId` and fills `result` in place, a same-reference no-op on an orphan or
duplicate. `stallDetected` ([#317](../codebase/317.md)) is the first arm where **both** sides of the
mapping are nullary — `DaemonEvent.stallDetected` and `ThreadEvent.stallDetected` are both
`{ type: 'stallDetected' }`, so the case is pure arm-selection with no field to filter or copy.
`apiRetry` ([#493](../codebase/493.md)) returns to the filter-and-copy shape — `DaemonEvent.apiRetry`
and `ThreadEvent.apiRetry` are field-for-field identical (`active`/`current`/`total`) — but is the first
status-liveness arm (after `stallDetected`) whose `reduceTimeline` handling translates an **edge into a
presence**: the event always carries `active`, but the state holds `ApiRetryStatus | null`, collapsing
the wire's rising/falling edges into one representation with no field left over to leak a stale counter.
`compacting` ([#496](../codebase/496.md)) is `apiRetry`'s structural twin minus the counter — also
filter-and-copy (`active` only), but the state holds a plain `boolean` rather than `Status | null`, since
there's no counter to discard on the falling edge. The reducer arm collapses to a single
`state.compacting === event.active ? state : {…}` ternary — the edge *is* the state, with no
rising/falling branch split needed.

### Data flow

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
   (#538 — a separate, connection-lifecycle path alongside the stream path above, not a stream arrival)

operator presses Enter ─(composerSend.ts, submitMessage, guard passed)→ optimistic echo
   → timelineStore.dispatch({ type: 'userText', text }) → reduceTimeline → localSendPending: true
   → selectLocalSendPending (read by ConversationScreen's workingIndicatorStateWithLocalSend, composed
                              on top of #215's shouldShowThinking/workingIndicatorState gate)
   (#650 — renderer-sourced, no daemon frame, no bridge involvement; closed by the next turnState,
    reconnected, or reset arm above, never by a fourth path of its own)
```

## Configuration and usage

- **`useTimelineBridge()` mounts in `App.tsx`**, right after `useDaemonEventBridge()` ([#203](../codebase/203.md),
  shipped) — app-lifetime, unconditional, one stable listener.
- **`selectItems` is read in `ConversationScreen`** via `useTimelineStore(selectItems)`, feeding the
  new `Timeline` pure view straight (no adapter — `ThreadItem` is already the render model). See
  [Conversation shell § Structured-stream timeline render](conversation-shell.md#structured-stream-timeline-render-203).
  `selectPhase` has a real source as of [#214](../codebase/214.md) (`turn_state`) and its first reader
  as of [#215](../codebase/215.md) — `ConversationScreen`'s `ThinkingIndicator`, reading
  `useTimelineStore(selectPhase)` to derive `isThinking`. See
  [Conversation shell § Thinking indicator](conversation-shell.md#thinking-indicator-215).
  `selectStalled` has a real source as of [#315](../codebase/315.md) (`stall`) and its first reader as
  of [#317](../codebase/317.md) — `ConversationScreen`'s `StallIndicator`, reading
  `useTimelineStore(selectStalled)` to derive `isStalled`. See
  [Conversation shell § Stall indicator](conversation-shell.md#stall-indicator-317).
  `selectApiRetry` has a real source as of [#492](../codebase/492.md) (`api_retry`) and its first reader
  as of [#493](../codebase/493.md) — `ConversationScreen`'s `ApiRetryIndicator`, reading
  `useTimelineStore(selectApiRetry)` directly, and the same screen's `shouldShowThinking` predicate,
  which reads it alongside `phase` to narrow `ThinkingIndicator`'s gate. See
  [Conversation shell § Api-retry indicator](conversation-shell.md#api-retry-indicator-493).
  `selectCompacting` has a real source as of [#495](../codebase/495.md) (`compacting`) and its first
  reader as of [#496](../codebase/496.md) — `ConversationScreen`'s `CompactingIndicator`, reading
  `useTimelineStore(selectCompacting)` directly, and the same screen's `shouldShowThinking` predicate,
  which reads it alongside `phase`/`apiRetry` to narrow `ThinkingIndicator`'s gate a second time. See
  [Conversation shell § Compacting indicator](conversation-shell.md#compacting-indicator-496).
- Import surface: `import { useTimelineStore, selectItems, selectPhase, selectStalled, selectApiRetry,
  selectCompacting, selectLocalSendPending } from '@renderer/store/timelineStore'` and
  `import { useTimelineBridge } from '@renderer/store/timelineBridge'`.
- No conversation-id scoping in this slice — `conversation_id` was already dropped at the #199
  transport (single active conversation); the bridge translates and dispatches unconditionally.
- **`connected` → `reconnected` needs no reader wiring** ([#538](../codebase/538.md)) — it drives the
  same `selectStalled`/`selectApiRetry`/`selectCompacting`/`selectPhase` selectors
  [#317](../codebase/317.md)/[#493](../codebase/493.md)/[#496](../codebase/496.md)/[#215](../codebase/215.md)
  already wired to `ConversationScreen`'s indicators; a reconnect just clears the value those existing
  readers already subscribe to.
- **`selectLocalSendPending` has a real source as of [#650](../codebase/650.md) (the composer's
  `userText` dispatch) and its one reader as of the same ticket** — `ConversationScreen`'s
  `workingIndicatorStateWithLocalSend(status, localSendPending)`, composed on top of (not folded
  into) #215's `workingIndicatorState` gate, so #493's/#496's supersede clauses are inherited rather
  than restated. See [Conversation shell § Thinking / working
  indicator](conversation-shell.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649).

## Edge cases and limitations

- **Ordering is arrival order, not `seq`.** `seq` is carried on `assistantDelta` through the
  translator but not consulted anywhere in this slice — `reduceTimeline` (#121) already ignores it,
  trusting the ordered transport.
- **Orphan/duplicate `toolResult` and turn-phase churn are the reducer's concern**, already
  same-reference no-ops (#121) — not re-handled by the store or bridge.
- **No dedicated test for `useTimelineBridge`.** A bare hook is untestable without a React renderer
  (none in this repo), exactly as `useDaemonEventBridge` has none — its behavior is fully carried by
  the pure `subscribeTimeline` tests. See [#202 codebase notes](../codebase/202.md) § Lessons learned.
- **Zero live traffic until [#179](../codebase/179.md).** Through #178, desktop withheld the
  `interactive` capability, so no `assistant_delta`/`turn_end`/`turn_state`/`tool_use`/`tool_result`
  frame reached this bridge in production — the store, bridge, #203's `Timeline` view, and #215's
  `ThinkingIndicator` view were built and tested against injected `DaemonEvent`s/`ThreadItem[]`/booleans
  only. #179 flipped `interactive`; all five now carry live daemon traffic, plus a sixth,
  renderer-sourced `userText` event the composer echo dispatches directly (not via the bridge).
- **The `toolCall` item's `result` fills as of [#229](../codebase/229.md), rendered as of
  [#230](../codebase/230.md).** The transport-to-reducer chain resolves its correlated `toolCall`'s
  `result` in place, visible via `selectItems`; the success/error visual landed in #230.
- **`stalled` is onset-only — no daemon "cleared" frame exists ([#317](../codebase/317.md)).** The
  reducer derives the clear entirely client-side, on the next `assistantDelta`/`toolUse`/`toolResult`/
  `turnState` arm; a stall with no following turn activity stays shown indefinitely, by design.
- **`apiRetry` is the deliberate inverse of `stalled`: it does NOT clear on turn activity
  ([#493](../codebase/493.md)).** The wire's `api_retry` frame carries an explicit falling edge
  (`active: false`), so the four turn-activity arms carry the scalar through unchanged instead of
  clearing it — a retry stays shown across intervening `assistantDelta`/`toolUse`/`toolResult`/
  `turnState` events, and clears only on its own falling edge. Copying `stalled`'s guard-widening
  pattern here would silently swallow a live retry on the next stream event.
- **`compacting` follows the same inversion as `apiRetry`, a plain `boolean` rather than a `| null`
  record ([#496](../codebase/496.md)).** The wire's `compacting` frame also carries an explicit falling
  edge, so it too survives turn activity and clears only on its own signal — the two `&& !state.stalled`
  guards did not gain a compaction term either. Unlike `apiRetry` there is no counter to discard on
  clear, so the state is a bare liveness flag, not a status record.
- **The relay never resumes a session and desktop advertises no replay cursor, so a reconnect cannot
  recover a lost falling edge — it can only reconcile forward** ([#538](../codebase/538.md)). The daemon
  re-asserts only the outstanding modal (#877) and the queued backlog (#878) on connect, never
  `api_retry`/`compacting`/`turn_state`, so a status genuinely still live across the reconnect shows no
  banner until the daemon's next edge. Accepted by design: a briefly-missing banner beats a
  permanently-stuck one.
- **`localSendPending` is the one chrome scalar with no daemon falling edge at all — a bridge
  reconcile is not optional the way it is for `apiRetry`/`compacting` ([#650](../codebase/650.md)).**
  A send whose bridge call throws still posts the echo (`composerSend.ts`'s swallowed-failure
  contract), so the window opens for a message that never left the machine, and with the connection
  still up there is nothing that closes it until a `turn_state`, a reconnect, a conversation switch,
  or an unpair. This is the send-failure surface #650 deliberately left out of scope, not an
  oversight — engineering a timeout around it would be new client state defending an unobserved
  failure mode.
- **A send issued while the previous turn is still finishing closes the *new* window on the
  *previous* turn's `turn_state{idle}` ([#650](../codebase/650.md)).** `turnState`'s clear is
  unconditional on any phase, so the indicator can go briefly dark before the daemon reports the new
  turn. Decided as the ticket-sanctioned reading rather than defended — the queued-message path
  (#293/#294) is where that case properly lives.

## Related

- [Thread timeline (conversation model)](thread-timeline.md) — the `ThreadItem`/`ThreadEvent`/
  `reduceTimeline` model this store wraps verbatim.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the sibling bridge this one mirrors in
  shape and shares the `onDaemonEvent` channel with.
- [Session store](session-store.md) / [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the DI-factory → singleton → hook → selectors shape `timelineStore.ts` mirrors.
- [Run configuration store](run-config-store.md) — the leaner single-setter store shape this one
  deliberately does *not* use (a real reducer exists here; a single setter would not fit).
- [#199 codebase notes](../codebase/199.md) — the transport slice: wire types, decode, and the
  `assistantDelta`/`turnEnd` `DaemonEvent` arms this bridge consumes.
- [#202 codebase notes](../codebase/202.md) — implementation summary and patterns established.
- [#214 codebase notes](../codebase/214.md) — the `turnState` transport slice: wire types, decode, and
  the third arm this bridge's `translateTimelineEvent` owns, giving `selectPhase` its first real
  source.
- [#215 codebase notes](../codebase/215.md) — `selectPhase`'s first reader, the `ThinkingIndicator`
  render slice.
- [#217 codebase notes](../codebase/217.md) — the `toolUse` transport slice: wire types, decode, and
  the fourth arm this bridge's `translateTimelineEvent` owns, the first to drive a durable `toolCall`
  item; unblocks the render slice [#218](https://github.com/pyrycode/pyrycode-desktop/issues/218) and
  feeds the correlation ticket [#229](../codebase/229.md).
- [#229 codebase notes](../codebase/229.md) — the `toolResult` transport slice, the last of the vertical:
  wire types, decode, and the fifth arm this bridge's `translateTimelineEvent` owns, the first to
  **resolve** a durable `ThreadItem` in place (via `fillResult`, #121) rather than append one or set a
  scalar; also the ticket that surfaced the third-bridge (`modalBridge.ts`) touchpoint cost. Unblocks the
  render slice [#230](https://github.com/pyrycode/pyrycode-desktop/issues/230).
- [Modal-prompt model](modal-prompt-model.md) / [#201 codebase notes](../codebase/201.md) — the
  `modalShown`/`modalDismissed` transport slice: the first `DaemonEvent` pair this bridge does **not**
  own, added to the inverse-filter `null` list instead; the real consumer is the third, independent
  [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md).
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md).
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the vertical [#201](../codebase/201.md) is the transport slice of; this store deliberately stays outside it.
- [#203 codebase notes](../codebase/203.md) — mounts `useTimelineBridge`, reads
  `selectItems`, and paints the streamed assistant text — the blank-thread-critical slice [#179](../codebase/179.md)
  later flipped live.
- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  `conversationCreated` transport slice: another `DaemonEvent` arm this bridge does **not** own,
  folded into the inverse-filter `null` list alongside `modalShown`/`modalDismissed`; the real
  consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242).
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` transport slice: another
  `DaemonEvent` arm this bridge does **not** own, folded into the inverse-filter `null` list (not a
  timeline item, unlike `turnState`); the real consumer is the [session-id store](session-id-store.md)
  ([#259](../codebase/259.md), shipped).
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the
  `sessionSettingsUpdated`/`sessionSettingsRejected` transport slices: two more `DaemonEvent` arms this
  bridge does **not** own, folded into the inverse-filter `null` list alongside `sessionTransition`;
  the real consumer is the [Run configuration write store](run-settings-write-store.md)
  ([#256](../codebase/256.md), shipped).
- [#248 codebase notes](../codebase/248.md) — the `modalAnswerRejected` transport slice: another
  `DaemonEvent` arm this bridge does **not** own, folded into the inverse-filter `null` list alongside
  `modalShown`/`modalDismissed`/`sessionTransition`; the real, still-dormant owner is the
  [modal store + bridge](modal-store-bridge.md), render lands in
  [#249](https://github.com/pyrycode/pyrycode-desktop/issues/249).
- [#179 codebase notes](../codebase/179.md) — flips `interactive` live, and adds `Composer`'s direct
  `userText` dispatch as this store's sixth write path (renderer-sourced, not bridge-translated).
- [#315 codebase notes](../codebase/315.md) — the `stall` transport slice: wire type, decode, and the
  nullary `stallDetected` `DaemonEvent` arm, shipped dormant (all three bridges nulled it).
- [#317 codebase notes](../codebase/317.md) — the render slice: moves `stallDetected` from this
  bridge's inverse-filter `null` list to a sixth owned arm, adds the `stalled` scalar and
  `selectStalled`, and gives it its first reader, `ConversationScreen`'s `StallIndicator`.
- [#492 codebase notes](../codebase/492.md) — the `api_retry` transport slice: wire type, decode, and
  the non-nullary `apiRetry` `DaemonEvent` arm, shipped dormant (all three bridges nulled it).
- [#493 codebase notes](../codebase/493.md) — the render slice: moves `apiRetry` from this bridge's
  inverse-filter `null` list to a seventh owned arm, adds the `apiRetry: ApiRetryStatus | null` scalar
  and `selectApiRetry` — with the clear semantics deliberately inverted from `stalled` — and gives it
  its first reader, `ConversationScreen`'s `ApiRetryIndicator` plus the `shouldShowThinking` supersede
  predicate.
- [#495 codebase notes](../codebase/495.md) — the `compacting` transport slice: wire type, decode, and
  the non-nullary `compacting` `DaemonEvent` arm, shipped dormant (all three bridges nulled it).
- [#496 codebase notes](../codebase/496.md) — the render slice: moves `compacting` from this bridge's
  inverse-filter `null` list to an eighth owned arm, adds the `compacting: boolean` scalar and
  `selectCompacting` — `apiRetry`'s clear-semantics inversion again, minus the counter — and gives it
  its first reader, `ConversationScreen`'s `CompactingIndicator` plus a second `shouldShowThinking`
  clause.
- [#538 codebase notes](../codebase/538.md) — moves `connected` from this bridge's null fall-through
  cluster to a ninth owned arm, mapping it to the nullary `reconnected` `ThreadEvent`; `reduceTimeline`'s
  new arm clears `phase`/`stalled`/`apiRetry`/`compacting` while preserving `items` by reference — the
  Mode B reconnect reconcile [`modalStore` #415](../codebase/415.md) / `queueStore` #197 already have.
  `daemonEventBridge.ts` and `sessionStore.ts` stay independent consumers of the same `connected` edge.
- [#642 codebase notes](../codebase/642.md) — the transport slice: decodes `tool_use.input` into the
  optional `DaemonEvent.toolUse.input` field, shipped dormant, carried to the IPC boundary.
- [#643 codebase notes](../codebase/643.md) — widens the fourth owned arm's `ThreadEvent`/`ThreadItem`
  pair with `input`, the first widen on this arm to also touch the appended item, not just the event.
  Still dormant — [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645) renders it.
- [#650 codebase notes](../codebase/650.md) — adds a sixth `TimelineState` scalar,
  `localSendPending`, and `selectLocalSendPending`, but no tenth owned arm: it is written by the
  existing renderer-sourced `userText` arm rather than any `DaemonEvent`, closed by `turnState` and
  `reconnected` (both early-outs widened to match) and cleared for free by `reset`. First reader:
  `ConversationScreen`'s `workingIndicatorStateWithLocalSend`, composed on `workingIndicatorState`
  rather than folded into `ThreadStatus`.
