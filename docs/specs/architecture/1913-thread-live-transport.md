# Complete live thread transport

## Files read
- `src/shared/wire/types.ts` → `Envelope`: existing optional correlation and plaintext cap.
- `src/main/transport/codec.ts` → `decodeEnvelope`: strict UTF-8 envelope decoding.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`: replay observation precedes payload decoding.
- `src/main/daemonConnection.ts` → `onDriverEvent`, `dial`, `stop`: driver generation fence and automatic reconnect seams.
- `src/shared/ipc/events.ts` → `DaemonEvent`; `src/main/emitDaemonEvent.ts` → `bindServerOrigin`: typed host stamping.
- `src/preload/index.ts` → `onDaemonEvent`: forwards typed events and returns listener cleanup.
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts`: exhaustive legacy consumers.
- `docs/knowledge/features/{daemon-connection,inbound-message-decode-interface,inbound-message-decode-limits,development-verification}.md`: preserve replay admission, frame bounds and static-test limits.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md`: transport remains main-only.
- Daemon `docs/protocol-mobile.md` → Daemon thread updates / Bounded thread encoding and assembly; ADR 042: supplied delivery contract, no capability activation.

## Context
Deliver the daemon-built live representation for #1901 and reusable assembly for #1912. This is one independently verifiable transport deliverable; no renderer item store, recovery requests, capability activation, UI or documentation changes. #1544 overlaps `daemonConnection.ts` only in separate run-settings logic; edits remain local.

## Design
- Add `ThreadItem` and a discriminated `ThreadUpdate` wire union retaining full item JSON and patch JSON as inert data. Validate required/optional full-item fields, safe nonnegative history numbers and patch immutable-key rejection without interpreting content or inferring attribution/activity.
- `parseInboundMessage` recognizes all three types after existing envelope replay observation and before ordinary payload narrowing; it supplies a main-only thread frame to the connection-owned receiver.
- `createThreadUpdateReceiver` owns ordinary validation and bounded continuation assembly. Its receive/reset interface emits complete typed updates or static repair reasons; no raw bytes/fragments cross IPC.
- Added IPC arms `threadUpdate` and `threadRepairNeeded` use existing host stamping/preload subscription. Updates retain logical wire payloads and the completing envelope's supplied id, timestamp and optional reply/replay/history/session correlation. Correlation never substitutes for logical version/revision.
- Legacy exhaustive bridges explicitly ignore both arms; all other consumers keep existing default-ignore behavior. No new dependency. A single receiver is cleaner than a second parser/store holding item revisions.
- Size recount: approximately 350 production + 345 tests/helpers + 65 plan lines = 760; four exported types at most, fewer than ten consumer edits, four acceptance behaviours, nine classified assembly/lifecycle outcomes. The #199 analogue's 754 insertions agrees with this sketch.

## State + concurrency model
Each connection owns a synchronous receiver with a Map keyed by conversation and update digest. No awaits or item store. Buffer decoded UTF-8 bytes only; at most 8 MiB per logical update, 16 MiB buffered bytes and eight incomplete updates per connection. An accepted part rearms a 30-second idle timer. Reject only the affected assembly and release its timer/bytes before emitting repair. Unknown/prototype-like JSON keys are never merged into application objects.

## State transitions and identity reuse
| Event | Test in `src/main/transport/threadUpdates.test.ts` or `src/main/threadUpdates.test.ts` |
|---|---|
| Ordinary/repeated delivery; same ids in separate conversations/connections | ordinary and interleaved delivery |
| Consecutive parts / missing, repeated, reordered or malformed part | complete assembly; rejected sequence |
| Metadata including base_rev presence, digest or reconstructed routing disagrees | metadata and digest rejection |
| Exact size/count boundaries and overflow | receiver resource boundaries |
| Accepted next part resets expiry; missing final expires | idle expiry |
| Relay drop / automatic handshake / terminal / error / explicit reconnect / stop | connection teardown and successor isolation |
| Replay event id arrives on incomplete/rejected part | replay cursor admission |
Teardown resets all timers/buffers, including handshake-complete on the same driver. Existing generation fences reject replaced-driver events. Successful assembly emits once per sequence; replayed logical application/base_rev and stable-kind/message-only rules remain #1901.

## Error handling
Nine static outcomes: malformed shape/UTF-8, sequence, metadata, resource limit, final length, digest, reconstructed DTO/routing, expiry, reset. Identifiable invalid input and expiry emit conversation-scoped repair through the host-bound sink; no invented conversation for unidentifiable input. Reset releases silently. Diagnostics contain static event/codes only, never daemon text, routing ids, fragments, keys or caught errors. The existing 65519-byte plaintext cap stays in force.

## Testing strategy
Test first with supplied serialized envelopes: all three ordinary/oversized types, unknown nested/prototype keys, full-item optional validation, replacement presence and empty append. Exercise exact UTF-8 byte offsets, metadata/digest checks, bounds and fake-timer expiry/reset. Connection tests feed encoded frames through the actual parser, shared IPC stamping and existing mocked Electron preload subscription; assert legacy bridge no-ops and unchanged hello capabilities. Run focused units, final-main pre-verify (full unit suite) and build. No user interaction or live-Claude proof is required; production activation/live proof remain #1908.

## Open Questions
None. The completing frame supplies event correlation; no correlation is synthesized from fragment progress.

## Security review
**Verdict:** PASS
- [Trust boundaries] Main-only receiver validates required shapes, own-property presence, safe integers, UTF-8 and reconstructed routing before typed IPC; inert JSON is retained without object merges.
- [Tokens] No new credentials or storage; existing safeStorage/Noise ownership is unchanged, no token reaches the receiver API.
- [File/storage operations] No filesystem paths, persistence or browser storage are added; buffers are memory-only and bounded.
- [Electron attack surface] Existing isolated bridge carries typed data only; no new renderer commands, raw bytes, navigation or privileged APIs.
- [Cryptography] Node SHA-256 over exact type + NUL + original bytes verifies assembly identity; Noise authentication/key/nonce behavior is unchanged.
- [Network/I/O] Existing frame cap is retained; receiver byte/count/idle limits bound a hostile or stalled peer independently of claimed totals.
- [Errors/logs] Static reasons and content-free diagnostics only; no JSON payload, attribution, routing strings, digest input or caught error is logged.
- [Concurrency] Synchronous single writer, reset on every connection boundary, cleared timers and generation-fenced drivers prevent stale completion; expiry releases only its own assembly.
- [Threat alignment] Relay delay/reorder/flood and hostile daemon JSON are bounded/rejected; renderer receives inert complete DTOs. Existing disk-token and renderer isolation protections remain unchanged. Item applicability is explicitly owned by #1901, capability activation by #1908.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-10
