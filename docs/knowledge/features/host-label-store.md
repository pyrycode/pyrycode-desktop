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

## What it does

Gives the background process **one factory** — `createHostLabelStore({ secureStore })` — that
returns a `{ save, load, clear }` handle over the label:

- **`save(label)`** persists the label verbatim through the secure store. A second `save`
  overwrites. No length bound and no validation in this module — this store takes what it is given,
  exactly as `pairedServerStore` does. The write path's only bound lives one layer up, at
  [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)'s `isPairingRequest` guard (`MAX_HOST_LABEL_LENGTH`); the
  [host-label channel](host-label-channel.md) ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)) re-applies the same
  constant at the read boundary, and the [input field](pairing-input-screen.md#host-name-field-825) ([#825](https://github.com/pyrycode/pyrycode-desktop/issues/825)) bounds again for UX, off the same imported constant.
- **`load()`** retrieves the label with **three** distinct outcomes: `null` (never stored), `''`
  (stored empty — a real value, not absence), or a thrown `MalformedHostLabelError` (stored bytes
  are not valid UTF-8). A decrypt failure (tamper, keychain rotation) propagates unchanged.
- **`clear()`** erases the stored label. Idempotent (a no-op when nothing is stored) and fail-closed
  (a delete failure propagates rather than being reported as success).

Unlike the other two consumers, **the value this store returns is not a secret** — it is untrusted
display text that later tickets must bound and escape (see Security properties below). It rides the
secure-store seam anyway, for integrity and uniformity rather than confidentiality.

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

export class MalformedHostLabelError extends Error {}

export const HOST_LABEL_NAME = 'pyrycode.host_label'

export function createHostLabelStore(deps: {
  secureStore: SecureStore   // #42, type-only import
  name?: string              // defaults to HOST_LABEL_NAME; injectable for tests + future multi-host
}): HostLabelStore
```

One flat interface — no `Clearable…` split. `pairedServerStore` splits `PairedServerStore` /
`ClearablePairedServerStore` because three shipped consumers type against the base and would
otherwise need a `clear` stub in their fakes; this module shipped with **no consumers at all**, and
[#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) needed `clear` too, so there was
nothing a second interface would have bought. Confirmed out: three consumers now exist
(`pairingHandler` on `save`, `hostLabelHandler` on `load`, `unpairHandler` on `clear`), each typed
against a disjoint `Pick<HostLabelStore, …>` of this one flat interface rather than a narrower base
type.

### Encoding — bare UTF-8 bytes, not a JSON envelope

`save` writes `new TextEncoder().encode(label)`; `load` reads it back with
`new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)`. Both decoder options are
load-bearing and neither is the default:

- **`fatal: true`** — the default decoder is lossy: it silently rewrites invalid byte sequences to
  U+FFFD and returns a plausible string, which would make "unreadable ⇒ failure" unreachable. With
  `fatal`, an invalid sequence throws a `TypeError`, which `decodeLabel` catches and replaces with
  `MalformedHostLabelError` — the decoder's own message is an implementation detail and never
  escapes the module.
- **`ignoreBOM: true`** — the default decoder strips a leading U+FEFF, so a BOM-leading label would
  not round-trip. With it, `'﻿Pyrybox'` saves and loads back with the BOM intact.

A single string carries no fields, so a JSON envelope (`{"label": "..."}`) would only widen the
malformation surface — non-JSON, non-object, null, missing key, non-string value — for a payload
that is one string. Bare UTF-8 bytes admit exactly one malformation: not-valid-UTF-8. This is why the
label uses the [device static keypair](device-keypair.md)'s fixed-blob shape rather than the
[paired-server store](paired-server-store.md)'s JSON-envelope shape.

**Accepted round-trip caveat, deliberately not fixed:** a label containing an unpaired surrogate
(e.g. `'\uD800'`) encodes to U+FFFD and so does not round-trip byte-identically. This is inherent to
UTF-8, cannot be produced by a text input, and the store takes what it is given — there is no
surrogate check and no rejection.

### Core behavior

`createHostLabelStore` returns a plain `{ save, load, clear }` handle — no cache, no memo, no timers:

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
`unpairHandler.ts`'s listener, once `pairedServerStore.clear()` has itself resolved. See [Pairing IPC
channel § confirm carries an optional host label](pairing-ipc-channel.md#confirm-carries-an-optional-host-label-823),
[Host-label channel](host-label-channel.md), and [Unpair channel § the label erase
(#827)](unpair-channel.md) for the full hand-off on each side.

## Concurrency & lifecycle

- **No store slice, no Zustand, no renderer state** — a main-process accessor, not UI state.
- **Single source of truth is the persisted blob.** `load` re-reads it each call; no in-memory cache.
- **No timers, listeners, or long-lived tasks** — nothing to cancel on teardown. Concurrent `save`s
  are last-writer-wins with atomicity inherited from `SecureStore`/`fileSecretPersistence`'s
  temp-then-rename.
- **Deliberately no read-modify-write helper.** A `load`-then-`save` pair across an `await` would be
  a check-then-act race this module currently cannot have; a future "rename after pairing" affordance
  (#825 only writes once, at confirm — see [Pairing input screen § host name field](pairing-input-screen.md#host-name-field-825))
  must not add an `update` method that reopens it.

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
- **Log-free by construction** — no `console.*` anywhere; the label is an opaque local, never a named
  field of a logged struct. `MalformedHostLabelError`'s message is static and interpolates nothing —
  no bytes, no partial decode.
- **Threat model note.** A disk-write attacker who sets an arbitrary label can spoof the sidebar host
  name, but the same access can already replace the paired-server record wholesale, which is strictly
  worse — the label grants no new capability. The daemon never sees the label (it is not a wire
  field), so it cannot be influenced from the daemon side.

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
  handler](unpair-channel.md) a `clear`-only handle over that same instance again — three seams, three
  disjoint `Pick`s, none able to do another's job.
- **Single pyrybox** — one label under `HOST_LABEL_NAME`. Per-server-id keying
  (`pyrycode.host_label.<server-id>`) is a deferred one-line change via the injectable `name`; the
  sidebar's host-grouping design will decide whether the key becomes `<name>.<server-id>` or the
  label moves into a per-host record — out of scope here.

## Related

- [Secure store](secure-store.md) / [#42](../codebase/42.md) — the injected persistence surface this
  consumes; the third consumer.
- [Device static keypair](device-keypair.md) / [#43](../codebase/43.md) — the closer structural
  precedent (fixed-blob encoding, `Malformed…Error`, no JSON envelope) rather than the paired-server
  store's multi-field JSON shape.
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — why the label could not
  become a field on `PairedServerRecord`: that type aliases the wire's `QrPayload`, and the daemon
  never sees a host name.
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
  Open question 1) where the label outlived the record it described.
- Downstream, not yet built: the sidebar host row ([#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)).
