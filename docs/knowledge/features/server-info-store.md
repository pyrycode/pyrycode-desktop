# Server-info store

The renderer's held copy of the paired server's **non-secret identity** — `serverId` + `relayUrl` — a
dedicated, unidirectional Zustand store fed by a one-shot fetch of the [server-info
channel](server-info-channel.md), so a Settings screen can render which server the user is paired with,
**including while disconnected**.

Introduced in [#340](../codebase/340.md), the renderer-side half of the #339/#340/#333/#334 split
(parent [#332](../codebase/332.md)). Shipped **dormant** in #340 — no consumer mounted the loader in
that ticket. [#334](../codebase/334.md) mounts `<ServerInfoData />` inside the paired-only [Settings
tree](settings-screen.md), alongside the store-bound Server row that reads what it writes.

## What it does

Retains the paired server's `serverId` + `relayUrl` in a read-only store, populated by exactly one
`window.pyry.serverInfo()` invoke per mount. Unlike [session-id store](session-id-store.md)'s
`sessionTransition` subscription, there is no daemon event behind this value — the main-process source
is the disconnected-safe at-rest [paired-server record](paired-server-store.md), so a **one-shot
invoke**, not a subscription, is the correct shape (the `App.tsx` `pairingStatus()` mount-effect idiom,
not the `sessionIdBridge` `onDaemonEvent` idiom).

## How it works

### The store (`src/renderer/src/store/serverInfoStore.ts`)

```ts
export interface ServerInfoValue { serverId: string; relayUrl: string }
export interface ServerInfoState { serverInfo: ServerInfoValue | null }   // null = no server info yet
export type ServerInfoStore = ServerInfoState & { setServerInfo: (info: ServerInfoValue | null) => void }

createServerInfoStore(init?)   // vanilla createStore — one isolated instance per test (DI seam)
serverInfoStore                // app-wide singleton
useServerInfoStore(selector)   // React binding: useStore(serverInfoStore, selector)
selectServerInfo(s)            // the only read surface
```

Mirrors [`sessionIdStore`](session-id-store.md)'s DI-factory → singleton → hook → selector structure,
swapping the bare `string | null` for an object-or-null pair. A **single setter**, not a reducer — one
mutation ("record what the loader mapped"), so a one-member discriminated-union action set would be
ceremony without benefit. `setServerInfo` replaces the whole value unconditionally (no merge, no
coercion); `serverInfo: null` is the absence-distinct "no server info yet" state, held until the loader
maps a present arm.

### The data path (`src/renderer/src/store/serverInfoLoader.ts`)

Framework-free, effects injected (the `sessionIdBridge` idiom), so the whole path unit-tests with plain
spies:

```ts
mapServerInfo(res: ServerInfo): ServerInfoValue | null
// available → a FRESH { serverId, relayUrl } literal (reconstructed, not passed through — drops the
// `status` discriminant); unavailable → null. Never a partial: both fields come off the same arm.

loadServerInfo(invoke: () => Promise<ServerInfo>, setServerInfo): Promise<void>
// invoke().then(res => setServerInfo(mapServerInfo(res))).catch(() => setServerInfo(null))
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
paired-server record (at rest) → registerServerInfoHandler (#339) → ServerInfo union
  → window.pyry.serverInfo()  [invoked once, on ServerInfoData mount]
    → loadServerInfo → mapServerInfo → setServerInfo → serverInfoStore   [status discriminant dropped]

<ServerInfoData /> mount (#334, inside SettingsScreen) → useServerInfoStore(selectServerInfo) → Server row
```

## Configuration and usage

- **Import surface:**
  `import { ServerInfoData } from '@renderer/store/serverInfoLoader'` and
  `import { useServerInfoStore, selectServerInfo } from '@renderer/store/serverInfoStore'`.
- **Mount point — inside the Settings tree, not `App.tsx`.** No app-level edit ([#334](../codebase/334.md)
  mounts `<ServerInfoData />` directly inside `SettingsScreen`'s section-body, not app-level) — so a
  same-session pair is reflected on next Settings-open rather than requiring a relaunch (an app-level
  launch-time fetch would race pairing and permanently cache `unavailable`).

## Edge cases and limitations

- **Fetches once per Settings-open, not once per app lifetime.** Unlike `sessionIdStore` (App-level,
  permanent subscription), this store's value can go stale if the Settings screen stays mounted across a
  disconnect/re-pair; a fresh fetch requires a fresh mount. This is intentional — see the mount-point
  rationale above.
- **`{ status: 'unavailable' }` and a rejected invoke are indistinguishable** in the store — both leave
  `serverInfo: null`. Same no-sub-reason discipline as the channel itself
  ([server-info channel](server-info-channel.md)).
- **Never holds a credential.** The store and loader only ever see the two vetted non-secret fields off
  the `ServerInfo` union — `token` / `server_static_pubkey` are structurally absent upstream (#339).

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
