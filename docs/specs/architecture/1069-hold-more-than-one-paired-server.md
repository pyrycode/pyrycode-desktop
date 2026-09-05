# #1069 — Hold more than one paired server

Turn the paired-server store's single record into a **collection keyed by server id**, under the same
store name, with no change above the store.

## Files read

Codegraph is not initialized in this repository — every `mcp__codegraph__*` call fails with
"CodeGraph not initialized" — so this reading list was built with Grep and Read instead. Noted here
because the brief expects the list to be codegraph-derived.

| Path | Symbol | Why it matters |
|---|---|---|
| `src/main/pairedServerStore.ts` | `createPairedServerStore`, `PairedServerStore`, `ClearablePairedServerStore`, `PAIRED_SERVER_NAME`, `encodeRecord`, `decodeRecord`, `MalformedPairedServerRecordError` | The only production file this ticket changes. |
| `src/main/pairedServerStore.test.ts` | `fakeSecureStore`, `RECORD`, `seed` | The Map-backed fake and seeding helper the new specs reuse; two of its existing assertions read the persisted blob directly and must follow the layout change. |
| `src/main/secureStore.ts` | `SecureStore`, `SecretPersistence`, `EncryptionUnavailableError` | Name→bytes with **no list operation**, so the collection must be one serialized value under one name. `SecretPersistence` maps a name onto a storage key — the reason the name must stay a constant. |
| `src/shared/wire/types.ts` | `QrPayload` | The four fields `PairedServerRecord` aliases; the entry shape is preserved verbatim. |
| `src/main/pairingStatusHandler.ts` | `registerPairingStatusHandler` | Call site 1 — typed against base `PairedServerStore`, uses `load()`. |
| `src/main/serverInfoHandler.ts` | `registerServerInfoHandler` | Call site 2 — base-typed, uses `load()`, projects exactly `server` + `relay` across IPC. |
| `src/main/pairingConfirmation.ts` | `createPairingConfirmation` | Call site 3 — base-typed, uses `save(record)`. |
| `src/main/unpairHandler.ts` | `registerUnpairHandler` | Call site 4 — the **only** consumer typed against `ClearablePairedServerStore`; uses the no-argument `clear()`. |
| `src/main/daemonConnection.ts` | `DaemonConnectionDeps.pairedServer` | Call site 5 — base-typed, `load()` re-read per dial. |
| `src/main/index.ts` | composition root, `pairedServerStore` | Constructs the store once and threads the same instance into all five; a **widened** return type is a subtype, so this file needs no edit. |
| `docs/knowledge/features/paired-server-store.md` | § Security properties, § Edge cases | Carries #172's lesson that `clear` was split into its own interface so existing fakes need no stub — the layering this ticket extends — and the module's fail-loud / log-free posture. |

## Context

`createPairedServerStore` holds **one** record under one fixed name. Pairing a second machine
overwrites the first, and because both the sidebar host row and the Settings server row read the same
single record through `serverInfoHandler`, the earlier server disappears from both surfaces at once
along with its conversations. This slice makes the at-rest layout a collection so the second pairing
stops destroying the first. Nothing above the store changes yet: the sidebar still shows one server,
and choosing between them is a later ticket.

No ADR is warranted. The persisted-layout change is confined to one module and is already covered by
ADR 0005 (secret-at-rest via `safeStorage`, fail-closed) and ADR 0002 (token/keys never reach the
renderer); the package overview at `docs/knowledge/features/paired-server-store.md` is the right home
for the new layout, and the documentation phase owns that file.

### Size

Five of the six size-S boundaries hold comfortably: **1** production file, **~620** lines of total
written work, **1** new exported interface, **0** consumer call sites to update, **~5** distinct
reject branches. The sixth is exceeded by one: the ticket carries **6** acceptance criteria against a
ceiling of 5. Stated rather than split, because the sixth (AC6, credential containment) is a
non-regression invariant on a `security-sensitive` store rather than a deliverable, and the only
available cut — layout in one ticket, readers in another — would leave a collection with no reader,
which the size floor forbids. The refiner's `Estimate:` line reached the same reading independently.

## Design

### Persisted form — a JSON array under the unchanged name

