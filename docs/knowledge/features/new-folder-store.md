# Create-folder round-trip store

The renderer's single source of truth for an in-flight `create_workspace_folder` request — a
dedicated Zustand store holding the round-trip status (`idle` / `in-flight` / `created` / `rejected`)
plus a headless bridge that folds the two typed daemon replies into it, so the
[Create-folder dialog](../codebase/398.md) can watch a request resolve without polling.

Introduced in [#397](../codebase/397.md), split-child B of #384 (Create-folder dialog). Depends on the
transport split-children that shipped first: [#381](../codebase/381.md) (send
`create_workspace_folder`, decode success `workspaceFolderCreated{path}`) and
[#396](../codebase/396.md) (correlate the bare rejection into `workspaceFolderRejected`). Shipped
**dormant** in #397 — purely additive, zero edits to existing files — until
[#398](../codebase/398.md) mounted the bridge dialog-scoped and became its first real consumer.

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
sink; [#398](../codebase/398.md) inherited the constraint and renders it as a plain, auto-escaped
React child, never HTML.

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
// headless leaf; mounted dialog-scoped by CreateFolderDialog (#398)
```

Clones the [`recentWorkspacesBridge`](recent-workspaces-store.md) / `runSettingsWriteBridge` dedicated-
bridge idiom, but **inbound-only** — unlike `recentWorkspacesBridge` there is no request/outbound half
here at all. The outbound `createWorkspaceFolder` command (already shipped, #381) is sent by
[#398](../codebase/398.md)'s `CreateFolderDialog`, after dispatching `createRequested`
(record-before-send, so the store is in-flight before a reply can race back).

`translateNewFolderEvent` uses the same **soft** `default: null` as `translateRecentWorkspacesEvent` /
`translateWriteEvent` — this path permanently consumes only its two owned arms, everything else no-ops.
`NewFolderData` dereferences `window.pyry` only inside its effect, never during render, so it
server-renders to empty markup without a bridge mock (the `RecentWorkspacesData` invariant), and
returns the `subscribeNewFolder` off-handle as its cleanup so a StrictMode double-mount nets exactly
one live listener.

### Data flow

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
- **Mount lifecycle — dialog-scoped.** `NewFolderData` is mounted by
  [`CreateFolderDialog`](../codebase/398.md), not app-level in `App.tsx` — the
  `RecentWorkspacesData`-is-picker-scoped posture, not `RunSettingsWriteData`'s app-level one. The
  dialog is the sole consumer and stays mounted for the whole round-trip; an app-level always-on
  subscription was considered and rejected as buying nothing (the in-flight gate already makes any
  late/stray reply a harmless no-op, and a reset-on-unmount leaves the store idle between dialog
  openings). `App.tsx` is untouched.
- **`daemonEventBridge.ts`'s pre-existing `workspaceFolderCreated`/`workspaceFolderRejected` no-ops are
  untouched** — that bridge is the *session-store* translator and its no-ops for these two arms are
  correct and stay in place (the [#382](recent-workspaces-store.md) precedent: leave the session
  bridge's no-op, add a dedicated store + bridge instead).

## Edge cases and limitations

- **No async, no cancellation, no timer inside this slice.** The store is synchronous fold-state; the
  bridge is a single event listener with an off-handle cleanup. A request never times out on its own —
  [#398](../codebase/398.md)'s dialog leaves an abandoned in-flight request to resolve or not; closing
  the dialog unmounts the bridge and resets the store regardless of whether a reply ever arrives.
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
- [#398 codebase notes](../codebase/398.md) — the Create-folder dialog UI, split-child C of #384, and
  this store's first real consumer: mounts `NewFolderData` dialog-scoped, dispatches `createRequested`/
  `reset`, and reads `selectNewFolderRoundTrip` to drive the dialog's in-flight/error states.
- [#288 codebase notes](../codebase/288.md) / [Save-as-channel dialog](save-as-channel-dialog.md) —
  this store's second real consumer, confirming the "each consumer mounts the bridge dialog-scoped
  and resets to idle on unmount" posture generalizes: the picker (#398) and the Channel List (#288)
  can't be open at once, so the shared app-singleton never carries stale state between them.
