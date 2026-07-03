# Spec #29 — Noise spike (1/2): select a JS Noise library and prove `Noise_IK_25519_ChaChaPoly_BLAKE2s` conformance

**Type:** de-risking spike (throwaway harness + conformance tests + library-selection findings). Not the production session module (#7). No Go, no live credential, no renderer, no relay socket — those are #30.

## Files to read first

The developer's turn-1 reading list. Load these before writing any code.

- `src/main/transport/relayConnection.ts:57-76` — `RelayEvent` union + `RelayConnection.send`. **This is the pipe the harness mirrors:** raw `Uint8Array` frames go out through a `send`-shaped sink, inbound frames arrive as `{ type: 'message'; frame }`. Shaping the harness the same way is what lets #30 swap the JS↔JS loopback for the real transport with zero change to the initiator.
- `src/main/transport/relayConnection.ts:1-17` — the **"LOG-FREE by construction"** header. The harness copies this posture verbatim: no `console.*`, no key/token/frame bytes in any diagnostic. Errors leave as typed events carrying a static reason string only.
- `src/main/transport/relayConnection.test.ts` — the vitest test shape for this area (loopback/fake-driven, no real socket). Mirror its structure for the harness tests; do not invent a new test idiom.
- `src/shared/wire/types.ts:11` — `NOISE_PROTOCOL = 'Noise_IK_25519_ChaChaPoly_BLAKE2s'`. Already defined; **pass this exact constant to the library as the protocol name.** Do not retype the string.
- `src/shared/wire/types.ts:65-92` — `HelloClientPayload` (has the `token` field) and `HelloAckPayload`. These are the shapes the mode-2 early-data bodies imitate so the harness carries a realistic `hello`/`hello_ack`.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md:22` — the load-bearing suite pin and the "**a mismatch fails the handshake silently**" property that is the entire reason this spike exists.
- `package.json` — confirm no Noise dependency exists yet; the spike adds exactly one (`noise-c.wasm`, see § Library selection).
- **Cross-repo, read-only (QMD `pyrycode-docs`):** `specs/architecture/433-noise-ik-wrapper.md` — the Go daemon's `internal/noise` IK contract (`flynn/noise`). It is the interop target #30 proves against. Extract: `hello` rides as the early-data payload of IK message 1, `hello_ack` as the payload of message 2 (raw bytes at the Noise layer — base64 lives one layer up); post-handshake transport uses **empty associated-data** and monotonic 64-bit counter nonces; `Split()` yields a `(send, recv)` cipher-state pair. The JS early-data payload path must line up with this.

## Context

The daemon speaks exactly `Noise_IK_25519_ChaChaPoly_BLAKE2s` — X25519 / ChaCha20-Poly1305 / **BLAKE2s**. A wrong hash fails the handshake silently. The sharp, unproven risk this ticket retires first: **most pure-JS Noise libraries hash with BLAKE2b or SHA-256, not BLAKE2s**, so a library can look correct, pass its own tests, and still be unusable here. Establishing which JS library genuinely drives IK under this suite — with the arbitrary early-data both IK messages carry — is the cheapest, highest-information step and gates all downstream Noise work (#30 interop, #7 production session module).

This spike is standalone and credential-free: it runs and passes on any machine with no paired credential and no daemon. It proves conformance two ways (published-vector known-answer test + JS↔JS early-data round-trip) and records the library-selection half of a findings note. It **defers** the Go↔JS real-stack interop, the live-daemon round-trip, the mismatch-fails-silently negative, and the final recommend/reject verdict to **#30**.

## Library selection

### Primary candidate: `noise-c.wasm`

`noise-c.wasm` is an Emscripten/WASM build of **`noise-c`**, Rhys Weatherley's reference C implementation of the Noise Protocol Framework. Rationale:

- **It implements the full suite matrix, BLAKE2s included.** `noise-c` supports every standard pattern (IK), DH (25519), cipher (ChaChaPoly), and hash — **BLAKE2s specifically**, alongside BLAKE2b / SHA-256 / SHA-512. The protocol is selected by the exact name string `Noise_IK_25519_ChaChaPoly_BLAKE2s`, so there is no room for a silent BLAKE2b substitution.
- **Vetted, not hand-rolled.** The cryptography is the reference C library; the wasm wrapper is a thin binding. Hand-rolling any part of the handshake or the primitives is out of scope (a security defect, not a spike shortcut) — this satisfies the "vetted implementation" constraint.
- **Runs in the Electron main process (Node/WASM).** No DOM, no renderer. This matches CLAUDE.md ("keep the transport out of the window") and is itself a note for #7. The WASM binary is embedded in the JS (base64), so it loads in a plain Node/vitest process with no bundler asset plumbing — good enough for a spike whose only execution path in #29 is the vitest test run.
- **Early-data is native to the API.** `WriteMessage(payload)` carries the payload as the handshake message's early-data; `ReadMessage(message)` returns the peer's early-data. This is exactly the mechanism the daemon (#433) uses to piggyback `hello`/`hello_ack`.

### Rejected candidates (the trap this ticket names)

- **`noise-protocol`** (pure JS) — hashes with **BLAKE2b / SHA-256** only; no BLAKE2s. Looks correct, passes its own tests, unusable here.
- **`noise-handshake`** (pure JS, sodium-native) — **BLAKE2b**; wrong hash.
- **`@chainsafe/libp2p-noise`** — **SHA-256** and the **XX** pattern; wrong hash *and* wrong pattern.
- **Assembling IK from `@noble/hashes` (blake2s) + `@noble/curves` (x25519) + a ChaChaPoly package** — this is hand-rolling the handshake state machine and key schedule. Explicitly out of scope; a security defect.

### Selection contract for the developer (this is a spike — confirm empirically, don't trust this doc)

The architect nominates the leading candidate; the harness is the proof. On turn 1, after `npm install noise-c.wasm`:

1. **Confirm the API surface** against the installed package's README / exports. The expected shape (verify, adjust names if the installed version differs):
   - `require('noise-c.wasm')(cb)` — async init; `cb(lib)` once the wasm is ready. Wrap once as a memoized `loadNoiseLib(): Promise<NoiseLib>`.
   - `lib.HandshakeState(protocolName, role)` where `role ∈ { lib.constants.NOISE_ROLE_INITIATOR, ..._RESPONDER }`.
   - `hs.Initialize(prologue, localStaticPriv, remoteStaticPub, psk)` — 32-byte `Uint8Array`s or `null`; the library derives the local static public from the private.
   - Drive by `hs.GetAction()` → `WriteMessage(payload) | ReadMessage(message) | Split()`.
   - `hs.Split()` → `[send, recv]` cipher states, each with `EncryptWithAd(ad, plaintext)` / `DecryptWithAd(ad, ciphertext)`. Empty AD = a zero-length `Uint8Array`.
2. **Gate:** the candidate passes iff it can (a) construct an IK initiator and responder under the exact protocol name, (b) carry early-data on both handshake messages, and (c) support the two conformance proofs below. If `noise-c.wasm` cannot be installed or cannot construct the suite, record that and the finding becomes **"no clean vetted JS BLAKE2s-IK option exists"** — a valid spike outcome that reshapes #7/#30 (they would bridge to a native/Go implementation rather than a JS one). Do not silently substitute a wrong-hash library to make tests pass.

## Design

### Placement and files

Throwaway spike code, transport-adjacent, under `src/main/transport/` (per the wire/transport home convention). Nothing here is imported by app wiring in #29; #30 is the first consumer.

- `src/main/transport/noiseSpike.ts` — the initiator harness + the memoized `loadNoiseLib`. The one production source file.
- `src/main/transport/noise-c.wasm.d.ts` — minimal ambient `declare module 'noise-c.wasm'` (the package ships no types). Declare only the surface the harness uses.
- `src/main/transport/noiseSpike.test.ts` — both conformance modes; the responder test helper lives inline here (it is not production — #30 replaces it with the real daemon).
- `src/main/transport/noiseSpike.vectors.json` — the published test-vector fixture (see § Testing, mode 1). A data fixture, provenance-tagged in a header field; not code.

### Harness contract (the deliverable)

Mirror `createRelayConnection`'s send-out / event-in shape so #30 drops the real transport in unchanged. Contract sketch (signatures + behaviour — not the implementation):

```ts
export interface NoiseInitiatorConfig {
  staticPrivateKey: Uint8Array        // client static X25519 priv (32B); IK transmits client static in msg 1
  remoteStaticPublicKey: Uint8Array   // daemon static X25519 pub (32B); known to the IK initiator (QR in prod)
  prologue: Uint8Array                // zero-length to match the daemon; kept explicit + configurable
  hello: Uint8Array                   // early-data for msg 1 — a hello-shaped body carrying the device token
  sendFrame: (frame: Uint8Array) => void   // outbound raw-frame sink; in #30 this is relay.send
  onEvent: (event: NoiseInitiatorEvent) => void
}

export type NoiseInitiatorEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array }  // peer early-data recovered from msg 2
  | { type: 'message'; plaintext: Uint8Array }            // decrypted post-handshake frame
  | { type: 'error'; reason: NoiseInitiatorErrorReason }  // static reason only — never bytes

