# Unpair channel

The renderer→main IPC surface that lets the window ask the background process to **erase a stored
pairing** and return the app to a clean, not-paired state — the recovery mechanism for a stale,
wrong, or never-connecting pairing.

**Two channels since [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149), by design, not
one channel with two request shapes.** `UNPAIR_CHANNEL` (below) erases the **whole** collection and
still carries no body. `UNPAIR_SERVER_CHANNEL` (§ "The per-server channel") erases exactly **one**
named record and carries the module's first untrusted request field. They sit side by side, Strangler
Fig style: the composer's Re-pair control ([#166](../codebase/166.md)) is still the whole-collection
channel's only caller, unchanged, until [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)
migrates it and deletes that half. The per-server channel shipped with no caller in #1149 — same
"boundary ahead of its UI consumer" shape as the original channel's own introduction — and got its
first one in [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162), the Settings screen's
per-row Unpair action; see [§ The per-server channel](#the-per-server-channel-1149) below.

Introduced in [#173](../codebase/173.md), on top of [#172](../codebase/172.md)'s
`ClearablePairedServerStore.clear()`. It is the **byte-for-byte twin** of the [pairing-status
signal](pairing-status-signal.md) (#79/#80): same three-layer shape (shared contract, main handler,
preload bridge) plus a composition-root registration line, same value-free-by-construction reply
discipline, no held state, no request body. Where pairing-status *reads* a fact, unpair *triggers a
mutation* — the destructive-action counterpart in the same family as the [diagnostics
channel](diagnostics-channel.md) (#131), which established the general "ship the IPC boundary ahead
of its UI consumer" shape this ticket reuses a second time.

**First caller: [#166](../codebase/166.md).** The conversation screen's unpair control invokes
`window.pyry.unpair()` through the pure `runUnpair` helper — a confirm-guarded manual "forget this
pairing" action that, on `ok`, routes back to pairing via `onUnpaired`. `runUnpair` itself reset the
renderer's session state on that branch until [#531](../codebase/531.md) moved the clear upstream: the
route flip now runs through a `PairedShell` wrapper that clears the session store alongside the
timeline, the active conversation, and the daemon session id in one shared step (see [Paired
shell](paired-shell-routing.md#the-pure-view--container-pairedshelltsx)) — `runUnpair`'s ok branch is left as
"flip the route," nothing more. A second caller (an offer-re-pair-on-connection-failure prompt) may
still ship in [#167](https://github.com/pyrycode/pyrycode-desktop/issues/167).

## Why this exists

The renderer can never erase the pairing record itself — the paired-server record (bearer `token`,
`server_static_pubkey`) lives only in the background process behind `SecureStore` (CLAUDE.md: "Keep
the transport out of the window"). Recovery from a stale, wrong, or never-connecting pairing needs
*some* trigger the UI can pull, so this channel exposes exactly one capability: "erase the stored
pairing," nothing more granular and nothing that reads back a value.

## What it does

One typed round trip, `window.pyry.unpair()` → `Promise<UnpairResult>`:

- **`{ result: 'ok' }`** — [`pairedServerStore.clear()`](paired-server-store.md) completed. Covers
  both "a record was erased" and "there was nothing to erase" — `clear()` is idempotent, so unpairing
  an already-clean state is still success. As of [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827),
  `ok` also means the [host label](host-label-store.md) was erased alongside the record — but a
  failure to erase the label never downgrades this to `error`; see below.
- **`{ result: 'error' }`** — `clear()` threw. The handler classifies-don't-forward: every throw maps
  to this value-free outcome, and the caught object is dropped — never logged, interpolated, or
  returned. `clear()` is itself fail-closed (a `secureStore.delete` failure propagates rather than
  being swallowed), so this `error` arm is the boundary that turns that propagated throw into a safe,
  value-free result. It never resolves `ok` while a live bearer token may still be on disk.

No request body crosses the boundary (the renderer invokes with zero arguments) and no response field
beyond the `result` discriminant — value-free **by construction**: the type has nowhere to put a
token, `server_static_pubkey`, relay URL, keychain path, or error detail, so the handler cannot leak
one even by mistake.

## How it works

| Piece | File | Layer |
|---|---|---|
| `UNPAIR_CHANNEL` + `UnpairResult` union | `src/shared/ipc/unpair.ts` (new) | shared contract |
| `registerUnpairHandler(target, deps)` + `UnpairHandleTarget` | `src/main/unpairHandler.ts` (new) | background handler |
| `window.pyry.unpair()` | `src/preload/index.ts` (mod, +11) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod, +11) | composition root |
| `UNPAIR_SERVER_CHANNEL`, `UnpairServerRequest`, `isUnpairServerRequest` ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)) | `src/shared/ipc/unpair.ts` (mod) | shared contract |
| `registerUnpairServerHandler(target, deps)` + `UnpairServerHandleTarget` ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)) | `src/main/unpairHandler.ts` (mod) | background handler |
| `window.pyry.unpairServer(serverId)` ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)) | `src/preload/index.ts` (mod) | preload bridge |
| second `handle` registration + its own `will-quit` teardown ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)) | `src/main/index.ts` (mod) | composition root |

