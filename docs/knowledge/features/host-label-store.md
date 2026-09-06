# Host label store

The desktop client's **persisted host nickname**: the human name the operator types for a paired
pyrybox at pairing time (Figma node `106:3094` draws "Pyrybox" on the sidebar host row), stored
through the [secure store](secure-store.md) so the sidebar still shows it after a restart. Pairing
yields `{server, relay, token, server_static_pubkey}` — the wire carries **no host name**, and the
server id is opaque, so the label has no home on the wire and cannot be given one:
`PairedServerRecord` is a type alias of `QrPayload` (`src/main/pairedServerStore.ts`), and adding a
field the daemon never sees would drift a wire type (CLAUDE.md "don't drift the wire types"). The
label therefore gets its own module and its own stored name rather than a field on the pairing
record.

Introduced in [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822). It lives **entirely** in `src/main` (CLAUDE.md "Keep the
transport out of the window"). It is the **third consumer** of the [secure store](secure-store.md)
primitive ([#42](../codebase/42.md)) — closest in shape to the [device static
keypair](device-keypair.md) ([#43](../codebase/43.md)): both store a single fixed-format blob under
one name with no JSON envelope, rather than the [paired-server store](paired-server-store.md)'s
multi-field JSON record.

**#822 shipped storage only — no caller.** [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) is the pairing-path write
(see [Pairing IPC channel § confirm carries an optional host label](pairing-ipc-channel.md#confirm-carries-an-optional-host-label-823)),
[#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) is the IPC read path back to the
window (see [Host-label channel](host-label-channel.md)), [#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)
is the field that collects the label (see [Pairing input screen § host name field](pairing-input-screen.md#host-name-field-825)),
[#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) is the renderer store the read path
fills (see [Host-label window store](host-label-window-store.md)), and
[#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) is the erase-on-unpair — all five now
shipped. Still open: the sidebar row that renders it
([#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)).

**\#1155 keyed the store, but wired no caller.** Since [#1069](https://github.com/pyrycode/pyrycode-desktop/issues/1069) the app holds
several paired records (see [paired-server store](paired-server-store.md)), so the single slot above
described whichever pairing last supplied a label.
\#1155 layers a per-server `saveFor`/`loadFor`/`clearFor` triple on the same store, over the same
blob, alongside the untouched `save`/`load`/`clear` — the Strangler Fig shape #1069 itself used on
[paired-server store](paired-server-store.md). All four existing callers (`pairingHandler`'s confirm
arm, both `unpairHandler` arms, `hostLabelHandler`) still call the un-keyed three and are unaffected;
migrating them to the keyed triple and deleting the un-keyed one is a separate, not-yet-filed slice.
See § How it works below for the shape and § Edge cases for what changed at rest.

## What it does

Gives the background process **one factory** — `createHostLabelStore({ secureStore })` — that
returns a `MultiHostLabelStore`: the original `{ save, load, clear }` handle over a single label,
plus a `{ saveFor, loadFor, clearFor }` handle over a label per server id, both reading and writing
the **same one blob**:

- **`save(label)` / `load()` / `clear()`** are the original single-slot triple, byte-for-byte
  unchanged since #822. `save` persists the label verbatim (a second `save` overwrites, no length
  bound or validation — this store takes what it is given, exactly as `pairedServerStore` does).
  `load` returns `null` (never stored), `''` (stored empty — a real value), or throws
  `MalformedHostLabelError` (stored bytes are not valid UTF-8); a decrypt failure propagates
  unchanged. `clear` erases, idempotently and fail-closed. The write path's only length bound lives
  one layer up, at [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s `isPairingRequest` guard (`MAX_HOST_LABEL_LENGTH`); the
  [host-label channel](host-label-channel.md) ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)) re-applies the same
  constant at the read boundary, and the [input field](pairing-input-screen.md#host-name-field-825) ([#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)) bounds again for UX, off the same imported constant.
- **`saveFor(serverId, label)` / `loadFor(serverId)` / `clearFor(serverId)`** (\#1155) are the keyed
  triple. `saveFor` adds-or-replaces that server's label and leaves every other server's untouched;
  `loadFor` returns that server's label with the same `null` / `''` / throw semantics as `load`, per
  id; `clearFor` erases exactly that server's label, resolving without a write when the id held none.
  All three take a `serverId` that is untrusted QR/paste input once a caller is wired — see Encoding
  and Security properties below for how it stays off the persistence path.

Unlike the other two consumers of the secure store, **the value this store returns is not a
secret** — it is untrusted display text that later tickets must bound and escape (see Security
properties below). It rides the secure-store seam anyway, for integrity and uniformity rather than
confidentiality.

## How it works

**One** production file, no second effectful adapter (encoding is pure), following the #42/#43/#44
shape of a pure core over an injected effectful seam:

| File | Role |
|---|---|
| `src/main/hostLabelStore.ts` | The **pure core**: `HostLabelStore`, `MalformedHostLabelError`, `HOST_LABEL_NAME`, `createHostLabelStore(deps)`, and the internal UTF-8 encode/decode. **Zero** `electron`/`fs` imports — only the **type** of `SecureStore`. Trivially unit-testable. |

### Public surface

```ts
export interface HostLabelStore {
  save(label: string): Promise<void>
  load(): Promise<string | null>   // null = never stored; '' = stored empty
  clear(): Promise<void>
}

export interface MultiHostLabelStore extends HostLabelStore {
  saveFor(serverId: string, label: string): Promise<void>
  loadFor(serverId: string): Promise<string | null>   // same null/'' semantics as load(), per id
  clearFor(serverId: string): Promise<void>
}

export class MalformedHostLabelError extends Error {}

export const HOST_LABEL_NAME = 'pyrycode.host_label'
export const HOST_LABEL_FORMAT_VERSION = 1   // the at-rest envelope marker; see Encoding below

export function createHostLabelStore(deps: {
  secureStore: SecureStore   // #42, type-only import
  name?: string              // defaults to HOST_LABEL_NAME; injectable as a test seam only
}): MultiHostLabelStore
```

`HostLabelStore` stays one flat interface — no `Clearable…` split, for the reason stated when #827
confirmed it out: `pairedServerStore` splits `PairedServerStore` / `ClearablePairedServerStore`
because several shipped consumers type against the base and would otherwise need a `clear` stub in
their fakes, and nothing here needed that split. Four consumers exist today — `pairingHandler` on
`save`, `hostLabelHandler` on `load`, and two `unpairHandler` arms on `clear` (the whole-collection
one from #827, the per-server one from #1149) — each typed against a disjoint (or, for the two
`unpair` arms, identical) `Pick<HostLabelStore, …>`.

**\#1155's keyed triple is layered onto a new `MultiHostLabelStore`, not added to `HostLabelStore`
itself**, for the same reason `MultiPairedServerStore extends ClearablePairedServerStore` in
[paired-server store](paired-server-store.md): `hostLabelHandler.test.ts` annotates an object literal
as the whole `HostLabelStore` interface (`const store: HostLabelStore = { save, load, clear }`), so a
new required member there would stop that file compiling — an edit this slice is not allowed to make.
Layering means `createHostLabelStore`'s widened return type is a subtype relation, so none of the
four `Pick`-narrowed consumers or the composition root need touching. The keyed names mirror the
un-keyed ones one-for-one (`saveFor`/`loadFor`/`clearFor` against `save`/`load`/`clear`) rather than
borrowing `pairedServerStore`'s `loadById`/`clearServer` — that pairing is what the eventual
Strangler Fig migration (delete the un-keyed three once every caller moves to the keyed three) reads
against. `clearFor` returns `Promise<void>`, not `pairedServerStore.clearServer`'s
`{ matched, remaining }`: both questions that outcome type would answer are already answered for this
server by `clearServer` itself, which is what the per-server unpair arm reads, so a second outcome
type here would have no reader.

### Encoding — two formats share one blob, told apart by a version marker

The un-keyed triple still writes and reads bare UTF-8 bytes, not a JSON envelope: `save` writes
`new TextEncoder().encode(label)`; `load` reads it back with
`new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)`. Both decoder options are
load-bearing and neither is the default:

- **`fatal: true`** — the default decoder is lossy: it silently rewrites invalid byte sequences to
  U+FFFD and returns a plausible string, which would make "unreadable ⇒ failure" unreachable. With
  `fatal`, an invalid sequence throws a `TypeError`, which `decodeLabel` catches and replaces with
  `MalformedHostLabelError` — the decoder's own message is an implementation detail and never
  escapes the module.
- **`ignoreBOM: true`** — the default decoder strips a leading U+FEFF, so a BOM-leading label would
  not round-trip. With it, `'﻿Pyrybox'` saves and loads back with the BOM intact.

**Accepted round-trip caveat, deliberately not fixed:** a label containing an unpaired surrogate
(e.g. `'\uD800'`) encodes to U+FFFD and so does not round-trip byte-identically. This is inherent to
UTF-8, cannot be produced by a text input, and the store takes what it is given — there is no
surrogate check and no rejection.

The keyed triple (\#1155) writes a **version-marked JSON envelope** into that same blob:
`{"v":1,"labels":[{"server":"<id>","label":"<text>"}]}` — an *array* of entries carrying their own
`server` field, never a map keyed by id. That is `pairedServerStore`'s own rule, and what keeps an id
like `__proto__` inert (see Security properties): an id is only ever compared with `===` against a
decoded entry's own field, never used as an object key. `encodeLabels` rebuilds each entry
field-by-field from the two narrowed values, so a stray key on the input can never survive a rewrite.
Add-or-replace-by-key on `saveFor`, appended, so entry order is the saved order.

The original single-string argument against a JSON envelope — "one string carries no fields, so an
envelope would only widen the malformation surface for nothing" — no longer holds once the payload
*is* a collection with fields, but the widened surface it warned about becomes real here, which is
what the decoder below exists to police. This is also why the label still uses the [device static
keypair](device-keypair.md)'s bare-blob shape for its un-keyed half, but the
[paired-server store](paired-server-store.md)'s JSON-envelope shape for its keyed half.

**The discriminator: legacy blob vs. malformed blob.** A blob the single-slot version wrote is a bare
operator-typed string — structurally indistinguishable from garbage, since `JSON.parse` rejects most
old labels but not all of them (`[]`, `{}`, `null`, `123` all parse). So "failed to parse" is not the
test; the version marker is. What makes a *positive* test sound here is that nothing else can reach
this decoder: invalid UTF-8 is unreachable through either version's `save` (`TextEncoder` always
emits valid UTF-8), and `safeStorage` is AEAD, so a tampered blob fails decryption upstream and never
reaches the decoder. Anything that decodes as UTF-8 and isn't the envelope is therefore the old
format. The decode order:

1. invalid UTF-8 → `MalformedHostLabelError`, via the shared `decodeLabel` (unchanged).
2. not JSON → legacy → no labels stored.
3. not a non-null, non-array object → legacy → no labels stored (covers `[]`, `null`, `123`, a bare
   string).
4. `v` is not `HOST_LABEL_FORMAT_VERSION` → legacy → no labels stored (covers `{}`, and a future
   format version — an older build overwrites rather than rejecting one).
5. past the marker the blob is unambiguously *this* format, so a broken one (non-array `labels`, a
   malformed entry, a repeated `server` id) is format drift, not legacy, and raises rather than
   silently dropping a server's label.

Accepted false positive, not fixed: an old label whose text happens to equal a valid v1 envelope
reads as a collection. It is a bounded, human-typed host name, and the outcome is no worse than the
sanctioned legacy-read loss below. Migration is **read-time only** — nothing in the decoder writes;
the first keyed `saveFor` is what replaces a legacy blob with the new envelope.

### Core behavior

`createHostLabelStore` returns a plain object handle — no cache, no memo, no timers:

- **`save(label)`** — `await secureStore.set(name, encodeLabel(label))`. Fail-closed: on
  keychain-unavailable, `set` throws `EncryptionUnavailableError` before any write, which propagates.
- **`load()`** — `const blob = await secureStore.get(name)`; `blob === null` → `null` (the **only**
  null path); otherwise `decodeLabel(blob)`. A decrypt failure inside `get` propagates unchanged; a
  decrypted-but-invalid-UTF-8 blob throws `MalformedHostLabelError`, never coerced to `null`. No
  caching — a straight read each call, so a `save` from another code path is observed immediately.
- **`clear()`** — `await secureStore.delete(name)`, keyed by this store's own `name`, never a
  delete-by-literal. No `try`/`catch`: a delete failure propagates (reporting success while the
  label still sits on disk is the behaviour to avoid). `SecureStore.delete` is idempotent, so
  clearing a never-stored store resolves cleanly.
- **`loadFor(serverId)`** — reads the collection (`decodeLabels`, on a legacy or absent blob: `[]`),
  then `entries.find(e => e.server === serverId)?.label ?? null` — `?? null` rather than `||`, so a
  stored `''` stays a value rather than collapsing into absence. Off the mutate queue: a single read,
  nothing to interleave.
- **`saveFor(serverId, label)`** and **`clearFor(serverId)`** are read-modify-write and run through a
  serializing `mutate` queue (below). `saveFor` reads leniently through `readForSave` — a
  `MalformedHostLabelError` there is treated as an empty collection and the save overwrites it, since
  saving is the only exit from a corrupt blob (nothing else rewrites it, and a label can't be
  re-entered short of re-pairing); a **decrypt** failure still propagates, since that may be
  transient keychain state and discarding every real label on it would be worse. `clearFor` reads
  strictly (`readEntries`, no leniency): an erase surfaces corruption rather than papering over it.
  `clearFor` filters the matching id out and writes back; a no-op id resolves without a write (no
  needless keychain round-trip, no `EncryptionUnavailableError` from an erase with nothing to erase);
  removing the last entry `secureStore.delete`s the blob rather than writing an empty envelope, so
  "no blob" stays the one at-rest form of "nothing stored" for both the keyed and un-keyed readers.

**The mutate queue.** `saveFor` and `clearFor` interleaving across an `await` would drop a server's
label — the single-slot store's own defect, from the other direction, that keying introduces. A
private `queue: Promise<unknown>` chains each keyed mutation onto the last (`queue.then(op, op)`), so
they run one at a time; the chain continues across a rejected operation, so one failed mutation
cannot wedge the queue, and it swallows its own copy of the outcome (the caller still gets the real
result from `run`) so a rejection is never unhandled. Reads (`load`, `loadFor`) and the un-keyed
`save`/`clear` stay off the queue entirely — the former have nothing to interleave, and keeping the
latter off it preserves their behaviour byte for byte.

**Absence vs. stored-empty (the AC this module exists to satisfy)** hinges on one line in the
primitive it sits on: `secureStore.get` tests the **ciphertext** for `null`, before decryption
(`secureStore.ts:94`), and `safeStorage` prepends a version header that keeps an empty plaintext's
ciphertext non-empty (`electronSecretEncryption.ts:36`). A zero-length label therefore never
collapses into `ENOENT`-style absence — `save('')` then `load()` resolves `''`, not `null`. If that
null test in `secureStore.get` ever moves to test the plaintext instead, this distinction breaks
silently; see the comment at `hostLabelStore.ts:135-139` pointing at it.

### Data flow

```
 pairingHandler's confirm arm (#823)               createHostLabelStore(core)   injected seam
  store.save(label) ──► encodeLabel ─► set(name, bytes) ─► SecureStore (fail-closed encrypt-at-rest)
  store.load() ───────► get(name) ─► SecureStore ─► blob?     (hostLabelHandler, #824)
                          null    → null   (never stored — the only null path)
                          present → decodeLabel(blob) ─► label   ('' if stored empty;
                                                                   throws MalformedHostLabelError
                                                                   on invalid UTF-8;
                                                                   a decrypt failure already propagated)
```

`save` is reached from IPC as of #823 (renderer → preload `confirmPairing(label?)` → the `isPairingRequest`
guard → `pairingHandler`'s confirm arm → this store). `load` is reached from IPC as of #824 (renderer →
preload `hostLabel()` → [`hostLabelHandler`](host-label-channel.md), which re-applies
`MAX_HOST_LABEL_LENGTH` at the read boundary). `clear` is reached as of
[#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) — not from IPC at all, but from
`unpairHandler.ts`'s **whole-collection** listener, once `pairedServerStore.clear()` has itself
resolved. Since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149), `unpairHandler.ts`'s
**per-server** listener reaches it too, on a narrower condition: only once `clearServer`'s
`remaining` count reaches `0` — the whole-collection caller always erases the label because it always
empties the collection, but the per-server caller must not, since a still-paired server's name would
be wiped otherwise. See [Pairing IPC channel § confirm carries an optional host label](pairing-ipc-channel.md#confirm-carries-an-optional-host-label-823),
[Host-label channel](host-label-channel.md), and [Unpair channel § the label erase
(#827)](unpair-channel.md#the-label-erase-827) and [§ the per-server channel
(#1149)](unpair-channel.md#the-per-server-channel-1149) for the full hand-off on each side.

## Concurrency & lifecycle

- **No store slice, no Zustand, no renderer state** — a main-process accessor, not UI state.
- **Single source of truth is the persisted blob.** Every read (`load`, `loadFor`) re-reads it; no
  in-memory cache.
- **No timers, listeners, or long-lived tasks** — nothing to cancel on teardown. The un-keyed
  `save`/`clear` stay last-writer-wins with no queue, atomicity inherited from
  `SecureStore`/`fileSecretPersistence`'s temp-then-rename.
- **The un-keyed triple still has no read-modify-write helper**, and still can't: a `load`-then-`save`
  pair across an `await` would be a check-then-act race, since each of `save`/`load`/`clear` is a
  single unconditional operation with nothing to read first. A future "rename after pairing"
  affordance (#825 only writes once, at confirm — see [Pairing input screen § host name
  field](pairing-input-screen.md#host-name-field-825)) must not add an `update` method to this triple
  that reopens it.
- **The keyed triple (\#1155) *is* read-modify-write, on purpose**, and that is exactly the race the
  bullet above refuses for the un-keyed one. Keying is what gives `saveFor`/`clearFor` a
  check-then-act step they didn't have before, so they run through the serializing `mutate` queue
  described in Core behavior rather than being left unguarded.

## Security properties

Code-review verdict: **PASS** (architect self-review). The label is the odd one out among the three
secure-store consumers — not a secret — so its review reads differently from
[device-keypair](device-keypair.md#security-properties)'s or
[paired-server-store](paired-server-store.md#security-properties)'s:

- **Why it rides `safeStorage` anyway.** Not for confidentiality — the label is a nickname. Three
  reasons that are not about secrecy: (1) integrity — `safeStorage` is AEAD, so a tampered blob fails
  *decryption* and surfaces as a throw rather than a plausible-looking string, which is what gives
  the "unreadable ⇒ failure" acceptance criterion any teeth; (2) one audited at-rest surface instead
  of a second persistence path; (3) fail-closed-on-write and log-free-on-every-path come for free by
  staying on the seam. The one cost — `save` rejects with no keychain even though the label isn't
  secret — is correct and non-blocking: on a keychain-less machine, pairing itself already fails, so
  there is no state where the record persists but the label cannot.
- **The value `load` returns is untrusted display text — hand off, do not lose it.** It comes off
  disk, is unbounded (no length bound in this module by design), and this module applies no
  validation beyond "is it valid UTF-8". [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) bounded the **write** path at the
  `isPairingRequest` guard (`MAX_HOST_LABEL_LENGTH = 128`), but that bound does not retroactively
  apply to whatever is already on disk (a longer value written before the bound existed, or by a
  future second writer) — so `load`'s output is still unbounded in principle. [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)
  now bounds the length again at the [IPC read boundary](host-label-channel.md), against the same
  constant, and [#825](https://github.com/pyrycode/pyrycode-desktop/issues/825) bounds it a third time at the
  [input field](pairing-input-screen.md#host-name-field-825) — the same imported constant at every layer, per its
  own doc comment. [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) held the value
  verbatim through the store with no fourth check. Remaining owner:
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) must render it as escaped text only —
  never `dangerouslySetInnerHTML`, an attribute, a URL, a filename, or a lookup key (CLAUDE.md, operator
  ruling 2026-08-20).
- **No new credential risk.** Adding a third name to a chain that already holds a bearer token
  (`pyrycode.paired_server`) and a static private key (`pyrycode.device_static`) is closed
  structurally: `HOST_LABEL_NAME` is a distinct constant, `clear()` deletes by the injected `name`
  rather than a literal, and a test asserts clearing the label leaves both neighbouring secrets
  intact.
- **Zero renderer/IPC surface as shipped by #822.** No `contextBridge`, `ipcMain`, `BrowserWindow`, or
  composition-root wiring in this module — the spec forbade all four for #822 explicitly. [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)
  wired the **write** half (composition root + `pairingHandler`'s confirm arm) and [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) wired
  the **read** half ([host-label channel](host-label-channel.md), `Pick<HostLabelStore, 'load'>` —
  structurally erase-proof); the renderer still cannot reach this module directly on either path.
- **A second untrusted input, \#1155: `serverId`.** Once a sibling slice wires a caller, `serverId` is
  QR/paste input, same as `pairedServerStore`'s. It reaches exactly two places in this module, both
  inert: a `===` comparand against a decoded entry's own `server` field, and a `JSON.stringify`d
  string value. It never reaches `name` — `name` is `deps.name ?? HOST_LABEL_NAME` and nothing in the
  module concatenates it — so no attacker-chosen text touches the persistence path, structurally.
- **Prototype pollution is closed only if the decoder keeps three choices together**, and the
  implementation does: entries are an *array* of objects carrying their own `server` field, never a
  map keyed by id; the duplicate-id check uses a `Set` (`Set.has('__proto__')` is safe,
  `{}['__proto__']` is not); and each entry is rebuilt field-by-field from narrowed values in
  `parseEntry`, never spread from the parsed candidate. `JSON.parse` itself makes `__proto__` an own
  property rather than invoking a setter, so parsing is safe on its own — the risk was entirely in
  what a decoder does with the parsed value afterwards. Tests cover `__proto__` as a `serverId` and
  assert an unpolluted `{}`.
- **Reject-branch messages stay static, same discipline as `MalformedHostLabelError` always had.**
  The new keyed reject branches (non-array `labels`, a malformed entry, a repeated `server` id) throw
  the same error with no interpolation — no offending id, no entry index, no count (a count would
  leak how many servers are paired). The module stays log-free on every path, keyed included.
- **The `serverId === entry.server` comparison is not a secret compare.** It doesn't want
  `crypto.timingSafeEqual`: the id is a non-secret identifier that authorizes nothing (the IPC channel
  a future caller sits behind authorizes the erase, not the match), and a timing signal on it would
  disclose only which ids are stored — which the server-info channel already publishes to the
  renderer by design.
- **A second `clear`-only handle, [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149).**
  The per-server unpair arm gets the same `Pick<HostLabelStore, 'clear'>` shape #827 gave the
  whole-collection arm, over the same instance — no second store, no widened surface. The two callers
  differ only in *when* they call it: the whole-collection arm always does (the collection it just
  erased is always now empty), the per-server arm does so only when `clearServer`'s `remaining` count
  is `0` — so unpairing one of two paired servers leaves the label naming the survivor untouched.
- **Log-free by construction** — no `console.*` anywhere; the label is an opaque local, never a named
  field of a logged struct. `MalformedHostLabelError`'s message is static and interpolates nothing —
  no bytes, no partial decode.
- **Threat model note.** A disk-write attacker who sets an arbitrary label can spoof the sidebar host
  name, but the same access can already replace the paired-server record wholesale, which is strictly
  worse — the label grants no new capability. The daemon never sees the label (it is not a wire
  field), so it cannot be influenced from the daemon side. A disk-write attacker gains one *new*
  capability from the keyed envelope (\#1155): a forged v1 envelope makes keyed reads raise, blanking
  the sidebar name — denial, not escalation, and recoverable (the next `saveFor` overwrites it).
- **Out of scope, hygiene not a vector (\#1155).** Label entries are never reconciled against the
  paired records, so a caller that forgets to `clearFor` on unpair leaves a stale label for a server
  that no longer exists. Growth is bounded by the pairing act (an entry needs a successful pairing)
  and each label stays bounded at `MAX_HOST_LABEL_LENGTH` three layers up, so this is not a
  memory-exhaustion vector — it belongs to whichever slice re-keys the unpair arms.

## Edge cases and limitations

- **Never stored** — `load` resolves `null` — the only null path.
- **Stored empty (`save('')`)** — `load` resolves `''`, not `null`; see Core behavior above for why
  this holds end-to-end rather than only against a test fake.
- **Keychain unavailable on `save`** — `set` throws `EncryptionUnavailableError`, which propagates;
  nothing is written.
- **Stored blob undecryptable (tamper / keychain rotation)** — `get`'s throw propagates out of
  `load`; never returned as `null`.
- **Stored blob present, decrypts, but is not valid UTF-8** — `MalformedHostLabelError` (static
  message, no bytes); never `null`.
- **Unpaired surrogate in the input** — encodes to U+FFFD; does not round-trip byte-identically.
  Inherent to UTF-8, not producible via a text field, intentionally unvalidated (see Encoding above).
- **Re-save** — `save` overwrites; last-writer-wins, exactly one blob kept.
- **Clearing when never stored** — `clear()` resolves without throwing (`SecureStore.delete` is a
  documented no-op on an absent name).
- **No length bound in this module** — by design; the write path is bounded one layer up at
  [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s IPC guard, the [read path](host-label-channel.md) bounds again
  at the same constant ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)), and so does the
  [input field](pairing-input-screen.md#host-name-field-825) ([#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)).
- **Write, read, and erase paths all wired.** [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) constructs the live store in
  `src/main/index.ts` and gives `pairingHandler` a `save`-only handle; [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) gives the
  [host-label handler](host-label-channel.md) a `load`-only handle over the same instance;
  [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) gives the [unpair
  handler](unpair-channel.md)'s whole-collection arm a `clear`-only handle over that same instance
  again, and [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) gives its per-server
  arm an identical `clear`-only handle over the same instance a fourth time — four seams, three
  disjoint `Pick` shapes (two of the four share the `clear`-only shape), none able to do another's job.
- **A label per server, since \#1155 — not per-server-id keying via the store `name`.** An earlier
  version of this doc, and of the module's own header comment, called
  `pyrycode.host_label.<server-id>` (composing the persistence *name* from the id) "the deferred
  one-line multi-host change". `pairedServerStore` had already rejected that exact mechanism for its
  own collection — the `server` id is untrusted QR/paste input, and deriving a storage name from it
  would put attacker-chosen text on the persistence path — and \#1155 follows that rejection instead:
  one blob, one unchanged `HOST_LABEL_NAME`, a keyed collection inside it (see Encoding above).
- **An already-installed single-slot label is not carried over — deliberate.** This store has no view
  of the paired records (it is a pure core over one injected seam) and so cannot name "the" server a
  legacy blob's bare string belongs to; adopting it for one server, or showing it on every host row,
  would recreate the bug \#1155 exists to fix. A legacy blob reads as no labels stored for every
  server id (see the decode order in Encoding), so upgrading an installed app drops the operator's
  existing host name from the sidebar with no in-app way to re-enter it short of re-pairing
  (`pairingHandler.ts` is the only write path). If carry-over is wanted, it needs the composition
  root, where both stores are in scope — not filed as of this writing.
- **An untrusted `serverId` never reaches the persistence name**, for any id including `__proto__`,
  `../pyrycode.paired_server`, or the empty string: every id reads and writes under the same
  `HOST_LABEL_NAME`, and a label stored under one id is retrievable only under that same id. See
  Security properties above for how the decoder keeps `__proto__` specifically inert.
- **This slice ships with no caller.** `saveFor`/`loadFor`/`clearFor` exist and are tested, but no
  composition-root wiring, no IPC handler, and no consumer's `Pick<>` references them yet — the four
  existing callers still use `save`/`load`/`clear` exactly as before \#1155.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the injected persistence surface this
  consumes; the third consumer.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the closer structural
  precedent (fixed-blob encoding, `Malformed…Error`, no JSON envelope) rather than the paired-server
  store's multi-field JSON shape.
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — why the label could not
  become a field on `PairedServerRecord`: that type aliases the wire's `QrPayload`, and the daemon
  never sees a host name. Also the shape \#1155 mirrors for its keyed collection: one blob under one
  unchanged store name, entries as an array carrying their own id field (never an object key), a
  `mutate` queue serializing read-modify-write, and the layered-interface trick
  (`MultiPairedServerStore extends ClearablePairedServerStore` ↔ `MultiHostLabelStore extends
  HostLabelStore`) that keeps existing `Pick<>`-narrowed consumers and fakes compiling untouched.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the fail-closed
  secret-at-rest rule this module inherits unchanged, applied here to non-secret display text for
  integrity rather than confidentiality.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — "keys never reach the
  renderer" / "keep the transport out of the window", which this module's zero-IPC-surface honours.
- [Pairing IPC channel](pairing-ipc-channel.md) / [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) — the pairing-path write:
  the operator-typed label rides the `confirm` request and reaches this store's `save`. **Read the
  full hand-off there.**
- [Host-label channel](host-label-channel.md) / [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) — the IPC read path: the
  window reads this store's `load()` back through a `Pick<HostLabelStore, 'load'>` handler. **Read the
  full hand-off there.**
- [Pairing input screen](pairing-input-screen.md#host-name-field-825) / [#825](https://github.com/pyrycode/pyrycode-desktop/issues/825) — the
  paste-phase field the operator types the label into; the renderer-side normalisation (trim,
  collapse whitespace-only to no label) that decides what actually reaches `save`.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the renderer store the read path fills. This module's main-process persistence and that module's
  window-side state share a name-root, not a layer. Not reset by an unpair within one running app
  session — see that doc's edge cases and [Unpair channel § the label erase
  (#827)](unpair-channel.md).
- [Unpair channel](unpair-channel.md) / [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) —
  the erase path: a `clear`-only handle, called only after the paired-server record's own erase has
  resolved, closing the gap [#173](../codebase/173.md)'s unpair used to leave (flagged in #823's spec,
  Open question 1) where the label outlived the record it described. [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)
  adds a second `clear`-only handle over the same instance, from that channel's per-server arm, called
  only when no record remains — see [§ the per-server channel (#1149)](unpair-channel.md#the-per-server-channel-1149).
- Downstream, not yet built: the sidebar host row ([#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)).
