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

## What it does

Turns the five owned `DaemonEvent` stream arms into `ThreadEvent`s and folds them into `TimelineState`
via `reduceTimeline`, exposing `selectItems`/`selectPhase` as the only read surface. A stream arrival
(an `assistant_delta` chunk, a `turn_end` marker, a `tool_use` call, its `tool_result` outcome) re-renders
only components selecting a timeline slice — orthogonal to `sessionStore` and `runConfigStore`.

## How it works

### The store (`src/renderer/src/store/timelineStore.ts`)

```ts
export type TimelineStore = TimelineState & { dispatch: (event: ThreadEvent) => void }

createTimelineStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
timelineStore                 // app-wide singleton
useTimelineStore(selector)    // narrow-slice React binding: useStore(timelineStore, selector)
export { selectItems, selectPhase } from './threadTimeline'   // re-exported, never redefined
```

Mirrors `createSessionStore`'s DI-factory → singleton → hook → selectors structure (ADR 0004), but
wraps a real reducer + `dispatch` — `set((s) => reduceTimeline(s, event))` — rather than
`runConfigStore`'s single setter, because `ThreadEvent` is a real five-member union to reduce, not a
"latest value wins" replace. No `observe?` param: the #134 diagnostics seam is session-only, and a
speculative observer here would defend an unobserved need.

### The translator + binding (`src/renderer/src/store/timelineBridge.ts`)

```ts
translateTimelineEvent(event: DaemonEvent): ThreadEvent | null
// Owns exactly assistantDelta / turnEnd / turnState / toolUse / toolResult (#229), each rebuilt as a
// fresh named-field literal (never `return event`, never a spread). Every other arm -> null via explicit
// fall-through, then default: assertNever(event) — a HARD guard, not a soft catch-all default.

subscribeTimeline(onDaemonEvent, dispatch): () => void
// onDaemonEvent(event => { const te = translateTimelineEvent(event); if (te) dispatch(te) })
// returns the exact off handle (the subscribeRunConfig idiom) — pure, spy-testable, no React.

useTimelineBridge(): void
// useEffect(() => subscribeTimeline(window.pyry.onDaemonEvent, e => timelineStore.getState().dispatch(e)), [])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener.
```

This is the deliberate mirror image of [`daemonEventBridge`](daemon-event-bridge.md): that bridge's
`assertNever`-guarded switch returns `null` for these same five arms and owns the rest; this bridge
owns exactly these five and returns `null` for the rest — and, since [#223](../codebase/223.md), a
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
duplicate.

### Data flow

```
daemon frame ─(#199/#214/#217/#229 transport, snake→camel, conversation_id dropped)→
   DaemonEvent{assistantDelta|turnEnd|turnState|toolUse|toolResult}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeTimeline listener → translateTimelineEvent → ThreadEvent (or null → skip)
   → timelineStore.dispatch → reduceTimeline → TimelineState
   → selectItems / selectPhase   (selectItems read by #203's Timeline view, now also carrying
                                   pending toolCall items from #217 with results resolved by
                                   #229; selectPhase read by #215's ThinkingIndicator view)
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
- Import surface: `import { useTimelineStore, selectItems, selectPhase } from
  '@renderer/store/timelineStore'` and `import { useTimelineBridge } from
  '@renderer/store/timelineBridge'`.
- No conversation-id scoping in this slice — `conversation_id` was already dropped at the #199
  transport (single active conversation); the bridge translates and dispatches unconditionally.

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
- [#179 codebase notes](../codebase/179.md) — flips `interactive` live, and adds `Composer`'s direct
  `userText` dispatch as this store's sixth write path (renderer-sourced, not bridge-translated).
