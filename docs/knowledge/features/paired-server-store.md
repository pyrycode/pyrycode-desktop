# Paired-server store

The desktop client's **persisted pairing records**: the `{server, relay, token, server_static_pubkey}` tuple that pairing yields (the QR/paste payload), serialized to one opaque JSON blob and stored through the [secure store](secure-store.md). Persisting a record lets the client **reconnect to that daemon and drive the `Noise_IK` handshake on every launch without re-pairing** — on connect the transport reads `server_static_pubkey` as the responder's static key and `token` for the relay/hello auth. This module neither validates nor uses either field cryptographically; it stores what it is given and returns it verbatim.

The blob holds a **collection** of these tuples keyed by `server` id (#1069), so pairing a second machine adds beside the first instead of silently discarding it. Mobile, by contrast, holds a single record (`PairedServerStore.kt`) — an earlier version of this module's own doc comment claimed the opposite (mobile per-server-id, desktop deferred single-pyrybox) and both halves were wrong; #1069 corrected it.

Introduced in [#44](../codebase/44.md); gained the symmetric erase — `clear()`, un-pairing the client back to not-paired — in [#172](../codebase/172.md); gained the collection layout, replace-by-key, and the by-id read/erase in #1069. It lives **entirely** in `src/main` — the `token` (a bearer credential) and `server_static_pubkey` never reach the renderer, the preload bridge, or IPC ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It is the **second consumer** of the [secure store](secure-store.md) primitive ([#42](../codebase/42.md)), a near-twin of the [device static keypair](device-keypair.md) ([#43](../codebase/43.md)) — the same consume-the-primitive shape for a variable-length JSON record instead of a fixed 64-byte key blob.

## What it does

Gives the background process **one factory** — `createPairedServerStore({ secureStore })` — that returns a `MultiPairedServerStore` handle (`{ save, load, loadById, list, clear, clearServer }`) over the pairing collection:

- **`save(record)`** adds `record` to the collection or, when an entry already holds its `server` id, replaces that entry — the saved record becomes the most recently saved one, so it is what a plain `load()` reports next (#1069; before that a second `save` blindly overwrote the one slot). Fail-closed on a keychain-unavailable `EncryptionUnavailableError`. The one exception to this module's otherwise-strict reads: a stored collection that is present but unreadable (`MalformedPairedServerRecordError`) is treated as empty and **overwritten** rather than rejected, because re-pairing is the app's only in-UI recovery from a corrupt blob — see § Security properties. A genuine decrypt failure still propagates from `save` unchanged.
- **`load()`** retrieves the **most recently saved** entry, with the absent-vs-undecryptable-vs-malformed semantics that are the whole reason the module exists — `null` only when the collection is empty.
- **`loadById(serverId)`** retrieves one entry by its `server` id, or `null` when no entry holds it (#1069).
- **`list()`** retrieves every paired entry, oldest-saved first; `[]` when nothing is paired (#1069).
- **`clear()`** erases the **whole** persisted collection ([#172](../codebase/172.md)) — the symmetric un-pair primitive, so a later `load()` reports not-paired again regardless of how many servers were held. Idempotent (a no-op when nothing is stored) and fail-closed (a delete failure propagates rather than being reported as success).
- **`clearServer(serverId)`** erases exactly the entry held under `serverId`, leaving every other entry paired and readable (#1069). Idempotent — an unheld id resolves without writing, so an erase that matches nothing never triggers a needless keychain round-trip or a spurious `EncryptionUnavailableError`. Unlike `save`, `clearServer` stays **strict** on an unreadable collection: a partial erase has nothing to keep, so it rejects rather than silently reporting a token gone from disk while the bytes holding it are untouched. Since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) it resolves a `ClearServerOutcome` (`{ matched, remaining }`) rather than `void` — see below.

Those methods carry two correctness properties:

1. **The token and server key never cross a boundary** — never returned to the renderer, never logged, never written outside the secure store. `loadById` / `list` / `clearServer` add no IPC channel, no preload method, and no `src/shared/` export (#1069 AC6) — they are reachable only from `src/main`.
2. **A tampered/corrupt record is never silently mistaken for never-paired** — every read but `save` fails loud rather than returning `null`/`[]` on a broken blob, so tampering is never hidden and a re-pair is never silently forced. `save` is the deliberate exception, and only for the malformed case (see above).

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

/** The paired-server accessor. `save` adds a record to the collection or replaces the entry that
 *  already holds its `server` id (#1069 — before that a second save overwrote the one slot); a
 *  stored collection that is present but unreadable is overwritten rather than rejected, so
 *  re-pairing stays the recovery from a corrupt blob (a decrypt failure still rejects). `load`
 *  retrieves the most recently saved entry with the absent-vs-undecryptable-vs-malformed semantics
 *  below. Both main-process only. No in-memory cache: `load` reads through each call, so a re-pair
 *  is observed immediately. */
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
  /** Erase EVERY persisted paired-server record. Idempotent; fail-closed. */
  clear(): Promise<void>
}

/** The collection accessors (#1069), layered above `ClearablePairedServerStore` for exactly the
 *  reason `clear` was layered above the base in #172: no interface an existing fake is typed
 *  against gains a required member, so the ~nine structural fakes across daemon-connection,
 *  pairing-confirmation, pairing-status, server-info and unpair keep compiling untouched.
 *  `createPairedServerStore` widens its return type to this — a subtype relation, so the
 *  composition root and all five call sites need no edit. The by-id erase is a distinct method
 *  rather than an optional parameter on `clear`: an optional parameter would still type-check
 *  against every zero-argument fake and then be silently ignored by each of them, which is the
 *  worse failure. */
export interface MultiPairedServerStore extends ClearablePairedServerStore {
  loadById(serverId: string): Promise<PairedServerRecord | null>
  list(): Promise<PairedServerRecord[]>
  clearServer(serverId: string): Promise<ClearServerOutcome>
}

/** What one `clearServer` call did ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)).
 *  Two derived facts, computed inside the mutate queue from the same read the erase used, and
 *  nothing else — no record, no id, no field value — so holding this outcome is not holding a
 *  credential. Widened from `void` because [unpairHandler](unpair-channel.md)'s per-server arm needs
 *  both answers atomically with the erase and is typed to hold no read capability of its own:
 *  `matched` (did an entry hold this id — an unheld id otherwise resolves silently, indistinguishably
 *  from a hit) and `remaining` (is anything still paired — decides whether the single-slot host label
 *  survives). `clearServer` had no production caller before #1149, so nothing depended on the old
 *  `void` return. */
export interface ClearServerOutcome {
  /** True when an entry held the id and was erased; false ⇒ nothing matched, nothing was written. */
  matched: boolean
  /** How many entries are still paired after this call. A count only, never the entries themselves. */
  remaining: number
}

/** Thrown by every READ (`load`, `loadById`, `list`, `clearServer`) when a blob is PRESENT and
 *  decrypts, but is not a valid collection — not JSON, neither accepted shape (§ Serialization), a
 *  missing / non-string field, or a repeated `server` id. Static message, carries NO field value.
 *  Lets the consumer branch to a "re-pair" recovery rather than treat corruption as never-paired —
 *  and that recovery is real *because* `save` alone overwrites this state instead of rejecting on
 *  it; a decrypt failure is deliberately not folded into that swallow (see § Core behavior). */
export class MalformedPairedServerRecordError extends Error {}

/** The ONE store name every paired server is held under, and it stays one name on purpose (#1069):
 *  `SecretPersistence` maps a name onto a storage key, and the `server` id is untrusted QR/paste
 *  input, so deriving the name from it would put attacker-chosen text on the persistence path. An
 *  earlier version of this comment claimed the opposite of both of these — that mobile keys per
 *  server-id and that appending the id here was a deferred one-line change — and was wrong on both
 *  counts (mobile holds a single record; appending the id is the path this design rejects). `name`
 *  stays injectable as a test seam only. */
export const PAIRED_SERVER_NAME = 'pyrycode.paired_server'

export function createPairedServerStore(deps: {
  secureStore: SecureStore   // #42, type-only import
  name?: string              // defaults to PAIRED_SERVER_NAME; injectable as a test seam only
}): MultiPairedServerStore
```

- **The one effectful edge is injected.** Persistence is the [`SecureStore`](secure-store.md) (type-only import — no runtime coupling). Serialization (`JSON.stringify`/`parse`, `TextEncoder`/`TextDecoder`) is pure, so — unlike #43's keygen seam — there is no second effectful edge and no second production file. The core imports neither `electron` nor `fs`, so its unit tests run with a fake `SecureStore` and no keychain/fs.
- **`PairedServerRecord` aliases `QrPayload`.** The record shape is the wire contract, not a copy of it; a wire change is a compile error here, never a silent divergence (CLAUDE.md "don't drift the wire types").
- **The collection is kept an `Array`, deliberately never a plain-object index by `server` id** (Phase-B security-review guard, #1069) — matching is `===` / `find` / `filter` over the array. An id of `__proto__` or `constructor` is a prototype-pollution hazard against an object literal; a `Map` would also be safe, but the array sidesteps the question entirely since it was already the chosen persisted layout.

### Serialization — one opaque JSON blob, holding an array

The collection is stored as UTF-8 JSON under `PAIRED_SERVER_NAME`, one opaque blob through the secure store — a **JSON array** of the four-field records, ordered oldest-saved first / most-recently-saved last (#1069). JSON mirrors the wire (which is JSON); the blob is not signed. Internal helpers:

- `pickFields(record)` — returns exactly the four fields, so a caller's — or a stored blob's — stray fields are never re-persisted, including one that arrived in a legacy blob and is only being carried forward.
- `encodeCollection(records)` — `TextEncoder().encode(JSON.stringify(records.map(pickFields)))`.
- `parseRecord(value)` — validates one parsed value as a record: a non-null, non-array object whose four fields are all `string`; the result is built field-by-field from the narrowed values (no cast, and it drops any extra keys). On a shape failure → `MalformedPairedServerRecordError`. This is **structural** validation ("is this the record shape we wrote"), **not** semantic (relay-URL / token validity is #9's job, run before `save`).
- `decodeCollection(blob)` — `TextDecoder().decode(blob)` → `JSON.parse`, then accepts **either** at-rest shape: an **array** (the collection form every write since #1069 produces, in saved order) or a bare **object** (a blob the pre-#1069 single-record version wrote, read back as a one-entry collection — the migration path, § Edge cases). Anything else — a parse throw, a string, a number, JSON `null` — throws `MalformedPairedServerRecordError`, never `null` and never a silently empty collection. `Array.isArray` is checked **before** the object branch, since an array is also an object and would otherwise fall into the four-field check and throw for the wrong reason. A **repeated `server` id** inside the array is also malformed: the collection is keyed by that id, so two entries claiming it have no defined meaning, and silently keeping one would let a smuggled duplicate make `loadById` return one token while `list` shows another.

Migration is **read-time only** — `decodeCollection` never writes. A lazy rewrite-on-read would put a `secureStore.set` on `load`'s path, where it could throw `EncryptionUnavailableError` inside a call that has never had to handle one. Every write path (`save`, `clearServer`) writes the array form, so once a save has happened the legacy object shape is never written again.

### Core behavior

`createPairedServerStore` returns the `MultiPairedServerStore` handle — no cache, no memo:

- **`read()`** (internal) — `const blob = await secureStore.get(name)`; `blob === null` → `[]` (**absent = not paired**, the only empty-without-throwing path); else `decodeCollection(blob)`. A decrypt failure inside `get` **propagates**; a decrypted-but-malformed blob throws `MalformedPairedServerRecordError`. Every read method (`load`, `loadById`, `list`) calls this directly and stays strict.
- **`save(record)`** — reads through `readForSave` (not `read`), which is `read()` with one narrow catch: a caught `MalformedPairedServerRecordError` is treated as `[]`, so `save` **overwrites** a corrupt collection instead of rejecting on it; a decrypt failure is **not** caught and still propagates. Drops any entry already holding `record.server`, appends `record`, writes the array via `encodeCollection`. `set` is fail-closed: on keychain-unavailable it throws `EncryptionUnavailableError` before any write. See § Security properties for why `save` alone gets this swallow.
- **`load()`** — the **last** element of `read()`'s result (`entries[entries.length - 1] ?? null`). Entry order *is* the persisted order, so "most recently saved" survives a relaunch with no explicit active pointer — the same array that gives AC1 its persistence also gives `load()` its answer.
- **`loadById(serverId)`** — `read()`, then `find(entry => entry.server === serverId) ?? null`. Matched with plain `===` against a decoded entry's own field — `serverId` is caller-supplied but never becomes a store name, a path, or an object key, so an id like `__proto__` is inert here.
- **`list()`** — `read()`, unwrapped.
- **`clear()`** — `await secureStore.delete(name)`, keyed by this store's own `name` local, never a delete-by-literal. No `try`/`catch`: a delete failure propagates unchanged. `SecureStore.delete` is idempotent (absent name → no-op). Erases the **whole** collection, not one entry.
- **`clearServer(serverId)`** — `read()` (strict — no swallow here), filters out the matching entry. No match → resolves `{ matched: false, remaining: entries.length }` **without writing** (idempotent, no needless keychain round-trip). The filtered result empty → `secureStore.delete(name)` instead of writing `[]` (so "no blob" stays the single at-rest representation of not-paired) and resolves `{ matched: true, remaining: 0 }`. Otherwise one `secureStore.set` — never delete-then-write, so a failure here leaves the prior blob whole and throws rather than half-erasing — and resolves `{ matched: true, remaining: next.length }`. All three outcomes are computed and returned from **inside** the same `mutate` call the erase runs on, off the same `entries` the filter used ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)): "did anything match" and "what remains" can never disagree with the write that just happened, and no concurrent `save` can land between the read and the answer.

**The three mutators (`save`, `clear`, `clearServer`) run through a per-store promise chain**, serializing them against each other (#1069). Before the collection layout `save` was a blind write and could not race itself; keyed by id it became read-modify-write, and two interleaving across the `await` would drop one server's entry — reintroducing this ticket's own defect from the other direction. The chain continues across a rejected operation (each link swallows its own outcome before advancing the queue, so one failed mutation never wedges the next), and its own copy of the outcome is swallowed so no rejection escapes unhandled — the caller still receives the original promise. Reads (`load`, `loadById`, `list`) stay **off** the chain: each is a single `get` with nothing to interleave, and queueing them would change the five existing call sites' latency for no correctness gain.

The absent-vs-present distinction is exactly `secureStore.get`'s null-vs-non-null: a present blob that decodes to a malformed shape is **malformed**, not absent — every read but `save` throws rather than returning `null`/`[]`. This is the load-bearing property (a tampered record is never silently mistaken for never-paired), narrowed by exactly one exception: `save` treats malformed-and-present as if it were absent, because re-pairing is the only in-app recovery from that state (§ Security properties). **That swallow is all-or-nothing per blob**, not per entry — an array holding one bad element among several otherwise-valid ones is discarded whole, the same as a wholly unparseable blob. In practice this is unreachable independent of #1069: `safeStorage` is authenticated, so a byte-level tamper surfaces as a decrypt failure (which still propagates, unswallowed), not as malformed-but-decrypting plaintext — and all-or-nothing is the same posture the duplicate-id reject already takes.

### Data flow

```
 consumer (#9 to save, transport #7/#30/daemonConnection to load)   createPairedServerStore(core)
  store.save(record) ──► readForSave (malformed→[], decrypt-failure→throw) ─► replace-by-key
                       ─► encodeCollection ─► set(name, bytes) ─► SecureStore (fail-closed at-rest)
  store.load() ───────► read() ─► SecureStore.get(name) ─► blob?
                          null    → []            → null   (not paired — the only null path)
                          present → decodeCollection(blob) → last entry, or null if empty
                                    (throws MalformedPairedServerRecordError on either bad shape or a
                                     duplicate id; a decrypt failure has already propagated)
  store.loadById(id) / store.list() ─► read() ─► find-by-id / unwrap, same strict semantics as load()
  store.clearServer(id) ─► read() (strict) ─► filter out id ─► delete(name) if now empty, else set()
```

Nothing in this flow reaches IPC, the preload, the renderer, or a `BrowserWindow`. The decrypted token exists only transiently in main-process memory; ciphertext is all that is ever persisted (by the secure store, keychain-bound).

## Concurrency & lifecycle

- **No store slice, no Zustand, no renderer state** — a main-process service object, not UI state. No event stream.
- **Single source of truth is the persisted blob.** Every read goes through to `secureStore.get` (no in-memory cache), so a fresh process — or the same process after a `save` — converges to what is on disk, and a `save` is observed by the very next `load`. Simpler and safer than #43's memoized `ensure()`: there is no generate-once invariant to protect and no first-read race, because `save` is an explicit consumer action, never triggered implicitly by `load`.
- **The three mutators are serialized against each other** (#1069) — `save`, `clear`, `clearServer` all run through one per-store promise chain, so a read-modify-write started by one completes before the next begins. This is new since #1069: pre-collection `save` was a single blind write with nothing to race. Reads are not serialized against the mutators or each other. In-process only — one Electron main process — and mid-write atomicity is inherited unchanged from `fileSecretPersistence`'s temp-then-rename; cross-process concurrent writers are out of scope.
- **No timers, listeners, or long-lived tasks** — nothing to cancel on teardown. The mutation chain holds only the in-flight operation and settles on its own; there is nothing to await at shutdown.

## Security properties

This module persists the pairing `token` (a bearer credential the relay/daemon accept as proof this client may drive the daemon); its correctness properties are its reason to exist (code-review verdict: **PASS**, `security-sensitive`):

- **Fail-loud, never fail-silent — with one deliberate, narrow exception.** The only `null` `load()`/`loadById()` (and `[]` from `list()`) return is genuine absence. A present-but-undecryptable blob propagates `get`'s throw from every read method, including `save`; a decrypted-but-malformed blob throws `MalformedPairedServerRecordError` from `load`, `loadById`, `list`, and `clearServer`. `save` alone treats a malformed (but not undecryptable) collection as empty and overwrites it (§ Core behavior's `readForSave`) — this is a considered exception, not a regression of the property: an attacker still cannot make a tampered record read as never-paired through any *read*, and cannot induce a re-pair silently, since overwriting only happens inside an explicit `save` call the consumer already initiated. Recovery from a genuinely undecryptable blob is still the **consumer's** explicit decision ([ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md)).
  - **Why `save` gets the exception (verifier MUST FIX, PR #1116, resolved 2026-09-05):** the first design made `save` strict, which meant a corrupt blob became a permanent lockout. Traced through the app: a malformed/undecryptable blob makes `pairingStatusHandler` report `{ status: 'error' }`, `routeForStatus` sends every non-`paired` status to `welcome`, `welcome`'s only action is the Pair CTA, and that path ends at `pairingConfirmation` → `store.save(...)` — which, made strict, threw and turned into `{ ok: false, reason: 'persist-failed' }`. The one consumer that could recover the state, `unpairHandler` → `clear()` (which does not read), lives behind Settings on the already-`paired` route and is unreachable from `welcome`. The user looped welcome → pair → `persist-failed` with no in-app exit; recovery meant hand-deleting the blob under `app.getPath('userData')`. Swallowing the malformed case in `save` alone restores the pre-#1069 recovery exactly. A **decrypt** failure is deliberately *not* folded into the swallow: it may be transient keychain state (rotation, a temporarily locked keychain), and overwriting on it would silently discard every real pairing the blob holds — worse than failing loudly. `clearServer` stays fully strict for the same reason a partial erase can't be allowed to lie: it has no consumer yet, so being strict opens no dead end, and `clear()` (which never reads) remains reachable to fully erase a corrupt blob.
- **Token/server key never cross a boundary** — main-process only; zero `contextBridge`/`ipcMain`/`BrowserWindow`/preload surface, so a renderer compromise gains no path to the token (AC is structural). `loadById`, `list`, and `clearServer` add none of these either (#1069 AC6). The record is marked MAIN-PROCESS-ONLY; a future ticket surfacing pairing state to the renderer must never return `token`/`server_static_pubkey`.
- **Encrypted at rest — N tokens in one blob is not a marginal exposure increase.** The token and server key are stored **only** via the secure store (Electron `safeStorage`, OS-keychain-bound, fail-closed) — never a plaintext file, never `localStorage`. `save` inherits fail-closed on the write side unchanged: on an unavailable keychain it throws before any write. Since #1069 the one blob holds every paired server's token rather than one, but this is **not** a new at-rest risk: `safeStorage` binds every blob to the same OS-keychain app key, so an attacker able to decrypt one blob could already decrypt any blob it produced — N tokens in one blob and N single-token blobs are equivalent exposure, and keeping it one blob is what keeps the untrusted `server` id out of the persistence path (next bullet).
- **No crypto of its own** — this module performs no cryptography; `server_static_pubkey` is stored as an **opaque string** (the transport's `Noise_IK` concern, #7/#30). No RNG, no hand-rolled crypto. `crypto.timingSafeEqual` is deliberately not used for the `serverId` match in `loadById`/`clearServer`: `server` is a public identifier that already crosses IPC through the server-info channel, not a secret, so a plain `===` leaks nothing a timing oracle could exploit.
- **Log-free by construction** — no `console.*` anywhere; the record is opaque locals, never named fields of a logged struct. `MalformedPairedServerRecordError` carries a static message with no token/URL/**array index** — an index would leak how many servers are paired, which is why the duplicate-id and bad-element rejects stay as unspecific as the original shape reject. A test spies all six `console` methods across every method, including the `save`-over-malformed swallow path (#1069), and asserts none fire.
- **Fixed store name, and the reasoning is stronger than it looks.** `PAIRED_SERVER_NAME` is a constant, never derived from the QR/paste payload, so no untrusted input reaches `SecretPersistence`'s name→storage-key mapping (no traversal surface). #1069 is the ticket that actually decided this rather than deferred it: an earlier version of this module's comment proposed `${PAIRED_SERVER_NAME}.${serverId}` as the "deferred" multi-server path, and #1069 rejected it on exactly this ground — the `server` id is untrusted paste/QR input, so it must never become part of a name that maps onto a storage key. The collection lives inside one blob under one name for that reason, permanently, not as a milestone-1 shortcut.
- **The collection is an `Array`, never a plain-object index by `server` id** (Phase-B guard from #1069's security review, honored in the shipped code) — `loadById`/`clearServer` match with `===`/`find`/`filter` over the array. An object literal keyed by an attacker-influenced `server` id (`__proto__`, `constructor`) would be a prototype-pollution hazard; the array sidesteps the question entirely.
- **`clear()` shrinks the token-theft-from-disk window, and fails closed** ([#172](../codebase/172.md)) — the erase is a positive-posture change (it destroys the **whole collection's** at-rest bearer tokens and server keys, since #1069), but only if a `delete` failure is never mistaken for success: `clear` has no `try`/`catch`, so a propagated error leaves the caller aware a token may still be on disk. Reachable from the renderer via the [unpair channel](unpair-channel.md) ([#173](../codebase/173.md)) — value-free by construction, so a renderer compromise can at most trigger the erase, never read or inject a secret. `clearServer` (#1069) shrinks that same window **per server** instead of all-or-nothing, and is reachable from the renderer as of [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) through the same unpair channel's per-server arm — typed against `Pick<MultiPairedServerStore, 'clearServer'>` there, so that handler cannot reach `load`/`loadById`/`list`/`save`/`clear` even by mistake. No UI wires it yet; [#1090](https://github.com/pyrycode/pyrycode-desktop/issues/1090) is the visible control.
- **`load()` gains a second, read-only renderer-reachable path** — the [server-info channel](server-info-channel.md) ([#339](../codebase/339.md)) exposes exactly `record.server`/`record.relay` (never `token`/`server_static_pubkey`) to the renderer, so a Settings screen can show which server is paired even while disconnected. Structurally distinct from `unpair`'s erase: this path only reads, and the handler names the two non-secret fields explicitly rather than forwarding the record. `loadById` and `list` have **no** renderer consumer (#1069 is main-process-reads-only, deliberately, and #1117's [connection registry](daemon-connection-registry.md#the-connection-registry-1117) — the one consumer of both since #1117 — is itself main-process-only and forwards neither); a future ticket exposing `list()` to the renderer must project the same two non-secret fields per entry and must not forward records.
- **Replace-by-key is a silent-eviction surface against a hostile pairing payload — deliberately out of scope for #1069.** `save` replaces by `record.server`, which originates in the QR/paste payload. A malicious payload claiming an *already-paired* server's id evicts that entry rather than adding beside it, with no warning — the user's mental model of "pair another server" is additive. This isn't newly introduced so much as newly *observable*: reaching `save` still requires the user to confirm the server-key fingerprint through [pairing confirmation](pairing-confirmation.md), so an attacker who gets this far already owns that pairing. The residual harm — losing a legitimate server's pairing without being told — belongs to the future ticket that lets the user see and choose among paired servers; that UI must say which entry a pairing will replace.

## Edge cases and limitations

- **Nothing stored** — every read reports empty: `load`/`loadById` return `null`, `list` returns `[]` — the only "not paired" path.
- **Keychain unavailable on `save`** — `set` throws `EncryptionUnavailableError`, which propagates out of `save`; nothing is written. Unaffected by the malformed-collection swallow, which only ever catches `MalformedPairedServerRecordError`.
- **Stored blob undecryptable (tamper / keychain rotation)** — `get`'s throw propagates out of every method, `save` included; not caught, not returned as empty.
- **Stored blob present, decrypts, but not a valid collection** (bad JSON, neither accepted shape, a missing/non-string field, or a repeated `server` id) — `MalformedPairedServerRecordError` from `load`/`loadById`/`list`/`clearServer` (static message, no field value, no array index). `save` alone treats this one case as an empty collection and overwrites it (§ Security properties) — the exception is scoped to *malformed*, never to a decrypt failure, and it is **all-or-nothing per blob**: an array with a single bad element among several otherwise-valid ones is discarded whole, exactly like a wholly unparseable blob (unreachable independent of #1069 in practice, since `safeStorage` is authenticated and a byte-level tamper surfaces as a decrypt failure instead).
- **Re-pair (same `server` id)** — `save` replaces that entry by key; the replacement becomes the most recently saved, so `load()` reports it next. Every other entry is untouched.
- **Pair a second, different server** — `save` appends; both entries survive, both are in `list()`, and `load()` now reports the newer one (#1069 — before this ticket the second `save` silently discarded the first, which was the defect this ticket fixes).
- **Caller stray fields, on write or in a stored blob** — dropped by `pickFields` on every encode; only the four record fields are ever persisted, including entries carried forward from a legacy blob.
- **Legacy single-record blob (pre-#1069)** — read back as a one-entry collection, four fields verbatim, reachable by `load()` and by `loadById(server)`; the object shape is never written again once any `save` has run (§ Serialization — migration is read-time only).
- **Clearing when never paired** — `clear()` resolves without throwing and leaves the not-paired state unchanged (`SecureStore.delete` is a documented no-op on an absent name). `clearServer(id)` on an id nothing holds also resolves without writing, and without even a keychain round-trip.
- **Erasing the last entry via `clearServer`** — deletes the whole blob rather than persisting `[]`, so "no blob" stays the single at-rest representation of not-paired; the end state is then identical to `clear()`.
- **`clear()` reaches the renderer via the [unpair channel](unpair-channel.md)** ([#173](../codebase/173.md)), on top of the concrete store type held by the composition root; since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) `clearServer` reaches it too, through that channel's per-server arm — `loadById` and `list` still have **no** renderer path (main-process-reads-only stays deliberate for those two; the sidebar/Settings surfacing of more than one server is a later ticket). `clear()`/`clearServer()` also do not tear down a live Noise session or relay socket directly — they erase the at-rest record(s) only; [the connection registry](daemon-connection-registry.md#the-connection-registry-1117)'s `reconcile()`, fired as the `onUnpaired` callback on both unpair arms, is what drops the corresponding live connection(s).
- **Wired at the composition root** — `src/main/index.ts` constructs `pairedServerStore = createPairedServerStore({ secureStore })` and threads it into `createPairingConfirmation`, the pairing-status handler, `unpairHandler`'s whole-collection arm, `serverInfoHandler`, — since [#1117](daemon-connection-registry.md#the-connection-registry-1117) — the [connection registry](daemon-connection-registry.md#the-connection-registry-1117) rather than directly into a single `daemonConnection` driver's deps, and — since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) — `unpairHandler`'s **second**, per-server registration. Five of the six sites are typed against the base `PairedServerStore`/`ClearablePairedServerStore` (the widening to `MultiPairedServerStore` is a subtype, so none of them or their ~nine structural test fakes needed an edit across #1069, #1117 or #1149); the #1149 site alone is typed `Pick<MultiPairedServerStore, 'clearServer'>`, narrower than any of the others. #9 (pairing input) calls `save()` after validating. The registry calls `list()` on every reconcile and reads each held connection's own record through a `loadById(serverId)` view — `load()` (the "most recently saved" answer) is now reached only by the registry's own not-paired stand-in, not by every connection; before #1117 every connection called `load()` directly, so pairing a second server while connected to the first silently moved the connection to the second, which #1117 is what stops.
- **No active pointer — "active" is simply "most recently saved."** #1069 deliberately did not add one: reproducing today's observable behaviour (the sidebar and Settings both show whichever server you just paired) needs only array order, which a relaunch preserves for free. A real, user-chosen active pointer belongs to the later ticket that lets the user pick among several paired servers.
- **The host label store stays single-entry** ([host-label-store.md](host-label-store.md)) — it names only the active server and was deliberately left alone by #1069: inert while no UI shows more than one paired server.
- **No entry cap on the collection, deliberately** — each entry costs a completed, human-confirmed pairing (through [pairing confirmation](pairing-confirmation.md)), and a hostile blob large enough to matter would first have to be valid `safeStorage` ciphertext, which presupposes the OS keychain key is already compromised. A cap would defend against a failure mode unreachable from an untrusted position (#1069 security review).
- **Decrypted token in memory** — while in use each token resides in main-process memory (inherent to `safeStorage`'s decrypt-to-memory model; a JS string cannot be reliably zeroised). Inherited from ADR 0005, not introduced here.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the injected persistence surface this consumes.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the sibling consumer whose structure and security posture this mirrors; `clear()` structurally cannot touch it (distinct store name).
- [#44 codebase notes](../codebase/44.md) — implementation summary, patterns, and lessons.
- [#172 codebase notes](../codebase/172.md) — the `clear()` erase capability: widened-return-type design, fail-closed delegation to `secureStore.delete`, no fixture cascade.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — secret-at-rest via `safeStorage`, fail-closed, "recovery is a consumer decision".
- [Unpair channel](unpair-channel.md) / [#173 codebase notes](../codebase/173.md) — the renderer-triggered IPC channel + preload method that calls `clear()`; since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) that channel's sibling per-server arm calls `clearServer()` instead, typed against nothing else in this module.
- [Server-info channel](server-info-channel.md) / [#339 codebase notes](../codebase/339.md) — the renderer-triggered IPC channel that reads `record.server`/`record.relay` via `load()`, never `token`/`server_static_pubkey`.
- [Daemon connection](daemon-connection.md) / [Daemon-event channel plumbing](daemon-event-channel-plumbing.md) — #1068 stamps every daemon event with `record.server` (as `DaemonConnectionDeps.serverId`), the same field and the same never-`token`/`server_static_pubkey` containment as the server-info channel above.
- [The connection registry](daemon-connection-registry.md#the-connection-registry-1117) / #1117 — the sole consumer of `list()` and of `loadById` (via a per-server view), reconciling the set of live `daemonConnection` instances against this store's collection on every pairing/unpair signal. Its own store handle is a `Pick` without `clear`/`clearServer`: it can read the collection but never erase from it. Its `reconcile()` is the `onUnpaired` callback both [unpair channel](unpair-channel.md) arms wire, so it is also what turns either arm's erase into the matching live-connection drop — since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149), that includes the per-server arm's single-connection drop.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model (token/keys never reach the renderer; mirror mobile).
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the ported wire types, including `QrPayload`, that `PairedServerRecord` aliases.
- [Host label store](host-label-store.md) / [#822](../codebase/822.md) — the sidebar host nickname, deliberately **not** a field here: since `PairedServerRecord` aliases `QrPayload`, adding a label the daemon never sees would drift a wire type, so it persists through its own secure-store-backed module instead. Stays single-entry after #1069 (see § Edge cases).
- **#1069** (shipped) — turned the single record into the `server`-id-keyed collection described throughout this document: `MultiPairedServerStore` (`loadById`, `list`, `clearServer`) layered above the unchanged `ClearablePairedServerStore`, one blob under the unchanged `PAIRED_SERVER_NAME`, read-time-only migration from the legacy shape, and the `save`-alone malformed-collection swallow added in rework after a verifier MUST FIX (PR #1116; round 1 FAIL, round 2 PASS with 2 non-blocking NITs). Zero fixture cascade across the five existing call sites and their ~nine structural test fakes. No codebase note — the per-ticket archive is frozen as of 2026-08-26; this document is the record.
- Downstream consumers: the pairing input flow (#9, which validates then calls `save`), and — since #1117 — the [connection registry](daemon-connection-registry.md#the-connection-registry-1117), which calls `list()` to reconcile its connection set and hands each connection a `loadById(serverId)` view for `daemonConnection`'s `loadDialConfig` to call on every dial and automatic reconnect (#7/#30/#83). `load()` itself (the "most recently saved" answer) is reached only by the registry's not-paired stand-in, not by any per-server connection.
</content>
