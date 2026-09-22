# #1489 — decode the `mcp_status` frame

## Files read

- `src/main/transport/inboundMessage.ts`
  - `parseInboundMessage` → the `case 'context_usage'` arm: the frame-level shape this arm copies (narrow, then log a static code with bytes and hash, return a kind with no `FrameTimestamp`).
  - `InboundDaemonMessage` → the union the new `kind` joins, and its docblock paragraph per kind, which this kind adds to.
  - `parseContextUsageMCPTool` → the row-level shape: `isRecord` gate, plain `requireString`s, fresh literal, category-only messages. The structure is copied but its inertness doctrine is not (see Context).
  - `parseContextUsagePayload` → `Array.isArray`-then-`map` for the list, plain `requireNumber` for the dropped count, a fresh literal return.
  - `isRecord`, `requireString`, `requireNumber`, `WireDecodeError` (from `./codec`) → the helpers used; no new helper.
  - `decodeHistoryEvent` → its `default: return null` covers the new type too; no arm is added there.
- `src/shared/wire/types.ts` → the `'context_usage'` member of the inbound type union (with its SSOT comment) and `ContextUsageMCPTool` / `ContextUsagePayload`, the naming precedent (no `Wire` prefix, capitalised acronym) and the docblock family.
- `src/main/transport/inboundMessage.test.ts` → the `CONTEXT_USAGE_FRAME` fixture constant, the `context_usage` describe blocks, the `#130` content-free-diagnostic block with `captureLog`, and the history-skip `it.each` list.
- Daemon contract (sibling `pyrycode` checkout, `9c2202fd`; the ticket read it at `72bd31ba`, and the shape did not change) → `MCPStatusPayload`, `MCPServerStatus` and `MarshalJSON` in `internal/protocol/interactive.go`; `TypeMCPStatus` in `internal/protocol/codes.go`; `internal/protocol/testdata/mcp_status.json`.

## Design source

N/A. The slice renders nothing: this is a decode only, with no IPC, store or UI.

## Context

