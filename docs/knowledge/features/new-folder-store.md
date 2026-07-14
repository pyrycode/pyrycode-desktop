# Create-folder round-trip store

The renderer's single source of truth for an in-flight `create_workspace_folder` request — a
dedicated Zustand store holding the round-trip status (`idle` / `in-flight` / `created` / `rejected`)
plus a headless bridge that folds the two typed daemon replies into it, so the not-yet-built
Create-folder dialog ([#398](https://github.com/pyrycode/pyrycode-desktop/issues/398)) can watch a
request resolve without polling.

Introduced in [#397](../codebase/397.md), split-child B of [#384](../codebase/384.md) (Create-folder
dialog). Depends on the transport split-children that shipped first: [#381](../codebase/381.md) (send
`create_workspace_folder`, decode success `workspaceFolderCreated{path}`) and
[#396](../codebase/396.md) (correlate the bare rejection into `workspaceFolderRejected`). Ships
**dormant** — purely additive, zero edits to existing files, nothing mounts the bridge or dispatches a
request until #398 wires the dialog.

## What it does

Holds the create-folder round-trip as one discriminated union, nested under a `roundTrip` field:

```ts
export type NewFolderRoundTrip =
  | { status: 'idle' }
  | { status: 'in-flight' }
  | { status: 'created'; path: string }
  | { status: 'rejected' }
```

Four sealed store events drive it — two dialog-driven, two bridge-driven:

```ts
export type NewFolderEvent =
  | { type: 'createRequested' }              // dialog: mark a request outstanding
  | { type: 'folderCreated'; path: string }   // bridge: workspaceFolderCreated → capture path
  | { type: 'folderRejected' }                // bridge: workspaceFolderRejected → bare
  | { type: 'reset' }                          // dialog: clear after an outcome or on close
```

The **in-flight gate** is the load-bearing behavior: `folderCreated`/`folderRejected` transitions the
store only while `status === 'in-flight'`. Arriving in `idle` (nothing outstanding) or an
already-resolved status (`created`/`rejected`) is ignored — the reducer returns the same state object,
so zustand's functional `set` sees `Object.is(next, prev)` and skips the notify. Because
`workspaceFolderRejected` is bare (no correlation key, [#396](../codebase/396.md)), this gate is the
**sole** guard against a stale or unsolicited reply flipping state — the renderer-side companion to
#396's main-side `pendingCreateFolders` correlation.

## How it works

### The store (`src/renderer/src/store/newFolderStore.ts`)

```ts
initialNewFolderState               // { roundTrip: { status: 'idle' } }
reduceNewFolder(state, event)       // the pure reducer — four arms, two gated
createNewFolderStore(init?)         // vanilla createStore — one isolated instance per test (DI seam)
newFolderStore                      // app-wide singleton
useNewFolderStore(selector)         // narrow-slice React binding
selectNewFolderRoundTrip(state)     // the sole read surface
```

The closest analog is
[`runSettingsWriteStore`](run-settings-write-store.md)'s reducer + factory → singleton → hook →
selector shape, simplified: `runSettingsWriteStore` keys a `Map<changeId, …>` because several config
writes can be outstanding at once, but a create-folder round-trip has no correlation key to key
by — there is only ever one dialog open — so this store holds a single value, not a map.

The union lives **nested under `roundTrip`**, not intersected flat onto the store (the `modalStore` /
`serverInfoStore` idiom). Nesting is load-bearing: only `created` carries `path`, and zustand's `set`
shallow-merges by default — a flat `State & { dispatch }` shape would leak a stale `path` key across a
`created → idle` reset, since a shallow merge only overwrites keys present in the patch. Nesting the
union under one field means every transition swaps that whole field's object wholesale, so no key
survives.

`path` is held **verbatim as opaque display text** — never coerced, never resolved into a local
filesystem operation. It is a remote daemon-side path (the inherited warning at
`workspaceFolderCreated` in `src/shared/ipc/events.ts`, the `RecentWorkspace`/`cwd` posture carried
forward from [#380](../codebase/380.md)/[#382](recent-workspaces-store.md)). This store has no DOM
sink; the constraint is inherited by #398, which must render it as plain text, never HTML.

### The bridge (`src/renderer/src/store/newFolderBridge.ts`)

```ts
translateNewFolderEvent(event: DaemonEvent): NewFolderEvent | null
// switch (event.type) {
//   case 'workspaceFolderCreated': return { type: 'folderCreated', path: event.path }
//   case 'workspaceFolderRejected': return { type: 'folderRejected' }
//   default: return null
// }

subscribeNewFolder(onDaemonEvent, dispatch): () => void
// each event → translateNewFolderEvent; a non-null result is dispatched UNCONDITIONALLY —
// the store's reducer, not the bridge, applies the in-flight gate. Returns the off-handle.

NewFolderData(): null
// headless leaf, dormant — no consumer mounts it in #397
```

Clones the [`recentWorkspacesBridge`](recent-workspaces-store.md) / `runSettingsWriteBridge` dedicated-
bridge idiom, but **inbound-only** — unlike `recentWorkspacesBridge` there is no request/outbound half
here at all. The outbound `createWorkspaceFolder` command (already shipped, #381) belongs to #398,
which sends it after dispatching `createRequested` (record-before-send, so the store is in-flight
before a reply can race back).

`translateNewFolderEvent` uses the same **soft** `default: null` as `translateRecentWorkspacesEvent` /
`translateWriteEvent` — this path permanently consumes only its two owned arms, everything else no-ops.
`NewFolderData` dereferences `window.pyry` only inside its effect, never during render, so it
server-renders to empty markup without a bridge mock (the `RecentWorkspacesData` invariant), and
returns the `subscribeNewFolder` off-handle as its cleanup so a StrictMode double-mount nets exactly
one live listener.

### Data flow (once #398 wires the dialog)

```
Create-folder dialog opens, mounts <NewFolderData /> (dialog-scoped, #398)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeNewFolder (live immediately)

dialog dispatches { type: 'createRequested' } → in-flight
  → sendCommand({ type: 'createWorkspaceFolder', payload })   [#381, already shipped]

daemon accepts → workspace_folder_created{path} → workspaceFolderCreated DaemonEvent [#381]
  → subscribeNewFolder → translateNewFolderEvent → { type: 'folderCreated', path }
    → newFolderStore.dispatch → in-flight → created{path}   (gate honored)
  → dialog reads selectNewFolderRoundTrip → switches conversation to path, closes

daemon rejects → correlated daemon-error → workspaceFolderRejected DaemonEvent [#396]
  → subscribeNewFolder → translateNewFolderEvent → { type: 'folderRejected' }
    → newFolderStore.dispatch → in-flight → rejected   (gate honored)
  → dialog stays open for correction; dispatches { type: 'reset' } on close/outcome
```

## Configuration and usage

- **Import surface:** `import { useNewFolderStore, selectNewFolderRoundTrip } from
  '@renderer/store/newFolderStore'` and `import { NewFolderData } from
  '@renderer/store/newFolderBridge'`.
- **Mount lifecycle — dialog-scoped, decided.** `NewFolderData` is meant to be mounted **by the #398
  dialog**, not app-level in `App.tsx` — the `RecentWorkspacesData`-is-picker-scoped posture, not
  `RunSettingsWriteData`'s app-level one. The dialog is the sole consumer and stays mounted for the
  whole round-trip; an app-level always-on subscription was considered and rejected as buying nothing
  (the in-flight gate already makes any late/stray reply a harmless no-op, and a reset-on-close leaves
  the store idle between dialog openings). #397 ships the binding dormant and does not touch
  `App.tsx`.
- **`daemonEventBridge.ts`'s pre-existing `workspaceFolderCreated`/`workspaceFolderRejected` no-ops are
  untouched** — that bridge is the *session-store* translator and its no-ops for these two arms are
  correct and stay in place (the [#382](recent-workspaces-store.md) precedent: leave the session
  bridge's no-op, add a dedicated store + bridge instead).

## Edge cases and limitations

- **No async, no cancellation, no timer inside this slice.** The store is synchronous fold-state; the
  bridge is a single event listener with an off-handle cleanup. Whether a request times out is #398's
  UX concern, not this store's.
- **A stale or unsolicited reply is a harmless no-op**, by construction of the in-flight gate — see
  above. This is deliberately the *only* defense on the renderer side; the security-sensitive
  correlation of the untrusted rejection frame already shipped main-side in #396.
- **Retry after rejection re-arms cleanly.** `createRequested` transitions from *any* status, including
  `rejected`, back to `in-flight` — a dialog correction-and-resubmit flow needs no explicit
  reset-then-request dance.

## Related

- [#397 codebase notes](../codebase/397.md) — implementation summary, patterns established, lessons
  learned.
- [#381 codebase notes](../codebase/381.md) — the `create_workspace_folder` send + `workspaceFolderCreated`
  success decode this store consumes.
- [#396 codebase notes](../codebase/396.md) — the `workspaceFolderRejected` correlation this store
  consumes; its main-side `pendingCreateFolders` gate is the transport-level twin of this store's
  in-flight gate.
- [Daemon-event channel](daemon-event-channel.md) — the two `DaemonEvent` arms this bridge filters for.
- [Run configuration write store](run-settings-write-store.md) — the closest structural analog (reducer
  + factory → singleton → hook → selector, fail-closed gate honored only against a pending record),
  simplified here from a `Map` to a single value since there is no correlation key.
- [Recent-workspaces store](recent-workspaces-store.md) — the "pure renderer state, held verbatim,
  dedicated bridge, dormant until a consumer mounts it" posture this store mirrors.
- [#384 — Create-folder dialog split](../codebase/384.md) — parent ticket; this is split-child B
  (round-trip store), between #396 (rejection transport) and #398 (dialog UI, Figma 19-44), the
  remaining consumer.
