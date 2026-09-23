# #1586 — Send `mcp_toggle` and route its correlated refusal

## Files read

- `docs/specs/architecture/1582-mcp-reconnect.md` and commit `d74376f5` → the precedent. This slice is the same send, bound, correlate, clear shape with a third field. Every section below is a delta against it.
- `src/shared/wire/types.ts` → `EnvelopeType` (the `'mcp_reconnect'` member), `MCPReconnectPayload`. The new type and payload go beside them.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isMCPReconnectPayload`. The guard the new one mirrors, plus a boolean field.
- `src/shared/ipc/events.ts` → the `mcpReconnectRejected` arm of `BaseDaemonEvent`. The new arm sits beside it with the same single field.
- `src/main/transport/mcpReconnectEnvelope.ts` → `buildMcpReconnect`. The fresh-payload builder the new one copies.
- `src/main/daemonConnection.ts` → `DaemonConnection.reconnectMcpServer` and its body, `MAX_PENDING_MCP_RECONNECTS`, `pendingMcpReconnects`, the reconnect-refusal match in the `daemon-error` arm, and the per-dial reset block.
- `src/main/connectionRegistry.ts` → the delegating `DaemonConnection` in `createConnectionRegistry`. `src/main/connectionRegistry.test.ts` → its full fake `DaemonConnection`, which must gain the method to typecheck.
- `src/main/index.ts` → the `'reconnectMcpServer'` case, routed by conversation through `router.route`.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,questionBridge,timelineBridge}.ts` → the `case 'mcpReconnectRejected'` arms in each `assertNever` switch.
- `src/renderer/src/store/mcpStatusBridge.ts` → an `if`/`else` over event types, not exhaustive, so it needs no case. Wiring the refusal into the store is the switch slice, #1587.
- pyrycode `docs/protocol-mobile.md` § Actuating MCP servers on demand → the payload is exactly `conversation_id`, `server_name` and `enabled` (bool, "always present on the wire", with an omitted key decoding as `false`). An accepted request answers with an `mcp_status` correlated by `in_reply_to`. The refusal codes are `mcp_actuation.refused`, `protocol.malformed` and `conversation.not_found`, all non-retryable. A connection without `interactive` gets no reply.

## Design source

N/A. Transport and IPC only. Nothing in the window renders the new event yet; the switch is #1587.

## Context

This is the transport half of the channel info sheet's per-server on/off switch. The success path already works, because an accepted toggle answers with an ordinary `mcp_status` that arrives as `mcpStatus`.