[#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) added a fourth dep, `hostLabel?:
Pick<HostLabelStore, 'clear'>`, and one `await`ed erase call inside the listener — no new file, no
new shared type. See "The label erase (#827)" below. [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)
is additive throughout: `UNPAIR_CHANNEL`, `UnpairResult`, `registerUnpairHandler` and its 15 tests are
untouched. See "The per-server channel (#1149)" below.

### 1. The shared contract (`src/shared/ipc/unpair.ts`)

```ts
export const UNPAIR_CHANNEL = 'pyry:unpair' as const

export type UnpairResult = { result: 'ok' } | { result: 'error' }
```

No runtime logic, no companion `isUnpairRequest` guard — unlike `pairing.ts`'s pasted-payload
validation, there is no request body here to validate. Imports nothing from `src/main` (shared is a
clean leaf loaded by both preload and renderer).

### 2. The main-process handler (`src/main/unpairHandler.ts`)

```ts
export interface UnpairHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

export function registerUnpairHandler(
  target: UnpairHandleTarget,
  deps: {
    store: ClearablePairedServerStore
    onUnpaired?: () => void
    hostLabel?: Pick<HostLabelStore, 'clear'>   // #827
  }
): () => void
```

The listener, record → label → teardown:

```ts
const listener = async (): Promise<UnpairResult> => {
  try {
    await store.clear()
  } catch {
    return { result: 'error' }   // classify-don't-forward: the caught object is DROPPED
  }
  try {
    await hostLabel?.clear()
  } catch {
    // dropped — see "The label erase (#827)" below
  }
  try {
    onUnpaired?.()
  } catch {
    // dropped — #504
  }
  return { result: 'ok' }
}
```

- **Stateless, single store interaction per dep.** The listener's *only* record-store call is
  `clear()` — never `load`/`save`. It erases; it does not read. No state held between invokes.
- **Store dep typed against the concrete `ClearablePairedServerStore`**, not base
  `PairedServerStore` — the base interface deliberately does not carry `clear()` (see [paired-server
  store](paired-server-store.md)), so this handler's fake stubs only `clear` and every other consumer's
  fake needs no edit.
- **`hostLabel` is typed `Pick<HostLabelStore, 'clear'>`, not the full interface** (#827) — mirroring
  [host-label channel](host-label-channel.md)'s `Pick<…, 'load'>` in the opposite direction. Without
  `load` on the handle, the label string cannot be materialised in this module at all: "no label text
  reaches the result or any log" is held by the type, not by a convention someone has to keep.
- **Log-free by construction** — no `console.*` anywhere in the module. A propagated
  `secureStore.delete` error (record or label) can carry a keychain/filesystem path; logging it would
  leak that path to the console. `handle` must resolve to a value, so the listener never rethrows.
- Nothing Electron-specific is imported — `ipcMain` satisfies `UnpairHandleTarget` structurally, so
  the unit test injects a fake `{ handle: vi.fn(), removeHandler: vi.fn() }`, no Electron harness.

### The label erase (#827)

The record erase alone gates `ok`; the label erase never does. `runUnpair` (the conversation
screen's caller, see below) coerces both `error` **and** a rejected invoke to "stay on the
conversation screen," so once `store.clear()` has resolved the record is gone — any later
`error` would produce a paired-looking UI over an erased record, the exact inverse half-state the
fail-closed catch above exists to prevent. A surviving label, by contrast, is stale display text:
overwritten by the next pairing that carries one, erased by the next unpair, and recoverable by
re-typing it. This is the third site under one rule already established at
`pairingHandler.ts:121-127` (write) and this module's own `onUnpaired` block (teardown): **the result
reports on the record.**

Ordering — record → label → `onUnpaired` — is deliberate, not incidental:

- **Record before label.** A label-first erase that threw would either abort (leaving a live
  bearer token on an unpair request — the worst available outcome) or continue anyway, gaining
  nothing from having gone first.
- **A process kill between the two erases** leaves *no record + orphan label*, the benign,
  self-healing interleaving (the next pairing that carries a label overwrites it; the next unpair
  erases it). Label-first would risk the inverse — record present, label gone — a live credential
  whose display name vanished, strictly worse.
- **Label before `onUnpaired`.** All at-rest erasure completes before anything observable is
  signalled, so the teardown trigger never fires over a half-erased at-rest state.

The composition root wires the **same** `hostLabelStore` instance already threaded into the pairing
and host-label handlers — no second store is constructed.

### The per-server channel (#1149)

```ts
export const UNPAIR_SERVER_CHANNEL = 'pyry:unpair-server' as const
export const MAX_SERVER_ID_LENGTH = MAX_PASTE_LENGTH   // aliased, not independently chosen — see below
export type UnpairServerRequest = { serverId: string }
export function isUnpairServerRequest(value: unknown): value is UnpairServerRequest

export interface UnpairServerHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

export function registerUnpairServerHandler(
  target: UnpairServerHandleTarget,
  deps: {
    store: Pick<MultiPairedServerStore, 'clearServer'>
    onUnpaired?: () => void
    hostLabel?: Pick<MultiHostLabelStore, 'clearFor'>   // keyed by server since #1156; was Pick<HostLabelStore, 'clear'>
  }
): () => void
```

A **second channel**, not a second branch on `UNPAIR_CHANNEL`'s one listener — `ipcMain.handle`
allows one handler per channel either way, and the deciding argument for a second channel over a
shared discriminated listener is that it turns "a malformed or unknown-id per-server request can
never fall through to the whole-collection erase" into a fact about the *type* of `deps.store`
(`Pick<MultiPairedServerStore, 'clearServer'>` carries no `clear` at all) rather than about a branch
a later edit could get wrong. `registerUnpairHandler`, its `ClearablePairedServerStore` dep and its
15 tests are untouched by this.

**The guard is this module's first-ever untrusted request field.** `isUnpairServerRequest` mirrors
`pairing.ts`'s `isPairingRequest`: pure, never throws, structural (extra fields tolerated), rejects a
non-object, `null`, a missing or non-string `serverId`, and one over `MAX_SERVER_ID_LENGTH`. The empty
string is **accepted** by the guard — emptiness is refused one step later as "names no held record,"
the same as any other unheld id, so the guard stays purely structural. `MAX_SERVER_ID_LENGTH` is
aliased to `pairing.ts`'s `MAX_PASTE_LENGTH` (not an independent number): every persisted `server` id
arrived inside a pairing paste already bounded by that constant, so this check can never make a held
record *unforgettable* while still refusing an absurd input before it reaches a comparison.

**The listener, in order:** guard → `store.clearServer(serverId)` → `matched?` → `hostLabel?.clearFor(serverId)` → teardown → `{ result: 'ok' }`.

- A guard refusal returns `{ result: 'error' }` **before any store call** — a malformed request never
  reaches the store, let alone an erase.
- `clearServer` throwing, and `matched === false` (an id nothing holds), both return
  `{ result: 'error' }` too, indistinguishable from a guard refusal or from each other by design (see
  § Security posture) — nothing is erased on any of the three.
- **On a match, the label erase runs unconditionally, naming the same `serverId` the record erase
  just used ([#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)).** Before #1156 this
  step read [`ClearServerOutcome`](paired-server-store.md)'s `remaining` count — computed inside
  `clearServer`'s own mutate queue — and cleared the (then single-slot) host label only when nothing
  remained paired, the same rule the whole-collection arm applies when the *entire* collection empties.
  That rule was correct only while the label was one un-keyed slot: erasing it on every per-server
  unpair would have wiped the name a still-paired server was displayed under. Once the store is keyed
  by server (\#1155), the gate became the bug it was guarding against — it left an unpaired machine's
  name on disk for as long as any other machine stayed paired — so \#1156 deleted it. `clearFor`
  erases exactly the named server's entry and leaves every other entry untouched by construction, so
  `remaining` decides nothing here any more; it stays on `ClearServerOutcome` for `matched`'s sake
  only. `onUnpaired` then fires unconditionally on the success path, wired at the composition root to
  `registry.reconcile()` — the same trigger the whole-collection arm uses, which already drops exactly
  the one connection whose record just went and leaves every other one live (see [Daemon connection —
  per-server routing](daemon-connection-routing.md)).
- Every caught object is dropped on this arm exactly as on the sibling — never logged, interpolated,
  or returned; the `serverId` itself never reaches a log line, keeping the module log-free by
  construction now that it takes a request at all — including on the label erase, which now names that
  same id internally.

**No read anywhere in this arm.** `deps.store`'s `Pick<MultiPairedServerStore, 'clearServer'>` carries
no `load`, `loadById`, `list` or `save`, so a `PairedServerRecord` — and therefore a bearer token or
server static key — cannot be materialised in this module at all. This is *stricter* than the
whole-collection arm, whose `ClearablePairedServerStore` dep inherits `load` and relies on a test to
pin its non-use. What removed the read this design would otherwise have needed: `clearServer` itself
now reports `{ matched, remaining }` (see [paired-server store](paired-server-store.md)), computed
atomically inside its own mutate queue, so there is no separate existence check to race the erase and
no follow-up read that could throw *after* a successful erase and downgrade it to `error`.

### 3. Preload bridge (`src/preload/index.ts`)

```ts
unpair: (): Promise<UnpairResult> => ipcRenderer.invoke(UNPAIR_CHANNEL),

unpairServer: (serverId: string): Promise<UnpairResult> =>   // #1149
  ipcRenderer.invoke(UNPAIR_SERVER_CHANNEL, { serverId }),
```

`UNPAIR_CHANNEL`/`UNPAIR_SERVER_CHANNEL` are fixed here so the renderer cannot address arbitrary IPC
channels; only these typed functions cross the bridge, never `ipcRenderer` itself. `unpair()` is
called with no second argument — no data leaves the renderer on that path. `unpairServer(serverId)`
builds the request object in the bridge as a convenience, not a defence: the renderer is untrusted
regardless, so the main side validates shape and length on its own merits via `isUnpairServerRequest`.
`PyryApi = typeof api` re-derives both methods automatically, so `src/preload/index.d.ts` needed no
edit for either.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterUnpair = registerUnpairHandler(ipcMain, {
  store: pairedServerStore,
  onUnpaired: () => registry.reconcile(),   // post-#1117; was connection.reconnect() before it
  hostLabel: hostLabelStore   // #827 — the same instance, not a second store
})
app.on('will-quit', () => unregisterUnpair())

// #1149 — a sibling registration, same store/label instances, its own teardown
const unregisterUnpairServer = registerUnpairServerHandler(ipcMain, {
  store: pairedServerStore,
  onUnpaired: () => registry.reconcile(),
  hostLabel: hostLabelStore
})
app.on('will-quit', () => unregisterUnpairServer())
```

**Moved in [#504](../codebase/504.md)** from the pairing-status sibling slot to sit beside the pairing
handler, below `createDaemonConnection` — it now needs to close over `connection`, which does not exist
at the old registration site. Still the same `pairedServerStore` built once at the composition root; no
second store constructed. **[#1117](daemon-connection-routing.md#the-connection-registry-1117)
retargeted `onUnpaired` from `connection.reconnect()` to `registry.reconcile()`** — reconcile re-reads
the store and makes the live connection set match it, so on the whole-collection erase every connection
drops, and on the [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) per-server erase
exactly the one connection whose record went drops, leaving every other one live and un-handshaken. See
[Daemon connection — per-server routing](daemon-connection-routing.md) for the full mechanism. The
`#1149` registration reuses the same `pairedServerStore` and `hostLabelStore` instances and the same
`registry.reconcile()` trigger — no second store, no second reconcile path.

## Data flow

```
renderer window.pyry.unpair()  →  ipcRenderer.invoke(UNPAIR_CHANNEL)  [no body]
  →  ipcMain handler listener  →  ClearablePairedServerStore.clear()
  →  secureStore.delete(PAIRED_SERVER_NAME)  — throw ⇒ resolves { result: 'error' }, stop here
  →  hostLabel?.clear()  →  secureStore.delete(HOST_LABEL_NAME)  — throw ⇒ dropped, continue (#827)
  →  onUnpaired?.()  — throw ⇒ dropped, continue
  →  resolves { result: 'ok' }   [value-free]
```

The per-server flow ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149), label erase
unconditional since [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)):

```
renderer window.pyry.unpairServer(serverId)  →  ipcRenderer.invoke(UNPAIR_SERVER_CHANNEL, { serverId })
  →  ipcMain handler listener  →  isUnpairServerRequest(request)  — false ⇒ { result: 'error' }, no store call
  →  store.clearServer(serverId)  →  MultiPairedServerStore's mutate queue: read → filter → delete-or-set
  →  throw ⇒ { result: 'error' }, dropped, stop here
  →  { matched: false, remaining } ⇒ { result: 'error' }, nothing erased, stop here
  →  { matched: true } ⇒ hostLabel?.clearFor(serverId)  — throw ⇒ dropped, continue
                          (every still-paired server's own entry is untouched, unconditionally — #1156)
  →  onUnpaired?.()  — registry.reconcile(), drops the one connection whose record went — throw ⇒ dropped
  →  resolves { result: 'ok' }   [value-free]
```

## Security posture

**Verdict: PASS** (architect security-review in the spec, `security-sensitive`, both on introduction
and again on [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)). #173 *introduced* the
renderer→main IPC boundary that #172 deliberately deferred; #1149 introduced this module's first
*untrusted request field* on top of it.

- **`UNPAIR_CHANNEL` alone: no untrusted input to validate.** Zero-argument invoke — the value-free
  contract makes a request guard unnecessary by construction, same as `pairingStatus`. This property
  no longer describes the module as a whole (see next bullet) — it is scoped to this one channel.
- **`UNPAIR_SERVER_CHANNEL` ends "the renderer can trigger, never parameterize" as a module-wide
  claim, by design ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)).** The
  renderer now supplies one field, `serverId`, and can therefore parameterize *which* record is
  erased — a capability this module never had before. The boundary is `isUnpairServerRequest`, the
  listener's first statement, applied before any store call; downstream of it only the narrowed
  `UnpairServerRequest` is read. The capability granted is still narrower than what the renderer could
  already trigger on `UNPAIR_CHANNEL` — "erase one named record" versus "erase every record" — so this
  is a reduction in blast radius, not a new class of power. `serverId` is matched with `===` against
  each decoded entry's own `server` field inside `clearServer`, never becomes a persistence name, path,
  or object key, and is never logged — an id like `__proto__` is inert.
