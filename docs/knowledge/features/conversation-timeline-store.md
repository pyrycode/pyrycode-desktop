# Conversation timeline store

The renderer's read/write surface over the [thread timeline](thread-timeline.md) model: a dedicated,
unidirectional Zustand store wrapping the pure `reduceTimeline` reducer, plus a
`daemonEventBridge`-shaped translator + React binding that feeds it from the v2 interactive-stream
`DaemonEvent` arms, from a served history page, and from the composer's own optimistic echo. Together,
the store and its bridges are what every render slice below reads and paints — the "single, ordered
source of truth" [#203](../codebase/203.md)'s spec called for.

Introduced in [#202](../codebase/202.md), built directly on [#121](../codebase/121.md) (the pure
[thread timeline](thread-timeline.md) model, shipped). The
[keyed holder](conversation-timeline-holder.md) retains stream content and status
readings per conversation. `historyPageBridge.ts` draws served history pages and
asks for them only on qualifying upward user input near the thread top, including
the first page. Successful coverage survives failures and reconnect; only the
daemon's `atStart` ends paging. The account of how each piece
arrived is in [Conversation timeline store — history](conversation-timeline-store-history.md); this page
covers what's true today.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Internals](conversation-timeline-store-internals.md) — The store itself, the translator and React binding that feed it from the daemon event stream, and the flow between them.
- [History](conversation-timeline-store-history.md) — The ticket-by-ticket changelog of every arm, scalar, write path and channel subscriber this store and its bridges have grown.

## What it does

