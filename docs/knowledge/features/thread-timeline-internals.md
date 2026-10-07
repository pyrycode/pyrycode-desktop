# Thread timeline — how it works

Part of [Thread timeline](thread-timeline.md).

## How it works

### Types

```ts
type TurnPhase = 'thinking' | 'responding' | 'idle'
type SessionBoundaryReason = 'clear' | 'idle_evict' | 'workspace_change'
interface ToolResult { isError: boolean; resultSummary: string; resultDetail?: string }
interface ToolDenial {
  toolName: string
  decisionReasonType: string
  decisionReason: string
  message: string
  truncatedFields: readonly string[] | null
  droppedFields: readonly string[] | null
}
interface MessageAttachment { attachmentId: string; filename: string }

type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string; createdAt?: number; parentToolUseId?: string }
  | { kind: 'toolCall'; turnId: string; toolUseId: string; parentToolUseId?: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>>; result: ToolResult | null; denial?: ToolDenial; elapsedSeconds?: number }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string
      ; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string
      ; durationMs?: number; inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; outputTokens?: number; costUsdTotal?: number }
  | { kind: 'userText'; text: string; createdAt?: number; messageId?: string; attachments?: readonly MessageAttachment[] }
  | { kind: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  | { kind: 'compactionBoundary'; failed: boolean; manual: boolean; preTokens?: number | null; postTokens?: number | null }

type ThreadEvent =
  | { type: 'messageDelivery'; messageId: string; serverId?: string | null; status: 'waiting' | 'not-sent' | 'written' }
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string; parentToolUseId?: string; createdAt?: number }
  | { type: 'toolUse'; turnId: string; toolUseId: string; parentToolUseId?: string; name: string; inputSummary: string; input?: Readonly<Record<string, string>> }
  | { type: 'toolDenied'; turnId: string; toolUseId: string; denial: ToolDenial }
  | { type: 'toolProgress'; turnId: string; toolUseId: string; elapsedSeconds: number }
  | { type: 'toolResult'; turnId: string; toolUseId: string; parentToolUseId?: string; isError: boolean; resultSummary: string; resultDetail?: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string
      ; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string
      ; durationMs?: number; inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; outputTokens?: number; costUsdTotal?: number }
  | { type: 'userText'; received?: true; queuedMsgId?: number; sentNow?: boolean; text: string; createdAt?: number; messageId?: string; attachments?: readonly MessageAttachment[] }
  | { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  | { type: 'stallDetected' }
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  | { type: 'compacting'; active: boolean; compactResult?: string; compactError?: string }
  | { type: 'compactionBoundary'; trigger: string; preTokens?: number | null; postTokens?: number | null }
  | { type: 'reset' }
  | { type: 'reconnected' }
  | { type: 'dropUserText'; messageId: string; queuedMsgId?: number }
  | { type: 'thinkingProgress'; estimatedTokens: number }

interface TimelineState { items: readonly ThreadItem[]; phase: TurnPhase; stalled: boolean; apiRetry: ApiRetryStatus | null; compacting: boolean; localSendPending: LocalSendPending | null; thinkingTokens: number | null; latestTurnEnd?: Extract<ThreadEvent, { type: 'turnEnd' }>; pendingCompaction?: Extract<ThreadItem, { kind: 'compactionBoundary' }> }
interface ApiRetryStatus { current: number; total: number }
interface LocalSendPending { messageId: string; queued: boolean }
```

