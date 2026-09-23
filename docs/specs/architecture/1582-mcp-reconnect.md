# #1582 — Send `mcp_reconnect` and route its correlated refusal

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` (the `'mcp_status_request'` member), `MCPStatusRequestPayload`. The new outbound type and payload go beside them.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isMCPStatusRequestPayload`. The renderer→main guard the new command mirrors, with a second string field.
- `src/shared/ipc/events.ts` → the `mcpStatusRequestRejected` arm of `BaseDaemonEvent`. The new arm sits beside it, without a reason field.
- `src/main/transport/requestMcpStatusEnvelope.ts` → `buildRequestMcpStatus`. The fresh-payload builder the new one copies.
- `src/main/daemonConnection.ts` → `DaemonConnection.requestMcpStatus` and its body, `MAX_PENDING_MCP_STATUS_REQUESTS`, `pendingMcpStatusRequests`, the correlated-refusal match in the `daemon-error` arm, and the per-dial reset block. The exact precedent for send, bound, correlate and clear.
- `src/main/transport/inboundMessage.ts` → the `daemon-error` arm of `InboundDaemonMessage` and its "four per-verb narrowed fields" comment. Read to confirm this slice adds **no** field there: every correlated code maps to one event, so `inbound.inReplyTo` is all the match needs.
- `src/main/connectionRegistry.ts` → the delegating `DaemonConnection` in `createConnectionRegistry`; `src/main/connectionRegistry.test.ts` → its full fake `DaemonConnection`, which must gain the method to typecheck.
- `src/main/index.ts` → the `'requestMcpStatus'` case, which routes by conversation through `router.route`.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,questionBridge,timelineBridge}.ts` → the `case 'mcpStatusRequestRejected'` arms in each `assertNever` switch.
- `docs/specs/architecture/1578-request-mcp-status.md` → the precedent plan and its security review.
- pyrycode `docs/protocol-mobile.md` § Actuating MCP servers on demand → payload is exactly `conversation_id` + `server_name`; success is an `mcp_status` correlated by `in_reply_to`; refusals are `mcp_actuation.refused`, `protocol.malformed`, `conversation.not_found`, all non-retryable. A connection without `interactive` gets no reply at all.

## Design source

N/A. Transport and IPC only; nothing in the window renders the new event yet. The Reconnect control is a later slice of #1492.

## Context

The channel info sheet will offer a Reconnect control per MCP server row. This slice is its transport half: one renderer command in, one `mcp_reconnect` frame out, and one refusal event back. The success path already works: an accepted reconnect answers with an ordinary `mcp_status`, which the existing decode delivers as `mcpStatus`.

**Sizing.** 11 production files, over the five-file line. Seven are one-line forced additions (registry delegate, `index.ts` route, four `assertNever` bridge cases). The ticket is a grandchild (#1251 → #1492 → #1582), so it is built whole and marked `needs-human:sizing` (comment on the issue).

**No decode change.** The daemon merges every actuation refusal into one code on purpose, and the ticket forbids re-splitting them. So there is no per-verb narrowing and no fifth field on the `daemon-error` arm. The ADR candidate from #1578 (collapse the per-verb reject fields) is not triggered by this slice.

## Design

### Outbound

- `types.ts`: add `'mcp_reconnect'` to `EnvelopeType` beside `'mcp_status_request'`, and `export interface MCPReconnectPayload { conversation_id: string; server_name: string }`.
- `commands.ts`: `| { type: 'reconnectMcpServer'; payload: MCPReconnectPayload }`. Guard arm: `'payload' in value && isMCPReconnectPayload(value.payload)`, where the guard requires a non-null object with present-and-string `conversation_id` **and** `server_name`. It accepts `''` for either: routing decides the conversation, the daemon decides the server.
- New `src/main/transport/mcpReconnectEnvelope.ts`: `buildMcpReconnect({ id, ts, conversationId, serverName }): Uint8Array`. Fresh two-field payload, so extra renderer fields never reach the wire.
- `DaemonConnection.reconnectMcpServer(conversationId: string, serverName: string): void`, the body of `requestMcpStatus` with the second field:
  - Not connected or not authenticated → log `mcp-reconnect-refused`/`unavailable`, return.
  - Otherwise: take `envelopeId`, build, advance `nextEnvelopeId`, send, **then** record `pendingMcpReconnects.set(envelopeId, conversationId)` (oldest evicted at `MAX_PENDING_MCP_RECONNECTS` = 32) and log `mcp-reconnect-sent`.
  - `catch`: drop the exception, log `mcp-reconnect-failed`/`build-or-send-failed`, record nothing, never retry.
  - The server name is only ever an argument to the builder. It is never logged, stored, or used as a key.
- `connectionRegistry`: one delegate line. `index.ts`: a `'reconnectMcpServer'` case, `router.route(id)?.reconnectMcpServer(id, command.payload.server_name)`, same id for lookup and send.

### The refusal

- `events.ts`: `{ type: 'mcpReconnectRejected'; conversationId: string }`. No reason, code, message, server name or `in_reply_to`: every refusal is one permanent outcome.
- `daemonConnection` `daemon-error` arm: a new match beside `pendingMcpStatusRequests`. `pendingMcpReconnects.get(inReplyTo)`; on a hit, delete the entry, log `mcp-reconnect-rejected` (no code), emit `mcpReconnectRejected { conversationId: <the recorded id> }`, return (consuming the frame, like its siblings). It never reads `inbound.outcome` or any narrowed field, so every code — including an unknown one or an unreadable payload — produces the same event.
- The per-dial reset block gains `pendingMcpReconnects.clear()`.
- The four renderer bridges get `case 'mcpReconnectRejected':` beside `case 'mcpStatusRequestRejected':`.

## State + concurrency model

One new per-connection map in main, `pendingMcpReconnects: Map<number, string>` (envelope id → conversation id this app named). Created only after a successful send; removed by a correlated `error`, by eviction past 32, or by the next dial. A success reply (`mcp_status`) does not consume it, which is why it is bounded: a renderer reconnecting in a loop cannot grow it. Everything is synchronous; no timers, no retry.

## Error handling

| Failure | Result |
|---|---|
| Malformed command (either field missing or not a string) | `isRendererCommand` rejects it; never reaches main's switch |
| Unknown or unrouted conversation | `router.route` → `null`; nothing sent |
| Not connected / not authenticated | refused log, nothing sent, no throw |
| Build or send throws | caught, content-free log, no entry, no retry |
| No reply | nothing happens; no timer |
| Correlated `error`, any code or none | one `mcpReconnectRejected` naming the recorded conversation |
| Uncorrelated or stale `error` | falls through to existing handling unchanged |

## Testing strategy

Unit tests only; the live drive is #1583.

- `mcpReconnectEnvelope.test.ts`: type `mcp_reconnect`, id, ts and a payload of exactly `{ conversation_id, server_name }` with extra input fields dropped, for awkward strings (`''`, `'__proto__'`, markup-ish).
- `commands.test.ts`: accepts string fields (including `''`) with extras; rejects a missing/non-object payload and a missing, null or non-string value in either field; compile-time `@ts-expect-error` block.
- `daemonConnection.test.ts` (new describe, mirroring #1578's):
  - Sends exactly one frame on the shared id sequence with the exact payload; 60 s of fake timers re-sends nothing.
  - Inert before start / unauthenticated / after stop; no conversation id or server name in logs.
  - A send failure is caught, not retried, and a later error at that id emits nothing.
  - `it.each` over `mcp_actuation.refused`, `protocol.malformed`, `conversation.not_found`, an unknown code and a non-string code: exactly one `{ type: 'mcpReconnectRejected', conversationId: 'conv-42' }`; the error payload's own `conversation_id`, message and the server name never appear in events or logs; nothing re-sent.
  - The entry survives a correlated `mcp_status` (which still emits `mcpStatus`) and is consumed by the first refusal.
  - The 33rd reconnect evicts the oldest.
  - A reconnect clears outstanding entries.
  - Routing through `onCommand` + `createConversationRouter`: extra fields stripped; unknown or absent hosts send nothing.
- `connectionRegistry.test.ts`: the delegate forwards both arguments only to the named host.
- Bridges: the exhaustive switches are proven by `npm run build`.

## Open questions

- None blocking. Names follow the precedent's casing: `MCPReconnectPayload` for the wire type, `reconnectMcpServer` for the command and method (a verb, as `requestMcpStatus` is), `mcpReconnectRejected` for the event.

## Documentation handoff

The ticket body has no Documentation handoff section. Pending for the documentation stage: fold the `mcp_reconnect` send and its merged refusal into `docs/knowledge/features/daemon-connection-correlation-system-prompt-and-mcp.md` beside the MCP status ask.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Renderer → main: `isRendererCommand`'s `reconnectMcpServer` arm checks both fields are strings; `buildMcpReconnect` builds a fresh two-field payload so a smuggled `serverId` or `token` never reaches the wire; `router.route` refuses a conversation no host claims. Daemon → main: the refusal match reads only `inReplyTo`, and the event's `conversationId` comes from `pendingMcpReconnects` (the value this app sent), so a hostile daemon cannot make a refusal name a conversation this app did not act on. The daemon's `code` is not consulted at all.
- [Untrusted `server_name`] No findings, by design. It is claude-authored text from the status row, sent back unchanged as the wire contract requires. On this side it is a builder argument only: not a log field, not a map key (the map stores only the conversation id), not a path, not an authorization input. Authorization is the daemon's per-device gate (pyrycode#2420). The unit tests assert the name is absent from log records and events. The upstream warning against feeding a `context_usage` `mcp_tools[].server_name` into this verb is noted for the UI slice, which must source the name from an `mcp_status` row.
- [Tokens] No findings. No credential is created, read or carried; ids are not logged.
- [File / storage] No findings. Nothing touches disk.
- [Electron attack surface] SHOULD FIX, folded into the design. A compromised renderer could reconnect in a loop, and a success reply does not consume the entry, so the map is capped at 32 with oldest-first eviction. It could also ask the daemon to reconnect servers repeatedly; that is an actuation the daemon gates and audits per device, and the renderer can already send any command it likes, so this slice adds no capability a compromised renderer lacked. No new bridge API: the command rides the existing typed `sendCommand` channel.
- [Crypto] No findings. The frame goes through the existing Noise session via `driver.sendMessage`.
- [Network & I/O] No findings. No retry on a send failure, a missing reply or any refusal, so a hostile or silent daemon cannot induce a request loop. Inbound frames stay bounded by the existing `MAX_PLAINTEXT_BYTES` guard.
- [Logs] No findings. Event names are static; `code` is always a client-owned literal or absent; the daemon's `code` and `message`, the server name and the caught exception are dropped.
- [Concurrency] No findings. Synchronous in main; the per-dial reset clears the map, so a recycled envelope id cannot settle a new connection's refusal against a dead one's conversation; the entry is recorded after the send.
- [Threat model] OUT OF SCOPE: presenting the refusal and sourcing the server name from a status row are the UI slice of #1492; the live device-gate drive is #1583.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
