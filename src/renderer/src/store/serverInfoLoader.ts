// The renderer data path feeding the server-info store: a ONE-SHOT invoke, not a subscription. There
// is no daemon event behind this value (unlike sessionIdBridge, which observes an unsolicited
// `sessionTransition` marker) — the renderer fetches the paired server's non-secret identity once, on
// demand, via `window.pyry.serverInfo()`, exactly as App.tsx fetches the launch pairing status via
// `window.pyry.pairingStatus()`. The pure map + the React-free loader are injected and unit-testable
// with plain spies; `ServerInfoData` is the thin React glue over them. Nothing here touches keys,
// sockets, ipcRenderer, or raw frames — it only invokes the preload bridge and lands two vetted
// non-secret fields (#339 did the sourcing and credential-stripping main-side), never a secret.
import { useEffect } from 'react'
import type { ServerInfo } from '@shared/ipc/serverInfo'
import { serverInfoStore, type ServerInfoValue } from './serverInfoStore'

/**
 * The pure collapse of the bridge's discriminated `ServerInfo` union into the store shape — the
 * translateSessionTransition analog, React-free so it's unit-testable without a DOM. `available` →
 * a FRESH `{ serverId, relayUrl }` literal (reconstructed, NOT passed through, so the `status`
 * discriminant is dropped and the store never holds it, AC2); `unavailable` → `null` (AC3). It never
 * returns a partial: both fields come off the same present arm, or neither is written.
 */
export function mapServerInfo(res: ServerInfo): ServerInfoValue | null {
  return res.status === 'available'
    ? { serverId: res.serverId, relayUrl: res.relayUrl }
    : null
}

/**
 * The injected, React-free load surface AC5 exercises with a fake `invoke`. It maps the resolved union
 * through `mapServerInfo` and writes it via `setServerInfo`; a `{ status: 'unavailable' }` maps to
 * `null`, and a rejected `invoke` (handler absent — should not happen) is caught and also writes
 * `null`. The returned promise ALWAYS resolves — it never rejects into the caller (AC3, "never throws
 * into the renderer"), so a late-arriving handler failure can never surface as an unhandled rejection
 * in React. Assumes `invoke` returns a Promise and does not throw synchronously (the
 * `ipcRenderer.invoke` contract).
 */
export function loadServerInfo(
  invoke: () => Promise<ServerInfo>,
  setServerInfo: (info: ServerInfoValue | null) => void
): Promise<void> {
  return invoke()
    .then((res) => setServerInfo(mapServerInfo(res)))
    .catch(() => setServerInfo(null))
}

/**
 * The server-info data-path binding — a headless leaf (renders null) mounted by the paired-only
 * Settings tree (#333/#334), NOT app-level: an app-level one-shot-at-launch would run before pairing
 * (→ unavailable → null) and never re-run, leaving Settings blank after a same-session pair. Mounting
 * when the Settings screen opens fetches a fresh, correct read every time. Ships DORMANT here — no
 * consumer mounts it in this ticket (the modalBridge / screenSnapshotBridge precedent).
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
    void loadServerInfo(window.pyry.serverInfo, (info) => {
      if (active) serverInfoStore.getState().setServerInfo(info)
    })
    return () => {
      active = false
    }
  }, [])

  return null
}
