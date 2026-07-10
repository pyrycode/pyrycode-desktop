# Session-id store

The renderer's held copy of the open conversation's **current daemon `session_id`** — a dedicated,
unidirectional Zustand store fed by the always-arriving `sessionTransition` marker, so the interactive
[Run configuration](conversation-shell.md#run-configuration-sheet-177) controls (#257, later) can
address a `set_session_settings` write to the session that is actually running.

Introduced in [#259](../codebase/259.md), the renderer-side retention half of #183's interactive
Run-configuration write path, split alongside #254/#255/#256/#257. Consumes the transport
[#254](../codebase/254.md) already shipped (`sessionTransition{newSessionId}` daemon event). This
store itself delivers no visible surface — it is a dormant holder until #257 reads it, the same
posture `runConfigStore` (#187) had before #188.

## What it does

Retains the most recently arrived `session_id` in a read-only store, superseded by each new
`sessionTransition` marker. Deliberately **not** a [run configuration store](run-config-store.md)
facet, and unlike that store, has **no request half**: the daemon *pushes* `session_transition`
markers unsolicited (a `/clear`, an idle eviction, or a workspace change), so nothing is requested and
nothing is correlated — reactive-only, strictly smaller than both `runConfigStore` (#187, requests on
sheet-open) and `conversationListStore` (#208, requests on the connected-edge).

## How it works

### The store (`src/renderer/src/store/sessionIdStore.ts`)

```ts
export interface SessionIdState { sessionId: string | null }   // null = no marker seen yet
export type SessionIdStore = SessionIdState & { setSessionId: (id: string) => void }

createSessionIdStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
sessionIdStore                  // app-wide singleton
useSessionIdStore(selector)     // React binding: useStore(sessionIdStore, selector)
selectSessionId(s)               // the only read surface
```

Mirrors `conversationListStore`'s DI-factory → singleton → hook → selector structure (the #208
idiom), but holds a bare `string | null` — no wire type, no camelCase remap, since the value is
already a routing id, not a wire row. A **single setter**, not a reducer: there is exactly one
mutation ("record the latest id"). `setSessionId` replaces the whole `sessionId` unconditionally
(last-write-wins, no merge) and never coerces or validates — a received empty string is held
**verbatim**, not treated as "no id." `sessionId: null` is the distinct "no marker seen yet" state, so
a degenerate empty-string id is never confused with "nothing arrived yet."

### The data path (`src/renderer/src/store/sessionIdBridge.ts`)

Framework-free, effects injected (the `conversationListBridge` / `runConfigSnapshot` idiom), so the
whole path unit-tests with plain spies:

```ts
translateSessionTransition(event: DaemonEvent): string | null
// sessionTransition → event.newSessionId verbatim; every other event → null (plain `default`, not
// assertNever — this filter permanently consumes only sessionTransition).

subscribeSessionId(onDaemonEvent, setSessionId): () => void
// onDaemonEvent(event => { const id = translateSessionTransition(event); if (id !== null) setSessionId(id) })
// — returns the off handle (the daemonEventBridge cleanup idiom). The guard is `!== null`, not
// truthiness: `if (id)` would silently drop an empty-string session_id.
```

### The React binding — `SessionIdData` (same file)

A headless leaf (`SessionIdData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<ConversationListData />` — **not** sheet-scoped like
`RunConfigData`. A `sessionTransition` marker can arrive at any time, including before the Run
config sheet is ever opened, so the subscriber must already be listening. One
`useEffect(() => subscribeSessionId(window.pyry.onDaemonEvent, id => sessionIdStore.getState().setSessionId(id)), [])`;
`window.pyry` is dereferenced only inside the effect, so it server-renders to empty markup without a
bridge mock (the `ConversationListData` invariant). No request effect, no `useState`/`useRef`/
`useSessionStore` — reactive-only.

### Data flow

```
daemon → transport (#254) → sessionTransition{newSessionId}
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, #254)
                                └─ SessionIdData (NEW, #259)
                                     → translateSessionTransition → setSessionId
                                     → sessionIdStore                                  [last marker wins]

#257 (later): useSessionIdStore(selectSessionId)
```

## Configuration and usage

- **Import surface**, for the future #257 consumer:
  `import { useSessionIdStore, selectSessionId } from '@renderer/store/sessionIdStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, `<SessionIdData />` next to `<ConversationListData />`.
- **Single current id, not a per-conversation map** — the marker carries no `conversation_id`
  (pyrycode/pyrycode#656) and desktop targets a single active conversation
  (`MILESTONE_CONVERSATION_ID`).

## Edge cases and limitations

- **No consumer yet.** `useSessionIdStore`/`selectSessionId` are exported but unread until #257 —
  flagged as a NIT (not blocking) in code review, the same dormant-holder posture
  `useConversationListStore` had before #141 and `useModalBridge` had before #223.
- **Empty-string `session_id` is held, not dropped** — deliberate (see the store section); a product
  call to instead reject it would be a behavior change, not a bug fix.
- **No correlation, no reset.** Nothing is requested, so there is nothing to time out or retry; the
  store keeps its last id across the whole app lifetime (there is no "close" event to reset on).

## Related

- [Daemon-event channel](daemon-event-channel.md) — the `sessionTransition` event this store's bridge
  consumes, shipped content-minimised (only `newSessionId`) in [#254](../codebase/254.md).
- [Daemon-event bridge](daemon-event-bridge.md) — the `assertNever`-guarded bridge whose
  `sessionTransition → null` arm (added in #254) reserved this feature's consumer role; this store is
  a **fifth**, independent subscriber on the same channel, not a change to that bridge.
- [Conversation list store](conversation-list-store.md) — the structural precedent this store's
  DI-factory → singleton → hook → selector shape and its App-level always-listening headless leaf both
  mirror.
- [Run configuration store](run-config-store.md) — the sibling store this ticket deliberately did
  **not** fold `session_id` into (lifecycle mismatch: sheet-scoped vs. App-level always-listening).
- [Conversation shell](conversation-shell.md) — the Run configuration sheet #257 will wire this
  store's selector into.
- [#254 codebase notes](../codebase/254.md) — the transport decode arm this store consumes.
- [#259 codebase notes](../codebase/259.md) — implementation summary and patterns established.
