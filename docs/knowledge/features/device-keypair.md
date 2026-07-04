# Device static keypair

The desktop client's **stable Noise_IK cryptographic identity**: a device static X25519 keypair, generated **once** on first use and persisted through the [secure store](secure-store.md), so every later launch reads the same pair. This is the initiator static key (`s`) the eventual Noise_IK handshake constructs its state from — the desktop equivalent of mobile's device-static keypair (one per paired binary, private key never leaving the secure store, public key mirrored for fast startup reads, rotation tied to re-pair — `protocol-mobile.md` §"Static keys — mobile side"; pyrycode ADR 024).

Introduced in [#43](../codebase/43.md). It lives **entirely** in `src/main` — the private key and raw key bytes never reach the renderer, the preload bridge, or IPC ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It is the **first consumer** of the [secure store](secure-store.md) primitive ([#42](../codebase/42.md)) and consumes the X25519 keygen from the [`noise-c.wasm` library](../codebase/29.md) selected by the #29 spike.

## What it does

Gives the background process **one factory** — `createDeviceKeypairStore({ secureStore, generator })` — that returns a `{ ensure() }` handle over the device identity:

- **`ensure()`** returns the device `DeviceKeyPair`, generating + persisting it on the first call and returning the **same** persisted pair on every later call (this process or a later launch). It is **generate-once**: a fresh key is never returned when a persisted one exists.

That single method carries three correctness properties that are the whole reason the module exists:

1. **Generate-once** — never a fresh key on a second call, never a silent regeneration on corruption.
2. **The private key never crosses a boundary** — never returned to the renderer, never logged, never written outside the secure store.
3. **Fail-loud** — no path swallows an error and returns a fresh or partial keypair; corruption/tamper propagates so the consumer can decide re-pair vs hard error.

## How it works

Two production files in `src/main/`, following the #42 split of a pure core over injected effectful seams:

| File | Role |
|---|---|
| `src/main/deviceKeypair.ts` | The **pure core**: the 3 public interfaces, `MalformedDeviceKeypairError`, `DEVICE_STATIC_KEY_NAME`, `createDeviceKeypairStore(deps)`, and the internal 64-byte encode/decode. **Zero** `electron`/`fs`/`noise-c.wasm` imports (only the **type** of `SecureStore`) — trivially unit-testable. |
| `src/main/noiseKeyPairGenerator.ts` | The real `KeyPairGenerator` over `noise-c.wasm` `CreateKeyPair(NOISE_DH_CURVE25519)`. Loads the wasm through the shared hardened `transport/noiseLib` loader — the one process-lived instance the [Noise session](noise-session.md) also uses ([#7](../codebase/7.md) consolidated the two duplicate loaders; a load failure now rejects with `NoiseLoadError` instead of hanging). Not unit-tested (effectful edge). |

### Public surface

```ts
/** The device static Noise keypair. BOTH keys are MAIN-PROCESS ONLY — never cross contextBridge/IPC.
 *  A future ticket that surfaces the identity to the renderer must return only `publicKey`. */
export interface DeviceKeyPair {
  readonly privateKey: Uint8Array // 32B X25519 — the Noise_IK Initialize `s`, used by the transport
  readonly publicKey: Uint8Array  // 32B X25519 — client static public; pairing + fast startup read
}

/** Injected X25519 keygen seam. Production wraps noise-c.wasm CreateKeyPair (CSPRNG); tests fake it. */
export interface KeyPairGenerator {
  generate(): Promise<DeviceKeyPair>
}

/** The device-identity accessor. generate-once: first call generates + persists, later calls
 *  (this process or a later launch) return the SAME persisted pair — never a fresh one. */
export interface DeviceKeypairStore {
  ensure(): Promise<DeviceKeyPair>
}

/** Thrown when a stored blob is present but not a valid 64-byte keypair (tamper / format drift).
 *  Static message — carries no key bytes. Lets the consumer branch to a "re-pair" recovery. */
export class MalformedDeviceKeypairError extends Error {}

/** Milestone-1 single-pyrybox name. Mobile keys per server-id (`pyrycode.device_static.<server-id>`);
 *  appending `.${serverId}` is the deferred one-line multi-server change. */
export const DEVICE_STATIC_KEY_NAME = 'pyrycode.device_static'

export function createDeviceKeypairStore(deps: {
  secureStore: SecureStore    // #42, type-only import
  generator: KeyPairGenerator
  name?: string               // defaults to DEVICE_STATIC_KEY_NAME; injectable for tests + multi-server
}): DeviceKeypairStore

// src/main/noiseKeyPairGenerator.ts
export function noiseKeyPairGenerator(): KeyPairGenerator  // production adapter
```

- **Both effectful edges are injected.** Persistence is the [`SecureStore`](secure-store.md) (type-only import — no runtime coupling); X25519 keygen is the `KeyPairGenerator`. The core imports neither `electron`, `fs`, nor wasm, so its unit tests run with fakes and no keychain/fs/wasm — the same DI seam #42 uses. Using the **same** `noise-c.wasm` library + curve the handshake will use keeps the persisted key format handshake-compatible by construction.
- **`ensure()` and `generate()` are async** — `generate` awaits the wasm load, `ensure` awaits the store — so the main-process event loop is never blocked.

### Serialization — one opaque 64-byte blob

The keypair is stored as `privateKey (32B) ‖ publicKey (32B)` = **64 bytes** under `DEVICE_STATIC_KEY_NAME`, one opaque blob through the secure store. Persisting both (rather than re-deriving the public on read) mirrors mobile's public-key mirror **and** is forced by the library surface: `noise-c.wasm` derives the public inside `HandshakeState.Initialize` and exposes no standalone "public-from-private" call. Internal helpers:

- `encodeKeyPair(pair)` — asserts each key is exactly 32 bytes (throws `MalformedDeviceKeypairError` otherwise — a format invariant), concatenates into 64 bytes.
- `decodeKeyPair(blob)` — throws `MalformedDeviceKeypairError` unless the blob is 64 bytes; slices `[0,32)` = private, `[32,64)` = public (`slice` copies, so the returned pair is independent of the stored buffer).

### Core behavior (`ensure()` — generate-once)

`createDeviceKeypairStore` returns a handle holding a memoized `Promise<DeviceKeyPair>`. On each `ensure()`:

1. **Memoized** — if a promise is already in flight or resolved, return it. A second or concurrent call returns the **same** promise, so keygen + persist run at most once per process (this closes the two-callers-both-read-`null` race). On rejection the memo is **cleared**, so a later retry (e.g. once the keychain becomes available) can still proceed — a transient failure must not poison the store for the process lifetime.
2. **Persisted → return it** — `const blob = await secureStore.get(name)`; if present, `return decodeKeyPair(blob)`. The persisted blob is the source of truth; **never regenerate when a blob exists** (this is generate-once across launches).
3. **Absent → generate + persist** — `const pair = await generator.generate(); await secureStore.set(name, encodeKeyPair(pair)); return pair`. If `set` rejects (keychain unavailable), the freshly-generated pair is **not** returned — returning an unpersisted pair would break generate-once on the next launch.

### Data flow

```
 transport ticket (#7/#30)      createDeviceKeypairStore(core)        injected seams
  store.ensure() ──────► memoized? yes → return the cached promise
                           no → get(name) ─► SecureStore ─► blob?
                                 present → decodeKeyPair(blob) ─► pair   (throws on tamper / wrong length)
                                 absent  → generate() ─► noise-c.wasm CreateKeyPair
                                           set(name, encode(pair)) ─► SecureStore (encrypt-at-rest)
                                           ─► pair
```

Nothing in this flow reaches IPC, the preload, the renderer, or a `BrowserWindow`. The decrypted private key exists only transiently in main-process memory; ciphertext is all that is ever persisted (by the secure store, keychain-bound).

## Concurrency & lifecycle

- **No store slice, no Zustand, no renderer state** — this is a main-process service object, not UI state. There is no event stream.
- **Single source of truth is the persisted blob.** The memoized promise is a within-process serialization point over it; a fresh process re-reads the store and converges to the persisted pair.
- **The memo serializes concurrent first-calls** so keygen + persist happen at most once per process. No timers, listeners, or long-lived tasks — nothing to cancel on teardown; the handle holds only the keypair (and its memo) in memory.
- **The identity is immutable for the process** after generation; rotation is a separate re-pair flow (out of scope).

## Security properties

This module generates and holds the client's long-lived private identity key; its correctness properties are its reason to exist (code-review verdict: **PASS**, `security-sensitive`):

- **Generate-once / fail-loud** — a present blob is never overwritten; a decrypt throw or a wrong-length blob **propagates** (`ensure()` rejects, generator runs zero times) rather than triggering a silent regeneration — an attacker cannot force an identity rotation by corrupting the stored blob. Recovery (delete + re-pair vs hard error) is the **consumer's** decision, matching mobile line 384 and ADR 0005.
- **Private key never crosses a boundary** — main-process only; zero `contextBridge`/`ipcMain`/`BrowserWindow`/preload surface, so a renderer compromise gains no path to the key (AC4 is structural). Both keys are marked MAIN-PROCESS-ONLY; a future ticket surfacing the identity to the renderer must return only `publicKey`.
- **CSPRNG-backed keygen** — X25519 keys come from the vetted `noise-c.wasm` `CreateKeyPair` (draws from `crypto.getRandomValues`), never `Math.random()`; no hand-rolled crypto.
- **Encrypted at rest** — the private key is stored **only** via the secure store (Electron `safeStorage`, OS-keychain-bound, fail-closed) — never a plaintext file, never `localStorage`.
- **Log-free by construction** — no `console.*` anywhere; keys are opaque `Uint8Array` locals, never named fields of a logged struct. A test spies all six `console` methods across generate/persist/both error paths and asserts none fire.

## Edge cases and limitations

- **Keychain unavailable on first use** — `set` throws `EncryptionUnavailableError`, which propagates out of `ensure()`; the unpersisted pair is **not** returned, and the memo is cleared so a later retry can succeed.
- **Stored blob undecryptable (tamper / keychain rotation)** — `get`'s throw propagates; `ensure()` does not catch it and does not regenerate.
- **Stored blob present but not 64 bytes** — `MalformedDeviceKeypairError` (static message, no bytes).
- **Concurrent first-calls** — the memoized promise serializes them; the generator runs once, `set` runs once.
- **Not wired yet** — nothing constructs a live store; `src/main/index.ts` is untouched. Composition-root wiring lands with the transport ticket (#7/#30), which assembles `createDeviceKeypairStore` over the real `createSecureStore` + `noiseKeyPairGenerator()` and calls `ensure()` at connect time.
- **Single pyrybox** — one keypair under `DEVICE_STATIC_KEY_NAME`. Per-server-id keying (`pyrycode.device_static.<server-id>`) is a deferred one-line change via the injectable `name`; rotation is tied to re-pair, out of scope.
- **Decrypted key in memory** — while in use the private key resides in main-process memory (inherent to `safeStorage`'s decrypt-to-memory model; a JS `Uint8Array` cannot be reliably zeroised). Inherited from ADR 0005, not introduced here.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the injected persistence surface this consumes.
- [#43 codebase notes](../codebase/43.md) — implementation summary, patterns, and lessons.
- [#29 codebase notes](../codebase/29.md) — the Noise spike that selected `noise-c.wasm` and the `CreateKeyPair`/`NOISE_DH_CURVE25519` keygen primitive.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — secret-at-rest via `safeStorage`, fail-closed, "recovery is a consumer decision".
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model (keys never reach the renderer; mirror mobile).
- Downstream consumer: the Noise_IK transport (#7/#30), which builds the handshake state from this identity's `privateKey`.
