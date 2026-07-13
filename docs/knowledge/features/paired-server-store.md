# Paired-server store

The desktop client's **persisted pairing record**: the `{server, relay, token, server_static_pubkey}` tuple that pairing yields (the QR/paste payload), serialized to one opaque JSON blob and stored through the [secure store](secure-store.md). Persisting it lets the client **reconnect to the same daemon and drive the `Noise_IK` handshake on every launch without re-pairing** — on connect the transport reads `server_static_pubkey` as the responder's static key and `token` for the relay/hello auth. This module neither validates nor uses either field cryptographically; it stores what it is given and returns it verbatim. It is the desktop equivalent of mobile's paired-server record (per-server-id on mobile; single-pyrybox here for milestone 1 — `protocol-mobile.md` § Pairing flow).

Introduced in [#44](../codebase/44.md); gained the symmetric erase — `clear()`, un-pairing the client back to not-paired — in [#172](../codebase/172.md). It lives **entirely** in `src/main` — the `token` (a bearer credential) and `server_static_pubkey` never reach the renderer, the preload bridge, or IPC ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It is the **second consumer** of the [secure store](secure-store.md) primitive ([#42](../codebase/42.md)), a near-twin of the [device static keypair](device-keypair.md) ([#43](../codebase/43.md)) — the same consume-the-primitive shape for a variable-length JSON record instead of a fixed 64-byte key blob.

## What it does

Gives the background process **one factory** — `createPairedServerStore({ secureStore })` — that returns a `{ save, load, clear }` handle over the pairing record:

- **`save(record)`** serializes the four fields to JSON bytes and persists them through the secure store. A second `save` **overwrites** (re-pair). Fail-closed: when the keychain is unavailable it throws `EncryptionUnavailableError` before any write.
- **`load()`** retrieves the record with the **absent-vs-undecryptable-vs-malformed** semantics that are the whole reason the module exists.
- **`clear()`** erases the persisted record ([#172](../codebase/172.md)) — the symmetric un-pair primitive, so a later `load()` reports not-paired again. Idempotent (a no-op when nothing is stored) and fail-closed (a delete failure propagates rather than being reported as success).

Those three methods carry two correctness properties:

1. **The token and server key never cross a boundary** — never returned to the renderer, never logged, never written outside the secure store.
2. **A tampered/corrupt record is never silently mistaken for never-paired** — `load` fails loud rather than returning `null` on a broken blob, so tampering is never hidden and a re-pair is never silently forced.

## How it works

**One** production file in `src/main/` (no second effectful adapter — serialization is pure), following the #42/#43 shape of a pure core over an injected effectful seam:

| File | Role |
|---|---|
| `src/main/pairedServerStore.ts` | The **pure core**: the `PairedServerRecord` type, `PairedServerStore` interface, `MalformedPairedServerRecordError`, `PAIRED_SERVER_NAME`, `createPairedServerStore(deps)`, and the internal JSON encode/decode. **Zero** `electron`/`fs` imports — only the **type** of `SecureStore` and the **type** `QrPayload`. Trivially unit-testable. |

### Public surface

```ts
/** The persisted paired-server record: the four QR-payload fields, verbatim. Aliasing QrPayload
 *  (not re-declaring the shape) makes drift from the wire contract a TYPE ERROR — any QrPayload
 *  change flows through. MAIN-PROCESS ONLY: `token` is a bearer credential and `server_static_pubkey`
 *  a static key; neither ever crosses to the renderer, preload, or IPC. */
export type PairedServerRecord = QrPayload   // { server, relay, token, server_static_pubkey }

/** The paired-server accessor. `save` persists (a second save overwrites = re-pair); `load`
 *  retrieves with the absent-vs-undecryptable-vs-malformed semantics below. Both main-process only.
 *  No in-memory cache: `load` reads through each call, so a re-pair is observed immediately. */
export interface PairedServerStore {
  save(record: PairedServerRecord): Promise<void>
  load(): Promise<PairedServerRecord | null>
}

/** The paired-server accessor plus the symmetric erase ([#172](../codebase/172.md)). The concrete
 *  return type of `createPairedServerStore` — deliberately NOT folded into the base
 *  `PairedServerStore`, so existing base-typed consumers (pairing-status, pairing-confirmation,
 *  daemon-connection) and their fakes need no `clear` stub. Only code holding the concrete store
 *  (the composition root, and the follow-up IPC surface #173) can reach the erase. */
export interface ClearablePairedServerStore extends PairedServerStore {
  /** Erase the persisted paired-server record. Idempotent; fail-closed. */
  clear(): Promise<void>
}

/** Thrown by `load` when a blob is PRESENT and decrypts, but is not a valid record — not JSON, not
 *  an object, or a missing / non-string field. Static message, carries NO field value. Lets the
 *  consumer branch to a "re-pair" recovery rather than treat corruption as never-paired. */
export class MalformedPairedServerRecordError extends Error {}

/** Milestone-1 single-pyrybox name. Mobile keys per server-id; appending `.${serverId}` is the
 *  deferred one-line multi-server change, enabled by the explicit constant + injectable `name`. */
export const PAIRED_SERVER_NAME = 'pyrycode.paired_server'

export function createPairedServerStore(deps: {
  secureStore: SecureStore   // #42, type-only import
  name?: string              // defaults to PAIRED_SERVER_NAME; injectable for tests + multi-server
}): ClearablePairedServerStore
```

- **The one effectful edge is injected.** Persistence is the [`SecureStore`](secure-store.md) (type-only import — no runtime coupling). Serialization (`JSON.stringify`/`parse`, `TextEncoder`/`TextDecoder`) is pure, so — unlike #43's keygen seam — there is no second effectful edge and no second production file. The core imports neither `electron` nor `fs`, so its unit tests run with a fake `SecureStore` and no keychain/fs.
- **`PairedServerRecord` aliases `QrPayload`.** The record shape is the wire contract, not a copy of it; a wire change is a compile error here, never a silent divergence (CLAUDE.md "don't drift the wire types").

### Serialization — one opaque JSON blob

The record is stored as UTF-8 JSON of exactly the four fields under `PAIRED_SERVER_NAME`, one opaque blob through the secure store. JSON mirrors the wire (which is JSON); field order is irrelevant (parse is order-insensitive; the blob is not signed). Internal helpers:

- `encodeRecord(record)` — `TextEncoder().encode(JSON.stringify({ server, relay, token, server_static_pubkey }))`. The four fields are **picked explicitly**, so a caller's stray fields are never written.
- `decodeRecord(blob)` — `TextDecoder().decode(blob)` → `JSON.parse`, then validate: the parsed value must be a non-null object whose four fields are all `string`. On a parse throw **or** a failed shape check → throw `MalformedPairedServerRecordError`. The result is re-picked (drops any extra keys). This is **structural** validation ("is this the record shape we wrote"), **not** semantic (relay-URL / token validity is #9's job, run before `save`).

### Core behavior

`createPairedServerStore` returns a plain `{ save, load }` handle — no cache, no memo, no timers:

- **`save(record)`** — `await secureStore.set(name, encodeRecord(record))`. `set` is fail-closed: on keychain-unavailable it throws `EncryptionUnavailableError` **before any write**, which propagates out of `save` (nothing persisted). Calling `save` again overwrites.
- **`load()`** — `const blob = await secureStore.get(name)`; if `blob === null` → return `null` (**absent = not paired**, the ONLY null path); else `return decodeRecord(blob)`. A decrypt failure inside `get` **propagates** (not caught); a decrypted-but-malformed blob throws `MalformedPairedServerRecordError`. No caching — a straight read each call, so a re-pair is observed immediately.
- **`clear()`** — `await secureStore.delete(name)`, keyed by this store's own `name` local, never a delete-by-literal. No `try`/`catch`: a delete failure propagates unchanged (reporting success while a live bearer token still sits on disk is the one behavior to avoid). `SecureStore.delete` is idempotent (absent name → no-op), so clearing a never-paired store resolves without throwing. Because `name` is a fixed constant distinct from the [device static keypair](device-keypair.md)'s `pyrycode.device_static`, `clear` structurally cannot touch the device identity.

The absent-vs-present distinction is exactly `secureStore.get`'s null-vs-non-null: a present blob that decodes to JSON `null`/`{}`/an incomplete object is **malformed**, not absent — it throws, it does not return `null`. This is the load-bearing property (a tampered record is never silently mistaken for never-paired).

### Data flow

```
 consumer (#9 to save, transport #7/#30 to load)   createPairedServerStore(core)   injected seam
  store.save(record) ──► encodeRecord ─► set(name, bytes) ─► SecureStore (fail-closed encrypt-at-rest)
  store.load() ───────► get(name) ─► SecureStore ─► blob?
                          null    → null  (not paired — the only null path)
                          present → decodeRecord(blob) ─► record   (throws on malformed;
                                                                    a decrypt failure already propagated)
```

Nothing in this flow reaches IPC, the preload, the renderer, or a `BrowserWindow`. The decrypted token exists only transiently in main-process memory; ciphertext is all that is ever persisted (by the secure store, keychain-bound).

## Concurrency & lifecycle

- **No store slice, no Zustand, no renderer state** — a main-process service object, not UI state. No event stream.
- **Single source of truth is the persisted blob.** `load` re-reads it each call (no in-memory cache), so a fresh process — or the same process after a `save` — converges to what is on disk. Simpler and safer than #43's memoized `ensure()`: there is no generate-once invariant to protect and no first-read race, because `save` is an explicit consumer action, never triggered implicitly by `load`.
- **No timers, listeners, or long-lived tasks** — nothing to cancel on teardown. Concurrent `save`s are last-writer-wins with write atomicity inherited from `SecureStore`/`fileSecretPersistence`'s temp-then-rename; the module adds no locking and needs none for the milestone-1 single-writer usage.

## Security properties

This module persists the pairing `token` (a bearer credential the relay/daemon accept as proof this client may drive the daemon); its correctness properties are its reason to exist (code-review verdict: **PASS**, `security-sensitive`):

- **Fail-loud, never fail-silent** — the only `null` `load` returns is genuine absence. A present-but-undecryptable blob propagates `get`'s throw; a decrypted-but-malformed blob throws `MalformedPairedServerRecordError`. An attacker cannot make a tampered record read as never-paired to hide tampering or induce a re-pair. Recovery is the **consumer's** explicit decision ([ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md)).
- **Token/server key never cross a boundary** — main-process only; zero `contextBridge`/`ipcMain`/`BrowserWindow`/preload surface, so a renderer compromise gains no path to the token (AC is structural). The record is marked MAIN-PROCESS-ONLY; a future ticket surfacing pairing state to the renderer must never return `token`/`server_static_pubkey`.
- **Encrypted at rest** — the token and server key are stored **only** via the secure store (Electron `safeStorage`, OS-keychain-bound, fail-closed) — never a plaintext file, never `localStorage`. `save` inherits fail-closed: on an unavailable keychain it throws before any write, so the token never lands as plaintext.
- **No crypto of its own** — this module performs no cryptography; `server_static_pubkey` is stored as an **opaque string** (the transport's `Noise_IK` concern, #7/#30). No RNG, no hand-rolled crypto.
- **Log-free by construction** — no `console.*` anywhere; the record is opaque locals, never named fields of a logged struct. `MalformedPairedServerRecordError` carries a static message with no token/URL/bytes. A test spies all six `console` methods across `save` + `load` + every error path and asserts none fire.
- **Fixed store name** — `PAIRED_SERVER_NAME` is a constant, never derived from the QR/paste payload, so no untrusted input reaches the persistence path (no traversal surface). The per-server-id future must validate the `serverId` before it becomes part of the name.
- **`clear()` shrinks the token-theft-from-disk window, and fails closed** ([#172](../codebase/172.md)) — the erase is a positive-posture change (it destroys the at-rest bearer `token` and `server_static_pubkey`), but only if a `delete` failure is never mistaken for success: `clear` has no `try`/`catch`, so a propagated error leaves the caller aware the token may still be on disk. Reachable from the renderer via the [unpair channel](unpair-channel.md) ([#173](../codebase/173.md)) — value-free by construction, so a renderer compromise can at most trigger the erase, never read or inject a secret.
- **`load()` gains a second, read-only renderer-reachable path** — the [server-info channel](server-info-channel.md) ([#339](../codebase/339.md)) exposes exactly `record.server`/`record.relay` (never `token`/`server_static_pubkey`) to the renderer, so a Settings screen can show which server is paired even while disconnected. Structurally distinct from `unpair`'s erase: this path only reads, and the handler names the two non-secret fields explicitly rather than forwarding the record.

## Edge cases and limitations

- **Nothing stored** — `load` returns `null` (not paired) — the only null path.
- **Keychain unavailable on `save`** — `set` throws `EncryptionUnavailableError`, which propagates out of `save`; nothing is written.
- **Stored blob undecryptable (tamper / keychain rotation)** — `get`'s throw propagates out of `load`; not caught, not returned as `null`.
- **Stored blob present, decrypts, but not a valid record** (bad JSON / missing / non-string field) — `MalformedPairedServerRecordError` (static message, no field value); not `null`.
- **Re-pair** — `save` overwrites; last-writer-wins, exactly one blob kept.
- **Caller stray fields** — dropped on both encode and decode; only the four record fields are ever persisted.
- **Clearing when never paired** — `clear()` resolves without throwing and leaves the not-paired state unchanged (`SecureStore.delete` is a documented no-op on an absent name).
- **`clear()` reaches the renderer via the [unpair channel](unpair-channel.md)** ([#173](../codebase/173.md)), on top of the concrete `ClearablePairedServerStore` type held by the composition root — no UI calls it yet (that is #166/#167). `clear()` also does not tear down a live Noise session or relay socket — it erases the at-rest record only; an active connection persists until next launch.
- **Wired at the composition root** — `src/main/index.ts` constructs `pairedServerStore = createPairedServerStore({ secureStore })` and threads it into `createPairingConfirmation`, the pairing-status handler, and the daemon-connection driver deps, all typed against the base `PairedServerStore` (the `clear()` widening is a subtype, so this needed zero edits). #9 (pairing input) calls `save()` after validating; the transport (#7/#30) calls `load()` at connect time.
- **Single pyrybox** — one record under `PAIRED_SERVER_NAME`. Per-server-id keying (`pyrycode.paired_server.<server-id>`) is a deferred one-line change via the injectable `name`. Token rotation/revocation remain out of scope.
- **Decrypted token in memory** — while in use the token resides in main-process memory (inherent to `safeStorage`'s decrypt-to-memory model; a JS string cannot be reliably zeroised). Inherited from ADR 0005, not introduced here.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the injected persistence surface this consumes.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the sibling consumer whose structure and security posture this mirrors; `clear()` structurally cannot touch it (distinct store name).
- [#44 codebase notes](../codebase/44.md) — implementation summary, patterns, and lessons.
- [#172 codebase notes](../codebase/172.md) — the `clear()` erase capability: widened-return-type design, fail-closed delegation to `secureStore.delete`, no fixture cascade.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — secret-at-rest via `safeStorage`, fail-closed, "recovery is a consumer decision".
- [Unpair channel](unpair-channel.md) / [#173 codebase notes](../codebase/173.md) — the renderer-triggered IPC channel + preload method that calls `clear()`.
- [Server-info channel](server-info-channel.md) / [#339 codebase notes](../codebase/339.md) — the renderer-triggered IPC channel that reads `record.server`/`record.relay` via `load()`, never `token`/`server_static_pubkey`.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model (token/keys never reach the renderer; mirror mobile).
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the ported wire types, including `QrPayload`, that `PairedServerRecord` aliases.
- Downstream consumers: the pairing input flow (#9, which validates then calls `save`) and the Noise_IK transport (#7/#30, which `load`s the record at connect time).
</content>