**Sizing.** There are 11 production files, over the five-file line. Seven are one-line forced additions: the registry delegate, the `index.ts` route and four `assertNever` bridge cases. The ticket is a grandchild (#1251 → #1493 → #1586), so it is built whole and marked `needs-human:sizing`. The #1582 analogue landed at 363 insertions with the same file set.

No decode change and no ADR are needed. As with #1582, the refusal match reads only `inReplyTo`.

## Design

### Outbound

- `types.ts`: add `'mcp_toggle'` to `EnvelopeType` after `'mcp_reconnect'`, and `export interface MCPTogglePayload { conversation_id: string; server_name: string; enabled: boolean }`. `enabled` is non-optional in the type, so the compiler refuses a payload without it.
- `commands.ts`: add `| { type: 'toggleMcpServer'; payload: MCPTogglePayload }`. `isMCPTogglePayload` requires a non-null object with present-and-string `conversation_id` and `server_name`, and a present-and-boolean `enabled`. Empty strings are accepted, as the reconnect guard accepts them. Truthy stand-ins (`1`, `'true'`, `null`) are rejected.
- New `src/main/transport/mcpToggleEnvelope.ts`: `buildMcpToggle({ id, ts, conversationId, serverName, enabled }): Uint8Array`. It builds a fresh three-field payload, so extra renderer fields never reach the wire and `enabled` is always written, for `false` as well as `true`.
- `DaemonConnection.toggleMcpServer(conversationId: string, serverName: string, enabled: boolean): void` is `reconnectMcpServer`'s body with the extra argument. It uses its own map `pendingMcpToggles` (cap `MAX_PENDING_MCP_TOGGLES` = 32, oldest evicted, recorded after the send) and its own log events: `mcp-toggle-refused`/`unavailable`, `mcp-toggle-sent`, and `mcp-toggle-failed`/`build-or-send-failed`. Neither the server name nor the requested state is logged or stored. The map value is the conversation id only.
- `connectionRegistry`: one delegate line. `index.ts`: a `'toggleMcpServer'` case, `router.route(id)?.toggleMcpServer(id, command.payload.server_name, command.payload.enabled)`.

The requested state is passed straight from the command to the builder. Nothing on this side reads the MCP status store or derives the state.

### The refusal

- `events.ts`: `{ type: 'mcpToggleRejected'; conversationId: string }`. There is no reason, code, message, server name, requested state or `in_reply_to`. It is a distinct arm from `mcpReconnectRejected`, which is how the sheet tells the two refusals apart.
- `daemonConnection`'s `daemon-error` arm gets a match directly after the reconnect one: `pendingMcpToggles.get(inReplyTo)`. On a hit it deletes the entry, logs `mcp-toggle-rejected` with no code, emits `mcpToggleRejected { conversationId: <recorded id> }`, and returns. It never reads `inbound.outcome`, so every code, an unknown one and an unreadable payload all produce the same event.
- The per-dial reset block gains `pendingMcpToggles.clear()`.
- The four renderer bridges get `case 'mcpToggleRejected':` beside `case 'mcpReconnectRejected':`.

Separate maps are used for reconnect and toggle, not one shared map with a kind tag. Envelope ids come from one sequence, so an id is in at most one map and the matches cannot collide. Two maps also keep each verb's shape identical to its precedent.

## State + concurrency model

There is one new per-connection map in main, `pendingMcpToggles: Map<number, string>`, from envelope id to the conversation id this app named. Its lifecycle matches `pendingMcpReconnects`. An entry is created only after a successful send and is removed by a correlated `error`, by eviction past 32, or by the next dial. A success reply does not consume an entry, which is why the map is bounded. All of this is synchronous. There are no timers and no retries.

## Error handling

| Failure | Result |
|---|---|
| Malformed command (a string field missing or not a string, `enabled` missing or not a boolean) | `isRendererCommand` rejects it and main's switch never sees it |
| Unknown or unrouted conversation | `router.route` returns `null`, so nothing is sent |
| Not connected or not authenticated | a refused log, nothing sent, no throw |
| Build or send throws | caught, content-free log, no entry, no retry |
| No reply | nothing happens; there is no timer |
| Correlated `error`, any code or none | one `mcpToggleRejected` naming the recorded conversation |
| Uncorrelated or stale `error` | falls through to the existing handling unchanged |

## Testing strategy

Unit tests only. No e2e spec is needed, because nothing in the window is driven.

- `mcpToggleEnvelope.test.ts`: `it.each` over awkward strings × `enabled` `true` and `false`. It checks type `mcp_toggle`, id, ts and a payload of exactly the three fields with extras dropped. It also asserts that `'enabled' in payload` holds for `false`.
- `commands.test.ts`: accepts string fields (including `''`) for both booleans; rejects a missing or non-object payload, a missing or non-string string field, and `enabled` that is missing, `undefined`, `null`, `0`, `1` or `'true'`; includes a compile-time `@ts-expect-error` block that also covers a missing `enabled`.
- `daemonConnection.test.ts`, a new describe mirroring #1582's:
  - One frame on the shared id sequence with the exact payload, for both `enabled` values. 60 s of fake timers re-sends nothing.
  - Inert before start, while unauthenticated and after stop. No conversation id or server name appears in logs.
  - A send failure is caught and not retried, and a later error at that id emits nothing.
  - `it.each` over the three codes, an unknown code and a non-string code: exactly one `{ type: 'mcpToggleRejected', conversationId: 'conv-42' }`, and never an `mcpReconnectRejected`. The server name and the daemon message never appear in events or logs.
  - A reconnect and a toggle outstanding together: each refusal settles as its own event type.
  - The entry survives a correlated `mcp_status` and is consumed by the first refusal. The 33rd toggle evicts the oldest. A reconnect of the connection clears outstanding entries.
  - Routing through `onCommand` with `createConversationRouter`: extra fields are stripped, and unknown or absent hosts send nothing.
- `connectionRegistry.test.ts`: the delegate forwards all three arguments, `false` included, only to the named host.
- Bridges: `npm run build` proves the exhaustive switches.

## Open questions

- None blocking. Names follow the precedent: `MCPTogglePayload`, `buildMcpToggle`, `toggleMcpServer` (command and method), `mcpToggleRejected`.

## Documentation handoff

The ticket body has no Documentation handoff section. This is pending for the documentation stage: fold the `mcp_toggle` send and its merged refusal into `docs/knowledge/features/daemon-connection-correlation-system-prompt-and-mcp.md`, beside the `mcp_reconnect` entry.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Renderer to main: the `toggleMcpServer` arm of `isRendererCommand` checks the two strings and requires `typeof enabled === 'boolean'`, so a renderer cannot slip `'false'` (truthy) or `1` past it. `buildMcpToggle` builds a fresh payload, so a smuggled `serverId` or `token` never reaches the wire. `router.route` refuses a conversation that no host claims. Daemon to main: the refusal match reads only `inReplyTo`. The event's `conversationId` comes from `pendingMcpToggles`, so a hostile daemon cannot make a refusal name a conversation this app did not act on, and it cannot make a toggle refusal pose as a reconnect refusal or the reverse. Each is settled from its own map.
- [Requested state] No findings. `enabled` is written explicitly for both values. The client never relies on the daemon's omitted-key default, so the operator's `false` cannot silently become "absent" in transit. The state is not derived from or checked against `mcpStatusStore`, so a stale or hostile status report cannot flip what the operator asked for. The escalating direction (`true`) is gated by the daemon's per-device check (pyrycode#2420), not by this client.
- [Untrusted `server_name`] No findings, by design. It is claude-authored text, sent back unchanged. Here it is only a builder argument. It is not a log field, not a map key (the map stores only the conversation id), not a path and not an authorization input. The tests assert it is absent from logs and events. The #1582 note stands for #1587: source the name from an `mcp_status` row, never from a `context_usage` `mcp_tools[].server_name`.
- [Tokens] No findings. No credential is created, read or carried, and ids are not logged.
- [File / storage] No findings. Nothing touches disk.
- [Electron attack surface] SHOULD FIX, folded into the design. A compromised renderer could toggle in a loop, and a success reply does not consume an entry, so the map is capped at 32 with oldest-first eviction. The renderer can already send any typed command, and the daemon gates and audits each actuation per device, so this slice adds no capability. There is no new bridge API; the command rides the existing `sendCommand` channel.
- [Crypto] No findings. The frame goes through the existing Noise session via `driver.sendMessage`.
- [Network & I/O] No findings. Nothing is retried after a send failure, a missing reply or any refusal, so a silent or hostile daemon cannot induce a request loop. Inbound frames stay bounded by the existing `MAX_PLAINTEXT_BYTES` guard.
- [Logs] No findings. Event names are static, and `code` is a client-owned literal or absent. The daemon's code and message, the server name, the requested state and the caught exception are all dropped.
- [Concurrency] No findings. The work is synchronous in main. The per-dial reset clears the map, so a recycled envelope id cannot settle against a dead connection. The entry is recorded after the send.
- [Threat model] OUT OF SCOPE: presenting the refusal and the switch itself are #1587.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
