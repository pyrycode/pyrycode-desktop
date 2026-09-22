# #1578 — Ask the daemon for a conversation's MCP status, and route a correlated refusal

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` (the `'mcp_status'` comment says the ask is "not declared on this side yet"), `RequestContextUsagePayload`. This file gets the new outbound type and payload.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isRequestContextUsagePayload`. This is the renderer→main boundary guard the new command mirrors.
- `src/shared/ipc/events.ts` → the `mcpStatus` arm, `systemPromptWriteRejected`, `SystemPromptWriteFailure`. These set the IPC event shape and the rule that a reason union is mirrored by hand.
- `src/main/transport/requestContextUsageEnvelope.ts` → `buildRequestContextUsage`. It is the fresh-one-field-payload builder the new builder copies.
- `src/main/transport/inboundMessage.ts` → `narrowDaemonErrorOutcome`, `narrowSystemPromptRejectReason`, `SystemPromptRejectReason`, the `daemon-error` arm of `InboundDaemonMessage`, and the `'error'` case of `parseInboundMessage`. The per-verb narrowing idiom lives here.
- `src/main/daemonConnection.ts` → `DaemonConnection.requestContextUsage` and its body, `pendingSystemPromptWrites` (set-after-send, the error-arm match), `pendingCreateConversations` (lives until a correlated error or the next dial), and the per-dial reset block. Together these set the outbound, the correlation and the lifecycle.
- `src/main/connectionRegistry.ts` → the delegating `DaemonConnection` built in `createConnectionRegistry`.
- `src/main/index.ts` → the `'requestContextUsage'` case in the command switch, which routes by conversation through `router.route`.
- `src/renderer/src/store/{questionBridge,daemonEventBridge,timelineBridge,modalBridge}.ts` → the informational `case 'mcpStatus'` arms in each exhaustive switch.
- `docs/specs/architecture/1503-request-context-usage.md`: the outbound analogue.

## Design source

N/A. This is transport and IPC only, and nothing in the window renders the new event yet. The channel info sheet's on-open trigger and its notice are #1579.

## Context

The daemon answers `mcp_status_request { conversation_id }` with one `mcp_status` (correlated by `in_reply_to`, no `event_id`) or one correlated `error`. The error carries `protocol.malformed` or `conversation.not_found` (not retryable, a bug here) or `mcp_status.unavailable` (retryable after a backoff). The answer is the payload #1489 decodes and #1490 stores, so it needs no new decode. This slice declares the ask and delivers a correlated refusal as a client-owned reason. It ships dormant, and #1579 adds the trigger.

**Sizing.** 8 production files plus four one-line bridge arms, over the five-file line. The ticket is a grandchild (#1251 → #1491 → #1578), and splitting the verb from its refusal fails the floor rule. It is kept whole and marked `needs-human:sizing` (comment on the issue).

**A fourth per-verb narrowed field.** The `daemon-error` arm's comment says three per-verb narrowed fields is the ceiling of that shape, and that a fourth should prompt a rethink toward one verb-tagged field. This ticket prescribes the per-verb pattern, and the rethink would refactor three shipped verbs. This slice adds the fourth field and amends that comment to say four. **ADR candidate for the documentation phase:** collapse the per-verb reject fields into one `{ verb, reason }` field before a fifth verb lands.

## Design

### Outbound

- `types.ts`: add `'mcp_status_request'` to `EnvelopeType` beside `'request_context_usage'`, and `export interface MCPStatusRequestPayload { conversation_id: string }`. Reword the `'mcp_status'` comment so it no longer says the ask is undeclared.
- `commands.ts`: `| { type: 'requestMcpStatus'; payload: MCPStatusRequestPayload }`. The guard arm is `'payload' in value && isMCPStatusRequestPayload(value.payload)`, a present-and-string `conversation_id` check (accepts `''`; routing decides).
- `src/main/transport/requestMcpStatusEnvelope.ts`: `buildRequestMcpStatus({ id, ts, conversationId }): Uint8Array`. It builds a fresh one-field payload, so extra renderer fields never reach the wire.
- `DaemonConnection.requestMcpStatus(conversationId: string): void`:
  - When not connected or not authenticated, it logs `mcp-status-request-refused`/`unavailable` and returns.
  - Otherwise it takes one `envelopeId` local, builds, advances `nextEnvelopeId`, sends, **then** records `pendingMcpStatusRequests.set(envelopeId, conversationId)` and logs `mcp-status-request-sent`.
  - `catch` drops the exception, logs `mcp-status-request-failed`/`build-or-send-failed`, records nothing and never retries.
- `connectionRegistry`: one delegate line. `index.ts`: a `'requestMcpStatus'` case, `router.route(id)?.requestMcpStatus(id)` with the same id for lookup and send.

### The answer

The existing `mcp-status` inbound kind emits `mcpStatus` under the payload's conversation id, whether the frame was correlated or not. Nothing changes and nothing consumes a pending entry (the kind carries no `in_reply_to`, by the ticket's instruction).

