# Screen-snapshot store

The renderer's held copy of the daemon's **latest rendered-screen text** — a dedicated,
unidirectional Zustand store fed by a reactive-only headless observer, read by the display surface
[#324](../codebase/324.md) so a screen request never needs its own store facet or a second
subscription.

Introduced in [#323](../codebase/323.md), split from [#318](https://github.com/pyrycode/pyrycode-desktop/issues/318)
(itself split from [#147](../codebase/147.md)). Consumes the `screenSnapshotReceived` event
[#316](../codebase/316.md) already emits (see [Screen snapshot fetch](screen-snapshot-fetch.md)).
Shipped **dormant** at #323 — that ticket added no UI and no trigger; both landed in the sibling
[#324](../codebase/324.md), the store's sole reader (`ScreenSnapshotControl`) and the sole action
that fires a fresh `requestSnapshot`.

## What it does

Holds the most recently arrived `{ text, ts }` pair, verbatim, replacing the whole value on every
new arrival (most-recent-wins, no merge, no accumulation). `text` is untrusted daemon-relayed
content — never parsed, coerced, or validated here; the plain-text-never-HTML rendering discipline
is inherited by #324, which has the DOM sink this slice does not. An empty `text` (`""`) is a real
held value — the daemon can render a genuinely blank screen — distinct from `snapshot: null`,
which means "no screen received yet."

Deliberately **not** a [session store](session-store.md) or [run-config store](run-config-store.md)
facet: a screen-snapshot arrival never touches connection/messages/settings state and vice versa, so
it re-renders only components selecting this slice.

## How it works

### The store (`src/renderer/src/store/screenSnapshotStore.ts`)

```ts
export interface ScreenSnapshot { text: string; ts: string }
export interface ScreenSnapshotState { snapshot: ScreenSnapshot | null }  // null = not yet received
export type ScreenSnapshotStore = ScreenSnapshotState & { setSnapshot: (s: ScreenSnapshot) => void }

createScreenSnapshotStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
screenSnapshotStore                  // app-wide singleton
useScreenSnapshotStore(selector)     // React binding: useStore(screenSnapshotStore, selector)
selectScreenSnapshot(s)              // the only read surface
```

Mirrors [`runConfigStore.ts`](run-config-store.md)'s DI-factory → singleton → hook → selector
shape, with a **single setter** rather than a reducer — exactly one mutation ("record the latest
screen"), so a discriminated-union action set would be ceremony without benefit. `setSnapshot`
replaces the whole `snapshot` object unconditionally and never coerces/validates; `{ text: '', ts }`
is stored as-is.

### The observer (`src/renderer/src/store/screenSnapshotBridge.ts`)

```ts
translateScreenSnapshot(event: DaemonEvent): ScreenSnapshot | null
// case 'screenSnapshotReceived' → { text: event.text, ts: event.ts } (fresh named-field literal,
// never a spread); default → null. Permanent filter, not an assertNever gap — this is an
// independent subscriber, not one of the three typecheck-gating exhaustive bridges.

subscribeScreenSnapshot(onDaemonEvent, setSnapshot): () => void
// onDaemonEvent(event => { const s = translateScreenSnapshot(event); if (s !== null) setSnapshot(s) })
// `!== null`, not truthiness — makes explicit that the guard is on the snapshot object's presence,
// never on text content, so an empty-text snapshot still writes. Returns the off-handle as cleanup.

ScreenSnapshotData(): null
// Headless leaf, one useEffect(() => subscribeScreenSnapshot(window.pyry.onDaemonEvent, s =>
// screenSnapshotStore.getState().setSnapshot(s)), []). No connected-gate, no request effect.
```

Mirrors `runConfigSnapshot.ts`'s pure-filter/subscribe-only shape (not `conversationListBridge`'s
request+refresh shape) and, more precisely, the [session-id store](session-id-store.md)'s
(#259) reactive-only, App-lifetime posture — the closest structural precedent, since both are
push-only holders with **no request half at all** (there is no `requestScreenSnapshot`; the
daemon pushes `screenSnapshotReceived` unsolicited off the same `case 'snapshot'` seam).

### Mount (`src/renderer/src/App.tsx`)

`<ScreenSnapshotData />` is a fifth sibling headless leaf beside `<ConversationListData />`,
`<SessionIdData />`, `<RunSettingsWriteData />`, and `<QueueData />` — mounted for the **whole app
lifetime**, not on a screen-open effect, because a snapshot can arrive before #324 is ever mounted
and the latest rendered screen must be retained regardless of which screen is showing.

### Data flow

```
daemon → screen_snapshot frame → case 'snapshot' → emitDaemonEvent
    {type:'screenSnapshotReceived', text, ts}                              [#316, second emit]
  → DAEMON_EVENT_CHANNEL → ScreenSnapshotData's subscribeScreenSnapshot
  → translateScreenSnapshot → setSnapshot(s)
  → screenSnapshotStore                                    [most recent snapshot wins]
  → ScreenSnapshotControl reads via useScreenSnapshotStore(selectScreenSnapshot)     [#324]
```

## Configuration and usage

- **Import surface** (read by [#324](../codebase/324.md)'s `ScreenSnapshotControl`):
  `import { useScreenSnapshotStore, selectScreenSnapshot } from '@renderer/store/screenSnapshotStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, alongside the other App-level headless leaves.
- No new command, no IPC change, no preload change — renderer state only.

## Edge cases and limitations

- **One reader.** `ScreenSnapshotControl` ([#324](../codebase/324.md)) is the store's only consumer;
  a future second reader (e.g. a dedicated screen-snapshot sheet) would select the same narrow slice.
- **No correlation, no request tracking in this store.** Same posture as
  [#180](../codebase/180.md)/[#316](../codebase/316.md): any `screenSnapshotReceived` that arrives is
  written unconditionally. [#324](../codebase/324.md)'s `requestScreenSnapshot` fires a fresh
  `requestSnapshot` command from a separate, guarded action helper — the store itself still has no
  request half and no correlation to the command that produced a given reply.
- **No reset.** Unlike `runConfigStore`, there is no sheet-close boundary to reset on — the store
  simply keeps the last-known screen for the app's lifetime.

## Related

- [Screen snapshot fetch](screen-snapshot-fetch.md) — the transport half: the `screenSnapshotReceived`
  event this store's observer consumes, and the content-minimisation reversal that put `text`/`ts`
  on the wire in the first place.
- [Session-id store](session-id-store.md) / [#259 codebase notes](../codebase/259.md) — the closest
  structural precedent: a reactive-only, App-lifetime holder with no request half.
- [Run configuration store](run-config-store.md) — the DI-factory → singleton → hook → selector
  shape this store mirrors, contrasted on request-on-open vs. push-only.
- [Daemon-event channel](daemon-event-channel.md) — the `screenSnapshotReceived` `DaemonEvent` member.
- [#323 codebase notes](../codebase/323.md) — implementation summary and patterns established.
- [#324 codebase notes](../codebase/324.md) — the live-screen display + its trigger, the store's
  first and only consumer: `ScreenSnapshotControl` reads `selectScreenSnapshot` and renders the held
  `text` in a bounded `<pre>`, never HTML.
