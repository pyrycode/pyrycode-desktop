# Transport summary and session-state metadata

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries, supplied-frame proof and renderer test limits.
- `docs/knowledge/features/daemon-connection.md`, `daemon-event-channel.md`, `daemon-event-channel-plumbing.md`: main validates, bound sinks stamp hosts, preload forwards typed events unchanged.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md`: transport stays in main.
- Daemon `docs/protocol-mobile.md`, conversations and Session-scoped live state sections; `docs/knowledge/decisions/042-daemon-built-thread.md`: supplied metadata contract and live-state/content separation.
- `src/shared/wire/types.ts`: `Envelope`, `ConversationSummary`; optional fields preserve legacy constructors.
- `src/main/transport/codec.ts`: `decodeEnvelope`, structural wire boundary.
- `src/main/transport/inboundMessage.ts`: `parseInboundMessage`, `parseConversationSummary`, family payload parsers and existing correlations.
- `src/main/daemonConnection.ts`: `createDaemonConnection`, per-frame sink and pending-reply handling.
- `src/shared/ipc/events.ts`, `src/main/emitDaemonEvent.ts`, `src/preload/index.ts`: `DaemonEvent`, `StampedDaemonEvent`, `bindServerOrigin`, `onDaemonEvent`.
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts`: exhaustive translators' additive-event no-op pattern.
- `src/main/threadUpdates.test.ts`: supplied encoded frames, real preload callback and structured-cloned IPC test seam.

## Context

Provide the typed inputs #1907 needs for current-session filtering and unread decisions without activating thread capability or implementing those decisions. Summary binding and shown watermark retain their independent semantics. No UI, new dependency or documentation deliverable. No new ADR needed.

Sizing: one transport deliverable, four observable acceptance criteria; approximately 180 production + 330 test/helper + 75 plan lines, one new exported family type, six consumer updates, no new state machine. Overlap: #1544 adds config-request invalidation in different connection blocks; our sink and clear arm remain local/additive.

## Design

- Extend `Envelope.session_id` to optional string/null and add optional boolean `session_state_cleared`; `decodeEnvelope` rejects present empty/mistyped session tags and non-boolean flags. Omitted properties remain absent.
- Add optional `current_session_id` and `last_shown_version` to `ConversationSummary`; admit any string binding including empty, and only nonnegative safe-integer watermarks. Preserve read/legacy fields and omission.
- Define the canonical `SessionStateFamily` union for the ticket's supported live-state types. A main-only allowlist maps dismissed modal/question and settings-updated aliases to their canonical families.
- `parseInboundMessage` decodes once, recognizes true clears before ordinary payload parsing, and requires a supported type plus an empty non-array object. Return a distinct `session-state-cleared` kind with family and named envelope correlation metadata. False/absent flags use existing parsers unchanged.
- Ordinary listed-family outputs gain optional `envelopeSessionId` and `inReplyTo`, copied only when actually supplied; existing payload session IDs stay separate. Keep the exported parser signature unchanged and factor ordinary dispatch into a private helper.
- Extend the optional shared event metadata with those same fields. The connection's existing per-frame sink forwards them to every resulting event, including correlated replies. The clear arm emits `sessionStateCleared` with canonical family, correlation and supplied session metadata before any pending-reply branch. No inferred conversation identity.
- The four exhaustive legacy translators return null for this additive event. Existing non-exhaustive listeners naturally ignore it. Preload API and host stamping need no implementation change.

## State + concurrency model

No new store, timer, subscription, queue or async job. Validation and forwarding remain synchronous in frame arrival order. Existing connection-generation fences and preload unsubscribe ownership remain intact. Clear frames do not enter prompt/request settlement, thread receiver or replay-position advancement.

## State transitions and identity reuse

| Event | Supplied-frame test in `src/main/sessionStateMetadata.test.ts` |
| --- | --- |
| Clear then fresh, repeated clear/fresh | ordered preload delivery and legacy translator no-op |
| Same conversation/session IDs on two hosts | host stamp isolation through preload |
| Correlated clear then ordinary reply | clear leaves pending settings request intact; fresh settles normally |
| Repeated subscription/unsubscribe | only attached preload listener receives subsequent frames |
| Differing envelope/payload session IDs | independent values survive settings and suggestion delivery |

No session lifecycle state is added; reconnect filtering, stale suppression and unread/read publication remain #1907.

## Error handling

Malformed tags/flags, summary metadata and clears throw static-category `WireDecodeError` at main's existing fail-closed boundary. Connection drops rejected frames without publishing partial events. New admitted/invalid-clear diagnostics use fixed event/code values only; no payloads, identifiers, tokens or decrypted bytes enter logs.

## Testing strategy

Write supplied encoded-frame tests first and observe failures before implementation. Table-drive all 23 listed types with omitted/null/string tags and supplied correlation through decode, parsing, connection, structured-cloned IPC and actual existing preload subscription. Assert own-property absence. Cover zero/empty/omitted/invalid summary metadata, independent payload sessions, every canonical mapping, malformed flags/payloads/unsupported clears, ordering, host isolation and untouched legacy translators/capabilities. Preserve ordinary correlated settlement. Run focused units, final main merge, pre-verify and build. No interaction or real-Claude test is needed.

## Open Questions

Resolved: use `envelopeSessionId` alongside existing payload `sessionId`, with `inReplyTo` for supplied correlation; clear `correlation` reuses the existing thread event's `Omit<Envelope, 'payload' | 'type'>` shape. No wire conversation-ID field will be added or inferred.

## Security review

**Verdict:** PASS

- [Trust boundaries] `decodeEnvelope` validates tag/flag shape; `parseInboundMessage` validates family, empty clear payload and summary safe integers before typed IPC. Named copies exclude daemon extras.
- [Tokens] No credential generation/storage/access added. Session IDs are provenance reports and never authorization inputs or logs; existing safeStorage remains unchanged.
- [File/storage] No storage or filesystem operations introduced. No daemon field becomes a path or persisted cache key.
- [Electron] Receive-only typed metadata uses existing `onDaemonEvent`; raw bytes and IPC event objects remain main/preload-side. No new command or window/navigation surface.
- [Crypto] Existing Noise_IK_25519_ChaChaPoly_BLAKE2s implementation and key/nonce lifecycle unchanged; no cryptographic operation added.
- [Network/I/O] Existing plaintext size guard and relay frame limits remain; clear recognition runs after size/UTF-8/JSON admission and before family payload validation. No dialing/deadline changes.
- [Errors/logs] Static errors and diagnostics only; no daemon IDs, text, secrets or raw bytes. Connection retains fail-closed drop behavior.
- [Concurrency] Synchronous per-frame copies; no global metadata cache, await gap or new task. Clear bypasses pending settlement and thread assembly; host provenance is bound per connection.
- [Threat alignment] Malformed hostile daemon frames fail closed; compromised relay remains Noise-protected with existing bounded frames. Compromised renderer gains no key/socket capability. Disk token theft remains covered by existing safeStorage. Stale/reordered readings and retained-state interpretation are intentionally owned by #1907; activation remains #1908.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-10
