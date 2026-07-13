# #340 — Server-info renderer store + one-shot loader

## Files to read first

- `src/renderer/src/store/sessionIdStore.ts:19-59` — the DI-factory → singleton → hook → selector store idiom. Mirror it exactly, swapping the bare `string | null` for an object-or-null `{ serverId, relayUrl } | null`. Copy the single-setter rationale (one mutation, no reducer) and the read-only-selector shape.
- `src/renderer/src/store/sessionIdStore.test.ts:1-64` — the plain-function store-test idiom: isolated `createX()` instances, no React, no bridge. Your `serverInfoStore.test.ts` mirrors this file structure.
- `src/renderer/src/store/sessionIdBridge.ts:52-73` — `SessionIdData`, the headless-leaf component shape: `useEffect` on mount, renders `null`, dereferences `window.pyry` only inside the effect. Your `ServerInfoData` follows this shape, but wraps a **one-shot invoke** instead of a subscription.
- `src/renderer/src/store/sessionIdBridge.test.ts:57-185` — the injected-fake-bridge test idiom (fake `invoke`/spy, no Electron) and the `renderToStaticMarkup` server-render-empty test for the headless leaf.
- `src/renderer/src/App.tsx:66-83` — **the one-shot invoke idiom.** The `pairingStatus()` mount `useEffect`: the `active` flag that nets exactly one applied write under StrictMode's double-mount, plus the `.then(...).catch(...)` fail-safe. This is the exact effect shape the loader reuses — NOT a subscription bridge.
- `src/shared/ipc/serverInfo.ts:29-50` — `SERVER_INFO_CHANNEL` and the sealed `ServerInfo` union (the loader's input type). Present arm carries **only** `serverId` + `relayUrl`; credentials are structurally absent. The loader must not persist the `status` discriminant.
- `src/preload/index.ts:82-90` — `window.pyry.serverInfo(): Promise<ServerInfo>`, the bridge method the loader invokes with zero arguments.
- `electron.vite.config.ts:16` — confirms the `@shared` alias resolves in the renderer, so import the union via `@shared/ipc/serverInfo` (the `sessionIdBridge` import idiom).

## Context

The paired server's non-secret identity (`serverId`, `relayUrl`) already crosses the IPC bridge on the one-shot channel shipped by the merged blocker #339 (`window.pyry.serverInfo(): Promise<ServerInfo>`). The main handler sources both fields from the disconnected-safe at-rest paired-server record and strips credentials, so this value is available whether or not a live connection exists.

This slice adds the **renderer-side half**: a store holding `{ serverId, relayUrl } | null`, a hook + read-only selector, and a one-shot loader that fetches once via the bridge and maps the response union into the store. **No screen is built here.** The Settings scaffold + navigation (#333) and the visible server-info row (#334) are separate tickets that mount the loader and read the store.

## Design

Two new production files under `src/renderer/src/store/`, mirroring the `sessionIdStore` / `sessionIdBridge` pair — but the loader is a **one-shot invoke, not an event bridge** (there is no daemon event behind this value).

### Store — `serverInfoStore.ts`

Mirror `sessionIdStore.ts` structure. Contract sketch (signatures, not bodies):

```ts
export interface ServerInfoValue { serverId: string; relayUrl: string }
export interface ServerInfoState { serverInfo: ServerInfoValue | null }
export type ServerInfoStore = ServerInfoState & {
  setServerInfo: (info: ServerInfoValue | null) => void
}
export const initialServerInfoState: ServerInfoState = { serverInfo: null }
export function createServerInfoStore(init?: ServerInfoState): /* StoreApi<ServerInfoStore> */
export const serverInfoStore /* = createServerInfoStore() singleton */
export function useServerInfoStore<T>(selector: (s: ServerInfoStore) => T): T
export const selectServerInfo: (s: ServerInfoState) => ServerInfoValue | null
```

- `serverInfo: null` is the absence-distinct "no server info yet" state (AC1), analogous to `sessionIdStore`'s `sessionId: null`, and distinguishable from a present `{ serverId, relayUrl }`.
- **One setter, `setServerInfo`.** It records the loader's mapped result — a present pair or the absence-`null` — replacing the whole value unconditionally (no merge, no coercion), exactly as `setSessionId` replaces the whole string. Semantics: "record what the loader mapped." A one-member discriminated-union action set would be ceremony without benefit (the `sessionIdStore` rationale).
- Read-only `selectServerInfo` returns the held pair or `null`. Narrow-slice `useServerInfoStore` avoids cross-facet re-renders.

### Loader — `serverInfoLoader.ts`

A pure map + a React-free loader + the headless-leaf React glue. Contract sketch:

```ts
export function mapServerInfo(res: ServerInfo): ServerInfoValue | null
// available → { serverId: res.serverId, relayUrl: res.relayUrl } (fresh literal); unavailable → null.
// Drops the `status` discriminant; never returns a partial.

export function loadServerInfo(
  invoke: () => Promise<ServerInfo>,
  setServerInfo: (info: ServerInfoValue | null) => void
): Promise<void>
// invoke().then(res => setServerInfo(mapServerInfo(res))).catch(() => setServerInfo(null))

export function ServerInfoData(): null
// One-shot useEffect: `active` flag + loadServerInfo(window.pyry.serverInfo, active-guarded setServerInfo)
```

- **`mapServerInfo`** is the `translateSessionTransition` analog: a pure, React-free collapse of the union to the store shape. Available → a fresh `{ serverId, relayUrl }` literal; unavailable → `null`. It reconstructs the pair as a fresh literal (drops `status`) so the store never holds the discriminant (AC2).
- **`loadServerInfo`** is the injected, React-free surface AC5 exercises with a fake `invoke`. It maps the resolved union through `mapServerInfo` and writes it via `setServerInfo`; on a rejected invoke it writes `null`. Its returned promise always resolves — it never rejects into the caller (AC3, "never throws into the renderer"). It assumes `invoke` returns a Promise and does not throw synchronously (the `ipcRenderer.invoke` contract).
- **`ServerInfoData`** is the thin React glue — a headless leaf that renders `null`, mirroring `SessionIdData`. Its effect reuses the `App.tsx` `pairingStatus` one-shot shape: an `active` flag guards the write so a StrictMode double-mount nets exactly one applied write, and `window.pyry` is dereferenced only inside the effect (so it server-renders to `''` without a bridge mock). The `active`-guarded setter closure is what `loadServerInfo` calls; on unmount `active = false` drops any late-resolving write.

### Mount point — ships dormant (deferred to #333/#334)

`ServerInfoData` is **not wired into `App.tsx` in this ticket** — it ships dormant, the way `modalBridge` / `screenSnapshotBridge` shipped dormant before their consumers. #333 (Settings scaffold, paired-only mount) or #334 (visible row) mounts `<ServerInfoData />` inside the Settings tree.

Rationale — do NOT mount it app-level:
- The value only matters for the Settings screen, which is paired-only.
- An app-level one-shot-at-launch has a **freshly-paired-in-session gap**: the fetch would run before pairing (→ `unavailable` → `null`) and never re-run until relaunch, leaving Settings blank after a same-session pair. Mounting when the paired-only Settings screen opens fetches a fresh, correct read every time.
- Keeping this ticket free of any `App.tsx` edit makes it purely additive (no merge-overlap surface) and matches the confirmed clean overlap check.

## State + concurrency model

- **Single source of state.** One `serverInfoStore` singleton holds `{ serverInfo }`. No parallel mutable state elsewhere.
- **Unidirectional (AC4).** Exactly one write path — `setServerInfo` — invoked only by `ServerInfoData`'s effect (through the `active`-guarded closure). The read surface is `selectServerInfo` / `useServerInfoStore`. No component two-way-binds into the store.
- **One-shot, not a subscription.** A single `invoke` on mount; no `onDaemonEvent` listener, no connected-edge trigger, no unsubscribe handle. Cancellation is the `active` flag flipped in the effect cleanup — a late-resolving promise after unmount applies no write.
- **StrictMode.** Double-mount → the first mount's cleanup sets `active = false`, so only the second mount's applied write survives (the `App.tsx` idiom).

## Error handling

The store only ever receives the two vetted non-secret fields off the union — it never touches the token, server key, keychain, or filesystem (which is why this slice carries no `security-sensitive` label; #339's handler did the sourcing and credential-stripping).

| Failure mode | Loader behavior | Store outcome |
|---|---|---|
| `{ status: 'unavailable' }` (not paired / unreadable record — collapsed main-side) | `mapServerInfo` → `null`; `setServerInfo(null)` | stays `null` (AC3) |
| Rejected `invoke` (handler absent — should not happen) | `.catch` → `setServerInfo(null)`; returned promise resolves | stays `null`, never throws into React (AC3) |
| `{ status: 'available', serverId, relayUrl }` | `mapServerInfo` → fresh `{ serverId, relayUrl }`; `setServerInfo(pair)` | present pair, never partial, no `status` (AC1/AC2) |

The loader never writes a partial value (both fields come from the same present arm or neither is written) and never stores the `status` discriminant. There is no UI surfacing in this ticket — absence is simply the store's `null`, which #334 renders.

## Testing strategy

`npm test` (vitest), no Electron / IPC / keychain / filesystem (AC5). Type coverage via `npm run typecheck`.

**`serverInfoStore.test.ts`** — plain-function tests over isolated `createServerInfoStore()` instances (the `sessionIdStore.test` idiom):
- starts absent — `serverInfo` is `null` (AC1); `selectServerInfo` returns `null`.
- `setServerInfo({ serverId, relayUrl })` records the pair; selector returns it, distinct from `null` (AC1).
- `setServerInfo(null)` clears back to `null` (the map-to-null path).
- a later `setServerInfo` replaces the whole value (no merge).
- holds `serverId` / `relayUrl` verbatim, including empty strings, as a present pair distinct from `null` (present-vs-absent distinctness).
- two stores stay independent (DI); starts from an injected initial state (DI).
- `initialServerInfoState` equals `{ serverInfo: null }`.
- `setServerInfo` reference stays stable across updates.

**`serverInfoLoader.test.ts`** — pure-map tests + injected-fake-bridge tests (the `sessionIdBridge.test` idiom):
- `mapServerInfo(available)` → `{ serverId, relayUrl }`; assert the result has **no** `status` property (`not.toHaveProperty('status')`) (AC2).
- `mapServerInfo(unavailable)` → `null` (AC3).
- `loadServerInfo` with a fake `invoke` resolving `available` → setter called once with `{ serverId, relayUrl }`; assert both fields present (never partial) (AC2/AC5).
- `loadServerInfo` with a fake `invoke` resolving `unavailable` → setter called once with `null` (AC3).
- `loadServerInfo` with a fake `invoke` that **rejects** → setter called once with `null`, and the returned promise resolves (does not reject into the caller) (AC3).
- seam: `loadServerInfo` drives a real `createServerInfoStore()` from `null` → the pair, via fake `invoke` + the real `setServerInfo` (AC5).
- `ServerInfoData` server-renders to empty markup without touching `window.pyry` (`renderToStaticMarkup`, the `SessionIdData.test` idiom).
- The effect's `active`-flag / one-applied-write-under-StrictMode / one-shot-invoke timing is verified **by inspection** against the `App.tsx` `pairingStatus` idiom, not unit-tested (the `SessionIdData` effect-timing precedent) — the behavioral coverage lives on `loadServerInfo`.

## Design source

N/A — headless renderer state with no on-screen surface of its own (`ServerInfoData` renders `null`); the visible Settings server-info row is #334. Per the ticket body, no Figma reference applies; the visual-fidelity check is intentionally skipped for this slice.

## Open questions

- **Loader mount owner: #333 vs #334.** This spec ships `ServerInfoData` dormant and leaves the `<ServerInfoData />` mount to the Settings-owning ticket. Whether the scaffold (#333) or the visible row (#334) mounts it is that ticket's call; either mounts it inside the paired-only Settings tree so it fetches fresh on open. No action needed here.