Turns owned `DaemonEvent` arms into `ThreadEvent`s and folds them into `TimelineState` via
`reduceTimeline`, exposing `selectItems`/`selectPhase`/`selectStalled`/`selectApiRetry`/
`selectCompacting`/`selectLocalSendPending` as the read surface. A stream arrival (an
`assistant_delta` chunk, a `turn_end` marker, a `tool_use` call, its `tool_result` outcome, a `stall`
onset, an `api_retry` edge, a `compacting` edge, `compaction_boundary` metadata, a user `message`
receipt or a `banner` report)
re-renders only components selecting a timeline slice — orthogonal to `sessionStore`
and `runConfigStore`. The `connected`→`reconnected` arm
([#538](../codebase/538.md)), is not stream content at all — it is the connection-lifecycle reconcile
that clears activity chrome on a fresh handshake while preserving held banner reports. `localSendPending`
([#650](../codebase/650.md), retyped from `boolean` to `LocalSendPending | null` by
[#1725](https://github.com/pyrycode/pyrycode-desktop/issues/1725) — see
[Thread timeline § Types](thread-timeline-internals.md#types)) is opened by neither path: it is set by the
renderer-sourced local `userText` event the composer dispatches directly (see below). Refusal recovery also dispatches
client-owned write-lifetime events into the retained conversation slice.

An observed `compacting: true` → `false` transition appends one permanent
`compactionBoundary` row in the addressed conversation. Repeated false frames add
nothing; successive compactions retain separate rows. `compact_result === 'failed'`
or any nonempty `compact_error` classifies a failure, including whitespace-only
errors. Missing outcomes and unknown result strings keep the generic label unless
an error is present. Raw outcome strings are discarded when constructing the row.

`TimelineState.pendingCompaction` holds the latest non-failed completion awaiting
metadata. A later `compaction_boundary` for that conversation replaces the referenced
row in place, even after intervening content. A new rising edge supersedes the
association; consuming a boundary or resetting the timeline clears it. Without a
matching pending row, a boundary appends its own divider. Failed rows never become
pending, so later success metadata cannot rewrite a failure. The bridge routes both
frames by their own conversation id, including while another conversation is open.
See [divider labels and styling](conversation-shell-session-and-channel-info.md#compaction-dividers).

The pending association uses row identity rather than an array index: history
prepend and removal of an earlier optimistic echo can shift indices without
changing the held row. The reducer wrapper preserves this reference across other
events, including reconnect; `prependHistoryFor` preserves it with the held items.
[`store/compaction.test.ts`](../../../src/renderer/src/store/compaction.test.ts)
pins both index-shifting cases, association consumption and supersession, failure
preservation, conversation isolation and reconnect without a false completion.

## Live user receipts

`messageReceived` translates only role `user` into `userText` with `received: true`.
`timelineTargetFor` routes its nonempty `message.conversation_id` to that conversation's
retained timeline, creating a slice when absent. It never infers the conversation on
screen. Empty ids and other roles change no thread. Other retained slices and read marks
stay unchanged; growth in a previously read background slice makes it unread through
the [existing item-count predicate](conversation-unread.md).

Receipts preserve `localSendPending`, while accepted local submission still opens
Thinking. Live time comes from `daemonTs`; unusable times and history-only rows draw
without time. A matching nonempty `message_id` returns the exact held state before
any row or sidecar mutation. Identity covers optimistic echoes, repeated receipts,
queued folding and history in either arrival order; equal text and empty/absent ids
do not suppress rows. Retaining the held row also retains local attachments, which
the received payload cannot supply. See [user event semantics](thread-timeline-internals.md#the-reducer)
and [message timestamp contract](inbound-message-decode-contract.md#public-contract).

`messageReceived` explicitly contributes no timestamp live-join key, even when
`daemonTs` is present. The history filter keeps and steps over these entries so the
message-id join can preserve held rows without stopping the adjacent stream join.
[`liveUserReceipts.test.ts`](../../../src/renderer/src/store/liveUserReceipts.test.ts)
covers held/new routing, background unread state, no-op identity and history/queue joins.
[`e2e/live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts) delivers
encrypted `message` envelopes through the mounted app, checks daemon time and observes
a held optimistic echo before the correlated receipt.

## Claude banner routing and lifetime

The [banner protocol](https://github.com/pyrycode/pyrycode/blob/main/docs/protocol-mobile.md#banner)
requires five fields: string `conversation_id`, `level` and `text`, and boolean
`stops_turn` and `truncated`. The decoder rejects missing/mistyped fields and copies
only named fields; unknown/empty levels and empty text remain valid. Main delivers
the values through typed IPC as `conversationId`, `level`, `text`, `stopsTurn` and
`truncated`, with content-free diagnostics. The session, modal and question bridges
ignore this report.

`timelineTargetFor` and `translateTimelineEvent` drop an empty conversation id;
neither infers a target from the open conversation. A nonempty id routes to its own
[retained slice](conversation-timeline-holder.md), including before that conversation
has been opened, while another is open, or with no turn running. The frame has no
`turn_id`. Each arrival appends one `banner` item in arrival order, including identical
reports; there is no content deduplication, history mapping or timestamp join key.

Exact `info` stays in state but `TimelineRow` draws nothing for it. Every other level draws
full-width, left-aligned multiline text using the session-boundary label's small
typography and shadow. Exact `warning` uses the warning token; `notice`, `suggestion`
and unknown/empty levels use the muted on-surface-variant token. Classes come from
fixed client choices, never a raw level.

Both the row and [composer report](conversation-shell-composer-status.md#claude-stopping-reports)
start with `Claude:` and render React text children. The shared `bannerDisplayText`
formatter removes terminal escapes and non-layout controls while preserving line
breaks and tabs; Markdown, HTML and URLs stay inert. Prose reaches no attributes or
logs. Both surfaces wrap long text at the 800px window minimum. The formatter appends
one `…` iff `truncated` is true, leaving the retained payload unchanged. Do not reuse
`denialDisplayText` unchanged: its additional text-length cap would contradict
banner's producer-owned truncation contract.

`TimelineState.stoppingBanner` holds the latest `stopsTurn: true` report regardless
of level, including hidden `info`. Its lifetime differs from stopped-turn recovery:

| Event | Stopping report | Retained banner items |
| --- | --- | --- |
| Stopping banner | Replaces the held report. | Appends one item. |
| Non-stopping banner | Preserves it. | Appends one item. |
| Accepted local typed/slash send (`userText`) | Clears it. | Preserves them. |
| Fresh received user row (`userText`, `received: true`) | Clears it through the shared user-event wrapper. | Preserves them. |
| Duplicate user receipt | Preserves it and the exact held state. | Preserves them. |
| Empty or blocked send attempt | Preserves it. | Preserves them. |
| Other daemon activity, trailing idle, session boundary, reconnect, navigation or history prepend | Preserves it. | Preserves them. |
| Timeline reset, holder clear or eviction | Drops it. | Drops them. |

Local acceptance means inserting the optimistic user row through
[composer send](composer-send.md). The shared wrapper also clears the report on a
fresh receipt; a matching receipt returns before that lifecycle runs. The
reducer wrapper preserves the report across other content reducers, even when they
reconstruct state. `stopsTurn` only controls display: it never interrupts, retries,
changes permission or mutates turn lifecycle. The `stoppingBanner` reading shares
the in-memory timeline lifetime. Received banner rows are saved by
[local chat history](chat-history.md#snapshot-contract), including `stopsTurn`,
without restoring the separate live reading. History replay of banners is absent;
offline snapshot restoration displays saved rows without reviving that reading.

The shipped daemon producer maps Claude's `informational` subtype, including a
captured hook-block reason. That subtype is distinct from the payload's open `level`.
There is no shipped `local_command_output` or `notification` mapping.
[`e2e/banner-reports.spec.ts`](../../../e2e/banner-reports.spec.ts) uses synthetic
multiline `/cost` output to prove client rendering and truncation, not live command
delivery. Its hook scenario crosses decoding, IPC and the mounted bridge, then waits
for the optimistic echo and captured send before asserting that only the status
cleared. Focused `banner.test.ts`/`banner.test.tsx` files cover wire narrowing,
routing, lifetime and inert rendering. See the [architecture spec](../../specs/architecture/1341-claude-banner-reports.md).

## Tool parent attribution

Live `tool_use` and `tool_result` payloads carry optional `parent_tool_use_id`.
`parseToolUsePayload` and `parseToolResultPayload` use the existing optional-string
validator: missing or empty strings become `undefined`; nonempty strings, including
whitespace, retain their exact value. Present non-strings follow the malformed-frame
policy. History uses these same parsers and skips malformed entries individually.
`toolParent.test.ts` covers both lanes and content-free diagnostics.

The live `daemonConnection` emission and history `DecodedHistoryEvent` translation
both carry `parentToolUseId` through typed IPC and `translateTimelineEvent` to the
[thread timeline](thread-timeline.md). `toolUse` stores it on the call. `fillResult`
still resolves by the result's own `toolUseId`, never the parent id, and adds no row.
A result may supply a missing parent but cannot erase or replace a known one;
orphan and duplicate result behavior is unchanged.

Attribution is an in-memory grouping hint, never authorization or diagnostic content.
Stored arrival order remains unchanged; the [tool-group display projection](conversation-shell-tool-row-header-groups.md#subagent-tool-groups)
handles orphan recovery and nesting. Assistant-text attribution is outside this feature.

History fixtures need timestamps distinct from live events unless testing replay
deduplication intentionally: the existing history/live join compares event type and
timestamp, so a reused timestamp can suppress the historical result being tested.
The replay unit test and `e2e/tool-groups.spec.ts` verify that attribution survives
history and that a replayed result actually fills its call.

## Live tool progress

`tool_progress` reports the latest elapsed seconds for an existing `tool_use` call.
The decoder requires `conversation_id`, `turn_id` and `tool_use_id` strings plus a
finite integer `elapsed_seconds`; zero and negative readings are valid. Unknown
fields are discarded, and diagnostics contain only the static event code, frame
length and hash. `daemonConnection` copies all four values by name into the
camel-case `toolProgress` IPC arm. Session, modal and question bridges ignore it.

`timelineTargetFor` routes by the frame's conversation; `translateTimelineEvent`
carries turn id, call id and seconds to the [reducer](thread-timeline-internals.md#the-reducer).
The wire call id already identifies the original call: do not substitute Claude's
synthetic heartbeat id or the tool's grouping parent. Progress replaces only a
matching pending, non-denied call's reading. Result or denial sets that reading to
`undefined`; late progress cannot restore it. No row or lifecycle transition is
created, and there is no history replay or locally inferred reading.
[Local chat history](chat-history.md#snapshot-contract) retains a received row's
optional `elapsedSeconds` as display data, without restoring a running tool.
An absent conversation is a [holder no-op](conversation-timeline-holder.md#how-it-works).

The reducer tests in `src/renderer/src/store/toolProgress.test.ts` cover conversation,
turn and call isolation, signed/decreasing readings, unchanged lifecycle state,
completion and late frames. The [tool-row documentation](conversation-shell-tool-rows.md#live-elapsed-reading)
describes the two visible consumers and the browser proof.

## Refusal records and routing

`model_refusal_fallback` and `model_refusal_no_fallback` share required string fields
`conversation_id`, `original_model`, `refusal_category` and `banner`, plus required
`truncated_fields`/`dropped_fields` string arrays or `null`. Fallback additionally
requires string `fallback_model` and `scope`. The shared live/history parsers accept
empty and unknown strings and preserve report nulls, array order and wire-key names;
missing or mistyped required fields fail decoding without payload diagnostics.

Main copies these fields into the discriminated `ModelRefusalEvent` IPC shape.
Live events carry `conversationId` and envelope `daemonTs`; history takes identity
from the request-correlated page. `translateTimelineEvent` constructs the same
`modelRefusal` item in both lanes, marking only live input eligible for recovery.
Empty live conversation ids are dropped, never assigned to the open conversation.
The session, modal and question bridges explicitly ignore both variants.

The existing [history/live join](conversation-timeline-store-internals.md#the-historylive-join-1225)
uses event type and timestamp, with no refusal-specific deduplication. History folds
return rows only; `prependHistoryFor` cannot create, revive or cancel a live offer.
Appending either refusal preserves phase, local-send state, activity indicators,
stopped-turn recovery and model-label authority. The frames contain no turn/request/
message identity with which to retract partial text. See [row display](conversation-shell-turn-status.md#model-refusal-records).

## Refusal-offer lifetime

`TimelineState.refusalOffer` is separate from retained rows. It holds the fallback
report, optional client-minted `changeId`, and optional client-owned `rejected` flag.
Each [retained conversation slice](conversation-timeline-holder.md) owns its offer;
ordinary turns and navigation preserve it.

| Event | Effect on the offer |
| --- | --- |
| Live fallback | Replaces the previous offer; exact session scope with two nonempty model ids creates one, otherwise clears it. |
| No-fallback or history record | Creates no offer and leaves any existing offer unchanged. |
| Switch back starts | Requires the exact held offer object; records its correlation and clears rejection before settings dispatch/send. |
| Matching confirmation | Retires the offer. |
| Matching rejection | Removes the correlation, retains the report and sets `rejected: true` for retry. |
| Later manual model selection | Retires the offer; the recovery write's own matching correlation is exempt. |
| Later model announcement | Retires only for a nonempty model different from the offered fallback. |
| Attributed session transition or timeline reset | Retires the offer. |
| Reconnect (`connected`) | Abandons outstanding recovery correlations across retained slices, keeping their reports available for retry. |

`subscribeRefusalRecovery` lives in `runSettingsWriteBridge.ts`, mounted by
`RunSettingsWriteData` for app lifetime with cleanup of both subscriptions. It
observes new model-write intents and live announcements/transitions, never held
model snapshots or history. Older readings therefore cannot cancel a fresh offer.
Settings replies search retained slices by exact correlation rather than the open
conversation id; a late reply from an earlier attempt cannot settle a newer offer.
Offer retirement leaves rows intact; timeline reset or holder eviction drops rows too.

Navigation's `clearRunConfig` dispatches `conversationSwitched`, erasing the general
settings store's pending writes and error while the conversation timeline survives.
Recovery presentation must read the retained correlation and rejection flag as well
as the settings store. Merely changing the open-id getter in a bridge test misses
this reset and can pass while duplicate recovery writes remain possible.
[`store/modelRefusal.test.ts`](../../../src/renderer/src/store/modelRefusal.test.ts)
dispatches the actual reset; static renders inject an empty settings store. The
[fake-transport scenarios](../../../e2e/model-refusal.spec.ts) hold a reply across
A → B → A, reject both after returning and while away, then retry and confirm.
They also cover conversation isolation, action retirement and slot priority.
This proves Desktop dispatch and UI behavior, without requiring a live Claude refusal.

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
- Live conversation-owned events route through `timelineTargetFor` into the keyed
  holder; the legacy flat store remains dual-written. Refusal recovery reads and
  updates the retained keyed slice, never the flat slot.
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
  indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725).
- **`useHistoryPageBridge()` mounts in `App.tsx`** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)),
  beside `useQuestionBridge()` rather than replacing it — the first rework pass on this ticket landed a
  hunk that deleted the neighbouring call while keeping its now-unused-looking import, which compiled and
  passed every renderer unit test (a static server render mounts no effects) and only reddened the three
  `question-*` e2e specs. Takes no `openConversationId` unlike `useTimelineBridge`: a page's
  `conversationId` is required and client-owned, so there is nothing to fall back to.
- **`historyPageBridge.ts` has one asker, `requestOlderHistory`.** Its production
  caller is the scroll pin's trusted upward input handler, never activation or
  `onScroll`. `historyAskDeps` reads the current held slice and supplying host,
  marks before sending, and uses retained successful coverage independently of
  pending/failed request state. See [history admission](chat-history.md#received-state-admission-and-ownership).

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
- **Compaction liveness and retained completion are separate.** The `compacting`
  boolean survives turn activity and clears on its falling edge, reconnect or reset.
  A reconnect clears status directly, never by dispatching a synthetic false frame,
  so it cannot manufacture a completed divider. Received rows and any pending
  metadata association survive scrolling, navigation and reconnect while the
  [keyed holder](conversation-timeline-holder.md) retains that conversation.
- **Held state and saved rows have separate lifetimes.** A timeline reset, holder
  clear or eviction drops its in-memory dividers and pending association.
  [Local chat history](chat-history.md#storage-and-concurrency) retains received
  divider rows on disk and restores them on demand while offline, never the pending
  association. This feature does not recover missed offline events or replay
  `compaction_boundary` from history. History's existing `compacting` decoder carries
  outcomes, but prepending its reduced rows does not create a live pending association.
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
- **A prepend keys off the conversation's origin, not the head of the held array**
  ([#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260), fixing what [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)
  shipped). `ConversationScreen` originally keyed timeline rows by array index (see [Thread timeline §
  Edge cases](thread-timeline-limits.md#edge-cases-and-limitations)) on the premise that the list never inserts
  mid-list — true of `reduceTimeline`'s own array, false of a page landing at the head via
  `prependHistoryFor`. Under an index key, prepending N rows made React match key 0 to key 0, so every
  already-drawn row was updated in place with a *different* item's content instead of N new nodes
  appearing at the head; Chromium's scroll anchoring then measured its anchor node's own offset before
  and after and compensated by the wrong delta, since that node never actually moved. Not harmless
  reconciliation churn: measured by mutation, the reader's row drifted from a viewport top of 112px to
  848px. The slice now carries a fourth field, `prependedRows: number` (0 on every fresh slice, raised by
  `fresh.length` — never `items.length` — only on the branch of `prependHistoryFor` that actually
  inserts), read by `selectPrependedRowsFor(id)` and passed to `Timeline` as an optional `firstRowKey`
  prop (`ConversationScreen` passes `firstRowKey={-prependedRows}`; every pre-#1260 render site passes
  nothing and defaults to 0). An item row keys as `firstRowKey + index`, unchanged by an append and
  shifted by exactly a prepend's count, so every surviving row keeps its key and only the new rows are
  new.
- **`prependHistoryFor` is not idempotent, by design** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)).
  Applying the same page twice prepends its non-`userText` rows twice — only `userText` rows are
  suppressed, by the AC4 echo dedup. Unreachable today; see § the write path above for why a guard was
  deliberately not built here.
- **User demand checks the near-top band, including zero.** Unknown coverage asks
  for the first page; received coverage uses its retained cursor unless `atStart`
  is true. Local reads and pending requests discard demand. Empty/short pages and
  prepend scroll events do not chain requests; failures require new connected
  input. See [history admission](chat-history.md#received-state-admission-and-ownership)
  and [zero-offset compensation](conversation-shell-scroll-pin.md#user-demand-and-prepend-position).

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
  `sessionTransition`/`connected` as the only two id-less owned arms at the time — the group
  [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) goes on to attribute, until
  [#1559](https://github.com/pyrycode/pyrycode-desktop/issues/1559) narrows it to `connected` alone.
- [#785](https://github.com/pyrycode/pyrycode-desktop/issues/785) — `timelineWriteTarget`, the write-key
  resolution downstream of `timelineTargetFor`: at the time, filed `sessionBoundary`/`reconnected` into
  the retained slice of the conversation on screen (or dropped them, inventing no key, when none was
  open) via an injected `getOpenConversationId` getter from `App.tsx`, keeping `timelineTargetFor` and
  `subscribeTimeline` byte-identical. Spec: `docs/specs/architecture/785-open-conversation-timeline-arms.md`.
- [#1559](https://github.com/pyrycode/pyrycode-desktop/issues/1559) — routes the session-reset
  separator by the frame's own `conversationId` instead of the conversation on screen. Moves
  `sessionTransition` into `timelineTargetFor`'s id-carrying group (`connected` is now the only arm
  left there) and drops `sessionBoundary` from `timelineWriteTarget`'s open-conversation fallback
  (`reconnected` is now the only arm that reads it). Fixes both the cross-conversation misfile (reset
  channel A, switch to channel B mid wrap-up, and the divider used to draw in B) and the #1225 duplicate
  divider this arm caused by contributing no live join key. Spec:
  `docs/specs/architecture/1559-session-boundary-routing.md`.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — the `now?: () => number` clock
  parameter on `translateTimelineEvent`/`subscribeTimeline`, and `useTimelineBridge`'s `Date.now` wiring:
  implementation summary above. See [Thread timeline § Types](thread-timeline-internals.md#types) for the full
  `createdAt` contract this seam feeds.
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
- [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223) — draws a served history page: widens
  `translateTimelineEvent`'s parameter to `DaemonEvent | HistoryTimelineEvent`, adds its tenth owned arm
  (`messageReceived`→`userText`, initially history-only; now also routed live as described above), and adds the fifth channel subscriber
  (`historyPageBridge.ts`) and fifth store write path (`prependHistoryFor`) covered in full above.
  Blocked-by [#1222](request-history-send.md) (the ask + transport decode) and
  [#1227](request-history-send.md) (the per-entry payload decode); [#1224](https://github.com/pyrycode/pyrycode-desktop/issues/1224)
  split into [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) (the opening ask) and
  [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) (the walk), both shipped — see below —
  and [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) (joining a page to the live
  stream) has since shipped too. Spec:
  `docs/specs/architecture/1223-draw-a-history-page-through-the-timeline-reducer.md`.
- [#1259](https://github.com/pyrycode/pyrycode-desktop/issues/1259) — the opening ask, covered above; split
  from #1224 alongside [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) (the walk). Spec:
  `docs/specs/architecture/1259-history-on-open.md`.
- [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) — the walk: `requestOlderHistory`
  beside `requestOpeningHistory` (both now under the renamed `historyAskDeps`), the `prependedRows`
  slice field and `Timeline`'s `firstRowKey` prop that make a prepend key-stable, covered above and in
  full in [History](conversation-timeline-store-history.md). See [Conversation shell § Thread scroll
  pin](conversation-shell-scroll-pin.md) for the trigger band and `thread-scroll-pin.spec.ts` for the
  anchoring proof. Spec: `docs/specs/architecture/1260-history-scroll-back-walk.md`.
- [#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) — the last slice of the #1088 family:
  joins a served page to the live stream on (`type`, `ts`) so an entry present on both draws once. Adds
  `daemonTs` (optional envelope metadata, initially forwarded on ten arms and now also on user receipts —
  see [Daemon event channel — emit and subscribe §
  `DaemonEventTimestamp`](daemon-event-channel-plumbing.md#daemoneventtimestamp--the-per-frame-comparand-1225)),
  a `liveKeys` set on `ConversationSlice`, and a page-side `withoutLiveEntries` pre-filter in
  `historyPageBridge.ts` that suppresses only a contiguous run at the page's newest end — never a scatter,
  which the rework leg found could strand a `tool_result` or fold a turn's text out of order. Every
  unresolvable case fails open (a duplicate row), never closed (a dropped one). Covered in full in
  [Internals § The history/live
  join](conversation-timeline-store-internals.md#the-historylive-join-1225) and in
  [History](conversation-timeline-store-history.md). Spec, including the full security review and both
  MUST FIX Revisions: `docs/specs/architecture/1225-history-live-join.md`.
