# Spec — Paired-server record storage (#44)

**Size:** S (a small S). **One** new production file (`src/main/pairedServerStore.ts`) + one test file (`src/main/pairedServerStore.test.ts`). **No new dependency** — `SecureStore` (#42) and the `QrPayload` wire type (#5/ADR 0002) are already present; serialization is `JSON` + `TextEncoder`/`TextDecoder` (Node/Electron globals). No effectful adapter needed (unlike #43's `noiseKeyPairGenerator.ts`): there is no keychain/fs/wasm edge to isolate — the only injected seam is `SecureStore`, and encode/decode is pure. 4 new exported symbols (`PairedServerRecord` type alias, `PairedServerStore` interface, `MalformedPairedServerRecordError` class, `PAIRED_SERVER_NAME` const) + 1 factory (`createPairedServerStore`). ~80 core + ~160 test ≈ ~240 LOC total. **Zero consumer cascade** — greenfield; nothing imports it yet, `src/main/index.ts` stays untouched (the consumer #9 and the transport wire it later). No edit fan-out (`origin/feature/4`, `origin/feature/6` are the only in-flight branches; neither touches these files — checked at architect time).

> Scope lock: this ticket ships **serialize + store + retrieve of the paired-server record only**. It (a) serializes the `{server, relay, token, server_static_pubkey}` tuple to bytes and persists it as one opaque blob through #42's `createSecureStore`, (b) retrieves it with the absent-vs-undecryptable-vs-malformed semantics below, (c) exposes a main-process-only handle. It does **not** parse or validate the pairing input (relay-URL scheme check, fingerprint, etc. — that is #9, which calls `save()` after validating), does **not** touch `safeStorage` / the filesystem directly (it goes through the injected `SecureStore`), does **not** perform the handshake or use `server_static_pubkey` cryptographically, does **not** wire itself into app startup, and adds **no** renderer / preload / IPC surface. Per-server-id keying, un-pair/forget, and token revocation are out of scope and named in Open questions.

## Files to read first

Codegraph is not initialized for this repo (`mcp__codegraph__*` errors here — see auto-memory `codegraph-not-initialized`). This list was built by hand from the #42 secure-store surface, the #43 sibling, the wire types, and ADR 0005.

- `src/main/deviceKeypair.ts` (whole, 137 lines) — **the sibling to mirror.** The consume-the-primitive pattern #44 copies almost structurally: type-only `SecureStore` import, an explicit store-name constant with an injectable `name?` override, a `Malformed…Error` for present-but-invalid blobs, private `encode`/`decode` helpers, log-free by construction. #44 is the **same shape minus** the keygen seam, the generate-once memoization, and the concurrency guard (there is no "generate on first read" here — `save` is an explicit consumer write, `load` a plain read). Do not carry over the `KeyPairGenerator`, the `memo`, or `ensure()`.
- `src/main/deviceKeypair.test.ts` (whole, 246 lines) — **the test harness to reuse almost verbatim.** `fakeSecureStore()` (Map-backed, records `writes`, exposes `control.setError` / `control.getError` toggles for the two `SecureStore` failure modes), the log-free `console` spy test, the injected-name test, and the "seed a blob then assert `get`-throws propagates / decode rejects" shapes. Swap "keypair" for "record"; drop the counting-generator and the concurrency/restart tests (no generate-once here).
- `src/main/secureStore.ts:22-100` — **the persistence surface #44 injects (type-only import).** The `SecureStore` contract: `set` is fail-closed (throws `EncryptionUnavailableError` *before* any write), `get` returns `null` for an **absent** name but **throws** (does not mask as `null`) on a decrypt failure, `delete` is idempotent. #44's retrieval semantics are built directly on this null-vs-throw split.
- `src/shared/wire/types.ts:119-125` — **the `QrPayload` interface** (`server`, `relay`, `token`, `server_static_pubkey` — four strings). The record type **aliases** this (see Design) so it cannot drift from the wire contract. Import via the relative path `../shared/wire/types` — the `@shared` alias is **not** wired for `src/main` (auto-memory `shared-alias-not-available-in-main-preload`; precedent `src/main/emitDaemonEvent.test.ts:4`).
- `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md:29-37` — **the consumer-recovery decision #44 realizes.** "Decrypt failure propagates, is not masked as absence." "Recovery policy is a consumer decision" — #44 decides: **propagate the decrypt throw, and reject a decrypted-but-malformed blob, never report `null` (never-paired)** for either (§ Error handling).
- `docs/knowledge/features/secure-store.md` (whole) — the store contract, data flow, and security properties #44 builds on. Confirms `src/main/index.ts` is untouched and composition-root wiring is deferred to the consumer (#43/#44).
- `docs/specs/architecture/43-device-static-keypair.md` (whole) — the sibling spec whose structure, error-handling table, and security-review shape this spec follows; skim for the shared idioms.
- `CLAUDE.md` (repo root) — § Conventions: *test-first*, *keep the transport out of the window*, *sealed shapes on a `type` discriminant* (moot — no events here). § Don't: *no crypto/sockets/tokens in the renderer*, *don't drift the wire types*, *no dependencies without justification* (none needed). § Wire protocol: the record mirrors mobile field-for-field.

## Design source

N/A — background-process secret-storage module; no visual surface. The ticket body has no `## Figma` section and the work is not UI-visible (no renderer, preload, or IPC code — the AC explicitly forbids the token and server key reaching the renderer). The visual-fidelity check is intentionally skipped.

## Context

Pairing yields a `{server, relay, token, server_static_pubkey}` tuple — the QR/paste payload (`QrPayload`, `src/shared/wire/types.ts:119-125`; ADR 0002; the v2 QR payload added `server_static_pubkey`, pyrycode #432). On every connect the client uses `server_static_pubkey` as the responder's static key for the `Noise_IK` handshake and `token` for the relay/hello auth. To reconnect without re-pairing, that tuple must survive across launches.

This ticket owns **persisting and retrieving** that record. It builds on the **secure key store** that landed in #42 — `createSecureStore` (`src/main/secureStore.ts`): a key-domain-blind `set`/`get`/`delete` over named `Uint8Array` blobs, encrypted at rest via Electron `safeStorage`, fail-closed. #44 serializes the record to bytes and stores it by name **through this surface**; it never touches `safeStorage` or the filesystem directly (ADR 0005). The device-keypair sibling #43 established this consume-the-primitive pattern; #44 is its near-twin for a variable-length JSON record instead of a fixed 64-byte key blob.

**Why `security-sensitive`:** the record holds the pairing **`token`** — a bearer credential the relay/daemon accept as proof this client may drive the daemon. Its correctness properties — (1) the token and server key are stored only via the keychain-backed `SecureStore`, never plaintext, never logged, never reaching the renderer/preload/IPC, and (2) a tampered or corrupt record is **never silently mistaken for never-paired** (which would hide tampering or force a re-pair) — are the reason this module warrants review. The security-review pass at the end of this spec walks each category.

### The one injected seam (the #42 DI pattern, reused)

Following #42/#43's structural rule — the pure core imports **no** effectful dependency, so its AC-required tests run with a fake and no keychain / fs:

| Concern | Injected seam (pure core depends on this) | Real adapter (production) |
|---|---|---|
| Persistence | `SecureStore` (from #42, **type-only** import) | `createSecureStore({ electronSecretEncryption(), fileSecretPersistence(dir) })` — wired by the consumer/transport ticket |

Serialization (`JSON.stringify`/`parse`, `TextEncoder`/`TextDecoder`) is **pure** — no effectful edge — so, unlike #43, there is **no second production file**.

## Design

### Module layout

| File | Status | Purpose | Imports |
|---|---|---|---|
| `src/main/pairedServerStore.ts` | **new** | pure core: `PairedServerRecord` type, `PairedServerStore` interface, `MalformedPairedServerRecordError`, `PAIRED_SERVER_NAME`, `createPairedServerStore(deps)`, and the internal JSON encode/decode. **Zero** `electron`/`fs` imports — only the **type** of `SecureStore` (from `./secureStore`) and the **type** `QrPayload` (from `../shared/wire/types`). Trivially unit-testable. | `./secureStore` (type), `../shared/wire/types` (type) |
| `src/main/pairedServerStore.test.ts` | **new** | AC-required core tests; the `SecureStore` seam faked in-file (Map-backed, `setError`/`getError` toggles — copy from `deviceKeypair.test.ts`). Electron-free, fs-free. Includes the log-free assertion. | (test) |

Files are flat in `src/main/` (consistent with #42/#43 and the existing `emitDaemonEvent.ts`).

### Public surface (contracts, not implementations)

```ts
// src/main/pairedServerStore.ts — contracts only
import type { QrPayload } from '../shared/wire/types'
import type { SecureStore } from './secureStore'

/** The persisted paired-server record: the four QR-payload fields, verbatim. Aliasing QrPayload
 *  (not re-declaring the shape) makes drift from the wire contract structurally impossible —
 *  any QrPayload change flows through (CLAUDE.md "don't drift the wire types"). MAIN-PROCESS
 *  ONLY: `token` is a bearer credential; it and `server_static_pubkey` never cross to the renderer. */
export type PairedServerRecord = QrPayload

/** The paired-server accessor. `save` persists (overwrite = re-pair); `load` retrieves with the
 *  absent-vs-undecryptable-vs-malformed semantics below. Both main-process only. */
export interface PairedServerStore {
  save(record: PairedServerRecord): Promise<void>
  load(): Promise<PairedServerRecord | null>
}

/** Thrown by `load` when a blob is PRESENT and decrypts, but is not a valid record (not JSON, not
 *  an object, or a missing / non-string field). Static message — carries NO field value. Lets the
 *  consumer branch to "re-pair" rather than treat corruption as never-paired (ADR 0005). */
export class MalformedPairedServerRecordError extends Error {}

/** Milestone-1 single-pyrybox name. Mobile keys per server-id; appending `.${serverId}` is the
 *  deferred one-line multi-server change (out of scope — Open questions §1). */
export const PAIRED_SERVER_NAME = 'pyrycode.paired_server'

export function createPairedServerStore(deps: {
  secureStore: SecureStore      // #42, type-only import
  name?: string                 // defaults to PAIRED_SERVER_NAME; injectable for tests / future multi-server
}): PairedServerStore
```

### Serialization — one opaque JSON blob (the ticket's "single name" mandate)

The record is stored as UTF-8 JSON of exactly the four fields under `PAIRED_SERVER_NAME`. JSON mirrors the wire (which is JSON); field order is irrelevant (parse is order-insensitive; the blob is not signed). Internal helpers (not exported):

- `encodeRecord(record): Uint8Array` — `TextEncoder().encode(JSON.stringify({ server, relay, token, server_static_pubkey }))`. **Pick the four fields explicitly** so a caller's stray fields are never written.
- `decodeRecord(blob): PairedServerRecord` — `TextDecoder().decode(blob)` → `JSON.parse`; then validate: the parsed value must be a non-null object whose `server`, `relay`, `token`, `server_static_pubkey` are all `string`. On a `JSON.parse` throw **or** a failed shape check → throw `MalformedPairedServerRecordError`. Return the four fields re-picked (drops any extra keys). Keep the block ≤20 lines; the scenarios below pin its behavior.

**Structural validation only — not semantic.** `decodeRecord` checks "is this the record shape we wrote," not "is the relay URL well-formed / is the token valid." Input validation is #9's job (§ Scope lock); this guard defends only against a corrupt/foreign decrypted blob.

### `save` / `load` behavior

Single-statement bodies; the developer writes them. The invariants:

- **`save(record)`** — `await secureStore.set(name, encodeRecord(record))`. `set` is fail-closed: on keychain-unavailable it throws `EncryptionUnavailableError` **before any write**, which propagates out of `save` (nothing persisted; the consumer surfaces "cannot store securely"). Calling `save` again **overwrites** (re-pair). No memoization, no read-before-write.
- **`load()`** — `const blob = await secureStore.get(name)`. If `blob === null` → return `null` (**absent = not paired** — the ONLY null path). Else `return decodeRecord(blob)`. A decrypt failure inside `get` **propagates** (not caught); a decrypted-but-malformed blob throws `MalformedPairedServerRecordError`. No caching — a straight read each call, so a re-pair is observed immediately.

The absent-vs-present distinction is exactly `secureStore.get`'s null-vs-non-null: a present blob that happens to decode to JSON `null`/`{}`/an incomplete object is **malformed**, not absent — it throws, it does not return `null`. This is the load-bearing AC3 property (a tampered record is never silently mistaken for never-paired).

## State + concurrency model

- **No store slice, no Zustand, no renderer state** — a main-process service object, not UI state. `createPairedServerStore` returns a plain `{ save, load }` handle; no event stream.
- **Single source of truth is the persisted blob.** `load` re-reads it each call (no in-memory cache), so a fresh process — or the same process after a `save` — converges to what is on disk. This is simpler and safer than #43's memoized `ensure()`: there is no generate-once invariant to protect and no first-read race, because `save` is an explicit consumer action, never triggered implicitly by `load`.
- **Concurrency:** no timers, no long-lived tasks, no listeners, no `AbortController` — nothing to cancel on teardown. Concurrent `save`s are last-writer-wins with write atomicity preserved (inherited from `SecureStore`/`fileSecretPersistence`'s temp-then-rename); the module adds no locking and needs none for the milestone-1 single-writer usage.

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Keychain unavailable on `save` | injected `SecureStore.set` | `EncryptionUnavailableError` **propagates** out of `save`; nothing written. Consumer surfaces "cannot store securely". |
| Stored blob present but undecryptable (tamper / keychain rotation) | injected `SecureStore.get` | `get`'s throw **propagates** out of `load` — **not** caught, **not** returned as `null`. Masking corruption as never-paired would hide tampering / force a re-pair (ADR 0005). |
| Stored blob present, decrypts, but not a valid record (bad JSON / missing / non-string field) | `decodeRecord` | `MalformedPairedServerRecordError` (static message, no field value). Same fail-loud posture; **not** `null`. |
| Nothing stored | injected `SecureStore.get` → `null` | `load` returns `null` (not paired) — the only null path. |

**Fail-loud, never fail-silent.** No `load` path swallows an error and returns `null` for a present-but-broken record. Recovery (delete + re-pair vs hard error) is the **consumer's** decision — deliberately not baked in here (the ADR 0005 principle).

## Testing strategy

`npm test` (vitest, node env). The `SecureStore` seam is **faked in-file**, copied from `deviceKeypair.test.ts`:

- `fakeSecureStore()` → `{ secureStore, store: Map<string, Uint8Array>, writes, control: { setError, getError } }`. `set` throws `control.setError` when set, else records the blob; `get` throws `control.getError` when set, else returns `store.get(name) ?? null`.

Scenarios (bullet points — the developer writes the vitest bodies in the project idiom):

- **Round-trip (AC1, AC2):** `save(record)` then `load()` returns a record **deep-equal** to the input on all four fields; assert exactly one blob landed in `store` under `PAIRED_SERVER_NAME`, and that the blob is UTF-8 JSON containing the four fields (proves it was serialized, not held in memory).
- **Not-yet-paired → null (AC3):** `load()` on an empty store returns `null` (not a throw).
- **Undecryptable propagates, not masked (AC3):** seed `store` with any blob, set `control.getError = new Error('authenticated decryption failed')`; `load()` **rejects** (does not return `null`).
- **Malformed present blob → throws, not null (AC3):** seed `store` with a blob that decrypts to (a) non-JSON bytes, (b) JSON `null`, (c) a JSON object missing `token`, (d) a JSON object whose `token` is a number — each `load()` **rejects** with `MalformedPairedServerRecordError`, never returns `null`.
- **Overwrite / re-pair (AC2):** `save(a)` then `save(b)`; `load()` returns `b`; `store` holds one blob.
- **Fail-loud on keychain-unavailable (AC4):** with `control.setError = new EncryptionUnavailableError()`, `save(record)` **rejects** with `EncryptionUnavailableError`; assert `writes` is empty (nothing persisted).
- **Store name + injected-name seam:** default keys under `PAIRED_SERVER_NAME` (`'pyrycode.paired_server'`); an injected `name` keys there instead and leaves the default absent (the deferred per-server-id seam).
- **Log-free (AC4):** spy all `console` methods across `save` + `load` + every error path; assert **none** fire (mirrors `deviceKeypair.test.ts` — the token never reaches stdout).

Type coverage: `npm run typecheck` proves the core imports only the **types** of `SecureStore` and `QrPayload` (no runtime `electron`/`fs` in the core's graph), and that `PairedServerRecord` is structurally `QrPayload` (so it cannot drift). `npm run build` is the salvage + QA gate and type-checks all of `src/main/**`.

## Open questions

1. **Per-server-id keying is out of scope.** Milestone 1 pairs a single pyrybox → one record under `PAIRED_SERVER_NAME`. Multi-server appends `.${serverId}` (mirroring mobile's per-server-id model) — a one-line change enabled by the explicit constant + injectable `name`. Deferred to the multi-server ticket. **Security note:** when that lands, a `serverId` derived from a QR/paste field becomes part of the store *name* — it must be validated/encoded before use so it can't influence the persistence path. Today the name is a **fixed constant** (no untrusted input reaches it), so there is no traversal surface (see security review § File/storage).
2. **Composition-root wiring is deferred, not this ticket.** #42 said "the first consumer wires the real store," but #44 has **no runtime consumer**: nothing calls `save`/`load` until #9 (pairing input) persists, and the transport (#7/#30) reads at connect time. Wiring `createPairedServerStore({ secureStore: createSecureStore({ electronSecretEncryption(), fileSecretPersistence(join(app.getPath('userData'), 'secrets')) }) })` into `index.ts` with no caller would be untestable and premature (the #21/#22/#42/#43 defer-wiring precedent). #44 ships the **constructable** store; `src/main/index.ts` stays untouched. The assembly recipe is recorded here for the consumer.
3. **Un-pair / forget is out of scope.** `SecureStore` already exposes `delete`; a `clear()` on this store is a one-line addition (`secureStore.delete(name)`) when a re-pair/forget flow needs it. No AC requires it — omitted (Simplicity First). Re-pair is handled by `save` overwriting.
4. **Token lifecycle beyond storage is out of scope.** Generation, rotation, expiry, and revocation of the pairing token are the daemon's / pairing flow's concern; this module only persists and returns whatever it is given. Rotation surfaces here only as `save` overwriting (§ Error handling). Revocation propagation (daemon → client) is named as out of scope in the security review.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the record never crosses a trust boundary in this ticket. The module is main-process-only (`src/main/`), adds **zero** `contextBridge` / `ipcMain` / `BrowserWindow` / preload surface, and `save`/`load` are called only by in-process code (#9 to persist, the transport to read). The single boundary this design *does* enforce is disk→memory on `load`: a present-but-corrupt blob is **fail-loud** (`get`'s throw propagates; a malformed decode throws `MalformedPairedServerRecordError`), never coerced to `null`. Coercing corruption to `null` (never-paired) would be a tamper-hiding / forced-re-pair path — the exact anti-pattern AC3 forbids, and it is closed structurally (the only `null` return is `secureStore.get` returning `null`). The `PairedServerRecord`/`PairedServerStore` doc-comments mark the record MAIN-PROCESS ONLY; a future ticket must never return `token`/`server_static_pubkey` to the renderer.
- **[Tokens, secrets, credentials]** No findings — the pairing `token` (a bearer credential) and `server_static_pubkey` are stored **only** via #42's `SecureStore` (Electron `safeStorage`, OS-keychain-backed, fail-closed) — never a plaintext file, never `localStorage`/`sessionStorage`. `save` inherits fail-closed: on an unavailable keychain it throws `EncryptionUnavailableError` **before any write**, so the token never lands as plaintext. This module **generates** no token (the daemon/pairing owns generation/rotation/expiry/revocation — Open questions §4); it persists what it is given. No `console.*` anywhere; the record is held as opaque locals, never a named field of a logged struct — a test asserts log-freeness across all paths.
- **[File / storage operations]** No findings — #44 performs **no** direct filesystem or `safeStorage` access; every byte goes through the injected `SecureStore`, which #42 owns (traversal-safe base64url name→path, atomic temp-then-rename writes, `0o600`/`0o700` perms, `ENOENT`→`null`, no `existsSync`-then-read TOCTOU). The store **name is a fixed constant** (`PAIRED_SERVER_NAME`), never derived from the QR/paste payload, so no untrusted input reaches the persistence path. The per-server-id future (Open questions §1) is flagged to validate the `serverId` before it becomes part of the name. Storage scope (`userData/secrets`) and encryption-at-rest are inherited from #42/ADR 0005.
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, no IPC channel, no `contextBridge` API, no custom protocol/deep-link, no navigation change. The standing renderer posture (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, deny-all permission handler in `index.ts`) is untouched. Process placement is correct: the token and server key live in the main process, unreachable from the renderer — the MUST-FIX category is satisfied by construction.
- **[Cryptographic primitives]** No findings — this module performs **no** cryptography. Encryption-at-rest is delegated wholly to #42's `safeStorage` (AEAD, OS-keychain-backed; a tampered/foreign blob throws rather than yielding attacker-chosen plaintext, and `load` propagates that throw). `server_static_pubkey` is stored as an **opaque string**; #44 neither validates nor uses it as a key — that is the transport's (`Noise_IK`) concern (#7/#30). No RNG, no nonce, no `(key, nonce)` reuse surface, and no secret comparison (so no `timingSafeEqual` need) in this ticket.
- **[Network & I/O]** No findings — N/A. This ticket has no socket, WebSocket, or TLS surface; it is serialize + persist + retrieve only. **Relay-URL validation is explicitly NOT done here** — `relay` is stored as an opaque string; the `wss://`-scheme allowlist / host check is #9's responsibility, which validates *before* calling `save` (§ Scope lock). The `maxPayload` / timeout / reconnect concerns belong to the transport tickets.
- **[Error messages, logs, telemetry]** No findings — log-free by construction (a test asserts no `console.*` fires across `save` + `load` + every error path). `MalformedPairedServerRecordError` has a **static** message and carries **no** field value (no token, no URL, no bytes); `EncryptionUnavailableError` (from #42) is likewise static. No telemetry, no crash-reporter surface added; the token never reaches an error object or stack trace.
- **[Concurrency]** No findings — no long-lived async task, timer, listener, or socket is created, so there is nothing to leak or cancel on teardown. `load` is a straight read (no memo/cache → no stale-token race after a re-pair); `save` a straight write. Concurrent `save`s are last-writer-wins with write atomicity inherited from `SecureStore` — acceptable for the milestone-1 single-writer usage, and no check-then-act-across-`await` on shared state exists (there is no shared mutable state).
- **[Threat model alignment]** Addressed: **token theft from disk** — the token is `safeStorage`-encrypted and keychain-bound (useless without the machine keychain), the bar #42/ADR 0005 raises. **Renderer compromise reaching the token** — blocked by process isolation (no IPC path to the module). **Corrupt / tampered stored blob** — `load` fails loud (propagates the decrypt throw / throws `MalformedPairedServerRecordError`) and never returns `null`, so an attacker cannot make a tampered record read as never-paired to hide tampering or induce a re-pair; recovery is the consumer's explicit decision (ADR 0005). **Accepted residual:** the decrypted token resides in main-process memory while in use (inherent to `safeStorage`'s decrypt-to-memory model; a JS `Uint8Array`/string cannot be reliably zeroised) — inherited from ADR 0005, not introduced here. **Out of scope, named:** relay-URL validation (#9), the live handshake using `server_static_pubkey` (#7/#30), token rotation/revocation propagation (daemon / pairing flow), and per-server-id keying (multi-server ticket).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
