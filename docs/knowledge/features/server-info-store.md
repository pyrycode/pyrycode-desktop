# Server-info store

The renderer's held copy of **every paired server's non-secret identity** — one `{ serverId, relayUrl }`
entry per server — a dedicated, unidirectional Zustand store fed by a one-shot fetch of the [server-info
channel](server-info-channel.md), so a Settings screen can render which servers the user is paired with,
**including while disconnected**.

Introduced in [#340](../codebase/340.md), the renderer-side half of the #339/#340/#333/#334 split
(parent [#332](../codebase/332.md)), single-valued at first. Shipped **dormant** in #340 — no consumer
mounted the loader in that ticket. [#334](../codebase/334.md) mounts `<ServerInfoData />` inside the
paired-only [Settings tree](settings-screen.md), alongside the store-bound Server row that reads what it
writes. [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) then widened the store from one
value to a list, matching [#1069](paired-server-store.md)'s collection and the channel's own widening —
Settings had caught up everywhere else, and this store was the last single-valued layer in the path.

## What it does

Retains every paired server's `serverId` + `relayUrl` in a read-only store, populated by exactly one
`window.pyry.serverInfo()` invoke per mount. Unlike [session-id store](session-id-store.md)'s
`sessionTransition` subscription, there is no daemon event behind this value — the main-process source
is the disconnected-safe at-rest [paired-server collection](paired-server-store.md), so a **one-shot
invoke**, not a subscription, is the correct shape (the `App.tsx` `pairingStatus()` mount-effect idiom,
not the `sessionIdBridge` `onDaemonEvent` idiom).

## How it works

### The store (`src/renderer/src/store/serverInfoStore.ts`)

```ts
export interface ServerInfoValue { serverId: string; relayUrl: string }   // ONE row's value
export interface ServerInfoState { servers: ServerInfoValue[] }           // [] = nothing to show
export type ServerInfoStore = ServerInfoState & { setServers: (servers: ServerInfoValue[]) => void }

createServerInfoStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
serverInfoStore                // app-wide singleton
useServerInfoStore(selector)   // React binding: useStore(serverInfoStore, selector)
selectServers(s)               // the only read surface
```

Mirrors [`sessionIdStore`](session-id-store.md)'s DI-factory → singleton → hook → selector structure,
holding a list of `ServerInfoValue` rather than a bare `string | null`. `ServerInfoValue` itself stays
singular after #1148 — it is the value of one row, which is what `ServerRow`'s prop still means; the
store holds a list of these. A **single setter**, not a reducer — one mutation ("record what the loader
mapped"), so a one-member discriminated-union action set would be ceremony without benefit. `setServers`
replaces the whole list unconditionally (no merge, no append, no coercion). The **empty array is the one
absent form** — nothing paired, nothing fetched yet, and an unreadable collection all land here, and
every consumer renders the same placeholder for all three. A `ServerInfoValue[] | null` would add a
not-yet-fetched vs. fetched-and-empty distinction that no consumer reads — an unobservable
impossible-state pair, the same "ceremony without benefit" test that kept this store's mutation a setter
rather than a reducer.

### The data path (`src/renderer/src/store/serverInfoLoader.ts`)

Framework-free, effects injected (the `sessionIdBridge` idiom), so the whole path unit-tests with plain
spies:

```ts
mapServerInfo(res: ServerInfo): ServerInfoValue[]
// available → one FRESH { serverId, relayUrl } literal per entry, in the arm's own order (drops the
// `status` discriminant); unavailable, or an empty `servers`, → []. Each entry is rebuilt, not passed
// through — the renderer-side half of the handler's own field-by-field defence, since a
// structured-clone'd IPC object can carry own properties the declared type does not.

loadServerInfo(invoke: () => Promise<ServerInfo>, setServers): Promise<void>
// invoke().then(res => setServers(mapServerInfo(res))).catch(() => setServers([]))
// — the returned promise ALWAYS resolves; a rejected invoke never surfaces as an unhandled
// rejection in React.
```

### The React binding — `ServerInfoData` (same file)

A headless leaf (`ServerInfoData(): null`), the `pairingStatus()` **mount-effect** shape from
`App.tsx`, not `SessionIdData`'s subscription shape: an `active` flag guards the write so a StrictMode
double-mount nets exactly one applied write (the first mount's cleanup flips `active` false, dropping
its late-resolving write), and `window.pyry` is dereferenced only inside the effect, so it
server-renders to empty markup without a bridge mock. One-shot: no subscription, no unsubscribe handle
— cancellation is the `active` flag alone.

### Data flow

```
paired-server collection (at rest) → registerServerInfoHandler (#339/#1148) → ServerInfo union
  → window.pyry.serverInfo()  [invoked once, on ServerInfoData mount]
    → loadServerInfo → mapServerInfo → setServers → serverInfoStore   [status discriminant dropped]

<ServerInfoData /> mount (#334, inside SettingsScreen) → useServerInfoStore(selectServers) → ServerRows
```

## Configuration and usage

- **Import surface:**
  `import { ServerInfoData } from '@renderer/store/serverInfoLoader'` and
  `import { useServerInfoStore, selectServers } from '@renderer/store/serverInfoStore'`.
- **Mount point — inside the Settings tree, not `App.tsx`.** No app-level edit ([#334](../codebase/334.md)
  mounts `<ServerInfoData />` directly inside `SettingsScreen`'s section-body, not app-level) — so a
  same-session pair is reflected on next Settings-open rather than requiring a relaunch (an app-level
  launch-time fetch would race pairing and permanently cache `unavailable`).

## Edge cases and limitations

- **Fetches once per Settings-open, not once per app lifetime.** Unlike `sessionIdStore` (App-level,
  permanent subscription), this store's value can go stale if the Settings screen stays mounted across a
  disconnect/re-pair or a new pairing; a fresh fetch requires a fresh mount. This is intentional — see
  the mount-point rationale above.
- **`{ status: 'unavailable' }` and a rejected invoke are indistinguishable** in the store — both leave
  `servers: []`. Same no-sub-reason discipline as the channel itself
  ([server-info channel](server-info-channel.md)).
- **Never holds a credential.** The store and loader only ever see the two vetted non-secret fields off
  each `ServerInfoEntry` — `token` / `server_static_pubkey` are structurally absent upstream (#339/#1148).
- **Stays out of `clearPairingScopedState`.** That module names this store by name as
  self-healing via "a one-shot mount invoke" — the loader still refetches on every Settings mount and
  still replaces the whole value, so a clear here would be dead code. #1148 kept this store out of that
  module for the same reason: scoping the write to one server (the shape a per-server clear would need)
  would have retired that self-heal, the way [#1086](conversation-list-store.md) had to add a clear when
  keying `conversationListStore` by server retired its whole-array overwrite — but this store's setter
  never became per-server, so nothing here changed.

## Related

- [Server-info channel](server-info-channel.md) / [#339 codebase notes](../codebase/339.md) — the IPC
  surface this loader invokes; the union this loader maps.
- [Session-id store](session-id-store.md) / [#259 codebase notes](../codebase/259.md) — the
  DI-factory → singleton → hook → selector structural precedent; contrasting lifecycle (App-level
  permanent subscription vs. this store's mount-scoped one-shot invoke).
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — the ultimate at-rest
  source (`record.server` / `record.relay`) behind the channel this loader reads.
- [#340 codebase notes](../codebase/340.md) — implementation summary and patterns established.
- [Settings screen](settings-screen.md) / [#334 codebase notes](../codebase/334.md) — mounts
  `<ServerInfoData />` and renders the Server row that reads this store.
- [Settings screen](settings-screen.md) —
  [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) widened this store from one value to
  a list and renders one Server row per entry via the new `ServerRows` view · Spec:
  `docs/specs/architecture/1148-settings-lists-every-paired-server.md`.
