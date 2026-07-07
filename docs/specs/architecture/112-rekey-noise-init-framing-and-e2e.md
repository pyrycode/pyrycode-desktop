# #112 — Frame the rekey `noise_init` on the wire + prove an end-to-end rekey round-trip against a rekey-initiating fake daemon

**Ticket:** [#112](https://github.com/pyrycode/pyrycode-desktop/issues/112) · **Size:** S · **Security-sensitive:** yes (internet-exposed relay framing path) · **Blocked by:** #111 (merged, PR #113)

This is the wire-and-proof half of the rekey mechanism. #111 landed the session-layer crypto (recognize `rekey_request` → fresh in-session IK handshake as INITIATOR → atomic cipher swap), unit-tested at the session boundary. But #111 explicitly left two things undone: (1) the driver still frames the fresh handshake `msg1` as `noise_msg`, which the real daemon would mis-route and close at WS 4421; (2) there is no end-to-end proof against a rekey-initiating peer. This ticket closes both.

## Files to read first

- `src/main/transport/noiseRelayDriver.ts:176-205` — the two seams this ticket edits. `let firstFrame` (`:178`), the `sendFrame` closure's `firstFrame ? 'noise_init' : 'noise_msg'` decision (`:183-192`), and `route`'s drop of `rekey-requested` (`:197-205`). This is Part 1 in ~5 lines.
- `src/main/transport/noiseSession.ts:207-262` — the `onFrame` transport branch: on a recognized `rekey_request` it emits `{type:'rekey-requested'}` **then synchronously** calls `beginRekey()` (`:223-226`), whose first `sendFrame` is the fresh handshake `msg1` (`:179-205`). This synchronous emit-then-send ordering is the whole basis of the driver's coordination — read it before Part 1.
- `src/main/transport/fakeDaemon.ts` (whole file, ~278 lines) — the responder you extend. Note `DaemonState` (`:92`), `sendNoise` framing all outbound as `noise_msg` with its faithfulness rationale (`:161-167`), `handleMsg1`'s handshake+Split+swap pattern (`:169-191`), `handleTransport` (`:193-206`), the `onMessage` state dispatch (`:211-223`), and the module note on the no-swap `Split` role mapping (`:14-21`). Part 2 mirrors `handleMsg1`'s shape for a fresh handshake.
- `src/main/transport/noiseSession.test.ts:57-149` — the reference implementation for Part 2. `createNoiseResponder`'s `initiateRekey(bytes)` + `awaiting-rekey-init` substate seals a `rekey_request` under the current key, then answers the client's fresh `msg1` as a fresh RESPONDER handshake and atomically swaps its own ciphers. `fakeDaemon.ts`'s `initiateRekey` is the WS-transport twin of this in-memory one — same crypto shape, framed through the codec.
- `src/main/daemonConnection.roundtrip.test.ts:147-273` — the e2e harness (#89): `standUpRoundTrip(buildReply)` stands up forwarder + fakeDaemon + the assembled `createDaemonConnection`, drives to `connected`, and asserts `messageReceived` with a `.message` payload. The new rekey e2e test is a third `it(...)` in the fake-target `describe`, reusing `standUpRoundTrip`.
- `src/main/transport/fakeDaemon.test.ts:155-239` — the self-verifying round-trip oracle (`standUp` + `driveClient`) that pins the fakeDaemon's crypto against the REAL client initiator. The fakeDaemon rekey unit test extends this describe: after the initial round-trip, call `daemon.initiateRekey()` and assert the driven real client resumes under new keys.
- `src/main/transport/noiseRelayDriver.test.ts:44-70, 220-268` — `makeFakeSession` (captures `config.sendFrame`/`config.onEvent`) + the happy-path test that already asserts `noise_init`/`noise_msg` tagging via `decodeSent(...).type`. The Part 1 unit test drives the same captured `config` through the emit-then-send rekey sequence.
- `docs/knowledge/codebase/111.md` — the blocker's shipped behavior: the emit-then-`beginRekey` seam (`:50`), the empty-early-data contract, the "failure returns to `transport`, not `closed`" invariant, and the nonce-lockstep testing rule (§ Lessons). Authoritative for what the session already does; this ticket adds no session change.
- `src/shared/wire/types.ts` — `NOISE_PROTOCOL`, `MessagePayload` (`{conversation_id, message_id, role, text}`), `SendMessagePayload`, `HelloAckPayload`, `MAX_FRAME_BYTES`, `EnvelopeType`. Confirm `Envelope.type` is `EnvelopeType | string` (so `'rekey_request'` typechecks without a union change).

## Context

In v2 the **daemon is the rekey initiator**. On its per-session timer it AEAD-seals a `{type:"rekey_request"}` control envelope inside a transport frame, opens a ~30 s window, and expects the client — as the responder to the rekey — to run a fresh in-session IK handshake **as the handshake INITIATOR** (a new `noise_init` on the wire). Both sides then atomically swap cipher states and resume; there is **no `rekey_ack`** — the implicit ack is the next successful AEAD round-trip under the new keys. Miss the window → the daemon closes at WS 4426.

#111 built the client's session-layer action: recognize the trigger, run the fresh handshake, swap. But the session is deliberately transport-agnostic — it only hands raw `msg1` bytes to its `sendFrame` sink. Two gaps remain, both owned here:

1. **Wire framing.** The daemon routes the rekey handshake by the `InnerFrameV2.type` (pyrycode #453): an open-state `noise_init` → `handleRekeyInit`; an open-state `noise_msg` → transport-decrypt, where the raw IK handshake bytes fail AEAD → WS 4421 close. The driver (`noiseRelayDriver.ts`) frames only a connection's **first** outbound frame as `noise_init` (a per-connection `firstFrame` flag); the rekey `msg1` — not the connection's first frame — is currently framed `noise_msg` and would be mis-routed. **Part 1** re-arms the framing so the rekey `msg1` goes out as `noise_init`.

2. **End-to-end proof.** The test-only `fakeDaemon.ts` is a pure IK responder (one handshake, one round-trip). To exercise a real driven client session against a faithful rekey, it must gain a rekey-**initiator** capability. **Part 2** teaches it to seal a `rekey_request`, answer the client's fresh `noise_init` as a fresh RESPONDER handshake, and swap its own ciphers. **Part 3** wires the e2e round-trip.

Off the first-milestone critical path (milestone sessions last seconds, never an hour); built now because long-lived desktop sessions are on the roadmap. Everything lives under `src/main/transport/` — keys, sockets, and the handshake never reach the renderer. `fakeDaemon.ts` is test-only and must never enter the production graph.

**No `## Design source` section:** this ticket is transport + test-harness only; it renders no UI. There is no Figma anchor and none is needed (the visual-fidelity check is not applicable).

## Design

### Part 1 — Driver: re-arm `noise_init` for the rekey `msg1` (`noiseRelayDriver.ts`)

The coordination is entirely inside the per-connection closure in `onConnected`, driven by the session's existing synchronous emit-then-send ordering. When the session recognizes a `rekey_request` it calls, **in this order and within a single `onFrame` turn**:

1. `config.onEvent({type:'rekey-requested'})` → the driver's `route(...)`
2. `beginRekey()` → `config.sendFrame(msg1)` → the driver's `sendFrame(...)`

So `route` sees the trigger immediately before the `msg1` reaches `sendFrame`. The fix: `route` arms a one-shot latch; `sendFrame` consumes it to tag that one frame `noise_init`.

**Contract:**

- Add one per-connection latch beside `firstFrame` (`:178`): `let rekeyInitPending = false`. It means "the next outbound frame is a Noise handshake init — tag it `noise_init`." (Keep `firstFrame` as-is; do NOT overload its documented "connection's first frame" meaning. A dedicated latch keeps both signals self-documenting.)
- In `sendFrame` (`:183-192`), the type decision becomes `firstFrame || rekeyInitPending ? 'noise_init' : 'noise_msg'`, and BOTH flags are cleared after: `firstFrame = false; rekeyInitPending = false`. (Behavior for the initial handshake is unchanged — `firstFrame` still drives the connection's first frame.)
- In `route` (`:197-205`), the `rekey-requested` branch **still does not emit** (the `RelaySessionEvent` sink has no such member; #111 keeps it a pure in-main signal) but now arms the latch before returning: `if (event.type === 'rekey-requested') { rekeyInitPending = true; return }`.
- Update the `:176-178` comment: the init-framing latch now arms for a connection's first frame **and** a rekey `msg1`.

The generation guard already at the top of both `route` and `sendFrame` (`if (gen !== generation) return`) is untouched — both closures capture the same connection's `gen`, so the arm and the consume are always in the same generation.

**Why a latch and not a session→driver frame-type signal:** #111 fixed the session's `sendFrame` contract as `(frame: Uint8Array) => void` and made the session transport-agnostic. Threading a frame-type through `sendFrame` would ripple into the session, the interop test's `driveClient`, and `fakeDaemon`. The latch keeps the change driver-local, matching the shape #111's codebase note blesses ("wiring the fresh `msg1` onto the wire is #112").

**Observable sink behavior is unchanged:** `rekey-requested` is still dropped from the `RelaySessionEvent` sink; the only addition is a side-effect (arm the latch) before the existing `return`. Existing driver tests that assert the trigger is not propagated stay green.

### Part 2 — Fake daemon: rekey-initiator capability (`fakeDaemon.ts`, test-only)

Mirror `noiseSession.test.ts`'s `createNoiseResponder.initiateRekey` (`:142-149`) + `awaiting-rekey-init` handling (`:92-119`), framed through the codec over the WS leg. The crypto must be faithful (a lax fake can pass while diverging from the real daemon); the **outbound `type` tag stays `noise_msg`** for every frame — the client reads by session state and never branches on the inbound tag, and `sendNoise`'s uniform-`noise_msg` convention is documented as faithful-and-safe (`:161-167`). Do not diverge to a distinct tag for the rekey reply.

**New surface:**

- `DaemonState` (`:92`) gains `'awaiting-rekey-init'`.
- The `FakeDaemon` handle (`:80-90`) gains `initiateRekey(): void` — "as the daemon: seal a `rekey_request` under the current send cipher, send it, and enter `awaiting-rekey-init` to answer the client's fresh `msg1`."
- `FakeDaemonOptions` (`:54-67`) gains one optional field `rekeyResumeMessage?: Uint8Array` — the plaintext to seal and stream **under the new keys** immediately after the swap (see below); default a fixed canned `message` envelope built with the file's deterministic `id`/`ts` convention.
- Two module constants for the sealed `rekey_request` envelope's fixed `id`/`ts` (mirror `HELLO_ACK_ID`/`HELLO_ACK_TS` at `:51-52`), so the fake stays deterministic and wall-clock-free.

**`initiateRekey()` contract** (guard `state === 'transport' && sendCipher !== null`, else no-op):
- Build the trigger envelope via the production codec: `encodeEnvelope({ id, type: 'rekey_request', ts, payload: { reason: 'scheduled' } })`. (Matches the shape the #108 recognizer peeks and the #111 tests use.)
- Seal it under the current send cipher, **set `state = 'awaiting-rekey-init'` BEFORE `sendNoise`** (re-entrancy discipline mirroring the responder; over a real WS it is not synchronously re-entrant, but keep the ordering faithful), then `sendNoise(sealed)`.

**`awaiting-rekey-init` inbound handling** (a new branch in `onMessage`'s state dispatch at `:221-222`, routing to a new `handleRekeyInit(raw)`): the raw bytes are the client's fresh `noise_init` (`msg1`). Run a fresh handshake **as RESPONDER**, mirroring `handleMsg1` but with empty early-data both ways:
- `fresh = HandshakeState(NOISE_PROTOCOL, NOISE_ROLE_RESPONDER)`; `fresh.Initialize(prologue-or-null, staticPriv, null, null)` — byte-identical to the initial responder init (`:110-116`), reusing the SAME static.
- `fresh.ReadMessage(raw, true)` — the client's `msg1`; discard the recovered early-data (empty on a rekey — the client sent `EMPTY_AD`).
- `reply = fresh.WriteMessage(EMPTY_AD)` — `msg2` with empty early-data (no `hello_ack` on a rekey).
- `pair = fresh.Split()` — `[send, recv]` role-adjusted, **no swap** (the module note at `:14-21`; crossing the mapping sails through the handshake and detonates on the first sealed frame — the round-trip test is the oracle).
- **Atomic swap** (identical discipline to `noiseSession.ts:245-261` and the responder at `:102-113`): capture `prevSend`/`prevRecv`, assign `sendCipher = pair[0]; recvCipher = pair[1]` (two adjacent synchronous assignments, nothing fallible between), then guarded-free the old pair. `state = 'transport'`.
- `sendNoise(reply)` — the `msg2` the client reads to complete its own swap.
- **Then** seal `options.rekeyResumeMessage` (or the canned default) under the NEW send cipher and `sendNoise` it — the post-rekey "resume" frame under K1 (rationale below).
- On any throw: classify `handshake-read-failed`, drop the caught object (log-free), tear down (mirror `handleMsg1`'s catch at `:186-190`). This is the only new reject branch.

**Why the post-rekey resume frame exists (load-bearing for the e2e's determinism):** #111's client emits **no event** on a successful swap (implicit ack, no `rekey_ack`). So an e2e test has **no client-side signal** that the client has finished swapping to K1 — and a client `send()` issued while the client is still in `awaiting-rekey-reply` is silently dropped (the session's `state !== 'transport'` guard). The daemon sending one frame under the new keys immediately after its swap gives the test a deterministic, ordered client-side signal: the forwarder splices frames in order, so this frame arrives **after** the `msg2` the client swapped on, decrypts under the client's fresh recv cipher, and surfaces as a `message` → `messageReceived`. That receipt proves the client's recv cipher is K1. It is crypto-faithful (any daemon→client frame under K1 is identical crypto to "the daemon streaming the next turn post-rekey"); the choreography detail — who sends the first post-rekey frame — is a harness concern, not a protocol divergence.

`handleTransport` (`:193-206`) is unchanged — after the swap it already uses the current (now K1) ciphers, so a subsequent client send decrypts under K1 and replies via `buildReply` under K1. `whenSettled`/`buildReply` semantics are untouched (the rekey path adds a parallel channel; `whenSettled` stays `ok:true`-cached from the initial round-trip).

### Part 3 — End-to-end rekey round-trip (`daemonConnection.roundtrip.test.ts`)

A third `it(...)` in the existing fake-target `describe` (`:208`), reusing `standUpRoundTrip`. It drives the **assembled** stack (`createDaemonConnection` → the REAL `createNoiseRelayDriver` → real session → real loopback relay) against forwarder + fakeDaemon, so it exercises Part 1's framing on the real wire and Part 2's responder together. Choreography:

1. Stand up with a `buildReply` that returns a known `message` envelope (for the client-initiated round-trip leg) and a `rekeyResumeMessage` that is a **distinct** known `message` envelope (for the resume-signal leg). Drive to `connected` (K0).
2. Baseline: `connection.send(m0)` → await `messageReceived` (K0 round-trip works — establishes the pre-rekey baseline).
3. `daemon.initiateRekey()`. The daemon seals `rekey_request` (K0) → the real client recognizes it → the driver frames the fresh `msg1` as `noise_init` (Part 1) → the daemon reads it as `msg1`, swaps to K1, sends `msg2` + the resume frame → the client reads `msg2`, swaps to K1.
4. Await the `messageReceived` carrying the **resume** payload → proves the client's recv cipher is K1 (the client swapped). This is the "resumes messaging under the new keys" signal.
5. `connection.send(m1)` (the client is now confirmedly in K1) → the daemon opens it under K1 (the implicit ack) and replies via `buildReply` under K1 → await `messageReceived` carrying the **reply** payload → proves the client's send cipher is K1. This closes the bidirectional round-trip under the new keys (AC3).
6. Assert no `failed` event across the whole sequence.

**Not re-proven at e2e:** that an old-key (K0) frame no longer opens after the swap. #111's unit scenario already proves cipher **replacement** (not mere replay) at the session boundary via the nonce-lockstep hold-back trick (`docs/knowledge/codebase/111.md` § Lessons; [[rekey-test-nonce-lockstep-hold-back]]). Re-staging that in a real WS e2e would add significant complexity for no new evidence — evidence-based-deferred.

## State + concurrency model

- **Driver latch lifecycle.** `rekeyInitPending` is per-connection closure state (like `firstFrame`), created fresh in each `onConnected` and never shared across reconnects. Armed in `route`, consumed in `sendFrame` within the same synchronous `onFrame` turn. No timer, no async gap. On a superseded generation both closures no-op via the existing guard.
- **Fake daemon state machine.** `awaiting-msg1 → transport → awaiting-rekey-init → transport` (rekey may repeat; `initiateRekey` is only valid from `transport`). `onMessage` is inert in `closed` (`:212`). No new timers or listeners; the single WS leg and its lifecycle handlers (`:246-257`) are unchanged. `freeAll` already covers `sendCipher`/`recvCipher`, so the fresh handshake's ciphers are freed on teardown; the transient `fresh` handshake object is consumed by `Split()` (or auto-freed on throw) within `handleRekeyInit`, never escaping the function — no new object needs teardown wiring.
- **Re-entrancy.** Both the driver latch and the fake daemon's `initiateRekey` set state before sending, matching #111's "set `hs`+`state` before `sendFrame`" invariant, so a synchronous re-entrant reply (in the JS↔JS unit path) finds the correct state.
- **No cross-`await` shared-state races.** Neither part introduces an `await` inside an entry point; the transport's single-threaded synchronous-crypto invariant holds.

## Error handling

- **Driver.** No new error surface. The `sendFrame` try/catch → `outbound-frame-encode-failed` already covers the rekey `msg1`'s encode/send (it is just another outbound frame). A latch armed but not consumed — only reachable if `beginRekey`'s `WriteMessage(EMPTY_AD)` throws, which #111 documents as practically unreachable — would mis-tag the next app frame as `noise_init`; the daemon rejects a mis-framed frame and tears the session down (fail-safe, no hijack). Covered as an accepted residual in the Security review below.
- **Fake daemon.** One new reject branch: `handleRekeyInit`'s catch classifies `handshake-read-failed`, drops the caught object (no bytes in diagnostics — a wasm error string can echo transcript bytes), and tears down, mirroring `handleMsg1`. The existing `FakeDaemonErrorReason` set is unchanged (no new member). A rekey failure is not surfaced through `whenSettled` (already `ok:true`-cached); the happy-path e2e treats a daemon rekey failure as a test timeout (correct — the client never receives the resume frame). No rekey-failure e2e is added (the session-layer rekey-failure path is #111's unit coverage).

## Testing strategy

`npm test` (vitest), `npm run typecheck`, `npm run build` (the salvage/QA gate — also compiles the driver's unchanged `route` against the session's types). Test-first per CLAUDE.md. Three additive test surfaces; no full test-function bodies below — scenarios only, written in the file's existing idioms.

**A. Driver framing unit test** (`noiseRelayDriver.test.ts`, new `it` in the existing `describe`, driving `makeFakeSession`'s captured `config`):
- Connect → session created → `start()` sends `msg1` → assert `sent[0]` tags `noise_init` (existing coverage; re-establish the baseline in this test).
- `handshake-complete`, then an app `sendMessage` → assert `noise_msg`.
- Drive the rekey exactly as the real session does: `session.config.onEvent({type:'rekey-requested'})` **then** `session.config.sendFrame(FAKE_REKEY_MSG1)` → assert the resulting frame tags **`noise_init`**.
- A following app `sendMessage`/`sendFrame` → assert `noise_msg` again (the latch was one-shot, consumed).
- Assert `rekey-requested` is still absent from the sink (not propagated).

**B. Fake daemon rekey-initiator unit test** (`fakeDaemon.test.ts`, new `it` in the round-trip `describe`, extending `driveClient` + `standUp`): the REAL client initiator (via `createNoiseSession` + `createRelayConnection`, which already tags `noise_init`/`noise_msg` at `:141-145`) is the oracle.
- Complete the initial handshake + one K0 round-trip (existing pattern).
- `daemon.initiateRekey()` → the real client recognizes the trigger, runs its fresh handshake, and swaps. Assert the client surfaces the daemon's post-swap resume frame as a `message` with the expected bytes (proves the client's recv cipher is K1).
- `initiator.sendMessage(probe)` under K1 → assert the client surfaces the daemon's `buildReply` (proves the client's send cipher is K1 and the daemon opened the K1 frame).
- Assert no client `error` (in particular no `transport-decrypt-failed` — the deterministic oracle for a crossed rekey `Split` mapping), and `daemon.whenSettled()` is `{ok:true}`.
- Optionally assert log-free across the rekey (extend the existing console-spy test) — the rekey path must not `console.*`.

**C. End-to-end rekey round-trip** (`daemonConnection.roundtrip.test.ts`) — the Part 3 choreography above, asserting on event types/counts and `.message` payloads (never serialized secrets), reusing `standUpRoundTrip`, the LIFO teardown, and the bounded `makeWaiter`. Generous per-step bounds (cold-CI wasm compile + real handshakes) as the file already uses.

Regression: existing driver tests (initial-handshake framing, reconnect re-arm, error classification), the fakeDaemon round-trip oracle, and the two existing e2e round-trip tests must stay green.

## Open questions

- **Post-rekey resume frame — canned default vs. required option.** The spec makes `rekeyResumeMessage` optional with a canned `message`-envelope default so the fakeDaemon unit test (B) can use the default while the e2e (C) supplies a distinct known payload. If the developer finds the default awkward to assert against in B, making the resume payload a fixed exported constant is an acceptable alternative — the contract that matters is "one known `message` envelope sealed under K1 right after the swap." Developer's call.
- **Latch naming.** `rekeyInitPending` is a suggestion; any clear name for "next outbound frame is a handshake init" is fine. Do not rename `firstFrame` (out of scope; no consumer fan-out benefit).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The untrusted→trusted decode boundary stays `onMessage`/`noiseRelayDriver.onMessage` (`fail-closed` `decodeInnerFrame`+`base64StdDecode`, caught object dropped). Part 1 only changes the **outbound** tag of an already-trusted, session-produced frame; it never parses untrusted input. Part 2's `handleRekeyInit` consumes the client's fresh `msg1` **through the Noise handshake `ReadMessage`** (AEAD/DH-authenticated) — a hostile forwarder cannot forge a `msg1` that completes against the pinned static; a malformed one fails `ReadMessage` → `handshake-read-failed` → teardown. The `rekey_request` the fake seals is authenticated under the existing transport cipher, exactly as the real daemon's is.
- **[Cryptographic primitives]** No hand-rolled crypto. Both parts reuse `NOISE_PROTOCOL` verbatim (ADR 0002 — the load-bearing suite pin) and the vetted `noise-c.wasm` `HandshakeState`/`Split`. The fresh rekey handshake reuses the SAME injected static keys and empty-prologue handling as the initial handshake (byte-identical `Initialize`). Empty early-data both ways on the rekey — the device token is **not** re-transmitted (spec § Re-key). The `Split()` `[send, recv]` no-swap role mapping is preserved on both sides; a crossed mapping is caught by test B's decrypt oracle, not shipped.
- **[Key / nonce reuse]** The atomic swap installs **both** new ciphers before freeing either old one, with no fallible op between the two assignments (mirrors #111 and `handleMsg1`) — the session/daemon is never left with one K0 and one K1 cipher. New `(key, nonce)` counters come from a fresh `Split()`; the old ciphers are freed, never reset-and-reused. `initiateRekey` seals the `rekey_request` under the **current** (pre-swap) send cipher, advancing that cipher's nonce once — no nonce is reused across the rotation.
- **[Network & I/O — framing on the internet-exposed path]** The MUST-be-correct behavior of this ticket. The rekey `msg1` MUST be framed `noise_init` so the real daemon routes it to `handleRekeyInit` rather than transport-decrypt (which fails AEAD → WS 4421). The latch achieves this deterministically via the session's synchronous emit-then-send ordering; the driver-framing unit test (A) pins it. `maxPayload` (`MAX_FRAME_BYTES`) and the inbound decode cap are inherited unchanged; no new inbound size surface. Inbound framing is deliberately **not** branched on `type` — the session's state machine + AEAD decide interpretation, so a hostile inbound `type` cannot misroute the client (unchanged from #50/#111).
- **[Error messages / logs]** Log-free preserved. The new `handleRekeyInit` catch classifies to the static `handshake-read-failed` and drops the caught object; no key/token/transcript/plaintext bytes reach any diagnostic. Part 1 adds no logging. Test C asserts on event types/payload equality, never serialized secrets; test B may extend the console-spy assertion across the rekey.
- **[Concurrency / teardown]** No new long-lived async task, timer, or listener. The driver latch is per-connection synchronous state; the fake daemon's transient `fresh` handshake is consumed within `handleRekeyInit` (or auto-freed on throw) and never escapes; `freeAll` already frees the swapped-in ciphers on `close()`. `awaiting-rekey-init` is inert after `close()` via the existing `state === 'closed'` guard.
- **[Threat model — hostile relay / hostile daemon]** A content-blind hostile relay can drop/delay/reorder/flood the rekey frames but cannot forge them (AEAD/handshake-authenticated); the worst it achieves is a stalled rekey → the daemon's window lapses → WS 4426 → the supervisor reconnects with a fresh handshake (lost-rekey **recovery** hardening is explicitly #495, `blockedBy` this ticket — out of scope here). The peer-static continuity check that rejects a mid-session peer swap is the **daemon's** responsibility (pyrycode #452/#453); the client reusing its pinned `remoteStaticPublicKey` IS its half of the continuity guarantee (a peer swap fails the fresh `ReadMessage` → old ciphers intact) — unchanged from #111, no phantom client-side compare added.
- **[Accepted residual — latch leak under an unreachable throw]** SHOULD FIX / accepted. If `beginRekey`'s `WriteMessage(EMPTY_AD)` threw (session stays in `transport` on old keys, sends no `msg1`), the armed latch would tag the next app frame `noise_init`, which the daemon would reject and tear down. This is fail-safe (connection teardown, not session hijack — the frame is already AEAD-sealed under the old cipher and simply gets mis-routed and dropped), and the trigger is a `WriteMessage` on a freshly-initialized handshake with empty early-data, which #111 documents as practically unreachable. Not gated; noted for code-review awareness. The driver cannot distinguish this case (it has no visibility into a session-internal throw), so no deterministic driver-side guard is available without a session API change (out of scope).
- **[Electron attack surface / tokens-at-rest / file storage]** N/A — this ticket adds no IPC channel, no renderer surface, no `BrowserWindow`, no filesystem or `safeStorage` operation, and no token handling. `fakeDaemon.ts` remains test-only (permissive `ws://` dialer + synthetic static key) and must not enter the production graph (`src/main/index.ts`, `src/preload`, `src/renderer`) — a placement regression here is the one Electron-surface risk, guarded by the module's `.ts`-imported-only-by-`.test.ts` discipline (`:22-24`).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