One blob under `PAIRED_SERVER_NAME` (unchanged: a new name would strand an installed app's blob and
read as never-paired), holding a JSON **array** of records, ordered oldest-first / **most recently
saved last**.

```jsonc
[ { "server": "...", "relay": "...", "token": "...", "server_static_pubkey": "..." }, … ]
```

The array is the ordering. There is no explicit active pointer: "active = most recently saved"
reproduces today's observable behaviour exactly, and a real pointer belongs to the ticket that gives
the user a way to choose. Array order survives a relaunch for free, which is what AC1 and AC3 need.

`Array.isArray` on the parsed blob is the whole shape discriminator — an array is the new form, an
object is the legacy single record, anything else is malformed. That single bit is why the layout is
a bare array rather than a versioned envelope: an envelope would need a second, weaker discriminator
(does this object have a `servers` key?) that overlaps the malformed case.

### Interface layering — a third layer, so the fixture cascade stays at zero

`PairedServerStore` (base: `save` + `load`) and `ClearablePairedServerStore` (`+ clear`) are
**unchanged**. Every new member lands on a new third layer:

```ts
/** The collection accessors, layered above ClearablePairedServerStore for the same reason clear()
 *  was layered above the base in #172: no existing fake gains a required member. */
export interface MultiPairedServerStore extends ClearablePairedServerStore {
  /** The entry held under `serverId`, or null when no entry has that id. */
  loadById(serverId: string): Promise<PairedServerRecord | null>
  /** Every paired entry, oldest-saved first; empty when nothing is paired. */
  list(): Promise<PairedServerRecord[]>
  /** Erase exactly the entry held under `serverId`, leaving every other entry paired. Idempotent. */
  clearServer(serverId: string): Promise<void>
}
```

`createPairedServerStore` widens its return type from `ClearablePairedServerStore` to
`MultiPairedServerStore`. Widening a return type is a subtype relation, so the composition root and
all five call sites compile untouched, and the ~nine structural fakes across the six test files named
in the ticket keep satisfying the interfaces they are typed against. This is the layering the
existing `ClearablePairedServerStore` doc comment describes, taken one step further.

The by-id erase is a **distinct method**, not an optional parameter on `clear`. An optional parameter
would still type-check against every existing zero-argument fake — and then be silently ignored by
each of them, which is the worse failure.

### Method contracts

| Member | Contract |
|---|---|
| `save(record)` | Read the collection, drop any entry whose `server` equals `record.server`, append the picked record, write. Adds or replaces by key; the saved entry becomes the most recent. |
| `load()` | The **last** entry, or `null` when the collection is empty or the name is absent. Unchanged for the five call sites while one server is paired. |
| `loadById(id)` | The entry with that `server` id, or `null`. |
| `list()` | The entries, oldest-saved first. `[]` when nothing is paired. |
| `clear()` | Delete the whole blob — the store returns to never-paired. Unchanged: `unpairHandler` cannot report `ok` while another server's token is still on disk. |
| `clearServer(id)` | Remove that entry and write the rest back. When it was the **last** remaining entry, delete the blob instead of writing `[]`, so "no blob" stays the single at-rest representation of not-paired. When no entry has that id, resolve **without writing** (idempotent; no needless keychain round-trip, and no `EncryptionUnavailableError` on a no-op erase). |

### Migration — read-time only

`decodeCollection` accepts both shapes:

