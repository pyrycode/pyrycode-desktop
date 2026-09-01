# Default-workspace store

The renderer's persisted, client-owned "default workspace" preference — a `string | null` slice that
survives an app restart, so a new discussion can open in the user's saved folder instead of always
falling back to the daemon's server-side scratch default.

Introduced in [#403](../codebase/403.md), the **data half** of the Figma "Default workspace" setting
(17:56). The Settings row that lets the user *change* the default is [#404](../codebase/404.md) — this
ticket shipped no UI itself.

## What it does

Holds one persisted value: the workspace path a new, unpromoted discussion should carry as its
`cwd`, or `null` when no default has ever been chosen (fresh install). `null` is a distinct,
meaningful state — "take the daemon's server-side default" — not an error or a loading state.

Client-owned, not server-owned: the daemon exposes no "read the current defaults" verb, so this
preference has no source of truth on the daemon side. It lives entirely in the renderer.

## How it works

### Mechanism: renderer-local `localStorage`, behind an injected port

A workspace path is not a secret, so it need not sit behind the transport boundary — persistence is
renderer-local `localStorage`, not a main-process preference file. This keeps the change entirely
renderer-contained: **no new IPC command/event, no preload wiring, no `isRendererCommand` boundary
guard.** (The alternative — a main-process preference file, the `pairedServerStore.ts`/`secureStore.ts`
shape — would add a request/event + command + boundary guard for a value that isn't a secret; rejected
to stay within the ticket's S sizing.)

The persistence is an **injected port**, not a direct `window.localStorage` call inside the store:

```ts
export interface WorkspacePrefStorage {
  read(): string | null
  write(value: string | null): void
}
```

The vitest runtime is `node` — no jsdom, no `localStorage`, no `window`. A store that reached for
`window.localStorage` directly could not be unit-tested and would throw on import in any `node`-env
test that transitively loads the singleton. `localStorageWorkspacePref()` is the real backend, guarded
by `typeof window === 'undefined'` (the ChannelList "dereference `window` only inside callbacks"
discipline) so constructing the singleton is safe under `node`/`renderToStaticMarkup` — `read()` yields
`null`, the store starts empty. This is an import-safety guard, deliberately **not** a defensive
try/catch: a `localStorage` quota/disabled failure is not an observed failure mode in the Electron
renderer (Evidence-Based Fix Selection — no defense for a failure that hasn't happened).

Storage key: `DEFAULT_WORKSPACE_KEY = 'pyry.defaultWorkspace'` — **the first `localStorage` key in the
app.** If a second renderer-persisted preference is ever added, a small key-namespacing convention may
be worth extracting then; not built preemptively.

### The store (`src/renderer/src/store/defaultWorkspaceStore.ts`)

```ts
export interface DefaultWorkspaceState { defaultWorkspace: string | null }
export type DefaultWorkspaceStore = DefaultWorkspaceState & {
  setDefaultWorkspace: (value: string | null) => void
}

createDefaultWorkspaceStore(storage: WorkspacePrefStorage)   // vanilla createStore, DI over the port
defaultWorkspaceStore                                         // app-wide singleton, real localStorage port
useDefaultWorkspaceStore(selector)                            // narrow-slice React binding
selectDefaultWorkspace(state)                                 // the only read surface
```

The `serverInfoStore`/`recentWorkspacesStore` DI-factory → singleton → hook → selector shape, holding a
bare `string | null` rather than an object or array. A dedicated store, not a facet of an existing one
— this preference is orthogonal to connection/messages/conversation-list state, so only components
selecting it re-render. A single setter, not a reducer: exactly one mutation exists ("record the chosen
default"), so a discriminated-union action set would be a one-member union.

Two behaviors:
- **Hydration** — initial state is `{ defaultWorkspace: storage.read() }`, read once at construction
  (the "restore" half of surviving a restart).
- **Set-through** — `setDefaultWorkspace(value)` calls `storage.write(value)` **then** `set({
  defaultWorkspace: value })` (the "persist" half), replacing the whole value unconditionally — no
  merge, no coercion, exactly as `setServerInfo` does. `null` clears the stored default back to the
  daemon default.

## Configuration and usage

- **Import surface:** `import { useDefaultWorkspaceStore, selectDefaultWorkspace } from
  '../../store/defaultWorkspaceStore'`.
- **Read by [`ChannelList`](conversation-shell.md)** — the container reads
  `useDefaultWorkspaceStore(selectDefaultWorkspace)` reactively (mirroring its existing
  `useConversationListStore(selectConversations)` read) and passes the value into
  [`requestNewConversation`](conversation-create.md) as the new discussion's `cwd`. The reactive hook,
  not a `getState()` read at click time, so the FAB always closes over the current value — a future
  #404 change to the default re-renders the container without extra wiring.
- **The read/write seam for #404.** `defaultWorkspaceStore` **is** the seam — no additional export was
  needed. [#404](../codebase/404.md)'s `DefaultWorkspaceRowControl` reads
  `useDefaultWorkspaceStore(selectDefaultWorkspace)` to render the value (`"scratch"` when `null`), and
  its picker sheet's `onChoose` calls `defaultWorkspaceStore.getState().setDefaultWorkspace(path)` to
  change it (no client-side clear-to-null path is exposed yet — every picker choice writes a concrete
  path). #404 reuses [`WorkspacePickerSheetView`](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383)
  (#383's pure view, not its conversation-coupled container) and the
  [recent-workspaces store](recent-workspaces-store.md) (#382) for the picker UI.

## Edge cases and limitations

- **No default set (fresh install)** — `defaultWorkspace` is `null`; `requestNewConversation` dispatches
  `cwd: null`, reproducing the pre-#403 behavior exactly (the daemon applies its server-side scratch
  default). No regression to the existing FAB flow.
- **`localStorage` throwing (quota / disabled) is not handled** — deliberately no try/catch (see
  Mechanism above). The Electron renderer's `localStorage` is always available; the value is a single
  short path. If this ever surfaces, the fix is localized to `localStorageWorkspacePref`.
- **Server-render safety** — the singleton hydrates to `null` under `node` (the `typeof window` guard);
  `useStore(vanillaStore, selector)` under `renderToStaticMarkup` yields that `null`, the same posture
  `useConversationListStore` already relies on (proven by `PairedShell.test.tsx`).
- **No validation of the stored path** — `cwd` is renderer-supplied text the daemon resolves
  server-side; the desktop never filesystem-resolves it, so this store neither validates nor normalizes
  the value it persists.

## Related

- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  `create_conversation{cwd}` wire contract this store's value ultimately feeds; unchanged by this
  ticket (no wire/command drift, per CLAUDE.md no-drift).
- [New-discussion FAB](new-discussion-fab.md) / [#242 codebase notes](../codebase/242.md) — the FAB
  whose `requestNewConversation` call this ticket widens with a required `defaultCwd` parameter.
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the
  object-or-null single-setter store shape this store's structure clones.
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) —
  the same DI-factory → singleton → hook → selector idiom applied to a path-shaped payload; the
  store-test idiom ([`recentWorkspacesStore.test.ts`](../codebase/382.md)) this ticket's test file
  clones.
- [#403 codebase notes](../codebase/403.md) — implementation summary and patterns established.
- [#404 codebase notes](../codebase/404.md) — the Settings UI consumer of this store: the
  `DefaultWorkspaceRow`/`DefaultWorkspaceRowControl` row and its picker sheet.
