# Spec #91 — In-process Noise_IK responder fake daemon + round-trip self-test

**Size:** S (confirmed). One production file `fakeDaemon.ts` (~200 LOC) + its test `fakeDaemon.test.ts` (~250 LOC). ~3–4 new exports (`startFakeDaemon`, `FakeDaemon`, `FakeDaemonOptions`, `FakeDaemonOutcome`). No new dependency (reuses `ws`, `noise-c.wasm`, `./codec`, `./noiseLib` — all present). Zero consumer call sites / no edit fan-out — this is additive test-only infrastructure; the #89 consumer imports it later. Responder state machine has 3 states and <5 reject branches. Well inside the S envelope.

**Security-sensitive:** YES (label present). The fake daemon inspects and decrypts frames crossing the relay boundary; it holds a Noise static key and cipher states. The security-review pass at the end of this spec is mandatory and was run before commit.

## Files to read first

- `src/main/transport/noiseSpikeResponder/main.go:90-131` — the **reference responder flow** to port: ReadMessage(msg1) recovers the `hello` early-data → WriteMessage(hello_ack) → Split → transport decrypt/echo loop. **CAUTION:** the `recv, send := cs1, cs2` swap at `:107` is **flynn-specific** (flynn returns raw `(c1,c2)`); do **not** copy it — the fake daemon uses noise-c.wasm, which role-adjusts (see the Split note in Design).
- `src/main/transport/noiseSession.ts:78-183` — the initiator to **mirror as responder**: `HandshakeState(...)` construction, `Initialize(prologue, s, rs, psk)` signature, `WriteMessage`/`ReadMessage`/`Split` usage, the `const [send, recv] = hs.Split()` mapping at `:157` (the responder uses **the same** mapping), `freeAll()` teardown at `:102-113`, `EMPTY_AD` at `:26`, and the log-free / category-only error discipline. This is the closest structural template.
- `src/main/transport/noise-c.wasm.d.ts:18-54` — the `NoiseHandshakeState` / `NoiseCipherState` API. **Load-bearing:** `:47-51` documents `Split()` as returning `[send, recv]` **role-adjusted for BOTH roles** — confirmed against the installed 0.4.0 wrapper. Also `:25-30` (`Initialize` — `rs` may be `null`) and `:11-13` (AEAD open/seal, throws on MAC failure, object survives the throw).
- `src/main/transport/helloExchange.ts:51-113` — `buildClientHello` / `parseHelloAck`. The fake daemon builds `hello_ack` as the **inverse** of `parseHelloAck` (an `encodeEnvelope` of a `HelloAckPayload`); the AC5 test asserts the client-recovered ack via `parseHelloAck`. The test's client half builds `hello` via `buildClientHello`.
- `src/main/transport/codec.ts:79-138` and `:52-73` — `encodeInnerFrame`/`decodeInnerFrame` (the relay-frame layer), `encodeEnvelope`/`decodeEnvelope` (the Noise-plaintext layer), `base64StdEncode`/`base64StdDecode`. The daemon uses **these**, never hand-rolled framing (AC3).
- `src/main/transport/fakeRelayForwarder.ts:20-38` and `:59-82` — the #90 forwarder contract the daemon dials into: `startFakeRelayForwarder()` → `{ url, whenReady(), close() }`; legs identified by upgrade path `…/v1/server` (the fake daemon) vs `…/v1/client` (the client under test). `toBytes(data: RawData): Uint8Array` at `:59-69` — reuse this exact normaliser shape for the daemon's inbound.
- `src/main/transport/noiseSession.interop.test.ts:365-456` — the **live-path client wiring** the AC5 test mirrors: `createRelayConnection` + `createNoiseSession` + codec glue (`sendFrame` wraps raw Noise into `InnerFrameV2` tagged `noise_init`/`noise_msg`; the `message` handler `decodeInnerFrame` → `base64StdDecode` → `initiator.onFrame`). Point this at the in-process forwarder instead of the live relay. Also read `:18-21` (the Split-asymmetry note — note it describes the **flynn** responder) and `:224-229` (warm the wasm load in `beforeAll` to keep the log-free assertion clean).
- `src/main/transport/noiseRelayDriver.ts:183-192` and `:228-247` — confirms the outbound tag sequence (`noise_init` then `noise_msg`) **and** that the client does **not** branch on the inbound `type` field (`:232`) — so the daemon's reply `type` tag is not load-bearing.
- `src/main/transport/noiseLib.ts:42-71` — `loadNoiseLib({ timeoutMs })` (the one shared wasm loader) + `NoiseLoadError`. The daemon and the test's client share this single process-lived instance.
- `src/shared/wire/types.ts:11` and `:80-85` — `NOISE_PROTOCOL` (use **verbatim**, AC3) and the `HelloAckPayload` shape the daemon builds. Note: `src/main` **cannot** use the `@shared/*` alias — import via the relative path `../../shared/wire/types`, as `codec.ts` / `noiseSession.ts` do.
- `docs/specs/architecture/90-fake-relay-forwarder-test-helper.md` — the sibling forwarder spec: harness contract, the `start*` naming convention, and the content-blind leg-path routing.
- `docs/knowledge/features/fakerelay-harness.md` (QMD collection `pyrycode-docs`) — the Go sibling's fake-peer + round-trip harness **phasing** precedent (forwarder → fake peer → consuming test). Read for the structuring rationale only; do **not** port the Go surface.

