# Inbound message decode — transport interface

Part of the [public contract](inbound-message-decode-contract.md). Payload admission
rules live in [payload contracts](inbound-message-decode-payloads.md);
[user receipts](inbound-message-decode-contract.md#message-receipts-and-timestamps) stay in the parent.

## Public contract

```ts
// Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent —
// an internal transport result the daemon-connection consumer maps onto the IPC channel.
export type InboundDaemonMessage =
  | { kind: 'thread-frame'; envelope: Envelope } // main-only; receiver validates/assembles before IPC
  | ({ kind: 'message'; message: MessagePayload } & FrameTimestamp)
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }   // #116, additive
  | { kind: 'bundle-done'; total: number }                    // #116, additive
  | { kind: 'daemon-error'; inReplyTo?: number; outcome: DaemonErrorOutcome }  // #116, additive; inReplyTo added
                                                                 // by #269; outcome added by #965 — content-free
                                                                 // rule now SCOPED, not absolute (see below)
  // { kind: 'snapshot'; snapshot: ScreenSnapshotPayload } — #180, additive; REMOVED #622
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }  // #199, additive
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }              // #199, additive
  | { kind: 'conversations'; conversations: ConversationSummary[] }  // #139, additive
  | { kind: 'turn-state'; turnState: TurnStatePayload }         // #214, additive
  | { kind: 'stall'; stall: StallPayload }                      // #315, additive
  | { kind: 'api-retry'; apiRetry: ApiRetryPayload }            // #492, additive — NOT nullary
  | { kind: 'compacting'; compacting: CompactingPayload; ts: string }
  | { kind: 'compaction-boundary'; boundary: CompactionBoundaryPayload }
  | { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }  // #587, additive — identity report
  | { kind: 'thinking-progress'; thinkingProgress: ThinkingProgressPayload }  // #1312, additive — a periodic reading, no rising/falling edge, no FrameTimestamp, ships dormant
  | { kind: 'rate-limited'; rateLimited: RateLimitedPayload }    // #1318, additive — a usage-limit window report, `status`/`limit_type` OPEN strings, `resets_at` unvalidated, no FrameTimestamp, ships dormant
  | { kind: 'context-usage'; contextUsage: ContextUsagePayload }  // #1454, additive — the reading (conversation_id/model/total_tokens/max_tokens/percentage); #1455 adds the category breakdown (categories/dropped_categories); mixed provenance, informational (no range/cross-field check), no FrameTimestamp, ships dormant
  | { kind: 'mcp-status'; mcpStatus: MCPStatusPayload }          // #1489, additive — claude's MCP server list for one conversation; servers never null, dropped_servers copied not reconciled, one bad row drops the frame; name is NOT inert (a later slice may carry it into mcp_reconnect/mcp_toggle); no FrameTimestamp, ships dormant
  | { kind: 'tool-use'; toolUse: ToolUsePayload }               // #217, additive
  | { kind: 'modal-shown'; modalShown: ModalShownPayload }      // #201, additive
  | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }  // #201, additive
  | { kind: 'tool-result'; toolResult: ToolResultPayload }      // #229, additive
  | { kind: 'conversation-created'; conversationCreated: ConversationCreatedPayload }  // #241, additive
  | { kind: 'session-transition'; sessionTransition: SessionTransitionPayload }  // #254, additive
  | { kind: 'session-settings-updated'; sessionSettingsUpdated: SessionSettingsUpdatedPayload; inReplyTo?: number }  // #264, additive; inReplyTo added by #261
  | { kind: 'background-task-started'; backgroundTaskStarted: BackgroundTaskStartedPayload }  // #564, additive
  | { kind: 'background-task-updated'; backgroundTaskUpdated: BackgroundTaskUpdatedPayload }  // #565, additive
  | { kind: 'background-task-roster'; backgroundTaskRoster: BackgroundTaskRosterPayload }  // #566, additive
  | { kind: 'question-shown'; questionShown: QuestionShownPayload }  // #884, additive — ships dormant, no consumer arm yet
  | { kind: 'question-dismissed'; questionDismissed: QuestionDismissedPayload }  // #894, additive — ships dormant, no consumer arm yet
  | { kind: 'slash-command-list'; slashCommandList: SlashCommandListPayload }  // #936, additive — ships dormant, no consumer arm yet
  | { kind: 'model-list'; modelList: ModelListPayload }          // #972, additive — ships dormant, no consumer arm yet

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message`/`message_chunk`/bundle/`error`/
//                            `assistant_delta`/`turn_end`/`conversations`/`turn_state`/`stall`/
//                            `api_retry`/`compacting`/`compaction_boundary`/`model_announced`/`tool_use`/`modal_shown`/
//                            `modal_dismissed`/`tool_result`/`conversation_created`/`session_transition`/
//                            `session_settings_updated`/`background_task_started`/
//                            `background_task_updated`/`background_task_roster`/`question_shown`/
//                            `question_dismissed`/`slash_command_list`/`model_list`
//                            envelope, fully narrowed except `thread-frame` (see below);
//                            (`screen_snapshot` was modeled here #180-#622;
//                            removed, now falls to the unmodeled `default` arm)
//  • null                  — a well-formed envelope of any OTHER type (ignored)
//  • throws WireDecodeError — oversized / malformed / unparseable / mistyped payload (fail-closed)
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog       // #130 — optional injected content-free logger; absent ⇒ silent
): InboundDaemonMessage | null
```

## Complete live thread updates

`thread_item_added`, `thread_item_changed` and `thread_text_append` return a
`thread-frame` carrying the decoded envelope after the existing replay `event_id`
observation. This internal arm can contain continuation data and is never an IPC
event. The connection-owned `createThreadUpdateReceiver` detects a supplied
`continuation` before ordinary DTO validation, then delivers only complete
`ThreadUpdate` values. See [wire shapes and bounded assembly](inbound-message-decode-limits.md#complete-live-thread-validation)
and [connection lifetime](daemon-connection.md#thread-receiver-lifetime).

Replay admission remains independent of fragment progress: an incomplete or
rejected update can advance the observed envelope replay cursor without emitting
a completed logical version or item revision. The receiver holds no item store
and does not deduplicate repeated logical updates.
