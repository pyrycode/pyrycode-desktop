# Daemon event channel — the sealed union

The event union itself: every arm the main process can emit to the renderer, and the rules that keep the switch over them exhaustive.

Part of [Daemon-event channel](daemon-event-channel.md); see that document for what the package does, its edge cases and its links.

## 1. The sealed union (`src/shared/ipc/events.ts`)

```ts
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

export type DaemonEvent =
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
  | { type: 'turnEnd'; turnId: string; stopReason: string }
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
  | { type: 'historyPageReceived'; conversationId: string; entries: readonly HistoryEntry[]
      ; cursor: string; atStart: boolean }
  | { type: 'historyRequestFailed'; conversationId: string; reason: HistoryRequestFailure
      ; retryable: boolean }
```

`snapshotReceived` and `screenSnapshotReceived` — the two members that occupied this spot through
\#620 — are gone as of [#621](../codebase/621.md); `runConfigReceived` (added at #491, shown above at
its position between the debug-bundle members and `assistantDelta`) had already superseded
`snapshotReceived` as the run-config sheet's data source. See [the per-member
history](daemon-event-channel-sealed-union-history.md) for what the two removed members carried while
they existed.

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

