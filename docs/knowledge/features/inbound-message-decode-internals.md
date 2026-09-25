# Inbound message decode — internals

How a frame is actually decoded: payload narrowing, category-only error messages, the diagnostic logging around them, and the consumer arm that drives it.

Part of [Inbound message decode](inbound-message-decode.md); see that document for what the package does, its edge cases and its links.

# How it works

`parseInboundMessage` layers the semantic narrowing the codec deliberately defers (`Envelope.payload` stays `unknown`) onto `decodeEnvelope`'s structural boundary, plus the oversized guard `decodeEnvelope` omits:

1. **Size guard.** `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) → throw. `decodeEnvelope` does **not** size-check, so this is the only thing that fails an oversized-but-valid-JSON frame closed at this boundary. (Belt-and-suspenders: the upstream Noise transport already bounds the plaintext, but this boundary re-checks what it owns — the unit test drives this function directly, and a future driver change must not silently un-bound it. See § Why the explicit size guard.)
2. **`decodeEnvelope(plaintext)`** — inherits the codec's fail-closed rejection of bad UTF-8, malformed JSON, a non-object top-level, and a missing `id` / `type` / `ts` / `payload`.
3. **Route on `envelope.type`:**
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(payload).messages }`
   - `'debug_bundle_chunk'` / `'debug_bundle_done'` / `'error'` → the three additive kinds ([#116](../codebase/116.md), see above) — narrowed and content-free-logged as `inbound-decoded` before the `default` branch is ever reached. `'error'`'s `daemon-error` kind widened with the already-decoded `Envelope.in_reply_to` as `inReplyTo?: number` ([#269](../codebase/269.md)) — propagated, not re-parsed; still no `ErrorPayload` field is narrowed.
   - `'assistant_delta'` → `{ kind: 'assistant-delta', delta }` / `'turn_end'` → `{ kind: 'turn-end', turnEnd }` ([#199](../codebase/199.md)) — narrowed via `parseAssistantDeltaPayload` / `parseTurnEndPayload`, each content-free-logged as `inbound-decoded(code: 'assistant_delta' | 'turn_end')` before the `default` branch. The two v2 interactive-stream kinds that graduate out of `inbound-unmodeled` once #179 flips `interactive` on.
   - `'conversations'` → `{ kind: 'conversations', conversations }` ([#139](../codebase/139.md)) — narrowed via `parseConversationsPayload`, content-free-logged as `inbound-decoded(code: 'conversations')` before the `default` branch — **deliberately no `count` field**, unlike `message_chunk`'s log (a conversation count is more identifying than a message-batch size).
   - `'turn_state'` → `{ kind: 'turn-state', turnState }` ([#214](../codebase/214.md)) — narrowed via `parseTurnStatePayload` (the `role`-style closed-enum check on `state`), content-free-logged as `inbound-decoded(code: 'turn_state')` before the `default` branch. The third v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`.
   - `'stall'` → `{ kind: 'stall', stall }` ([#315](../codebase/315.md)) — narrowed via `parseStallPayload` (one `requireString` call, no enum), content-free-logged as `inbound-decoded(code: 'stall')` before the `default` branch. The onset-only liveness signal on the same v2 interactive stream as `turn_state`/`tool_use`; shipped dormant, the render slice #317 is now the first consumer (a sixth owned arm on the timeline bridge).
   - `'api_retry'` → `{ kind: 'api-retry', apiRetry }` ([#492](../codebase/492.md)) — narrowed via `parseApiRetryPayload` (four required fields: one `requireString`, one `requireBoolean`, two `requireNumber` calls, no enum), content-free-logged as `inbound-decoded(code: 'api_retry')` before the `default` branch. The PTY-derived status peer of `stall`, but **not** onset-only (an explicit `active: false` falling edge) and **not** deduped (the rising edge re-fires as the count climbs); shipped dormant, the render slice #493 is now the first consumer.
   - `'tool_use'` → `{ kind: 'tool-use', toolUse }` ([#217](../codebase/217.md)) — narrowed via `parseToolUsePayload` (five `requireString` calls, no enum), content-free-logged as `inbound-decoded(code: 'tool_use')` before the `default` branch. The fourth v2 interactive-stream kind to graduate out of `inbound-unmodeled`.
   - `'modal_shown'` → `{ kind: 'modal-shown', modalShown }` / `'modal_dismissed'` → `{ kind: 'modal-dismissed', modalDismissed }` ([#201](../codebase/201.md)) — narrowed via `parseModalShownPayload` (the `class` closed-enum check + the `parseModalOption`-mapped `options` array) / `parseModalDismissedPayload` (the `source` closed-enum check), each content-free-logged as `inbound-decoded(code: 'modal_shown' | 'modal_dismissed')` before the `default` branch. Not part of the same v2 interactive-stream family as `assistant_delta`/`turn_state`/`tool_use` — a modal is the permission/trust prompt `claude` raises, gated behind the same `interactive` capability. `modal_shown` gained a `conversation_id` field ([#870](../codebase/870.md), pyrycode#1065) — decoded there, and carried across at the consumer emit by [#871](../codebase/871.md); `modal_dismissed` still carries none.
   - `'tool_result'` → `{ kind: 'tool-result', toolResult }` ([#229](../codebase/229.md); `result_detail` added by [#773](../codebase/773.md)) — narrowed via `parseToolResultPayload` (four `requireString` calls plus one `requireBoolean` call on `is_error`, plus a sixth optional field via `optionalString` since #773), content-free-logged as `inbound-decoded(code: 'tool_result')` before the `default` branch. The fifth and last v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`/`turn_state`/`tool_use`.
   - `'session_settings_updated'` → `{ kind: 'session-settings-updated', sessionSettingsUpdated, inReplyTo: envelope.in_reply_to }` ([#264](../codebase/264.md), `inReplyTo` added by [#261](../codebase/261.md)) — narrowed via `parseSessionSettingsUpdatedPayload` (a single `requireString` call, no enum), content-free-logged as `inbound-decoded(code: 'session_settings_updated')` before the `default` branch. The `set_session_settings` (#263) confirmation reply; `inReplyTo` is propagated from the already-decoded `Envelope.in_reply_to`, not re-parsed.
   - `'question_shown'` → `{ kind: 'question-shown', questionShown }` ([#884](../codebase/884.md)) — narrowed via `parseQuestionShownPayload`, the first nested narrower mapped over `.map(parseQuestion)` whose own elements each go through `.map(parseQuestionOption)` — two nesting levels, where every prior array kind (`message_chunk`, `conversations`, `modal_shown.options`, `background_task_roster.tasks`) had one. Content-free-logged as `inbound-decoded(code: 'question_shown')` before the `default` branch. Ships dormant: the consumer arm below has no case for `'question-shown'` yet, and the switch's absent `default` means an unmatched kind is silently un-routed, not forwarded — the IPC carry is [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885).
   - `'question_dismissed'` → `{ kind: 'question-dismissed', questionDismissed }` ([#894](https://github.com/pyrycode/pyrycode-desktop/issues/894)) — narrowed via `parseQuestionDismissedPayload`, `parseModalDismissedPayload`'s flat `isRecord` + three-`requireString` shape minus its closed `source` enum: `source` stays a plain string because the producer's single dismissal-arbiter closure cannot tell a caller disconnect, a daemon shutdown, or the approval window elapsing apart, so a closed enum would reject the only traffic that exists (the landed pair is `outcome: 'unanswered'` / `source: 'no_answer'`). Content-free-logged as `inbound-decoded(code: 'question_dismissed')` before the `default` branch. `daemonConnection.ts`'s switch now has a `case 'question-dismissed':` ([#895](https://github.com/pyrycode/pyrycode-desktop/issues/895), landed), emitting the `questionDismissed` `DaemonEvent` arm — the same dormancy `question_shown` carried through #885, since no renderer store reads either arm yet.
   - `'slash_command_list'` → `{ kind: 'slash-command-list', slashCommandList }` ([#936](https://github.com/pyrycode/pyrycode-desktop/issues/936)) — narrowed via `parseSlashCommandListPayload` + the new row narrower `parseSlashCommand`, `parseBackgroundTaskRosterPayload`'s shape exactly (including its trap: `commands: null` fails closed while a row's own `truncated_fields: null` is valid). Content-free-logged as `inbound-decoded(code: 'slash_command_list')` before the `default` branch. Ships dormant: the consumer arm below has no case for `'slash-command-list'` yet — the IPC carry is [#937](https://github.com/pyrycode/pyrycode-desktop/issues/937).
   - `'attachment_stored'` → `{ kind: 'attachment-stored', attachmentStored }` ([#964](https://github.com/pyrycode/pyrycode-desktop/issues/964)) — narrowed via `parseAttachmentStoredPayload` (an `isRecord` guard plus one `requireNonEmptyString` call, the file's newest field narrower), content-free-logged as `inbound-decoded(code: 'attachment_stored')` before the `default` branch. The upload leg's one positive terminal — see [Attachment-stored wire types](attachment-stored-wire-types.md). Ships dormant: the consumer arm below has no case for `'attachment-stored'` yet — the send driver is [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861), not started.
   - `'attachment_chunk'` → `{ kind: 'attachment-chunk', attachmentChunk, inReplyTo }` ([#998](https://github.com/pyrycode/pyrycode-desktop/issues/998)) — placed directly beneath `attachment_stored`, since the two arms disagree about `in_reply_to` and each names the other. Narrowed via `parseAttachmentChunkPayload` (an `isRecord` guard plus eight fields — see § Payload narrowing), content-free-logged as `inbound-decoded(code: 'attachment_chunk')` before the `default` branch. The retrieval leg's data stream: the answer to `request_attachment` ([#993](request-attachment-envelope.md)), decoding `attachment_chunk` on the direction that previously fell through to `default:` — the upload direction of the same frame is [#860](attachment-chunk-envelope.md)'s producer, unaffected. **`inReplyTo` is required, not optional** — checked before the payload is parsed (rejecting an uncorrelatable frame before spending the work to base64-decode it), and typed required rather than the `?: number` the file's three other `in_reply_to`-surfacing kinds use, since a retrieval chunk cannot legitimately arrive unsolicited. See [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) for the full field-by-field narrower table and why `attachment-stored`'s no-`inReplyTo` decision is not precedent here. Ships dormant: the consumer arm below has no case for `'attachment-chunk'` yet — the reassembler is a later slice.
   - `'model_list'` → `{ kind: 'model-list', modelList }` ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)) — narrowed via `parseModelListPayload` + the new row narrower `parseModelOption`, `parseSlashCommandListPayload`'s shape exactly (including its trap: `models: null` fails closed while a row's own `truncated_fields: null` is valid). Every string goes through `requireString`, never `requireNonEmptyString` — the all-zero fixture is legal traffic. Content-free-logged as `inbound-decoded(code: 'model_list')` before the `default` branch, narrowed before logging so a malformed frame leaves no record. The decode half of the [model-list wire types](model-list-wire-types.md) vocabulary (#971), `slash_command_list`'s sibling from the same `initialize` reply. Ships dormant: the consumer arm below has no case for `'model-list'` yet — see [Extension history](inbound-message-decode-history.md) for the full account.
   - `'thinking_progress'` → `{ kind: 'thinking-progress', thinkingProgress }` ([#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) — narrowed via `parseThinkingProgressPayload` (`parseApiRetryPayload`'s shape scaled down: one `requireString` plus two `requireNumber` calls, no new helper), content-free-logged as `inbound-decoded(code: 'thinking_progress')` before the `default` branch. A periodic reading, not a state transition — claude's only mid-turn proof of life on the stream-json surface; takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent` (AC3). Ships dormant: the consumer arm below has no case for `'thinking-progress'` yet, and `daemonConnection.ts`'s inbound switch has no catch-all.
   - `'rate_limited'` → `{ kind: 'rate-limited', rateLimited }` ([#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318)) — narrowed via `parseRateLimitedPayload` (`parseBackgroundTaskStartedPayload`'s shape minus two strings plus one number: three `requireString` calls, one `requireNumber`, the existing `requireStringArrayOrNull` for `truncated_fields`, no new helper), content-free-logged as `inbound-decoded(code: 'rate_limited')` before the `default` branch. Claude's usage-limit window report; `status`/`limit_type` are deliberately open strings and `resets_at` is deliberately unvalidated (see [Extension history](inbound-message-decode-history.md) for why — a security decision, not merely a no-drift one). Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent` (AC5). Ships dormant: the consumer arm below has no case for `'rate-limited'` yet, and `daemonConnection.ts`'s inbound switch has no catch-all.
   - `'context_usage'` → `{ kind: 'context-usage', contextUsage }` ([#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454); category breakdown added by [#1455](https://github.com/pyrycode/pyrycode-desktop/issues/1455); MCP-tool inventory added by [#1459](https://github.com/pyrycode/pyrycode-desktop/issues/1459); memory-file inventory added by [#1460](https://github.com/pyrycode/pyrycode-desktop/issues/1460)) — narrowed via `parseContextUsagePayload`, content-free-logged as `inbound-decoded(code: 'context_usage')` before the `default` branch. Claude's own report of what is in the context window: the reading — `conversation_id`/`model`/`total_tokens`/`max_tokens`/`percentage` (#1454) — plus all three of its inventories: `categories`/`dropped_categories` (#1455) via `parseContextUsageCategory` (an `isRecord` guard, one `requireString` for `name`, one `requireNumber` for `tokens`), `mcp_tools`/`dropped_mcp_tools` (#1459) via `parseContextUsageMCPTool` (the same shape one field wider — `name`, `server_name`, `tokens`), and `memory_files`/`dropped_memory_files` (#1460) via `parseContextUsageMemoryFile` (the same shape with different key names — `path`, `type`, `tokens`), each mapped over its array on the `parseModelListPayload`/`parseModelOption` pattern. After #1460, every key the daemon writes is declared and read. No inventory is ever `null` — an empty array is claude's positive report of no categories, no MCP tools, or no memory files, while `null`/absent/non-array fails the whole frame closed; each dropped count is never cross-checked against its own retained length, and no inventory's count is ever cross-checked against another's. `server_name` is decoded as **inert** — its name collides with the actuation-crossing `ServerName` on the daemon's MCP reconnect payload, so it is never an actuation target and never joined against `mcp_status` (#1489 has since decoded that frame into a typed table on this side). A memory file's `path` is decoded as **inert** too — path-shaped descriptive text, never a file handle: nothing joins, cleans, resolves or opens it, and the daemon's committed fixture carries `../../../etc/passwd` across byte-for-byte on purpose; `type` beside it is claude's label, never a discriminant to `switch` on. Provenance is mixed (`conversation_id` daemon-authored; `model`, every row's `name` and every `type` claude-authored and unsanitized; every `server_name` workspace configuration; every `path` likewise workspace-authored) and the reading is informational — no range check, no cross-field check. Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent`. Ships dormant: the consumer arm below has no case for `'context-usage'` yet, and `daemonConnection.ts`'s inbound switch has no catch-all — the IPC carry is #1419.
   - `'mcp_status'` → `{ kind: 'mcp-status', mcpStatus }` ([#1489](https://github.com/pyrycode/pyrycode-desktop/issues/1489)) — narrowed via `parseMCPStatusPayload` + the new row narrower `parseMCPServerStatus`, content-free-logged as `inbound-decoded(code: 'mcp_status')` before the `default` branch. Claude's MCP server list for one conversation, published live and as the answer to `mcp_status_request` (not yet declared on this side). `parseMCPStatusPayload` is `parseContextUsagePayload`'s list shape over a single inventory: an `isRecord` gate, a `requireString` for `conversation_id`, an `Array.isArray`-then-`.map` guard on `servers`, a plain `requireNumber` for `dropped_servers`. `servers` is never `null` — an empty array is the positive report of no servers, while `null`/absent/non-array fails the whole frame closed; `dropped_servers` is copied from the producer and never reconciled against the retained length. `parseMCPServerStatus` scales `parseContextUsageMCPTool`'s structure to five always-present plain `requireString` fields (`name`/`status`/`error`/`scope`/`version`) — one bad row drops the whole frame rather than yielding a partial list. Its inertness doctrine does **not** carry over from `parseContextUsageMCPTool`: a row's `name` is the server list's own identity, which a later slice may legitimately carry into an MCP actuation verb (`mcp_reconnect`/`mcp_toggle`) the daemon gates per device — what binds here is only the client-side rule (never a lookup key, a React key, a Map index, a path, a filename or a cache key). `status`/`scope` stay open-set claims, never enums, and `version` stays opaque, never semver-parsed. Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent`. Ships dormant: the consumer arm below has no case for `'mcp-status'` yet, and `daemonConnection.ts`'s inbound switch has no catch-all — the IPC carry is #1490.
   - anything else → `return null` — a well-formed `ack` / `hello_ack` / `backfill_since` / etc. is **not an error**, it is simply not modeled here. Since [#130](../codebase/130.md) it is also **logged content-free** (`inbound-unmodeled`, § *Diagnostic logging*) before the `return null`, so an unforeseen envelope kind leaves a footprint instead of vanishing; the return value and the "not surfaced to the UI" behavior are unchanged. (`error` was in this bucket until [#116](../codebase/116.md) promoted it to modeled — see above.)

## Payload narrowing

Two private validators (tested through `parseInboundMessage`, never exported), built on two **local copies** of `isRecord` / `requireString` — the same deliberate duplication [`helloExchange.ts`](hello-exchange.md) uses, for the same reason: the codec's `isRecord` is unexported, and copying it keeps this the edge that validates the opaque payload. No shared validators module; `helloExchange.ts` is not refactored.

- **`parseMessagePayload`** — `isRecord` guard, then `conversation_id` / `message_id` / `text` via `requireString`, then a single `role` enum check (`!== 'user' && !== 'assistant'` → throw). That one check subsumes non-string **and** unknown-string, narrowing to `WireRole` without a cast. Returns only the four known fields; unknown server-added keys are tolerated but dropped (forward-compat, matching `parseHelloAck`).
- **`parseMessageChunkPayload`** — `isRecord` guard, `messages` must be `Array.isArray`, then `raw.map(parseMessagePayload)`: **one bad element throws, failing the whole chunk closed.** An **empty array is valid** — a zero-length batch, harmless downstream (the store handles it as a no-op append).
- **`parseAttachmentStoredPayload`** ([#964](https://github.com/pyrycode/pyrycode-desktop/issues/964)) — `isRecord` guard, then one field through `requireNonEmptyString`, a new sibling of `requireString` rather than a tightened version of it: `requireString` accepts `''` and stays correct everywhere else it is called (an empty `argument_hint` is ordinary data on 33 of 51 measured `slash_command_list` rows), but every key is optional to Go's `encoding/json`, so a truncated `attachment_stored` decodes daemon-side to `{"attachment_id": ""}` — passed through `requireString` that would be a success naming no transfer. See [Attachment-stored wire types](attachment-stored-wire-types.md) for the full trap.
- **`parseAttachmentChunkPayload`** ([#998](https://github.com/pyrycode/pyrycode-desktop/issues/998)) — `parseAttachmentStoredPayload`'s shape scaled to eight fields plus a base64 decode: `isRecord` guard, `attachment_id` via `requireNonEmptyString` (#964's reason transfers verbatim), `total_chunks` then `index` via `requireNumber` plus an integer + range check each (narrowed in that order so the range check has its bound), `filename`/`mime_type`/`sha256`/`size` via plain `requireString`/`requireNumber` (type only — no length check on `sha256`, that belongs to the reassembler against the assembled bytes), and `data` via `base64StdDecode(requireString(…))` — the STRICT decoder that requires the input to be the exact base64-std re-encoding, so non-canonical or unpadded input throws rather than silently shortening the file. Returns a fresh eight-key literal, dropping unknown server-added keys. See [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) for the full field table and the two field docs this ticket also corrected on `AttachmentChunkPayload` itself (`filename`/`mime_type` provenance, inbound vs. outbound).
- **`parseModelOption`** / **`parseModelListPayload`** ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)) — no new helper; both reuse existing narrowers verbatim. `parseModelOption` (the row) is an `isRecord` guard, `resolved_model`/`value`/`display_name` via `requireString`, `effort_levels` via `requireStringArray` (never `null`), `supports_auto_mode` via `requireBoolean`, `truncated_fields` via `requireStringArrayOrNull` (`null` admitted). `parseModelListPayload` is an `isRecord` guard, `conversation_id` via `requireString`, an inline `Array.isArray` check on `models` then `raw.map(parseModelOption)`, `dropped_models` via plain `requireNumber`. Thirteen reject branches; one bad row throws the whole frame closed. See [Model-list wire types](model-list-wire-types.md) for the field-by-field contract and [Extension history](inbound-message-decode-history.md) for the full decode account.
- **`optionalAgent`** ([#1649](https://github.com/pyrycode/pyrycode-desktop/issues/1649)) — a new local helper, shared by `parseModelOption`, `parseConversationSummary` and `parseConversationCreatedPayload`: `payload.agent === undefined ? {} : { agent: agentFromWire(requireString(payload, 'agent')) }`. A first for this file — every earlier optional field either normalises absence to a default (`is_muted` → `false`) or admits `null` as a distinct present value (`requireStringOrNull`); this one instead spreads a **conditionally-empty object** so an absent key stays absent all the way through, and an untagged frame decodes `toStrictEqual` the literal it always did. `parseModelOption` also keeps a present `family` verbatim through the same conditional-spread shape, without `agentFromWire` — daemon text, equality-only downstream (see [Model-list wire types](model-list-wire-types.md)).

## Category-only error messages

Every `WireDecodeError` names the failure **category only** (`'missing required field: role'`, `'malformed message payload'`, `'inbound plaintext exceeds max size'`) — it **never interpolates a field value**. `role`, `text`, and `conversation_id` are user conversation content; a `` `bad role: ${role}` `` message would echo that content into an error string a future caller might surface. The consumer drops the caught object today, so this is defense-in-depth — but it becomes load-bearing the moment any caller logs the message. Matches `codec.ts` / `helloExchange.ts`.

## Diagnostic logging (#130)

The module's header once declared *"This module performs no logging."* [#130](../codebase/130.md) deliberately flips that invariant **for this file only**, wiring in the merged [content-free diagnostic logger](diagnostic-log.md) ([#126](../codebase/126.md)) so a wire-integrity fault — a message recurring, changing between send and receive, truncating, or arriving as an unforeseen kind — leaves a footprint. Each of the two **non-throwing** outcomes emits one content-free record; the record carries the envelope type, the plaintext byte length, a one-way hash of the frame, and the logger's own monotonic `seq` — **never the payload value or any decoded field**:

| Outcome | Event | Fields |
|---|---|---|
| modeled `message` | `inbound-decoded` | `code: 'message'`, `bytes: plaintext.length`, `hash` |
| modeled `message_chunk` | `inbound-decoded` | `code: 'message_chunk'`, `bytes`, `count: messages.length`, `hash` |
| modeled `debug_bundle_chunk` / `debug_bundle_done` / `error` ([#116](../codebase/116.md)) | `inbound-decoded` | `code: <the type>`, `bytes`, `hash` — never `seq`/`total`/`data`/the daemon's `ErrorPayload` text, and (since [#269](../codebase/269.md) widened `error`'s decode) never its `inReplyTo` either — a routing id, not logged |
| modeled `assistant_delta` / `turn_end` ([#199](../codebase/199.md)) | `inbound-decoded` | `code: 'assistant_delta' \| 'turn_end'`, `bytes`, `hash` — never `text`/`turn_id`/`seq`/`stop_reason`/`conversation_id`, even though the consumer arm carries `text` onward to the renderer (the log stays content-free regardless of what the event carries) |
| modeled `conversations` ([#139](../codebase/139.md)) | `inbound-decoded` | `code: 'conversations'`, `bytes`, `hash` — never `id`/`name`/`cwd`/`is_promoted`/`is_archived`/`last_message_ts`/`last_used_at`/`workspace_label` (added by [#1287](https://github.com/pyrycode/pyrycode-desktop/issues/1287), same posture as `name`/`cwd`) /`is_muted` (added by [#1594](https://github.com/pyrycode/pyrycode-desktop/issues/1594), same posture) /`agent` (added by [#1649](https://github.com/pyrycode/pyrycode-desktop/issues/1649), same posture — the row's held `WireAgent`, never the daemon's own string), and deliberately **no `count`** |
| modeled `turn_state` ([#214](../codebase/214.md)) | `inbound-decoded` | `code: 'turn_state'`, `bytes`, `hash` — never `state`/`conversation_id` |
| modeled `stall` ([#315](../codebase/315.md)) | `inbound-decoded` | `code: 'stall'`, `bytes`, `hash` — never `conversation_id` |
| modeled `api_retry` ([#492](../codebase/492.md)) | `inbound-decoded` | `code: 'api_retry'`, `bytes`, `hash` — never `conversation_id`/`active`/`current`/`total` |
| modeled `compacting` ([#495](../codebase/495.md)) | `inbound-decoded` | `code: 'compacting'`, `bytes`, `hash` — never `conversation_id`/`active` |
| modeled `tool_use` ([#217](../codebase/217.md), `input` added by [#642](../codebase/642.md)) | `inbound-decoded` | `code: 'tool_use'`, `bytes`, `hash` — never `name`/`input_summary`/`tool_use_id`/`turn_id`/`conversation_id`/`input` (neither its keys nor its values) |
| modeled `modal_shown` / `modal_dismissed` ([#201](../codebase/201.md); `modal_shown` gained `conversation_id` in [#870](../codebase/870.md)) | `inbound-decoded` | `code: 'modal_shown' \| 'modal_dismissed'`, `bytes`, `hash` — never `conversation_id`/`modal_id`/`class`/`title`/`prompt`/any `options[].label`/`default_option_id`/`outcome`/`source` |
| modeled `tool_result` ([#229](../codebase/229.md); `result_detail` added by [#773](../codebase/773.md)) | `inbound-decoded` | `code: 'tool_result'`, `bytes`, `hash` — never `result_summary`/`result_detail`/`is_error`/`tool_use_id`/`turn_id`/`conversation_id` |
| modeled `session_settings_updated` ([#264](../codebase/264.md)) | `inbound-decoded` | `code: 'session_settings_updated'`, `bytes`, `hash` — never `session_id` |
| modeled `background_task_started` ([#564](../codebase/564.md)) | `inbound-decoded` | `code: 'background_task_started'`, `bytes`, `hash` — never `conversation_id`/`task_id`/`tool_call_id`/`description`/`task_type`/`truncated_fields`; narrows before logging, so a malformed frame leaves no record |
| modeled `background_task_updated` ([#565](../codebase/565.md); `status`/`summary` added [#1560](https://github.com/pyrycode/pyrycode-desktop/issues/1560)) | `inbound-decoded` | `code: 'background_task_updated'`, `bytes`, `hash` — never `conversation_id`/`task_id`/`patch`/`status`/`summary`/`truncated_fields`, least of all `patch` and `summary` (either may carry command text); a present non-string `status`/`summary` throws before this line same as any other malformed field; narrows before logging, so a malformed frame leaves no record |
| modeled `background_task_roster` ([#566](../codebase/566.md)) | `inbound-decoded` | `code: 'background_task_roster'`, `bytes`, `hash` — never `conversation_id`/`tasks`/`dropped_tasks`, least of all a row's `description` (a literal command line); deliberately **no `count`** either, though `DiagnosticEvent` already has one — the roster size is itself a fact about the user's session; narrows before logging, so a malformed frame leaves no record |
| modeled `model_announced` ([#587](../codebase/587.md)) | `inbound-decoded` | `code: 'model_announced'`, `bytes`, `hash` — never `conversation_id`/`model`/`truncated`, least of all `model` (claude-authored text that crossed the subprocess trust boundary); narrows before logging, so a malformed frame leaves no record |
| modeled `question_shown` ([#884](../codebase/884.md)) | `inbound-decoded` | `code: 'question_shown'`, `bytes`, `hash` — never `conversation_id`/`question_batch_id`/any `questions[].question`/`.header`/`.options[].label`/`.description`/`.multi_select`; narrows before logging (all twelve reject branches, across three nested parsers, throw before this line), so a malformed frame leaves no record |
| modeled `question_dismissed` ([#894](https://github.com/pyrycode/pyrycode-desktop/issues/894)) | `inbound-decoded` | `code: 'question_dismissed'`, `bytes`, `hash` — never `question_batch_id` (the batch's unguessable one-time nonce) or `outcome`/`source` (producer sentinels, neither secret nor logged); narrows before logging (all four reject branches throw before this line), so a malformed frame leaves no record |
| modeled `slash_command_list` ([#936](https://github.com/pyrycode/pyrycode-desktop/issues/936)) | `inbound-decoded` | `code: 'slash_command_list'`, `bytes`, `hash` — never `conversation_id` or any row's `name`/`argument_hint`/`description`/`aliases`/`truncated_fields`, the file's first **workspace-authored** strings; deliberately **no `count`** either, though `DiagnosticEvent` already has one — a workspace's command inventory is a fact about the repository the user has open (the `background_task_roster`/`model_announced` posture); narrows before logging, so a malformed frame leaves no record |
| modeled `attachment_stored` ([#964](https://github.com/pyrycode/pyrycode-desktop/issues/964)) | `inbound-decoded` | `code: 'attachment_stored'`, `bytes`, `hash` — never `attachment_id`, even though upstream states this payload is safe to log whole (a statement about the frame, not a licence to widen `DiagnosticEvent`); narrows before logging, so a malformed frame leaves no record |
| modeled `attachment_chunk` ([#998](https://github.com/pyrycode/pyrycode-desktop/issues/998)) | `inbound-decoded` | `code: 'attachment_chunk'`, `bytes`, `hash` — never `attachment_id`/`filename`/`mime_type`/`sha256`/decoded bytes/`index`/`total_chunks`, **stricter than upstream permits**: § Trust and content hygiene allows logging the id, index and total, but the id is out for #993's shape-not-yet-validated reason and index/total follow the `slash_command_list`/`model_list` no-`count` posture; narrows (including the required-`inReplyTo` check) before logging, so a malformed or uncorrelated frame leaves no record |
| modeled `model_list` ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)) | `inbound-decoded` | `code: 'model_list'`, `bytes`, `hash` — never `conversation_id` or any row's `resolved_model`/`value`/`display_name`/`effort_levels`/`truncated_fields`/`agent`/`family` (the last two added by [#1649](https://github.com/pyrycode/pyrycode-desktop/issues/1649)), the file's second **claude-authored** strings after `question_shown`'s; deliberately **no `count`** either, though `DiagnosticEvent` already has one — how many models claude offers for a session is itself a fact about that session (the `background_task_roster`/`model_announced`/`slash_command_list` posture); narrows before logging, so a malformed frame leaves no record |
| modeled `thinking_progress` ([#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) | `inbound-decoded` | `code: 'thinking_progress'`, `bytes`, `hash` — never `conversation_id`/`estimated_tokens`/`estimated_tokens_delta`; narrows before logging, so a malformed frame leaves no record |
| modeled `rate_limited` ([#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318)) | `inbound-decoded` | `code: 'rate_limited'`, `bytes`, `hash` — never `conversation_id`/`status`/`limit_type`/`resets_at`/`truncated_fields`; `status`/`limit_type` are claude-authored text that crossed the subprocess trust boundary, so this is the file's first row where the omission is a render-sink obligation as well as a correlation one; narrows before logging, so a malformed frame leaves no record |
| modeled `context_usage` ([#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454)) | `inbound-decoded` | `code: 'context_usage'`, `bytes`, `hash` — never `conversation_id`/`model`/`total_tokens`/`max_tokens`/`percentage`; `model` is claude-authored text that crossed the subprocess trust boundary, and the three integers disclose how much private work is in the window, a side-channel as unwelcome as the correlating `conversation_id` beside them; narrows before logging, so a malformed frame leaves no record |
| modeled `background_task_progress` ([#1638](https://github.com/pyrycode/pyrycode-desktop/issues/1638)) | `inbound-decoded` | `code: 'background_task_progress'`, `bytes`, `hash` — never `conversation_id`/`task_id`/`description`/`subagent_type`/`last_tool_name`/`total_tokens`/`tool_uses`/`duration_ms`/`truncated_fields`, least of all `description` (the task's current activity, which can name a file on the operator's host); the three counters are not logged either, the `thinking_progress` posture (a reading of claude's work is a side-channel on private work); narrows before logging, so a malformed frame leaves no record |
| unmodeled (`default`) | `inbound-unmodeled` | `code: envelope.type.slice(0, 64)`, `bytes`, `hash` |

**A removal moves a type's traffic between rows, and can flip whether a malformed frame logs at
all.** `screen_snapshot` was a modeled `inbound-decoded` row through [#621](../codebase/621.md); since
[#622](../codebase/622.md) removed the kind, it logs via the `unmodeled` row instead —
`code: 'screen_snapshot'` still appears (the daemon-supplied `envelope.type`, capped as always), but
the event name changed and, because the modeled arm's fail-closed parser is gone, a **malformed**
`screen_snapshot` now also logs (previously the throw happened before any `event()` call and left no
record at all). The two outcomes are deliberately indistinguishable beyond `bytes`/`hash` — see
[#622's codebase notes](../codebase/622.md) for the test that pins this as a property.

Load-bearing details:

- **Log AFTER the narrower returns.** Each modeled-arm `event()` fires *after* `parseMessagePayload` / `parseMessageChunkPayload` succeeds, so a frame that fails to narrow throws first and produces **no** record. The size guard and `decodeEnvelope` throws also precede the switch. Ordering — not a flag — is what keeps the **throw path unlogged** (the pre-decryption raw-byte case is sibling [#133](https://github.com/pyrycode/pyrycode-desktop/issues/133); a content-free log for the *post-decryption semantic* throw is a deferred open question).
- **`hash` = BLAKE2s-256 of the plaintext FRAME, not `envelope.payload`.** `hashPlaintext` runs `blake2s(plaintext, { dkLen: 32 })` → 64-char hex, over the input bytes. Hashing the whole frame (not just the payload text) is a **security** choice as much as a determinism one: the digest is implicitly salted by the server-assigned `id` / `ts` / `message_id`, so a read-the-log dictionary attack ("did the user type X?") must reconstruct the entire frame, not merely guess the text. `blake2s` comes from `@noble/hashes`, not `node:crypto` — Electron's BoringSSL has no BLAKE2 ([#101](../codebase/101.md)).
- **The one peer-controlled string is capped.** The modeled arms log a **static type literal** into `code`; the unmodeled arm logs the daemon-supplied `envelope.type` — capped `slice(0, MAX_LOGGED_TYPE_CHARS)` (64). Lossless for real wire types (all < 16 chars); a deterministic bound on a hostile daemon that could otherwise stuff up to `MAX_PLAINTEXT_BYTES` of text into `type`. The [#126](../codebase/126.md) serializer JSON-escapes it, so a crafted `type` cannot split one record into two lines.
- **Absent-logger costs nothing.** `diagnosticLog?.event({ … hash: hashPlaintext(plaintext) })` — the `?.` short-circuits the whole call *including* the hash when no logger is injected, so existing callers pay zero and cannot throw (the AC5 backward-compat property, mirroring `relayConnection`).

The allowlist extension is a single additive optional field on `DiagnosticEvent` — `hash?: string`; the length reuses the pre-existing `bytes?`. See [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) for the allowlist-not-scrubber contract.

**A short numeric probe is a broken leak test ([#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454)).** A no-leak test for a new modeled kind that plants a realistic value and asserts the serialized log line does not contain it needs a *distinctive multi-digit* probe. A two-digit value (a `percentage` of `51`, say) can appear inside the record's own content-free fields by coincidence — `bytes: 651` contains `"51"` — so the assertion passes against a log that leaks nothing and would also pass against one that didn't. The structural assertion (the record's key set is exactly `bytes, code, event, hash, seq, ts`, nothing more) is the one that cannot false-negative this way; treat a substring-absence check as a supplement to it, never a replacement, and pick planted values long/unusual enough that neither `bytes` nor the 64-char `hash` can collide with them by chance.

## The consumer arm (`daemonConnection.ts`)

The [daemon connection](daemon-connection.md)'s `case 'message'` arm is a thin `InboundDaemonMessage → DaemonEvent` mapper — the module's single IPC choke point. As of [#116](../codebase/116.md) it routes on `inbound.kind` via a `switch`, additively: the `message`/`chunk` arms are unchanged, and the three bundle kinds are routed to the [debug-bundle reassembler](debug-bundle-reassembly.md) instead of the IPC channel (bundle frames emit **no** `DaemonEvent`):

```ts
case 'message': {
  let inbound: InboundDaemonMessage | null
  try {
    inbound = parseInboundMessage(event.plaintext, deps.diagnosticLog)   // #130: thread the logger
  } catch {
    return                                            // fail-closed: drop the frame, no event, no throw
  }
  if (inbound === null) return                        // other envelope type: ignored, no event
  switch (inbound.kind) {
    case 'message':
      emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
      return
    case 'chunk':
      emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
      return
    case 'bundle-chunk':
      reassembler?.chunk(inbound.seq, inbound.data)     // #116: routed to the reassembler, not IPC
      return
    case 'bundle-done':
      reassembler?.done(inbound.total)
      return
    case 'daemon-error':
      reassembler?.fail('daemon-error')
      return
    // case 'snapshot' — emit REMOVED #621, kind itself REMOVED #622. Through #620 this
    // content-minimised text/ts/conversation_id and emitted only the settings fields plus the two
    // usage ints (#191) as `snapshotReceived` (and, since #316, a second
    // `screenSnapshotReceived{text,ts}` widening emit alongside it). Both events, this case, and the
    // `InboundDaemonMessage` kind that fed it are all gone — `inbound.kind` can no longer be
    // `'snapshot'` at all; a screen_snapshot frame is now `null` before this switch is even reached.
    case 'assistant-delta':
      // #199: UNLIKE the old 'snapshot' kind (removed #622), text IS carried onward — it's the render payload, not a secret.
      // #751 widened this arm with conversationId — a daemon-asserted routing key, copied by name, required
      // never optional. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      // A fresh named-field literal, never a spread of the decoded payload.
      emitDaemonEvent(sink, {
        type: 'assistantDelta',
        turnId: inbound.delta.turn_id,
        seq: inbound.delta.seq,
        text: inbound.delta.text,
        conversationId: inbound.delta.conversation_id
      })
      return
    case 'turn-end':
      // #752 widened this arm with conversationId too, on the same terms as assistant-delta above —
      // copied by name, required never optional. It stops at the renderer timeline bridge;
      // ThreadEvent still doesn't carry it.
      emitDaemonEvent(sink, {
        type: 'turnEnd',
        turnId: inbound.turnEnd.turn_id,
        stopReason: inbound.turnEnd.stop_reason,
        outcome: inbound.turnEnd.outcome,
        isError: inbound.turnEnd.is_error,
        terminalReason: inbound.turnEnd.terminal_reason,
        errorCategory: inbound.turnEnd.error_category,
        conversationId: inbound.turnEnd.conversation_id,
        daemonTs: inbound.ts
      })
      return
    case 'conversations':
      // #139: nothing to drop (no secret field) — the already-minimal decoded array passes through
      // verbatim, snake_case intact. Mirrors messagesReceived, NOT the snapshot content-drop.
      emitDaemonEvent(sink, {
        type: 'conversationsReceived',
        conversations: inbound.conversations
      })
      return
    case 'turn-state':
      // #214, widened by #724: fresh named-field literal, mirrors 'assistant-delta'. conversationId
      // now crosses too — copied by name, never a spread — as the routing key #674's per-conversation
      // phase needs. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      emitDaemonEvent(sink, {
        type: 'turnState',
        state: inbound.turnState.state,
        conversationId: inbound.turnState.conversation_id
      })
      return
    case 'stall':
      // #315, widened by #732: fresh named-field literal, mirrors 'turn-state'. conversationId now
      // crosses too — copied by name, never a spread — as the routing key #674's per-conversation
      // liveness needs. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      // Onset-only; self-clear is #317's concern.
      emitDaemonEvent(sink, {
        type: 'stallDetected',
        conversationId: inbound.stall.conversation_id
      })
      return
    case 'tool-use':
      // #217: fresh named-field literal, mirrors 'turn-state'. name/input_summary carried onward as
      // opaque display text for the render slice. #642 added a sixth field, input — the already-narrowed
      // fresh map, by reference, unconditional (undefined when the wire omitted it; a pre-pyrycode#1678
      // daemon). #763 widened this arm with conversationId too, on the same terms as assistant-delta/
      // turn-end/turn-state/stall above — copied by name, required never optional, read bare because the
      // decode already guarantees it. It stops at the renderer timeline bridge; ThreadEvent still doesn't
      // carry it.
      emitDaemonEvent(sink, {
        type: 'toolUse',
        conversationId: inbound.toolUse.conversation_id,
        turnId: inbound.toolUse.turn_id,
        toolUseId: inbound.toolUse.tool_use_id,
        name: inbound.toolUse.name,
        inputSummary: inbound.toolUse.input_summary,
        input: inbound.toolUse.input
      })
      return
    case 'modal-shown':
      // #201: fresh named-field literal. options reused verbatim (parseModalOption already stripped
      // each to {id,label}). #871 widened this arm with conversationId — the payload's
      // conversation_id (pyrycode#1065, decoded by #870), copied by name and read bare, since
      // parseModalShownPayload already requires it. Outbound scoping only; it stops at the modal
      // bridge (#223), dormant until #872.
      emitDaemonEvent(sink, {
        type: 'modalShown',
        conversationId: inbound.modalShown.conversation_id,
        modalId: inbound.modalShown.modal_id,
        class: inbound.modalShown.class,
        title: inbound.modalShown.title,
        prompt: inbound.modalShown.prompt,
        options: inbound.modalShown.options,
        defaultOptionId: inbound.modalShown.default_option_id
      })
      return
    case 'modal-dismissed':
      // #201: fresh named-field literal. NO conversation_id — a dismissal carries none (modal_shown
      // does, and rides it across as of #871).
      emitDaemonEvent(sink, {
        type: 'modalDismissed',
        modalId: inbound.modalDismissed.modal_id,
        outcome: inbound.modalDismissed.outcome,
        source: inbound.modalDismissed.source
      })
      return
  }
  return
}
```

The caught `WireDecodeError` is **dropped** (classify-don't-forward): its message could echo message plaintext, so it never reaches a log or an event. A bundle frame with no active (or already-settled) `reassembler` is a no-op via optional chaining — preserving the pre-#116 drop behavior when no bundle request is in flight.