## Context

`noiseSession.ts` is **initiator-only**. The one existing responder is the Go `flynn/noise` peer behind `noiseSession.interop.test.ts`, which needs the Go toolchain, is driven over stdio, and `describe.skipIf(!goAvailable)` skips it whenever `go` is absent — so it cannot back an **unconditional** `npm test` round-trip.

This ticket delivers the missing responder as an **in-process TypeScript fake daemon**: it completes the `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake as the responder, completes the HELLO exchange, decrypts one inbound message envelope, and streams back a reply while keeping the session open. It reaches the client under test through the reusable content-blind relay forwarder shipped by **#90** (merged). A self-verifying test then drives the real client initiator primitives (`createNoiseSession` + `createRelayConnection` + `codec`) through the forwarder against the fake daemon, proving one sealed round-trip decrypts to the expected payload.

The fake must mirror the real daemon **faithfully** — a lax fake gives false confidence. It uses the exact `NOISE_PROTOCOL` constant and the production `codec` envelope/HELLO/InnerFrameV2 framing, not a hand-rolled shortcut. Mobile's connection-layer bugs surfaced only under a real round-trip; this makes such a round-trip reproducible in CI.

## Design

### Placement & module shape

New **test-only** module: `src/main/transport/fakeDaemon.ts` — a plain `.ts` (not `.test.ts`) so the #89 round-trip consumer can import it, exactly as `fakeRelayForwarder.ts` (#90) is importable. It imports `ws`, Node built-ins, `./codec`, `./noiseLib`, and `../../shared/wire/types` (`NOISE_PROTOCOL`, `HelloAckPayload`, `MAX_FRAME_BYTES`). Unlike the forwarder — which is content-blind and forbidden from importing `codec`/Noise — the fake daemon **is** the content-aware peer, so those imports are correct and required by AC3.

Co-located test: `src/main/transport/fakeDaemon.test.ts` (holds the AC5 self-verifying round-trip).

### Public surface (contract, not implementation)

```ts
export interface FakeDaemonOptions {
  /** Base forwarder URL, no trailing path (from startFakeRelayForwarder().url).
   *  The daemon dials `${url}/v1/server`. */
  url: string
  /** Reply builder: given the decrypted inbound plaintext, return the reply plaintext
   *  to seal + stream back. Default: echo the inbound plaintext verbatim. */
  buildReply?: (inboundPlaintext: Uint8Array) => Uint8Array
  /** hello_ack payload fields the client's parseHelloAck requires. Defaults supplied
   *  (protocolVersion 'v2', serverId 'fake-daemon', connId 'conn-1', capabilities []). */
  helloAck?: Partial<HelloAckPayload-ish>
  /** Forwarded to loadNoiseLib as its load deadline; omit for the loader default. */
  loadTimeoutMs?: number
}

