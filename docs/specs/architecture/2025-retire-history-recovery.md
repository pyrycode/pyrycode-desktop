# Retire Desktop legacy history and replay recovery

## Files read

- `src/main/daemonConnection.ts` → `DaemonConnection`, `createDaemonConnection`, `onDriverEvent`, `loadDialConfig`: request correlation, live metadata and held-send pairing fences.
- `src/main/connectionRegistry.ts` → `viewOf`: delegated connection surface.
- `src/main/index.ts` → command dispatcher: conversation-routed legacy request.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`: untrusted renderer admission.
- `src/shared/ipc/events.ts` → `DaemonEvent`, `HistoryTimelineEvent`: exclusive reply IPC versus retained storage/translation declarations.
- `src/main/transport/requestHistoryEnvelope.ts` → `buildRequestHistory`: exclusive encoder.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `parseInboundPayload`, `decodeHistoryPage`: envelope admission, shared live parsers and exclusive page decoding.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,questionBridge,timelineBridge}.ts`: exhaustive no-op reply cases and shared fake translation.
- `src/main/{daemonConnection,threadUpdates,connectionRegistry}.test.ts`, `src/shared/ipc/commands.test.ts`, `src/main/transport/inboundMessage.test.ts`: active ownership/capability coverage and exclusive legacy fixtures.
- `e2e/thread-activation.spec.ts`: existing open/reconnect/paging/retry, missing-capability recovery and zero legacy-request proof.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/{daemon-connection,thread-runtime,development-verification}.md`: transport ownership, required thread route and counted test boundaries.
- `/work/Projects/pyrycode/docs/knowledge/decisions/042-daemon-built-thread.md` → Decision and Migration order: authoritative thread replaces app content replay/reconstruction.

## Context

Renderer legacy producers were removed by #2030. Main still retains unreachable raw-history requests, page decoding and event-ring cursors. Remove that exclusive machinery without changing presentation or the shared supported daemon protocol. Storage retirement belongs to #2026; daemon cleanup is separate work. No new ADR is needed.

## Design

- Delete `requestHistory` from Desktop command validation, dispatcher, connection contract/delegation and implementation; delete its encoder, request map, teardown, failure classification and page/failure IPC.
- Delete exclusive history-page decoding/types and fixtures in `inboundMessage`; keep live parsers, frame bounds, envelope validation, thread dispatch and daemon error handling.
- Remove only the obsolete no-op event cases from the four renderer bridges. Keep `HistoryTimelineEvent`/entries and shared fake translation used by supported storage and active tests. Shared wire declarations and generic hello codec support stay intact.
- Remove `replayCursor` tracking and `lastEventId` from production hello construction. Legacy `resync` and history pages are unmodeled frames and produce no renderer event or request.
- Rename `replayPairing` to `sendPairing`: its credential/host/relay/key snapshot still invalidates held composer sends when pairing changes or disappears. Keep asynchronous generation fences.
- Preserve `parseInboundMessage`'s admitted-envelope observer for live-session metadata and all thread receiver reset/checkpoint/fragment behavior.

Overlap: origin/feature/1544 touches configuration correlation in `daemonConnection.ts`; this cleanup edits separate blocks and preserves its configuration behavior.

Sizing, checked against sketch and final plan: one independently verifiable retirement deliverable; about 400 written lines including tests/plan, no new exported abstraction, at most 4 simultaneous request-contract consumers, 4 observable acceptance groups and no added error branches. Deletions dominate. No new dependency.

## State + concurrency model

No new tasks or state. Remove the pending-history map and replay cursor. Retain per-host thread receiver ownership, request completion/reset, driver generation guards, reconnect supervisor and held-send pairing fencing. No lifecycle is moved to the renderer.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Initial, automatic and explicit reconnect after admitted/malformed frames | `daemonConnection.test.ts`: cursor-free hellos and inert legacy frames |
| Legacy resync on one host while another remains connected | `daemonConnection.test.ts`: inert legacy frames/host isolation |
| Pairing replacement/disappearance or stale asynchronous load | Retained composer diagnostics and pairing fence tests; reconnect tests retain stale-load fencing |
| Same conversation/update IDs across hosts and incomplete fragment reconnect | `threadUpdates.test.ts`: isolates equal conversation/update ids; no hello replay fields |
| Missing thread then capable handshake, parked-driver reconnect/stop | Retained `daemon without thread is update-required` tests; `thread-activation.spec.ts` capability case |
| Opening, reconnect, older paging and retry | Existing `thread-activation.spec.ts` authoritative-query/zero-legacy assertions |

## Error handling

Formerly valid raw-history IPC is rejected by the existing unknown-command path. Unmodeled legacy inbound pages/resync return null after ordinary envelope admission. Do not weaken malformed-envelope handling, fatal pairing/app-version errors, typed thread failures, prompt/configuration correlation or send outcomes. No new failure mode or log data is introduced.

## Testing strategy

Write failing regressions for formerly valid `requestHistory` rejection and absent replay fields on reconnect first. Delete parked exclusive history tests/encoder tests and exclusive decode fixtures, retaining active cases in mixed files. Update thread fragment tests to assert cursor omission while preserving host and fragment assertions. Run focused units, then final-main merge, install, pre-verify and build on Linux. Run the complete configured fake Playwright suite because the ticket explicitly requires it, recording revision and executed/passed/failed/skipped counts. No live test changes; macOS is outside this ticket's verification scope.

## Open Questions

None. Shared declarations with surviving storage or fake consumers remain; only exclusive request/recovery machinery is retired.

## Security review

**Verdict:** PASS

- [Trust boundaries] `isRendererCommand` rejects the removed verb; `parseInboundMessage` retains size/UTF-8/envelope admission and live payload narrowing. Thread receivers retain correlation and per-host ownership. Legacy pages never cross IPC.
- [Tokens, secrets, credentials] `sendPairing` remains main-memory only and retains held-send invalidation; no token/key/Noise material is exposed or logged. Existing safeStorage ownership is unchanged.
- [File and storage operations] No filesystem/storage API changes; protected storage and surviving history declarations stay with their existing owners (#2026 retires saved formats).
- [Electron attack surface] IPC allowlist shrinks. No window/preload primitives, navigation or remote-content access are added; existing isolation settings remain.
- [Cryptographic primitives] No crypto/session/nonce changes; Noise driver still owns key/nonce lifecycle. Cursor omission changes application hello fields only.
- [Network and I/O] Existing frame bounds, authenticated admission and reconnect supervision remain; no new endpoint, timeout, TLS or socket policy.
- [Errors, logs, telemetry] Remove obsolete history/replay logs; retain content-free classified errors. No raw frame, prose, credential, cursor or identifier is added to logs.
- [Concurrency] Delete state rather than add tasks; preserve generation guards, held-send pairing checks, thread reset/fragment timers and host-local ownership across reconnects.
- [Threat model alignment] Malicious relay dropping/reordering remains handled by thread checkpoint/repair and Noise; malformed daemon data stays bounded/validated; compromised renderer loses a command; disk token protection remains safeStorage. No security deferral is introduced.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16
