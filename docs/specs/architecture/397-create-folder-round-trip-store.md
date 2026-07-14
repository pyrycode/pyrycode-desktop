# #397 — Create-workspace-folder round-trip store

**Size:** S · **Security-sensitive:** No · **UI:** No (headless store + bridge) · Split-child B of #384 (blocked-by #396, merged; blocks #398).

## Files to read first

- `src/renderer/src/store/runSettingsWriteStore.ts:21-154` — the **closest analog**: a reducer + factory → singleton → hook → selector store with a *fail-closed gate* (confirm/reject honored only against a pending record). Clone its structure; **simplify** the `Map<changeId,…>` down to a single discriminated-union value (there is only one round-trip at a time — no correlation key).
- `src/renderer/src/store/modalStore.ts:18-45` — the union-state-nested-under-a-field store-wrapper idiom (`ModalState & { dispatch }`, `dispatch: (e) => set((s) => reduce(s, e))`). Confirms the merge-safe nesting this spec requires.
- `src/renderer/src/store/recentWorkspacesStore.ts:18-64` — the "pure renderer state, held verbatim, never coerced/validated, one write path, read-only selector" posture (#382) that AC5 and the Technical Notes point at. #397 mirrors this posture.
- `src/renderer/src/store/runSettingsWriteBridge.ts:33-58` — `translateWriteEvent` + `subscribeRunSettingsWrite`: the two-owned-arms → store-event translate plus the *unconditional-forward* subscribe (the store, not the bridge, gates). The inbound half of #397's bridge clones this shape.
- `src/renderer/src/store/recentWorkspacesBridge.ts:24-99` — the dedicated-bridge idiom (`translate` + `subscribe` + a headless `…Data` component shipped **dormant**). Clone the file layout. **Note:** #397's bridge is inbound-**only** — it has *no* request/outbound half (contrast `requestRecentWorkspaces`).
- `src/shared/ipc/events.ts:229-257` — the two owned `DaemonEvent` arms this slice consumes: `workspaceFolderCreated` (bare `path: string`, #381) and `workspaceFolderRejected` (bare, no payload, #396). **Read the inherited path-opacity warning at 237-243** — it carries forward into this store.
- `src/renderer/src/store/daemonEventBridge.ts:88-97` — the two `null` no-op cases for these arms. They are **correct and stay** — this slice does **not** touch this file (see § Non-goals).
- `src/renderer/src/store/recentWorkspacesBridge.test.ts` — the bridge-test idiom: `fakeBridge()` listener-capture spy, `translate`/`subscribe`/server-render cases, and one real-store integration seam. Clone the shape.
- `src/renderer/src/store/runSettingsWriteStore.test.ts` — the reducer-transition test idiom (per-arm, plus the fail-closed no-op cases). Clone for the store tests.
- `src/renderer/src/App.tsx:7-12` — where app-level headless `…Data` bindings mount. #397 does **not** add here; the mount is dialog-scoped (§ Mount lifecycle) and belongs to #398.

## Context

`create_workspace_folder`'s two typed daemon replies — success `workspaceFolderCreated { path }` (#381) and the bare rejection `workspaceFolderRejected` (#396, merged) — reach the renderer but have no consumer: every exhaustive bridge (session / timeline / modal) no-ops them. The Create-folder dialog (#398) needs one observable source of truth for the round-trip: dispatch a create request, then watch it resolve to **created** (carrying the new folder's `path`, so the dialog can switch the conversation to it) or **rejected** (so the dialog stays open for correction).

This slice adds that source of truth — a dedicated renderer store holding the round-trip status as a discriminated union, plus a dedicated inbound bridge feeding the two daemon events into it. It is **pure renderer state**: no IPC, no transport, no keys/sockets/bytes; it consumes already-typed events (the #382 posture). It ships **dormant** — nothing mounts the bridge or dispatches a request until #398 wires the dialog.

## Design

Two new production files, both under `src/renderer/src/store/`. **Purely additive — zero edits to existing files.**

### `newFolderStore.ts` — the round-trip state machine

The round-trip status is a discriminated union on `status` (AC1), **nested under a store field** (not intersected flat onto the store). Nesting is load-bearing: `created` carries `path` and the other members do not, so a flat `State & { dispatch }` under zustand's shallow-merge `set` would leak a stale `path` across a `created → idle` reset. Nesting swaps the whole union object wholesale, so no key survives a transition — the `modalStore` / `serverInfoStore` idiom.

Contract sketch (types only — the developer writes the bodies):

```ts
// The round-trip status — discriminated union on `status` (AC1). `created` carries the daemon's
// path; every other member is bare. `rejected` carries nothing (workspaceFolderRejected is bare, #396).
export type NewFolderRoundTrip =
  | { status: 'idle' }
  | { status: 'in-flight' }
  | { status: 'created'; path: string }
  | { status: 'rejected' }

// The store's sealed event set on `type`: two dialog-driven actions (createRequested / reset) and
// two bridge-driven daemon-reply events (folderCreated / folderRejected).
export type NewFolderEvent =
  | { type: 'createRequested' }          // dialog: mark a create request outstanding
  | { type: 'folderCreated'; path: string } // bridge: workspaceFolderCreated → capture path
  | { type: 'folderRejected' }           // bridge: workspaceFolderRejected → bare
  | { type: 'reset' }                    // dialog: clear after an outcome or on close (AC4)

export interface NewFolderState { roundTrip: NewFolderRoundTrip }
export type NewFolderStore = NewFolderState & { dispatch: (event: NewFolderEvent) => void }
```

Exposed surface, mirroring `runSettingsWriteStore` / `recentWorkspacesStore`:

- `initialNewFolderState: NewFolderState` = `{ roundTrip: { status: 'idle' } }`.
- `reduceNewFolder(state: NewFolderState, event: NewFolderEvent): NewFolderState` — the pure reducer (below), with an `assertNever(event)` default (a new arm is a compile error).
- `createNewFolderStore(init = initialNewFolderState)` — DI factory, `dispatch: (e) => set((s) => reduceNewFolder(s, e))`. One isolated instance per test.
- `newFolderStore` — the app-wide singleton.
- `useNewFolderStore<T>(selector)` — narrow-slice React binding.
- `selectNewFolderRoundTrip(s: NewFolderState): NewFolderRoundTrip` = `s.roundTrip` — the sole read surface (AC5).

**Reducer transitions** (this is the whole behavior — four arms, two gated):

| Event | Precondition | Result |
|-------|--------------|--------|
| `createRequested` | any status | `{ roundTrip: { status: 'in-flight' } }` — ungated (dialog-driven) |
| `folderCreated` | `status === 'in-flight'` | `{ roundTrip: { status: 'created', path: event.path } }` |
| `folderCreated` | any other status | **return `state` unchanged** — ignored (AC3) |
| `folderRejected` | `status === 'in-flight'` | `{ roundTrip: { status: 'rejected' } }` |
| `folderRejected` | any other status | **return `state` unchanged** — ignored (AC3) |
| `reset` | any status | `{ roundTrip: { status: 'idle' } }` — ungated (dialog-driven, AC4) |

The **in-flight gate (AC3)** lives here, in the reducer — not in the bridge. A `folderCreated`/`folderRejected` arriving in `idle` (nothing outstanding) or in an already-resolved status (`created`/`rejected`) returns the **same `state` object reference**, so zustand's functional `set` sees `Object.is(next, prev)` and skips the notify → no spurious re-render (the `runSettingsWriteStore` no-match precedent). Because `workspaceFolderRejected` is bare — no correlation key — this in-flight gate is the **sole** guard against a stale or unsolicited reply flipping state (the security-sensitive correlation of the untrusted rejection frame already shipped in #396; this is the renderer-side companion guard).

`path` is held **verbatim as opaque display text** — never coerced, never resolved into a local filesystem operation (it is a remote daemon-side path). The inherited warning at `events.ts:237-243` carries forward: #398 must render it as plain text, never HTML, and never `fs`-resolve it. This store has no DOM sink; the constraint is inherited for #398.

### `newFolderBridge.ts` — the dedicated inbound bridge

Clones `recentWorkspacesBridge` / `runSettingsWriteBridge` (inbound half). Three React-free, injected helpers plus one headless component. **Inbound-only** — no request/outbound half, no `sendCommand` (the outbound `createWorkspaceFolder` command belongs to #398; see § Downstream boundary).

- `translateNewFolderEvent(event: DaemonEvent): NewFolderEvent | null` — a switch mapping the two owned arms to fresh store events, everything else to `null` (a *permanent* filter → `default: null`, not `assertNever`, mirroring `translateWriteEvent`):

```ts
switch (event.type) {
  case 'workspaceFolderCreated': return { type: 'folderCreated', path: event.path }
  case 'workspaceFolderRejected': return { type: 'folderRejected' }
  default: return null
}
```

- `subscribeNewFolder(onDaemonEvent, dispatch): () => void` — subscribe via the injected `onDaemonEvent`; each event runs through `translateNewFolderEvent` and a **non-null result is dispatched unconditionally** (the store's reducer, not the bridge, applies the in-flight gate — Technical Notes are explicit on this). Returns the `off` handle for effect cleanup. The listener only dispatches — it never throws into React.
- `NewFolderData(): null` — the headless subscribe-only binding, shipped **dormant** (no consumer mounts it in this slice; #398's dialog mounts it — § Mount lifecycle). Dereferences `window.pyry` only inside the effect, never during render, so it server-renders to empty markup without a bridge mock (the `RecentWorkspacesData` invariant). Returns the `subscribeNewFolder` off-handle as its `useEffect` cleanup, so a StrictMode double-mount nets exactly one live listener.

## State + concurrency model

- **Single store slice.** One dedicated store, orthogonal to session / timeline / modal / recentWorkspaces (a create-folder round-trip touches none of them). A round-trip transition re-renders only components selecting `roundTrip`.
- **Unidirectional (AC5).** One write path — `dispatch`. Two dispatch sources: the dialog (`createRequested`, `reset`) and the bridge (`folderCreated`, `folderRejected`). One read path — `selectNewFolderRoundTrip`. No setter, no two-way binding.
- **No async, no cancellation inside this slice.** The store is synchronous fold-state; the bridge is a single event listener with an `off`-handle cleanup. There is no timer, no `AbortController`, no promise. (Whether a request times out is #398's UX concern, not this store's.)

### Mount lifecycle — dialog-scoped (decided)

`NewFolderData` is mounted **by the #398 dialog** (dialog-scoped, on-demand), **not** app-level in `App.tsx` — the `RecentWorkspacesData`-is-picker-scoped posture, not the `RunSettingsWriteData`-is-app-level one. Rationale: the dialog is the sole consumer and stays mounted for the entire round-trip (surfacing creating → created/rejected *is* its purpose). App-level always-on subscription was **considered and rejected**: it would keep a live listener for a surface only relevant while the dialog is open, buying nothing — the in-flight gate already makes any late/stray reply a harmless no-op, and AC4's reset-on-close leaves the store `idle` between openings. #397 therefore ships the binding dormant and does not edit `App.tsx`.

## Error handling

No new failure modes are introduced here (no network, socket, parse, or permission surface — this slice is downstream of already-validated typed events). The one adversarial case is a **stale or unsolicited reply**: a `folderCreated`/`folderRejected` arriving with no request outstanding, or after one already resolved. Handled deterministically by the in-flight gate (AC3) — the reducer returns the same state, the event is dropped, no re-render. The dialog surfaces the *rejected* status (banner/inline, #398's concern); this store only records it.

## Downstream boundary (informative — belongs to #398, not this slice)

For the developer's awareness of where the seam is; **do not implement any of this in #397**:

- #398 mounts `<NewFolderData />` while the dialog is open, reads `selectNewFolderRoundTrip`, and on the Create action performs **record-before-send**: dispatch `{ type: 'createRequested' }` *then* `sendCommand({ type: 'createWorkspaceFolder', payload })` (the existing #381 command). Ordering matters so the store is in-flight before the reply can race back; the bridge listener is already live from dialog-open, so there is no subscribe gap.
- On `created`, #398 switches the conversation to `path` and closes; on `rejected`, it stays open for correction; on close/outcome it dispatches `{ type: 'reset' }` (AC4).

## Testing strategy

`npm test` (vitest), `npm run typecheck`. Framework-free helpers tested with plain spies; one server-render sanity for the headless component. Tests as scenarios (developer writes them in the project idiom):

**`newFolderStore.test.ts`** — reducer transitions (clone `runSettingsWriteStore.test.ts`):
- initial state is `{ roundTrip: { status: 'idle' } }`.
- `createRequested` from `idle` → `in-flight`; and from `rejected` → `in-flight` (retry after correction).
- `folderCreated` while `in-flight` → `created`, capturing `path` **verbatim** (assert exact string, e.g. a path with `..`/spaces is stored uncoerced).
- `folderRejected` while `in-flight` → `rejected`.
- **Gate (AC3):** `folderCreated` while `idle` → unchanged; `folderCreated` while `created` → unchanged; `folderRejected` while `idle` → unchanged; `folderRejected` while `created`/`rejected` → unchanged.
- **No-op identity:** a gated (ignored) event returns the **same state object** — assert `Object.is(reduceNewFolder(s, e), s)` so the store skips the notify.
- `reset` from `created` → `idle`, and the resulting `roundTrip` has **no `path`** (no stale-key leak — the nesting invariant); `reset` from every status → `idle`.
- `selectNewFolderRoundTrip` returns `s.roundTrip`.

**`newFolderBridge.test.ts`** — translate + subscribe + container (clone `recentWorkspacesBridge.test.ts`):
- `translateNewFolderEvent`: `workspaceFolderCreated { path }` → `{ type: 'folderCreated', path }` (path passed through); `workspaceFolderRejected` → `{ type: 'folderRejected' }`; returns `null` for a sample of unrelated events (`connecting`, `disconnected`, `messageReceived`, `recentWorkspacesReceived`).
- `subscribeNewFolder`: subscribes exactly once; dispatches `folderCreated` on a `workspaceFolderCreated` event and `folderRejected` on a `workspaceFolderRejected` event; does **not** dispatch for an unrelated event; **forwards unconditionally** — emit a `workspaceFolderCreated` and assert `dispatch` was called even though (in a spy setup) no gate is applied here; returns the `off` handle as cleanup (assert `off` called once).
- **Integration seam (bridge + real store, the in-flight gate end-to-end):** wire `subscribeNewFolder` to a real `createNewFolderStore()`; dispatch `createRequested` (→ in-flight), emit `workspaceFolderCreated { path }`, assert store is `created` with that `path`. Then, on a **fresh** store still `idle`, emit `workspaceFolderRejected` and assert the store stays `idle` (the gate honored through the real reducer).
- `NewFolderData` server-renders to empty markup without touching `window.pyry` (the `RecentWorkspacesData.test` idiom).

## Non-goals (do not touch)

- **`daemonEventBridge.ts`** — its `workspaceFolderCreated`/`workspaceFolderRejected` no-op cases (`88-97`) are the *session-store* translator's correct behavior and **stay**. #382 followed exactly this rule (left `recentWorkspacesReceived`'s no-op, added a dedicated bridge). Do not convert them.
- **`events.ts` / `commands.ts` / `wire/types`** — both daemon arms and the `createWorkspaceFolder` command already exist. This slice adds no transport, wire type, or command.
- **`App.tsx`** — no app-level mount (§ Mount lifecycle).
- The outbound command send and the conversation-switch — #398.

## Open questions

None blocking. The mount-lifecycle decision (dialog-scoped) is settled above; if #398's implementer finds a concrete case where a reply must survive dialog close, that is a #398 change (promote `NewFolderData` to app-level in `App.tsx`) — the store and bridge here need no change to support it.
