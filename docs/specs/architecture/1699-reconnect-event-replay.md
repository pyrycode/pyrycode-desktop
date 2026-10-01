# Reconnect event replay (#1699)

## Files read

- `src/main/daemonConnection.ts` → `createDaemonConnection`, `loadDialConfig`, `onDriverEvent` — fresh hello construction and fenced live-event delivery.
- `src/main/connectionRegistry.ts` → `sameRecord`, `runReconcile` — a changed pairing retains its connection; removal stops and drops it.
- `src/main/pairedServerStore.ts` → `PairedServerStore` — immutable decoded four-field pairing snapshots loaded per dial.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — plaintext-size and envelope guards precede payload narrowing.
- `src/main/transport/codec.ts` → `decodeEnvelope`, `makeHelloClientPayload` — numeric envelope position and optional hello encoding.
- `src/main/transport/helloExchange.ts` → `ClientHelloInput`, `buildClientHello` — main-only handshake builder.
- `src/shared/wire/types.ts` → `HelloClientPayload`, `Envelope` — existing daemon contract needs its replay field represented.
- `src/main/transport/fakeDaemon.ts` → `handleReconnect`, `FakeDaemonOptions` — real Noise reconnect handshake and ordered frame streaming.
- `src/main/daemonConnection.test.ts` → `build`, `makeDriverFactory` — connection, provider and lifecycle proof seams.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `seedConversationsFrame` — fake relay, daemon and integrated Electron fixture.
- `docs/knowledge/features/daemon-connection-lifecycle.md` § Reload-per-dial — both automatic and explicit reconnect source fresh pairing data.
- `docs/knowledge/features/daemon-connection-registry.md` § Reconcile — pairing lifetime differs from connection lifetime.
- `docs/knowledge/features/hello-exchange.md`, `wire-codec.md` — constructor defaults and omit-absent encoding; timestamp reconnect descriptions require the documentation handoff below.
- `docs/knowledge/features/development-verification.md` — static rendering cannot prove reconnect negotiation; fake-tier interaction proof required.

Codegraph context returned “not initialized”; repository reads/searches supplied this map.

## Context and sizing

The held timeline survives disconnect, but desktop advertises no daemon replay position. Request the retained current-conversation tail through the existing `last_event_id` contract, then deliver it through the live-event path. A replay gap does not reload history.

One deliverable: negotiated reconnect replay. Estimated total written work: 550–650 lines including this plan, unit tests and one fake-tier spec. Six production files, no new exported declarations, no required consumer migration (optional additions), four acceptance criteria and no new reject state machine. The sixth file is the existing fake daemon's single-consumer negotiation seam; the sizing floor keeps that seam and its independently meaningful proof together as the refined ticket specifies.

In-flight overlaps: #1544 (`daemonConnection` correlation), #1657 (hello capabilities), #1694 (conversation summary decoding). They edit different logic; keep changes local and preserve their additions on merge.

## Design

Extend `HelloClientPayload`, `makeHelloClientPayload` and `ClientHelloInput` with optional numeric replay position (`last_event_id` on wire, `lastEventId` for builder inputs). Existing timestamp helper compatibility remains, but `loadDialConfig` never supplies `lastSeenTs`.

Add an optional third argument to `parseInboundMessage`: an envelope observer `(envelope: Envelope) => void`. Invoke it exactly once after plaintext-size and `decodeEnvelope` guards, before the payload switch. Treat `resync` as a null result regardless of payload shape. This retains existing delivery/drop semantics and permits recording unknown or malformed-payload frames without decoding twice.

