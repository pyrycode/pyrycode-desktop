# Secure store

The **secret-at-rest primitive** for the Electron background process: a generic, key-domain-blind key–value store over named opaque byte blobs (string name → `Uint8Array`), encrypted at rest with the OS keychain. Every long-lived secret the desktop client holds — the device static private key (#43), the paired-server record (#44), later pairing state — is built on this one auditable surface.

Introduced in [#42](../codebase/42.md). It lives **entirely** in `src/main` — keys and raw bytes never reach the renderer, the preload bridge, or IPC ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It is the desktop equivalent of mobile's Android Keystore / `EncryptedSharedPreferences` layer, and it decides the secret-at-rest strategy for the whole client — see [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md).

## What it does

Gives the background process **one factory** — `createSecureStore({ encryption, persistence })` — that returns a `{ set, get, delete }` handle over named secret blobs:

- **`set(name, value)`** encrypts `value` with the OS keychain and persists only the ciphertext. It is **fail-closed**: when encryption is unavailable it throws `EncryptionUnavailableError` *before any write*, so plaintext never hits disk.
- **`get(name)`** returns the decrypted bytes, or `null` when the name is absent. A decrypt failure (tamper, keychain rotation) **propagates** — it is not masked as absence.
- **`delete(name)`** removes the named secret; idempotent (an absent name is a no-op).

The store is **key-domain-blind**: it has no notion of "device key" or "server record". Consumers serialize their own structures to bytes and store them by a string name — exactly as `relayConnection` is a "semantics-blind byte pipe" for frames. Keeping one small surface carry the at-rest guarantee means the security properties are proved once, here.

## How it works

Three flat production files in `src/main/` (no `secrets/` subfolder yet — deferred YAGNI until a consumer grows the domain):

| File | Role |
|---|---|
| `src/main/secureStore.ts` | The **pure core**: the 3 public interfaces, `EncryptionUnavailableError`, and `createSecureStore(deps)`. Zero `electron`/`fs` imports (type-level only) — trivially unit-testable. |
| `src/main/electronSecretEncryption.ts` | The real `SecretEncryption` over `safeStorage`. The **only** module importing `electron`. |
| `src/main/fileSecretPersistence.ts` | The real `SecretPersistence` over `node:fs/promises` — traversal-safe name→path, atomic writes, owner-only perms. |

### Public surface

```ts
// Injected encryption seam — byte-in / byte-out, availability-gated.
export interface SecretEncryption {
  isAvailable(): boolean                        // false ⇒ store fails loudly; NEVER a plaintext fallback
  encrypt(plaintext: Uint8Array): Uint8Array    // opaque ciphertext
  decrypt(ciphertext: Uint8Array): Uint8Array   // original plaintext; throws on tamper / rotation
}

// Injected persistence seam — a named opaque-blob store. A fake in tests is a Map.
export interface SecretPersistence {
  read(name: string): Promise<Uint8Array | null>   // null when absent
  write(name: string, bytes: Uint8Array): Promise<void>
  delete(name: string): Promise<void>              // no-op when absent
}

export interface SecureStore {
  set(name: string, value: Uint8Array): Promise<void>  // rejects EncryptionUnavailableError, nothing written
  get(name: string): Promise<Uint8Array | null>        // null when absent; throws on decrypt failure
  delete(name: string): Promise<void>                  // idempotent
}

export class EncryptionUnavailableError extends Error {}  // static message — no secret, name, or value

export function createSecureStore(deps: {
  encryption: SecretEncryption
  persistence: SecretPersistence
}): SecureStore

export function electronSecretEncryption(): SecretEncryption   // production adapter
export function fileSecretPersistence(dir: string): SecretPersistence  // production adapter
```

- **Both effectful edges are injected interfaces.** The core is a pure, keychain-free, filesystem-free orchestration that unit-tests with fakes — the same DI seam as `relayConnection`'s `onEvent` ([#21](../codebase/21.md)). The real adapters are the only modules that import an effectful edge, and `fileSecretPersistence` is deliberately separated from the electron-importing adapter so *its* test graph is electron-free too.
- **All seams speak `Uint8Array`** — the portable byte type (`Buffer` is a subclass; adapters convert at the edge). Encryption is **synchronous** (`safeStorage` is sync, CPU-fast); persistence and the store are **async** (`Promise`-based `fs.promises`, no blocking the main-process event loop).

### Core behavior (`createSecureStore`)

Three tiny orchestrations over the seams — no crypto, no fs, no encoding of its own:

- **`set`** — `if (!encryption.isAvailable()) throw new EncryptionUnavailableError()` **first**, before any persistence call, then `persistence.write(name, encryption.encrypt(value))`. The order is availability-check → encrypt → persist, so plaintext is never written on the unavailable path.
- **`get`** — `read(name)`; `null` → `null`, else `encryption.decrypt(ct)`. A present-but-undecryptable blob lets `decrypt`'s throw **propagate** (masking tamper/corruption as absence would be a silent downgrade).
- **`delete`** — `persistence.delete(name)` (adapter treats absent as a no-op).

### Encryption adapter (`electronSecretEncryption`)

Bridges the byte-level seam to `safeStorage`'s string API via **base64** (load-bearing — see Lessons in [#42](../codebase/42.md)):

- `isAvailable()` → `safeStorage.isEncryptionAvailable()` **AND NOT** the Linux `basic_text` backend (`process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'`) — that backend reports "available" but is obfuscation with a hardcoded key, so it is treated as unavailable to keep the store fail-closed.
- `encrypt(bytes)` → `safeStorage.encryptString(Buffer.from(bytes).toString('base64'))`.
- `decrypt(ct)` → `new Uint8Array(Buffer.from(safeStorage.decryptString(Buffer.from(ct)), 'base64'))`.

Not unit-tested (it needs the Electron runtime + a real keychain — the reason the store injects fakes); it is thin, type-checked glue verified by `npm run build` + manual/integration.

**Which `SecretEncryption` the composition root injects is now a deterministic choice**, not a hardcoded `electronSecretEncryption()` call. `src/main/index.ts` passes the (uncalled) `electronSecretEncryption` factory through `selectSecretEncryption({ isPackaged, env, real })` ([#99](../codebase/99.md)), which returns the real backend on every path **except** a non-packaged, opt-in dev path (`PYRY_TEST_SECRET_BACKEND=1`), where it substitutes a keychain-free backend so `set` stops failing closed in a headless keychain-less run. This is an additive selection at the seam — `secureStore.ts` itself, its fail-closed logic, and `electronSecretEncryption.ts` are **untouched**; a packaged build is byte-identical to today (the env flag is never read). See the [secret-backend dev affordance](secret-backend-affordance.md).

### Persistence adapter (`fileSecretPersistence(dir)`)

One ciphertext file per secret under `dir`, `node:fs/promises` + `node:path` only:

- **Traversal-safe name→path** — `fileFor(name) = join(dir, base64url(utf8(name)) + '.bin')`. The name is never a path segment verbatim; base64url's alphabet (`[A-Za-z0-9_-]`, no `/`, `.`, `..`) structurally closes path traversal — `../../etc/passwd` maps to an inert token inside `dir`.
- **`read`** → `readFile(fileFor(name))`; `ENOENT` → `null`, else rethrow. Open-then-handle, **no** `existsSync`-then-read TOCTOU gap.
- **`write`** → `mkdir(dir, { recursive: true, mode: 0o700 })`, then **atomic**: `writeFile(tmp, bytes, { mode: 0o600 })` to a unique-suffixed temp (`randomBytes` hex, so concurrent same-name writes never share a temp) and `rename(tmp, target)`. A crash mid-write leaves the prior file intact or the new file whole — never a truncated secret; best-effort temp unlink on failure.
- **`delete`** → `unlink(fileFor(name))`; `ENOENT` → no-op, else rethrow.
- **Perms** — dir `0o700`, files `0o600`, owner-only (POSIX; on Windows `mode` is largely ignored, `userData` is already per-user ACL'd). Defense-in-depth on top of keychain-bound ciphertext.

The production `dir` is `join(app.getPath('userData'), 'secrets')`, passed in by the composition root when a consumer wires the store (#43/#44) — **not** computed here, so this adapter needs no `app` import and unit-tests against a temp dir.

### Data flow

```
 consumer (#43/#44, later)     createSecureStore(core)          real edges
  store.set(name, bytes) ─► isAvailable()? no → throw EncryptionUnavailableError (nothing written)
                               yes → encrypt(bytes) ─► electronSecretEncryption
                                     persistence.write(name, ct) ─► fileSecretPersistence (atomic, 0600)
  store.get(name) ────────► read(name) → null? → null
                               else decrypt(ct) ─► bytes  (throws on tamper)
  store.delete(name) ─────► delete(name) ─► unlink (ENOENT = no-op)
```

Nothing in this flow reaches IPC, the preload, the renderer, or a `BrowserWindow`. Plaintext exists only transiently in main-process memory between the seam boundary and the caller; ciphertext is all that is ever persisted.

## Security properties

This module *is* the secret-at-rest boundary — its correctness properties are its reason to exist (code-review verdict: **PASS**, `security-sensitive`):

- **Plaintext never on disk / fail-closed** — the availability check gates before any write; `setUsePlainTextEncryption(true)` is forbidden; the Linux `basic_text` obfuscation backend is treated as unavailable.
- **Path traversal closed structurally** — base64url encoding, not validation.
- **Authenticated decryption** — `safeStorage` is AEAD under the OS keychain; a tampered/foreign blob throws rather than yielding attacker-chosen plaintext, and the core propagates the throw.
- **Zero renderer/IPC surface** — no `contextBridge`, `ipcMain`, `BrowserWindow`, or preload change; a renderer compromise gains no path to the store.
- **Log-free by construction** — no `console.*` anywhere; secrets are opaque `Uint8Array` locals, never named fields of a logged struct (avoiding the KitchenClaw `GatewaySettings` `toString` leak by design).

## Edge cases and limitations

- **Absent name** — `get`/`delete` resolve `null`/no-op, never throw.
- **Same-name concurrency** — last-writer-wins with atomicity preserved (one `rename` wins; never a torn file). No locking.
- **Decrypt failure** — propagates; recovery policy (re-pair vs hard error) is a **consumer** decision, deliberately not baked into the blind primitive.
- **Stale `.tmp` on hard kill** — inert (ignored by `read`, which only opens `fileFor(name)`); an optional startup sweep is deferred to a consumer ticket.
- **Backup/sync capture** — ciphertext is keychain-bound and useless without the machine keychain; portable per-OS backup-exclusion is out of scope.
- **Not wired yet** — nothing constructs a live store; `src/main/index.ts` is untouched. Composition-root wiring lands with the first consumer (#43/#44).

## Related

- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the secret-at-rest decision (safeStorage, fail-closed, blind primitive) this feature realizes.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model this inherits (keys never reach the renderer; mirrors mobile).
- [#42 codebase notes](../codebase/42.md) — implementation summary, patterns, and lessons.
- [Relay connection](relay-connection.md) — the sibling main-side primitive whose injected-`onEvent` DI seam this mirrors.
- [Secret-backend dev affordance](secret-backend-affordance.md) ([#99](../codebase/99.md)) — the deterministic, dev-only selection that swaps the injected `encryption` seam to a keychain-free backend so `set` stops failing closed in a headless run; inert in a packaged build.
- Downstream consumers: [device static keypair](device-keypair.md) ([#43](../codebase/43.md)) and [paired-server store](paired-server-store.md) ([#44](../codebase/44.md)).
