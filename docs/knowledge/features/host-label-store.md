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

**\#1155 keyed the store; \#1156 moved the writers.** Since [#1069](https://github.com/pyrycode/pyrycode-desktop/issues/1069) the app holds
several paired records (see [paired-server store](paired-server-store.md)), so the single slot above
described whichever pairing last supplied a label. \#1155 layered a per-server
`saveFor`/`loadFor`/`clearFor` triple onto the same store, over the same blob, alongside the untouched
`save`/`load`/`clear` — the Strangler Fig shape #1069 itself used on
[paired-server store](paired-server-store.md) — and shipped it with no caller.
[#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) moved two of the four callers: the
pairing confirm now writes through `saveFor`, keyed by the server it just paired, and the per-server
unpair arm erases through `clearFor`, unconditionally, retiring the interim rule that erased the
single-slot label only once nothing remained paired, and
`hostLabelHandler`'s zero-argument read keeps `load`, which \#1156 taught to recognise **both** at-rest
shapes so it goes on answering exactly as it did before a keyed envelope could exist.
[#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) gave `loadFor` its own caller — a
second, keyed IPC channel beside the zero-argument one (see [Host-label channel § the per-server
channel](host-label-channel.md#the-per-server-channel-1157)) — so all four members of the keyed triple
now have one. **[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) deleted the
whole-collection unpair arm** that used to keep `clear` alive (it deleted the one blob either shape
lives in, so it needed no keyed counterpart) — `clear` therefore has **no production caller left at
all**; see § Edge cases for why the member itself stays in the interface regardless. See § How it works
below for the shape and § Edge cases for what changed at rest.

## What it does

Gives the background process **one factory** — `createHostLabelStore({ secureStore })` — that
returns a `MultiHostLabelStore`: the original `{ save, load, clear }` handle over a single label,
plus a `{ saveFor, loadFor, clearFor }` handle over a label per server id, both reading and writing
the **same one blob**:

- **`save(label)` / `load()` / `clear()`** are the un-keyed triple. `save` persists the label verbatim
  (a second `save` overwrites, no length bound or validation — this store takes what it is given,
  exactly as `pairedServerStore` does) and has had **no caller since \#1156** — it is deliberately not
  taught the envelope, since teaching a dead writer a second format would be surface with no reader.
  `load` returns `null` (never stored), `''` (stored empty — a real value), or throws
  `MalformedHostLabelError` (stored bytes are not valid UTF-8, or a keyed envelope broken past its
  version marker); a decrypt failure propagates unchanged. Since \#1156 it reads **either** at-rest
  shape: a bare blob is the label it always was, and a keyed envelope resolves as its **most recently
  stored** entry — never the envelope text, never a list, never a count (see Core behavior below).
  `clear` erases the whole blob, idempotently and fail-closed — every server's label, whichever shape
  it holds. The write path's only length bound lives one layer up, at [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s `isPairingRequest` guard (`MAX_HOST_LABEL_LENGTH`); the
  [host-label channel](host-label-channel.md) ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)) re-applies the same
  constant at the read boundary, and the [input field](pairing-input-screen.md#host-name-field-825) ([#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)) bounds again for UX, off the same imported constant.
- **`saveFor(serverId, label)` / `loadFor(serverId)` / `clearFor(serverId)`** are the keyed triple.
  `saveFor` adds-or-replaces that server's label and leaves every other server's untouched — the
  pairing confirm's write path since \#1156, and since [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)
  also the per-server host-label SET channel's save arm, chosen there by a trimmed-non-blank label;
  `loadFor` returns that server's label with the same `null` / `''` / throw semantics as `load`, per
  id, and is the per-server IPC query's read since
  [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) (see [Host-label channel § the
  per-server channel](host-label-channel.md#the-per-server-channel-1157)); `clearFor` erases
  exactly that server's label, resolving without a write when the id held none — the per-server
  unpair arm's erase since \#1156, called unconditionally on a matched unpair, and since \#1186 also
  the SET channel's clear arm, chosen there by a trimmed-blank label. `saveFor` and `clearFor` each now
  have two callers; neither new caller reaches `loadFor`, `load` or `save` — its dep type is
  `Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>` — so the set channel can neither read a label
  back nor touch the un-keyed slot (see [Host-label channel § the per-server SET
  channel](host-label-channel.md)). All three take a `serverId` that is untrusted QR/paste input — see
  Encoding and Security properties below for how it stays off the persistence path.

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
their fakes, and nothing here needed that split. **Five** consumers exist today, split across both
interfaces: `pairingHandler` on `MultiHostLabelStore`'s `saveFor` (since \#1156), the per-server
`unpairHandler` arm on `MultiHostLabelStore`'s `clearFor` (since \#1156), `hostLabelHandler`'s
zero-argument arm on `HostLabelStore`'s `load` (unchanged since #824, though what it now reads through
changed — see Core behavior), `hostLabelHandler`'s keyed read arm on `MultiHostLabelStore`'s `loadFor`
([#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)), and `hostLabelHandler`'s keyed SET
arm on `Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>`
([#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)) — one `Pick` reaching **both**
`saveFor` and `clearFor`, so it is a second caller of each rather than a sixth disjoint consumer — each
typed against a disjoint `Pick<…, …>`. A sixth existed until
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163): the whole-collection `unpairHandler`
arm on `HostLabelStore`'s `clear`. That arm is deleted, so `clear` now has **no production caller**;
see § Edge cases for why the interface still carries it.

**\#1155's keyed triple is layered onto a new `MultiHostLabelStore`, not added to `HostLabelStore`
itself**, for the same reason `MultiPairedServerStore extends ClearablePairedServerStore` in
[paired-server store](paired-server-store.md): `hostLabelHandler.test.ts` annotates an object literal
as the whole `HostLabelStore` interface (`const store: HostLabelStore = { save, load, clear }`), so a
new required member there would stop that file compiling — an edit this slice is not allowed to make.
Layering means `createHostLabelStore`'s widened return type is a subtype relation, so none of the
four `Pick`-narrowed consumers or the composition root need touching. The keyed names mirror the
un-keyed ones one-for-one (`saveFor`/`loadFor`/`clearFor` against `save`/`load`/`clear`) rather than
borrowing `pairedServerStore`'s `loadById`/`clearServer` — that pairing is what the Strangler Fig
migration read against, and \#1156 is the slice that ran it, **partially and on purpose**: it moved
`save`→`saveFor` and the per-server `clear`→`clearFor`, but did not delete the un-keyed three, because
`clear` still had a live caller at the time (the whole-collection unpair arm, since deleted by
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)) and `load` still has a live caller
(`hostLabelHandler`, out of scope for this slice and for [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)). "Move all four and delete the
un-keyed three" — an earlier version of this module's header — is not what shipped; see § Encoding
and § Core behavior for how `load` was taught to stay correct with two writers now feeding two
different at-rest shapes into the same blob. `clearFor` returns `Promise<void>`, not
`pairedServerStore.clearServer`'s
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

1. invalid UTF-8 → `MalformedHostLabelError`, from the shared `decodeLabel`, run **before** the parse
   below rather than inside its `try` — that is what keeps this throw structurally unswallowed,
   replacing an earlier catch-and-`instanceof`-re-throw dance that had to recognise its own error to
   avoid reporting corruption as legacy.
2. not JSON → legacy → `null` ("not our format" — see below for why this is `null` and not `[]`).
3. not a non-null, non-array object → legacy → `null` (covers `[]`, `null`, `123`, a bare string).
4. `v` is not `HOST_LABEL_FORMAT_VERSION` → legacy → `null` (covers `{}`, and a future format
   version — an older build overwrites rather than rejecting one).
5. past the marker the blob is unambiguously *this* format, so a broken one (non-array `labels`, a
   malformed entry, a repeated `server` id) is format drift, not legacy, and raises rather than
   silently dropping a server's label.

**`null`, not `[]`, since \#1156.** The decode is split into two functions: `parseLabels(text)` runs
steps 2-5 above and returns `HostLabelEntry[] | null`; `decodeLabels(blob)` is
`parseLabels(decodeLabel(blob))`. The keyed triple's `readEntries` still coalesces `null` to `[]` —
"legacy" and "no labels" are the same answer for `loadFor`/`saveFor`/`clearFor`, which have no view of
what a bare string used to mean. But `load()` needed the two told apart: "this blob is not our
envelope" (return the text verbatim, the un-keyed behaviour this store has always had) and "our
envelope holds no entries" (resolve `null`, described in Core behavior) are different questions with
different answers, and merging them into `[]` the way the keyed triple does would have made the first
one unreachable from `load`.

Accepted false positive, not fixed: an old label whose text happens to equal a valid v1 envelope
reads as a collection by every keyed member, and by `load` as that collection's most recent entry
rather than as the literal old text. It is a bounded, human-typed host name, and the outcome is no
worse than the sanctioned legacy-read loss below. Migration is **read-time only** — nothing in the
decoder writes; the first keyed `saveFor` is what replaces a legacy blob with the new envelope.

### Core behavior

`createHostLabelStore` returns a plain object handle — no cache, no memo, no timers:

- **`save(label)`** — `await secureStore.set(name, encodeLabel(label))`. Fail-closed: on
  keychain-unavailable, `set` throws `EncryptionUnavailableError` before any write, which propagates.
  No caller since \#1156.
- **`load()`** — `const blob = await secureStore.get(name)`; `blob === null` → `null` (the **only**
  null path). Otherwise `decodeLabel(blob)` gives the text, and `parseLabels(text)` decides which of
  two answers to give (\#1156):
  - not the envelope (`parseLabels` → `null`) → the text **verbatim** — the un-keyed behaviour this
    store has always had, and the answer for every blob that exists on an installed machine that has
    not paired since \#1156.
  - the envelope (`parseLabels` → an array) → `entries[entries.length - 1]?.label ?? null` — the
    **most recently stored** entry, since `saveFor` drops any prior entry for an id and appends, so
    array order is save order. `?? null`, never `||` or a truthiness test: a stored `''` is a value
    the operator supplied, and collapsing it into absence here would merge two of this read's three
    outcomes at the last boundary that still tells them apart. An entry-less envelope (unreachable
    through `saveFor`/`clearFor` — `clearFor` deletes the blob when the last entry goes) resolves
    `null` rather than falling through to `[]?.label`.

  A decrypt failure inside `get` propagates unchanged; invalid UTF-8, or envelope drift past the
  version marker, throws `MalformedHostLabelError`, never coerced to `null`. No caching — a straight
  read each call, so a `save`/`saveFor` from another code path is observed immediately. This is the
  seam \#1156 used to satisfy AC4: without it, a keyed `saveFor` write would make this same call
  return the raw `{"v":1,…}` string (short envelopes clear `MAX_HOST_LABEL_LENGTH` at the [host-label
  channel](host-label-channel.md)'s read bound) or `error` (once a longer one crosses it) instead of a
  label. `load()` still returns **one label and nothing else** — never the envelope, a list, or a
  count of servers held; see Security properties.
- **`clear()`** — `await secureStore.delete(name)`, keyed by this store's own `name`, never a
  delete-by-literal. No `try`/`catch`: a delete failure propagates (reporting success while the
  label still sits on disk is the behaviour to avoid). `SecureStore.delete` is idempotent, so
  clearing a never-stored store resolves cleanly. Erases the whole blob under either at-rest shape, so
  it needs no keyed counterpart — the whole-collection unpair arm's caller from #827 until
  [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) deleted that arm; **no production
  caller since**.
- **`loadFor(serverId)`** — reads the collection (`decodeLabels ?? []`, so a legacy or absent blob
  reads as `[]`), then `entries.find(e => e.server === serverId)?.label ?? null` — `?? null` rather
  than `||`, so a stored `''` stays a value rather than collapsing into absence. Off the mutate queue:
  a single read, nothing to interleave. Still no caller.
- **`saveFor(serverId, label)`** and **`clearFor(serverId)`** are read-modify-write and run through a
  serializing `mutate` queue (below) — the pairing confirm's write and the per-server unpair's erase,
  since \#1156. `saveFor` reads leniently through `readForSave` — a
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
silently; see the comment at `hostLabelStore.ts:382-387` pointing at it.

### Data flow

```
 pairingHandler's confirm arm (#1156)              createHostLabelStore(core)   injected seam
  store.saveFor(serverId, label) ──► mutate queue ─► encodeLabels ─► set(name, bytes) ─► SecureStore

 unpairHandler's per-server arm (#1156)
  store.clearFor(serverId) ────────► mutate queue ─► filter ─► set/delete(name) ─► SecureStore

 store.load() ───────► get(name) ─► SecureStore ─► blob?     (hostLabelHandler, unchanged since #824)
                          null    → null   (never stored — the only null path)
                          present → decodeLabel(blob) ─► text ─► parseLabels(text)
                                       not the envelope → text, verbatim  (every blob #1156 predates)
                                       the envelope      → its newest entry's label ?? null   (#1156)
                                       (either arm throws MalformedHostLabelError on invalid UTF-8
                                        or on envelope drift past the version marker; a decrypt
                                        failure already propagated out of `get`)

 hostLabelHandler's keyed arm (#1157)
  store.loadFor(serverId) ─► decodeLabels ?? [] ─► find(e => e.server === serverId)?.label ?? null

 hostLabelHandler's keyed SET arm (#1186) — after pairedServerStore.loadById(serverId) !== null
  trim(label) === ''?  → store.clearFor(serverId) ──► mutate queue ─► filter ─► set/delete ─► SecureStore
                    no  → store.saveFor(serverId, trimmed) ─► mutate queue ─► encodeLabels ─► set ─► SecureStore
```

`saveFor` is reached from IPC (renderer → preload `confirmPairing(label?)` → the `isPairingRequest`
guard → `pairingHandler`'s confirm arm → this store, keyed by the server id the same confirm just
persisted — since \#1156; `save` carried this before it and has no caller left). `load` is reached from
IPC as of #824 (renderer → preload `hostLabel()` → [`hostLabelHandler`](host-label-channel.md), which
re-applies `MAX_HOST_LABEL_LENGTH` at the read boundary) and is unchanged by \#1156 at every layer above
this store — only what it reads through changed. `loadFor` is reached from IPC as of
[#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) (renderer → preload
`hostLabelFor(serverId)` → the `isHostLabelServerRequest` guard →
[`hostLabelHandler`'s keyed arm](host-label-channel.md#the-per-server-channel-1157), which re-applies
`MAX_HOST_LABEL_LENGTH` the same way `load`'s reader does) — a sibling call, not a replacement; `load`
is untouched by it. `saveFor` and `clearFor` are each reached a second way as of
[#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186) (renderer → preload
`setHostLabelFor(serverId, label)` → the `isHostLabelSetRequest` guard →
[`hostLabelHandler`'s keyed SET arm](host-label-channel.md), after an existence check against
`pairedServerStore.loadById` — the trimmed label picks the store call, blank clears, non-blank saves)
— a third sibling call on each, not a replacement; `loadFor` is untouched by it and the SET arm cannot
reach `loadFor` or `load` at all. `clear` was reached from [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)
until [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) — not from IPC at all, but from
`unpairHandler.ts`'s **whole-collection** listener, once `pairedServerStore.clear()` had itself
resolved; that listener is deleted, so `clear` is reached from nowhere in production now.
`unpairHandler.ts`'s **per-server** listener reaches `clearFor` instead, since \#1156, on every matched
unpair — [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) shipped it gated on
`clearServer`'s `remaining` count reaching `0`, which \#1156 retired: keyed by server, the gate was the
bug it guarded against (it left an unpaired machine's name on disk for as long as any other stayed
paired), so the per-server arm now erases the named server's label unconditionally and a still-paired
server's own label is untouched by construction, not by a remaining-count check. See [Pairing IPC
channel § confirm carries an optional host label](pairing-ipc-channel.md#confirm-carries-an-optional-host-label-823),
[Host-label channel](host-label-channel.md), and [Unpair channel](unpair-channel.md) for the full
hand-off on each side.

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
  staying on the seam. The one cost — `saveFor` rejects with no keychain even though the label isn't
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
- **A second untrusted input, \#1155, live since \#1156: `serverId`.** `serverId` is QR/paste input,
  same as `pairedServerStore`'s — reaching `saveFor` off the pairing paste and `clearFor` off the
  already-guarded `UnpairServerRequest`. It reaches exactly two places in this module, both inert: a
  `===` comparand against a decoded entry's own `server` field, and a `JSON.stringify`d string value.
  It never reaches `name` — `name` is `deps.name ?? HOST_LABEL_NAME` and nothing in the module
  concatenates it — so no attacker-chosen text touches the persistence path, structurally. Its length
  is bounded transitively: `MAX_SERVER_ID_LENGTH` (the per-server unpair guard) is *aliased* to
  `MAX_PASTE_LENGTH`, on the reasoning that every persisted `server` id already arrived inside a paste
  that bound limited, so no id this store is asked to write can exceed what the unpair guard will
  later accept.
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
- **A second erase-only handle, keyed since \#1156, now the only one.** [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)
  gave the per-server unpair arm the same `Pick<HostLabelStore, 'clear'>` shape #827 gave the
  (since-deleted) whole-collection arm, over the same instance, gated on `clearServer`'s `remaining`
  count reaching `0` — the only point at which a *single un-keyed slot* was well defined for a
  per-server unpair. \#1156 replaced that handle with `Pick<MultiHostLabelStore, 'clearFor'>` and
  deleted the gate: the arm now erases the named server's label unconditionally, and a survivor's own
  label is untouched because it is a different entry, not because a count said to leave it alone.
  [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) deleted the whole-collection
  sibling entirely; this remains erase-only — it cannot read a label back — so the module's log-free,
  credential-blind guarantees
  are unchanged by the swap.
- **Log-free by construction** — no `console.*` anywhere; the label is an opaque local, never a named
  field of a logged struct. `MalformedHostLabelError`'s message is static and interpolates nothing —
  no bytes, no partial decode.
- **Threat model note.** A disk-write attacker who sets an arbitrary label can spoof the sidebar host
  name, but the same access can already replace the paired-server record wholesale, which is strictly
  worse — the label grants no new capability. The daemon never sees the label (it is not a wire
  field), so it cannot be influenced from the daemon side. A disk-write attacker gains one *new*
  capability from the keyed envelope (\#1155): a forged v1 envelope makes keyed reads raise — since
  \#1156 that includes the zero-argument `load()`, not only `loadFor` — blanking the sidebar name,
  denial rather than escalation, and recoverable (the next `saveFor` overwrites it). A tampered blob
  that still decrypts implies the attacker already holds the keychain entry, which means they already
  hold the bearer token — a strictly worse position than a blanked label name.
- **Hygiene not a vector, \#1155, still true after \#1156.** Label entries are never reconciled against
  the paired records: `saveFor`/`clearFor` only run from the pairing confirm and the per-server unpair,
  so an entry outlives its server only if one of those two paths is skipped or throws (both fail
  closed — see Error handling in the architecture spec — and both leave the erase recoverable by
  re-pairing or re-unpairing). Growth is bounded by the pairing act (an entry needs a successful
  pairing) and each label stays bounded at `MAX_HOST_LABEL_LENGTH` three layers up, so this is not a
  memory-exhaustion vector.

## Edge cases and limitations

- **Never stored** — `load` resolves `null` — the only null path.
- **Stored empty (`saveFor(id, '')`)** — `load()` resolves `''` for that id's entry (if it is the
  newest) or via `loadFor(id)` directly, not `null`; see Core behavior above for why this holds
  end-to-end rather than only against a test fake.
- **Keychain unavailable on `saveFor`** — `set` throws `EncryptionUnavailableError` from inside the
  mutate queue, which propagates; nothing is written. `pairingHandler` catches it and still reports
  the pairing `ok` (AC5) — see the architecture spec's Error handling.
- **Stored blob undecryptable (tamper / keychain rotation)** — `get`'s throw propagates out of
  `load`; never returned as `null`.
- **Stored blob present, decrypts, but is not valid UTF-8, or is a keyed envelope broken past its
  version marker** — `MalformedHostLabelError` (static message, no bytes, no offending id, no
  count); never `null`.
- **Unpaired surrogate in the input** — encodes to U+FFFD; does not round-trip byte-identically.
  Inherent to UTF-8, not producible via a text field, intentionally unvalidated (see Encoding above).
- **Re-pairing the same server** — `saveFor` drops that server's prior entry and appends the new one,
  so it becomes the newest; `load()` reports the replacement immediately.
- **Clearing when never stored, or an id nothing holds** — `clear()` and `clearFor(id)` both resolve
  without throwing (`SecureStore.delete` is a documented no-op on an absent name; an unmatched
  `clearFor` id resolves without a write).
- **No length bound in this module** — by design; the write path is bounded one layer up at
  [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s IPC guard, the [read path](host-label-channel.md) bounds again
  at the same constant ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)), and so does the
  [input field](pairing-input-screen.md#host-name-field-825) ([#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)).
- **Write, read, erase and rewrite paths all wired, keyed since \#1156, keyed-read wired since \#1157,
  keyed-rewrite wired since \#1186.** `src/main/index.ts` constructs the live store once and hands out
  **five** disjoint `Pick`s over it: `pairingHandler` gets `saveFor`-only ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823),
  re-pointed at `saveFor` by \#1156); the [host-label handler](host-label-channel.md)'s zero-argument
  arm keeps its `load`-only handle ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824),
  unmoved); the per-server unpair arm gets `clearFor`-only
  ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149), re-pointed at `clearFor` by
  \#1156); the [host-label handler](host-label-channel.md)'s per-server read arm gets `loadFor`-only
  ([#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)); its per-server SET arm gets
  `Pick<…, 'saveFor' | 'clearFor'>` plus, over `pairedServerStore`, `loadById`-only
  ([#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186), new) — none able to do another's
  job, and the SET arm's own handle carries no `load` or `loadFor` either. There was a sixth, the
  whole-collection unpair arm's `clear`-only handle
  ([#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)), until
  [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) deleted that handler along with its
  registration.
- **`clear` has no production caller left, and the interface member is deliberately not removed
  with it ([#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)).** Removing the handler
  that called it was in scope; removing `clear` itself from `HostLabelStore` was not — three test
  object literals pin the member (`hostLabelHandler.test.ts` on `HostLabelStore`, two more on
  `MultiHostLabelStore`), so deleting it is a tsc-only cascade `npm test` alone would not surface
  (`npm run build` catches it). Left for a follow-up.
- **A label per server, since \#1155 — not per-server-id keying via the store `name`.** An earlier
  version of this doc, and of the module's own header comment, called
  `pyrycode.host_label.<server-id>` (composing the persistence *name* from the id) "the deferred
  one-line multi-host change". `pairedServerStore` had already rejected that exact mechanism for its
  own collection — the `server` id is untrusted QR/paste input, and deriving a storage name from it
  would put attacker-chosen text on the persistence path — and \#1155 follows that rejection instead:
  one blob, one unchanged `HOST_LABEL_NAME`, a keyed collection inside it (see Encoding above).
- **An already-installed single-slot label carries over for the un-keyed read, and only for it.**
  `loadFor`/`saveFor`/`clearFor` read a legacy blob as no labels stored for every server id (see the
  decode order in Encoding) — this store has no view of the paired records and so cannot name "the"
  server a bare string belongs to, and adopting it for one server or showing it on every host row
  would recreate the bug \#1155 exists to fix. But `load()` — the zero-argument query the sidebar
  actually reads — returns that bare string verbatim, exactly as it always has (\#1156), so upgrading
  an installed app does **not** blank the sidebar name. It stops being carried the moment the first
  `saveFor` after the upgrade replaces the blob with an envelope (a new pairing, or a re-pair of the
  existing one) — from then on `load()` answers from the keyed collection, and the operator's
  pre-upgrade text is gone unless it happened to also be re-entered as that pairing's label.
- **An untrusted `serverId` never reaches the persistence name**, for any id including `__proto__`,
  `../pyrycode.paired_server`, or the empty string: every id reads and writes under the same
  `HOST_LABEL_NAME`, and a label stored under one id is retrievable only under that same id. See
  Security properties above for how the decoder keeps `__proto__` specifically inert.
- **`loadFor` now has a caller, and `saveFor`/`clearFor` each have a second one.** `saveFor` and
  `clearFor` gained their first callers in \#1156; [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)
  gave `loadFor` the per-server IPC query (`HOST_LABEL_SERVER_CHANNEL`,
  `Pick<MultiHostLabelStore, 'loadFor'>`-only) — see [Host-label channel § the per-server
  channel](host-label-channel.md#the-per-server-channel-1157) — and
  [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186) gave `saveFor`/`clearFor` a second,
  renderer-driven caller, `HOST_LABEL_SET_CHANNEL`, gated by an existence check against
  `pairedServerStore.loadById` that has no atomicity with the write across the two stores — an unpair
  landing in that gap leaves an orphan label, self-healing on the next pairing or unpair for that id.
  The sidebar's own move onto the keyed read is still open, as
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070).

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
  the operator-typed label rides the `confirm` request and reaches this store's `saveFor`, keyed by
  server since [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156). **Read the full
  hand-off there.**
- [Host-label channel](host-label-channel.md) / [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) — the IPC read path: the
  window reads this store's `load()` back through a `Pick<HostLabelStore, 'load'>` handler.
  [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) added a second, keyed handler
  reading `loadFor` through a `Pick<MultiHostLabelStore, 'loadFor'>` handle, so the sidebar can label
  two paired machines apart. **Read the full hand-off there.**
- [Pairing input screen](pairing-input-screen.md#host-name-field-825) / [#825](https://github.com/pyrycode/pyrycode-desktop/issues/825) — the
  paste-phase field the operator types the label into; the renderer-side normalisation (trim,
  collapse whitespace-only to no label) that decides what actually reaches `save`.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the renderer store the read path fills. This module's main-process persistence and that module's
  window-side state share a name-root, not a layer. Not reset by an unpair within one running app
  session — see that doc's edge cases and [Unpair channel § the label erase
  (#827)](unpair-channel.md).
- [Unpair channel](unpair-channel.md) / [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) —
  the erase path. The original `clear`-only handle, called only after the paired-server record's own
  erase had resolved, closed the gap [#173](../codebase/173.md)'s unpair used to leave (flagged in
  #823's spec, Open question 1) where the label outlived the record it described.
  [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) added a second, `clear`-only handle
  over the same instance, from that channel's per-server arm, gated on no record remaining;
  [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) re-pointed that handle at
  `clearFor` and deleted the gate. [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)
  deleted the original whole-collection handle and its channel entirely — the per-server `clearFor`
  handle is now the only one this store's erase side has.
- Downstream, not yet built: the sidebar host row ([#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)).
