# 108 — Recognize the daemon's in-session `rekey_request` control message (rekey trigger)

Add **recognition only** to the transport-state dispatch of the Noise session: a frame that AEAD-decrypts to a `rekey_request` control envelope is classified as a distinct rekey trigger — surfaced through the session's typed event sink as a new bare `NoiseSessionEvent` variant — instead of being handed on as an app `{type:'message'}` and silently dropped downstream. It runs **no** re-handshake and swaps **no** ciphers; that is the immediate follow-on #109 (blocked by this ticket), which consumes this trigger.

Split from #76 (recognize → act). Daemon twin: pyrycode #454 (the daemon-side `rekey_request` discriminator).

## Design source

N/A — transport-layer crypto recognition. No UI surface, no Figma. The code-review visual-fidelity check is intentionally not applicable to this ticket.

## Files to read first

- `src/main/transport/noiseSession.ts:135-169` — `onFrame`. **The seam.** Line 146 (`config.onEvent({ type: 'message', plaintext })`) in the `transport`-state branch is the exact insertion point; recognition slots between the successful `DecryptWithAd` (line 141) and this emit.
- `src/main/transport/noiseSession.ts:46-56` — `NoiseSessionErrorReason` + `NoiseSessionEvent`. The sealed event union you add the new variant to (discriminated on `type`).
- `src/main/transport/noiseSession.ts:1-22` — module header doc-comment. States the session "constructs no envelope … imports no codec." This ticket is the seam that gives it a **type-peek**; update the header (see Design).
- `src/main/transport/codec.ts:127-138` — `decodeEnvelope`. The vetted, fail-closed plaintext→`Envelope` decoder you reuse for the peek. Throws `WireDecodeError` on malformed UTF-8/JSON or a missing/mistyped `id`/`type`/`ts`/`payload`. Reads `.type` off the returned `Envelope`.
- `src/main/transport/inboundMessage.ts:86-110` — `parseInboundMessage`. The **downstream** app-message decode/narrow authority; its `default → null` branch is where a `rekey_request` gets silently dropped today. This module stays the sole app-message authority — recognition must not become a second decode gate for app messages.
- `src/shared/wire/types.ts:40-61` — `EnvelopeType` union + `Envelope` interface. `Envelope.type` is `EnvelopeType | string`, so `=== 'rekey_request'` type-checks with no union change. See Design for why the constant deliberately stays **out** of this union.
- `src/main/transport/noiseRelayDriver.ts:194-200` — `route`. Forwards `NoiseSessionEvent` into `emit` (a `RelaySessionEvent` sink) relying on `NoiseSessionEvent ⊆ RelaySessionEvent`. Adding a variant breaks that subset — this file needs a small build-integrity edit (see Design § Driver).
- `src/main/transport/noiseRelayDriver.ts:48-59` — `RelaySessionErrorReason` + `RelaySessionEvent`. Confirms the subset relationship you must preserve; do **not** add the trigger here (it stays a session-boundary signal for #108).
- `src/main/transport/noiseSession.test.ts:46-124` — `createNoiseResponder` (the test-only IK responder) + its `sendMessage` (AEAD-seals a plaintext). The peer-cipher idiom AC5 requires: seal a real frame from the responder, assert via the initiator's `NoiseSessionEvent` collector.
- `src/main/transport/noiseSession.test.ts:126-129, 224-292` — `collector<E>()` and the `pair()` fixture. Reuse both unchanged; the new tests are additive.
- Daemon reference (context, not code to read): pyrycode `docs/protocol-mobile.md` § Re-key pins the wire shape — `rekey_request` is a full `Envelope` `{id, type, ts, payload:{reason}}`, sealed inside a `noise_msg`, no `rekey_ack`.

## Context

`noiseSession.ts` performs exactly one IK handshake, then in `transport` state is deliberately **codec-agnostic**: it AEAD-decrypts each inbound frame and emits the opaque bytes as `{type:'message', plaintext}` (`noiseSession.ts:146`), importing no codec and decoding no envelope. All semantic narrowing happens **downstream** in the consumer's `parseInboundMessage` (`inboundMessage.ts`), whose `default → null` branch drops any envelope type it doesn't model.

In v2 the daemon is the rekey **initiator** for the trigger (pyrycode #450/#453/#454): on a ~1-hour per-session timer it AEAD-seals a `rekey_request` control envelope and sends it as a transport frame to nudge the client to re-handshake. Today that envelope decrypts fine, surfaces as `{type:'message'}`, and is silently dropped by `parseInboundMessage`'s `null` path — so no rekey is ever triggered (`grep -ri rekey src/` is empty; genuinely unbuilt).

This ticket adds the **recognition** and nothing else. Recognition is a transport-layer concern (it governs the cipher lifecycle), so it lives in the session, not the consumer — keys, sockets, and the handshake never reach the renderer. Off the first-milestone critical path (a milestone session lasts seconds; the daemon rekeys hourly), built now because long-lived desktop sessions are on the roadmap.

## Design

Recognition is **purely additive**: it sits between the successful transport-state decrypt and today's `message` emit, and diverts **only** on a positively-classified `rekey_request`. Everything else — a well-formed app message, an unmodeled control type, bytes that don't decode as an `Envelope`, or a peek that throws — falls through to the unchanged `{type:'message', plaintext}` path.

All of the following lives in `src/main/transport/noiseSession.ts`, plus one build-integrity edit in `noiseRelayDriver.ts`. No new files.

### 1. New event variant (the trigger)

Add one bare, byte-free variant to the existing `NoiseSessionEvent` union (`noiseSession.ts:53-56`):

```ts
| { type: 'rekey-requested' } // daemon rekey_request control frame recognized; #109 acts on it
```

Bare by AC4 — it carries no key/token/frame/plaintext bytes. It is a signal, not a payload. The union stays a discriminated union on `type`.

### 2. Wire-string constant (module-private)

```ts
// The v2 control-envelope type the daemon seals to trigger a re-key. Mirrors the daemon's
// `protocol.TypeRekeyRequest` (pyrycode #454); wire source: protocol-mobile.md § Re-key.
const REKEY_REQUEST_TYPE = 'rekey_request'
```

**Deliberately module-private, and deliberately NOT added to the `EnvelopeType` union** in `types.ts`. This mirrors the daemon's own load-bearing asymmetry: pyrycode #454 added `TypeRekeyRequest` as a constant but kept it **out** of `v1TypeSet` (the app-dispatch set), so `rekey_request` is never routed to the application handler chain. The desktop analog of `v1TypeSet` is the set of `EnvelopeType` members `parseInboundMessage` switches over; keeping `rekey_request` out of that union documents the same "control type, not an app-dispatch type" boundary. `Envelope.type` is `EnvelopeType | string`, so the comparison type-checks without the union. The constant has exactly one consumer (the recognizer below) — #109 consumes the *event*, not the wire string — so `types.ts` (shared) stays untouched and `EnvelopeType` stays the app-message vocabulary.

### 3. The recognizer (module-private, total)

```ts
import { decodeEnvelope } from './codec'

// True iff `plaintext` decodes as an Envelope whose type is the rekey trigger. TOTAL: any
// decode/peek failure returns false (fail-closed → caller falls through to the message path).
// Reuses the vetted fail-closed decoder; reads only `.type`, never interprets the payload.
function isRekeyRequest(plaintext: Uint8Array): boolean
```

- Behavior: `try { return decodeEnvelope(plaintext).type === REKEY_REQUEST_TYPE } catch { return false }`.
- **Reuse `decodeEnvelope`, do not hand-roll a second parser.** This mirrors the daemon twin's "decode-as-Envelope → switch on `type` → fall through on decode failure" seam (#454), and reuses the already-security-reviewed, UTF-8-fatal, fail-closed decoder rather than duplicating its JSON front-half. The daemon's `rekey_request` is a full `Envelope` (`id`/`type`/`ts`/`payload` all present — see protocol-mobile.md), so strict `decodeEnvelope` decodes it with **zero false-negative risk** for the contracted shape.
- Reads only `.type`; the payload (`{reason}`) is discarded, never interpreted (the trigger is shape-only, per the ticket's "must not interpret the control payload").
- The `catch` swallows `WireDecodeError` (malformed UTF-8/JSON, non-object, missing/mistyped field). A peek failure is **not** a rejection — it reproduces today's behavior via the caller's fall-through.

### 4. The seam (transport-state branch of `onFrame`)

Replace the transport-state emit (`noiseSession.ts:137-148`) so recognition slots between the decrypt and the existing `message` emit. Contract (not a rewrite of the surrounding branch):

- After `plaintext = recvCipher.DecryptWithAd(EMPTY_AD, frame)` succeeds:
  - `if (isRekeyRequest(plaintext)) { config.onEvent({ type: 'rekey-requested' }); return }`
  - else `config.onEvent({ type: 'message', plaintext })` (unchanged).
- The AEAD-open failure path (`catch → fail('transport-decrypt-failed')`) is **unchanged** — it is upstream of recognition and out of scope.

Additive invariant (AC2/AC3): the recognizer never transforms, re-narrows, or drops an app-message plaintext. On the `message` path the *identical* decrypted bytes flow through, exactly as today. `parseInboundMessage` remains the sole app-message decode/narrow authority; recognition is not a second decode gate for app messages (it only *diverts* a positively-matched control frame, and even that carries no bytes).

### 5. Module header update

The header doc-comment (`noiseSession.ts:1-22`) says the session "constructs no envelope … imports no codec." Refine it: in `transport` state the session now **peeks** the decrypted envelope's `type` (via `decodeEnvelope`) to recognize the daemon's `rekey_request` control frame — a type-peek only. It still constructs no envelope and interprets no payload; app-message decoding stays downstream in `parseInboundMessage`. Keep the LOG-FREE contract note intact.

### 6. Driver build-integrity edit (`noiseRelayDriver.ts`)

`route` (`noiseRelayDriver.ts:197-200`) forwards a `NoiseSessionEvent` into `emit` (a `RelaySessionEvent` sink), relying on `NoiseSessionEvent ⊆ RelaySessionEvent`. Adding the `rekey-requested` variant breaks that subset, so `emit(event)` no longer type-checks — `npm run build` (the QA gate) would fail. Fix with a two-line early-return guard **before** `emit`:

- `if (event.type === 'rekey-requested') return` — with a comment: recognition-only in #108; the trigger is a transport-control signal the driver does not propagate to the `RelaySessionEvent` sink yet; #109 wires the action. After the guard, TypeScript narrows `event` to the three forwardable variants (`handshake-complete`/`message`/`error`), which stay assignable to `RelaySessionEvent`, so `emit(event)` type-checks.

This is a **build-integrity** edit, not an action on the trigger. #108's tested signal is at the session's `onEvent` (AC5); the driver simply must compile and must not misroute the trigger as an app message. Do **not** add `rekey-requested` to `RelaySessionEvent` — that would fan the change out to `RelaySessionEvent`'s consumers for no #108 benefit; #109 owns any upward propagation.

### Data flow

```
inbound frame (transport state)
  → recvCipher.DecryptWithAd(EMPTY_AD, frame)
      ├─ throws → fail('transport-decrypt-failed')            [unchanged, upstream of recognition]
      └─ plaintext →
           isRekeyRequest(plaintext)?
             ├─ true  → onEvent({type:'rekey-requested'})     [NEW: bare trigger; driver drops it (#108); #109 acts]
             └─ false → onEvent({type:'message', plaintext})  [unchanged; parseInboundMessage narrows downstream]
```

## State + concurrency model

No new state, no new async, no new store slice. The session is single-threaded with synchronous `noise-c.wasm` crypto and no `await` inside any entry point (the module's existing invariant, pinned by the close-during-handshake tests). The recognizer is a synchronous, pure read of the already-decrypted `plaintext` local — it never touches `recvCipher`/`sendCipher`/`hs`/`state`.

`DecryptWithAd` has already advanced the receive nonce counter **before** the recognizer runs, regardless of the recognizer's outcome — so cipher state is correct on both the `rekey-requested` and the `message` path. Cipher-state corruption from recognition is structurally impossible: the recognizer holds no cipher reference. The `state === 'closed'` short-circuit at the top of `onFrame` is unchanged, so a post-close frame is still inert (recognition is never reached after teardown).

## Error handling

Recognition is fail-closed and non-terminal by construction:

- **Peek throws** (malformed UTF-8/JSON, non-object, missing/mistyped `id`/`type`/`ts`/`payload`) → `isRekeyRequest` returns `false` → `{type:'message', plaintext}` emitted (today's behavior). No session termination, no `error` event, no cipher mutation.
- **Decodes as an `Envelope`, type ≠ `rekey_request`** (a well-formed app message, or an unmodeled control type like `ack`/`error`/`some_future_control`) → `false` → `{type:'message', plaintext}`. Downstream `parseInboundMessage` narrows app types and drops unmodeled ones via its `null` path, exactly as today.
- **Decodes as an `Envelope`, type === `rekey_request`** → `{type:'rekey-requested'}`; the plaintext is dropped (a control frame carries no app content). No `error`, no reply, no outbound frame.
- **AEAD open fails** → existing `transport-decrypt-failed` path, unchanged (upstream of recognition, out of scope).

No new error reason is added to `NoiseSessionErrorReason` — a peek failure is not an error, it is a fall-through. LOG-FREE is preserved: no `console.*`, and the trigger event carries no bytes.

## Testing strategy

`vitest`, driven through the existing `noiseSession.test.ts` peer-cipher idiom (AC5): the test-only `createNoiseResponder` AEAD-seals a real frame via `responder.sendMessage(plaintext)`, and assertions read the initiator's `NoiseSessionEvent` collector. All three tests are additive — reuse `pair()`, `collector`, `enc`, and `bytes` unchanged; add nothing to the production helpers. Add a small local helper to build a sealed envelope, e.g. seal `enc({ id, type, ts, payload })` through the responder.

Bullet-pointed scenarios (developer writes the test bodies in the file's idiom):

1. **Sealed `rekey_request` recognized as the trigger (AC1).** Responder seals `{ id: 42, type: 'rekey_request', ts: <any RFC3339 string>, payload: { reason: 'scheduled' } }`. Assert the initiator collector contains exactly one `{type:'rekey-requested'}` and **no** `{type:'message'}`. (Optionally also assert no `{type:'error'}`.)

2. **App-message frame still surfaces as `message` with identical plaintext (AC2 regression).** Responder seals an app envelope, e.g. `enc({ id, type: 'message', ts, payload: { conversation_id, message_id, role: 'assistant', text } })`. Assert the initiator collector has `{type:'message', plaintext}` whose bytes equal the *exact* sealed plaintext (`bytes(plaintext)` deep-equals the sealed bytes), and **no** `{type:'rekey-requested'}`. This pins that recognition does not transform or re-narrow app-message plaintext.

3. **Decrypted-but-non-rekey falls through without corruption or crash (AC3).** Two sub-cases, both sealed through the responder so they AEAD-open cleanly:
   - **(a) unmodeled control type** — `enc({ id, type: 'some_unknown_control', ts, payload: {} })` → surfaces as `{type:'message', plaintext}` (identical bytes), no `rekey-requested`.
   - **(b) garbage that does not decode as an `Envelope`** — e.g. `new TextEncoder().encode('not-json{{')` or a raw non-JSON byte blob → surfaces as `{type:'message', plaintext}` (identical bytes), no `rekey-requested`, no `error`, no throw.
   - **Recommended strengthening (no cipher corruption):** after feeding the fall-through frame, have the responder seal one ordinary app message and assert the initiator still surfaces it correctly as `{type:'message'}` — proving the recv cipher advanced correctly and recognition left cipher state intact.

Existing coverage that must stay green (do not modify): the mode-2 round-trip, the `transport-decrypt-failed` classification test, the close-during-handshake safety block, and the log-free assertion. Confirm `npm run build` and `npm test` are green — the build gate exercises the `noiseRelayDriver.ts` route edit (the union-subset assignment).

## Open questions

- **Should the trigger also propagate up through `RelaySessionEvent` to the driver's consumer now?** No — for #108 (recognition only) the driver drops it. #109 owns the action and will decide whether the re-handshake runs in-session (the session recognizing its own trigger) or is driven from the event. Deferring keeps #108 minimal and avoids a premature fan-out into `RelaySessionEvent`'s consumers.
- **Should `payload.reason` (`scheduled`/`manual`/`compromise`) ever be surfaced?** No, not here — AC4 makes the trigger a bare signal. If #109 or a later ticket needs the reason for operator visibility, it would extend the event then; the daemon logs the reason on its side (#454), and this module is LOG-FREE.

## Security review

**Verdict:** PASS

Adversarial re-read of the spec above. The dominant fact for this ticket: **the recognizer runs strictly downstream of the AEAD open.** `recvCipher.DecryptWithAd` (`noiseSession.ts:141`) is the trust boundary; only plaintext that has already passed AEAD authentication — i.e. sealed by the peer holding the session's send key, which is the IK-authenticated daemon (server static key pinned from the QR record) — ever reaches `isRekeyRequest`. A hostile, content-blind relay peer without the session key can only produce frames that **fail** the AEAD open, which take the existing non-terminal `transport-decrypt-failed` path and never reach recognition. Recognition therefore operates only on daemon-authenticated bytes; it cannot be driven by an on-path relay injecting a forged control frame.

**Findings:**

- **[Trust boundaries] No findings.** The boundary is the AEAD open, unchanged and upstream of the new code. The recognizer's `decodeEnvelope` is shape-validation on already-authenticated plaintext, not a network boundary check. The new `message`-vs-`rekey_request` split is an internal classification of trusted bytes. The `rekey_request`-out-of-`EnvelopeType` asymmetry (Design § 2) documents the "control type, not app-dispatch type" boundary, mirroring the daemon's `v1TypeSet` exclusion (belt-and-suspenders, different fabric: the daemon enforces it on its side; the desktop enforces it here).
- **[Tokens, secrets, credentials] No findings.** No token, key, or credential is read, stored, compared, or logged. The trigger event is byte-free; `REKEY_REQUEST_TYPE` is a static wire string, not a secret. Constant-time comparison is not applicable — `envelope.type === 'rekey_request'` compares a decoded protocol type string, not a secret; no attacker-vs-secret compare exists.
- **[File / storage operations] No findings.** No filesystem access; no path built from any input.
- **[Inter-process / Electron attack surface] No findings.** Change is entirely main-process transport crypto. Nothing crosses `contextBridge`/`ipcMain`; no renderer surface, no new IPC channel, no window/webPreferences touched. The trigger event stays inside the main process (the driver drops it); keys/sockets/plaintext never move toward the renderer.
- **[Cryptographic primitives] No findings.** No new crypto. The Noise suite, `DecryptWithAd`, `EMPTY_AD`, and the cipher lifecycle are untouched. The recognizer never resets or reuses a `(key, nonce)` pair — it holds no cipher reference; the recv nonce advances exactly once per frame inside the unchanged `DecryptWithAd`, before recognition runs. No re-handshake and no cipher swap occur here (that is #109, which gets its own security review).
- **[Network & I/O] No findings.** No new socket, no new frame emitted (the trigger is inbound-only; `handleRekeyRequest`-style action is out of scope). No new size cap needed: the plaintext is already bounded by the Noise transport-message ceiling (≤65535 bytes; `MAX_PLAINTEXT_BYTES = 65519`) enforced upstream, and `decodeEnvelope` over a ≤65 KB buffer is O(size) and cheap — one small JSON parse per transport frame, negligible beside the ~100 µs AEAD decrypt that already ran. A flood of frames costs one extra parse + one comparison each: no amplification, no memory-exhaustion, no slow-loris surface introduced. The double-decode (recognizer + downstream `parseInboundMessage`) is the same tradeoff the daemon twin #454 deliberately accepted; the alternative (threading a pre-decoded envelope downstream) would touch `parseInboundMessage` and its tests for no measurable benefit.
- **[Error messages, logs, telemetry] No findings.** LOG-FREE is preserved: no `console.*` added; the caught `WireDecodeError` is swallowed to a boolean, never forwarded, logged, or turned into an `error` event. The trigger event `{type:'rekey-requested'}` carries no bytes — no plaintext, key, token, frame, or `payload.reason` value enters any event, reason string, or diagnostic (AC4). No new `NoiseSessionErrorReason`.
- **[Concurrency] No findings.** Synchronous, single-threaded, no `await`, no new timer/listener/task. No teardown or cancellation surface added. The existing `state === 'closed'` short-circuit still makes a post-close frame inert before recognition is reached.
- **[Threat model alignment] Addressed / bounded.**
  - *Malicious / compromised relay (on-path, content-blind):* cannot forge or smuggle a `rekey_request` — a forged control frame fails the AEAD open (→ `transport-decrypt-failed`, unchanged) and never reaches recognition. Drop/delay/reorder/flood: recognition adds no wedge — a fall-through frame is emitted as `message` as today, and a flood is bounded by the cheap per-frame parse above.
  - *Hostile / confused daemon response (authenticated but malformed):* every reachable plaintext is parsed defensively — `isRekeyRequest` is total (any decode failure → fall through, no throw, no termination, no cipher mutation). A malformed `rekey_request` (e.g. missing `id`) safely fails the peek and falls through to `message` → dropped by `parseInboundMessage` (no spurious rekey) — the same fail-safe posture as today.
  - *False-positive rekey trigger:* only an authenticated envelope whose `type` is literally `rekey_request` matches; the daemon never labels an app message that way. Even a hypothetical false trigger acts on daemon-authenticated content (the daemon's own intent), not a relay injection, and #109 — not #108 — is where any resulting re-handshake happens.
  - *Renderer compromise reaching the transport:* out of reach — the change is main-process only and the trigger never crosses to the renderer.
  - *#109 (re-handshake continuity, atomic cipher swap) and #495 (lost-rekey recovery)* are explicitly **out of scope**; each gets its own focused security review when built.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
