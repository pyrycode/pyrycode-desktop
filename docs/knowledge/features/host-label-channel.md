# Host-label channel

The renderer→main IPC surface that lets the window read the operator-typed **host label** back from
the at-rest [host-label store](host-label-store.md) — **including while disconnected**.

**Three channels since [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186), by design,
not one channel with two request shapes or a branch on an existing one** — the same cut
[#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) made for
[the unpair channel](unpair-channel.md#the-per-server-channel-1149), applied a third time.
`HOST_LABEL_CHANNEL` (below) names no machine and still carries no body. `HOST_LABEL_SERVER_CHANNEL`
(§ "The per-server channel") names **one** machine and carries the module's first untrusted request
field. `HOST_LABEL_SET_CHANNEL` (§ "The per-server SET channel") also names one machine, and is the
module's first **write** — it asks that machine *be called* something, where the other two only ask
what it *is* called. They sit side by side: `hostLabelLoader`'s one-shot loader is still the
zero-argument channel's only caller, invoking `window.pyry.hostLabel` as a bare function reference — a
newly required parameter would break that caller at the type level, which is what makes a second
channel forced rather than merely tidy. The keyed read channel ships with no caller yet — the same
"boundary ahead of its UI consumer" shape the zero-argument channel itself shipped in — and its
sidebar consumer is [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070). The set channel
likewise ships with no caller; [#1187](https://github.com/pyrycode/pyrycode-desktop/issues/1187)'s
Edit host dialog is the consumer it is natively blocked on.

Introduced in [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824). It is the **fourth**
member of the [pairing-status signal](pairing-status-signal.md) (#79) / [unpair
channel](unpair-channel.md) (#173) / [server-info channel](server-info-channel.md) (#339) family: same
four-layer shape (shared contract, main handler, preload bridge, composition-root registration), same
injected-target / stateless-handler / classify-don't-forward discipline. [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822)
built the store, [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) wired its write path
into pairing confirm; [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) is the
zero-argument read half. Shipped with no caller;
[#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) gave it one — see
[Host-label window store](host-label-window-store.md) — and the sidebar host row that renders the value
is still open as [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834). [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)
is the per-server read half, answering from [`MultiHostLabelStore.loadFor`](host-label-store.md).

## Why a new channel, not `ServerInfo`

`ServerInfo` is the closer file-shape twin but the wrong template, for two independent reasons, either
alone sufficient:

- **The seal.** `src/shared/ipc/serverInfo.ts` says in terms *"do NOT add any field to the present
  arm."* A third field would be the first crack in that seal.
- **Incompatible outcome cardinality.** `ServerInfo` deliberately *collapses* not-paired and unreadable
  into one `unavailable` arm. This channel must keep never-stored and unreadable apart (see below), so
  a shared discriminant cannot serve both — the label would need a nested status field inside
  `ServerInfo`, a worse version of a separate union on a channel whose contract forbids the widening.

A dedicated channel keeps `ServerInfo` sealed and confines the new surface to a separately-reviewed
boundary — the same move `ServerInfo` itself made against `pairingStatus` one store earlier.

## What it does

One typed round trip, `window.pyry.hostLabel()` → `Promise<HostLabelResult>`, **three** arms —
modelled on [`PairingStatus`](pairing-status-signal.md), not on `ServerInfo`'s two-arm collapse,
because ADR 0005 forbids masking an unreadable record as never-stored and
[host-label store](host-label-store.md) makes the identical argument for the label directly:

- **`{ status: 'stored'; label: string }`** — [`hostLabelStore.load()`](host-label-store.md) returned a
  string. `''` **is** a stored label — the operator supplied an empty one — not absence; this is the
  last boundary where that distinction could be thrown away, and it is not. Since
  [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156), `load()` itself may be answering
  from a keyed collection rather than a single blob (a second pairing no longer overwrites the first
  machine's name at write time) — this channel does not know or care which; it still hands back
  exactly one label, verbatim, never the at-rest envelope.
- **`{ status: 'not-stored' }`** — `load()` returned `null`. The only not-stored path. Declares no
  `label` key at all (not `label: undefined`) — Electron's structured-clone IPC **preserves** an own
  `undefined` property (unlike `JSON.stringify`), so a renderer testing `'label' in result` would
  otherwise misread absence as presence.
- **`{ status: 'error' }`** — `load()` threw (`MalformedHostLabelError`, or a propagated decrypt
  failure from tamper/keychain rotation), **or** the string it returned exceeds
  `MAX_HOST_LABEL_LENGTH`. Both collapse to the same value-free arm; the error type and the over-length
  value are never surfaced, never truncated, never partially reported.

`label` is the only field on the whole union, and it lives only on `stored` — the other two arms are
value-free by construction, so the handler cannot serialize a token, a server key, a keychain path, an
error message, or a truncated label prefix onto them.

## How it works

| Piece | File | Layer |
|---|---|---|
| `HOST_LABEL_CHANNEL` + `HostLabelResult` | `src/shared/ipc/hostLabel.ts` (new) | shared contract |
| `registerHostLabelHandler(target, deps)` + `HostLabelHandleTarget` | `src/main/hostLabelHandler.ts` (new) | background handler |
| `window.pyry.hostLabel()` | `src/preload/index.ts` (mod) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod) | composition root |

Since #1157, the same four layers again for the keyed sibling — see § "The per-server channel" below:

| Piece | File | Layer |
|---|---|---|
| `HOST_LABEL_SERVER_CHANNEL` + `HostLabelServerRequest` + `isHostLabelServerRequest` | `src/shared/ipc/hostLabel.ts` (mod) | shared contract |
| `registerHostLabelServerHandler(target, deps)` + `HostLabelServerHandleTarget` | `src/main/hostLabelHandler.ts` (mod) | background handler |
| `window.pyry.hostLabelFor(serverId)` | `src/preload/index.ts` (mod) | preload bridge |
| second `handle` registration + its own `will-quit` teardown | `src/main/index.ts` (mod) | composition root |

Since #1186, a third time for the write — see § "The per-server SET channel" below:

| Piece | File | Layer |
|---|---|---|
| `HOST_LABEL_SET_CHANNEL` + `HostLabelSetRequest` + `isHostLabelSetRequest` | `src/shared/ipc/hostLabel.ts` (mod) | shared contract |
| `registerHostLabelSetHandler(target, deps)` + `HostLabelSetHandleTarget` | `src/main/hostLabelHandler.ts` (mod) | background handler |
| `window.pyry.setHostLabelFor(serverId, label)` | `src/preload/index.ts` (mod) | preload bridge |
| third `handle` registration + its own `will-quit` teardown, deps on **two** stores | `src/main/index.ts` (mod) | composition root |

### 1. The shared contract (`src/shared/ipc/hostLabel.ts`)

```ts
export const HOST_LABEL_CHANNEL = 'pyry:host-label' as const

export type HostLabelResult =
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }
```

No runtime logic, no request guard — the invoke carries zero arguments, so there is no untrusted
request field to validate. Imports nothing from `src/main`; relative imports only. Ships with **no
test file**, same as `serverInfo.ts`/`pairingStatus.ts` — correctness here is `npm run typecheck`'s
job (union exhaustiveness) plus the handler tests importing the channel constant rather than a literal.

### 2. The main-process handler (`src/main/hostLabelHandler.ts`)

```ts
export interface HostLabelHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

export function registerHostLabelHandler(
  target: HostLabelHandleTarget,
  deps: { store: Pick<HostLabelStore, 'load'> }
): () => void
```

```ts
const listener = async (): Promise<HostLabelResult> => {
  try {
    const label = await store.load()
    if (label === null) return { status: 'not-stored' }        // strict null, never truthiness
    if (label.length > MAX_HOST_LABEL_LENGTH) return { status: 'error' }
    return { status: 'stored', label }                          // verbatim
  } catch {
    return { status: 'error' }                                  // classify-don't-forward
  }
}
```

- **`Pick<HostLabelStore, 'load'>`, not the full store interface.** Structurally write-proof and
  erase-proof — the handler cannot call `save` or `clear` even by accident, so a read channel can
  never mutate at-rest state. The mirror image of [#823](https://github.com/pyrycode/pyrycode-desktop/issues/823),
  which gave the pairing handler `Pick<HostLabelStore, 'save'>` so it could neither read the label
  back nor erase it.
- **`label === null`, never a truthiness test.** The single highest-risk line in the ticket: `''` is
  falsy, so `if (!label)` type-checks, reads naturally, and passes any test that only exercises a
  non-empty label — while silently collapsing a stored empty label into absence at the one boundary
  where #822 and #823 both paid to keep the distinction alive.
- **The bound is the exact negation of the write guard's.** `label.length > MAX_HOST_LABEL_LENGTH`,
  imported from `../shared/ipc/pairing` — the same constant, same expression polarity, same unit
  (UTF-16 code units) as `isPairingRequest`'s `label.length <= MAX_HOST_LABEL_LENGTH`. Re-declaring or
  re-measuring (byte length, code-point count) would disagree with the write bound for any non-ASCII
  label. `MAX_HOST_LABEL_LENGTH` bounds only what can be *written* through the IPC guard, not what is
  already on disk — a value stored before the bound existed, or by tampering that still decrypts — so
  this boundary re-applies it rather than trusting the write side retroactively.
- **Classify-don't-forward + log-free by construction.** Every throw — `MalformedHostLabelError` or a
  propagated decrypt failure whose message can carry a filesystem path or keychain detail — collapses
  to `error` without inspecting the error type; the caught object is dropped, never logged,
  interpolated, or returned. No `console.*` anywhere in the module, on any branch. `handle` must
  resolve to a value, so the listener never rethrows.
- **Stateless** — reads the store fresh on every invoke (no cache), so a label written at pairing
  confirm is visible on the very next invoke with no invalidation step. Since \#1156 that confirm
  writes a **keyed** envelope; this handler and its `Pick<HostLabelStore, 'load'>` dep are unchanged
  by that — the seam that keeps this call answering with one label instead of the raw envelope lives
  one layer down, inside `store.load()` itself (see [host-label store § Core
  behavior](host-label-store.md)).
- Nothing Electron-specific is imported — `ipcMain` satisfies `HostLabelHandleTarget` structurally, so
  the unit test injects a fake `{ handle: vi.fn(), removeHandler: vi.fn() }`.

### The per-server channel (#1157)

```ts
export const HOST_LABEL_SERVER_CHANNEL = 'pyry:host-label-server' as const
export type HostLabelServerRequest = { serverId: string }
export function isHostLabelServerRequest(value: unknown): value is HostLabelServerRequest

export interface HostLabelServerHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

export function registerHostLabelServerHandler(
  target: HostLabelServerHandleTarget,
  deps: { store: Pick<MultiHostLabelStore, 'loadFor'> }
): () => void
```

A **second channel**, not a second branch on `HOST_LABEL_CHANNEL`'s one listener — the same argument
[the per-server unpair channel](unpair-channel.md#the-per-server-channel-1149) made: it turns "a
malformed keyed request can never fall through to the un-keyed read, and vice versa" into a fact about
the *types* of the two handlers' `deps.store` (`Pick<MultiHostLabelStore, 'loadFor'>` here carries no
`load` at all) rather than about a branch a later edit could get wrong. `registerHostLabelHandler` and
its tests are untouched by this.

**The guard is this module's first-ever untrusted request field.** `isHostLabelServerRequest` mirrors
`unpair.ts`'s `isUnpairServerRequest` structurally — pure, never throws, accepts extra fields, rejects
a non-object, `null`, a missing or non-string `serverId`, and one over `MAX_SERVER_ID_LENGTH` — but is
a separate function rather than a shared one: the two guard two channels with two different verbs, and
naming one after the other would make a later divergence in either read as a bug in both.
`{ serverId: undefined }` is **rejected** (the `typeof` test does it, and matters because structured
clone preserves an own `undefined` property); the empty string is **accepted**, answered one step
later by the store as `not-stored`, the same two rulings `isUnpairServerRequest` settled.
`MAX_SERVER_ID_LENGTH` is **imported from `./unpair`**, not redeclared — a second number would be the
exact drift the ticket forbids, and the aliasing argument (every persisted `server` id already arrived
inside a pairing paste bounded by `MAX_PASTE_LENGTH`) carries over unchanged. The test pins the reuse
by **identity** (`expect(MAX_SERVER_ID_LENGTH).toBe(MAX_PASTE_LENGTH)`), not by a copied numeric
literal — a hardcoded `128` would pass today and drift silently the first time either bound moved.

**The listener, in order:** guard → `store.loadFor(request.serverId)` inside a `try` → strict
`=== null` check → length check → return. Identical shape to `registerHostLabelHandler`'s listener,
one layer keyed:

- A guard refusal returns `{ status: 'error' }` **before any store call** — asserted in tests as "the
  store was never invoked," not merely "the outcome is `error`," because a `null`/`undefined` request
  with the guard *deleted* would still redden into `error` through the `catch` (making
  `request.serverId` throw), leaving an outcome-only assertion vacuous. This gap was the one **SHOULD
  FIX** the architecture spec's self-review raised and the fix it verified by deletion-testing.
- `label === null` → `not-stored`, never a truthiness test, for the same reason as the zero-argument
  arm: `''` is a stored label, not absence.
- `label.length > MAX_HOST_LABEL_LENGTH` → `error`, dropped whole, same constant and unit as the
  zero-argument arm and as the write guard.
- Every throw — `MalformedHostLabelError` or a propagated decrypt failure — collapses to the same
  `error` without inspecting the error type; the caught object is dropped, never logged. The request
  id is never logged either, on any branch, which is what keeps this module log-free now that it takes
  a request at all.
- The guarded id reaches only `loadFor`'s `===` compare against each decoded entry's own `server`
  field — never a persistence name, a filesystem path, or an object key — so an id like `__proto__` is
  inert (see [host-label store § Security properties](host-label-store.md)).

**On a machine installed before #1156, this answers `not-stored` for every id** until the next
pairing writes a keyed envelope — `loadFor` reads through `readEntries`, which maps a legacy bare blob
to `[]`. A documented one-way loss, not a gap to patch here: the store has no view of the paired
records and so cannot name the server a bare string belonged to, and adopting it for one server would
recreate the bug [#1155](https://github.com/pyrycode/pyrycode-desktop/issues/1155) exists to fix.

### The per-server SET channel (#1186)

```ts
export const HOST_LABEL_SET_CHANNEL = 'pyry:host-label-set' as const
export type HostLabelSetRequest = { serverId: string; label: string }
export function isHostLabelSetRequest(value: unknown): value is HostLabelSetRequest

export interface HostLabelSetHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

export function registerHostLabelSetHandler(
  target: HostLabelSetHandleTarget,
  deps: {
    store: Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>
    pairedServers: Pick<MultiPairedServerStore, 'loadById'>
  }
): () => void
```

A **third channel**, not a request shape on the keyed read and not a branch on either existing
listener — the same argument the per-server read made against the zero-argument read, applied once
more: it keeps each arm's store handle minimal and separate, so a read can never write, the write can
neither read a label back nor reach the un-keyed slot, and a malformed request on any one of the three
cannot fall through to another. `registerHostLabelHandler` and `registerHostLabelServerHandler` are
untouched by this.

**This is the module's first write, and its guard is one field wider than the read's.**
`isHostLabelSetRequest` mirrors `isHostLabelServerRequest` structurally but is a separate function for
that guard's own stated reason — the two guard different verbs, and naming one after the other would
make a later divergence in either read as a bug in both. Both bounds are **imported, never restated**:
`MAX_SERVER_ID_LENGTH` from `./unpair` (as the read already does) and `MAX_HOST_LABEL_LENGTH` from
`./pairing`, in `isPairingRequest`'s own unit (UTF-16 code units). `label` is **required** here where
`PairingRequest.label` is optional — absence and emptiness are one answer on this channel ("no
label"), decided once by the handler's trim, so a second representation would only let the two
disagree. The bound applies to the **raw** label, before any trim: an over-long value that would trim
short is still refused, because the guard bounds what crosses the wire rather than what survives
normalisation. `{ serverId: undefined }` / `{ label: undefined }` are **rejected** (structured clone
preserves an own `undefined` property); an empty `serverId` and an empty `label` are both **accepted**
— the empty id is answered one step later by the existence check, and the empty label is not malformed
at all, it is the request to clear.

**The listener, in order:** guard (outside the `try`, first statement) → trim the label once (also
outside the `try` — a string's `.trim()` cannot throw) → inside the `try`, the existence check → one of
two store calls chosen by the trimmed value → return.

- **The trim is `pairingState.ts`'s `hostLabelToSend` collapse, relocated from the screen to the
  boundary.** Blank after trimming means "no label" on this channel by construction; the trimmed value
  is both what gets written and what the response describes, so the two can never disagree.
- **The existence check is the ticket's one new risk, and the reason it exists is at-rest hygiene, not
  just correctness.** `saveFor` drops any entry for the id and appends, so without the check a bogus
  id would park an orphan label that the still-live un-keyed `load` would then answer with (that read
  returns the most recently stored entry), and would let a caller grow the blob one entry per guessed
  id with no bound. `deps.pairedServers` is `Pick<MultiPairedServerStore, 'loadById'>` — the first
  paired-server handle in this family, because nothing here reports a match from inside a mutate queue
  the way `unpairHandler`'s `clearServer` does. It is contained the way `registerServerInfoHandler`
  contains `list`: `(await pairedServers.loadById(id)) === null` reduces the record to a boolean **in
  the call expression itself** — never bound to a name, never destructured, never spread — so no field
  of it (and `PairedServerRecord` is a `QrPayload` alias: a bearer token and a server static key) is
  reachable on any later line. `loadById` rather than `list` for exactly that: a null test names no
  field, where a collection would put every paired record in scope to answer a question about one.
- **One channel, two store methods, chosen by the trimmed value.** `label === ''` → `clearFor`,
  answering `{ status: 'not-stored' }`. Otherwise → `saveFor`, answering `{ status: 'stored', label }`
  — the value **just written**, not a read-back: a re-read would need a third store method, could
  throw after a completed write and downgrade a real success to `error`, and would race the store's
  own mutate queue for nothing.
- **Classify-don't-forward, identical to both siblings.** Every throw — a guard-adjacent
  `MalformedPairedServerRecordError` from the existence check, or `EncryptionUnavailableError` /
  a decrypt failure / `MalformedHostLabelError` from either store call — collapses to the same
  value-free `error` without inspecting the error type; the caught object is dropped. A refusal is
  deliberately indistinguishable from a throw, so a compromised renderer cannot learn which of its
  guesses was well-formed. Log-free by construction: no `console.*` on any branch, the id and the
  label stay opaque locals.

**Accepted residual: the check-then-act gap.** `loadById` and the write are two stores' operations
across an `await`, so an unpair landing between them leaves an orphan label for a server that is no
longer paired. Not closed here — cross-store atomicity is not available, and a second queue in this
handler would serialize against a lock the paired store does not share. Same shape and severity as the
already-documented non-atomicity between `unpairHandler`'s two erases (see § Edge cases below):
self-healing, stale display text rather than a live credential.

### 3. Preload bridge (`src/preload/index.ts`)

```ts
hostLabel: (): Promise<HostLabelResult> => ipcRenderer.invoke(HOST_LABEL_CHANNEL),

hostLabelFor: (serverId: string): Promise<HostLabelResult> =>
  ipcRenderer.invoke(HOST_LABEL_SERVER_CHANNEL, { serverId }),

setHostLabelFor: (serverId: string, label: string): Promise<HostLabelResult> =>
  ipcRenderer.invoke(HOST_LABEL_SET_CHANNEL, { serverId, label }),
```

`HOST_LABEL_CHANNEL`, `HOST_LABEL_SERVER_CHANNEL` and `HOST_LABEL_SET_CHANNEL` are each fixed at their
own call site so the renderer cannot address an arbitrary channel or reach one query by malforming
another's request; `ipcRenderer` never crosses the bridge either way. `hostLabel()` is called with no
second argument — no data leaves the renderer on that arm. `hostLabelFor`'s `serverId` and
`setHostLabelFor`'s `serverId`/`label` are the values that leave the renderer on the keyed arms, and
**building the request object in the bridge is a convenience, not a defence** — the main side
validates the shape and the length on its own merits regardless, for all three. `PyryApi = typeof api`
re-derives `window.pyry.hostLabel`, `.hostLabelFor` and `.setHostLabelFor` automatically — no
`index.d.ts` edit for any of them. `hostLabel` has its caller since [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833);
`hostLabelFor` ships with no caller — [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)
migrates the sidebar onto it. `setHostLabelFor` likewise ships with no caller —
[#1187](https://github.com/pyrycode/pyrycode-desktop/issues/1187)'s Edit host dialog is the consumer.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterHostLabel = registerHostLabelHandler(ipcMain, { store: hostLabelStore })
app.on('will-quit', () => unregisterHostLabel())

const unregisterHostLabelServer = registerHostLabelServerHandler(ipcMain, { store: hostLabelStore })
app.on('will-quit', () => unregisterHostLabelServer())
```

Registered immediately after `registerServerInfoHandler`, reusing the **same** `hostLabelStore`
[#823](https://github.com/pyrycode/pyrycode-desktop/issues/823) already constructs there — no second
store built, the same discipline as the server-info/paired-server-store pairing. Needs only the store
(no `connection`, no `did-finish-load` gate), so placement is not correctness-critical; grouped with
its store-only siblings for readability. `will-quit` teardown, symmetric with the other three. Since
[#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) the keyed registration sits right
beside it, reusing the same `hostLabelStore` instance a third time (write, erase, and now the keyed
read all share it) with its own symmetric `will-quit` remover. Since
[#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186) the set registration sits beside
that, reusing **both** `hostLabelStore` and `pairedServerStore` — the only host-label arm to take a
dep on two stores — so a set is visible to both reads on the very next invoke and so the existence
check sees exactly the records the pairing write and the unpair erase maintain. Its own symmetric
`will-quit` remover completes the set of four.

## Data flow

```
renderer window.pyry.hostLabel()  →  ipcRenderer.invoke(HOST_LABEL_CHANNEL)   [no body]
  →  ipcMain handler listener  →  HostLabelStore.load()
       null                        →  { status: 'not-stored' }
       string, length <= 128       →  { status: 'stored', label }              [verbatim]
       string, length > 128        →  { status: 'error' }                      [dropped whole]
       throws (any error type)     →  { status: 'error' }                      [no detail]

renderer window.pyry.hostLabelFor(serverId)  →  ipcRenderer.invoke(HOST_LABEL_SERVER_CHANNEL, { serverId })
  →  ipcMain handler listener  →  guard(request)
       malformed                  →  { status: 'error' }                      [before any store call]
       well-formed                →  MultiHostLabelStore.loadFor(serverId)
                                        null                    →  { status: 'not-stored' }   [incl. legacy blob]
                                        string, length <= 128   →  { status: 'stored', label }  [verbatim]
                                        string, length > 128    →  { status: 'error' }          [dropped whole]
                                        throws (any error type) →  { status: 'error' }          [no detail]

renderer window.pyry.setHostLabelFor(serverId, label)  →  ipcRenderer.invoke(HOST_LABEL_SET_CHANNEL, { serverId, label })
  →  ipcMain handler listener  →  guard(request)
       malformed                  →  { status: 'error' }                      [before any store call]
       well-formed                →  trim(label)  →  MultiPairedServerStore.loadById(serverId)
                                        null (unpaired id)      →  { status: 'error' }          [nothing written]
                                        record (reduced to ≠null) →  trimmed label === ''?
                                             yes → MultiHostLabelStore.clearFor(serverId)  →  { status: 'not-stored' }
                                             no  → MultiHostLabelStore.saveFor(serverId, trimmed)
                                                      →  { status: 'stored', label: trimmed }  [value written, not read back]
                                        throws (any error type, either store) →  { status: 'error' }  [no detail]
```

## Security posture

**Verdict: PASS** (architect self-review, `security-sensitive`). Key findings, zero-argument channel:

- **No untrusted input to validate** — zero-argument invoke.
- **Exactly one field can ever cross, statically enforced.** `label` is the sole field on the sole
  arm that carries data; the other two arms are value-free by the type, not by handler care.
- **No new class of power.** A renderer that will be shown the label anyway (once #826 renders it)
  gaining read access to it now is a minimal, strictly-scoped relaxation — no route to the token, the
  server key, or any keychain detail.
- **Absence is never invented, and never confused with a stored empty string.** `not-stored` is the
  only path from `null`; `''` always yields `stored`. `error` is deliberately distinct from
  `not-stored`, mirroring `PairingStatus`.
- **A tampered or oversized blob is contained, not surfaced.** Over-length is rejected whole (no
  truncation, no prefix, no reported length); invalid UTF-8 and AEAD-decrypt failure both land on the
  same value-free `error` arm.
- **Connection-independence is structural.** The handler holds no reference to the relay connection,
  the supervisor, or any session value — there is no code path by which a live connection could affect
  the result.

**Key findings, per-server channel ([#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157)), verdict PASS:**

- **The `Pick<MultiHostLabelStore, 'loadFor'>` dep type is the security substance, not tidiness.** It
  withholds `save`, `saveFor`, `clear`, `clearFor` **and** `load` — so this channel cannot mutate
  at-rest state and cannot answer with the un-keyed record either. The compiler holds that, not a
  branch a later edit could get wrong.
- **A guarded id never becomes a persistence name, path, or object key.** `loadFor` matches it with
  `===` against each decoded entry's own `server` field, so an id like `__proto__` is inert.
- **Accepted, named rather than fixed: a per-id existence oracle.** A compromised renderer learns, for
  a guessed id, whether a label is held — the same distinction AC3 requires the union to preserve, so
  it cannot be closed without failing the ticket. It is the narrower half of what `serverInfo` already
  answers, and discloses presence, never a token, key, or relay URL. The refusal arm is the *same*
  value-free `error` as every other failure, so the guard leaks nothing about which guesses were
  well-formed.
- **No rate limit added, deliberately.** One invoke is one local decrypt plus a linear `find` over an
  envelope whose size the pairing guards already bound. The property is identical to `pairingStatus`,
  `serverInfo`, and the zero-argument `hostLabel` arm; adding a limit to this channel alone would close
  nothing.

**Key findings, per-server SET channel ([#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)), verdict PASS:**

- **The two `Pick` dep types are the security substance.** `Pick<MultiHostLabelStore, 'saveFor' |
  'clearFor'>` withholds `save`, `clear`, `load` **and** `loadFor` — this arm can neither reach the
  un-keyed slot nor read a label back. `Pick<MultiPairedServerStore, 'loadById'>` withholds `list`,
  `load` and `save` — the one paired-server capability granted is a lookup by the id already on the
  request, not a way to enumerate.
- **This is the first host-label handler able to materialise a `PairedServerRecord`** (a `QrPayload`
  alias: a bearer token, a server static key), because nothing here reports a match from inside a
  mutate queue the way `unpairHandler`'s `clearServer` does. Contained by reducing it to a boolean
  **in the call expression itself** — never bound to a name, never destructured, never spread — pinned
  by a test asserting the response's keys never include a field of it.
- **This is the first freely-drivable write in the family**, and it is a strictly bounded one: the
  existence check caps the entry count by the paired-server count, so it cannot be used to grow the
  at-rest blob past that. Named and accepted rather than fixed, the same way the keyed read's per-id
  existence oracle was: `unpairServer` already offers the renderer an unrated keychain write, so a
  limit on this channel alone would close nothing.
- **Refusal is indistinguishable from a throw**, and from an unpaired id, on purpose — all three land
  on the same value-free `error`, so a compromised renderer cannot learn which of its guesses was
  well-formed.
- **Accepted residual: the `loadById` → write check-then-act gap** (see § "The per-server SET channel"
  above) — cross-store atomicity is not available, and the interleaving is self-healing.

## Edge cases and limitations

- **The label used to outlive an unpair; [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) closed the normal case.**
  [#173](../codebase/173.md)'s unpair used to clear only `pairedServerStore`; `unpairHandler.ts` now
  also clears the label (via a `clear`-only handle over this same store), ordered after the record's
  own erase and before the teardown trigger — see [Unpair channel § the label erase
  (#827)](unpair-channel.md). After an unpair this channel returns `{ status: 'not-stored' }` for the
  previous host. **One residual:** the two erases are not atomic, so a crash between them can still
  leave an orphan label this channel would faithfully report as `stored` — a self-healing
  interleaving (the next pairing that carries a label overwrites it; the next unpair erases it), not
  a cross-store consistency check this handler is responsible for adding.
- **`error` and over-length both mean "no usable label," and the union does not distinguish them.**
  Both call for the same recovery (re-enter the label) in #826's design; if a reason to split ever
  surfaces, the union extends additively then.
- **`HOST_LABEL_CHANNEL` stays zero-argument and body-free — permanently, not provisionally.**
  `HOST_LABEL_NAME` is one constant; the store behind it has held a label **per server** since #1155,
  and the pairing/unpair writers have addressed it that way since #1156. This channel was kept
  out of scope on purpose: its `load()` call answers from the keyed collection (the most recently
  stored label) rather than changing shape, because its one caller (`hostLabelLoader`) passes it as a
  bare function reference and a required parameter would break that caller at the type level.
  [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) gave the per-server question its
  own channel instead — see § "The per-server channel" above — and
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070) owns the sidebar's move onto it.
- **Repeated invokes are cheap** on all three channels — each is an independent local `store.load()`,
  `store.loadFor()`, or `loadById()` + `saveFor()`/`clearFor()`, no amplification, no state mutation
  beyond the set channel's own single write, no secret returned.
- **On the keyed read channel, a machine installed before [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)
  reads as never-stored for every id** until the next pairing writes a keyed envelope — see § "The
  per-server channel" above. The zero-argument channel is unaffected: it keeps answering with that
  machine's bare pre-#1156 label verbatim.
- **On a pre-#1156 legacy blob, the set channel's clear is a silent no-op at rest, though it still
  reports `not-stored` truthfully.** `clearFor` reads through `readEntries`, which maps a bare legacy
  blob to no entries, so it finds nothing to remove and returns without writing — the bare label
  survives on disk and the zero-argument `hostLabel()` keeps answering with it, even though this
  channel reported the clear as done. Named in [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)'s
  security review as an accepted, out-of-scope discrepancy: erasing the legacy blob would be a new
  migration behaviour, not this channel's semantics to add. A **save** on the same legacy machine
  self-heals it immediately — `saveFor` always writes the newer keyed envelope regardless of what it
  found — so the gap is clear-only and closes itself the next time a label is actually set.
- **The set channel's existence check and its write are not atomic across the two stores it touches.**
  See § "The per-server SET channel" above — an unpair landing between `loadById` and the write leaves
  an orphan label, self-healing the same way the unpair channel's own two-erase gap is (§ Related).

## Related

- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) —
  `load()`, the source of all three outcomes, and the never-stored/stored-empty/malformed distinction
  this channel exists to carry across the boundary intact. Since
  [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156), `load()` also decides between a
  legacy single-slot blob and a keyed envelope on this channel's behalf — see that doc's § Core
  behavior for how it keeps answering with one label either way.
- [Pairing IPC channel](pairing-ipc-channel.md) § Confirm carries an optional host label
  ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)) — the write half this channel
  mirrors; `MAX_HOST_LABEL_LENGTH` is declared there and imported here, not redeclared.
- [Server-info channel](server-info-channel.md) / [#339](../codebase/339.md) — the closer file-shape
  twin and the channel this ticket deliberately does **not** extend; see § Why a new channel above.
- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the three-arm,
  `error`-distinct-from-not-paired precedent this channel's union is modelled on, per ADR 0005.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the fail-closed,
  classify-don't-forward discipline the `catch` implements, and the rule that an unreadable record must
  never be masked as never-stored.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the renderer store and one-shot loader that call `hostLabel()`, as a bare function reference — the
  reason [#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) added a channel instead of a
  parameter. **Read the full hand-off there.**
- [Unpair channel § the per-server channel (#1149)](unpair-channel.md#the-per-server-channel-1149) —
  the second-channel-not-second-shape precedent `HOST_LABEL_SERVER_CHANNEL` reuses, including its two
  settled guard rulings (`{ serverId: undefined }` rejected, `''` accepted) and its
  `MAX_SERVER_ID_LENGTH`/`MAX_PASTE_LENGTH` aliasing, imported here rather than redeclared; also the
  home of the two-erase non-atomicity that [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)'s
  `loadById`-then-write gap is compared against in severity above.
- Downstream, not yet built: the sidebar host row that mounts the store's binding and renders the
  value, including the never-stored/error fallback and the escaped-text-only rendering rule (CLAUDE.md,
  operator ruling 2026-08-20) — [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834). Its
  per-server successor, migrating onto `hostLabelFor`/`HOST_LABEL_SERVER_CHANNEL`, is
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070).
- [#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186) — `HOST_LABEL_SET_CHANNEL`, this
  document's § "The per-server SET channel", the module's first write and its first handle onto
  `pairedServerStore`. Downstream, not yet built: the Edit host dialog that gives
  `window.pyry.setHostLabelFor` its caller —
  [#1187](https://github.com/pyrycode/pyrycode-desktop/issues/1187).
