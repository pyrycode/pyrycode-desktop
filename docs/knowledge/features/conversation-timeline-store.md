# Conversation timeline store

The renderer timeline store and bridge fold typed daemon events and local sends into
conversation timelines. The [keyed holder](conversation-timeline-holder.md) retains
each conversation's rows and transient state; it is the chat pane's render source.
The legacy flat store remains dual-written.

## Where the detail lives

- [Internals](conversation-timeline-store-internals.md): reducers, translation, subscriptions and history joins.
- [Compaction](conversation-timeline-store-compaction.md): completion dividers and delayed metadata association.
- [Claude banners](conversation-timeline-store-banners.md): report routing, retention and stopping-banner lifetime.
- [Configuration and usage](conversation-timeline-store-usage.md): mounts, selectors and write paths.
- [Limits](conversation-timeline-store-limits.md): ordering, status reconciliation, send windows and prepend identity.
- [Related contracts](conversation-timeline-store-related.md): transport and store dependencies.
- [History](conversation-timeline-store-history.md): the earlier implementation record.

## What it does

Translates owned `DaemonEvent` arms into `ThreadEvent`s and folds them through
`reduceTimeline`. Conversation-owned deliveries update their retained slice;
session and run-configuration state remain independent. The `connected` →
`reconnected` reconcile clears activity chrome while preserving rows and held
banner reports. A post-replay running-phase reassertion restores the open
conversation's status; silence leaves it idle when the turn ended offline. See
[replay and phase reconciliation](conversation-timeline-store-limits.md#edge-cases-and-limitations).
Only accepted local `userText` opens `localSendPending`, holding
`{ messageId, queued }` or `null`; daemon receipts cannot open it. Refusal recovery
also dispatches client-owned events into the retained slice. See
[selectors and write paths](conversation-timeline-store-usage.md#configuration-and-usage).

`sessionError` routes by its own conversation id like `stallDetected`, never by the
open thread, and contributes no history join key. The optional `TimelineState.sessionError`
holds `{ code: string }`; newer errors replace it. Receipt sets
the addressed timeline's phase to idle, closes `localSendPending` and clears stall,
API retry, compaction and thinking-token feedback. This removes stale “Sending…”,
“Waiting for Claude” and “Thinking…” without changing rows or the reported queue,
resending or dropping anything. Another conversation's error leaves the open
thread's notice and pending send untouched. The [Top overlay](conversation-shell.md#what-it-does)
maps the code to three fixed copies and shows a non-dismissible Error pill after
usage/permission resolution and before Re-pair.

The notice clears on accepted local `userText`, any non-idle `turnState`, timeline
`reset`, or the daemon's `sessionTransition(reason: 'clear')` → `sessionBoundary`.
Idle states, received user echoes, other content, workspace-change/idle-eviction
boundaries and history reconstruction preserve it. Leaving its displayed
conversation or exiting the screen consumes it through `sessionErrorCleared`;
reopening cannot replay it. Off-screen notices remain held until opened or cleared.
On a main-stamped host `connected` event, the bridge clears notices in every retained
slice for that host before reconciling the open timeline. Other hosts' slice references
and all rows remain intact. Generic `reconnected` preserves the notice because it
has no host attribution; open-timeline reconciliation alone would miss held errors.

See [compaction completion and metadata](conversation-timeline-store-compaction.md#what-it-does)
for retained dividers and pending associations.

Paged history also reconstructs finished background Agents from retained start/finish
evidence, attaching launches and children loaded on older pages. The projection places
each full row at its first terminal entry and leaves a navigation marker at launch,
without replay changing live roster membership or turn state. See
[history placement and page anchors](conversation-timeline-store-internals.md#background-agent-history-placement)
and [qualification](background-task-roster-store-internals.md#retained-agent-timeline-evidence).

## Live user receipts

`messageReceived` translates only role `user` into `userText` with `received: true`.
`timelineTargetFor` routes its nonempty `message.conversation_id` to that conversation's
retained timeline, creating a slice when absent. It never infers the conversation on
screen. Empty ids and other roles change no thread. Other retained slices and read marks
stay unchanged; growth in a previously read background slice makes it unread through
the [existing item-count predicate](conversation-unread.md).

Receipts preserve `localSendPending` and session-error notices, while accepted local
submission clears the notice and opens “Sending…”. Live time comes from `daemonTs`;
unusable times and history-only rows draw without time. A matching nonempty
`message_id` preserves held row content and local attachments, which the received payload
cannot supply. Optional `queued_msg_id` and `sent_now` translate to `queuedMsgId` and
`sentNow` through the same mounted typed event path. Owned queued receipts settle before
content/chrome reduction; exact bound queue identity precedes eligible unbound message-id
fallback. Already settled repeats retain no-op identity. Legacy held/history deduplication
still applies to other matching receipts, except metadata distinguishing a different bound
entry. Equal text and empty/absent ids do not establish ownership or suppress rows.
See [settlement, mixed delivery and late receipts](thread-timeline-internals.md#queued-own-echo-settlement)
and [message timestamp contract](inbound-message-decode-contract.md#message-receipts-and-timestamps).

`messageReceived` explicitly contributes no timestamp live-join key, even when
`daemonTs` is present. The history filter keeps and steps over these entries so the
message-id join can preserve held rows without stopping the adjacent stream join.
[`liveUserReceipts.test.ts`](../../../src/renderer/src/store/liveUserReceipts.test.ts)
covers held/new routing, background unread state, no-op identity and history/queue joins.
[`e2e/live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts) delivers
encrypted `message` envelopes through the mounted app, checks daemon time and observes
a held optimistic echo before the correlated receipt.

## Claude banner routing and lifetime

See [claude banners](conversation-timeline-store-banners.md#claude-banner-routing-and-lifetime).

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

Attribution is a display grouping hint, never authorization or diagnostic content.
Stored arrival order remains unchanged; the [tool-group display projection](conversation-shell-tool-row-header-groups.md#subagent-tool-groups)
handles orphan recovery and nesting. Tool and assistant parent hints also survive
[saved history](chat-history.md#snapshot-contract).

History fixtures need timestamps distinct from live events unless testing replay
deduplication intentionally: the existing history/live join compares event type and
timestamp, so a reused timestamp can suppress the historical result being tested.
The replay unit test and `e2e/tool-groups.spec.ts` verify that attribution survives
history and that a replayed result actually fills its call.

## Assistant parent attribution

Live and history `assistant_delta` share
[optional parent validation](inbound-message-decode.md#optional-assistant-parent-attribution).
`daemonConnection` copies the live hint by name; `DecodedHistoryEvent` and
`HistoryTimelineEvent` retain the history hint. Both reach `translateTimelineEvent`
as `parentToolUseId`, which forwards it onto `ThreadEvent.assistantDelta` and then
`ThreadItem.assistantText`, without consulting the current agent roster.

The reducer coalesces only adjacent assistant deltas with equal turn **and** parent,
keeping the first stamp. Main-thread text and two helpers sharing a turn must not
merge into one bubble. Stored rows remain in arrival order; loaded Agent/Task calls,
including completed calls, own matching text in the
[display projection](conversation-shell-tool-row-header-groups.md#subagent-tool-groups).
An absent owner or a matching ordinary tool leaves the reply top-level. Prepending
history with the owner recomputes grouping over the same retained reply, without
creating a duplicate or rewriting attribution.

`toolGroups.test.tsx` covers parent-aware coalescing, two interleaved parents,
history translation and late completed-owner recovery. Snapshot round trips retain
the hint without changing version 1; older parentless rows retain their reading.

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

See [configuration and usage](conversation-timeline-store-usage.md#configuration-and-usage).

## Edge cases and limitations

- **Transient notices cannot own saved-history reads by slice identity.** Opening an
  empty same-host slice preserves its unseen error. `localReadOwner`, a process-local
  symbol checked with host and loading status, survives notice replacement, client
  consumption and host error clearing. Completion/failure uses current sidecars,
  preventing a cleared notice from returning or a read from remaining loading forever.
  Live content, local sends, cancellation, eviction and host replacement still invalidate
  the request; settled handles cannot settle again. Neither owner nor notice is saved.
  See [local admission](conversation-timeline-holder.md#local-timeline-admission).
- **Navigation cleanup must distinguish departure from StrictMode effect replay.**
  The overlay keys cleanup by conversation, defers consumption to a microtask and
  checks its mounted-conversation ref. Immediate setup cancels consumption; actual
  navigation consumes the departed notice without clearing a replacement while open.
  Client clearing preserves host/read ownership and creates no absent slice. See
  [development-runtime proof](development-verification.md#what-each-test-tier-proves).

See [timeline limits](conversation-timeline-store-limits.md#edge-cases-and-limitations)
for ordering, status reconciliation, send windows and prepend identity.

## Related

See [related contracts](conversation-timeline-store-related.md#related).