`createDaemonConnection` owns a scalar cursor and a pairing snapshot in its closure, never in renderer state, persistence or log fields. Its observer clears the cursor on `resync` (ignoring that frame's own position), otherwise accepts only positive safe integers and keeps the maximum. Reset emits a static `replay-cursor-reset` diagnostic; no cursor, host id or payload enters it. Existing dial/connected and decode logs supply the other lifecycle anchors.

`loadDialConfig` compares all four stored pairing fields with its snapshot before building each hello. Equal snapshots preserve the cursor; null or changed records clear it. Snapshot the named fields rather than aliasing the caller's record. Registry removal destroys the connection, so re-pairing creates an empty cursor; a retained connection also resets on record replacement. Host separation follows one connection per host.

The fake daemon gains an optional `buildReconnectFrames(hello: Envelope): Uint8Array[]` proof seam, taking precedence over unconditional `reconnectResendFrames`. It reads the authenticated reconnect hello and selects frames before streaming them after the ack. Only the new e2e proof consumes this seam.

## State and concurrency model

Cursor writes are synchronous in the existing generation-fenced driver callback. Redials preserve it while the pairing is unchanged. `loadDialConfig` captures the generation, checks it and `stopped` after asynchronous store/key loading, and updates the pairing snapshot without an intervening await before hello construction; superseded loads cannot reset a successor's cursor. No new task, subscription or timer. Existing driver stop and generation fences own cancellation and late-frame suppression.

## Error handling

Size/envelope failures remain drops and cannot advance or reset the cursor. Payload failures still drop delivery, but their valid envelope position advances first. Invalid positions silently leave the scalar unchanged. `resync` is a control frame with no renderer event and no history request. Existing catches classify storage/key/dial errors without forwarding exceptions.

## Testing strategy

- Hello/codec unit assertions prove the numeric field and absent omission, with no timestamp in connection-produced hellos.
- Decoder tests prove observer ordering on unknown/malformed payloads, non-observation for failed guards, and payload-independent resync suppression.
- Connection tests cover valid/max/invalid positions, automatic-provider and explicit reconnect hello construction, no renderer or outbound changes from resync, post-reset recording, host isolation, each pairing field replacement, null/unpair/re-pair, stale driver and superseded async loads.
- Fake-tier spec seeds a visible turn prefix with a position, drops the relay client leg, then releases a missed turn tail only for the exact received position. Assert hello metadata (without exposing token), retained rows, once-only ordering, later live events and no reconnect `request_history`.
- RED then GREEN scoped unit tests; `npm run build`; approved focused Electron fake-tier spec. Full suites belong to the dispatcher/verifier.

## Open questions

None. The ticket pins retained replay and explicitly excludes history recovery on a gap.

## Documentation handoff

Pending for the documentation stage: correct reconnect-field descriptions in `docs/knowledge/features/hello-exchange.md` (interface/build/default descriptions) and `docs/knowledge/features/wire-codec.md` (constructor/default/optional-field descriptions). Describe cursor lifetime and resync in `docs/knowledge/features/daemon-connection-lifecycle.md` (Reload-per-dial and inbound event lifecycle). State that `last_event_id` requests bounded current-conversation replay, `last_seen_ts` has no daemon consumer, and resync clears the cursor without automatically loading history.

## Security review

**Verdict:** PASS

- Trust boundaries: `parseInboundMessage` observes only envelopes admitted by the existing size/structural guards; the connection independently validates positive safe-integer positions. Payload narrowing remains separate.
- Tokens/credentials: pairing comparison uses already loaded snapshots only as lifetime identity, not authentication. No new credential storage; existing `safeStorage` and keychain failure behavior stay in place. No values enter diagnostics.
- File/storage operations: cursor is a bounded scalar in main memory; no path construction, writes, cache or web storage is added.
- Electron attack surface: no IPC, renderer field, window, navigation or remote content surface is added. The callback and hello remain main-process only.
- Cryptography: reuse existing Noise IK sessions and fresh ciphers on reconnect; no new primitives, nonce resets or key lifecycle changes.
- Network/I/O: keep existing relay URL admission, TLS configuration, frame caps, timeout/backoff and driver teardown. Cursor handling cannot allocate proportionally to the ID.
- Logs/telemetry: only static reset event/classification is added; no position, pairing field, payload, raw hello or caught error is logged. Test assertions project only cursor/field presence from the authenticated hello.
- Concurrency: guard asynchronous dial loads with generation and stopped checks; stale driver events already fail the generation fence. No new asynchronous work.
- Threat model: content-blind relay cannot forge admitted Noise plaintext; hostile daemon positions are bounded numerically and only influence its own replay request. Renderer compromise gains no cursor/transport capability. Existing disk credential and transport security remain owned by their existing implementations.

**Reviewer:** builder self-review per `builder/security-review.md`  
**Date:** 2026-10-01

## Revisions

2026-10-01 — PR #1712 verifier MUST FIX: `loadDialConfig` returns null when permanent teardown races a pending pairing load or key ensure, but `bootstrap` interpreted that cancellation as an absent pairing. Check `stopped` alongside the generation fence before the null-result branch. Cancelled successful loads must construct no driver and emit no post-stop renderer event or diagnostic. Extend the existing bootstrap race test with explicitly pending load/ensure cases and assertions on both output channels. Replay negotiation and pairing lifetime are unchanged; the rework touches one production file and adds about 30 written lines, within the existing sizing-floor exception.

In-flight overlaps rechecked: #1544 changes config correlation and #1657 changes advertised capabilities in `daemonConnection`; neither changes `bootstrap` or its teardown test. No dependency blocks this local guard.

2026-10-01 — PR #1712 verifier gate MUST FIX: `e2e/attachment-image-thumbnail.spec.ts` → `pushCompleted` failed with an ambiguous Electron inspection-context loss on the second upload. Use the existing `e2e/fixtures/confirmedPush.ts` → `pushConfirmingDelivery` contract: watch for the absolute expected pending-tile count before retrying, rather than blindly repeating a completion that may already have arrived. Inject the same static failure after the document completion is sent; assert exactly two pending tiles and one document in the resulting bubble. Existing helper unit tests cover delayed delivery, undelivered retries and fatal errors. The replay implementation and security review are unchanged; this rework changes no production code, introduces no types/state/failure branches, and adds under 50 written lines. The branch remains below 800 written lines with its existing six-file sizing-floor exception. No in-flight branch touches the thumbnail spec or helper.

Additional documentation handoff (pending): per the verifier's NIT, update `src/renderer/src/store/historyPageBridge.ts` → `withoutLiveEntries`'s orphaned-result explanation to describe an expired or unavailable replay tail instead of claiming desktop advertises no `last_event_id`. This is explanatory text only; runtime behavior stays unchanged.

2026-10-01 — PR #1712 verifier gate MUST FIX: `startFakeDaemonForTest` rejected an initial WebSocket upgrade with `ECONNRESET`, before Electron launched. Recover once from that exact pre-open socket code; all other failures retain immediate, content-free classification, and a second reset fails. No client handshake, command or event has been sent at this point, so creating a fresh fake cannot duplicate delivery. `startFakeDaemon` must free its failed attempt's Noise state and terminate the leg before rejection. A real loopback HTTP upgrade test destroys the first socket and accepts the second, asserting two attempts, a usable handle and cleanup of both handshake states. Stubbed tests cover exhaustion and non-retryable failures. Run that unit file, the fake-daemon unit file, build, the reported channel-session-facts spec and the replay spec. The original host-side cause remains undiagnosed; this is bounded recovery of the observed setup failure, not a claim to reproduce its cause.

Files read for this revision: `e2e/fixtures/fakeDaemonSetup.ts` → `classifySetupFailure`, `startFakeDaemonForTest`; its unit tests → local HTTP upgrade probes; `src/main/transport/fakeDaemon.ts` → `startFakeDaemon`, `close`, `freeAll`; `e2e/fixtures/launchPairedApp.ts` → `startFakeServer`; `src/main/transport/fakeDaemon.test.ts` → existing pre-open reset recovery; `docs/knowledge/features/e2e-harness.md` → Pre-Electron fake-daemon setup failures. No in-flight feature branch overlaps these changes. Rework adds about 100 lines across the existing fake source, two e2e fixture files and this plan; total branch work remains below 800 lines with the existing six-file floor exception.

Security review of this revision: PASS. The retry reads only an exact static socket code at the pre-open boundary; original errors remain excluded from diagnostics. Each failed attempt frees its WASM state and terminates its socket, and only one successor is allowed. No new credentials, persistence, IPC, production network behavior, crypto primitive, renderer surface or async job is introduced. Other trust boundaries and threat-model findings above are unchanged.

Additional documentation handoff (pending): update `docs/knowledge/features/e2e-harness.md` § Pre-Electron fake-daemon setup failures to describe the one permitted pre-open `ECONNRESET` retry, cleanup before retry, and unchanged immediate failure for other classes. Its statement that setup never retries is superseded by this rework.