`ThreadItem` is the durable, ordered content; `ThreadEvent` is the renderer-local (camelCase,
`conversation_id`-free) input the reducer consumes. **`turn_state` is deliberately not a
`ThreadItem` member** — it's a coarse conversation-level lifecycle scalar (the "thinking…"
indicator), so it's carried as `phase` beside `items` rather than interleaved as a timeline row.
**`stalled` ([#317](../codebase/317.md)) is a second such scalar** — a coarse, onset-only stall flag
set by the nullary `stallDetected` arm and self-cleared by the reducer on the next turn-activity
arm, likewise never a `ThreadItem` row. **`apiRetry` ([#493](../codebase/493.md)) is a third such
scalar**, but a record rather than a flag (`ApiRetryStatus | null`, not `boolean`) — present holds the
live `{ current, total }` attempt counter, `null` means no retry in flight. Unlike `stalled`, it does
**not** self-clear on turn activity: the wire's `api_retry` frame has an explicit falling edge
(`active: false`), so the reducer clears it only on that edge, carrying it through unchanged on every
other arm — the deliberate inverse of `stalled`'s clearing rule. **`compacting` ([#496](../codebase/496.md))
is a fourth such scalar**, back to a plain flag like `stalled` — but with `apiRetry`'s inverted clearing
rule, not `stalled`'s: the wire's `compacting` frame also carries an explicit falling edge, so it clears
on that edge or a reconnect/reset and survives turn activity. It stays `boolean`:
completion outcomes and delayed counts belong to retained `compactionBoundary` rows,
with `pendingCompaction` identifying the row awaiting metadata. See
[compaction lifetime](conversation-timeline-store-compaction.md#what-it-does).
**`localSendPending` ([#650](../codebase/650.md)) is a fifth such
scalar** — set by local `userText` (the composer's own accept signal, no separate event);
live and history receipts carry `received: true` and preserve either pending value. It is cleared
by daemon turn activity, and also by an admitted local waiting/not-sent delivery update;
its full rationale, the working-indicator consumer, and
what a `dropUserText` removal (below) deliberately leaves it as live in [Conversation shell §
Thinking / working indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725),
not restated here.

**[#1725](https://github.com/pyrycode/pyrycode-desktop/issues/1725) retypes the scalar from `boolean` to
`LocalSendPending | null`**, so the open window can distinguish "sent, not yet seen by the daemon" from
"the daemon's queue has it." `null` is the closed window, unchanged in meaning. An open window names the
newest local send's composer-minted `messageId` (`''` when the `userText` event carried none — a value no
queue item can match) and a `queued` flag that starts `false`. On 2026-10-03 the daemon accepted a message
while its claude child was crash-looping, and the pre-#1725 boolean gave the working indicator no way to
tell that apart from an ordinary in-flight send — the row read "Thinking…" for minutes. The daemon already
says when it holds a message: every `send_message` is enqueued, and each enqueue pushes a `queue_state`
whose items carry the client's own `message_id` (pyrycode#2092), so
the window's `queued` flag is this scalar's honest proxy for "the daemon has it," independent of whether
claude itself has started.

The pure `markLocalSendQueued(state, queued: readonly QueuedItem[]): TimelineState`, exported beside the
selectors (below), associates local echoes with queue entries and records removal independently of
the newest-send indicator. For that indicator, it advances `queued` only when the window is open,
not yet queued, its id is nonempty and a snapshot item has the same `message_id`.
**`queued` is sticky: nothing ever sets it back to `false`.** Claude can commit the item,
and a later snapshot without it can arrive, before `turn_state{thinking}` does, so re-reading `false` from
an item's absence would be a regression, not a correction. `markLocalSendQueued` is not itself a
`reduceTimeline` arm — no `ThreadEvent` carries a queue snapshot — it is called directly by
[`ConversationTimelineStore.markLocalSendQueued`](conversation-timeline-holder.md#how-it-works) from the
[queue bridge](queue-store.md#the-data-path-srcrenderersrcstorequeuebridgets)'s snapshot callback. See
[Conversation shell § Thinking / working
indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725)
for the "Sending…" / "Waiting for Claude" labels this feeds.

**Retyping a scalar from `boolean` to a record is invisible to `expect(...).toBe(true)`.** `toBe` accepts
any type, so every pre-existing assertion comparing `localSendPending` (or a value derived from it)
against the literal `true` kept compiling after this retype — `tsc` gave no signal, unlike the
`required`-prop retypes elsewhere in this file and in the [working
indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725)
that `tsc` does catch. Only running the suite surfaced the one assertion #1725 left stale. A boolean
scalar's tests are worth grepping for `toBe(true)`/`toBe(false)` before a retype, not just for the
type's own usage sites.

**`thinkingTokens` ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314), decoded at
[#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312), carried by
[#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313)) is a sixth such scalar, and the first
to carry a reading with no edge of its own** — `number | null`, the daemon's latest running thinking-token
estimate for the open conversation, or `null` when none is held. Like `apiRetry` it is `| null` rather
than a plain flag, because there is a value to carry; unlike `apiRetry` the payload is a bare `number`, not
a record — one reading, nothing to pair it with. **`0` is a held reading, not an absence**: the wire has no
`omitempty`, so the daemon's zero is legal traffic, and the field is `| null` specifically so "no reading
yet" and "a reading of nothing" stay distinguishable. It is also **not monotonic** — the value restarts
near zero at every inference-request boundary, several times inside one committed turn capture — so the
arm assigns the latest reading rather than comparing magnitudes; there is no `Math.max` here and never
should be. Its clearing rule matches neither `stalled`'s (turn activity does **not** clear it — claude
interleaving a tool call with its thinking must not blank a live reading) nor `apiRetry`/`compacting`'s
(there is no falling edge on the wire to wait for): it clears on a `turnState` that is not `'thinking'`, on
`turnEnd`, and on `reconnected`, plus `reset` for free — see § The reducer.

**`toolCall.input` / `toolUse.input` ([#643](../codebase/643.md)) is not a seventh scalar** — it's an
optional field on an existing arm/item pair, the tool's own input fields as name → value
(pyrycode#1678, decoded at the transport by [#642](../codebase/642.md)). Absent means the wire omitted
it (a pre-#1678 daemon); an empty map is the distinct fact "this daemon sent no fields for this call."
Both the bridge and the reducer carry it unchanged and by reference — no store-level interpretation,
no key singled out, no value shortened. Ships dormant: `reduceTimeline`'s `toolUse` arm appends it
onto the `toolCall` item, but no render reads it yet — that's
[#645](https://github.com/pyrycode/pyrycode-desktop/issues/645).

**`result.resultDetail` ([#773](../codebase/773.md)) is the same kind of widen, on the outcome side.**
It is an optional field on `toolResult`/`ToolResult`, not a new scalar or item kind — the daemon's short
précis of a tool call's structured outcome (`"265 lines"`, `"110 of 1676 lines"`, pyrycode#2024). Unlike
`toolCall.input`, absence and `''` are not given different meanings here: the upstream contract states
both mean "no count," so absence means only "a daemon predating pyrycode#2024." Both states are still
carried faithfully rather than collapsed into each other, because collapsing is a lossy transform, not
because the two states mean different things. `fillResult`'s existing spread needed no change to
preserve the field, the same as `input`'s widen. Ships dormant — the sole consumer is
[#856](https://github.com/pyrycode/pyrycode-desktop/issues/856), which also owns the decision that
neither absence nor emptiness draws anything.

**`createdAt` ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) is a third field-pair widen, on `assistantText`/`userText`
and their matching event arms** — epoch milliseconds. Assistant bubbles and local echoes use an
optional injected renderer clock. Live user receipts instead use the daemon envelope's `ts`,
forwarded as `daemonTs` and parsed only when at most 64 characters and finite. Missing, empty,
overlong or invalid times leave the row unstamped; receipts never read the arrival clock.
History-only translation supplies no `createdAt`, even though the entry has a join timestamp.
See [message timestamp contract](inbound-message-decode-contract.md#message-receipts-and-timestamps). Unlike `input` and
`resultDetail`, the clock is **not** threaded through `reduceTimeline` as a parameter — the field rides
the event instead, and the reason is worth stating because it is not the one the ticket's own two
cascade-count ceilings (55 reducer call sites, 68 event literals) would suggest: **the two timeline
stores (`timelineStore.ts`, `conversationTimelineStore.ts`) call `reduceTimeline` from production code**,
so a clock parameter there — optional or not — would stamp every item the stores' own specs assert on
with `toEqual`, reddening 13 of the 19 fixed expectation sites the ticket fenced. A cascade-count ceiling
answers "how many call sites move"; it does not answer "are any of them production," which is what
actually decided the seam here. `translateTimelineEvent`/`subscribeTimeline`
([conversation timeline store](conversation-timeline-store.md)) and `ComposerSendDeps.now`
([composer send](composer-send.md)) take the clock instead, both as an **optional trailing parameter with
no wall-clock default** — an absent
clock means no local stamp, which is what keeps all 135 pre-existing `assistantText`/`userText`
fixture sites compiling and passing unedited. `appendDelta` (below) preserves the assistant timestamp:
only the fresh-append case takes the incoming stamp, so a coalesced bubble keeps its *first*
delta's time. [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) (shipped) is the sibling
slice that renders it into the meta row [#969](../codebase/969.md) left empty — see [Conversation shell —
message bubble § The meta row](conversation-shell-message-bubble.md#the-meta-row).

**`attachments` ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) is a fourth field-pair
widen, on `userText` and its matching event arm only** — `readonly MessageAttachment[]`, the files the
operator attached to *that* message, in the order their uploads completed. The first thing in this app
that associates an attachment with a message: `attachmentId` is the daemon's own id (`driveUpload` sends
`attachment_id: uploadId`, so it names the file the host stored, not a local correlation key) and
`filename` is [#1038](../codebase/1038.md)'s display name, its first consumer. Field names match
`AttachmentSaveRequest` (`src/shared/ipc/attachmentSave.ts`) so a future save leg can take the record with
no remap — a **declaration**, not an import: this module pulls in no IPC contract to save four words, the
same call `SessionBoundaryReason`'s re-declaration already makes at the wire boundary.

**Absent means none, and unlike every field above it there is no empty-vs-absent distinction to carry** —
test `item.attachments === undefined`, never `'attachments' in item`, the same idiom as `createdAt`. The
sole producer, [composer send](composer-send.md)'s `submitMessage`, normalises an empty pending set to
`undefined` *before* building the event, so `reduceTimeline` never has to decide what `[]` means; it
carries whatever arrives, unconditionally and **by reference** — never a spread, which on an absent list
would silently mint `[]` and convert "this message carried none" into "this message carried an empty set."
Like `createdAt`, the field rides the event rather than a `reduceTimeline` parameter, for the same
call-sites-are-production reason. Ships live, not dormant: #1039 also wired the sole producer in the same
commit, so `selectItems` can carry a filled `attachments` list from the day the field exists — #815 (the
non-image file row) has since shipped its renderer, in [Conversation shell — message bubble § The
attachment file row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816); #868 (the image
thumbnail, and #869's click that opens it) has since shipped too. See [Composer attach § Pending
attachments](composer-attach-pending.md#pending-attachments-1039) for how the composer accumulates the set between
sends, and [Thread timeline — history](thread-timeline-history.md#configuration-and-usage) for the ticket
note.

**`messageId` ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)) is a fifth field-pair
widen, on `userText` and its matching event arm only, but for a different reason than the four above** —
not display, but correlation. It is the id [composer send](composer-send.md)'s `submitMessage` already
mints for the message's own `send_message` wire frame, retained on the echo unconditionally rather than
discarded once the frame is sent — one mint, two uses, so the wire and this row can never name different
messages. It exists so a later `dropUserText` (below) can find the echo again when the operator cancels
the queued message it stood for: the daemon parks a mid-turn send instead of running it and echoes the
same id back on the [queue store](queue-store.md)'s `QueuedItem.message_id`
(pyrycode#2092), and nothing else the two rows share is a key (`text` is not unique, position mis-aligns
on the first drop). Absent means the producer minted none — test `item.messageId === undefined`, never
`'messageId' in item`, since the reducer assigns it unconditionally. Live receipts and history rows
carry the daemon's `message_id`; a nonempty match also suppresses a receipt or history duplicate,
preserving the held row. Empty/absent ids suppress nothing, and equal text is never identity.
An id-less echo cannot be removed by a drop. Untrusted on the read side, on the same terms as `text`: the value it is compared against arrives
from another client through a content-blind relay, so it is read for strict string equality only — never
a lookup path, a cache key, a filename, a URL, a `Map` key or a React key. Rendering uses client-owned
numeric row keys, independently of message identity. Field-for-field identical between the item and the event; production
always carries one (`submitMessage`'s `newMessageId` is required), but it stays optional on both types
because the union is constructed unstamped in dozens of specs and requiring it would buy nothing an
id-less, un-droppable row doesn't already give for free.

`foldQueuedRows` joins the [queue store](queue-store.md)'s entries only to retained local echo
records, not to arbitrary user rows with equal ids. `dropUserText` likewise selects a local record;
its optional queue id distinguishes colliding entries. See [queued settlement](#queued-own-echo-settlement)
and the [render projection](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213).

### Queued own echo settlement

Local submission with a nonempty message id creates a `localEchoes` sidecar naming a stable
numeric `rowKey`, the message id, whether it waited behind running content and its observed
`waitTurnId`. Neither received/history rows nor other item kinds create ownership records;
equal text and empty/absent ids cannot establish ownership. `localSendPending` tracks only
the newest send and cannot serve as this inventory.

Snapshots bind unbound, unsettled records one-to-one by nonempty message id, reserving queue
ids already assigned to another record. Once bound, only that conversation's `queuedMsgId`
matches. The holder rejects another trusted receipt host before association or release.
`queueStore` still holds replacement snapshots; the timeline retains only local facts.
Snapshot removal marks a bound record `released` without settling or deleting its row.
Projection therefore keeps an unconfirmed waiting echo below continuing assistant/tool
content, even after removal, and keeps multiple echoes in submission order. Snapshot presence
alone controls queued styling and Drop, including receipt-before-removal.

A received user event first selects an exact bound queue id, then an eligible unsettled,
unbound local record by nonempty message id. A settled unbound echo must not shadow a newer
colliding entry. Ordinary settlement moves the original item and key after the observed
predecessor boundary (`afterKey`), or to the delivery point when no boundary is known.
The first matching `turnEnd` captures that boundary; later turns cannot overwrite it.
Idle sends that never waited locally retain immediate placement. `sentNow: true` instead uses the stream delivery
point inside the running turn. Removal never implies Send now. Queue ids name entries,
not turns: Codex commit-at-write and no-echo idle fallback do not supply ordinary Claude's
echo-before-answer guarantee, so late receipts use the boundary already observed.

After either forced or ordinary settlement, still-held unsettled successors sharing the
predecessor start waiting behind the current turn. Released successors keep their boundary
for late receipts. Excluding forced delivery here reverses a later ordinary delivery;
advancing released entries instead inserts older echoes into a subsequent reply.
Settlement preserves text, original local time, attachments and row identity, and returns
before content/chrome reduction so it cannot split, finalize or reset the next reply.
Later receipts and snapshots cannot move a settled row. Metadata-free confirmation of an
unbound echo that never waited for transport marks it settled without moving it; repeats retain legacy no-op
identity, and later snapshots cannot claim it. Admitted foreign receipt queue ids are
tracked separately for idempotence when a bound local entry shares their message id.

`dropUserText` removes only the selected local row, key and correlation record; it cannot
delete a received/history row through an id collision. Reset/holder eviction clears local
facts. Reducer coverage lives in `queuedEchoSettlement.test.ts`; mounted encrypted-stream
coverage in `e2e/queued-own-settlement.spec.ts` includes both snapshot/receipt orders,
mixed forced/ordinary delivery, continuing output and restored row identity.

### Local transport delivery

`localEchoes` also holds `delivery?: 'waiting' | 'not-sent'` and sticky `held?: true`.
Keep these facts in the sidecar: changing `ThreadItem` to carry presentation state
would change message object identity and the durable saved-history row contract.
`messageDelivery` is handled before the content fold and finds an unsettled local
record by message ID, verifies its row is `userText`, and refuses to overwrite a
record already bound to a daemon queue ID. Missing, foreign and settled identities
are exact-state no-ops. Waiting marks `held` and clears `localSendPending`; Not sent
also clears that scalar, without changing text, attachments, row keys or timestamps.
Written clears the label and preserves the pending scalar, without acknowledging receipt.

`foldQueuedRows` includes waiting echoes in pending placement without inventing queue
IDs or Drop controls. Queue association clears delivery; a user receipt also clears
it and settles the original row. A previously held echo takes the normal delivery
placement path even with a metadata-free receipt and no queue ID, so it can appear
before its reply rather than remain pinned below later content. Settled duplicate
receipts cannot move it again. Host and inactive-conversation isolation belongs to
the [composer delivery bridge](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement).
`localMessageDelivery.test.ts` covers these sidecar transitions and original metadata;
[mounted delivery evidence](daemon-connection-lifecycle.md#delivery-verification)
checks decoded fake-daemon frames and visible waiting/failure/settlement behavior.

**`TurnEndMetrics` ([#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565)) is a
sixth field-pair widen, on `turnBoundary`/`turnEnd` only** — six optional numbers
(`durationMs`, `inputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `outputTokens`,
`costUsdTotal`) declared once as `TurnEndMetrics` in `src/shared/ipc/events.ts` and
intersected onto both arms (`& TurnEndMetrics`), rather than repeated inline the way
`outcome`/`isError`/`terminalReason`/`errorCategory` are. All six are that turn's own except
`costUsdTotal`, which is the **session's** running total in US dollars — claude's own
estimate, never recomputed here. Carried as received: no summing, differencing or clamping,
so `0` and a negative both survive; what "not reported" means (absent or `0`) is left to the
display tickets that read the field, not this reducer. **Live-only by design**:
`TurnEndMetrics` is not part of `DurableThreadItem`
([Protected local chat history § Durable display rows](chat-history.md#durable-display-rows)), so a reload never restores
these six fields, and `chatHistoryContract.test.ts`'s exact-equality guard is narrowed to
compare against `ThreadItem` with them omitted from `turnBoundary`, rather than widened to
include them. See [Inbound message decode § Optional stopped-turn
reports](inbound-message-decode.md#optional-stopped-turn-reports) for the wire-side parse
and the `Number.isFinite` guard's load-bearing role.

Parent attribution and result precedence are documented in
[Tool parent attribution](conversation-timeline-store.md#tool-parent-attribution).
Assistant items retain the optional hint too; see
[assistant parent attribution](conversation-timeline-store.md#assistant-parent-attribution).
Grouping changes display order only, using loaded Agent/Task owners rather than roster
membership. Missing owners leave replies top-level until history supplies them.

### Permission-denial correlation

A `tool_denied` frame attaches `ToolDenial` independently of `ToolResult`
([#1238](https://github.com/pyrycode/pyrycode-desktop/issues/1238)). Encoding denial as
an error-result flag would lose reports recovered after the result was already sent.
Live delivery requires an explicit nonempty conversation id; within that conversation,
the reducer matches nonempty `turnId` and `toolUseId` exactly. A marker with no matching
existing call is discarded, with no orphan buffer. Repeated markers return the same state
reference and retain the first report, even if a duplicate carries different prose.

For an existing call, denial-before-result and result-before-denial retain both records.
The result remains complete in state; display bounds belong to the
[tool row](conversation-shell-tool-rows.md#permission-denied-tool-call-row).
The denial retains tool name, source token, reason, rejection message and both reports,
including the distinction between `null`, `[]` and populated arrays. Empty reasons and
unknown source tokens do not establish classifier provenance. Denial preserves phase,
stall, retry, compaction, local-send and thinking-token state; as daemon activity it
also clears `latestTurnEnd` under the lifecycle below.

### Stopped-turn state

`turnEnd` copies optional `outcome`, `isError`, `terminalReason` and `errorCategory`
onto the retained `turnBoundary` without interpretation. Live and history use the
same translation and reducer, preserving false, empty strings and undefined values
from the [wire parser](inbound-message-decode.md#optional-stopped-turn-reports).
The [formatter](conversation-shell-timeline-render.md#stopped-turn-records) decides whether
that record draws; the boundary still closes the streaming cursor when undrawn.

`latestTurnEnd` is separate, transient state for [composer recovery](conversation-shell-composer-status.md#stopped-turn-recovery).
A non-cancelled `turnEnd` sets it only when `isError === true` or `outcome` is nonempty
and differs from `success`; any other end clears it. A fresh local or received `userText`, a non-idle
`turnState`, `assistantDelta`, `toolUse`, `toolResult`, `toolProgress`, `toolDenied`
and `thinkingProgress` clear it, as do `sessionBoundary`, `reset` and `reconnected`.
A trailing idle preserves it. Retry, compaction and stall reports do not clear it.
Clearing this reading leaves the boundary in `items` unless the event itself resets
the timeline.

`reduceHistoryPage` folds into scratch state and returns **only items**.
`prependHistoryFor` therefore cannot restore or replace live recovery, even for an
absent conversation. Holding the reading in each conversation's existing timeline
also makes eviction and conversation clears remove it with that slice.

### The reducer

`reduceTimeline(state, event): TimelineState` is pure and exported. It runs the exhaustive
`reduceTimelineContent` fold below, preserves `pendingCompaction` across unrelated
events, then applies refusal-offer and `latestTurnEnd` lifecycles.
The table describes the content fold: a same-reference result or an unchanged scalar
there can still accompany clearing `latestTurnEnd`. If that reading is unchanged too,
the wrapper returns the content fold's exact state reference, preserving legacy no-op
identity on reconnect.

Before that fold, delivery updates use the [local transport rules](#local-transport-delivery),
and owned receipts and drops use the [settlement rules](#queued-own-echo-settlement).
Other received user events with a held nonempty message id retain legacy exact-state
deduplication, except metadata distinguishing a different bound queue entry admits a
separate receipt. A held history row is not enriched by a later matching receipt.
The [history prepend](conversation-timeline-store-history.md) still deduplicates by nonempty
message id, never by text or timestamp; this does not grant queue ownership.
[`liveUserReceipts.test.ts`](../../../src/renderer/src/store/liveUserReceipts.test.ts)
pins these joins, exact-reference rejection and both pending-send values.

| event | effect |
|---|---|
| `assistantDelta` | open-item coalesce: open `assistantText` with equal `turnId` and `parentToolUseId` → replace with concatenated text in place, retaining attribution and the **open item's own** `createdAt` ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013), so a coalesced bubble stays dated by its first delta); otherwise append fresh, carrying the event's `createdAt` and parent. The open item is the tail for attributed text and `openBubbleIndex` for main thread text, which skips trailing subagent tool calls ([#1872](https://github.com/pyrycode/pyrycode-desktop/issues/1872)). `seq` carried, not consulted — arrival order is authoritative. |
| `toolUse` | append a fresh `toolCall` with `result: null` |
| `toolProgress` | replace `elapsedSeconds` on the exact pending turn/tool match; latest arrival wins, including zero and decreases. Unmatched, resolved, denied or identical readings return the same state. Every scalar and other item stays unchanged. See [live delivery](conversation-timeline-store.md#live-tool-progress). |
| `toolDenied` | attach the first denial to the exact turn/tool match; empty keys, unmatched calls and duplicates return the same state reference. Clear `elapsedSeconds`; preserve the result and every scalar. |
| `toolResult` | find the `toolCall` with matching `toolUseId` **and** `result === null`, fill it in place, clearing `elapsedSeconds` and preserving any denial. No match (orphan or already-resolved duplicate) → **same `state` reference**, a deterministic non-throwing no-op. |
| `turnState` | set `phase`; same reference if unchanged (no-churn); clears `thinkingTokens` to `null` when `event.state !== 'thinking'` (the widened guard below lets a repeat `turn_state{idle}` through when a reading is still held, rather than early-outing and leaving it stale) — [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) |
| `turnEnd` | append a `turnBoundary`, copying the event's six `TurnEndMetrics` fields onto it by name ([#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565)); does **not** touch `phase`; clears `thinkingTokens` to `null` — the think this reading measured is over even though `phase` itself resets separately on the daemon's own `turn_state: idle` — [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) |
| `thinkingProgress` | assign `thinkingTokens: event.estimatedTokens` verbatim (same reference on a verbatim repeat — the wire has no dedup and re-fires as the count climbs); `items`/`phase`/every other scalar untouched — [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) |
| `userText` | Append a whole user row with `createdAt`, `messageId` and attachment references unchanged; never coalesce. Local submission (not `received: true`) opens the window: `localSendPending: { messageId: event.messageId ?? '', queued: false }`, replacing any prior window — the label follows the newest sent id when a second message goes out before the first turn starts. `received: true` preserves whatever window is already held. Phase and activity scalars stay unchanged. Duplicate receipts are rejected before this fold. Fresh rows clear `latestTurnEnd` and `stoppingBanner` in the wrapper. — [#650](../codebase/650.md), retyped by [#1725](https://github.com/pyrycode/pyrycode-desktop/issues/1725) |
| `sessionBoundary` | append a fresh `sessionBoundary` item (never coalesced); does **not** touch `phase` — the `/clear`/idle-eviction/workspace-change marker, sourced from the daemon's `sessionTransition` event via the bridge since [#286](../codebase/286.md) |
| `stallDetected` | set `stalled: true`; `items`/`phase` untouched. Same reference if `stalled` is already `true` (no-churn) — [#317](../codebase/317.md) |
| `apiRetry` | `active: true` → hold `{ current, total }` (same reference if unchanged, no-churn); `active: false` → `null`, discarding the event's counter unconditionally. `items`/`phase`/`stalled` untouched — [#493](../codebase/493.md) |
| `compacting` | Same active value → same reference. Rising edge sets `compacting` and clears the pending association. Falling edge appends a classified `compactionBoundary`, clears liveness, and makes only a non-failed row pending. Other status fields stay unchanged. |
| `compactionBoundary` | Replaces the pending row by reference identity, or appends a standalone row when none matches; consumes the association. Stores counts and `manual: trigger === 'manual'`, never raw trigger text. Status fields stay unchanged. |
| `reset` | returns `initialTimelineState`, with no `latestTurnEnd`, refusal offer or pending compaction, by reference; a second reset is a no-op — [#528](../codebase/528.md) |
| `reconnected` | clears `phase`→`idle`, `stalled`→`false`, `apiRetry`→`null`, `compacting`→`false`, `thinkingTokens`→`null` via a hand-written six-field literal (not a spread of `initialTimelineState`); `items` preserved **by reference**. Same reference if all six (including `phase === 'idle'`) are already clean (no-churn on a first connect, or a reconnect with nothing live) — [#538](../codebase/538.md), widened for `thinkingTokens` by [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) since a reading held across a reconnect would report the depth of a think that finished on the other side of the disconnect |
| `dropUserText` | Handled before the content fold: remove the first matching local echo record and its row/key, requiring the same queue id when supplied. No match returns the exact state. Every chrome scalar, including `localSendPending`, is preserved. Received/history rows are ineligible. |

`items` and `phase` are orthogonal: content events never touch `phase`, `turnState` never touches
`items`. **`stalled` ([#317](../codebase/317.md)) is a third, independent axis**: the four
turn-activity arms (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) clear it to `false`; the three
non-activity arms (`turnEnd`/`userText`/`sessionBoundary`) carry it through unchanged — a boundary
marker, a renderer-sourced echo, and a session rotation are none of them daemon turn activity. The two
pre-existing same-reference no-op guards (`toolResult`'s orphan/duplicate check, `turnState`'s
same-phase check) widen to `&& !state.stalled`, since an orphan result or an idle-when-already-idle
`turnState` is still turn activity and must still clear a live stall.
**`apiRetry` ([#493](../codebase/493.md)) is a fourth, independent axis with inverted clearing
rules**: every one of the nine other arms carries it through unchanged — including the four
turn-activity arms that clear `stalled` — since `api_retry` clears only on its own explicit falling
edge, never on turn activity. The two `&& !state.stalled` guards above deliberately do **not** gain a
matching `&& apiRetry === null`-style clause; doing so would silently clear a live retry on ordinary
turn activity.
**`compacting` ([#496](../codebase/496.md)) is a fifth, independent axis, the same inverted-clearing
shape as `apiRetry`**: turn activity carries it through unchanged. Its own falling
edge also appends a retained divider; reconnect clears the flag directly without
synthesizing that edge. Rows and pending metadata survive reconnect. See
[association rules and retention limits](conversation-timeline-store-compaction.md#what-it-does).
**`thinkingTokens` ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)) is a sixth,
independent axis with a clearing rule that matches neither of the two shapes above** — not
`stalled`'s self-clear-on-turn-activity (every content arm carries it through unchanged: `stalled` is
turn activity, but `thinkingTokens` is not cleared by it, since claude interleaves tool calls with its own
thinking) and not `apiRetry`/`compacting`'s own-falling-edge-only clear (the wire sends no falling edge
for this frame at all). Instead it clears on the turn's own lifecycle: a `turnState` that is not
`'thinking'`, a `turnEnd`, or a `reconnected`. Two of the reducer's same-reference no-op guards widen for
it and one deliberately does not: `turnState`'s guard gains `(event.state === 'thinking' || state.thinkingTokens
=== null)` so a repeat `turn_state{idle}` against a held reading is not early-outed into staleness;
`reconnected`'s `nothingLive` guard gains `&& state.thinkingTokens === null` for the same reason; `toolResult`'s
orphan/duplicate guard does **not** widen, since a tool result is not one of this scalar's three clearing
edges and must stay the same-reference no-op it already is.
`initialTimelineState = { items: [], phase: 'idle', stalled: false, apiRetry: null, compacting: false, localSendPending: null, thinkingTokens: null }`
(`localSendPending` retyped from `false` to `null` by [#1725](https://github.com/pyrycode/pyrycode-desktop/issues/1725));
pure selectors `selectItems`, `selectPhase`, `selectStalled`, `selectApiRetry`, `selectCompacting`,
`selectLocalSendPending`, `selectThinkingTokens` read these fields. Recovery reads
`latestTurnEnd` directly from the open conversation's held timeline. `markLocalSendQueued` (above) is a
transform, not a selector — it is exported alongside these but takes a `queued` snapshot and returns a
`TimelineState`, never read through `useTimelineStore`.
`openBubbleIndex(items)` ([#1872](https://github.com/pyrycode/pyrycode-desktop/issues/1872)) is the
index of the newest row once trailing subagent tool calls (a `toolCall` with a non-empty
`parentToolUseId`) are skipped, or -1. `appendDelta` coalesces main thread text into it, and the
conversation shell keeps the streaming cursor on it when it is a main thread `assistantText`.

The exported `isSubagentToolCall(item)` predicate defines this lookback: a `toolCall`
with a nonempty parent qualifies whether pending or completed. History contribution
admission shares it so a suppressed call keeps the same main-reply grouping as a
retained call; see [history joins](conversation-timeline-store-internals.md#the-page-half--the-join).

### Internal helpers (unexported)

- `appendDelta(items, turnId, text, createdAt, parentToolUseId)` — the open-item coalesce for
  `assistantDelta`; always returns a new array (a delta is always a change). Both trailing
  parameters accept `undefined` but are required at its one private call site. Equal turn ids
  alone would merge main-thread and helper text, or two helpers sharing a turn. Coalescing
  requires equal parents too; two parentless deltas still coalesce as before. For attributed
  text the open item is the tail, and any intervening row prevents growth. For main thread text
  it is `openBubbleIndex(items)` (exported, below), so a background subagent's tool calls that
  arrive mid sentence no longer split the reply mid word
  ([#1872](https://github.com/pyrycode/pyrycode-desktop/issues/1872)); those rows stay where they
  arrived and the bubble grows in place behind them. A main thread tool call, a turn boundary,
  attributed subagent text or any other row still ends the bubble. The grow branch reads
  the open item's `createdAt` (this function rebuilds the item as a fresh literal on every coalesced delta, so
  carrying the incoming stamp instead would silently re-date a bubble to its most recent fragment); only
  the fresh-append branch reads the incoming stamp.
- `fillResult(items, toolUseId, result)` — the `toolResult` correlate-and-fill. Narrows via a
  `.map` callback whose `item.kind === 'toolCall'` guard narrows `item` so the spread
  (`{ ...item, result }`) type-checks with **no cast** — the codebase bans unchecked `as` in
  production even when a cast would be provably safe (code review caught an index-cast version of
  this in the first submission; see [#121 codebase notes](../codebase/121.md) § Patterns
  established). Returns the same array reference on no match, so the reducer can return the same
  `state`.
