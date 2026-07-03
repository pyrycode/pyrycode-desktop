# Spec — Secure key store over Electron safeStorage (#42)

**Size:** S. Three new production files (`src/main/secureStore.ts`, `src/main/electronSecretEncryption.ts`, `src/main/fileSecretPersistence.ts`) + two test files (`src/main/secureStore.test.ts`, `src/main/fileSecretPersistence.test.ts`). **No new dependency** — `safeStorage` ships with `electron` (already present), `node:fs/promises` + `node:path` are built-ins. 4 new exported types/classes (`SecureStore`, `SecretEncryption`, `SecretPersistence` interfaces + `EncryptionUnavailableError` class) plus 3 factory functions. ~180 production + ~220 test ≈ ~400 LOC total. **Zero consumer cascade** — greenfield primitive; nothing imports it yet, and the composition-root wiring in `src/main/index.ts` is a later ticket (#43/#44), exactly as #21/#22 left `index.ts` untouched. No edit fan-out.

> Scope lock: this ticket ships the **storage primitive only** — a generic named-secret `set`/`get`/`delete` over `Uint8Array` blobs keyed by a string name, with **no key-domain semantics**. It encrypts at rest with Electron `safeStorage` (OS keychain), writes only ciphertext under the app `userData` path, fails **loudly** when encryption is unavailable (never a plaintext fallback), and is unreachable from the renderer. The device static keypair (#43) and the paired-server record (#44) are separate downstream tickets that *consume* this primitive; **they are out of scope here**. No Noise, no wire types, no serialization of key-domain structures — consumers own their own serialization to/from bytes.

## Files to read first

Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here — see auto-memory `codegraph-not-initialized`). This list was built by hand from the transport modules, the security-review checklist, and a sibling-project precedent.

- `src/main/transport/relayConnection.ts:29-95` — **the DI pattern to mirror.** `createRelayConnection(config)` = a factory taking a config object with an **injected effectful sink** (`onEvent`); the "identity-/semantics-blind byte pipe" framing; and the module header's **log-free-by-construction** doc-comment style (lines 14-17). This module is the same shape: a factory taking two injected effectful seams, blind to what the bytes mean, never logging them.
- `src/main/transport/relayConnection.test.ts:1-70` — **vitest idiom + in-file fakes.** `describe`/`it`/`expect`, `afterEach` cleanup, in-file fake helpers (the `startRelay` factory pattern). Mirror the *in-file fake* approach for `fakeEncryption()` / `fakePersistence()`; do **not** stand up any real socket/keychain in the core-store suite.
- `src/main/index.ts` (whole — 94 lines) — **the composition root; confirms this ticket does NOT touch it.** Wiring a live `createSecureStore(...)` instance is deferred to the consumer tickets (#43/#44), just as #21/#22 left `index.ts` untouched. Also shows the standing renderer security posture (`sandbox: true`, `contextIsolation: true`) — untouched here.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md:26-30` — the security model this inherits: *"The security model mirrors mobile"* and *keys never reach the renderer* (CLAUDE.md "Keep the transport out of the window"). This module is the desktop equivalent of mobile's Android Keystore / `EncryptedSharedPreferences` layer.
- `CLAUDE.md` (repo root) — **§ "Don't":** *"Don't put crypto, sockets, or tokens in the renderer"*; *"Don't add dependencies without justification"* (none needed). **§ Conventions:** *Test-first* (RED test before implementation); *Sealed event shapes* (moot — no events here). **§ Stack:** *the transport (and now the secret store) lives in the background process, never the renderer*.
- `package.json:16-33` — confirm **no new dependency** is required: `electron` (safeStorage) is a devDependency already present; `node:fs/promises`/`node:path` are built-in. Gates: `npm test` (vitest, node env — `vitest.config.ts:16-18`), `npm run build` / `npm run typecheck` (the salvage + QA gate; `tsconfig.node.json:4` includes `src/main/**/*`, so all three new files are type-checked).
- `tsconfig.node.json:1-7` — `src/main/**/*` is in the node project; the new files are type-checked under `npm run typecheck`. **No `@shared` alias in the node project** (auto-memory `shared-alias-not-available-in-main-preload`) — moot here, this module imports nothing from `src/shared`.
- **Sibling precedent (via QMD `kitchenclaw-docs/specs/security-reviews/23-review.md`):** the KitchenClaw "Gateway Connection Settings Storage" secure-token review. Directly relevant lessons applied below: **encrypt tokens at rest** (there `EncryptedSharedPreferences` AES-256; here `safeStorage`), **disable backup / keychain-bound ciphertext**, **never leak secrets via `toString`/logs**, and **keystore-corruption recovery**. Read the "Detailed Analysis" section.

## Design source

N/A — background-process storage primitive; no visual surface. The ticket body has no `## Figma` section and the work is not UI-visible (no renderer, preload, or IPC code in this ticket — the AC explicitly forbids renderer reachability). The visual-fidelity check is intentionally skipped.

## Context

The desktop client holds long-lived secrets in the Electron **background process**: the device static private key (#43), the paired-server record (relay URL, server id, token, server static pubkey — #44), and later further pairing state. Mobile keeps these in Android Keystore / `EncryptedSharedPreferences`. The desktop equivalent is Electron `safeStorage`, which encrypts with a key held in the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux).

This ticket introduces **the primitive underneath all of them**: a generic, key-domain-blind `set`/`get`/`delete` over named `Uint8Array` blobs. It has no notion of "device key" or "server record" — those are downstream consumers that serialize their own structures to bytes and store them by name. Keeping the primitive blind (exactly as `relayConnection` is a "semantics-blind byte pipe") means one small, auditable surface carries the at-rest-encryption guarantee for every future secret.

**Why `security-sensitive`:** this module *is* the secret-at-rest boundary. Its correctness properties — (1) plaintext never touches the filesystem, (2) fail-closed when the keychain is unavailable rather than degrade to plaintext, (3) unreachable from the renderer, (4) no secret in logs, (5) path-traversal-safe on-disk layout — are the whole reason it exists. The security-review pass at the end of this spec walks each.

### Effectful edges are injected (the DI seam)

Both effectful edges are **injected interfaces** so the core is a pure, keychain-free, filesystem-free function that unit-tests with fakes (the ticket's Technical Notes; the `relayConnection` `onEvent` precedent). The real edges are thin adapters, shipped in their own files:

| Concern | Injected seam (pure core depends on this) | Real adapter (production) |
|---|---|---|
| Encryption | `SecretEncryption` (byte-in / byte-out, availability-gated) | `electronSecretEncryption()` — `safeStorage` + base64 bridge |
| Persistence | `SecretPersistence` (named opaque-blob store) | `fileSecretPersistence(dir)` — `node:fs/promises`, traversal-safe, atomic |

## Design

### Module layout

| File | Status | Purpose | Imports |
|---|---|---|---|
| `src/main/secureStore.ts` | **new** | pure core: the 3 public interfaces, `EncryptionUnavailableError`, and `createSecureStore(deps)`. **Zero** `electron` / `fs` imports — only type-level. Trivially unit-testable. | (types only) |
| `src/main/electronSecretEncryption.ts` | **new** | real `SecretEncryption` over `safeStorage`, bridging bytes↔string via **base64**. **Not** unit-tested (effectful edge; needs a real keychain) — verified by types + manual/integration. | `electron` (`safeStorage`) |
| `src/main/fileSecretPersistence.ts` | **new** | real `SecretPersistence`: traversal-safe name→path mapping, atomic temp-then-rename writes, restrictive perms, `ENOENT`→absent. | `node:fs/promises`, `node:path` |
| `src/main/secureStore.test.ts` | **new** | AC-required core tests with **both** seams faked in-file. Electron-free, fs-free. | (test) |
| `src/main/fileSecretPersistence.test.ts` | **new** | fs-adapter tests against a real tmp dir (traversal-safety, atomicity, `ENOENT`→null, no-op delete). Electron-free. | `node:fs`, `node:os` (test) |

Files are flat in `src/main/` (consistent with the flat `emitDaemonEvent.ts` / `receiveCommand.ts`). The transport got its own `transport/` folder only once it had 3 files; if the secret domain grows (#43/#44 add consumers), a `src/main/secrets/` folder can emerge then — deferred, YAGNI (Open questions §1).

**Why the core is its own electron-free file:** the AC-required tests must run with fakes and no keychain. Isolating the pure core so its test module graph never touches `electron` (or `fs`) makes that structural, not incidental. The two real adapters are the only modules that import an effectful edge, and `fileSecretPersistence` is deliberately separated from the electron-importing adapter so *its* test graph is electron-free too.

### Public surface (contracts, not implementations)

All three seams and the store speak **`Uint8Array`** (the portable byte type; `Buffer` is a subclass — adapters convert at the edge, mirroring `relayConnection`'s `Uint8Array` frames). Encryption is **synchronous** (`safeStorage` is sync; encryption is CPU-fast); persistence and the store are **async** (`Promise`-based, `fs.promises` — no blocking the main-process event loop).

```ts
/** Injected encryption seam — byte-in / byte-out, availability-gated. The core never sees the
 *  keychain; a fake in tests is a trivial identity/XOR transform. */
export interface SecretEncryption {
  /** True only when secrets can be encrypted with real OS-keychain protection. When false, the
   *  store fails loudly — it MUST NOT fall back to plaintext. See electronSecretEncryption. */
  isAvailable(): boolean
  encrypt(plaintext: Uint8Array): Uint8Array  // opaque ciphertext
  decrypt(ciphertext: Uint8Array): Uint8Array // original plaintext; throws on tamper/rotation
}

/** Injected persistence seam — a named opaque-blob store. No crypto, no name interpretation
 *  beyond safe storage-key mapping. A fake in tests is a Map<string, Uint8Array>. */
export interface SecretPersistence {
  read(name: string): Promise<Uint8Array | null>   // null when the name is absent
  write(name: string, bytes: Uint8Array): Promise<void>
  delete(name: string): Promise<void>              // no-op when the name is absent
}

/** The secure key–value store. String name → opaque bytes; no key-domain semantics. */
export interface SecureStore {
  /** Encrypt `value` and persist ciphertext. Rejects with EncryptionUnavailableError, WITHOUT
   *  touching persistence, when encryption is unavailable (plaintext never hits disk). */
  set(name: string, value: Uint8Array): Promise<void>
  /** Decrypt and return the stored bytes, or null when the name is absent. Propagates (throws)
   *  a decrypt failure — it does NOT mask corruption/tamper as absence. */
  get(name: string): Promise<Uint8Array | null>
  /** Remove the named secret; idempotent (absent name is a no-op). */
  delete(name: string): Promise<void>
}

/** Thrown by set when SecretEncryption.isAvailable() is false. Static message — carries no
 *  secret, no name, no value. */
export class EncryptionUnavailableError extends Error { /* name = 'EncryptionUnavailableError' */ }

export function createSecureStore(deps: {
  encryption: SecretEncryption
  persistence: SecretPersistence
}): SecureStore

/** Real SecretEncryption over Electron safeStorage. Production-only. */
export function electronSecretEncryption(): SecretEncryption

/** Real SecretPersistence rooted at `dir` (production: join(app.getPath('userData'), 'secrets'),
 *  computed by the consumer/composition root — NOT this ticket). */
export function fileSecretPersistence(dir: string): SecretPersistence
```

### Core behavior (`createSecureStore`)

The core is three tiny orchestrations over the seams — no crypto, no fs, no encoding of its own. Each is a couple of lines; contracts, not bodies:

- **`set(name, value)`** — `if (!encryption.isAvailable()) throw new EncryptionUnavailableError()` **first**, before any persistence call (so plaintext is never written on the unavailable path); else `await persistence.write(name, encryption.encrypt(value))`.
- **`get(name)`** — `const ct = await persistence.read(name); return ct === null ? null : encryption.decrypt(ct)`. Absent → `null`; present-but-undecryptable → the `decrypt` throw **propagates** (do not swallow to `null`; masking tamper/corruption as absence is a silent-downgrade risk — see Security review §Threat model).
- **`delete(name)`** — `await persistence.delete(name)` (idempotent; the adapter treats absent as a no-op).

Invariant asserted by tests: the order in `set` is availability-check → encrypt → persist. The unavailable-path test asserts `persistence.write` is **never called**.

### Real encryption adapter (`electronSecretEncryption`)

Bridges the byte-level `SecretEncryption` seam to `safeStorage`'s string API. **The base64 bridge is load-bearing** — do not substitute `latin1`/`binary`:

- `isAvailable()` → `safeStorage.isEncryptionAvailable()` **AND NOT the Linux obfuscation-only backend** (see below).
- `encrypt(bytes)` → `safeStorage.encryptString(Buffer.from(bytes).toString('base64'))`, returned as a `Uint8Array`.
- `decrypt(ct)` → `new Uint8Array(Buffer.from(safeStorage.decryptString(Buffer.from(ct)), 'base64'))`.

**Why base64 and not latin1:** `safeStorage.encryptString(s)` encodes `s` as **UTF-8** internally, and `decryptString` returns a UTF-8 string. base64's alphabet is pure ASCII (`< 0x80`), so it survives the UTF-8 round-trip byte-for-byte. A `latin1`/`binary` string would re-encode any byte `≥ 0x80` as a 2-byte UTF-8 sequence and corrupt on the way back. base64 costs ~33% size inflation on small secrets — negligible and correct.

**Linux `basic_text` guard (a known Electron gotcha):** on Linux with no keyring, `safeStorage` can fall back to a `basic_text` backend where `isEncryptionAvailable()` returns **true** but the "encryption" is obfuscation with a hardcoded key — not real protection. `isAvailable()` therefore additionally returns false when `process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'` (guard the call with the platform check — `getSelectedStorageBackend` is Linux-only). This keeps the primitive **fail-closed** rather than silently storing weakly-obfuscated secrets. See Security review §Threat model.

This adapter is **not unit-tested** (it needs the Electron runtime + a real keychain — the same reason the ticket says to inject fakes). It is thin, type-checked glue; verify by `npm run build` + manual/integration.

### Real persistence adapter (`fileSecretPersistence(dir)`)

One file per secret under `dir`. `node:fs/promises` + `node:path` only.

- **Traversal-safe name→path.** The secret name is **never** used verbatim as a path segment. `fileFor(name) = join(dir, base64url(utf8(name)) + '.bin')`, where base64url encodes to `[A-Za-z0-9_-]` (no `/`, no `.`, no `..`). This structurally closes path traversal (a name like `../../etc/passwd` maps to an inert encoded token inside `dir`). The mapping is deterministic and collision-free (base64url is a bijection on byte strings).
- **`read(name)`** → `fs.readFile(fileFor(name))` → `Uint8Array`; on `err.code === 'ENOENT'` return `null` (absent), else rethrow. **Open-then-handle, not `existsSync`-then-read** — no TOCTOU check-then-open gap.
- **`write(name, bytes)`** → ensure `dir` exists (`fs.mkdir(dir, { recursive: true, mode: 0o700 })`), then **atomic**: write to a unique temp file in `dir` (`fs.writeFile(tmp, bytes, { mode: 0o600 })`) and `fs.rename(tmp, fileFor(name))`. Rename is atomic on the same filesystem, so a crash mid-write leaves either the old file intact or the new file complete — never a truncated secret. Use a unique temp suffix (e.g. `crypto.randomBytes` hex) so two concurrent writes to the same name don't share a temp path; best-effort unlink the temp on write failure.
- **`delete(name)`** → `fs.unlink(fileFor(name))`; on `ENOENT` return (no-op), else rethrow.
- **Permissions:** dir `0o700`, files `0o600` — owner-only. Defense-in-depth on top of keychain-bound ciphertext (POSIX; on Windows `mode` is largely ignored — `userData` is already per-user ACL'd, note as accepted).

**Production directory** (`join(app.getPath('userData'), 'secrets')`) is passed in by the composition root when a consumer wires the store (#43/#44) — **not** computed here, so this adapter needs no `app` import and unit-tests against a tmp dir.

### Data flow

```
 consumer (#43/#44, later)        createSecureStore(core)          real edges
   store.set(name, bytes) ──► isAvailable()? no → throw EncryptionUnavailableError (nothing written)
                                   yes → encryption.encrypt(bytes) ──► electronSecretEncryption
                                          persistence.write(name, ct) ──► fileSecretPersistence (atomic, 0600)
   store.get(name) ─────────► persistence.read(name) ──► null? → null
                                   else encryption.decrypt(ct) ──► bytes  (throws on tamper)
   store.delete(name) ──────► persistence.delete(name) ──► unlink (ENOENT = no-op)
```

Nothing in this flow reaches IPC, the preload, the renderer, or a `BrowserWindow`. Plaintext exists only transiently in main-process memory between the seam boundary and the caller; ciphertext is all that is ever persisted.

## State + concurrency model

- **No Zustand store, no React, no async iterables, no long-lived tasks/timers/listeners.** This is a stateless main-process primitive: three async methods over two injected edges. There is nothing to subscribe to, nothing to tear down, no `AbortController` — each call is a self-contained encrypt-then-write / read-then-decrypt / unlink.
- **Per-name file isolation.** Each secret is its own file, so concurrent ops on **different** names never interfere (no shared-file read-modify-write, unlike a single-JSON-map design — deliberately avoided).
- **Same-name concurrency = last-writer-wins**, with atomicity preserved: the temp-then-rename write means an interleaving of two `set(name, …)` calls resolves to one complete file (one rename wins), never a torn file. Unique temp names prevent the two writes from clobbering a shared temp. Acceptable KV semantics for this primitive; no locking needed.
- **Shutdown mid-write safety.** `app.quit` / process kill between `writeFile(tmp)` and `rename` leaves the prior file intact (rename never ran); after `rename` the new file is whole. No half-written secret is ever observable. A leftover `.tmp` on a hard kill is inert (ignored by `read`, which only opens `fileFor(name)`); an optional sweep of stale temps is deferred (Open questions §3).

## Error handling

| Failure | Layer | Result |
|---|---|---|
| `encryption.isAvailable()` is false | core `set` | reject `EncryptionUnavailableError`; **persistence untouched** (AC #2). Static message — no secret/name/value in it. |
| Name absent | core `get` | resolve `null` (AC #3) — **not** a throw. |
| Ciphertext present but `decrypt` throws (tamper, keychain rotated, backend changed) | core `get` | **propagate** the throw — do not mask as `null`, do not auto-delete. Consumers decide recovery (re-pair vs hard error). |
| Name absent | core `delete` | no-op, resolve (AC #3). |
| `fs` error other than `ENOENT` (EACCES, EIO, ENOSPC) | persistence | propagate. |

- **Log-free by construction** (inherited from `relayConnection`, whose header pins this): **no `console.*` anywhere** in these three modules. A secret value must never reach stdout, a log file, or a crash reporter. There is deliberately **no `toString()` override needed** because no type in this module holds a secret as a named field (contrast the KitchenClaw `GatewaySettings` data-class `toString` leak — avoided here by design: values are opaque `Uint8Array` locals, never fields of a logged struct).
- **No secret in any thrown error.** `EncryptionUnavailableError` is static. `decrypt` failures come from `safeStorage`/the backend and carry no plaintext (decrypt fails *before* producing plaintext). The only caller-supplied datum that can appear in an error is the secret **name** via an `fs` error's `path` (the base64url-encoded filename) — a non-secret identifier, acceptable (SHOULD-note in Security review §7).
- **A throwing consumer is a caller bug, not defended** (evidence-based; matches `relayConnection`).

## Testing strategy

`npm test` (vitest, node env). **Test-first:** write these RED before the modules exist. Mirror the `describe`/`it`/`expect` + in-file-fake idiom from `relayConnection.test.ts`.

### `secureStore.test.ts` — core with both seams faked (AC-required)

In-file fakes:
- `fakeEncryption(opts?: { available?: boolean })` → a `SecretEncryption` whose `encrypt`/`decrypt` are a reversible transform (e.g. byte-wise XOR with a constant, or wrap/unwrap with a sentinel prefix) so a round-trip is observable and ciphertext ≠ plaintext; `isAvailable()` returns `opts.available ?? true`. Records calls (esp. whether `encrypt` ran).
- `fakePersistence()` → a `Map<string, Uint8Array>`-backed `SecretPersistence`; records writes (to assert "never written" on the unavailable path) and stores ciphertext (to assert plaintext ≠ what's stored).

Scenarios (developer writes bodies; bullet = input → expected):
- **AC #3 round-trip** — `set('k', bytes)` then `get('k')` returns byte-equal `bytes`; and the value handed to `fakePersistence.write` is the **ciphertext** (≠ `bytes`), proving encryption happened before persistence.
- **AC #3 absent name** — `get('missing')` resolves `null` (no throw).
- **AC #3 delete** — `set` then `delete('k')` then `get('k')` → `null`; and `delete('never-set')` resolves (no-op, no throw).
- **AC #2 encryption unavailable** — with `fakeEncryption({ available: false })`, `set('k', bytes)` **rejects** with `EncryptionUnavailableError`, and `fakePersistence.write` was **never called** (plaintext never written). Assert the error type/name.
- **decrypt-failure propagates** — a `fakeEncryption` whose `decrypt` throws for a stored blob: `get` on that name **rejects** (does not resolve `null`), proving corruption isn't masked as absence.
- **opaque bytes** — round-trip arbitrary bytes incl. `[0x00, 0x80, 0xff, 0x7f]` and empty `Uint8Array(0)` to prove no encoding assumptions in the core.

### `fileSecretPersistence.test.ts` — real fs against a tmp dir (security-relevant hardening)

Use a fresh `fs.mkdtemp(os.tmpdir() + …)` per test (or the scratchpad); clean up in `afterEach`. Electron-free.
- **round-trip** — `write('name', bytes)` then `read('name')` byte-equal; a second file on disk under `dir`, and **exactly one** `.bin` file.
- **traversal-safety** — `write('../../etc/evil', bytes)` creates a file **inside** `dir` (assert `fs.readdir(dir)` shows one encoded `.bin` entry and nothing was written outside `dir`); `read('../../etc/evil')` round-trips it. Prove the name never escapes.
- **absent → null** — `read('nope')` resolves `null` (ENOENT handled, not thrown).
- **delete** — `write` then `delete` then `read` → `null`; `delete('nope')` resolves (no-op).
- **atomicity / no torn file** — after `write`, no `.tmp` remains in `dir` on success; the `.bin` content equals the full input (spot-check a larger blob).
- **perms (POSIX only, gate on `process.platform !== 'win32'`)** — the file's mode is `0o600` and `dir` is `0o700` (`fs.stat` → `mode & 0o777`).

Type-level (`npm run build` / `npm run typecheck`): the 4 exported types + 3 factories resolve; `createSecureStore` accepts `{ encryption, persistence }`; `electronSecretEncryption()` and `fileSecretPersistence(dir)` are assignable to the seam types; `SecureStore` methods return the documented `Promise` shapes.

## Open questions

1. **Folder vs flat.** Three flat files in `src/main/` match the existing flat modules. If #43/#44 add consumers and the domain grows, introduce `src/main/secrets/` then — deferred, YAGNI. Not a blocker.
2. **Empty / weird names.** base64url encoding makes any string (incl. empty) a safe filename, so no validation is required for *safety*. A non-empty-name guard is a nicety, not a security need — left out per evidence-based-fix (no observed failure). Revisit if a consumer wants it.
3. **Stale `.tmp` sweep.** A hard kill between `writeFile(tmp)` and `rename` can leave an inert `.tmp` (ignored by `read`). A best-effort startup sweep of `dir/*.tmp` could be added when a consumer wires the store — deferred.
4. **Decrypt-failure recovery policy.** This primitive *propagates* decrypt failures (honest). Whether a failure means "delete + re-pair" (the KitchenClaw corrupted-prefs recovery pattern) or "hard error" is a **consumer** decision (#43/#44), deliberately not baked into the blind primitive. Auto-deleting here would risk a tamper→forced-downgrade path.
5. **Directory encryption / backup exclusion.** `userData/secrets` may be captured by Time Machine / cloud backup, but the ciphertext is keychain-bound and useless without the machine's keychain (mobile disables backup for the same class of data — KitchenClaw #23). No app-level backup-exclusion API is portable across desktop OSes; noted as accepted residual risk, not addressed here.

## Security review

**Verdict:** PASS

This ticket carries the `security-sensitive` label. The pass below walks the checklist (`architect/security-review.md`) adversarially against this module's scope: the **secret-at-rest primitive** — a keychain-encrypted, string-keyed byte store in the main process, with two injected effectful edges and zero renderer/network surface. The module's reason to exist *is* a set of security properties, so each is stated as an addressed finding with the file/line or design decision that enforces it.

**Findings:**

- **[Trust boundaries]** No MUST FIX. One inbound boundary: **disk ciphertext → decrypt → plaintext**, in core `get` (single, explicit — not scattered). It is safe because `safeStorage` decryption is **authenticated** (AEAD under the OS keychain): tampered/foreign ciphertext fails to decrypt and **throws** rather than yielding attacker-chosen plaintext, and the core **propagates** that throw (never masks it as `null`). The other direction (plaintext → encrypt → disk) never persists plaintext (see [Tokens]). Callers receive either authentic bytes or an error.
- **[Tokens, secrets, credentials]** No MUST FIX — this *is* the correct storage mechanism. Encryption at rest via Electron `safeStorage` (OS-keychain-backed), the checklist's prescribed choice; **never a plaintext file, never `localStorage`/renderer**. Fail-closed: `set` throws `EncryptionUnavailableError` when `isAvailable()` is false, **before** touching persistence — no plaintext fallback, and `safeStorage.setUsePlainTextEncryption(true)` is **explicitly forbidden** (would defeat the primitive). No token *generation* here (no RNG for secrets; the only RNG is the atomic-write temp suffix — non-security). Lifecycle: `set`/`get`/`delete` cover create/read/revoke; rotation/expiry are consumer concerns for a blind blob store. Values are opaque `Uint8Array` locals, never named fields of a struct → no `toString` leak (the KitchenClaw `GatewaySettings` finding, avoided by design).
- **[File / storage operations]** No MUST FIX — the meatiest category, each item addressed in `fileSecretPersistence`:
  - *Path traversal* — closed structurally: the name is base64url-encoded (`[A-Za-z0-9_-]`, no `/`/`.`/`..`) before it is ever a path segment; `../../…` maps to an inert token inside `dir`. Verified by the traversal test.
  - *TOCTOU* — `read` is open-then-handle-`ENOENT`, **no** `existsSync`-then-read gap.
  - *Storage scope + perms* — under `app.getPath('userData')/secrets` (passed by the consumer), dir `0o700` / files `0o600`, owner-only; not a temp dir.
  - *Encryption at rest* — `safeStorage`; `isEncryptionAvailable()` fallback handled (fail-closed).
  - *Atomic writes* — temp-file + `fs.rename`; a kill mid-write never leaves a truncated secret.
- **[Inter-process / Electron attack surface]** No MUST FIX. **Zero** IPC/preload/renderer surface: no `contextBridge`, no `ipcMain`, no `BrowserWindow`, no preload change (AC #4). Runs entirely in the main process; secrets and the keychain handle are never exposed to the renderer (CLAUDE.md "no crypto/tokens in the renderer"; ADR 0002). A renderer compromise gains **no** path to this store. `src/main/index.ts`'s standing `sandbox: true` / `contextIsolation: true` posture is **not touched**. The pure core imports no `electron` at all.
- **[Cryptographic primitives]** No MUST FIX — **no hand-rolled crypto**. Encryption is delegated entirely to Electron `safeStorage` (OS keychain: Keychain / DPAPI / libsecret). base64 is an encoding, not crypto. No key/nonce management in this module (owned by the OS). The one weak-mode risk — Linux `basic_text` (obfuscation reported as "available") — is **closed**: `isAvailable()` returns false for `basic_text`, keeping the store fail-closed. No `Math.random` for anything security-relevant.
- **[Network & I/O]** N/A — no network, no sockets, no relay. Only local `fs`. Frame-size/relay-URL/TLS/heartbeat items do not apply. Stated to avoid coverage theatre: this module opens no connection of any kind.
- **[Error messages, logs, telemetry]** No MUST FIX, one SHOULD-note. **Log-free by construction** — no `console.*` in any of the three modules; no secret value can reach stdout, a log file, or a crash reporter. No thrown error embeds a secret value (`EncryptionUnavailableError` is static; `decrypt` fails before yielding plaintext). *SHOULD-note:* an `fs` error may carry the secret **name** via its `path` (the base64url-encoded filename) — a non-secret identifier, acceptable; consumers should still avoid logging caught `fs` errors verbatim if a name is sensitive in their domain.
- **[Concurrency]** No MUST FIX. No long-lived async tasks, timers, or listeners → no leak/cancellation surface (no `AbortController` needed). Per-name file isolation means different-name ops never race; same-name ops are last-writer-wins with atomic rename preserving a whole file (no torn write). Shutdown mid-write leaves the prior file intact or the new file whole. No shared mutable state, no read-modify-write on a shared file (a single-JSON-map design was deliberately rejected for exactly this reason).
- **[Threat model alignment]** Walked against `security-review.md` §9 (desktop-client scope):
  - *Token theft from disk* — the labelled surface. `safeStorage` ciphertext is **keychain-bound**: an attacker with disk read but no keychain access cannot decrypt (the checklist's exact ask). `0o600`/`0o700` perms raise the bar further. Fallback when the keychain is unavailable: **fail-closed** (`set` throws; no plaintext), and the Linux `basic_text` obfuscation mode is treated as unavailable — so secrets are never written weakly.
  - *Tamper / corruption* — authenticated decryption throws; the core propagates rather than silently forgetting the secret (which would be a forced-downgrade/DoS path). Recovery policy is a consumer decision (Open questions §4).
  - *Renderer compromise reaching secrets* — stopped by construction (main-process-only, zero IPC/preload surface).
  - *Malicious relay / hostile daemon* — N/A (no network in this module); owned by the transport/codec/Noise tickets.
  - *Backup/sync capture* — ciphertext is useless without the machine keychain; portable per-OS backup-exclusion is out of scope (Open questions §5).
  - *Out of scope, named:* device-keypair generation/storage semantics → #43; paired-server-record serialization → #44; the composition-root wiring of the production `app.getPath('userData')` dir → the first consumer ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-03