export type NoiseInitiatorErrorReason =
  | 'handshake-read-failed'     // msg 2 failed MAC / malformed / wrong suite
  | 'transport-decrypt-failed'  // post-handshake frame failed to open
  | 'unexpected-frame'          // frame arrived in the wrong state

export interface NoiseInitiator {
  start(): void                          // write msg 1 (carrying hello) → sendFrame. Call exactly once.
  onFrame(frame: Uint8Array): void       // feed one inbound frame: drive msg-2 read, then transport decrypt
  sendMessage(plaintext: Uint8Array): void  // post-handshake: seal one plaintext → sendFrame
  close(): void                          // free wasm handshake + cipher states; idempotent
}

export function createNoiseInitiator(config: NoiseInitiatorConfig): Promise<NoiseInitiator>
```

Behaviour notes:

- The factory is **async** (it awaits `loadNoiseLib`), constructs and `Initialize`s the IK handshake state, and returns the handle **without sending anything**.
- Sending is a separate `start()` — deliberately **not** on the constructor. `createRelayConnection` dials on construction because its inbound can't arrive before the sync constructor returns; here the JS↔JS loopback is synchronous, so a send inside the async factory would race the peer's wiring. Explicit `start()` removes that hazard. In #30 the mapping is trivial: relay `{type:'connected'}` → `start()`, relay `{type:'message',frame}` → `onFrame(frame)`, harness `sendFrame` = `relay.send`.
- `onFrame` is the two-state machine: **awaiting-msg-2** → `ReadMessage` recovers `helloAck`, then `Split()` into `(send, recv)` cipher states, emit `handshake-complete`; **transport** → `DecryptWithAd(emptyAd, frame)`, emit `message`. A frame in the wrong state or a decrypt failure emits an `error` event with the matching static reason — no throw across the sink, matching #21's "onEvent must not throw" discipline.

### Responder test helper (test-only, in `noiseSpike.test.ts`)

A minimal IK responder used only to close the JS↔JS loop; #30 replaces it with the real daemon. Same send-out/frame-in shape. It: reads msg 1 (recovers the initiator's `hello` early-data and surfaces it for assertion), writes msg 2 carrying a `hello_ack`-shaped early-data, `Split()`s into its own `(send, recv)`, then decrypts inbound / encrypts outbound transport frames. Keep it in the test file — it is not a production module and must not inflate the production surface.

### WASM lifecycle

`loadNoiseLib()` memoizes a single `Promise<NoiseLib>` at module scope so the initiator and the responder share one wasm instance (closer to #7's single-instance model, and avoids double-init in the test). `close()` frees the per-handshake and per-cipher-state wasm objects; the shared lib is process-lived and not freed by the spike.

## State + concurrency model

- **No store, no async iterables, no timers.** This is a request/response state machine driven synchronously by `start()` / `onFrame` after the one-time async wasm load. All wasm calls (`WriteMessage`, `ReadMessage`, `Split`, `EncryptWithAd`, `DecryptWithAd`) are synchronous.
- **Single owner per handle.** Each `NoiseInitiator` (and the test responder) owns its own handshake state and cipher-state pair; no sharing across handles, no goroutine/worker concurrency.
- **Nonce discipline is the library's.** The counter nonces live inside the cipher states returned by `Split()`; the harness never constructs or reuses a nonce. This is the same posture as the Go wrapper (#433): the wrapper owns ordering, the library owns the counter.
- **Teardown.** `close()` is idempotent and frees the per-handshake and per-cipher-state wasm objects. **After `close()`, `onFrame`/`sendMessage`/`start` are inert** (no-op or an `unexpected-frame` error event) and must never call into a freed wasm object — a use-after-free in the wasm heap is a real crash/corruption vector. Because there is no socket, timer, or listener in #29, there is nothing else to cancel; #30 adds the real transport's lifecycle around it.

## Error handling

| Layer | Failure | Surfaced as |
|---|---|---|
| wasm load | `loadNoiseLib` rejects (package missing / init failure) | the `createNoiseInitiator` promise rejects; the caller (test) sees it. Message names the phase only, never bytes. |
| handshake read (msg 2) | MAC failure / malformed / wrong-suite peer | `onEvent({ type:'error', reason:'handshake-read-failed' })`; no `handshake-complete` follows. |
| transport decrypt | tag failure / out-of-order / counter mismatch | `onEvent({ type:'error', reason:'transport-decrypt-failed' })`. |
| state misuse | frame before `start()`, or after error | `onEvent({ type:'error', reason:'unexpected-frame' })`. |

No error path embeds key material, the token, or frame/plaintext bytes. Reasons are a closed set of static strings. **A caught wasm-library error is classified, not forwarded:** the harness maps it to the matching static reason and neither attaches nor logs the library's error object or message (a library error string can echo transcript bytes). Never `reason: e.message`. This is the security-relevant invariant (see § Security review) and mirrors `relayConnection.ts`'s classify-don't-echo error handling.

## Testing strategy

`npm test` (vitest), Node process, no socket, no credential, deterministic. Scenarios below are described as bullets — the developer writes the test code in the project's idiom (mirror `relayConnection.test.ts`).

### Mode 1 — published-vector known-answer test (proves **BLAKE2s specifically**)

This is the only standalone-#29 proof that the hash is BLAKE2s and not BLAKE2b/SHA-256. It uses the library **directly** (not the harness) as an IK **responder**, and it needs **no ephemeral injection**: message 1 is initiator→responder, so the responder consumes it with only its own fixed static key — the initiator's ephemeral is embedded in the vector's message bytes and consumed on read.

- Load `noiseSpike.vectors.json`: a published `Noise_IK_25519_ChaChaPoly_BLAKE2s` vector with (at least) `init_prologue`, `resp_static` (private), `messages[0].payload`, `messages[0].ciphertext`, all as hex/base64 per the source format.
- `hs = lib.HandshakeState(vector.protocol_name, NOISE_ROLE_RESPONDER)`; `hs.Initialize(prologue, respStaticPriv, null, null)` (IK responder does not pre-know the initiator static — `rs = null`).
- Assert `hs.GetAction()` is READ_MESSAGE, then `payload = hs.ReadMessage(messages[0].ciphertext)` — must not throw.
- **Assert `payload` bytes are byte-for-byte equal to `messages[0].payload`.** A BLAKE2b/SHA-256 implementation diverges in the `h` chain and the `es`/`ss` key schedule and **fails msg-1 tag verification** — so a clean, correct decrypt of a BLAKE2s-generated vector *is* the proof of BLAKE2s.
- If the library exposes a handshake-hash accessor, additionally assert it equals the vector's `handshake_hash`; if not exposed, skip (not required — the payload match already pins the schedule).

**Vector provenance (the one real logistics risk — see Open questions).** The vector must be a *published* corpus entry (self-generated vectors prove nothing about hash correctness). Source, in priority order: (a) a vector bundled in an installed package's test fixtures under `node_modules` for the exact suite; (b) a committed fixture the developer vendors from the canonical Noise corpus (cacophony / snow / noise-c), with a provenance header (source + retrieval note) in the JSON — this is a provenance-tagged test fixture, not hand-rolled crypto. Never fabricate vector bytes.

### Mode 2 — JS↔JS early-data round-trip + post-handshake AEAD (proves the state machine + early-data path compose)

This does **not** prove BLAKE2s specifically (both sides use the same library, so a wrong hash would still agree with itself) — that is mode 1's job. It proves the harness drives a full IK handshake carrying real early-data and then seals traffic both ways.

- Generate a fresh responder static keypair and a fresh initiator static keypair (`lib.CreateKeyPair(CURVE25519)`).
- `hello` = UTF-8 bytes of a `HelloClientPayload`-shaped JSON object **with a dummy device token inside**; `helloAck` = bytes of a `HelloAckPayload`-shaped JSON object.
- Construct the responder helper (recovers `hello`, will reply with `helloAck`); `initiator = await createNoiseInitiator({ staticPrivateKey: initPriv, remoteStaticPublicKey: respPub, prologue: <empty>, hello, sendFrame: responder.onFrame, onEvent })`; wire `responder.sendFrame → initiator.onFrame`.
- `initiator.start()`.
- Assert the responder recovered `hello` byte-for-byte (the **token round-trips inside message 1**).
- Assert `onEvent` fired `handshake-complete` with `helloAck` byte-for-byte.
- `initiator.sendMessage(appOut)` → assert the responder decrypts to `appOut` (one post-handshake AEAD frame initiator→responder).
- `responder.sendMessage(replyOut)` → assert `onEvent` fired `message` with `replyOut` (one frame responder→initiator).
- `initiator.close()` / `responder.close()`.

### Log-free assertion (security)

- Add a test that drives a handshake and a transport exchange while the harness runs, and asserts the harness itself emits **no `console.*` output** (spy on `console`), reinforcing the "log-free by construction" contract. Keep it lightweight; the real guarantee is that `noiseSpike.ts` contains zero log calls.

## Findings deliverable

AC 4 wants the library-selection half of a findings note where #30 and #7 can read it. **Do not create a `docs/` file in this worktree** — per the architect operating rule, the developer's worktree mutates only code, tests, and the dependency manifest; durable knowledge docs are the documentation phase's to write (it authors `docs/knowledge/codebase/29.md` from this spec + the PR + the diff, and #30/#7 architects read `docs/knowledge/`). Deliver the findings as a **structured section in the PR description** (the documentation phase folds it in). Template the developer fills from the empirical run:

- **Selected library** + resolved version (from `package-lock.json`).
- **BLAKE2s support:** yes/no and how it was proven (mode-1 vector KAT result). If a wrong-hash candidate was hit first, record it and why it was rejected.
- **Handshake-role / prologue / early-data ergonomics:** how initiator vs responder is configured; how the prologue is passed; how early-data rides `WriteMessage`/`ReadMessage`; **how the device token rides the `hello`** in message 1.
- **Post-handshake AEAD:** `Split()` → `(send, recv)`, `EncryptWithAd`/`DecryptWithAd`, empty AD, library-owned counter nonces.
- **Runtime note for #7:** WASM in the Electron main process; the base64-embedded wasm loads in Node/vitest with no asset plumbing, but electron-vite **bundling** of the wasm for the packaged app is unproven here and is #7's concern.
- **Explicit deferral:** the Go↔JS interop verdict, the live-daemon round-trip, the mismatch-fails-silently negative, and the final recommend/reject go to **#30**.

## Open questions

- **Vector obtainability in the sandbox (the single binding risk).** Mode 1 needs a *published* `Noise_IK_25519_ChaChaPoly_BLAKE2s` vector, and the agent's web-fetch tools are denied in this environment. Primary path: find one bundled in `node_modules` after `npm install` (the library's or a dependency's test fixtures). If none is obtainable credential-free in the sandbox, that is a **finding**, not a blocker: record it, and note that the strict *cross-implementation* byte match then lands in #30 (the Go `flynn/noise` side generates reference bytes the JS side must match — a stronger proof than a static file). Do not weaken mode 1 into a self-generated "vector," which proves nothing about hash correctness.
- **Exact `noise-c.wasm` API names.** The method names in § Library selection are the expected shape; confirm against the installed package on turn 1 and adjust the `.d.ts` and call sites if the resolved version differs. This is normal spike work, not a spec gap.
- **CJS/ESM interop.** `noise-c.wasm` is CJS (`require`-style init). Resolve the import interop for the TS/vitest setup (default-import vs `createRequire`); a one-line concern, noted so it isn't a surprise.

## Out of scope (owned by #30 or later)

- **Go↔JS real-stack interop** (`flynn/noise` responder ↔ this JS initiator, byte-for-byte) — **#30**.
- **Live-daemon round-trip** over the real relay — **#30**.
- **Mismatch-fails-silently negative** (wrong suite / wrong key produces a silent failure) — **#30**.
- **Final recommend/reject verdict** on the library — **#30**.
- **Production Noise session module** (real key storage via `safeStorage`, electron-vite wasm bundling, re-key, transport wiring into the store) — **#7**.
- **The durable knowledge note** (`docs/knowledge/codebase/29.md`) — documentation phase, post-merge.

## Security review

**Verdict:** PASS

Adversarial re-read of this spec. The spike sits on the app's trust boundary (Noise handshake + a device token riding the `hello`), but it is credential-free, persistence-free, network-free, and renderer-free by construction — which collapses most categories to "N/A because the attack surface does not exist in #29" and pushes the real hardening to the named downstream tickets. No MUST FIX after the two design edits (classify-don't-forward library errors; no use-after-free past `close()`).

**Findings:**

- **[Trust boundaries]** No MUST FIX. In #29 the only inbound boundary is `onFrame`; every inbound byte is AEAD-verified by `ReadMessage`/`DecryptWithAd` before anything is emitted, so bytes that fail verification become a typed `error` event — never a plaintext leak or a crash. The harness does **no JSON parse** of recovered early-data/plaintext (bytes handed opaque to the consumer), so a malformed body cannot crash it; defensive parsing is #7/#30's. No harness-layer frame-size cap — delegated to the library's 65535-byte max-message (handshake) and to #21's `maxFrameBytes` on the real socket in #30.
- **[Tokens, secrets, credentials]** No MUST FIX. The token in mode 2 is a **dummy** fixture, never a real credential (AC: credential-free). No persistence in #29 → no at-rest storage decision here; production key/token storage via Electron `safeStorage` is **#7**, named as deferred. Secrets never reach logs or error strings (log-free contract + closed-set static reasons + the log-free assertion test). The `resp_static` private key in `noiseSpike.vectors.json` is a **published test-vector key** (non-secret by construction) — committing it is correct and must not be flagged as a leaked secret.
- **[File / storage operations]** No findings — the spike writes nothing and reads one fixed-path repo fixture; no untrusted input touches any path; no path traversal / TOCTOU / atomic-write concern.
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, IPC, `contextBridge`, custom protocol, or navigation. Main-process test code only; keys and handshake state never reach a renderer. This is the strongest process-placement posture and it is satisfied by construction.
- **[Cryptographic primitives]** No MUST FIX. Suite `Noise_IK_25519_ChaChaPoly_BLAKE2s` comes from the vetted `noise-c` reference implementation; the spec explicitly rejects hand-rolling the handshake, key schedule, AEAD, or an assemble-from-primitives approach. Nonces are the library's `Split()`-owned monotonic counters — the harness never resets or reuses a `(key, nonce)` pair. The only equality checks in the spike are **test assertions on non-secret round-trip data**; the security-relevant comparison (MAC verification) is the library's, constant-time. **RNG:** `CreateKeyPair` produces throwaway per-test keys, so the wasm keygen's RNG quality is not security-critical in #29 — but **verifying the wasm build's CSPRNG source is a #7 gate** (a production static key must come from a real CSPRNG); recorded here so #7 does not inherit it silently.
- **[Network & I/O]** No findings — no socket in #29. TLS / `wss://` enforcement, relay-URL validation, connect/idle timeouts, reconnect backoff, and the outer frame cap are #21/#22 (shipped) and #30 (live) concerns, not this spike's.
- **[Error messages, logs, telemetry]** No MUST FIX. Closed set of static reason strings; the caught wasm-library error object/message is classified and dropped, never forwarded or logged (spec § Error handling); `noiseSpike.ts` contains zero log calls and a test asserts no `console.*` output. No telemetry.
- **[Concurrency]** No MUST FIX. No timers, listeners, or long-lived async tasks → no `AbortController` needed; the only async is a memoized, idempotent one-shot wasm load shared safely across handles. `close()` is idempotent and, per the design edit, leaves the handle inert (no use-after-free into freed wasm). Synchronous state machine → no check-then-act race across an await.
- **[Threat model alignment]** Malicious relay (drop/flip/inject) — the verify-before-emit shape means a hostile relay yields a typed error in #30's drop-in, never a leak; the harness is already shaped for it. Hostile daemon response — opaque-bytes-to-consumer means it cannot crash the harness. Token-theft-from-disk and renderer-compromise-reaching-transport are **out of scope** for #29 (no disk, no renderer) and belong to **#7**; named so they are not lost. The Go↔JS interop, live-daemon round-trip, and mismatch-fails-silently negative are **#30**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