### The refusal

- `inboundMessage.ts`: `export type MCPStatusRejectReason = 'mcp-status-unavailable'`. `narrowMCPStatusRejectReason(payload: unknown): MCPStatusRejectReason | undefined` compares `code` against the one literal. It is total, throws nothing, retains nothing, and returns `undefined` for any other code, a non-string code or a non-record payload. The `daemon-error` kind gains optional `mcpStatusReject?: MCPStatusRejectReason`, filled in the `'error'` case beside `systemPromptReject`. `DaemonErrorOutcome` is untouched.
- `events.ts`: `export type MCPStatusRequestFailure = 'mcp-status-unavailable' | 'unclassified'` (mirrored by hand, like `SystemPromptWriteFailure`). The arm is `{ type: 'mcpStatusRequestRejected'; conversationId: string; reason: MCPStatusRequestFailure }` and carries no code, message or `in_reply_to`.
- `daemonConnection` `daemon-error` arm: this is a new correlation beside the `pendingSystemPromptWrites` match. `pendingMcpStatusRequests.get(inReplyTo)`. On a hit, it deletes the entry, logs `mcp-status-request-rejected` with `code: reason`, emits `mcpStatusRequestRejected { conversationId: <the id this app asked about>, reason: inbound.mcpStatusReject ?? 'unclassified' }` and returns (consuming the frame, like its siblings). The `mcpStatusStore` is not touched: nothing clears or fabricates a report.
- The per-dial reset block gains `pendingMcpStatusRequests.clear()`.
- The four renderer bridges get `case 'mcpStatusRequestRejected':` beside their informational `case 'mcpStatus':` arm. #1579 consumes it.

## State + concurrency model

The one new state is `pendingMcpStatusRequests: Map<number, string>` (envelope id → conversation id this app named), per connection, in the main process. An entry is created only after a successful send. It is removed by a correlated `error` or cleared on the next dial. A success reply does not remove it (ticket Technical Notes). Without a bound, the map would grow by one entry per answered request for the connection's lifetime. The renderer is untrusted relative to main, so the map is capped at `MAX_PENDING_MCP_STATUS_REQUESTS` (32) entries. Recording a 33rd evicts the oldest by `Map` insertion order. The daemon answers promptly, so a refusal to an evicted request can only be one that arrives after 32 newer asks, and dropping it is harmless: no report is changed and nothing retries. No timers, no retry, no async work.

## Error handling

| Failure | Result |
|---|---|
| Malformed renderer command | `isRendererCommand` rejects it and it never reaches main's switch |
| Unknown or unrouted conversation | `router.route` → `null`; nothing sent, no throw |
| Not connected / not authenticated | refused log, nothing sent, no throw |
| Build or send throws | caught, content-free log, no entry, no retry |
| No reply | nothing happens; no timer |
| Correlated `mcp_status.unavailable` | `mcpStatusRequestRejected` / `mcp-status-unavailable` |
| Correlated other/unknown code, unreadable payload | `mcpStatusRequestRejected` / `unclassified` |
| Uncorrelated or stale `error` | falls through to existing handling unchanged |

## Testing strategy