The daemon publishes `mcp_status` (claude's MCP server list for a conversation) live and as the answer to `mcp_status_request`. Today it falls through the decoder's `default:` arm and is logged as `inbound-unmodeled`. This slice narrows it into typed values and nothing else. The arm ships dormant: `daemonConnection`'s inbound switch has no catch-all, so the decoded value stops here until #1490 carries it.

**The provenance differs from `ContextUsageMCPTool.server_name`, and the docblocks must not copy that doctrine.** That field names a contributor to a reading and is documented as never an actuation target. Here `name` *is* the server list, and a later slice legitimately carries one into `mcp_reconnect` / `mcp_toggle`, where the daemon gates it per device and the actuation seam is its only validator. The prohibitions written here are therefore the client-side ones. A `name` is never a lookup key, a React key, a `Map` index, a path, a filename, a cache key or a log field. `status` and `scope` are claims, not capabilities.

No ADR is needed. This follows the established per-frame decode pattern.

## Design

**`src/shared/wire/types.ts`**
- Add a `'mcp_status'` member to the inbound envelope type union, beside `'context_usage'`. Its SSOT comment reads: pyrycode#2373 (shape) / #2375 (live producer) / #2381 (on-demand reply) / `internal/protocol/codes.go` `TypeMCPStatus`. It is binary → phone only. `mcp_status_request` is out of scope and is not declared.
- `export interface MCPServerStatus { name: string; status: string; error: string; scope: string; version: string }`, in wire order. The docblock says:
  - all five keys are always present, and `''` is a value;
  - `status` and `scope` are open-set claims, never an enum, never authority;
  - `version` is opaque and never semver-parsed;
  - `error` carries a 256-byte producer cap, which is a size bound and not sanitisation;
  - the client-side prohibitions above apply;
  - the strings cross byte-for-byte, and escaping is owed at the render sink.
- `export interface MCPStatusPayload { conversation_id: string; servers: MCPServerStatus[]; dropped_servers: number }`. The docblock says:
  - `servers` is never `null`, and `[]` is a positive report;
  - `dropped_servers` is copied from the producer and never reconciled with the list length, and no client-side cap is applied;
  - `conversation_id` is daemon-authored and every row string is claude-authored;
  - nothing decoded reaches a log.

**`src/main/transport/inboundMessage.ts`**
- `parseMCPServerStatus(payload: unknown): MCPServerStatus`. It is an `isRecord` gate followed by five plain `requireString`s in wire order, and it returns a fresh five-key literal. Its throw message is the static `'malformed mcp server status'`.
- `parseMCPStatusPayload(payload: unknown): MCPStatusPayload`. It runs these steps:
  1. an `isRecord` gate;
  2. `requireString('conversation_id')`;
  3. `Array.isArray(payload.servers)` or throw `'malformed mcp status servers list'`;
  4. `.map(parseMCPServerStatus)`;
  5. `requireNumber('dropped_servers')`;
  6. return a fresh three-key literal.
- `InboundDaemonMessage` gains `| { kind: 'mcp-status'; mcpStatus: MCPStatusPayload }` with no `FrameTimestamp`, and its docblock gains one paragraph for the kind.
- `parseInboundMessage` gains `case 'mcp_status'`. It narrows first, then `diagnosticLog?.event({ event: 'inbound-decoded', code: 'mcp_status', bytes, hash })`, then returns the kind. This is the `context_usage` arm verbatim with a different literal.

Every throw is a `WireDecodeError` whose message names a category or a field, never a value. The field-name messages come from `requireString` / `requireNumber`, which already interpolate only the field name. This slice adds no new helper, no closed set, no emptiness check, no trim or escape, and no cap.

## State + concurrency model

None. The code is a pure synchronous function on a single plaintext buffer. No store, no async work and no teardown.

## Error handling

A malformed frame throws `WireDecodeError` out of `parseInboundMessage` before any log call. That is the existing contract, and the caller in `daemonConnection` already handles it. There is no partial result: one bad row throws the whole frame.

## Testing strategy

Everything is vitest in `inboundMessage.test.ts`, built through the real codec (`encodeEnvelope`). The fixtures are:
- `MCP_STATUS_FRAME`, the daemon's `mcp_status.json` payload transcribed whole;
- `MCP_STATUS`, its expected decode.

Scenarios:
- **AC1.** The fixture narrows to `{ kind: 'mcp-status', mcpStatus }`. The key set is exactly three at the top level and exactly five per row. Planted unknown keys (`turn_id` on the payload; `tools` and a JSON-parsed `__proto__` on a row) are dropped, and `Object.prototype` stays unpolluted. There is no `ts` on the arm, and the frame no longer returns null.
- **AC2, the positive empty report.** `servers: []` with `dropped_servers: 0` decodes as `[]` and `0`.
- **AC2, fail-closed on the frame.** These throw `WireDecodeError`: `servers` null, absent, a string, a number or an object; `dropped_servers` absent, null or a string; `conversation_id` absent, mistyped or null; a payload that is not an object.
- **AC2, fail-closed on a row.** One well-formed row plus one bad row throws. A bad row is a non-record, a null or an array, or has any of the five fields missing, a number, or null.
- **AC3, the fixture crosses verbatim.** The fixture's `remote<&>`, `dial refused\nretry?`, empty `error` and `2.0-beta` each decode verbatim, in wire order, with `dropped_servers: 3` beside two rows and no reconciliation.
- **AC3, what the fixture lacks.** An unrecognised `status` word (for example `needs-reauth-v9`), an empty `scope` and an empty `version` all decode unchanged.
- **AC4, error messages.** A malformed row throws a message that contains no row string, no `conversation_id` and no index.
- **AC4, the diagnostic log.** A well-formed frame writes exactly one `inbound-decoded` record whose key set is `bytes, code, event, hash, seq, ts` and whose `code` is `mcp_status`. No `name`, `status`, `error`, `scope`, `version` or `conversation_id` probe appears in the record, and no `inbound-unmodeled` record is written.
- **AC4, the throw path.** A malformed frame writes no record at all.
- **History lane.** `mcp_status` joins the "skips a stored %s" `it.each`, and a well-formed stored `mcp_status` is skipped too, which proves the dispatch has no arm for it.

No Playwright spec: nothing is interactive.

## Open questions

- Should the kind carry `inReplyTo`? The on-demand reply is correlated by `in_reply_to`. **Resolved: no.** The `context-usage` kind, whose reply is correlated the same way, does not carry it, and the AC names only the three payload fields. Whether correlation is needed is for the carry (#1490) to decide.

## Documentation handoff

Pending for the documentation stage (copied from the ticket):
- `docs/knowledge/features/inbound-message-decode-internals.md`: the per-type arm list gains `'mcp_status'`.
- `inbound-message-decode.md`, `-contract.md`, `-internals.md` and `-history-recent.md`: fold this decode into the family. The three passages that forbid joining a `context_usage` `server_name` "against `mcp_status`" now name a table that exists on this side. That sharpens those passages rather than retiring them.

## Size

This change touches 2 production files and 2 new exported types, and the ticket has 4 ACs. The estimate is about 110 production lines, about 400 test lines and this plan: about 650 lines of total written work.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The single boundary is `parseMCPStatusPayload` / `parseMCPServerStatus`, reached only from `parseInboundMessage`'s `mcp_status` arm after the `MAX_PLAINTEXT_BYTES` guard and `decodeEnvelope`. Downstream holds only the fresh typed literal. The docblocks on `MCPServerStatus` / `MCPStatusPayload` carry the untrusted-text signal to #1490, where the data first crosses `contextBridge`. The provenance split is documented: `conversation_id` is daemon-authored and the row strings are claude-authored.
- **[Prototype pollution / forged records]** No findings. Both parsers return fresh literals and read each field by name. A planted `__proto__` key is dropped, which a JSON-parsed row test pins. Nothing indexes an object by a decoded string.
- **[Tokens / secrets]** Not applicable. The frame carries no credential, and the daemon deliberately excludes config and serverInfo.
- **[File / storage]** Not applicable. Nothing is joined, written or opened. `name` and `scope` may look like paths or scopes, and the docblock forbids using them as a path, filename or cache key.
- **[Electron / IPC]** Out of scope, because there is no IPC in this slice. #1490 owns the `contextBridge` crossing and inherits the docblock prohibitions.
- **[Crypto]** Not applicable.
- **[Network & I/O / resource exhaustion]** No findings. The rows are bounded by `MAX_PLAINTEXT_BYTES` before `JSON.parse`, and `.map` allocates only from the array that actually arrived. Nothing is allocated from `dropped_servers`, which a large-count test pins, and no client cap is added, following the contract.
- **[Logs / errors]** No findings as designed, and this is the main risk. The log call uses a static `code` literal plus bytes and hash, and runs after narrowing. Throw messages name only a category or a field. A test pins the exact key set and the absence of every decoded value, including the newline-bearing `error`: the diagnostic stream is line-delimited JSON, so a logged value could forge a record. The row index is also kept out of messages.
- **[Concurrency]** Not applicable. The code is synchronous and pure.
- **[Threat model: hostile daemon response]** No findings. A malformed frame fails closed as a whole, while an open-set word or an empty string decodes. `status`, `scope` and `version` gain no authority on the client.
- **[Actuation]** Out of scope. Carrying a `name` into `mcp_reconnect` / `mcp_toggle` is a later slice, which the daemon gates per device.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