- **Array** → each element is validated as a record; the result is the collection.
- **Object** → validated as a single record (exactly today's `decodeRecord`), yielding a one-entry
  collection. Four fields verbatim, reachable by its id.
- **Neither** → `MalformedPairedServerRecordError`. Never `null`, never a silently empty collection.

Migration is **read-time only**: `load` performs no write. A lazy rewrite-on-read would put a
`secureStore.set` on a read path, where it can throw `EncryptionUnavailableError` inside `load()` and
break the error contract all five call sites hold today. Every write path (`save`, `clearServer`)
writes the array form, so once a save has happened the old shape is never written again — which is
exactly what AC5 asks for, without touching `load`.

### Validation, and what counts as malformed

`decodeRecord` keeps its current structural check: a non-null object whose four fields are all
`string`, re-picked so stray keys are dropped. On top of it the collection adds one invariant:

- **A duplicate `server` id inside a stored array is malformed.** The collection is keyed by id, so
  two entries claiming one id have no defined meaning — and silently keeping one would let a smuggled
  duplicate make `loadById` return one token while `list` shows another. Fail loud, consistent with
  the module's existing "a tampered record is never silently mistaken for never-paired" posture.
- **An empty array is a valid empty collection**, not malformed: it is structurally the new shape.
  Nothing this module writes ever produces one (`clearServer` deletes the blob instead), so it is a
  defensive read only.

### Concurrency — serialize the mutators

`save` and `clearServer` become **read-modify-write** where `save` used to be a blind write. Two
mutations interleaving across their `await` would drop one server's entry — precisely the defect this
ticket exists to fix, reintroduced from a different direction. The three mutators (`save`, `clear`,
`clearServer`) therefore run through a per-store promise chain, so each read-modify-write completes
before the next begins. The chain continues across a rejected operation, so one failed save does not
wedge the store.

Reads (`load`, `loadById`, `list`) stay **unserialized** — each is a single `secureStore.get` with
nothing to interleave, and queueing them would change the latency behaviour of the five existing call
sites for no correctness gain.

This guards in-process concurrency only. Cross-process concurrent writers are out of scope: there is
one Electron main process, and write atomicity against a mid-write kill is already inherited from
`fileSecretPersistence`'s temp-then-rename.

### The comment correction

`PAIRED_SERVER_NAME`'s doc comment currently claims *"Mobile keys per server-id; appending
`.${serverId}` is the deferred one-line multi-server change."* Both halves are wrong — mobile's
`PairedServerStore.kt` holds a single record, and appending the id is the path this design rejects,
because the id is untrusted paste/QR input and `SecretPersistence` maps a name onto a storage key.
The comment is rewritten to record that the name stays a constant *because* no untrusted input may
reach the persistence path, and that multi-server is held inside one blob for that reason. The `name`
parameter stays injectable — it is a test seam, and two existing specs exercise it — but its
parenthetical "deferred per-server-id keying seam" framing goes.

## State + concurrency model

No store slice, no Zustand, no renderer state — a main-process service object. No timers, no
listeners, no long-lived async work, so there is nothing to cancel on teardown; the promise chain
holds only the in-flight mutation and settles on its own. No in-memory cache: every read still goes
through to `secureStore.get`, so a save is observed immediately by the next `load` — the property
`daemonConnection`'s per-dial re-read depends on.

One live consequence, unchanged from today and called out by the ticket: `loadDialConfig` re-reads
`load()` on every automatic reconnect, so pairing B while connected to A moves the connection to B.

## Error handling

| Failure | Behaviour |
|---|---|
| Name absent | `load()` → `null`, `list()` → `[]`, `loadById()` → `null`. The only absent path. |
| Decrypt failure (tamper, keychain rotation) | Propagates out of every read, unchanged — never masked as absence. |
| Blob present, neither shape | `MalformedPairedServerRecordError` from every read. |
| Array with a bad element, or a duplicate id | `MalformedPairedServerRecordError`. |
| Keychain unavailable on a mutation | `EncryptionUnavailableError` propagates; nothing persisted. |
| `delete` failure in `clear` / `clearServer` | Propagates — fail-closed, never `ok` while a token may remain on disk. |

Errors keep their static, value-free messages. The module stays log-free by construction: no
`console.*`, and the records stay opaque locals rather than named fields of a logged struct.

## Testing strategy

All vitest, in `src/main/pairedServerStore.test.ts`, over the existing in-file `fakeSecureStore` — no
keychain, no filesystem, no new fake. A "relaunch" is a second `createPairedServerStore` over the same
backing `Map`, the pattern the file already uses.

Two existing assertions read the persisted blob directly and follow the layout change (`toEqual(RECORD)`
→ `toEqual([RECORD])`) in the round-trip spec and the stray-fields spec. Two spec titles carrying the
now-rejected "deferred per-server-id keying seam" framing are retitled to name the injected-name seam;
their assertions are unchanged. The re-pair spec keeps passing verbatim and is retitled to say what it
now proves. Nothing else in the file changes.

New scenarios, by AC:

- **AC1** — two records with different ids both survive a relaunch: each readable by its own id, both
  present in `list()` in save order, all four fields verbatim; exactly one blob under the one name.
- **AC2** — re-saving a held id replaces that entry, leaves the others untouched, does not grow
  `list()`, and makes the re-saved entry what `load()` returns.
- **AC3** — `load()` reports the most recently saved of several; `null` only on an empty collection.
- **AC4** — `clearServer` leaves the other entries readable and repoints `load()` at the most recently
  saved survivor; `clearServer` on the last entry leaves no blob; `clearServer` on an unheld id is a
  no-op that writes nothing; `clear()` still empties the whole store.
- **AC5** — a legacy single-record blob reads back as a one-entry collection, four fields verbatim,
  reachable by id and via `load()`; a save on top of it writes the array form and the old shape never
  returns; a blob that is neither shape (and an array with a bad element, and a duplicate-id array)
  throws `MalformedPairedServerRecordError`.
- **AC6** — structural: the diff is confined to `src/main/pairedServerStore.ts` and its spec, and the
  module keeps its zero `electron` / `fs` / IPC imports. Proven by inspection of the diff rather than
  by an assertion, plus the existing log-free spy spec extended over the new members.
- **Concurrency** — two concurrent `save`s of different servers both survive.

## Open questions

1. **Should `loadById` and `list` land on the base interface instead of a third layer?** Resolved by
   the ticket's zero-fixture-cascade constraint: on the base they would force a stub into ~nine
   structural fakes across six test files. Third layer it is.
2. **Should a duplicate-id array be repaired rather than rejected?** Resolved to reject, per the
   module's fail-loud posture. Recorded here because it is the one place this design is stricter than
   "read back what we wrote".
3. **Does `clearServer` on the final entry write `[]` or delete the blob?** Resolved to delete, so
   "no blob" stays the single at-rest form of not-paired and `clear()`'s end state is reachable both
   ways.

Any resolution that changes during Phase B is recorded in a `## Revisions` section rather than edited
into the body above.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings, plus one Phase-B guard.** The disk-blob→memory boundary is a
  single named function, `decodeCollection`, and it is the only place a stored blob becomes a typed
  record; downstream holds `PairedServerRecord[]` only. The new `serverId` parameter on `loadById` /
  `clearServer` is caller-supplied, but it is used **only** for `===` matching against a decoded
  entry's `server` field — never as a store name, a path, or an object key. **SHOULD FIX (Phase B):**
  keep the collection an `Array` matched with `===` / `find` / `filter`; do **not** "optimize" it into
  a plain-object index keyed by server id, where an id of `__proto__` or `constructor` is a
  prototype-pollution hazard. A `Map` would be safe, an object literal would not; the array sidesteps
  the question entirely.
- **[Trust boundaries] OUT OF SCOPE — the collection key is an unauthenticated, untrusted identifier.**
  `save` replaces by `record.server`, which comes from the QR/paste payload. A hostile payload that
  claims an already-paired server's id therefore **evicts** that entry rather than adding beside it —
  silently, where the user's mental model of "pair another server" is additive. This is not
  introduced here so much as newly *observable*: replace-by-key is what AC2 mandates, and reaching
  `save` still requires the user to confirm the server-key fingerprint through
  `createPairingConfirmation`, so the attacker already owns that pairing. The residual delta — losing
  a legitimate server without being told — belongs to the ticket that gives the user a way to see and
  choose among paired servers; that UI must say which entry a pairing will replace.
- **[Tokens, secrets, credentials] No findings.** No generation, no rotation, no comparison-against-
  secret in this module. Storage is unchanged: one `safeStorage`-encrypted blob through `SecureStore`,
  fail-closed (`EncryptionUnavailableError` before any write). The blob now holds N bearer tokens
  rather than one, which is **not** a marginal at-rest exposure: `safeStorage` binds every blob to the
  same OS-keychain app key, so an attacker who can decrypt one can decrypt all — N blobs and one blob
  are equivalent, and the one-blob form is what keeps untrusted input out of the persistence path.
  Rotation, expiry, and daemon-side revocation stay out of scope, inherited from ADR 0005.
- **[Tokens] SHOULD FIX (Phase B) — every write must round-trip through the field picker.** `save` and
  `clearServer` must build their new blob from **decoded, re-picked** entries, never by splicing a
  raw parsed value, so a caller's or a tampered blob's stray fields can never be re-persisted. The
  removed entry's token leaves disk in a **single** `set` (or `delete`) — never delete-then-write —
  so a failed erase leaves the prior blob intact and throws, rather than half-erasing.
- **[File / storage operations] No findings.** `PAIRED_SERVER_NAME` stays a compile-time constant:
  no untrusted input reaches `SecretPersistence`'s name→storage-key mapping, so there is no traversal
  surface. This is the reason the design rejects the `name + '.' + serverId` alternative, and the
  reason the module's misleading comment recommending exactly that is corrected here. Atomic writes
  and per-user storage scope are inherited unchanged from `fileSecretPersistence`'s temp-then-rename
  under `app.getPath('userData')`. No `existsSync`-then-read anywhere.
- **[Inter-process / Electron attack surface] No findings.** The ticket adds no `ipcMain` channel, no
  `contextBridge` method, and no `src/shared/` export; `loadById`, `list` and `clearServer` are
  reachable only from `src/main`. `serverInfoHandler` still projects exactly `server` + `relay` from a
  single `load()`, and `pairingStatusHandler` still returns a value-free enum, so no new field
  crosses IPC and `token` / `server_static_pubkey` stay in the background process (AC6). A future
  ticket exposing `list()` to the renderer must project the same two non-secret fields per entry and
  must not forward records.
- **[Cryptographic primitives] No findings.** No RNG, no hashing, no AEAD, no Noise work here;
  `server_static_pubkey` remains an opaque string. `crypto.timingSafeEqual` is deliberately **not**
  used for the `serverId` match: `server` is a public identifier that already crosses IPC through the
  server-info channel, not a secret, so a plain `===` leaks nothing a timing oracle could exploit.
- **[Network & I/O] No findings — and no entry cap, deliberately.** No sockets, no URLs, no parsing of
  daemon input. The collection is unbounded, which is the right call on the evidence: each entry costs
  a completed, human-confirmed pairing, and a hostile *blob* large enough to matter would first have
  to be valid `safeStorage` ciphertext, which presupposes the OS keychain key is already compromised.
  A cap would be a defense against a failure mode that cannot be reached from an untrusted position.
- **[Error messages, logs, telemetry] SHOULD FIX (Phase B).** The new reject branches — a bad array
  element, a duplicate `server` id — must reuse `MalformedPairedServerRecordError`'s existing
  **static** message: no offending id, no array index (which would leak how many servers are paired),
  no blob bytes. The module stays log-free: no `console.*` on any new path, and the existing six-method
  console-spy spec is extended over `loadById`, `list` and `clearServer` so a later regression reddens.
- **[Concurrency] No findings — the one race this change introduces is designed out.** `save` becomes
  read-modify-write across an `await`, where it used to be a blind write; two interleaved mutations
  would drop a server's entry, reintroducing this ticket's own defect from another direction. The
  three mutators run through a per-store promise chain that continues across a rejected operation, so
  one failed save cannot wedge the store and no rejection escapes unhandled. Reads stay unserialized
  and unchanged. Cross-process writers are out of scope (one main process); mid-write kill safety is
  inherited from temp-then-rename. Nothing long-lived is launched, so there is nothing to cancel on
  teardown.
- **[Threat model alignment] No findings.** *Malicious relay* and *hostile daemon response* do not
  apply — this module touches no socket and parses only its own blob. *Token theft from disk* is the
  live threat and the posture is unchanged (`safeStorage`, keychain-bound, fail-closed), improved at
  the margin by `clearServer`, which shrinks the at-rest window per server instead of all-or-nothing.
  *Renderer compromise reaching the transport* is structurally blocked: the new surface adds no IPC,
  so a compromised renderer gains no path to it.

**Implementation notes carried into Phase B** (from the walk above, so they are not re-derived):
`Array.isArray` must be tested **before** the object-shape branch, since an array is also an object
and would otherwise fail the four-field check and throw; and `clearServer` must skip the write
entirely when no entry matched, so an idempotent no-op erase cannot fail on an unavailable keychain.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
