# Daemon event channel — the sealed union

The event union itself: every arm the main process can emit to the renderer, and the rules that keep the switch over them exhaustive.

Part of [Daemon-event channel](daemon-event-channel.md); see that document for what the package does, its edge cases and its links.

## 1. The sealed union (`src/shared/ipc/events.ts`)

```ts
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

export type DaemonEvent =
  | { type: 'threadReply'; conversationId: string; requestId: string; reply: ThreadReply
      ; correlation: Omit<Envelope, 'payload' | 'type'> }
  | { type: 'threadQueryFailed'; conversationId: string; requestId: string; inReplyTo: number
      ; reason: ThreadQueryFailure }
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
  | { type: 'runConfigReceived'; sessionId: string; model: string; effort: string; yolo: boolean
      ; used_tokens: number; window_tokens: number }
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'turnEnd'; turnId: string; stopReason: string; conversationId: string
      ; outcome?: string; isError?: boolean; terminalReason?: string; errorCategory?: string }
  | { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
  | { type: 'turnState'; state: WireTurnState }
  | { type: 'stallDetected' }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string
      ; input?: Readonly<Record<string, string>> }
  | { type: 'modalShown'; conversationId: string; modalId: string; class: WireModalClass; title: string
      ; prompt: string; options: readonly WireModalOption[]; defaultOptionId: string }
  | { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'queueState'; conversationId: string; queued: readonly QueuedItem[] }
  | { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
  | { type: 'sessionTransition'; newSessionId: string; reason: WireSessionTransitionReason
      ; occurredAt: string; workspaceCwd: string | null }
  | { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
  | { type: 'sessionSettingsRejected'; changeId: string }
```

`historyPageReceived`, `historyRequestFailed` and `HistoryRequestFailure` are
removed (#2025), including their no-op switch cases in the four exhaustive
renderer bridges. `HistoryTimelineEvent` and `HistoryTimelineEntry` remain shared
translator/storage declarations, not legacy reply IPC. The shared fake publisher
still translates those declarations into authoritative items.

`threadReply` and `threadQueryFailed` are additive members on the existing
`window.pyry.onDaemonEvent` subscription. The connection-bound sink supplies
the host `serverId` stamp; each event also carries the conversation and caller
request ID. Validated replies retain envelope metadata, including `in_reply_to`,
in `correlation`; failures carry the corresponding `inReplyTo` directly.
The failure reasons are the static assembly classifications (`malformed`,
`sequence`, `metadata`, `limit`, `final-length`, `digest`, `reconstructed`,
`expired`) plus `unavailable`, `send-failed`, `interrupted` and `daemon-error`.
Daemon error prose and item content never enter failure events or diagnostics.

`ThreadReply` reuses the full-item validation from live updates. Unknown item
kinds, statuses, fields and content remain inert data. Every logical
`thread_items` batch has explicit `final: false`, complete `items`, and the same
captured conversation `epoch`/`version` across the reply. It has no coverage
fields. The captured version is not inferred from item revisions or orders.
Only one separate `items: []`, `final: true` marker certifies success, including
an empty result; terminal settlement ignores repeated or late markers.

| Query | Exclusive marker fields | Certified coverage |
| --- | --- | --- |
| Catch-up with requested version greater than zero | `from_version`, matching the requested checkpoint and no greater than captured `version`; no page fields | `(from_version, version]` in the requested epoch |
| Newest-window catch-up (`version: 0`) or page | All of `lower_order`, `upper_order`, numeric `continuation`, boolean `older_exists`; no `from_version` | `[lower_order, upper_order)`, with `continuation == lower_order` |

History numbers are nonnegative safe integers. Missing, mixed or malformed
coverage fails the query. A page's upper bound cannot exceed its exclusive
requested `before_order`; positive lower bounds must be less than upper bounds.
Zero lower order requires `older_exists: false`, and all zero/false fields stay
present. Numeric continuation supplies the next exclusive page position when
`older_exists` is true. Active items and out-of-range parents do not expand the
supplied interval; neither batch size nor the oldest returned parent determines
older availability.

An object `continuation` selects bounded fragment assembly instead. Its
`continuation.final` completes only a validated single-item batch, whose logical
`final` remains false; the separate request success marker is still required.
`thread_reset` carries only current `conversation_id`, `epoch` and `version`,
with no items, final flag or coverage. It terminates as `threadReply`; an existing
correlated `error` terminates as static `threadQueryFailed` with `daemon-error`.
Reset, error and local failure certify no partial progress. See
[query admission](daemon-connection-methods.md#public-surface) and
[assembly and lifetime](daemon-connection-lifecycle.md#thread-history-queries).

`snapshotReceived` and `screenSnapshotReceived` — the two members that occupied this spot through
\#620 — are gone as of [#621](../codebase/621.md); `runConfigReceived` (added at #491, shown above at
its position between the debug-bundle members and `assistantDelta`) had already superseded
`snapshotReceived` as the run-config sheet's data source. See [the per-member
history](daemon-event-channel-sealed-union-history.md) for what the two removed members carried while
they existed.

`HistoryTimelineEntry.event` and `HistoryTimelineEvent` remain shared
storage/translation declarations. Their `turnEnd` member carries optional
stopped-turn fields without a per-entry `conversationId`; placement-only
`backgroundTaskStarted` (`taskId`, `toolCallId`, `taskType`, `description`) and
`backgroundTaskUpdated` (`taskId`, `status`) carry no patch, summary, roster or
turn authority. They no longer arrive through a correlated history-page event.
The shared fake publisher translates retained fixture input into authoritative
items; see [retained boundaries](request-history-send.md#retained-boundaries).
Live members retain their existing named fields and envelope timestamp paths.

## 2. Per-member history

Every member's own rationale — what it carries, what it drops, its trust tier, which bridge(s) consume
it, and (for a removed member) why it was dropped — is documented one entry per ticket, in chronological
order, in [Daemon event channel — the sealed union: per-member
history](daemon-event-channel-sealed-union-history.md). Split out 2026-09-08 once the bullet list alone
had grown past the size cap.

Also there: the two rules that govern the whole union rather than one member — that `DaemonEvent` and
`SessionAction` stay separately declared per layer, and that a member reuses its wire payload type
verbatim wherever one exists (`connected.ack` is `HelloAckPayload`, `conversationsReceived.conversations`
is a `readonly ConversationSummary[]`, and so on) rather than redeclaring or drifting it.