- **Value-free reply by construction, on both channels.** No response member beyond the discriminant,
  so neither handler can serialize a token/key/relay/keychain-path back even under a bug — pinned by a
  test asserting the `ok` response stringifies to exactly `{"result":"ok"}`. On the per-server channel
  a guard refusal, an unknown id, and a failed erase are all `{ result: 'error' }`, deliberately
  indistinguishable: a fourth-member response would tell a compromised renderer whether a guessed id is
  paired, and it can already learn that from `serverInfo`, so the smaller, value-free union stands.
- **No credential can be materialised in the per-server handler at all** — stricter than the
  whole-collection sibling. `registerUnpairServerHandler`'s `store` dep is
  `Pick<MultiPairedServerStore, 'clearServer'>`: no `load`, `loadById`, `list`, or `save`, so a
  `PairedServerRecord` (bearer `token`, `server_static_pubkey`) cannot exist in this module's memory on
  any code path. The sibling's `ClearablePairedServerStore` dep inherits `load` and relies on a test to
  pin its non-use; this dep type structurally cannot.
- **A malformed or unknown-id per-server request cannot reach the whole-collection erase — a property
  of the type, not of a branch.** `registerUnpairServerHandler`'s dep type carries no `clear` member at
  all, so there is no name in that module through which the whole-collection wipe could be reached from
  a refused or unmatched per-server request, regardless of how the guard or the `matched` check are
  later edited.
