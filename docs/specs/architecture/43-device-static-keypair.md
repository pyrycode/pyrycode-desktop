# Spec — Device static keypair: generate once and persist (#43)

**Size:** S. Two new production files (`src/main/deviceKeypair.ts`, `src/main/noiseKeyPairGenerator.ts`) + one test file (`src/main/deviceKeypair.test.ts`). **No new dependency** — `noise-c.wasm@0.4.0` (the #29-selected X25519 source) is already in `package.json`; `SecureStore` (#42) is already present. 4 new exported types/classes (`DeviceKeyPair`, `KeyPairGenerator`, `DeviceKeypairStore` interfaces + `MalformedDeviceKeypairError` class) plus 2 factory functions (`createDeviceKeypairStore`, `noiseKeyPairGenerator`) and 1 name constant. ~110 core + ~30 adapter + ~180 test ≈ ~320 LOC total. **Zero consumer cascade** — greenfield; nothing imports it yet, and `src/main/index.ts` stays untouched (composition-root wiring lands with the transport ticket — see Open questions §1). No edit fan-out (`origin/feature/4`, `origin/feature/6` are the only in-flight branches; neither touches these files).

> Scope lock: this ticket ships **generation + persistence + retrieval of the device static keypair only**. It (a) generates one X25519 keypair from the #29 library on first use, (b) persists it as one opaque blob through #42's `createSecureStore`, (c) is idempotent (generate-once), (d) exposes the pair to main-process callers with the public key retrievable. It does **not** perform the handshake, does **not** parse pairing input, does **not** touch `safeStorage` / the filesystem directly (it goes through the injected `SecureStore`), does **not** wire itself into app startup, and adds **no** renderer / preload / IPC surface. Rotation, per-server-id keying, and the transport wiring are out of scope and named below.

## Files to read first

Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here — see auto-memory `codegraph-not-initialized`). This list was built by hand from the #42 secure-store surface, the #29 Noise spike, the mobile protocol source of truth (via QMD), and the security-review checklist.

- `src/main/secureStore.ts:22-100` — **the persistence surface #43 injects.** The `SecureStore` interface (`set`/`get`/`delete` over named `Uint8Array` blobs), `SecretEncryption` / `SecretPersistence` seams, `EncryptionUnavailableError`, and `createSecureStore(deps)`. #43's core takes a `SecureStore` as an injected dependency (**type-only** import — no runtime coupling). Note the contract: `set` is fail-closed (throws `EncryptionUnavailableError` before writing), `get` returns `null` for absent / **throws** on decrypt failure (does not mask corruption as absence).
- `src/main/secureStore.test.ts:1-148` — **the vitest idiom + in-file-fake pattern to mirror exactly.** `describe`/`it`/`expect`, in-file `fakeEncryption()` / `fakePersistence()` (Map-backed, records writes, throws on a foreign blob). #43's test fakes a `SecureStore` (Map-backed) and a `KeyPairGenerator` (deterministic bytes) the same way — no keychain, no fs, no wasm. Copy the "assert what landed in persistence is ciphertext, not plaintext" and "propagates a decrypt failure" shapes.
- `src/main/transport/noiseSpike.ts:1-21,71-85` — **the #29 library selection + the wasm-load idiom.** Header (lines 1-21) records why `noise-c.wasm` (BLAKE2s, vetted reference C, chosen by exact protocol-name) and the **log-free / classify-don't-forward** discipline. `loadNoiseLib()` (lines 71-85) is the memoized `Promise<NoiseLib>` init pattern #43's adapter mirrors (roll a private one — do **not** import from this **throwaway** file; see Open questions §2).
- `src/main/transport/noise-c.wasm.d.ts:56-76` — **the exact keygen primitive.** `NoiseLib.CreateKeyPair(curveId): [privateKey, publicKey]` and the `NOISE_DH_CURVE25519` constant. This is the X25519 source #43's adapter calls; both keys come back as 32-byte `Uint8Array`s. `HandshakeState.Initialize(prologue, s, rs, psk)` (lines 25-30) takes the **private** key `s` and derives the public — this is why the eventual transport needs `privateKey`, and why re-deriving the public standalone is not cleanly exposed (→ persist both).
- `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md:31-37` — **the consequences #43 inherits.** "#43 consumes `createSecureStore` — serialize to bytes, store by name; do not touch `safeStorage`/fs directly." "Recovery policy is a consumer decision" — #43 decides: **propagate, do not auto-regenerate** (§ Error handling).
- `docs/knowledge/features/secure-store.md` (whole) — the store contract, data-flow, and security properties #43 builds on. Confirms `src/main/index.ts` is untouched and wiring is deferred to the consumer.
- `src/main/electronSecretEncryption.ts` (whole — the effectful adapter) — the **"effectful edge, not unit-tested, its own file"** precedent that `noiseKeyPairGenerator.ts` mirrors: a thin production adapter over an external effectful dependency, verified by `npm run build` + integration, never by a unit test.
- `docs/knowledge/codebase/29.md` (findings note + "Patterns established") — `CreateKeyPair` draws from `crypto.getRandomValues` (CSPRNG); `Split()` is role-adjusted; the **`@shared` alias is not wired for `src/main`** (import shared via relative path — auto-memory `shared-alias-not-available-in-main-preload`); and the "verify production static key entropy" / "electron-vite wasm bundling" gates that remain **#7's** concern.
- **Mobile source of truth (via QMD `pyrycode-docs/protocol-mobile.md`, §"Static keys — mobile side", lines 114-123 + 376-384 + 802):** the pattern #43 mirrors — one device-static X25519 keypair generated once, **public key mirrored** for fast startup read while the private key never leaves the secure store; **rotation tied to re-pair**; on a missing/corrupt record the client **aborts and surfaces "pair record corrupted; re-pair"** (never silently regenerates); the static key is generated by the Noise library's CSPRNG and **never logged**.
- `CLAUDE.md` (repo root) — § "Don't": *no crypto/sockets/tokens in the renderer*, *no dependencies without justification* (none needed). § Conventions: *test-first*, *keep the transport out of the window*, *sealed shapes on a `type` discriminant* (moot — no events here). § Stack: *the Noise handshake / keys live in the background process*.
- `package.json` + `vitest.config.ts` — confirm `noise-c.wasm@0.4.0` is already a dependency (no new dep); gates are `npm test` (vitest, node env), `npm run typecheck`, `npm run build` (salvage + QA gate — `src/main/**/*` is type-checked, so all three new files are covered).