export interface FakeDaemon {
  /** Responder static X25519 public key (32B). The client uses this as its
   *  remoteStaticPublicKey — this is the QR-known server static the real client pins. */
  staticPublicKey: Uint8Array
  /** Resolves once the responder has completed the handshake and streamed one reply
   *  (ok:true), or hit a daemon-side failure (ok:false + static reason). Never rejects.
   *  close() before completion resolves it { ok:false, reason:'closed' }. Cached. */
  whenSettled(): Promise<FakeDaemonOutcome>
  /** Tear down the WS leg + free wasm handshake/cipher state. Idempotent. */
  close(): Promise<void>
}

export type FakeDaemonOutcome = { ok: true } | { ok: false; reason: FakeDaemonErrorReason }

/** Closed set of static reasons — NEVER carries key/token/frame/plaintext bytes. */
export type FakeDaemonErrorReason =
  | 'frame-decode-failed'      // decodeInnerFrame/base64StdDecode threw at the leg boundary
  | 'handshake-read-failed'    // msg1 ReadMessage MAC-failed / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // an inbound transport frame failed to open
  | 'closed'                   // close() ran before the round-trip completed

/** Stand up the fake daemon: load wasm, generate a responder static keypair, dial the
 *  server leg, arm the responder. Resolves once the leg is OPEN and armed. Rejects with
 *  NoiseLoadError only if the shared wasm load fails/times out (no handle exists yet). */
