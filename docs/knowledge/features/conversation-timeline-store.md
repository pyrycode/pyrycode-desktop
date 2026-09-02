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
(see [Conversation shell § Thinking indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650)).

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

[#773](../codebase/773.md) widened the fifth owned arm, `toolResult` ([#229](../codebase/229.md)) — no
new arm, one field added straight through every layer at once: wire, IPC, and both the bridge's
`DaemonEvent`/`ThreadEvent` sides gained `resultDetail?: string`, the daemon's short précis of a tool's
structured outcome (pyrycode#2024). Unlike #642/#643's two-ticket split, a scalar has none of the
daemon-chosen-keys surface that justified separating decode from carry, so this ticket also widens the
`ThreadItem` the reducer resolves onto (`toolCall.result.resultDetail`) in the same pass —
`reduceTimeline`'s `fillResult` needed no change, its existing spread already preserves the field, the
`input` (#643) precedent exactly. Absence (a daemon predating pyrycode#2024) and an empty string stay
distinct facts at every hop, pinned by tests asserting `=== undefined` rather than
`'resultDetail' in …`; per the upstream contract the two carry no different *meaning* — both mean "no
count" — they are simply never collapsed into each other, since collapsing is the lossy transform this
ticket exists not to perform. Ships dormant: `selectItems` carries the field but nothing reads it yet —
that's [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856).

[#317](../codebase/317.md) added a sixth owned arm, `stallDetected` — the daemon's onset-only stall
liveness signal ([#315](../codebase/315.md)), moved out of the inverse-filter `null` list it shipped
dormant in. At ship time, unlike every prior owned arm, both the `DaemonEvent` and the `ThreadEvent`
sides were **nullary** (`{ type: 'stallDetected' }`), so the mapping was arm-selection only — no field
to filter or copy. [#732](../codebase/732.md) later widened the `DaemonEvent` side with
`conversationId` (the same routing-key widening [#724](../codebase/724.md) did for `turnState`); the
mapping is now a **filter**, not pure arm-selection — `translateTimelineEvent` still returns the fresh
nullary `{ type: 'stallDetected' }` literal, so `ThreadEvent.stallDetected` alone stays nullary.
`reduceTimeline`'s arm sets a second scalar, `stalled: boolean`, beside `phase`; the four other owned
arms (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) now also clear it as a side effect of being
turn activity. `selectStalled` joins `selectItems`/`selectPhase` as the read surface.

[#493](../codebase/493.md) added a seventh owned arm, `apiRetry` — the daemon's api-retry status signal
([#492](../codebase/492.md)), also moved out of the inverse-filter `null` list it shipped dormant in.
At ship time, unlike `stallDetected`, this arm carried data, so `DaemonEvent.apiRetry` and
`ThreadEvent.apiRetry` were field-for-field identical (a filter-and-copy, the `toolUse`/`toolResult`
shape) rather than arm-selection-only. [#737](../codebase/737.md) later widened the `DaemonEvent` side
with `conversationId` — the same routing-key widening [#724](../codebase/724.md) did for `turnState`
and [#732](../codebase/732.md) did for `stallDetected` — so the bridge case is now a filter that also
drops a field, not a plain copy; `ThreadEvent.apiRetry` is the side that stays four-field.
`reduceTimeline`'s new arm sets a third scalar, `apiRetry: ApiRetryStatus | null`,
beside `phase`/`stalled` — but with the **clear semantics inverted** from `stalled`: the four
turn-activity arms carry it through unchanged (compile-forced, one line each) rather than clearing it,
since `api_retry` has an explicit wire falling edge (`active: false`) and `stall` does not. The falling
edge sets the scalar to `null` unconditionally, discarding any counter on that event by construction.
`selectApiRetry` joins `selectItems`/`selectPhase`/`selectStalled` as the read surface.

[#496](../codebase/496.md) added an eighth owned arm, `compacting` — the daemon's compaction-liveness
signal ([#495](../codebase/495.md)), also moved out of the inverse-filter `null` list it shipped dormant
in. At ship time, like `apiRetry`, this arm carried data (`active`), so `DaemonEvent.compacting` and
`ThreadEvent.compacting` were field-for-field identical (a filter-and-copy, not `stallDetected`'s
arm-selection-only shape). [#742](../codebase/742.md) later widened the `DaemonEvent` side with
`conversationId` — the same routing-key widening [#737](../codebase/737.md) gave `apiRetry` — so the
bridge case is now a filter that also drops a field, not a plain copy; `ThreadEvent.compacting` is the
side that stays one-field. `reduceTimeline`'s new arm sets a fourth scalar, **`compacting: boolean`**,
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
indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650)
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

[#756](../codebase/756.md) adds no new owned arm and no new `DaemonEvent`/`ThreadEvent` field —
`translateTimelineEvent`'s signature and body are byte-identical before and after. What it adds is a
second production writer for the [keyed holder](conversation-timeline-holder.md) (#755), which had
shipped with none: a new sibling pure function, `timelineTargetFor(event): string | null`, answers which
conversation each owned arm belongs to (the eight id-carrying arms return their own `conversationId`;
`sessionTransition`/`unrecognizedMessage`/`connected` return `null` — they carry nothing to attribute, not
because they're dormant). `subscribeTimeline`'s injected `dispatch` widened by **arity**, not a new
parameter — `(event) => void` to `(event, conversationId: string | null) => void` — so all 20 existing
call sites kept compiling and running unedited. `useTimelineBridge` became the fan-out composition root:
it still writes `timelineStore` unconditionally and first (nothing here changes), then additionally calls
`conversationTimelineStore.getState().dispatchFor(conversationId, event)` when the id is non-null. Every
rendered surface stays byte-identical — this ticket's own AC4 — because nothing reads the keyed holder yet
([#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) is the reader cutover). The composer's
optimistic echo (`composerSend.ts`, see [composer send](composer-send.md)) gained the same second write
path in the same ticket, since it is the timeline's other row-adding writer.

[#784](../codebase/784.md) widened `DaemonEvent.unrecognizedMessage` with `conversationId`, moving its
`timelineTargetFor` case out of the id-less group — the arms `timelineTargetFor` returns `null` for and
(since #785, below) `timelineWriteTarget` reads the open-conversation fallback for is `sessionTransition`
and `connected` **only**, from #784 onward. `ThreadEvent.unrecognizedMessage` stays four-field; the id
still stops at the bridge.

[#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) gives the keyed holder its first write for those remaining two id-less arms —
`sessionTransition`→`sessionBoundary` and `connected`→`reconnected` — which `timelineTargetFor` still
maps to `null` and always will (neither's wire payload carries a conversation id; widening either is a
daemon protocol change, out of scope here). A new sibling pure function, `timelineWriteTarget(event,
conversationId, getOpenConversationId)`, resolves the actual write key: the event's own attribution wins
if present, and only for these two named `ThreadEvent` arms does it fall back to
`getOpenConversationId()` — an injected getter, never an import, so `timelineBridge.ts`'s import list
stays byte-identical and the AC3 "no reference to the open conversation in scope" ban narrows to "no
reference inside `timelineTargetFor`" rather than disappearing. The fallback is enumerated, not blanket
(`conversationId ?? getOpenConversationId()` is explicitly banned) — a future owned arm with no
`timelineTargetFor` case still falls through `timelineWriteTarget`'s own `default` to `null`, the same
safe direction, rather than silently inheriting the screen. `useTimelineBridge` gained one parameter,
`getOpenConversationId: () => string | null`, threaded from a new module-level constant in `App.tsx`
(`openConversationId`, reading `activeConversationStore` via `selectActiveConversation`) — its only
production call site, so no cascade. `timelineTargetFor` and `subscribeTimeline` are both byte-identical
before and after, including their tests: the two design oracles (`timelineTargetFor` returns `null` for
both arms; `subscribeTimeline` passes that `null` through unchanged) are what keep the open-conversation
read out of the pure translation/routing layer and confined to the fan-out. A session boundary or
reconnect now lands in the retained slice of whichever conversation is open **when the event arrives**
(read at dispatch time, not subscribe time, since one app-lifetime listener outlives any number of chat
switches) and is dropped from the keyed path — with no key invented — when none is. The flat store keeps
receiving both arms exactly as before: this ships as a verified no-op on what the operator sees, same as
\#756.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Internals](conversation-timeline-store-internals.md) — The store itself, the translator and React binding that feed it from the daemon event stream, and the flow between them.

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

## Configuration and usage

- **`useTimelineBridge(getOpenConversationId)` mounts in `App.tsx`**, right after `useDaemonEventBridge()`
  ([#203](../codebase/203.md), shipped) — app-lifetime, unconditional, one stable listener. Since
  [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) it takes one argument: `openConversationId`, a module-level constant defined
  in `App.tsx` that reads `activeConversationStore` via `selectActiveConversation`. Passing an inline
  arrow instead would resubscribe the listener on every `App` render — the constant is what keeps the
  hook's effect dependency array (`[getOpenConversationId]`) stable across the app's lifetime.
- **`selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/`selectCompacting`/`selectLocalSendPending`
  were read in `ConversationScreen` from #203 (`selectItems`) through #650 (`selectLocalSendPending`), each
  gaining its reader as it gained a real source — see the individual tickets linked below. As of
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), none of the six is read there any more:
  the container now subscribes once to the [keyed holder](conversation-timeline-holder.md)'s
  `selectTimelineFor(openConversationId)` and destructures the same six `TimelineState` fields from that
  slice. See [Conversation shell § The open-conversation reader
  cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758). This store's own selectors stay
  exported (unused re-exports of `threadTimeline`'s own, not dead code — see § Configuration below) and this
  store stays dual-written; only the container's read side moved.
- Import surface (still exported, no longer imported by `ConversationScreen`):
  `import { useTimelineStore, selectItems, selectPhase, selectStalled, selectApiRetry,
  selectCompacting, selectLocalSendPending } from '@renderer/store/timelineStore'` and
  `import { useTimelineBridge } from '@renderer/store/timelineBridge'`. `ConversationScreen` still imports
  `useTimelineStore` alone, for the composer's `dispatch` write.
- No conversation-id scoping in this slice — `conversation_id` was already dropped at the #199
  transport (single active conversation); the bridge translates and dispatches unconditionally.
- **`connected` → `reconnected` needed no reader wiring** ([#538](../codebase/538.md)) — it drove the
  same `selectStalled`/`selectApiRetry`/`selectCompacting`/`selectPhase` selectors
  [#317](../codebase/317.md)/[#493](../codebase/493.md)/[#496](../codebase/496.md)/[#215](../codebase/215.md)
  once wired to `ConversationScreen`'s indicators. Since [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)
  moved that reader to the [keyed holder](conversation-timeline-holder.md), the reconnect-clears-chrome
  behaviour the operator sees comes from [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)'s
  `reconnected` write into the open conversation's slice instead — this store still clears the same fields
  on the same event, but that clear is no longer the one rendered.
- **`selectLocalSendPending` had a real source as of [#650](../codebase/650.md) (the composer's
  `userText` dispatch) and its one reader from the same ticket through
  [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758)** — `ConversationScreen`'s
  `workingIndicatorStateWithLocalSend(status, localSendPending)`, composed on top of (not folded
  into) #215's `workingIndicatorState` gate, so #493's/#496's supersede clauses are inherited rather
  than restated. `localSendPending` now reaches that same function as one of the six
  [keyed-holder](conversation-timeline-holder.md) fields the container destructures. See
  [Conversation shell § Thinking / working
  indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650).

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
- **A `reconnected` reconcile can now MINT an empty slice in the [keyed holder](conversation-timeline-holder.md)
  ([#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)).** `reduceTimeline` on a fresh `initialTimelineState` has nothing to clear
  and returns the same reference, but `dispatchFor`'s key-absent branch still creates the slice
  unconditionally and inserts it at the head — the holder's existing, deliberate contract ("a fold for an
  id the client has never opened creates that id's slice rather than dropping it"), not new behavior this
  ticket added. It only fires when the open conversation has nothing retained yet; since
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) wired `markViewed` at the activation
  seam, opening a conversation already creates and promotes its slice, so a later `reconnected` reconcile
  finds an existing slice rather than minting a fresh one for any conversation that has actually been
  opened.

## Related

- [Conversation timeline holder](conversation-timeline-holder.md) — a separate store (#755, split from
  #675) keying a whole `TimelineState` per `conversationId` instead of holding one flat slot for the open
  conversation. Not a replacement for this store: it runs alongside, importing
  `TimelineState`/`ThreadEvent`/`reduceTimeline` from the same [thread timeline](thread-timeline.md)
  module this store wraps. [#756](../codebase/756.md) made `useTimelineBridge` and the composer's echo
  write it too, dual-write; [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758) cut
  `ConversationScreen` over to it as the sole render source — this store keeps being dual-written but is
  no longer read by the screen.
- [#756 codebase notes](../codebase/756.md) — `timelineTargetFor`, the `subscribeTimeline` arity widen,
  and the `useTimelineBridge` fan-out: implementation summary, code review, and lessons learned.
- [#784 codebase notes](../codebase/784.md) — widens `DaemonEvent.unrecognizedMessage` with
  `conversationId`, moving it into `timelineTargetFor`'s id-carrying group and leaving
  `sessionTransition`/`connected` as the only two id-less owned arms — the group [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785)
  goes on to attribute.
- [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) — `timelineWriteTarget`, the write-key
  resolution downstream of `timelineTargetFor`: files `sessionBoundary`/`reconnected` into the retained
  slice of the conversation on screen (or drops them, inventing no key, when none is open) via an
  injected `getOpenConversationId` getter from `App.tsx`, keeping `timelineTargetFor` and
  `subscribeTimeline` byte-identical. Spec: `docs/specs/architecture/785-open-conversation-timeline-arms.md`.
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
  (at ship time) nullary `stallDetected` `DaemonEvent` arm, shipped dormant (all three bridges nulled
  it). [#732](../codebase/732.md) later widened the arm with `conversationId`; `ThreadEvent.stallDetected`
  stays nullary, so this bridge's mapping is unaffected.
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
- [#773 codebase notes](../codebase/773.md) — widens the fifth owned arm's `ThreadEvent`/`ThreadItem`
  pair with `resultDetail`, in one ticket rather than #642/#643's two-ticket split, since a scalar has
  no daemon-chosen keys to separate decode from carry over. Still dormant —
  [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856) renders it.
