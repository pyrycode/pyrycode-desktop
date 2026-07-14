# Spec #403 — Default workspace for new conversations: persist and apply on create

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/403
**Size:** S (PO-sized S; confirmed S — 1 new + 2 modified production files, ~220 LOC total, no edit fan-out).
**Security-sensitive:** No. A user-chosen workspace path is not a secret/credential/token, never touches the Noise handshake / relay socket / frame routing. `cwd` is renderer-supplied text the daemon resolves server-side; the desktop never filesystem-resolves it.
**UI:** None. This is the data half of the "Default workspace" setting (Figma 17:56). The Settings row that *changes* the default is #404 (blocked-by this). No `## Design source` section — no visual surface ships here.

## Design source

N/A — data-path ticket; ships no UI. The Settings row visual (Figma 17:56) lands in #404.

## Files to read first

- `src/renderer/src/store/serverInfoStore.ts` — **the closest template.** An object-or-null single-setter store (`ServerInfoValue | null`) with the DI-factory → singleton → hook → selector structure. Clone this shape; the new store holds a `string | null` instead of an object.
- `src/renderer/src/store/recentWorkspacesStore.ts` — the same store idiom for a path-shaped payload; skim for the `select*`/`use*Store`/`create*Store` naming and the "single setter, not a reducer" rationale.
- `src/renderer/src/store/recentWorkspacesStore.test.ts` — **the store-test idiom to clone.** Plain-function tests over isolated `create*Store()` instances, `node` env, no React, no DOM. The new store test follows this exactly, adding an injected in-memory fake for the persistence round-trip.
- `src/renderer/src/store/conversationCreatedBridge.ts:13-23` — `requestNewConversation`, the function to widen. Note the inline-literal `RendererCommand` idiom (no constructor) and the `cwd: null` = "take the daemon default" contract.
- `src/renderer/src/store/conversationCreatedBridge.test.ts:44-54` — the existing `requestNewConversation` test asserting `cwd: null`; update + extend it.
- `src/renderer/src/screens/channels/ChannelList.tsx:39,55,63` — the container's existing store read (`useConversationListStore(selectConversations)`) and the FAB wiring point (`onNewConversation={() => requestNewConversation(window.pyry.sendCommand)}`). The new store read mirrors line 39; the FAB handler gains the default argument.
- `src/shared/ipc/commands.ts:308-324` — `CreateConversationPayload` and `isCreateConversationPayload`. Confirms `cwd` is already **nullable-and-present** on the wire: a `string` *or* a literal `null` both pass the boundary guard. **No wire/command/guard change is needed** — this ticket only changes which value the renderer supplies.
- `vitest.config.ts:24-30` — `environment: 'node'`. There is no jsdom and no `localStorage` in the test runtime. **This is why persistence must be an injected port**, not a direct `window.localStorage` call inside the store.

## Context