export function startFakeDaemon(options: FakeDaemonOptions): Promise<FakeDaemon>
```

(The `helloAck` option is `Partial<{ protocolVersion; serverId; connId; capabilities }>` mapped onto a `HelloAckPayload`; the shorthand above is a sketch, not the literal type.)

`whenSettled()` exists so a daemon-side failure surfaces as a crisp `{ ok:false, reason }` instead of a mysterious client-side timeout — a diagnostic aid, not the primary oracle (the round-trip assertion is). It mirrors the Go interop responder's `ERR <reason>` line and the codebase's sealed-union discipline.

### Responder flow — state machine

Three states: `awaiting-msg1` → `awaiting-transport` → `serving` (session stays open; `closed` is terminal). Driven entirely by the leg's `message` events; keys/wasm never leave this module (main-process only).

**On every inbound leg `message`** (relay frames arrive as WS **text** frames — the client sends `encodeInnerFrame(...)`, a JSON string):

0. **Inert after close.** If `state === 'closed'`, return immediately — never touch a freed wasm object (mirrors `noiseSession.ts:136`). A garbage frame can arrive after `close()` has run `freeAll()`; this guard is the use-after-free defence.

1. Normalise `RawData → Uint8Array` (reuse `toBytes` shape). Then `raw = base64StdDecode(decodeInnerFrame(bytes).data)` → raw Noise bytes. On any throw → settle `{ ok:false, reason:'frame-decode-failed' }`, close. Fail-closed, category-only, the caught object dropped (its message could echo transcript bytes). The inner `type` field is **not** branched on — the Noise state machine + AEAD decide interpretation (mirrors `noiseRelayDriver.ts:232`), so a hostile `type` cannot misroute.

2. `awaiting-msg1`: `hs.ReadMessage(raw, true)` recovers the client `hello` early-data (and the client static, per IK). Optionally `decodeEnvelope(hello)` to confirm it is a well-formed `hello` envelope (faithful; non-blocking — see Open Questions). Build the ack: `encodeEnvelope({ id, type:'hello_ack', ts, payload: helloAckPayload })`. `msg2 = hs.WriteMessage(helloAckBytes)`. `const [send, recv] = hs.Split()` (see Split note) → `sendCipher = send`, `recvCipher = recv`. Frame + send `msg2` (see framing). → `awaiting-transport`. On any throw (wrong hash suite, wrong responder static → the encrypted static/payload MAC-fails here): the library auto-freed `hs`; null it, settle `{ ok:false, reason:'handshake-read-failed' }`, close.

3. `awaiting-transport` / `serving`: `plaintext = recvCipher.DecryptWithAd(EMPTY_AD, raw)`. On throw → settle `{ ok:false, reason:'transport-decrypt-failed' }` (cipher survives; non-terminal, but for this single-round-trip fake we settle-and-stay-open). Else `reply = options.buildReply?.(plaintext) ?? plaintext` (default echo); `ct = sendCipher.EncryptWithAd(EMPTY_AD, reply)`; frame + send. On the **first** reply, settle `{ ok:true }`. **Keep the session open** (AC2) — subsequent transport frames continue to decrypt+reply; `whenSettled` stays resolved at its first value (cached).

### Split() send/recv mapping — the load-bearing detail (AC4)

**Recommendation: the responder uses the SAME mapping as the initiator** — `const [send, recv] = hs.Split(); sendCipher = send; recvCipher = recv`.

Rationale: `noise-c.wasm` returns the two transport ciphers **already role-adjusted as `[send, recv]` for BOTH roles** (`noise-c.wasm.d.ts:47-51`, confirmed against the 0.4.0 wrapper; the underlying noise-c C API `noise_handshakestate_split(state, **send, **recv)` fills `send`/`recv` per the role the `HandshakeState` was constructed with — here `NOISE_ROLE_RESPONDER`). So the responder's `Split()[0]` is already its **send** cipher (responder→initiator, c2) and `[1]` its **recv** (initiator→responder, c1). No swap.

**Why the ticket's "responder maps the opposite way" note does not apply here.** That note (and `main.go:107`'s `recv, send := cs1, cs2`) describes the **flynn/noise Go** responder, which returns the **raw** `(c1, c2)` pair and forces the caller to map `recv=c1, send=c2` by hand. The interop test paired a noise-c **initiator** (no swap) with a flynn **responder** (manual swap) — each side swaps at most once. This ticket pairs a noise-c initiator with a **noise-c** responder; both role-adjust internally, so **neither** swaps. Copying the flynn swap would double-adjust and invert the responder's ciphers.

**Deterministic oracle (belt-and-suspenders).** Do not trust this reasoning blindly — pin it with the test, which is deterministic where the reasoning is stochastic. Per CLAUDE.md test-first, write the round-trip test **first**. A crossed mapping completes the handshake (msg2 reads fine — the handshake hash matches) but **MAC-fails the first transport frame**: the client emits `transport-decrypt-failed` and never a `message`, so the round-trip assertion fails hard. If that happens, the mapping is inverted — swap to `sendCipher = recv; recvCipher = send` and re-run. Confirm against `node_modules/noise-c.wasm/src/index.js`'s `Split()` once `npm install` has populated `node_modules` (absent in the architect worktree, so this was not verifiable at spec time — the test is the authority). **This round-trip decrypting-not-MAC-failing IS AC4's coverage.**

### Framing fidelity (AC3)

- **Inbound:** the client writes `InnerFrameV2` as WS **text** frames (`encodeInnerFrame` returns a string → `relayConnection.send` → `ws.send(string)`; `relayConnection.ts:207-212`). The forwarder preserves the opcode. The daemon receives text, normalises to bytes, `decodeInnerFrame`.
- **Outbound:** the daemon sends `leg.send(encodeInnerFrame({ v:2, type:'noise_msg', data: base64StdEncode(raw) }))` — a string → text opcode, mirroring the client. `noise_msg` for both msg2 and transport replies is faithful and safe: the client does not branch on the inbound `type` (`noiseRelayDriver.ts:232`). Use `encodeInnerFrame`/`base64StdEncode` verbatim — never a hand-rolled JSON string.

### wasm + keys

- `const lib = await loadNoiseLib({ timeoutMs: options.loadTimeoutMs })` — the one shared instance.
- `const [staticPriv, staticPub] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)` — a **fresh, synthetic, in-process** responder static; `staticPub` is the handle's `staticPublicKey`. (This is the "QR-known server static" the client pins as `remoteStaticPublicKey`.)
- `hs = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_RESPONDER)`.
- `hs.Initialize(prologue.length ? prologue : null, staticPriv, null, null)` — responder passes `s = staticPriv`, `rs = null` (IK recovers the initiator static from msg1). Empty prologue → `null`, matching the daemon (noise-c treats zero-length prologue as "unset"). The prologue is fixed empty here (the client's default is empty); no need to expose it as an option.

## State + concurrency model

- **No React, no store, no IPC.** Pure Node/`ws`/wasm test infrastructure under `src/main`. Keys, cipher states, and plaintext never leave this module — they never reach the renderer (CLAUDE.md "keep the transport out of the window"). This is the fake **daemon** side, but the same discipline applies.
- **State:** one leg `WebSocket | null`, `hs / sendCipher / recvCipher` (nulled as consumed), a small `state` enum, one settle deferred (`FakeDaemonOutcome`), a `closed` boolean.
- **Concurrency:** event-driven via `ws` (`open`, `message`, `error`, `close`). Dial with `new WebSocket(`${url}/v1/server`, { maxPayload: MAX_FRAME_BYTES })` — bound inbound frames to the same cap the production `relayConnection` uses, so an oversized frame can't grow memory (defensive hygiene; on loopback the peer is the test, but this mirrors the real client). Attach the `message` handler **synchronously** right after `new WebSocket(...)` so no inbound frame is missed. No polling loop, no timers of its own (the wasm load deadline is the loader's). The factory resolves once wasm is loaded, the keypair generated, `hs` initialised, and the leg has fired `open` with handlers armed — so the client's msg1 (which the test only sends after `forwarder.whenReady()`) is never dropped.
- **Teardown:** `close()` guarded by `closed`. First call: mark closed; if `whenSettled` still pending, resolve `{ ok:false, reason:'closed' }`; `freeAll()` the wasm objects (each `free()` guarded — idempotent, never throws, mirrors `noiseSession.ts:102-113`); `leg.terminate()`; resolve. Second call returns the same promise. A leg `close`/`error` event also drives teardown (settle `closed` if still pending), so a dropped leg never hangs an awaiter.

## Error handling

| Failure mode | Behaviour |
|---|---|
| Malformed `InnerFrameV2` / bad base64 at the leg boundary | Fail-closed: settle `{ ok:false, 'frame-decode-failed' }`, drop the caught object (no bytes), close. |
| msg1 MAC-fails (wrong hash suite, wrong responder static) | `hs` auto-freed by the library; null it, settle `{ ok:false, 'handshake-read-failed' }`, close. |
| Inbound transport frame fails to open | settle `{ ok:false, 'transport-decrypt-failed' }`; cipher survives (non-terminal). |
| wasm load fails / times out | `startFakeDaemon` **rejects** with `NoiseLoadError` — the only surface with no handle yet, so a rejection is the correct async shape (mirrors `createNoiseSession`). |
| Leg drops mid-handshake / `close()` before completion | Pending `whenSettled` resolves `{ ok:false, 'closed' }`; teardown proceeds; idempotent. |

**Log-free by construction** (mirrors `noiseSession.ts` / `noiseLib.ts` / `codec.ts`): no `console.*`; no key/token/frame/plaintext bytes in any diagnostic. Every caught wasm/codec error is classified to one of the static `FakeDaemonErrorReason` values and the caught object **dropped** — a library error string can echo transcript bytes. All observable behaviour is via the handle and the spliced frames.

## Testing strategy

`fakeDaemon.test.ts`, vitest, real timers (sub-second on loopback), a `cleanups`/`afterEach` teardown array (mirrors the interop test). Warm the wasm load once in `beforeAll` (`await loadNoiseLib()`) so the Emscripten first-load warning doesn't pollute the log-free assertion. Scenarios as bullets — the developer writes them in the project idiom:

- **Self-verifying round-trip (AC1, AC2, AC3, AC4, AC5, AC6) — the core.** Stand up `startFakeRelayForwarder()` → `startFakeDaemon({ url })`. Build the client half by mirroring `noiseSession.interop.test.ts:388-447`: `createRelayConnection({ url: `${forwarder.url}/v1/client`, headers: <minimal dummy>, onEvent })` (on `connected` → `initiator.start()`; on `message` → `decodeInnerFrame` → `base64StdDecode` → `initiator.onFrame`), and `createNoiseSession({ staticPrivateKey: <fresh client static>, remoteStaticPublicKey: daemon.staticPublicKey, prologue: EMPTY, hello: buildClientHello({...synthetic, dummy token}), sendFrame: raw => relay.send(encodeInnerFrame({ v:2, type: firstOut?'noise_init':'noise_msg', data: base64StdEncode(raw) })), onEvent })`. `await forwarder.whenReady()`. Then assert, in order:
  - Client emits `handshake-complete`; `parseHelloAck(event.helloAck)` deep-equals the daemon's hello_ack payload (`protocol_version:'v2'`, `server_id`, `conn_id`, `capabilities:[]`). ← proves msg2 read + AC3 hello_ack build.
  - `initiator.sendMessage(encodeEnvelope(<a send_message envelope>))`; client emits `message`; `decodeEnvelope(event.plaintext)` (or raw bytes for the echo default) equals the expected reply. ← proves the AEAD round-trip + **AC4** (a crossed Split MAC-fails here).
  - Client emits **no** `error` (esp. no `transport-decrypt-failed`); `(await daemon.whenSettled()).ok === true`.
  - Runs with no Go toolchain and only loopback `ws` (AC6) — implicit; assert the forwarder `url` matches `ws://127.0.0.1:<port>` if a positive assertion is wanted.