## Design source

N/A — background-process cryptographic-identity module; no visual surface. The ticket body has no `## Figma` section and the work is not UI-visible (no renderer, preload, or IPC code — the AC explicitly forbids the private key reaching the renderer). The visual-fidelity check is intentionally skipped.

## Context

Noise_IK requires the initiator (this desktop client) to hold a **static keypair** — a stable cryptographic identity used as the initiator static key when constructing the handshake. Mobile generates one device-static X25519 keypair per paired binary, keeps the private key in Android Keystore, and mirrors the public key for fast startup reads; the key is generated once and rotated only on re-pairing (`protocol-mobile.md` §"Static keys — mobile side"; pyrycode ADR 024).

This ticket owns **generation and persistence** of that identity on the desktop. It builds on two dependencies that have both landed:

- **#42 `createSecureStore`** (`src/main/secureStore.ts`) — the key-domain-blind `set`/`get`/`delete` over named `Uint8Array` blobs, encrypted at rest via Electron `safeStorage`, fail-closed. #43 serializes the keypair to bytes and stores it by name **through this surface**; it never touches `safeStorage` or the filesystem directly (ADR 0005).
- **#29 `noise-c.wasm`** — the selected `Noise_IK_25519_ChaChaPoly_BLAKE2s` library. Its `CreateKeyPair(NOISE_DH_CURVE25519)` is the X25519 keygen primitive; using the **same** library the handshake will use guarantees key-format compatibility (a divergent format would silently break the handshake — the reason #43 waited on #29).

The keypair is the desktop's stable identity **across launches**: launch 1 generates + persists; every later launch reads the persisted pair. It lives **entirely under `src/main/`** — the private key and raw key bytes never reach the renderer (CLAUDE.md "Keep the transport out of the window"; ADR 0002).

**Why `security-sensitive`:** this module generates and holds the client's long-lived private identity key. Its correctness properties — (1) generate-once (never a fresh key on a second call), (2) the private key never crosses to the renderer, is never logged, and never leaves the secure store, (3) fail-loud (never silently regenerate on corruption, never return an unpersisted pair) — are the whole reason it exists. The security-review pass at the end of this spec walks each category.

### Effectful edges are injected (the #42 DI seam, reused)

Following #42's structural rule exactly — the pure core imports **no** effectful dependency, so its AC-required tests run with fakes and no keychain / fs / wasm. Two seams are injected into the core:

| Concern | Injected seam (pure core depends on this) | Real adapter (production, not unit-tested) |
|---|---|---|
| Persistence | `SecureStore` (from #42, **type-only** import) | `createSecureStore({ electronSecretEncryption(), fileSecretPersistence(dir) })` — wired by the transport ticket |
| X25519 keygen | `KeyPairGenerator` (new, this ticket) | `noiseKeyPairGenerator()` — `noise-c.wasm` `CreateKeyPair(NOISE_DH_CURVE25519)` |

## Design

### Module layout

| File | Status | Purpose | Imports |
|---|---|---|---|
| `src/main/deviceKeypair.ts` | **new** | pure core: `DeviceKeyPair` / `KeyPairGenerator` / `DeviceKeypairStore` types, `MalformedDeviceKeypairError`, `DEVICE_STATIC_KEY_NAME`, `createDeviceKeypairStore(deps)`, and the internal 64-byte blob encode/decode. **Zero** `electron`/`fs`/`noise-c.wasm` imports — only the **type** of `SecureStore` from `./secureStore`. Trivially unit-testable. | `./secureStore` (type only) |
| `src/main/noiseKeyPairGenerator.ts` | **new** | real `KeyPairGenerator` over `noise-c.wasm` `CreateKeyPair(NOISE_DH_CURVE25519)`, memoizing its own wasm init. **Not** unit-tested (effectful edge; needs the wasm) — verified by types + `npm run build` + integration in the transport ticket. | `noise-c.wasm` |
| `src/main/deviceKeypair.test.ts` | **new** | AC-required core tests, **both** seams faked in-file (Map-backed `SecureStore`, deterministic `KeyPairGenerator`). Electron-free, fs-free, wasm-free. Includes the log-free assertion. | (test) |

Files are flat in `src/main/` (consistent with #42's flat `secureStore.ts` / `electronSecretEncryption.ts` and the existing `emitDaemonEvent.ts`). A `src/main/secrets/` folder is deferred until the domain grows (#44) — YAGNI, matching #42's decision.

**Why the keygen is an injected seam and the adapter is its own file:** AC5 requires the tests run "with the secure store injected/faked (no keychain, no real filesystem)". If the core imported `noise-c.wasm` directly to generate keys, the core's test module graph would pull in the wasm. Isolating keygen behind `KeyPairGenerator` (faked in tests) and shipping the real wasm call in a separate, untested adapter makes "the AC tests run without the wasm" **structural**, exactly as #42 isolated `electronSecretEncryption.ts`.

### Public surface (contracts, not implementations)

All key material is `Uint8Array` (32 bytes each; `Buffer` is a subclass — no `Buffer` in the core). `generate()` and `ensure()` are **async** (`generate` awaits the wasm load; `ensure` awaits the store) — no blocking the main-process event loop.

```ts
// src/main/deviceKeypair.ts — contracts only

/** The device static Noise keypair. BOTH keys are MAIN-PROCESS ONLY — never cross contextBridge/IPC. */
export interface DeviceKeyPair {
  readonly privateKey: Uint8Array // 32B X25519 — the Noise_IK Initialize `s`; used by the transport (#7/#30)
  readonly publicKey: Uint8Array  // 32B X25519 — client static public; pairing + fast startup read (AC3)
}

/** Injected X25519 keygen seam. Production impl wraps noise-c.wasm CreateKeyPair; tests fake it. */
export interface KeyPairGenerator {
  generate(): Promise<DeviceKeyPair> // fresh keypair from the #29 library's CSPRNG (crypto.getRandomValues)
}

/** The device-identity accessor. `ensure()` is generate-once: first call generates + persists, later
 *  calls (this process or a later launch) return the SAME persisted pair — never a fresh one (AC1, AC2). */
export interface DeviceKeypairStore {
  ensure(): Promise<DeviceKeyPair>
}

/** Thrown when a stored blob is present but not a valid 64-byte keypair (tamper / format drift). Static
 *  message — carries no key bytes. Lets the consumer branch to a "re-pair" recovery (mobile line 384). */
export class MalformedDeviceKeypairError extends Error {}

/** Milestone-1 single-pyrybox name. Mobile keys per server-id (`pyrycode.device_static.<server-id>`);
 *  appending `.${serverId}` is the deferred one-line multi-server change (out of scope — Open questions §3). */
export const DEVICE_STATIC_KEY_NAME = 'pyrycode.device_static'

export function createDeviceKeypairStore(deps: {
  secureStore: SecureStore              // #42, type-only import
  generator: KeyPairGenerator
  name?: string                         // defaults to DEVICE_STATIC_KEY_NAME; injectable for tests
}): DeviceKeypairStore
```

```ts
// src/main/noiseKeyPairGenerator.ts — contract only
export function noiseKeyPairGenerator(): KeyPairGenerator
```

### Serialization — one opaque 64-byte blob (the ticket's "single name" mandate)

The keypair is stored as `privateKey (32B) ‖ publicKey (32B)` = **64 bytes** under `DEVICE_STATIC_KEY_NAME`. Persisting both (rather than re-deriving the public on read) mirrors mobile's public-key mirror AND is forced by the library surface: `noise-c.wasm` derives the public inside `Initialize` but exposes no standalone "public-from-private" call, so re-derivation is not cleanly available. Internal helpers (not exported unless the developer wants them under test):

- `encodeKeyPair(pair): Uint8Array` — assert `privateKey.length === 32 && publicKey.length === 32` (throw `MalformedDeviceKeypairError` on violation — a format invariant), concat into 64 bytes.
- `decodeKeyPair(blob): DeviceKeyPair` — throw `MalformedDeviceKeypairError` unless `blob.length === 64`; slice `[0,32)` = private, `[32,64)` = public.

### `ensure()` behavior (generate-once)

Single method; the developer implements the body. The invariant, in order:

1. **Within-process memoization.** `ensure()` caches its in-flight/resolved `Promise<DeviceKeyPair>`. A second call (or a concurrent call) returns the cached promise — the idiomatic lazy-async-singleton, which also closes the concurrent-first-call race (two callers both reading `null` and both generating). On rejection, the memo is cleared so a later retry (e.g. after the keychain becomes available) can proceed — a rejected promise must not poison the store for the process lifetime.
2. **Persisted → return it.** `const blob = await secureStore.get(name)`. If `blob !== null`, `return decodeKeyPair(blob)`. This is generate-once across launches: the persisted pair is the source of truth; **never regenerate when a blob exists.**
3. **Absent → generate + persist.** If `blob === null`: `const pair = await generator.generate()`; `await secureStore.set(name, encodeKeyPair(pair))`; `return pair`.

The behavior is pinned by the test scenarios below; do not write a >20-line block for it.

## State + concurrency model

- **No store slice, no Zustand, no renderer state** — this is a main-process service object, not UI state. `createDeviceKeypairStore` returns a plain handle; there is no event stream.
- **Single source of truth is the persisted blob**; the in-memory memoized promise is a within-process cache/serialization point over it. Across launches, step 2 re-reads the store, so a fresh process converges to the persisted pair.
- **Concurrency:** the memoized promise serializes concurrent `ensure()` calls so keygen + persist happen at most once per process. No timers, no long-lived tasks, no listeners, no `AbortController` — there is nothing to cancel on teardown; the handle holds only the keypair (and its memo) in memory.
- **No mutation after generation** — the identity is immutable for the process; rotation is a separate re-pair flow (out of scope).

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Keychain unavailable on first-use `set` | injected `SecureStore.set` | `EncryptionUnavailableError` **propagates** out of `ensure()`. The freshly-generated in-memory pair is **not** returned (returning an unpersisted pair would break generate-once on the next launch). The memo is cleared. Consumer surfaces "cannot store securely". |
| Stored blob present but undecryptable (tamper / keychain rotation) | injected `SecureStore.get` | `get`'s throw **propagates** — `ensure()` does **not** catch it and does **not** regenerate. Silently regenerating would rotate the device identity (a forced-downgrade / silent-re-pair path). Matches mobile line 384 ("re-pair"). |
| Stored blob present but not 64 bytes | `decodeKeyPair` | `MalformedDeviceKeypairError` (static message, no bytes). Same fail-loud posture; consumer decides re-pair vs hard error. |
| `generator.generate()` fails (wasm load / keygen) | injected `KeyPairGenerator` | propagates out of `ensure()`; memo cleared; nothing persisted. |

**Fail-loud, never fail-silent.** No path in `ensure()` swallows an error and returns a fresh or partial keypair. Recovery (delete + re-pair vs hard error) is the **consumer's** decision (the transport ticket), deliberately not baked in here — the ADR 0005 principle, applied.

## Testing strategy

`npm test` (vitest, node env). **Both seams faked in-file**, mirroring `secureStore.test.ts`:

- `fakeSecureStore()` → `{ store: Map<string, Uint8Array> } & SecureStore`, records writes; a variant whose `set` throws `EncryptionUnavailableError`; a variant seeded with a foreign/short blob whose `get` returns it (to exercise decode + decrypt-propagation).
- `fakeGenerator(seed)` → deterministic `DeviceKeyPair` (e.g. `privateKey = fill(0xAA)`, `publicKey = fill(0xBB)`); a counting variant that returns a **different** pair per call so "generate ran exactly once" is provable.

Scenarios (bullet points — the developer writes the vitest bodies in the project idiom):

- **First-generation (AC1):** empty store → `ensure()` returns the generator's pair; assert the generator ran once, and the store now holds one blob of length 64 whose first 32 bytes are the private key (proves the private key was persisted, encoded as `priv‖pub`).
- **Generate-once on second call, same process (AC2):** two sequential `ensure()` calls with a *counting* generator return an **equal** pair (byte-for-byte, both keys); assert the generator ran **exactly once** and `set` was called **exactly once**.
- **Generate-once across a "restart" (AC2):** first store instance generates + persists; construct a **second** `createDeviceKeypairStore` over the **same** Map-backed store with a *counting* generator; its `ensure()` returns the persisted pair and the second generator runs **zero** times (proves cross-launch stability — reads the persisted blob, never regenerates).
- **Public-key retrieval (AC3):** `(await ensure()).publicKey` equals the generated public key and is 32 bytes.
- **Concurrent `ensure()` (AC2 hardening):** `await Promise.all([ensure(), ensure()])` with a counting generator returns two equal pairs and the generator ran **once** (the memoization race guard).
- **Fail-loud on keychain-unavailable (AC4-adjacent):** with the throwing `SecureStore.set`, `ensure()` **rejects** with `EncryptionUnavailableError`; assert no pair is returned and a subsequent `ensure()` (after swapping in a working store) can still succeed (memo not poisoned).
- **Corruption propagates, not masked / not regenerated:** store seeded with a blob whose `get` throws → `ensure()` **rejects** (does not regenerate); and a store seeded with a present-but-wrong-length blob → `ensure()` rejects with `MalformedDeviceKeypairError`. Assert the generator ran **zero** times in both.
- **Log-free (AC4):** spy all `console` methods across generate + persist + error paths; assert **none** fire (mirrors `noiseSpike.test.ts` / `secureStore` discipline — no key ever reaches stdout).

Type coverage: `npm run typecheck` proves the core imports only the **type** of `SecureStore` (no runtime `electron`/`fs`/wasm in the core's graph) and that `DeviceKeyPair` fields are `readonly`.

The production adapter `noiseKeyPairGenerator.ts` is **not** unit-tested (effectful edge — mirrors `electronSecretEncryption.ts`); it is verified by `npm run build` / `npm run typecheck` and exercised for real by the transport ticket's integration path.

## Open questions

1. **Composition-root wiring is deferred to the transport ticket (#7/#30), not this ticket.** #42 said "the first consumer (#43/#44) wires the real store" — but #43 has **no runtime consumer**: nothing calls `ensure()` until the transport needs the initiator static key. Wiring `createDeviceKeypairStore({ createSecureStore({ electronSecretEncryption(), fileSecretPersistence(join(app.getPath('userData'), 'secrets')) }), noiseKeyPairGenerator() })` into `index.ts` with no caller would be untestable and premature (the #21/#22/#42 defer-wiring precedent). #43 ships the **constructable** identity (core + real adapter); the transport ticket assembles + calls `ensure()` at connect time. `src/main/index.ts` stays untouched here. **Recommendation: accept — do not touch `index.ts`.** The assembly recipe above is recorded for the transport ticket.
2. **`noiseKeyPairGenerator` rolls its own memoized wasm loader rather than importing `loadNoiseLib` from `noiseSpike.ts`.** `noiseSpike.ts` is a **throwaway** spike file (#7 replaces it); importing production code from it would couple to a file slated for deletion. Format compatibility with the handshake comes from calling the **same package** (`noise-c.wasm`, same `NOISE_DH_CURVE25519`), not from sharing the loader function. In production only this adapter loads the wasm (the spike runs under vitest only), so there is no double-init. **Recommendation: private ~10-line loader in the adapter.** #7 consolidates wasm loading (single-instance model + electron-vite bundling) and this adapter folds into it then.
3. **Per-server-id keying is out of scope.** Milestone 1 is a single pyrybox → one keypair under `DEVICE_STATIC_KEY_NAME`. Multi-server appends `.${serverId}` — a one-line change enabled by the explicit constant. Deferred to the multi-server ticket.
4. **Rotation / re-pair is out of scope.** The identity is generate-once; rotation is tied to re-pairing (mobile line 121) and belongs with the pairing flow (#44 / a re-pair ticket). #43 only guarantees a stable identity is available.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the keypair never crosses a trust boundary in this ticket. The module is main-process-only (`src/main/`), adds **zero** `contextBridge` / `ipcMain` / `BrowserWindow` / preload surface, and `ensure()` returns `DeviceKeyPair` only to in-process callers. The `DeviceKeyPair` doc-comment marks both keys MAIN-PROCESS-ONLY; a future ticket that surfaces the *public* key to the renderer must return only `publicKey`, never the pair (named as a forward constraint). AC4 ("private key never returned to the renderer") is structural, not conventional.
- **[Tokens, secrets, credentials]** No findings — the private key is generated by `noise-c.wasm` `CreateKeyPair`, which draws from `crypto.getRandomValues` (a CSPRNG; #29 finding), never `Math.random()`. It is stored **only** via #42's `SecureStore` (Electron `safeStorage`, OS-keychain-backed, fail-closed) — never a plaintext file, never `localStorage`. Lifecycle: created once, persisted encrypted, rotation = re-pair (§ Open questions §4). No `console.*` anywhere in either new module; the key is held as opaque `Uint8Array` locals, never a named field of a logged struct.
- **[File / storage operations]** No findings — #43 performs **no** direct filesystem or `safeStorage` access; every byte goes through the injected `SecureStore`, which #42 owns (traversal-safe name→path via base64url, atomic temp-then-rename writes, `0o600`/`0o700` perms, `ENOENT`→null). #43 introduces no new path-concatenation, no `existsSync`-then-read TOCTOU. Storage scope (`userData/secrets`) and encryption-at-rest are inherited from #42/ADR 0005.
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, no IPC channel, no custom protocol, no navigation change. The standing renderer posture (`sandbox: true`, `contextIsolation: true`, deny-all permission handler in `index.ts`) is untouched. Process placement is correct: keys live in the main process, unreachable from the renderer — the MUST-FIX category is satisfied by construction.
- **[Cryptographic primitives]** No findings — X25519 keygen comes from the **vetted** `noise-c.wasm` (reference C `rweather/noise-c`; #29), **not** hand-rolled, and the **same** library + curve constant (`NOISE_DH_CURVE25519`) the handshake will use, so the persisted key format is handshake-compatible by construction. No AEAD, no nonces, no key-reuse surface in this ticket (keygen only). No secret comparison, so no `timingSafeEqual` need.
- **[Network & I/O]** No findings — N/A. This ticket has no network, socket, or WebSocket surface; it is generation + persistence only. The relay/frame-size/TLS concerns belong to the transport tickets.
- **[Error messages, logs, telemetry]** No findings — log-free by construction (a test asserts no `console.*` fires across all paths). `MalformedDeviceKeypairError` has a static message and carries no key bytes; `EncryptionUnavailableError` (from #42) is likewise static. No telemetry, no crash-reporter surface added; no key ever reaches an error object or stack trace.
- **[Concurrency]** No findings — the memoized `ensure()` promise serializes concurrent first-calls so keygen + persist run at most once (a test pins this), and a rejected memo is cleared so a transient failure does not poison the store for the process lifetime. No long-lived async task, timer, listener, or socket is created, so there is nothing to leak or cancel on teardown.
- **[Threat model alignment]** Addressed: **token/key theft from disk** — the private key is `safeStorage`-encrypted and keychain-bound (useless without the machine keychain), the bar #42/ADR 0005 raises. **Renderer compromise reaching the key** — blocked by process isolation (no IPC path to the module). **Corrupt / tampered stored blob** — `ensure()` fails loud (propagates the decrypt throw / `MalformedDeviceKeypairError`) and never silently regenerates, so an attacker cannot force an identity rotation by corrupting the blob; recovery (re-pair) is the consumer's explicit decision, matching mobile line 384. **Accepted residual:** the decrypted private key resides in main-process memory while in use (inherent to `safeStorage`'s decrypt-to-memory model — unlike Android Keystore's in-enclave ops; JS `Uint8Array` cannot be reliably zeroised). This is inherited from ADR 0005, not introduced here. **Out of scope, named:** the live handshake, hostile-daemon response parsing, rotation/re-key, and relay threats — the transport tickets (#7/#30) and the pairing/re-pair flow.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
