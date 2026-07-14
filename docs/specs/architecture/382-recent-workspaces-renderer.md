# #382 — Recent-workspaces renderer store + bridge

**Size:** S — two new renderer files (store + bridge) plus their unit tests, cloning three established patterns, zero call-site fan-out, no wire/command/event/type plumbing (all shipped by #380).

**Security-sensitive:** No. Pure renderer state; no keys, sockets, or raw bytes. The outbound command crossing the untrusted boundary already shipped on the sec ticket #380. Carry-forward for the picker (a later ticket, **not** this one — no DOM sink here): render `path` as plain text, never HTML, and never resolve it into a local filesystem operation — it is a remote daemon-side path.

**Design source:** N/A — headless renderer state, no UI. The Workspace Picker that renders this store is a separate ticket and carries its own Figma anchor.

---

## Files to read first

- `src/renderer/src/store/conversationListStore.ts` (whole file, 73 lines) — **the store clone source.** DI-factory → app-singleton → narrow-slice hook → read-only selector; single whole-array-replace setter; `null` initial state distinct from `[]`; holds wire rows **verbatim** in snake_case (the drift-free precedent). Your store is a near-exact clone of this file, minus the `selectArchivedCount` derived selector (no analog here).
- `src/renderer/src/store/conversationListBridge.ts` (whole file, 136 lines) — **the subscription-half clone source.** `translateConversationsEvent` (the `event → rows | null` filter), `requestConversationList` (the bare fire-and-forget command), `subscribeConversations` (single injected-`onDaemonEvent` listener, `list !== null` guard, returns the off-handle), and the `ConversationListData` headless container. Your bridge mirrors the shapes but drops the `shouldRefreshList` / `refreshOnChange` refresh-trigger machinery (recent-workspaces has no update-broadcast counterpart) and swaps the connection-lifecycle trigger for an on-demand one-shot.
- `src/renderer/src/store/serverInfoLoader.ts:44-69` — **the on-demand one-shot-request clone source.** `ServerInfoData`: a headless leaf that fires once on mount with a StrictMode-safe guard and **ships dormant** (no consumer mounts it here — the picker wires the mount point). Take the "mounted on demand, not app-level" lifecycle shape from here; take the fire-and-forget-command dedup mechanism (a `useRef` flag) from `ConversationListData` (lines 123-133), **not** the `active` promise-cancellation flag (there is no awaited invoke to cancel here).
- `src/shared/wire/types.ts:546-549` — the wire `RecentWorkspace` row (`{ path: string; last_used_at: string }`, snake_case). This is the exact type your store holds, verbatim, imported from `@shared/wire/types`. Read the doc comment above it (lines 540-545) — `path` is opaque display text, `last_used_at` is an opaque unparsed string.
- `src/shared/ipc/events.ts:221-229` — the `recentWorkspacesReceived` daemon-event arm (already shipped by #380): `{ type: 'recentWorkspacesReceived'; recentWorkspaces: readonly RecentWorkspace[] }`. Your bridge's translate filter matches this arm. Read the warning comment — it carries the plain-text/no-fs constraint forward.
- `src/shared/ipc/commands.ts:107` — the outbound `{ type: 'requestRecentWorkspaces' }` command (already shipped by #380, wired through to the daemon at `main/index.ts` + guarded in the codec). Your bridge **dispatches** this existing literal; it adds no new command.
- `src/renderer/src/store/conversationListStore.test.ts` and `src/renderer/src/store/conversationListBridge.test.ts` — **the test clone sources** for the store and the bridge helpers respectively (fake `onDaemonEvent` spy, fake `sendCommand` spy, `null`-vs-`[]` assertions, DI store isolation, off-handle cleanup).
- `src/renderer/src/store/serverInfoLoader.test.ts:84-96` — the container server-render sanity test idiom (`renderToStaticMarkup` → empty markup, no bridge mock). Note lines 87-88: the one-shot / StrictMode timing is verified **by inspection against the established idiom, not unit-tested** — follow that precedent.
- `src/renderer/src/store/daemonEventBridge.ts:83-87` — the pre-existing session-store no-op for `recentWorkspacesReceived`. **Leave it untouched.** #382 adds a dedicated store + bridge; it does not route this event through the session store.

---

## Context

The transport slice (#380, merged PR#388) already decodes the daemon's `recent_workspaces_list` reply into the typed `recentWorkspacesReceived` daemon event and ships the outbound `requestRecentWorkspaces` command wired through to the daemon. This ticket is the **renderer half**: the store that holds the list, a headless bridge that fills it from that event, and a one-shot request trigger so the list is fetched when needed. There is no UI — the Workspace Picker consumes this store on its own ticket.

This is the exact `#139 transport → #208 renderer` split: the untrusted-boundary work (wire types, decode, the outbound command) landed on the security-sensitive transport ticket; this non-sec ticket only holds already-typed data and dispatches an already-existing command. It adds **no** wire / command / event / type plumbing — it consumes what #380 shipped.

---

## Design

Two new files under `src/renderer/src/store/`, no other production files touched. The store is a clone of `conversationListStore`; the bridge is a **hybrid** of `conversationListBridge` (subscription half) and `serverInfoLoader` (on-demand one-shot half).

### 1. `recentWorkspacesStore.ts` — the state

A dedicated store, not a session-store facet (the `conversationListStore` / `serverInfoStore` precedent). Structure mirrors `conversationListStore.ts` one-for-one:

- **State:** `interface RecentWorkspacesState { recentWorkspaces: readonly RecentWorkspace[] | null }`. Import `RecentWorkspace` from `@shared/wire/types` and hold it **verbatim** — snake_case `{ path, last_used_at }`, most-recent-first as the wire delivers it. **No** camelCase renderer twin, **no** per-field remap (the drift-free precedent — the store holds exactly what the wire emits). `last_used_at` stays the opaque wire string; relative-time formatting is a deferred picker concern.
- **`null` is the distinct "not yet loaded" state**, kept distinguishable from a delivered `[]` ("loaded, zero workspaces") so the picker can later tell a loading state from an empty one (the `#141` / `#324` null-vs-empty precedent).
- **Store shape:** `RecentWorkspacesState & { setRecentWorkspaces: (rows: readonly RecentWorkspace[]) => void }`. One setter, replaces the whole array unconditionally (whole-list replacement — no merge, no dedupe, no coercion). A single setter, not a reducer: exactly one mutation, so a discriminated-union action set would be a one-member union.
- **Exports** (mirror `conversationListStore.ts`'s public surface):
  - `initialRecentWorkspacesState: RecentWorkspacesState` = `{ recentWorkspaces: null }`
  - `createRecentWorkspacesStore(init = initialRecentWorkspacesState)` — DI factory over `createStore` from `zustand/vanilla`
  - `recentWorkspacesStore` — the app-wide singleton
  - `useRecentWorkspacesStore<T>(selector)` — narrow-slice hook over `useStore` from `zustand`
  - `selectRecentWorkspaces(s): readonly RecentWorkspace[] | null` — the sole read surface

No `selectArchivedCount`-style derived selector — there is no downstream derived read in scope. Add none.

### 2. `recentWorkspacesBridge.ts` — the data path (hybrid)

Four exports. The first three are pure / React-free / injected (unit-testable with plain spies); the fourth is the thin React glue.

**Subscription half** (clone `conversationListBridge.ts`, minus the refresh-trigger machinery):

- `translateRecentWorkspacesEvent(event: DaemonEvent): readonly RecentWorkspace[] | null` — a `switch (event.type)` filter: `case 'recentWorkspacesReceived': return event.recentWorkspaces`; `default: return null`. Selecting a single named field is a filter, not a field-remap — return `event.recentWorkspaces` directly (a renamed arm still surfaces as a type error). `default: null` is intentional, not an `assertNever`: ignoring every other event is the permanent behavior.
- `subscribeRecentWorkspaces(onDaemonEvent, setRecentWorkspaces): () => void` — one listener via the injected `onDaemonEvent`; each `recentWorkspacesReceived` writes its rows verbatim via `setRecentWorkspaces`. Use the explicit `if (list !== null)` guard (not `if (list)`), so "an empty list still writes — loaded-zero, not not-loaded" is unmistakable. Returns the off-handle (the cleanup). **No `refreshOnChange` parameter** — there is no `conversationUpdated`-style broadcast that re-requests recent-workspaces; the picker re-fetches by remounting the trigger, not via an unsolicited daemon event.

**On-demand one-shot request half** (fire-and-forget command from `conversationListBridge`, lifecycle shape from `serverInfoLoader`):

- `requestRecentWorkspaces(sendCommand: (command: RendererCommand) => void): void` — fires the existing bare `{ type: 'requestRecentWorkspaces' }` literal (typed as `RendererCommand`, imported from `@shared/ipc/commands`). Fire-and-forget; `sendCommand` is `void`. This dispatches the **existing** #380 command — it does not add one.

**React glue:**

- `RecentWorkspacesData(): null` — a headless leaf (renders `null`), **ships dormant** (no consumer mounts it in this ticket; the picker wires the mount point). Two effects, subscribe-before-request ordering:
  1. **Subscribe effect (declared first, runs first on mount):** `return subscribeRecentWorkspaces(window.pyry.onDaemonEvent, (rows) => recentWorkspacesStore.getState().setRecentWorkspaces(rows))`. The returned off-handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener (the `daemonEventBridge` off-handle idiom).
  2. **One-shot request effect:** a `useRef(false)` guard (`requested`); on run, `if (requested.current) return; requested.current = true; requestRecentWorkspaces(window.pyry.sendCommand)`. The ref persists across the StrictMode simulated unmount/remount (same fiber), so exactly **one** request fires per mount — the AC's "fires exactly one request per trigger." A real unmount/remount (picker closed and reopened) is a fresh instance → fresh ref → a fresh fetch, which is the intended on-demand behavior. **No connection-lifecycle gate** and **no ref reset** — unlike `ConversationListData`, this is a pure on-mount one-shot (the `serverInfoLoader` "fetch fresh every time the surface opens" shape), not a per-connection-episode re-arm.

`window.pyry` is dereferenced only inside the effects, never during render — so `RecentWorkspacesData` server-renders to empty markup without a bridge mock (the `ServerInfoData` invariant).

### Data flow

```
picker mounts RecentWorkspacesData (future ticket)
   │
   ├─ effect 1 subscribes:  window.pyry.onDaemonEvent ── recentWorkspacesReceived ──▶ setRecentWorkspaces(rows)  ──▶ recentWorkspacesStore
   └─ effect 2 fires once:  requestRecentWorkspaces(window.pyry.sendCommand) ──▶ { type:'requestRecentWorkspaces' } ──▶ (main → daemon, #380)
                                                                                          │
                                    daemon reply decoded to recentWorkspacesReceived ◀────┘   (arrives on the effect-1 subscription)

picker reads:  useRecentWorkspacesStore(selectRecentWorkspaces) ──▶ RecentWorkspace[] | null   (future ticket)
```

Unidirectional: the window reads through the selector; `setRecentWorkspaces` is invoked only by the subscription wiring; no component writes back into the store.

---

## State + concurrency model

- **Store slice:** the new `recentWorkspacesStore` singleton, orthogonal to every other store — a recent-workspaces arrival re-renders only components selecting this slice.
- **Subscription:** one listener over `window.pyry.onDaemonEvent`, torn down by the returned off-handle in the subscribe effect's cleanup. StrictMode double-mount → one live listener.
- **One-shot request:** fire-and-forget command, deduped to exactly one per mount by the `useRef` guard. No promise to await, no `AbortController` — the command has no renderer-side completion; the reply arrives asynchronously on the independent subscription.
- **Teardown:** the subscribe effect's cleanup unsubscribes on unmount. The one-shot effect has no cleanup (nothing to cancel — the command is already dispatched).

---

## Error handling

No new failure modes. This layer holds already-typed, already-decoded data and dispatches an existing command:

- **Malformed / hostile rows** are impossible at this layer — decode + validation happened main-side on #380 before the event was emitted; the renderer receives a typed `readonly RecentWorkspace[]`.
- **A `recentWorkspacesReceived` carrying `[]`** is a valid loaded-zero state, written through as `[]` (the `!== null` guard), never coerced to `null`.
- **A request sent while disconnected** is the main side's concern (the command is dispatched fire-and-forget, exactly as `requestConversations`); no renderer-side result or error to surface. If the connection is down when the picker mounts the trigger, no reply arrives and the store stays `null` — the picker's own loading affordance covers that, on its ticket.
- The subscription listener only dispatches into the store; it never throws into React.

---

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two new test files, cloning the existing store/bridge tests. Write bullet scenarios in the project's test idiom (fake spies, no Electron, no real DOM beyond `renderToStaticMarkup`).

**`recentWorkspacesStore.test.ts`** (clone `conversationListStore.test.ts`):
- starts not-loaded — `recentWorkspaces` is `null` (AC: initial `null`).
- `setRecentWorkspaces(rows)` records them; `selectRecentWorkspaces` returns them.
- a later `setRecentWorkspaces` **replaces** the held list — most-recent wins, no merge, no dedupe.
- holds an empty list verbatim — `[]` is loaded-zero, **not** `null` (the null-vs-empty distinction).
- holds a row **verbatim in snake_case** — `{ path, last_used_at }` fields intact, order preserved (no camelCase remap).
- DI isolation — two `createRecentWorkspacesStore()` instances stay independent; a store starts from an injected initial state; `initialRecentWorkspacesState` equals `{ recentWorkspaces: null }`.
- the `setRecentWorkspaces` reference is stable across updates (Zustand v5 stable-snapshot; mirror the existing store test's assertion).

**`recentWorkspacesBridge.test.ts`** (clone `conversationListBridge.test.ts` + the `serverInfoLoader.test.ts` container test):
- `translateRecentWorkspacesEvent`: a `recentWorkspacesReceived` maps to its `recentWorkspaces` array; an empty one maps to `[]` (not `null`); a sample of unrelated daemon events maps to `null`.
- `requestRecentWorkspaces`: a fake `sendCommand` spy is called exactly once with `{ type: 'requestRecentWorkspaces' }`.
- `subscribeRecentWorkspaces` (fake `onDaemonEvent` capturing the listener, returning an off spy): subscribes exactly once; a delivered `recentWorkspacesReceived` calls the setter with the rows; an unrelated event does not; a delivered `[]` still calls the setter (the `!== null` guard, not truthiness); the returned handle is the `onDaemonEvent` off-handle; driving a **real** `createRecentWorkspacesStore()` from `null` → loaded via the real setter (the seam test).
- `RecentWorkspacesData` container: server-renders to empty markup via `renderToStaticMarkup` without touching `window.pyry` (the `ServerInfoData` idiom). Per that precedent, the StrictMode one-shot-dedup timing is verified **by inspection against the `ConversationListData` ref-guard idiom, not unit-tested** — do not build a StrictMode render harness for it.

---

## Open questions

None blocking. Two deferred, both owned by the picker ticket, not this one:
- **Trigger mount point + any connected-gate.** This ticket ships `RecentWorkspacesData` dormant. The picker decides where to mount it and whether to gate the one-shot on `connected` (recent-workspaces is a paired-only surface, so the connection is expected live at mount). No gate is added here — the `serverInfoLoader` on-mount shape is deliberate.
- **Relative-time formatting of `last_used_at`.** Deferred to the picker; the store holds the opaque wire string.
