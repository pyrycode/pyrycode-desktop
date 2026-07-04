# Spec — Noise session module (#7)

**Size:** S · **Kind:** production module (promotes the #29/#30 throwaway harness). **Security:** `security-sensitive` — Noise handshake, injected key material, transport AEAD. See § Security review (verdict: **PASS**).

This is a **promote-and-harden**, not a greenfield write. The proven `createNoiseInitiator` harness (`src/main/transport/noiseSpike.ts`, 199 lines, RECOMMEND per #30) becomes the production session module by **`git mv` + rename + one new behaviour (AC4)**. Do **not** hand-rewrite the 199 lines — carry them with `git mv` so the diff is the rename delta plus the load-surface hardening. A hand-copy would blow the turn budget and risk drift.

## Files to read first

- `src/main/transport/noiseSpike.ts:28-199` — **the harness this ticket promotes.** Extract the whole contract: `NoiseInitiatorConfig` (`staticPrivateKey`/`remoteStaticPublicKey` raw 32-byte X25519, `prologue`, `hello`, `sendFrame`, `onEvent`); the `NoiseInitiatorEvent` union (`handshake-complete{helloAck}` / `message{plaintext}` / `error{reason}`); the `NoiseInitiatorErrorReason` set; `start()`/`onFrame(frame)`/`sendMessage(plaintext)`/`close()`; the `freeAll()` / `InitiatorState` machine (idle → awaiting-handshake-reply → transport → closed); and the inline `loadNoiseLib()` at **74-85** (this MOVES to `noiseLib.ts` and gets hardened — do not leave a copy here).
- `src/main/noiseKeyPairGenerator.ts:1-42` — **the second, private `loadNoiseLib` copy** (#43), carrying the exact #29 hang gap. Its own comment (lines 14-16) earmarks the fold-in: *"#7 consolidates wasm loading and this folds into it."* Extract: the loader shape (identical to the spike's) and that `generate()` awaits it. #7 deletes this private copy and imports the shared `loadNoiseLib` from `./transport/noiseLib`.
- `src/main/deviceKeypair.ts` — the `KeyPairGenerator` / `DeviceKeyPair` interfaces `noiseKeyPairGenerator` implements, and how it's consumed. **Confirm the public API is unchanged by the fold-in** (only the internal loader swaps; `generate(): Promise<DeviceKeyPair>` signature holds), so this file needs no edit.
- `src/main/transport/noiseSpike.test.ts:1-120` — the test idiom that ports to `noiseSession.test.ts`: the `HELLO`/`HELLO_ACK` fixtures with a **dummy** token (31-44), the inline JS↔JS responder helper (46-120, `createNoiseResponder`), and — later in the file — the `beforeAll` wasm warm-up and the six-method `console`-spy log-free assertion. These carry over via `git mv`; re-point imports.
- `src/main/transport/noiseSpike.interop.test.ts:25-35` — #30's interop harness imports (`createNoiseInitiator`, `loadNoiseLib` from `./noiseSpike`). #7 re-points: `createNoiseSession` from `./noiseSession`, `loadNoiseLib` from `./noiseLib`. It skips gracefully without Go (`goAvailable` gate), so keeping it is free regression coverage.
- `src/main/transport/relayConnection.ts:78-95` — the `RelayNotConnectedError` named-error class and the **test-only `timing` override** (2nd param, default `{}`). Mirror both: a `NoiseLoadError` class and a `timeoutMs` override on `loadNoiseLib`.
- `src/main/transport/codec.ts:30-47` — the `WireDecodeError`/`WireEncodeError` **category-only** named-error pattern (message names the failure category, never raw values). `NoiseLoadError` follows the same discipline.
- `src/main/transport/noise-c.wasm.d.ts` — the ambient `NoiseLib` / `NoiseHandshakeState` / `NoiseCipherState` surface. The loader returns `Promise<NoiseLib>`; note `createNoise(cb)` has **no async error callback** (relevant to AC4's timeout design).
- `src/shared/wire/types.ts:11` — `NOISE_PROTOCOL` = `Noise_IK_25519_ChaChaPoly_BLAKE2s`. Reuse verbatim (imported by relative path — `@shared` alias is not wired for `src/main`); never retype it.
- `docs/knowledge/codebase/29.md` (§ *Deferred / carried forward* → the **NIT** on the async wasm-load hang) and `30.md` (§ verdict **RECOMMEND** + the proven interop contract). AC4 closes that NIT; the promotion inherits the interop contract unchanged.

## Context

The two Noise proving spikes are done: `noise-c.wasm@0.4.0` (an Emscripten build of the reference `rweather/noise-c`) drives `Noise_IK_25519_ChaChaPoly_BLAKE2s` with early-data (#29) and interoperates **byte-for-byte** with the daemon's real `flynn/noise` stack (#30, verdict **RECOMMEND**). There is no Go↔JS interop wall. This ticket promotes the throwaway `createNoiseInitiator` harness into the production session module: a **pure crypto unit** that performs the IK handshake (injected `hello` on message 1, recovered `hello_ack` from message 2) and then encrypts/decrypts transport frames, so the relay socket (sibling wiring ticket) can carry a confidential, authenticated channel to the daemon.

The suite mismatch **fails silently** (ADR 0002) — hence the verbatim `NOISE_PROTOCOL` reuse. Keys are **injected** as config; sourcing them from `safeStorage` and building the `hello` Envelope are separate concerns (see § Scope — out of scope).

**Two hardening deltas over the proven harness, both from #29's carried-forward NIT:**
1. **AC4 — the async wasm-load surface.** `loadNoiseLib`'s `try/catch` today rejects only on a *synchronous* throw from `createNoise(...)`. If wasm instantiation fails *asynchronously* (callback never fires), the memoized promise **hangs forever**. The production loader must convert that to a rejection/timeout.
2. **Consolidation.** Two identical `loadNoiseLib` copies exist — the spike's (exported) and `noiseKeyPairGenerator.ts`'s (private). Both carry the same hang gap. Closing AC4 in only one leaves the other open. The elegant fix — and the one the keygen file's own comment earmarks for #7 — is a **single shared hardened loader** both consumers import. This also collapses two wasm inits into the one process-lived instance #7's single-instance model wants.

## Design

Three production files. The session state machine and the JS↔JS test responder are **carried unchanged** from the harness (only renamed); the genuinely new code is the shared loader's timeout/reset surface.

### Module layout

```
src/main/transport/noiseLib.ts          (NEW)  — the single hardened wasm loader + NoiseLoadError
src/main/transport/noiseSession.ts       (git mv ← noiseSpike.ts) — the production session
src/main/noiseKeyPairGenerator.ts        (MOD)  — deletes its private loader, imports the shared one
src/main/transport/noiseSession.test.ts       (git mv ← noiseSpike.test.ts) — ported unit tests
src/main/transport/noiseSession.interop.test.ts (git mv ← noiseSpike.interop.test.ts) — re-pointed
src/main/transport/noiseLib.test.ts      (NEW)  — AC4 loader tests (mocked createNoise)
```

`src/main/transport/noiseSpikeResponder/` (the Go responder) stays as-is — it is referenced by relative path from the interop test; renaming the dir is needless churn.

### 1. `noiseLib.ts` — the shared hardened loader (the AC4 surface)

Contract sketch (implementation is the body of `loadNoiseLib`; keep it ≤ ~30 lines):

```ts
/** Category-only load failure. Message names the category; never the raw wasm error text
 *  (classify-don't-forward — a library error string could echo bytes). Mirrors WireDecodeError. */
export class NoiseLoadError extends Error {
  readonly reason: 'wasm-load-failed' | 'wasm-load-timeout'
}

/** Load the noise-c wasm ONCE per process and memoize the SUCCESSFUL NoiseLib. Both the session
 *  and the keypair generator share this one instance. `timeoutMs` is test-overridable (default
 *  ~10_000, mirroring relayConnection's connect timeout). */
export function loadNoiseLib(options?: { timeoutMs?: number }): Promise<NoiseLib>
```

Behaviour (the three load-surface invariants — each gets a test):

- **Timeout race (AC4).** `createNoise(cb)` has no async error callback, so a hang can only be broken by a deadline. Race the callback against a `setTimeout(timeoutMs)`; if the callback hasn't fired, reject with `NoiseLoadError('wasm-load-timeout')`. Clear the timer on resolve (no leaked timer).
- **Sync-throw classification.** Keep the existing `try/catch` around `createNoise(...)`; on a synchronous throw, reject with `NoiseLoadError('wasm-load-failed')` — **never** `err.message` (category-only).
- **Memoize success, reset on failure.** Memoize the resolved `NoiseLib` at module scope (one wasm init). On **any** rejection (timeout or throw), null the module-scope memo so a later `loadNoiseLib()` retries a fresh load instead of returning a permanently-poisoned rejected promise. This is the load-surface fix's key correctness invariant.

### 2. `noiseSession.ts` — the production session (promoted harness)

`git mv noiseSpike.ts → noiseSession.ts`, then:

- **Rename symbols** (`replace_all`, no logic change): `createNoiseInitiator` → `createNoiseSession`; `NoiseInitiator` → `NoiseSession` (covers `NoiseInitiatorConfig`/`Event`/`ErrorReason` too, shared prefix).
- **Rewrite the header comment** — drop the "#29 throwaway spike" preamble; write a production module header (pure crypto unit; keys injected; log-free; transport-out-of-window; ADR 0002 suite pin).
- **Remove the inline `loadNoiseLib`** (lines 74-85) and `import { loadNoiseLib } from './noiseLib'`.
- **Forward the load surface (AC4).** The factory already does `const lib = await loadNoiseLib()`. Pass the config's optional timeout: `await loadNoiseLib({ timeoutMs: config.loadTimeoutMs })`. On rejection the **factory promise rejects** with the `NoiseLoadError` — the caller (`await createNoiseSession(...)`) surfaces it. Do **not** swallow it into `onEvent`: no handle exists yet, so a rejection is the correct, idiomatic async surface (contrast the runtime reasons below, which flow through `onEvent` because the handle is already driving frames).

Final contract (unchanged from the harness except names + `loadTimeoutMs`):

```ts
export interface NoiseSessionConfig {
  staticPrivateKey: Uint8Array        // raw 32-byte X25519, injected (AC2) — never from storage
  remoteStaticPublicKey: Uint8Array   // raw 32-byte X25519, injected
  prologue: Uint8Array                // zero-length matches the daemon (passed as null internally)
  hello: Uint8Array                   // early-data for IK msg 1 (opaque here; built by the sibling)
  sendFrame: (frame: Uint8Array) => void
  onEvent: (event: NoiseSessionEvent) => void
  loadTimeoutMs?: number              // forwarded to loadNoiseLib; default = loader default
}
export type NoiseSessionErrorReason =
  | 'handshake-read-failed'      // msg 2 failed MAC / malformed / wrong-suite / wrong-key peer
  | 'transport-decrypt-failed'   // a post-handshake frame failed to open (tamper / wrong key)
  | 'unexpected-frame'           // a frame arrived in the wrong state
export type NoiseSessionEvent =
  | { type: 'handshake-complete'; helloAck: Uint8Array }
  | { type: 'message'; plaintext: Uint8Array }
  | { type: 'error'; reason: NoiseSessionErrorReason }
export interface NoiseSession { start(): void; onFrame(f: Uint8Array): void; sendMessage(p: Uint8Array): void; close(): void }
export function createNoiseSession(config: NoiseSessionConfig): Promise<NoiseSession>
```

The state machine, `freeAll()`, empty-AD, the `Split()` no-swap (noise-c returns `[send, recv]` role-adjusted — see #30), the fail-closed decrypt, and the no-use-after-close guards are **carried verbatim**. The invariants they enforce are proven — the `git mv` preserves them; the tests re-assert them.

### 3. `noiseKeyPairGenerator.ts` — fold into the shared loader

Delete the private `loadNoiseLib` (lines 19-33), the module-scope `libPromise`, and the `import createNoise` (line 10). Add `import { loadNoiseLib } from './transport/noiseLib'`. `generate()` calls the shared loader; the public `KeyPairGenerator` surface is unchanged (net ~ −15 LOC). Its `generate()` now rejects with `NoiseLoadError` on load failure instead of hanging — a strict improvement, and `deviceKeypair.ts` already handles a rejecting promise (confirm on read; no edit expected).

## State + concurrency model

- **No app state, no store, no renderer.** Pure main-process crypto unit. There is no Zustand slice, no IPC, no DOM — everything stays in `src/main` (CLAUDE.md "keep the transport out of the window").
- **Session lifecycle:** unchanged from the harness — async factory returns an **idle** handle; `start()` writes IK msg 1 exactly once; `onFrame` drives msg-2 read then post-handshake decrypt; `close()` frees the wasm handshake + cipher states and leaves every entry point inert (no call into a freed wasm object — a real heap-corruption vector).
- **Shared wasm instance:** one memoized `Promise<NoiseLib>` in `noiseLib.ts` serves both the session and the keypair generator. Concurrent first calls resolve to the **same** promise (memoization), so no double-init race. The instance is process-lived; `close()` frees per-handshake/per-cipher objects, never the shared lib.
- **Load timer:** the AC4 timeout is the only owned timer; it is cleared on resolve and does not outlive the load. On rejection the memo resets so a retry starts clean.

## Error handling

Two distinct surfaces, deliberately different shapes:

- **Load failure (before the handle exists) → factory rejection.** `createNoiseSession` rejects with `NoiseLoadError` (`wasm-load-failed` | `wasm-load-timeout`). Category-only; the raw wasm error is never forwarded (classify-don't-forward extends to the load path). This is AC4's "error/rejection rather than hanging."
- **Runtime failure (handle live) → typed `error` event.** The closed set (`handshake-read-failed`, `transport-decrypt-failed`, `unexpected-frame`) flows through `onEvent` with a **static reason only, never bytes**. Fail-closed (AC1): a caught `ReadMessage`/`DecryptWithAd` throw emits the error event and **returns without emitting any `handshake-complete`/`message`** — no partial or leaked plaintext ever reaches the sink. A tampered, wrong-suite, or wrong-key frame MAC-fails inside the vetted library and lands here.
- **Log-free by construction (AC3):** zero `console.*` anywhere in `noiseLib.ts` / `noiseSession.ts`; every diagnostic is a typed reason. Pinned by the ported six-method console-spy assertion covering handshake + transport + error **and the new load-failure path**.

## Testing strategy

`npm test` (vitest, Node env) is the QA/salvage gate; `npm run build` (typecheck + build) is the salvage gate. Scenarios as behaviour (developer writes the test bodies in the project idiom):

**`noiseSession.test.ts`** (ported from `noiseSpike.test.ts` via `git mv`; re-point imports to `./noiseSession` + `./noiseLib`):
- **Round-trip (AC1/AC5):** the session completes the IK handshake against the inline JS↔JS responder — `handshake-complete.helloAck` byte-equals the responder's `hello_ack`, and after handshake one AEAD frame each way round-trips (`sendMessage(P)` → responder decrypt → `message.plaintext === P`). The injected `hello` rides msg 1 and is recovered by the responder.
- **Fail-closed (AC1):** (a) a **tampered** transport frame (flip a byte) → one `transport-decrypt-failed` event, **no** `message`; (b) a **wrong-key** handshake (initiator given a random `remoteStaticPublicKey`) → no `handshake-complete` (the wrong peer-static surfaces at the responder's read — see #30); (c) a **wrong-suite** responder (built with `…BLAKE2b`) → `handshake-read-failed` / no completion. Assert no partial plaintext is ever emitted on any of these.
- **Keys injected (AC2):** the session takes raw 32-byte keys from config and touches no storage API — structural (no `safeStorage`/`fs` import in the module).
- **Lifecycle / no-use-after-close (AC3):** `close()` makes `start`/`onFrame`/`sendMessage` inert; a frame after `close()` is a no-op (no throw, no event); `close()` is idempotent.
- **Log-free (AC3):** six-method `console`-spy across handshake + transport + error paths asserts none fire (warm the wasm in `beforeAll` first, before the spies install — the one-time Emscripten streaming-compile warning is stderr, not `console.*`).

**`noiseLib.test.ts`** (NEW — AC4, the one genuinely new surface). Mock the wasm import so no real load is needed and the module memo starts fresh (`vi.mock('noise-c.wasm', …)` + `vi.resetModules()` / dynamic `import()` per case so `libPromise` is not carried between cases):
- **Timeout:** a `createNoise` that never invokes its callback → `loadNoiseLib({ timeoutMs: <small> })` **rejects** with `NoiseLoadError` reason `wasm-load-timeout` within the deadline (does not hang; the vitest case terminates).
- **Sync throw:** a `createNoise` that throws synchronously → rejects with `NoiseLoadError` reason `wasm-load-failed`; message is category-only (never the thrown text).
- **Reset-on-failure:** after a rejected load, a subsequent `loadNoiseLib()` with a now-succeeding `createNoise` **resolves** (the memo was not poisoned).
- **Memoize success:** two successful calls resolve to the **same** `NoiseLib` (one init).

**`noiseSession.interop.test.ts`** (git mv ← `noiseSpike.interop.test.ts`): re-point imports only (`createNoiseSession` from `./noiseSession`, `loadNoiseLib` from `./noiseLib`). No behavioural change; keeps the real-`flynn/noise` cross-stack regression proof, which skips cleanly when Go is absent.

Type-level coverage via the existing `npm run typecheck` (the renamed/new `.ts` files compile under the same config).

## Scope / size

- **Production `.ts` files with new/modified content: 3** — `noiseLib.ts` (new), `noiseSession.ts` (renamed+hardened), `noiseKeyPairGenerator.ts` (fold-in). Under the 5-file self-check gate. `deviceKeypair.ts` is read-only (confirm, no edit).
- **Genuinely new files: 2** — `noiseLib.ts`, `noiseLib.test.ts`. The session, its test, and the interop test are `git mv` renames (content carried, not written). Under the 3-new-file red line.
- **Total written LOC ≈ 200** — loader ~70, loader test ~90, AC4 forward + keygen swap ~20, rename/re-point churn ~20. The proven 199-line session + ~400-line ported test move via `git mv`. Under the 600 ceiling.
- **Error branches: 5** (3 event reasons + 2 load reasons). **Consumer call-sites re-pointed: 4** (2 test imports + session + keygen). **ACs: 5.** All under the red lines.
- **Zero production-consumer cascade** on the rename: the session factory has no production caller yet (the relay wiring is the sibling split ticket). Only test files and the keygen fold-in touch it.

### Out of scope — required follow-ups, NOT this ticket

- **Relay-socket wiring** (session ↔ `createRelayConnection` ↔ #5 codec): sibling split ticket. #7 is the crypto unit only; `sendFrame`/`onFrame` are injected.
- **Sourcing the static keypair from `safeStorage`** (#42/#43) and the **CSPRNG-entropy gate** on the production static key. #7 injects keys and generates none.
- **electron-vite wasm *bundling*** for the packaged app — unproven (#29/#30 open question; both spikes load the wasm only under vitest). Flagged for human triage; not in #7's AC.
- **hello/hello_ack Envelope construction** (#10) — #7 treats `hello`/`helloAck` as opaque bytes.
- **Re-key and close-during-handshake robustness** (#33).
- **Renderer store wiring** (#17/#18/#19).

## Open questions (resolve during implementation; none block)

- **Load timeout default.** ~10_000 ms mirrors `relayConnection`'s connect timeout. The real wasm loads in tens of ms under vitest, so the default is only a hostile/broken-environment backstop. Confirm the value at implementation; it is a knob, not load-bearing.
- **Keeping the interop test.** Recommended (re-pointed) — it is the strongest test in the suite (real cross-stack interop) and skips cleanly without Go. If the developer finds the re-point non-trivial, deleting it + the Go responder as spent #30 artifacts is acceptable (the verdict is banked); note the choice in the PR.
- **`vi.resetModules` vs a test-only reset for the memo.** The loader tests need a fresh module scope per case. `vi.resetModules()` + dynamic `import()` is the clean vitest approach and needs no production test-seam; prefer it over exporting a reset hook.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — one explicit boundary: every inbound frame handed to `onFrame` passes straight into the vetted library's authenticated `ReadMessage`/`DecryptWithAd`, which MAC-verify and throw on failure → caught → typed `error`, never a partial. #7 does **not** parse untrusted structured data (envelope/base64 decode is #5/#10's fail-closed job at the wiring layer); it hands `helloAck`/`plaintext` up as opaque bytes. Injected keys are trusted-by-contract from the caller.
- **[Tokens, secrets, credentials]** No findings for this ticket. The static private key is raw 32-byte X25519, **injected as config**, held in main-process memory only, never logged, and freed by `close()`. #7 sources nothing from storage and generates no key. The `hello` may carry a device token (built by the sibling) — treated as opaque bytes, encrypted, never logged. OUT OF SCOPE → **#42/#43**: at-rest storage via `safeStorage`, CSPRNG entropy gate, rotation/revocation.
- **[File / storage operations]** No findings — #7 persists nothing and handles no filesystem path. The wasm is the base64-embedded package asset (#29), not a path from untrusted input. electron-vite *bundling* for the packaged app is OUT OF SCOPE (#29/#30 open question).
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, no IPC, no `contextBridge`, no custom protocol, no renderer. Keys, wasm, and cipher state stay entirely in the main process; nothing crosses to a renderer (there is none in reach). Process-placement invariant (a MUST-satisfy) holds: the transport/handshake lives in `src/main`.
- **[Cryptographic primitives]** No findings — no hand-rolled crypto. `noise-c.wasm` (reference `rweather/noise-c`, vetted per #29/#30). Suite pin reused verbatim from `NOISE_PROTOCOL`. Nonces are per-direction 64-bit counters **owned by the library** — the module never constructs, resets, or reuses a `(key, nonce)` pair. Empty AD on every op. No secret compared with `===`/`Buffer.equals` (MAC lives inside the library). `close()` frees handshake + cipher state, and the state-machine guards prevent any use-after-free. The consolidation removes a duplicate wasm init (one instance, not two) — no new secret exposure. Entropy gate on the production static key → **#43** (OUT OF SCOPE; #7 injects, does not generate).
- **[Network & I/O]** No findings — #7 owns no socket (the relay socket is the sibling's). Inbound frames arrive already size-capped by `createRelayConnection`'s `maxPayload` (#21); the decrypted-plaintext cap (`MAX_PLAINTEXT_BYTES`) is enforced at the #5 codec at the wiring layer. The **new AC4 load timeout** closes a liveness gap (a wasm-load that never completes previously hung indefinitely). No `rejectUnauthorized:false` anywhere (no TLS here).
- **[Error messages, logs, telemetry]** No findings — log-free by construction (AC3): zero `console.*`; classify-don't-forward on both surfaces — runtime errors become static event reasons, and the **load path** rejects with a **category-only** `NoiseLoadError` (never `err.message`, which could echo library internals). Pinned by the six-method console-spy assertion, now extended over the load-failure path. No telemetry, no crash reporter.
- **[Concurrency]** No findings — the load timer is cleared on resolve (no leak); on any load rejection the module-scope memo resets so a later call retries (no permanently-poisoned promise, no silent permanent-failure). Concurrent first calls to `loadNoiseLib` share the one memoized promise (no double-init). `close()` frees wasm state and makes every entry point inert. No long-lived async task outlives its owner beyond the intentional process-lived wasm instance.
- **[Threat model alignment]** No findings. *Malicious/on-path relay:* content-blind; a tampered/dropped/reordered frame either MAC-fails closed (typed error, no plaintext leak) or simply yields no event — liveness is the sibling supervisor's (#22) concern, and #7's own load hang is now a bounded timeout. *Hostile daemon-in-session response:* authenticated by the library's AEAD before any byte is surfaced; malformed post-auth envelopes fail closed at #5/#10. *Token theft from disk / renderer compromise:* N/A — nothing persisted, no renderer. OUT OF SCOPE → **#33** (re-key, close-during-handshake), **#10** (hello_ack envelope semantics), **#42/#43** (at-rest, entropy).

No MUST FIX. **PASS.**

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
