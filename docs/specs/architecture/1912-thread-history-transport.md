# Thread history transport (#1912)

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: transport ownership and supplied-frame/preload proof.
- `docs/knowledge/features/daemon-connection.md`, `docs/knowledge/features/wire-codec.md`: bound origin, request correlation and per-handshake teardown.
- Daemon `docs/protocol-mobile.md` — Full thread item, Bounded thread encoding and assembly, Thread query messages; ADR 042: authoritative coverage and inert complete items.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: additive history vocabulary.
- `src/main/transport/threadUpdates.ts` → `logical`, `part`, `matches`, `createThreadUpdateReceiver`: reuse validation and one connection-wide assembly budget.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`; `src/main/transport/codec.ts` → envelope frame boundary.
- `src/main/daemonConnection.ts` → `createDaemonConnection`, `onDriverEvent`, `dial`: bound sink, authenticated sends, error correlation and teardown.
- `src/main/connectionRegistry.ts` → `viewOf`; `src/main/index.ts` → command dispatch: explicit host routing.
- `src/shared/ipc/commands.ts` → `isRendererCommand`; `src/shared/ipc/events.ts` → `DaemonEvent`: untrusted IPC admission and typed output.
- `src/preload/index.ts` → `sendCommand`, `onDaemonEvent`; `src/main/sessionStateMetadata.test.ts` and `src/main/threadUpdates.test.ts`: actual preload subscription with structured-cloned supplied frames.
- `src/main/transport/threadUpdates.test.ts`: resource/sequence regression fixtures.
- Renderer `daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`: additive-event ignore seams.

## Context
History queries must report explicit completion, never infer it from a batch or fragment. #1902 owns checkpoint coordination; #1908 owns production activation. No capability, cache or UI change. No ADR needed. In-flight #1544 touches separate configuration logic in `daemonConnection.ts`; edits remain local.

## Design
Add a discriminated `ThreadQuery` contract for catch-up/page requests and a `ThreadReply` for nonfinal batches, final coverage markers and reset. Commands name the host and client request ID explicitly. Main validates safe nonnegative integers, preserving omitted/zero/positive limits, then rebuilds named wire fields using the existing envelope codec.
The connection registers its unique envelope ID before sending, maps it to the caller request ID and passes dropped-send observations to a static correlated failure. The receiver owns this lightweight query map alongside its existing assembly map; it retains captured epoch/version but no completed item batches. Typed replies carry the original envelope correlation and caller request ID via the connection-bound host sink. Existing correlated errors terminate a query with static failure copy.
`logical` reuses `fullItem`; batches require explicit false and no coverage. Success requires empty items and one exclusive coverage shape; nonzero catch-up matches the requested checkpoint, while newest/page preserves all four authoritative range fields, numeric continuation equal to lower order, and explicit zero/false. Validate ordered bounds without deriving them from active items or parent extras. Reset has routing only and no certification.
Object continuation alone selects assembly. Reuse all existing byte/count/expiry limits. History assembly requires exactly one reconstructed item with matching repeated identity/revision, routing, request and session metadata. Incomplete or failed assembly invalidates its query; a later marker cannot rescue it. Legacy subscribers ignore both additive reply and failure events.

## State + concurrency model
One synchronous main-process writer per connection; query registration precedes send and callbacks compare the exact pending identity. No new async loops or retry coordinator. Existing receiver timers expire incomplete assembly. Query termination releases its associated buffers/timers; relay drop, every handshake, terminal/error, reconnect and stop settle all queries and reset assembly. History envelope IDs must not be reused across reconnects, so late frames cannot target a successor request.

## State transitions and identity reuse
| Event | Test in `src/main/threadQueries.test.ts` |
| --- | --- |
| Empty and repeated final marker | empty and multibatch completion |
| Multiple batches/captured epoch-version | rejects coverage and captured metadata changes |
| Missing/malformed/expired fragment then marker | invalid assembly cannot certify success |
| Request/session/routing identity changed mid-assembly | fragment metadata and request isolation |
| Interleaved hosts/requests, equal conversation IDs | host isolation through preload |
| Correlated reset/error/local send drop | terminal and send failure settle once |
| Relay drop/re-handshake/terminal/error/reconnect/stop | lifecycle fences late replies and releases timers |

## Error handling
Static correlated failure reasons only: invalid reply/assembly, daemon rejection, send failure, unavailable or interrupted. Reset and error never certify partial progress. Unknown/unmatched frames are ignored. No item content, daemon error text, IDs or epochs enter logs; diagnostics contain event names and static reasons.

## Testing strategy
Test first with supplied encoded frames through parser, fake authenticated driver, structured-cloned IPC and the real preload subscription. Cover numeric IPC admission and exact outbound payloads, both coverage modes, empty/multibatch replies, oversized UTF-8 full items, malformed metadata/coverage, interleaving and lifecycle teardown. Keep existing live-update/resource limits green and test pure legacy translators separately to respect TypeScript project boundaries. No interaction or live spec required; production activation remains #1908. Run pre-verify and build after final main merge.

## Open Questions
None. Size sketch and plan re-count: approximately 780 written lines (280 production, 420 tests/helpers, 80 plan), three new exported types, fewer than ten consumers needing simultaneous edits, four observable acceptance criteria. Reuse existing assembly reject paths rather than duplicate a state machine.

## Security review
**Verdict:** PASS
- [Trust boundaries] `isRendererCommand` validates host/request strings and safe integers; `logical`/`part` validate network DTOs; query admission checks locally registered correlation before publication.
- [Tokens] No new secrets; existing main-only safeStorage/Noise ownership remains unchanged. Request IDs are correlation, not credentials.
- [File/storage] No runtime filesystem/cache writes or paths derived from responses; #1901/#1902 own persistence/checkpoints.
- [Electron] Existing isolated preload exposes typed commands/events only; unknown JSON remains inert, no Node/socket/byte exposure or new navigation surface.
- [Cryptography] Existing Noise variant unchanged; existing SHA-256 assembly digest remains integrity metadata, not authentication.
- [Network/I/O] Inherit 65519-byte plaintext cap, 8 MiB payload, 16 MiB buffered bytes, eight incomplete assemblies and 30-second idle expiry in one receiver; no second budget.
- [Errors/logs] Only static failure classifications logged/emitted; never daemon error prose, payloads, keys or tokens.
- [Concurrency] Register before send; settle exactly once and release query assemblies on every lifecycle boundary. Avoid reused history correlation IDs across sessions.
- [Threat model] Relay reorder/drop/flood fails bounded assembly and cannot certify a failed query. Hostile daemon DTOs fail validation. Compromised renderer is constrained by IPC admission/main-only transport. Existing disk-token protection unchanged.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-12