Unit tests only (the ticket defers fake-transport and real-claude proof to #1579).

- `requestMcpStatusEnvelope.test.ts`: the envelope type, the id and ts, and a payload of exactly `{ conversation_id }`.
- `commands.test.ts`: accepts a string id (including `''`) with extra fields. Rejects a missing, null or non-string id and a missing or non-object payload. Includes the compile-time `@ts-expect-error` block.
- `inboundMessage.test.ts`: `mcp_status.unavailable` → `mcpStatusReject: 'mcp-status-unavailable'`. `protocol.malformed`, `conversation.not_found`, an unknown code, a non-string code and a non-record payload → `undefined`. `outcome` stays `unclassified`.
- `daemonConnection.test.ts` (new describe):
  - Sends exactly one frame on the shared id sequence, and advancing timers 60 s re-sends nothing.
  - Inert before start / unauthenticated / after stop, with no throw and no id in logs.
  - A send failure is caught, not retried, and a later error with that id emits nothing.
  - A correlated `mcp_status` emits `mcpStatus` under the payload's conversation id.
  - The 33rd recorded ask evicts the oldest: an error correlated to the first id emits nothing, and an error correlated to the second still emits.
  - A correlated `error` per code emits exactly one `mcpStatusRequestRejected` naming the asked-about conversation with the mapped reason (payload with a different `conversation_id` or daemon message never appears in it, and there is no `mcpStatus`). The entry survives a success reply and is consumed by the error (a second error with the same id emits nothing). An uncorrelated error emits no rejection. A reconnect clears the entry. Nothing is re-sent after a refusal.
  - Routing through `onCommand` + `createConversationRouter`: extra fields are stripped, and unknown or absent hosts send nothing.
- `connectionRegistry.test.ts`: the delegate forwards only to the named host.
- Bridges: the exhaustive switches are proven by `npm run build` (typecheck).

## Open questions

- None blocking. The naming follows the `MCPStatusPayload` capitalisation for types and `requestMcpStatus` for the command, which matches how `requestContextUsage` names its verb.

## Documentation handoff

The ticket body has no Documentation handoff section. Pending for the documentation stage: fold the new verb and refusal into the MCP status feature overview under `docs/knowledge/features/`. Also consider the ADR candidate named in Context.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Two boundaries, each a single named function:
  - **Renderer → main.** `isRendererCommand`'s `requestMcpStatus` arm (present-and-string id). `buildRequestMcpStatus` then builds a fresh one-field payload, so a smuggled field (`serverId`, `token`) never reaches the wire. `router.route` refuses an id no host claims.
  - **Daemon → main.** `narrowMCPStatusRejectReason` uses the untrusted `code` only as a comparand against one client-owned literal and then drops it.

  The rejection event's `conversationId` is read from `pendingMcpStatusRequests` (the value this app sent), never from the error payload. A hostile daemon therefore cannot make a refusal name a conversation this app did not ask about.
- [Tokens] No findings. No credential is created, read or carried. The conversation id is not logged on any path, and the unit test asserts it is absent from the log records.
- [File / storage] No findings. Nothing touches disk.
- [Electron attack surface] SHOULD FIX, folded into the design. A compromised renderer could call `requestMcpStatus` in a loop, and because a success reply does not consume the pending entry, the map would grow without bound until the next dial. The map is capped at 32 with oldest-first eviction (State + concurrency model). The verifier checks the cap and its test. No new bridge API: the command rides the existing typed `sendCommand` channel.
- [Crypto] No findings. The frame goes through the existing Noise session via `driver.sendMessage`, and no primitive is added.
- [Network & I/O] No findings. There is no retry on a send failure, a missing reply or any refusal (including the retryable `mcp_status.unavailable`), so a hostile or silent daemon cannot induce a request loop. Inbound frames stay bounded by the existing `MAX_PLAINTEXT_BYTES` guard in `parseInboundMessage`.
- [Logs] No findings. The event names are static (`mcp-status-request-sent` / `-refused` / `-failed` / `-rejected`), and the `code` field is always a client-owned literal (`unavailable`, `build-or-send-failed`, or the narrowed reason). The daemon's `code` and `message` and the caught exception are dropped.
- [Concurrency] No findings. Everything is synchronous in the main process. The per-dial reset clears the map, so a recycled envelope id on a reconnected session cannot correlate a new error to an old ask. The entry is recorded after the send, so a throwing send leaves no entry under an id that is not advanced. The id stays unadvanced only if the build throws.
- [Threat model] OUT OF SCOPE: a hostile daemon can already publish an uncorrelated `mcp_status` for any conversation (the existing live path from #1490). This slice neither widens nor narrows that. Rendering the refusal is #1579's job, and the event's `conversationId` is a routing key there: never markup, an attribute, a URL or a log field.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