New discussions are created by the channel-list FAB (#242). Today the FAB dispatches `createConversation` with a hardcoded `cwd: null` (`conversationCreatedBridge.ts:22`), which tells the daemon "use your server-side default" (the scratch workspace). There is no client-owned notion of a *default workspace* that persists across app restarts.

This ticket introduces that data path — a persisted, client-owned default-workspace value — and wires new-conversation creation to honour it. `create_conversation` already carries `cwd`, so **no wire or daemon change is needed** (CLAUDE.md no-drift). The daemon exposes no "read the current defaults" verb, so server-owned defaults are not an option today; client-owned is the only path.

## Mechanism decision: renderer-local `localStorage`, behind an injected port

**Chosen: renderer-local persistence via `window.localStorage`.** A workspace path is not a secret, so it need not sit behind the transport boundary. This keeps the whole change renderer-contained — **no new IPC command/event, no preload wiring, no `isRendererCommand` guard** — which is what keeps it comfortably within S. (The alternative, a main-process preference file, would add a request/event + command + boundary guard and risk busting S; rejected for that reason. The existing `src/main/pairedServerStore.ts` over `secureStore.ts` is encrypt-at-rest for a genuine secret — deliberately heavier than a non-secret path needs.)

**The persistence is an injected port, not a direct `localStorage` call.** The vitest runtime is `node` (no jsdom, no `localStorage`, no `window`). A store that reached for `window.localStorage` directly could not be unit-tested and would throw `ReferenceError` on import in any `node`-env test that transitively loads the singleton. So the store depends on a small `WorkspacePrefStorage` interface (the `createStore({ transport })` DI idiom); the real `localStorage`-backed impl is wired at the singleton composition root, and tests inject an in-memory fake. This also makes the persist-then-restore round-trip (AC5) testable without a DOM harness.

## Design

### New module — `src/renderer/src/store/defaultWorkspaceStore.ts`

A dedicated store (the `serverInfoStore` / `recentWorkspacesStore` precedent), not a facet of an existing store: the default-workspace preference is orthogonal to connection/messages/conversation-list state, so it stays its own slice and only components selecting it re-render. Holds a bare `string | null` (`null` = the absence-distinct "no default set" state, i.e. fresh install / never chosen). A single setter, not a reducer — there is exactly one mutation ("record the chosen default"), so a discriminated-union action set would be a one-member union.

**Persistence port (the injected dependency):**

```ts
export interface WorkspacePrefStorage {
  read(): string | null            // the persisted default, or null if never set
  write(value: string | null): void // persist a value; null clears the stored default
}
```

**`localStorage`-backed impl + storage key:**

```ts
export const DEFAULT_WORKSPACE_KEY = 'pyry.defaultWorkspace' as const
export function localStorageWorkspacePref(): WorkspacePrefStorage
```

- `read()` — `typeof window === 'undefined' ? null : window.localStorage.getItem(DEFAULT_WORKSPACE_KEY)` (`getItem` already returns `null` for an absent key).
- `write(value)` — same `typeof window` guard; `value === null ? removeItem(KEY) : setItem(KEY, value)`.
- The `typeof window` guard is the **import-safety guard**, mirroring ChannelList's "dereference `window.pyry` only inside callbacks" discipline: it makes constructing the singleton safe under `node`/`renderToStaticMarkup`, where `read()` yields `null` and the store starts empty. It is not a defensive try/catch (see § Error handling).

**State, store shape, factory, singleton, hook, selector** (clone `serverInfoStore`'s structure verbatim, swapping the object payload for `string | null`):

```ts
export interface DefaultWorkspaceState { defaultWorkspace: string | null }
export type DefaultWorkspaceStore = DefaultWorkspaceState & {
  setDefaultWorkspace: (value: string | null) => void
}
export function createDefaultWorkspaceStore(storage: WorkspacePrefStorage): /* zustand vanilla store */
export const defaultWorkspaceStore = createDefaultWorkspaceStore(localStorageWorkspacePref())
export function useDefaultWorkspaceStore<T>(selector: (s: DefaultWorkspaceStore) => T): T
export const selectDefaultWorkspace = (s: DefaultWorkspaceState): string | null => s.defaultWorkspace
```

Factory behavior (the two behaviors the tests pin):
- **Hydration:** initial state is `{ defaultWorkspace: storage.read() }` — the store reads the persisted value once at construction. This is the "restore" half of AC1/AC5.
- **Set-through:** `setDefaultWorkspace(value)` calls `storage.write(value)` **then** `set({ defaultWorkspace: value })`. This is the "persist" half. It replaces the whole value unconditionally (no merge, no coercion), exactly as `setServerInfo` does.

Note the DI seam here is the `storage` **port** (not a static `init` object like the other two stores), because the injected dependency that varies between prod and test is the persistence backend, not a seed value.

### Modified — `src/renderer/src/store/conversationCreatedBridge.ts`

Widen `requestNewConversation` to take the default `cwd` as a **required** second parameter — keeping the function React-free and injected (its whole design point; tested with plain spies). The signature moves from:

```ts
export function requestNewConversation(sendCommand: (command: RendererCommand) => void): void
```
to:
```ts
export function requestNewConversation(
  sendCommand: (command: RendererCommand) => void,
  defaultCwd: string | null
): void
```

Body: dispatch `{ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: defaultCwd } }`. A `null` `defaultCwd` reproduces today's exact `cwd: null` behaviour (AC3); a set value rides through **verbatim** (AC2). `is_promoted: false` and `name: null` are unchanged — this remains an ad-hoc discussion. Update the doc comment's `cwd` line to reflect "carries the saved default, or `null` for the daemon default."

*Making the parameter required (not defaulted to `null`) is deliberate:* it forces the one caller to state its intent and it keeps the change honest rather than hiding a default-parameter smell. The one existing test updates to pass `null` explicitly.

### Modified — `src/renderer/src/screens/channels/ChannelList.tsx`

Read the default in the container (mirroring the existing `useConversationListStore(selectConversations)` on line 39) and pass it into the FAB handler:

- Add: `const defaultWorkspace = useDefaultWorkspaceStore(selectDefaultWorkspace)`
- Change line 63 to: `onNewConversation={() => requestNewConversation(window.pyry.sendCommand, defaultWorkspace)}`

The reactive hook (not a `getState()` read at click time) matches the file's existing store-usage idiom and re-renders the container when #404 changes the default, so the FAB always closes over the current value. **Server-render safety is preserved:** the singleton hydrates to `null` under `node` (the `typeof window` guard), and `useStore(vanillaStore, selector)` under `renderToStaticMarkup` yields that `null` — the exact posture `useConversationListStore` already relies on, proven by `PairedShell.test.tsx` server-rendering `<PairedShell>` → `<ChannelList>`. The `window.pyry` deref stays inside the click arrow.

## The read/write seam for #404 (AC4)

`defaultWorkspaceStore` **is** the seam. #404's Settings row will:
- **read** the current default via `useDefaultWorkspaceStore(selectDefaultWorkspace)` to render the value ("scratch" when `null`), and
- **write** the chosen default via `setDefaultWorkspace(path)` (or `setDefaultWorkspace(null)` to clear back to the daemon default).

No additional export is needed for #404 beyond the hook, selector, and setter this ticket already ships. #404 also owns the `WorkspacePickerSheet` (#383) / `recentWorkspacesStore` (#382) reuse — out of scope here.

## State + concurrency model

Pure synchronous renderer state. One Zustand vanilla singleton; `localStorage` read/write are synchronous; there are no async tasks, streams, subscriptions, `AbortController`s, or teardown to manage. Unidirectional is preserved: read-only selector, one write path (`setDefaultWorkspace`), never two-way-bound from a component — #404 dispatches into the setter, it does not bind a field to it.

## Error handling

- **`node` / SSR import path:** handled by construction, not by catching — the `typeof window === 'undefined'` guard makes `read()`/`write()` no-op/return-`null`, so the singleton is safe to import and server-render.
- **`localStorage` throwing (quota / disabled):** **no try/catch is specified** (Evidence-Based Fix Selection — not an observed failure). The Electron renderer always has a working `localStorage`; the value is a single short path (quota is irrelevant); there is no sandboxed-iframe `SecurityError` surface. Adding defensive catch logic here would be shipping a defense for a failure mode that has not occurred. If it ever surfaces, the fix is localized to `localStorageWorkspacePref`.
- **No UI failure surface:** this ticket renders nothing; there is no banner/dialog to spec.

## Testing strategy

Vitest, `node` env, `npm test`. Types under `npm run typecheck`; `npm run build` is the salvage/QA gate.

**`defaultWorkspaceStore.test.ts` (new)** — plain-function tests over isolated `createDefaultWorkspaceStore()` instances with an injected in-memory fake port (a closure over a mutable `string | null`, exposing `read`/`write`). Clone `recentWorkspacesStore.test.ts`'s structure. Scenarios (as bullets — developer writes them in the project idiom):
- Fresh install: fake reads `null` → store starts with `defaultWorkspace === null`; `selectDefaultWorkspace` returns `null` (AC1 no-default state).
- Hydration: fake seeded with `'/home/pyry/project'` → store starts with that value (the "restore" half of AC1/AC5).
- `setDefaultWorkspace('/x')` records `'/x'` in state and returns it via the selector.
- `setDefaultWorkspace('/x')` calls `storage.write('/x')` (spy/observed on the fake) — the "persist" half.
- `setDefaultWorkspace(null)` records `null` and calls `storage.write(null)` (clear).
- **Persist-then-restore round-trip (AC5):** create store A over a shared fake, `setDefaultWorkspace('/x')`; create store B over the **same** fake → B hydrates `'/x'`. This proves survival across a simulated restart without a DOM.
- DI isolation: two stores over independent fakes don't leak.
- (Optional, matches precedent) `setDefaultWorkspace` reference is stable across updates.

**`conversationCreatedBridge.test.ts` (update `describe('requestNewConversation')`)**:
- Update the existing case to call `requestNewConversation(sendCommand, null)` and assert the dispatched payload is `{ is_promoted: false, name: null, cwd: null }` (AC3 — no-default unchanged).
- Add a case: `requestNewConversation(sendCommand, '/home/pyry/project')` dispatches `{ is_promoted: false, name: null, cwd: '/home/pyry/project' }` — `cwd` verbatim, `is_promoted`/`name` untouched (AC2).

The React glue (`ChannelList` container reading the store) stays proven by composition — its server-render safety by `PairedShell.test.tsx`, consistent with how the container's existing store read is covered. No new render assertion is required for the FAB argument; the spy tests above pin the dispatched payload.

## Open questions

- **Storage key name.** `'pyry.defaultWorkspace'` is proposed. It is the first `localStorage` key in the app; if a future ticket adds more renderer prefs, a small key-namespacing convention may be worth extracting — deferred until a second key exists (no premature abstraction).
- **`useStore` vs `getState()` at click.** The spec chooses the reactive hook for idiom-consistency with the container's existing store read; a `getState()`-at-click read is behaviourally equivalent and acceptable if the developer finds it cleaner. Either satisfies the ACs.

## Scope self-check

Production source files (`*.ts`/`*.tsx`, excluding tests/md/spec): **3** — 1 new (`defaultWorkspaceStore.ts`), 2 modified (`conversationCreatedBridge.ts`, `ChannelList.tsx`). New exported types/interfaces: **3** (`WorkspacePrefStorage`, `DefaultWorkspaceState`, `DefaultWorkspaceStore`). Real call sites of the widened function: **1** (`ChannelList.tsx:63`) — no edit fan-out. No new IPC/preload/wire surface, no state machine, no reject branches. Well within S.
