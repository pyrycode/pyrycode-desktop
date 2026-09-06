// The renderer data path feeding the server-info store: a ONE-SHOT invoke, not a subscription. There
// is no daemon event behind this value (unlike sessionIdBridge, which observes an unsolicited
// `sessionTransition` marker) — the renderer fetches every paired server's non-secret identity once, on
// demand, via `window.pyry.serverInfo()`, exactly as App.tsx fetches the launch pairing status via
// `window.pyry.pairingStatus()`. The pure map + the React-free loader are injected and unit-testable
// with plain spies; `ServerInfoData` is the thin React glue over them. Nothing here touches keys,
// sockets, ipcRenderer, or raw frames — it only invokes the preload bridge and lands two vetted
// non-secret fields PER PAIRED SERVER (#339 did the sourcing and credential-stripping main-side, and
// #1148 widened it to the collection), never a secret.
import { useEffect } from 'react'
import type { ServerInfo } from '@shared/ipc/serverInfo'
import { serverInfoStore, type ServerInfoValue } from './serverInfoStore'

/**
 * The pure collapse of the bridge's discriminated `ServerInfo` union into the store shape — the
 * translateSessionTransition analog, React-free so it's unit-testable without a DOM. `available` → one
 * FRESH `{ serverId, relayUrl }` literal per entry, in the arm's own order (oldest-paired first, no
 * re-sort); `unavailable` → `[]` (AC3), which an empty `servers` also maps to, so the arm's non-empty
 * invariant is never depended upon.
 *
 * Each entry is REBUILT, not passed through. That is the renderer-side half of the same field-by-field
 * defence the handler applies main-side: a structured-clone'd IPC object can carry own properties the
 * declared type does not, so nothing that crossed the bridge is retained by reference and only the two
 * vetted fields survive into the store. It never returns a partial entry — both fields come off the
 * same entry, or none is written.
 */
export function mapServerInfo(res: ServerInfo): ServerInfoValue[] {
  return res.status === 'available'
    ? res.servers.map((entry) => ({ serverId: entry.serverId, relayUrl: entry.relayUrl }))
    : []
}

/**
 * The injected, React-free load surface AC5 exercises with a fake `invoke`. It maps the resolved union
 * through `mapServerInfo` and writes it via `setServers`; a `{ status: 'unavailable' }` maps to `[]`,
 * and a rejected `invoke` (handler absent — should not happen) is caught and also writes `[]`. The
 * returned promise ALWAYS resolves — it never rejects into the caller ("never throws into the
 * renderer"), so a late-arriving handler failure can never surface as an unhandled rejection in React.
 * Assumes `invoke` returns a Promise and does not throw synchronously (the `ipcRenderer.invoke`
 * contract).
 */
export function loadServerInfo(
  invoke: () => Promise<ServerInfo>,
  setServers: (servers: ServerInfoValue[]) => void
): Promise<void> {
  return invoke()
    .then((res) => setServers(mapServerInfo(res)))
    .catch(() => setServers([]))
}

/**
 * The server-info data-path binding — a headless leaf (renders null) mounted by the paired-only
 * Settings tree (#333/#334), NOT app-level: an app-level one-shot-at-launch would run before pairing
 * (→ unavailable → null) and never re-run, leaving Settings blank after a same-session pair. Mounting
 * when the Settings screen opens fetches a fresh, correct read every time. Ships DORMANT here — no
 * consumer mounts it in this ticket (the modalBridge precedent).
 *
 * The effect reuses the App.tsx `pairingStatus` one-shot shape: an `active` flag guards the write so a
 * StrictMode double-mount nets exactly one applied write (the first mount's cleanup flips `active`
 * false, dropping its late-resolving write), and `window.pyry` is dereferenced only inside the effect,
 * so it server-renders to '' without a bridge mock. One-shot invoke: no subscription, no unsubscribe
 * handle — cancellation is the `active` flag alone.
 */
export function ServerInfoData(): null {
  useEffect(() => {
    let active = true
    void loadServerInfo(window.pyry.serverInfo, (servers) => {
      if (active) serverInfoStore.getState().setServers(servers)
    })
    return () => {
      active = false
    }
  }, [])

  return null
}