- **Log-free across handshake + transport + error path (security).** Spy on all `console.*`. Drive a full round-trip, then feed the daemon a garbage frame (or the client an error path); assert `console` was never called and the daemon settled a static `{ ok:false }` reason. Mirrors `noiseSession.interop.test.ts:345-362`.
- **Fail-closed at the leg boundary (error handling).** Dial a raw `ws` to `${forwarder.url}/v1/client` and send a non-`InnerFrameV2` text frame (e.g. `"{not json"`); assert `daemon.whenSettled()` resolves `{ ok:false, reason:'frame-decode-failed' }` and nothing throws/logs. (A raw client keeps this test at the byte level without a full Noise initiator.)
- **Teardown idempotent.** After a completed round-trip, `daemon.close()` twice → both resolve, no throw; a still-pending `whenSettled` (in a variant that closes before completion) resolves `{ ok:false, 'closed' }`.

Type coverage rides `npm run typecheck` (the `FakeDaemon`/`FakeDaemonOptions` surface is exercised by the test). `npm run build` is the salvage/QA gate.

## Open questions

- **Reply shape: echo vs canned envelope.** Recommended default: **echo** the decrypted inbound plaintext (simplest deterministic contract; matches the Go interop responder and makes the assertion trivial). `buildReply` lets a caller inject a canned `message` envelope for a more daemon-faithful reply. A real daemon would answer a `send_message` with a `message`/`ack` envelope, not a byte-echo — but echo is sufficient for the crypto round-trip proof this ticket needs, and #89 can pass a `buildReply` if it wants richer behaviour.
- **Parse the client `hello`?** Recommended: yes — `decodeEnvelope(hello)` after ReadMessage to confirm a well-formed `hello` envelope (faithful to the real daemon, and gives AC3 more teeth). Non-blocking: a malformed hello would already be an anomaly; if the developer omits it, the round-trip still proves the handshake.
- **Split mapping direction** — primary recommendation and the deterministic test oracle are both specified above. If `npm install`'d source contradicts the recommendation, the test is the authority; flip and re-run.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The single explicit untrusted→trusted boundary is the leg `message` handler: `base64StdDecode(decodeInnerFrame(bytes).data)`, fail-closed to `frame-decode-failed`, caught object dropped, `type` field not branched on (mirrors `noiseRelayDriver.onMessage`). No scattered parsing. This is test-only infra, so the "untrusted" peer is the test's own client; the fail-closed handling turns a buggy/hostile frame into a crisp static reason rather than a throw/hang.
- **[Tokens/secrets]** No MUST FIX. The responder static keypair is generated in-process via `lib.CreateKeyPair(NOISE_DH_CURVE25519)` (noise-c CSPRNG, not `Math.random()`), held in module memory only, freed on `close()`, never written to disk or exposed to a renderer (there is none). **SHOULD FIX (encoded in Testing):** the AC5 test MUST use a **synthetic dummy token** in its `hello` and **fresh in-process** keypairs — never the `PYRY_LIVE_*` credentials the interop test's operator-gated path reads. No rotation/revocation/expiry — N/A for ephemeral per-run test keys.
- **[File / storage]** No findings — N/A. The design performs **zero** filesystem I/O: no path construction, no temp files, no reads/writes. (Unlike the Go interop responder, which built a binary in a tmpdir; this is pure in-process.)
- **[Electron attack surface]** No findings — N/A, but one **design invariant to enforce:** the module introduces no `BrowserWindow`, IPC, `contextBridge`, custom-protocol, or navigation surface, and **must never be imported into the production graph** (`src/main/index.ts`, `src/preload`, `src/renderer`). It is test-only, imported solely by `*.test.ts` and (later) the #89 consumer. Importing it into production would ship a second Noise static-key holder and a permissive `ws://` dialer. Enforceable by the module's test-only header comment + code-review of its import sites (mirrors how `fakeRelayForwarder.ts` stays test-only).
- **[Cryptographic primitives]** No MUST FIX. The `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake, key schedule, and ChaChaPoly AEAD all come from the vetted `noise-c.wasm` via the shared `loadNoiseLib` — **no hand-rolled crypto** (AC3's whole point). `NOISE_PROTOCOL` reused verbatim. Send/recv are distinct per-direction CipherStates from `Split()`; a fresh keypair + handshake per `startFakeDaemon` means no cross-session key/nonce reuse. **Adversarial note (the security rationale for AC4):** a *crossed* Split mapping is not merely a functional bug — the responder would encrypt under the same key + nonce-0 the initiator uses for its own outbound, a catastrophic `(key, nonce)`-reuse class error. This is exactly why AC4 pins the mapping with a **deterministic** round-trip test (a crossed mapping MAC-fails the first transport frame), not with a stochastic assertion — belt-and-suspenders with a deterministic net. No secret comparison in-module (`===` on tokens/MACs); AEAD MAC verification is inside the library. 
- **[Network & I/O]** No MUST FIX. **SHOULD FIX (encoded in Design):** the daemon leg dials with `maxPayload: MAX_FRAME_BYTES`, bounding inbound frame size like the production client. `ws://` (not `wss://`) is **justified**: this is in-process loopback (`ws://127.0.0.1:<ephemeral>`) test infra dialing a URL the harness itself minted — the production `wss://`-only rule targets remote relays and does not apply. No untrusted/QR URL, no reconnect loop (single-shot → no token-exhaustion spin). Liveness is bounded by the forwarder's `whenReady` timeout + vitest's global timeout; no dedicated idle timer needed for loopback test infra.
- **[Error messages / logs]** No findings — log-free by construction (no `console.*`), category-only `FakeDaemonErrorReason` values, every caught wasm/codec object dropped (a library error string can echo transcript bytes). No telemetry, no renderer console. Exercised by the log-free test.
- **[Concurrency]** No MUST FIX. Single leg + wasm objects owned by the handle, freed idempotently on `close()`; leg `close`/`error` also drives teardown so a dropped leg never hangs an awaiter; settle deferred resolves once (cached). No self-owned timers, no `AbortController` needed (`terminate()` cancels the dial). **Addressed in Design (was a latent use-after-free):** the `message` handler returns early when `state === 'closed'`, so a frame arriving after `freeAll()` never calls a freed wasm object (mirrors `noiseSession.ts:136`). No cross-`await` shared-state race (the async gap is `startFakeDaemon` before the handle exists, during which the test hasn't sent yet).
- **[Threat model alignment]** No MUST FIX. This harness *strengthens* the security posture: it lets the client's production defensive parsing (`parseHelloAck`, `decodeEnvelope`, `decodeInnerFrame` — all fail-closed) be exercised against a real Noise peer in CI, which is where mobile's connection-layer bugs hid. It weakens no production boundary. Hostile-relay resilience: the daemon fail-closes on malformed frames without throwing/hanging. Renderer-compromise and token-theft-from-disk threats are N/A (no renderer, no disk). The one real risk — the module leaking into production — is named as the Electron-surface design invariant above.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