- **Symmetric with the existing capability, not a new class of power.** A renderer that can already
  `submitPairingPaste`/`confirmPairing` (establish or overwrite pairing) being able to erase it
  introduces no new attack surface — worst case is an availability annoyance (the user re-pairs), not
  a secret leak.
- **Destructive but recoverable, and device-identity-preserving.** `clear()` deletes only
  `PAIRED_SERVER_NAME`; the device static keypair (`pyrycode.device_static`) lives under a distinct
  name in a distinct store and is structurally untouched.
- **The label erase cannot reach a credential ([#827](https://github.com/pyrycode/pyrycode-desktop/issues/827), security-sensitive, architect self-review PASS; re-reviewed PASS at [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)).**
  `hostLabelStore.clear()` deletes by its own `HOST_LABEL_NAME` constant, explicitly distinct from
  `PAIRED_SERVER_NAME` and `pyrycode.device_static` — no caller-supplied string reaches a persistence
  key. `clearFor(serverId)`, the per-server arm's handle since #1156, only ever compares `serverId`
  with `===` against a decoded entry's own field and never turns it into a name, path, or object key
  either. Both handles withhold every read member (`Pick<HostLabelStore, 'clear'>` on the
  whole-collection arm, `Pick<MultiHostLabelStore, 'clearFor'>` on the per-server one), so the label
  value is never materialised in this module, closing the same class of leak the value-free response
  already closes for the record. Both deps are optional, so the pre-existing call sites
  (`daemonConnection.test.ts` and the `unpairHandler.test.ts` registrations) compile unchanged.

## Edge cases and limitations

- **Confirmation gate lives in the caller, not here.** This channel ships only the mechanism; the
  "are you sure?" UI gate is [#166](../codebase/166.md)'s concern — a two-step confirm phase in the
  conversation screen's `UnpairControl`, ahead of the `unpair()` invoke.
- **Renderer-side state clear lives in the caller too, and moved once.** [#166](../codebase/166.md)
  originally had `runUnpair` reset `sessionStore` directly on the `ok` branch;
  [#531](../codebase/531.md) moved that reset (plus three more clears this channel has no visibility
  into) to a `PairedShell`-level wrapper around the `onUnpaired` callback `runUnpair` calls — this
  channel's contract (erase the stored pairing, report `ok`/`error`) is unaffected either way.
- **Live-session teardown, closed by [#504](../codebase/504.md).** A successful `clear()` now also
  fires an optional `onUnpaired?: () => void` dep — value-free, mirroring the pairing handler's
  `onPaired` — wired at the composition root, originally to `connection.reconnect()` and, since
  [#1117](daemon-connection-routing.md#the-connection-registry-1117), to `registry.reconcile()`. This
  used to be deferred (see the [daemon connection](daemon-connection.md) § Teardown-on-unpair doc for
  the full mechanism: the same `reconnect()`/`reconcile()` path fences the superseded driver's
  in-flight events and closes its socket, so an authenticated session can no longer outlive the record
  that authorised it). The callback sits outside the fail-closed `catch` and swallows its own throw, so
  a teardown failure can never downgrade an already-completed erase to `{ result: 'error' }` — see
  `unpairHandler.ts`'s inline rationale. [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)'s
  per-server arm wires the identical `onUnpaired: () => registry.reconcile()` at its own registration.
- **No error sub-reason.** The `error` arm deliberately carries no detail beyond the discriminant.
  #166's caller synthesizes its own generic `ConnectionError` (`code: 'unpair'`) on that arm rather
  than threading a sub-reason through. A future recovery flow that needs to distinguish error
  sub-cases extends the union additively; it is not pre-built here.
- **A failed label erase is invisible, by design ([#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)).** No diagnostic counter, no
  retry-at-next-launch. The module stays log-free by construction, no such failure has been observed,
  and the recovery path already exists (the next pairing that carries a label overwrites the stale
  one; the next unpair retries the erase).
- **The per-server erase reports `error` over a corrupt collection, where the whole-collection erase
  does not ([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)).** `clear()` never
  reads, so it succeeds even over a blob `pairedServerStore` cannot parse; `clearServer` must read to
  filter and to compute `remaining`, so a `MalformedPairedServerRecordError` makes a per-server unpair
  report `error` with nothing erased. Both existing recovery paths stay available: re-pairing
  (`save` overwrites a malformed collection) or the whole-collection unpair (`clear()` never reads, so
  it still succeeds). No code change addresses this — noted as an inherent property of a per-record
  erase over a collection whose only other reader is strict.
- **The per-server channel's first caller is the Settings screen's per-row Unpair action
  ([#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)), through the pure
  `runUnpairServer` helper** — see [Settings screen § `runUnpairServer`](settings-screen-how-it-works.md#rununpairserver-unpairserveractionts-1162).
  [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) still migrates the composer's
  Re-pair control off `unpair()` onto it and deletes `UNPAIR_CHANNEL`/`registerUnpairHandler`
  outright — at which point this document's "whole-collection channel" sections describe a deleted
  path — but that migration is no longer this channel's only forward dependency, since #1162 already
  gave the per-server arm a live production caller.
- **The two erases are not atomic** — they are two independent `SecureStore` names, not a
  transaction. A crash between them leaves *no record + orphan label*, the argued-benign,
  self-healing interleaving (see "The label erase (#827)" above). No journal, no two-phase commit.
- **The renderer's [host-label window store](host-label-window-store.md) is not reset here.**
  `clearPairingScopedState` resets the timeline, session, active conversation, and last-read state on
  unpair, but not #833's renderer store — so an unpair-then-repair *inside one running app session*
  can leave the window holding the previous label until the next `hostLabel()` load overwrites it.
  Unobservable as of #827 (that loader has no non-test consumer yet); named as a follow-up for
  whoever mounts the sidebar row (#834).

## Related

- [#504 codebase notes](../codebase/504.md) — the `onUnpaired` teardown trigger, the registration move
  below `connection`, and why the callback deliberately deviates from `onPaired`'s inside-the-try
  placement.
- [Daemon connection — per-server routing](daemon-connection-routing.md#the-connection-registry-1117) /
  #1117 — retargeted both handlers' `onUnpaired` from `connection.reconnect()` to `registry.reconcile()`,
  which is what lets [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)'s per-server
  arm drop exactly one connection instead of every connection.
- [Paired-server store](paired-server-store.md) / [#172 codebase notes](../codebase/172.md) — the
  `clear()` capability this channel calls; [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)
  adds `clearServer`'s `ClearServerOutcome` as the second capability, called from the per-server arm.
- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) —
  the second `clear()` this channel calls, as of [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827),
  via a `clear`-only handle over the same instance the pairing and host-label handlers already share.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the renderer-side counterpart #827 does **not** reset; see the edge case above.
- [Pairing-status signal](pairing-status-signal.md) / [#79 codebase notes](../codebase/79.md) — the
  literal source pattern this channel clones field-for-field.
- [Diagnostics channel](diagnostics-channel.md) / [#131 codebase notes](../codebase/131.md) — the
  other "ship an IPC boundary ahead of its consumer" precedent.
- [Pairing IPC channel](pairing-ipc-channel.md) — the stateful request/response sibling this
  contrasts with (that channel holds a pending confirm-and-server-id pair and validates a pasted
  request body; this one holds nothing and has no body to validate).
- [Conversation shell](conversation-shell.md) / [App shell](app-shell.md) / [Session store](session-store.md)
  — the three renderer-side seams [#166](../codebase/166.md) wires together as this channel's first caller.
- [#173 codebase notes](../codebase/173.md) — implementation summary, patterns established, lessons
  learned.
- [#166 codebase notes](../codebase/166.md) — the first consumer: confirm-guarded control and route
  flip (originally also the session reset, moved upstream by [#531](../codebase/531.md)).
- [#531 codebase notes](../codebase/531.md) / [Paired shell](paired-shell.md) — moved the ok-branch
  session reset out of `runUnpair` and into a shared clear wrapped around `onUnpaired` — grown to
  thirteen stores by later tickets, and, since
  [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141), the only pairing-change path that
  runs it at all (pairing another server used to share it and no longer does).
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model this
  channel's value-free contract enforces (token/keys never reach the renderer).
- [Host label store](host-label-store.md) / [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) —
  introduced the per-server arm's `clear`-only consumer of that store, gated on nothing remaining
  paired; [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) re-pointed it at the keyed
  `clearFor` and deleted the gate, so the two unpair arms no longer share that rule — the
  whole-collection arm still always erases (the collection it just emptied), the per-server arm now
  erases the one entry it just named, unconditionally.
- [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) — the visible per-server unpair
  control [#1090](https://github.com/pyrycode/pyrycode-desktop/issues/1090) called for, wired to this
  channel's per-server arm; see [Settings screen § the per-row Unpair
  action](settings-screen-how-it-works.md#the-per-row-unpair-action-1162).
- Downstream, not yet built: [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)
  (migrates the composer's Re-pair control onto `unpairServer` and retires `UNPAIR_CHANNEL`); [#1150](https://github.com/pyrycode/pyrycode-desktop/issues/1150)
  (scopes `clearPairingScopedState` to the departed server rather than the whole app, for #1162's
  "records remain" path).
