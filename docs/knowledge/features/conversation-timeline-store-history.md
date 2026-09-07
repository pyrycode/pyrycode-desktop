# Conversation timeline store — ticket-by-ticket history

Split from [Conversation timeline store](conversation-timeline-store.md) on 2026-09-07 to stay under the
size cap. This is the per-ticket changelog of every arm, scalar, write path and channel subscriber the
store and its bridge have grown; the current shape (what it does, configuration, edge cases) stays on the
parent page. Nothing here changes what's true today — read [Conversation timeline store § What it
does](conversation-timeline-store.md#what-it-does) for that.

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
(see [Conversation shell § Thinking indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)).

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
indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)
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

[#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) widened `translateTimelineEvent` and
`subscribeTimeline` with one optional trailing parameter each, `now?: () => number` — read only on the
`assistantDelta` arm, assigned unconditionally as `createdAt: now?.()`, every other arm byte-identical.
Optional and trailing for `subscribeTimeline`'s own #756 reason (a required parameter would cascade over
all 25 existing call sites; an optional one over none), but with **no `Date.now` fallback** — the
load-bearing half, since a defaulting clock would stamp every event a spec produces by calling
`translateTimelineEvent`/`subscribeTimeline` with no clock, and those events are asserted with `toEqual`,
which fails on a defined `createdAt` where the fixture names none. `useTimelineBridge` is the clock's
composition root for the assistant side: it passes `Date.now` (referenced, not called) as
`subscribeTimeline`'s third argument, read once per translated event inside the listener — so each
assistant bubble is stamped at *its own* arrival, not at subscribe time — and outside the effect's
dependency array, since `Date.now` is a module-level intrinsic whose identity never changes. See [Thread
timeline § Types](thread-timeline.md#types) for the full field-pair contract and the "why not a reducer
parameter" arithmetic; [composer send](composer-send.md) has the mirror wiring for the user echo.

[#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223) draws a served history page — #1222's
ask, #1227's per-entry decode. It is **not** a tenth owned arm on `translateTimelineEvent`'s switch over
`historyPageReceived`; that case stays in the dormant fall-through group, unclaimed. Instead the function's
**parameter** widens to `DaemonEvent | HistoryTimelineEvent` — a widening, not a signature change, since
every `HistoryTimelineEvent` arm is its live twin minus the `conversationId` no case reads, so no case body
moves and `assertNever` stays total. That widen is what lets a **new** module, `historyPageBridge.ts`,
reuse this same function one entry at a time rather than write a second mapping, which is what makes "a
page produces the rows the live stream would have" structural rather than asserted.
`translateTimelineEvent` also gains its tenth owned arm in the process, `messageReceived`→`userText`,
gated on `event.message.role === 'user'` — the operator's own turn, which the daemon stores in its log but
never pushes as a live frame, so this arm draws only from a page. `timelineTargetFor` is deliberately
**not** widened to route it: a live `messageReceived` (which this daemon never sends) still resolves to no
keyed target and reaches the flat `timelineStore` only, whose `items` no screen reads — the live lane is
therefore a verified no-op, not an assumed one.

`historyPageBridge.ts` is a **fifth** independent channel subscriber, beside the session, timeline, modal
and question bridges — not a widening of `subscribeTimeline`'s injected `dispatch`, which would cascade
over its 20+ call sites to buy nothing (#756's own arithmetic). It owns `historyPageReceived` and (since
\#1259) `historyRequestFailed`, and exports two pieces: `reduceHistoryPage(entries)`, a pure function
that reverses a copy of the page (the
wire serves `entries` newest-first, every `reduceTimeline` arm appends, so folding in arrival order would
draw the transcript backwards) and folds each translated entry through `reduceTimeline` against a
**scratch** `TimelineState` seeded from `initialTimelineState`, returning only its `items`; and
`useHistoryPageBridge()`, the React mount (`App.tsx`, beside `useQuestionBridge()`) that hands each page to
the store's new `prependHistoryFor(conversationId, items)` write path. No clock reaches the fold — AC5 —
so no replayed row is stamped with the moment it was drawn, at both this seam and the bridge arm above.

The scratch-state fold is the answer to the question this doc's `userText` arm below and
`threadTimeline.ts`'s own comment pose ("if a second `userText` producer is ever added — a history
backfill is the obvious candidate — it must be re-examined against this arm"): **neither a distinct event
nor a flag** — a page never reaches the *held* state's reducer at all, so `localSendPending` and the other
four chrome scalars a page's entries might carry (`turn_state`, `stall`, `api_retry`, `compacting`) are
structurally unable to escape the discarded scratch fold. `reduceTimeline` itself needed no edit for any
of this. (`threadTimeline.ts`'s own comment at the `userText` arm still names only the composer as the
producer and does not yet record this third answer — a verifier SHOULD FIX on PR #1229, not blocking.)

`prependHistoryFor` is a fifth store write path, beside `dispatchFor`/`markViewed`/`clearAllTimelines`/
`clearTimelineFor` (see [Conversation timeline holder](conversation-timeline-holder.md)) — it takes
already-reduced rows, not an event, because a page is not one event. An empty page (or one that dedups to
nothing) returns the state object unchanged, so zustand's `Object.is` short-circuit fires; a key-absent
conversation creates its slice through the existing `withNewSliceAtHead`; a key-present one is spread with
a new `items: [...fresh, ...held.items]`, carrying every chrome scalar through by spread rather than
recomputing it, so no future sixth scalar can be forgotten here. `fresh` drops any page row whose
`messageId` a held `userText` already carries — the operator's optimistic echo and the daemon's stored copy
of the same message are the same message arriving by two routes (AC4), and the **held echo wins**: it
carries the operator's own `createdAt` and `attachments`, which the replayed row has neither of. The match
is a strict-equality scan over the held rows, never a `Set` or `Map` of ids — a page's `messageId` is the
id *another* client minted, stored and replayed, untrusted on the same terms as every other `messageId`
read (see `threadTimeline.ts` § Types), and a keyed collection of them is exactly what that field's "never
a lookup path, a cache key, a Map key" contract denies (a first-draft `Set<string>` was the plan's own MUST
FIX, caught in security review before ship — `Set.prototype.has` is in fact prototype-safe, which is
exactly why it read as fine). Deliberately **not idempotent**: applying the same page twice prepends its
non-`userText` rows twice. Unreachable in practice since [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259)
shipped the opening ask — not because the ask fires once, but because `pendingHistoryRequests` deletes its
entry on the first match, so a second `history_page` under the same `in_reply_to` resolves no conversation
and applies nothing. The general fix still needs the entry-level join key #1225 owns — a guard here would
be that join built early and wrong.

[#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) is the first sender: `historyPageBridge.ts`
gains `requestOpeningHistory`, fired once per activation from `PairedShell`'s `requestConversationConfig`,
and `subscribeHistoryPage` widens to claim `historyRequestFailed` too — the arm #1223 left unclaimed. The
per-conversation request state (asked / drawn / refused, plus the `cursor`/`atStart`
[#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260)'s walk will read) lives beside the
timeline it describes, a second field on the [keyed holder](conversation-timeline-holder.md)'s slice, so it
dies with the timeline, not in a new store or a screen-level ref. `null` (an absent key) means both
"never asked" and "evicted" — deliberately the same reading, since a re-opened evicted conversation must
refill rather than stay empty (AC3). See [Internals § The opening
ask](conversation-timeline-store-internals.md#the-opening-ask-1259) for the shapes and write paths. All six
`HistoryRequestFailure` members settle identically: the conversation stops asking, nothing is drawn, and
`history-unavailable`'s `retryable` is recorded, never acted on — no timer, no backoff, no re-ask.

[#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) is the rest of the walk. `historyPageBridge.ts`
gains a second asker, `requestOlderHistory(deps, conversationId, nearTop)`, beside `requestOpeningHistory` —
`OpeningHistoryDeps`/`openingHistoryDeps` are renamed `HistoryAskDeps`/`historyAskDeps` across both
production files and the spec, since the module now has two askers and the old name would read as a claim
about which. It sends only when the held reading is `loaded` with `atStart` false **and** the reader is
near the top; `requested` holds the walk to one ask in flight while the scroll handler fires at frame rate,
`failed` is terminal (nothing branches on `reason`, nothing reads `retryable` — no timer, no backoff, no
re-ask), and `null` (nothing held) belongs to the opening path, never restarting a walk mid-screen. `atStart`
is the only stop a page can produce: nothing counts entries or compares a page against the `limit` it was
asked with, so neither an empty page nor a short one is ever read as the end of the log. "Near the top" is
`isNearTop(metrics)`, a new pure predicate beside `isAtBottom` in `threadScrollPosition.ts` — a band of
`HISTORY_ASK_BAND_PX` (200) above the scroll wall, not the wall itself, because Chromium suppresses scroll
anchoring at a scroll offset of exactly zero and anchoring is the mechanism that holds the reader's place
when the page lands above them; see [Conversation shell § Thread scroll
pin](conversation-shell-scroll-pin.md) for the band's full arithmetic and the discovered scroll-event
cascade (a small prepend that doesn't clear the band is itself a scroll event, so the walk can take several
steps for one operator scroll). `ConversationScreen`'s `useThreadScrollPin` calls the new asker from
`onScroll`, right after its existing pin write, passing the container's own `conversationId`.

The same ticket corrects a premise the render layer had inherited rather than earned. `Timeline` had keyed
its rows by array index on [thread timeline](thread-timeline.md)'s own justification — "the list never
inserts mid-list" — which is true of `reduceTimeline`'s array but not of a page landing at the head via
`prependHistoryFor`: under an index key, prepending N rows makes React match key 0 to key 0, so every
already-drawn row is updated in place with a *different* item's content instead of N new nodes appearing at
the head, and Chromium's anchoring then measures its anchor node's own offset before and after and
compensates by the wrong delta — the anchor node never moved, it started rendering an earlier page's
message. Measured by mutation (reverting the fix and rebuilding): the reader's row moved from a viewport top
of 112px to 848px, pushed clean off the bottom. The fix is a fourth slice field, `prependedRows: number` —
0 on every fresh slice, raised only by the branch of `prependHistoryFor` that actually inserts rows, by
`fresh.length` and never `items.length` (a page whose rows are all held echoes moves the count by exactly
what it inserted) — read by a new `selectPrependedRowsFor(id)` and passed to `Timeline` as an optional
`firstRowKey` prop (`ConversationScreen` passes `firstRowKey={-prependedRows}`; the existing render sites
that pass nothing default to 0 and stay green). An item row now keys as `firstRowKey + index`, stable under
both mutations the list performs: an append changes neither term, so the streaming tail bubble keeps its
key; a prepend of N lowers `firstRowKey` by N while every surviving row's index rises by N, so every
already-drawn row's key is unchanged and React inserts N new nodes at the head — which is what makes
anchoring's measurement correct. The queued tail's `q`-prefixed keys are a separate namespace and cannot
collide with a negative numeric key. See [Edge cases and
limitations](conversation-timeline-store.md#edge-cases-and-limitations) on the parent page for the current
state of this fix, and [Thread timeline § Edge cases](thread-timeline.md#edge-cases-and-limitations) for
why the original premise still holds for the reducer's own array.
