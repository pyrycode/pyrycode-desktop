# Unpair channel

The renderer→main IPC surface that lets the window ask the background process to **erase one named
paired server's record** and return that connection to a clean, not-paired state — the recovery
mechanism for a stale, wrong, or never-connecting pairing.

**One channel, and it names its server.** That was not always true. [#173](../codebase/173.md)
introduced `UNPAIR_CHANNEL`, a bodiless request that erased the **whole** collection.
[#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) added `UNPAIR_SERVER_CHANNEL`
beside it as a Strangler Fig — a second channel, not a second request shape on the first, so that "a
malformed per-server request can never reach the whole-collection erase" was a property of the
*types* rather than of a branch. [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)
gave the per-server channel its first production caller, the Settings screen's per-row Unpair action.
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) migrated the *last* whole-collection
caller — the composer's Re-pair control — onto the per-server channel and deleted
`UNPAIR_CHANNEL`/`registerUnpairHandler`/`window.pyry.unpair` outright, along with the composition-root
registration and the host-label `clear()` call it made. **The app now registers no whole-collection
erase at all.** Everything below describes the surviving, per-server channel; the whole-collection one
is described only where its history still shapes the current design.

Introduced in [#173](../codebase/173.md), on top of [#172](../codebase/172.md)'s
`ClearablePairedServerStore.clear()`. It was originally the **byte-for-byte twin** of the [pairing-status
signal](pairing-status-signal.md) (#79/#80): same three-layer shape (shared contract, main handler,
preload bridge) plus a composition-root registration line, same value-free-by-construction reply
discipline, no held state. Where pairing-status *reads* a fact, unpair *triggers a mutation* — the
destructive-action counterpart in the same family as the [diagnostics channel](diagnostics-channel.md)
(#131), which established the general "ship the IPC boundary ahead of its UI consumer" shape #173 reused.

**Current callers, both delegating to the same helper.** The Settings screen's per-row Unpair action
([#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)) calls `runUnpairServer` directly.
The composer's Re-pair control ([#166](../codebase/166.md), migrated by
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)) resolves the server whose
conversation is open and calls `runUnpair`, which now **delegates** to `runUnpairServer` rather than
restating its erase→refresh→maybe-flip sequence. See [§ The two renderer callers](#the-two-renderer-callers) below.

## Why this exists

The renderer can never erase a pairing record itself — the paired-server record (bearer `token`,
`server_static_pubkey`) lives only in the background process behind `SecureStore` (CLAUDE.md: "Keep
the transport out of the window"). Recovery from a stale, wrong, or never-connecting pairing needs
*some* trigger the UI can pull, so this channel exposes exactly one capability: "erase the record for
one named server," nothing more granular and nothing that reads a value back.

## What it does

One typed round trip, `window.pyry.unpairServer(serverId)` → `Promise<UnpairResult>`:

- **`{ result: 'ok' }`** — [`clearServer(serverId)`](paired-server-store.md) matched and erased that
  server's record. As of [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) it also
  unconditionally erases that server's [host label](host-label-store.md) — but a failure to erase the
  label never downgrades this to `error`; see below.
- **`{ result: 'error' }`** — deliberately collapses three distinct causes into one value-free outcome:
  a guard refusal (malformed request), an id naming no held record (`matched: false`), and a
  `clearServer` throw. See § Security posture for why a fourth, distinguishing member is not built.

No response field beyond the `result` discriminant — value-free **by construction**: the type has
nowhere to put a token, `server_static_pubkey`, relay URL, keychain path, or error detail, so the
handler cannot leak one even by mistake.

## How it works

| Piece | File | Layer |
|---|---|---|
| `UNPAIR_SERVER_CHANNEL`, `UnpairServerRequest`, `isUnpairServerRequest`, `UnpairResult` | `src/shared/ipc/unpair.ts` | shared contract |
| `registerUnpairServerHandler(target, deps)` + `UnpairServerHandleTarget` | `src/main/unpairHandler.ts` | background handler |
| `window.pyry.unpairServer(serverId)` | `src/preload/index.ts` | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` | composition root |

Deleted by [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163): `UNPAIR_CHANNEL`,
`UnpairResult`'s former sibling union (unchanged — it was always shared), `registerUnpairHandler` +
`UnpairHandleTarget`, `window.pyry.unpair`, and the composition-root's second `handle`/`will-quit` pair.

### 1. The shared contract (`src/shared/ipc/unpair.ts`)

```ts
export const UNPAIR_SERVER_CHANNEL = 'pyry:unpair-server' as const
export const MAX_SERVER_ID_LENGTH = MAX_PASTE_LENGTH   // aliased, not independently chosen — see below

export type UnpairServerRequest = { serverId: string }
export function isUnpairServerRequest(value: unknown): value is UnpairServerRequest

export type UnpairResult = { result: 'ok' } | { result: 'error' }
```

**The guard is this module's only untrusted request field.** `isUnpairServerRequest` mirrors
`pairing.ts`'s `isPairingRequest`: pure, never throws, structural (extra fields tolerated), rejects a
non-object, `null`, a missing or non-string `serverId`, and one over `MAX_SERVER_ID_LENGTH`. The empty
string is **accepted** by the guard — emptiness is refused one step later as "names no held record,"
the same as any other unheld id, so the guard stays purely structural. `MAX_SERVER_ID_LENGTH` is
aliased to `pairing.ts`'s `MAX_PASTE_LENGTH` (not an independent number): every persisted `server` id
arrived inside a pairing paste already bounded by that constant, so this check can never make a held
record *unforgettable* while still refusing an absurd input before it reaches a comparison.

Before #1163 this file also carried the whole-collection `UNPAIR_CHANNEL` constant with no body and no
guard — "the request carries no body, so there is no untrusted request field to validate" was true of
that channel only, and this module's header now says so in the past tense rather than claiming it of
the module as a whole.

### 2. The main-process handler (`src/main/unpairHandler.ts`)

```ts
export interface UnpairServerHandleTarget {
  handle(channel: string, listener: (event: unknown, request: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

export function registerUnpairServerHandler(
  target: UnpairServerHandleTarget,
  deps: {
    store: Pick<MultiPairedServerStore, 'clearServer'>
    onUnpaired?: () => void
    hostLabel?: Pick<MultiHostLabelStore, 'clearFor'>
  }
): () => void
```

**The listener, in order:** guard → `store.clearServer(serverId)` → `matched?` →
`hostLabel?.clearFor(serverId)` → `onUnpaired?.()` → `{ result: 'ok' }`.

- A guard refusal returns `{ result: 'error' }` **before any store call** — a malformed request never
  reaches the store, let alone an erase.
- `clearServer` throwing, and `matched === false` (an id nothing holds), both return
  `{ result: 'error' }` too, indistinguishable from a guard refusal or from each other by design (see
  § Security posture) — nothing is erased on any of the three.
- **On a match, the label erase runs unconditionally**, naming the same `serverId` the record erase
  just used ([#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)). Before #1156 this step
  read `remaining` and cleared the (then single-slot) label only once nothing remained paired — correct
  only while the label was one un-keyed slot. Once the store is keyed by server, `clearFor` erases
  exactly the named server's entry and leaves every other entry untouched by construction, so
  `remaining` decides nothing here any more.
- `onUnpaired` fires unconditionally on the success path, wired at the composition root to
  `registry.reconcile()` — drops exactly the one connection whose record just went and leaves every
  other one live (see [Daemon connection — per-server routing](daemon-connection-routing.md)).
- Every caught object is dropped — never logged, interpolated, or returned; the `serverId` itself never
  reaches a log line, keeping the module log-free by construction.

**No read anywhere in this handler.** `deps.store`'s `Pick<MultiPairedServerStore, 'clearServer'>`
carries no `load`, `loadById`, `list` or `save`, so a `PairedServerRecord` — and therefore a bearer
token or server static key — cannot be materialised in this module at all. This was already *stricter*
than the deleted whole-collection arm's `ClearablePairedServerStore` dep, which inherited `load` and
relied on a test to pin its non-use; since #1163 it is simply the only handler in the module, and that
strictness is what a future `clear`-needing caller would have to widen this dep type to reach.

**What #1163 deleted alongside it:** `UnpairHandleTarget`, `registerUnpairHandler`, and the
`hostLabel?.clear()` call inside its listener — the whole-collection erase of *every* server's label,
which [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) had left standing specifically
for this ticket to remove. `HostLabelStore.clear` itself is not deleted — it now has no production
caller at all, and removing the interface member is deferred (three test object literals pin it; see
[Host label store](host-label-store.md)).

### 3. Preload bridge (`src/preload/index.ts`)

```ts
unpairServer: (serverId: string): Promise<UnpairResult> =>
  ipcRenderer.invoke(UNPAIR_SERVER_CHANNEL, { serverId }),
```

`UNPAIR_SERVER_CHANNEL` is fixed here so the renderer cannot address arbitrary IPC channels; only this
typed function crosses the bridge, never `ipcRenderer` itself. It builds the request object in the
bridge as a convenience, not a defence: the renderer is untrusted regardless, so the main side validates
shape and length on its own merits via `isUnpairServerRequest`. `PyryApi = typeof api` is wholly
inferred from the `api` object literal, so deleting the sibling `unpair` method removed
`window.pyry.unpair` from the renderer's type with no separate `.d.ts` edit.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterUnpairServer = registerUnpairServerHandler(ipcMain, {
  store: pairedServerStore,
  onUnpaired: () => registry.reconcile(),
  hostLabel: hostLabelStore
})
app.on('will-quit', () => unregisterUnpairServer())
```

The same `pairedServerStore` and `hostLabelStore` instances built once at the composition root — no
second store constructed. [#1117](daemon-connection-routing.md#the-connection-registry-1117) targets
`onUnpaired` at `registry.reconcile()`, which re-reads the store and drops exactly the one connection
whose record went, leaving every other one live and un-handshaken. Registering late (below
`createDaemonConnection`, beside the pairing handler) is safe for the reason the pairing handler's own
comment gives: the whole `whenReady` callback runs to completion in one tick and no caller races it —
the visible unpair controls are renderer UI, many ticks later, after first paint. `will-quit` removes
the handler.

Deleted alongside it: the second `registerUnpairHandler(ipcMain, { store: pairedServerStore, onUnpaired,
hostLabel: hostLabelStore })` registration and its own `will-quit` line. The host-label seam comment
above both registrations, which used to enumerate "four seams, four disjoint `Pick`s" over
`hostLabelStore`, now says three: `pairingHandler`'s `saveFor`, this handler's `clearFor`, and
`hostLabelHandler`'s `load`.

## The two renderer callers

Both callers share one rule — forgetting a server flips the route to the pairing screen only when the
*refreshed* collection comes back empty — implemented once, in `runUnpairServer`, because that helper
is the only one holding the post-erase list.

**Settings screen's per-row Unpair** ([#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162),
`src/renderer/src/screens/settings/unpairServerAction.ts`) calls `runUnpairServer` directly, with no
`dispatch` dependency at all — `UnpairServerDeps` structurally cannot reach the session store, so one
server's failed erase can never degrade the whole app into a `failed` session status while another
server's conversation is fine. See [Settings screen § `runUnpairServer`](settings-screen-how-it-works.md#rununpairserver-unpairserveractionts-1162).

**The composer's Re-pair control** ([#166](../codebase/166.md), migrated by
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163),
`src/renderer/src/screens/conversation/unpairAction.ts`) appears only inside `ComposerErrorSlot`, in an
already-terminal connection error. `ConversationScreen`'s `ComposerErrorSlotControl.handleRepair`
resolves the server to forget at interaction time, via `getState()` reads (the
`conversationLastReadDeps` idiom, not a subscription):

```ts
export function serverIdForOpenConversation(
  rows: readonly ServerConversationSummary[] | null,
  openConversationId: string | null
): string | null

export interface UnpairDeps extends UnpairServerDeps {
  dispatch: (action: SessionAction) => void
}

export function runUnpair(deps: UnpairDeps, serverId: string | null): Promise<'ok' | 'error'>
```

- **`serverIdForOpenConversation`** looks up `conversationListStore`'s stamped rows — never
  `sessionStore`'s flat `status`, which is documented as the *most recently written* status across every
  connection and can therefore be describing the other machine on a two-server setup. It **refuses an
  ambiguous match** (`filter` + a length-1 check, never `find`): the conversation id is the *daemon's*,
  and the store holds every server's rows in one flat list, so two servers reporting the same
  conversation id is a condition the app does not otherwise prevent. A `find` would resolve to whichever
  row was stamped first, letting a confused or hostile daemon steer a Re-pair pressed on server A into
  forgetting server B. The row's `serverId` stamp is client-bound (`bindServerOrigin`, main-side, never a
  wire field), so the worst a daemon can do is make the match ambiguous, which this now turns into a
  no-op rather than a wrong erase.
- **`runUnpair` short-circuits on `serverId === null`** — dispatching the synthesized `failed` error
  **without calling `unpairServer` at all**, so an unresolvable server can never erase an arbitrary
  record. Otherwise it delegates to `runUnpairServer(deps, serverId)` and dispatches on `'error'`; the
  `'ok'` branch's route-flip-if-nothing-remains logic is entirely `runUnpairServer`'s, not restated here.
- Unlike the Settings row, this control has **no two-phase confirm and no busy guard** — it appears only
  after a connection has already failed, and it self-hides on both outcomes (an `ok` unmounts the
  screen or clears the error slot's error status; an `error` stays put with the plain error chip, since
  `shouldOfferRepair` excludes `code: 'unpair'`).

Before #1163, `runUnpair` called a nullary `window.pyry.unpair()` that erased the whole collection and
flipped the route unconditionally on `ok` — correct only while there was ever one paired server. Since
[#1069](https://github.com/pyrycode/pyrycode-desktop/issues/1069) the store holds several and since
[#1117](https://github.com/pyrycode/pyrycode-desktop/issues/1117) a live connection sits behind each, so
that unconditional flip would have forgotten server B and dropped its connection while recovering
server A's dead one — the exact failure this migration exists to close.

## Data flow

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

renderer side, both callers:
  runUnpairServer(deps, serverId):
    unpairServer(serverId) → 'error' or rejected  ⇒ 'error', nothing else runs
    'ok' ⇒ await refreshServers()  [same serverInfo re-read the Settings mount uses]
           refreshed list empty ⇒ onLastServerUnpaired() → applyPairingChange(deps,'unpaired')
                                    → clearPairingScopedState (thirteen stores) + route → 'pairing'
           refreshed list non-empty ⇒ nothing further; shell stays up
```

## Security posture

**Verdict: PASS**, on introduction (#173/#172), again on the per-server channel's introduction
([#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)), and again on the whole-collection
deletion ([#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163), builder self-review).

- **The renderer can parameterize *which* record is erased, and only that.** `serverId` is the one
  field that leaves the renderer, validated at `isUnpairServerRequest`, the listener's first statement,
  applied before any store call. The capability is strictly narrower than the deleted whole-collection
  channel's "erase every record" — this is a **reduction** in blast radius, not a new class of power,
  and since #1163 it is the *only* erase capability the app registers at all. `serverId` is matched with
  `===` against each decoded record's own `server` field inside `clearServer`, never becomes a
  persistence name, path, or object key, and is never logged — an id like `__proto__` is inert.
- **Value-free reply by construction.** No response member beyond the discriminant, so the handler
  cannot serialize a token/key/relay/keychain-path back even under a bug — pinned by a test asserting
  the `ok` response stringifies to exactly `{"result":"ok"}`. A guard refusal, an unknown id, and a
  failed erase are all `{ result: 'error' }`, deliberately indistinguishable: a fourth-member response
  would tell a compromised renderer whether a guessed id is paired, and it can already learn that from
  `serverInfo`, so the smaller, value-free union stands.
- **No credential can be materialised in this handler at all.** `store` is
  `Pick<MultiPairedServerStore, 'clearServer'>`: no `load`, `loadById`, `list`, or `save`, so a
  `PairedServerRecord` (bearer `token`, `server_static_pubkey`) cannot exist in this module's memory on
  any code path.
- **A confused or hostile daemon cannot steer a Re-pair onto the wrong server.** The composer resolves
  the server to erase by matching the *daemon-supplied* open-conversation id against a flat, multi-server
  row list. `serverIdForOpenConversation` refuses an ambiguous match rather than resolving it via `find`
  (§ The two renderer callers) — this was flagged and closed at plan time, before #1163 shipped. Note
  what is *not* attacker-controlled: the id ultimately compared is the row's client-bound `serverId`
  stamp, never a wire field, so the worst a daemon can achieve is making the lookup ambiguous, which now
  erases nothing.
- **Destructive but recoverable, and device-identity-preserving.** `clearServer` deletes only the
  matching entry inside `PAIRED_SERVER_NAME`; the device static keypair
  (`pyrycode.device_static`) lives under a distinct name in a distinct store and is structurally
  untouched.
- **The label erase cannot reach a credential** ([#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)/[#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156)).
  `clearFor(serverId)` only ever compares `serverId` with `===` against a decoded entry's own field and
  never turns it into a name, path, or object key. The handle withholds every read member
  (`Pick<MultiHostLabelStore, 'clearFor'>`), so the label value is never materialised in this module.
- **The deletion is a net reduction, not a redistribution.** Removing `registerUnpairHandler` removed
  the one handler whose store dep (`ClearablePairedServerStore`) *inherited* `load` and could therefore
  materialise a full `PairedServerRecord`, with only a test pinning its non-use. Nothing replaces that
  capability; the surviving handler structurally cannot reach it.

## Edge cases and limitations

- **The composer control's confirmation gate is "it only appears in an already-terminal error," not a
  confirm step.** Unlike the Settings row's two-phase idle/confirming/unpairing state, `ComposerErrorSlotControl`
  has no busy guard and no confirm prompt — it renders only when the connection has already failed, and
  it self-hides on either outcome.
- **Renderer-side state clear lives in the caller, not this channel, and moved once.** [#166](../codebase/166.md)
  originally had `runUnpair` reset `sessionStore` directly on the `ok` branch; [#531](../codebase/531.md)
  moved that reset (plus twelve more clears this channel has no visibility into) to the shared
  `clearPairingScopedState` wrapper run through `applyPairingChange`. This channel's own contract (erase
  the named record, report `ok`/`error`) is unaffected by any of it.
- **Live-session teardown, closed by [#504](../codebase/504.md).** A successful erase fires an optional
  `onUnpaired?: () => void` dep, wired at the composition root to `registry.reconcile()` since
  [#1117](daemon-connection-routing.md#the-connection-registry-1117) — drops exactly the connection whose
  record went. The callback sits outside the fail-closed `catch` and swallows its own throw, so a
  teardown failure can never downgrade an already-completed erase to `{ result: 'error' }`.
- **No error sub-reason.** The `error` arm deliberately carries no detail beyond the discriminant. Both
  callers synthesize their own generic error on that arm rather than threading a sub-reason through.
- **A failed label erase is invisible, by design ([#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)).**
  No diagnostic counter, no retry-at-next-launch. The module stays log-free by construction, no such
  failure has been observed, and the recovery path already exists (the next pairing that carries a label
  overwrites the stale one; the next unpair retries the erase).
- **A corrupt collection now has exactly one recovery path, not two.** `clearServer` must read to filter
  and to compute `matched`, so a `MalformedPairedServerRecordError` makes the per-server erase report
  `error` with nothing erased. Before [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163),
  the whole-collection `clear()` never read at all and so still succeeded over a corrupt blob, making it
  a second recovery path; that path is deleted along with the handler that used it. The one remaining
  path is re-pairing — `save` overwrites a malformed collection outright — which is also reachable
  without any unpair at all, since a collection `pairedServerStore` cannot parse makes `pairingStatus`
  answer *not paired* and routes straight to the pairing screen.
- **The two erases (record, then label) are not atomic** — independent `SecureStore` names, not a
  transaction. A crash between them leaves *no record + orphan label*, the argued-benign, self-healing
  interleaving (the next pairing that carries a label overwrites it; the next unpair erases it).
- **The renderer's [host-label window store](host-label-window-store.md) is not reset here.**
  `clearPairingScopedState` resets the timeline, session, active conversation, and last-read state on the
  last-server unpair, but not #833's renderer store — so an unpair-then-repair *inside one running app
  session* can leave the window holding the previous label until the next `hostLabel()` load overwrites
  it.
- **After a Re-pair that leaves other servers paired, the unpaired server's rows stay in the sidebar
  until something clears them** — named and left open by
  [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)'s architecture spec, the same gap
  [#1150](https://github.com/pyrycode/pyrycode-desktop/issues/1150) is scoped to close for the Settings
  path. No credential and no live connection survive (`reconcile()` already dropped it) — this is a
  stale-display gap only.

## Related

- [#504 codebase notes](../codebase/504.md) — the `onUnpaired` teardown trigger, the registration move
  below `connection`, and why the callback deliberately deviates from `onPaired`'s inside-the-try
  placement.
- [Daemon connection — per-server routing](daemon-connection-routing.md#the-connection-registry-1117) —
  `registry.reconcile()`, which lets this channel drop exactly one connection instead of every
  connection.
- [Paired-server store](paired-server-store.md) / [#172 codebase notes](../codebase/172.md) —
  `clearServer`'s `ClearServerOutcome`, the capability this channel calls.
- [Host-label store](host-label-store.md) — `clearFor`, the second erase this channel calls on a match;
  also records that the whole-collection `clear()` this channel used to call has no production caller
  left after #1163, and why the interface member itself is not yet removed.
- [Settings screen § `runUnpairServer`](settings-screen-how-it-works.md#rununpairserver-unpairserveractionts-1162) —
  the shared helper both renderer callers use, and the one place the remaining-count route-flip rule
  lives.
- [Paired shell — routing](paired-shell-routing.md) — `applyPairingChange`'s `unpaired` arm, now reached
  identically by both callers.
- [Pairing-status signal](pairing-status-signal.md) / [#79 codebase notes](../codebase/79.md) — the
  literal source pattern this channel originally cloned field-for-field.
- [Diagnostics channel](diagnostics-channel.md) / [#131 codebase notes](../codebase/131.md) — the other
  "ship an IPC boundary ahead of its consumer" precedent.
- [Pairing IPC channel](pairing-ipc-channel.md) — the stateful request/response sibling this contrasts
  with (that channel holds a pending confirm-and-server-id pair and validates a pasted request body;
  this one holds nothing beyond one id).
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model this
  channel's value-free contract enforces (token/keys never reach the renderer).
- [#173](../codebase/173.md) / [#166](../codebase/166.md) / [#531](../codebase/531.md) — the
  whole-collection channel's introduction, first caller, and the session-reset move upstream; kept as
  history since the code they describe is deleted.
- [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) — introduced this channel as the
  Strangler Fig sibling. [#1156](https://github.com/pyrycode/pyrycode-desktop/issues/1156) re-pointed
  the label erase at `clearFor` and deleted its remaining-count gate. [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)
  gave it its first caller. [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) migrated
  the last whole-collection caller onto it and deleted that path.
