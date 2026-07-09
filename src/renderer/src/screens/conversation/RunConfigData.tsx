import { useEffect, useRef } from 'react'
import { runConfigStore } from '../../store/runConfigStore'
import { requestRunConfigSnapshot, subscribeRunConfig } from './runConfigSnapshot'

// The Run configuration sheet's data-path binding (#187) — a headless container mounted inside the
// open-only sheet body (`{sheetOpen && <StatusSheet>…}`), so it mounts on open and unmounts on close.
// It owns the two lifecycle effects and renders nothing (no visible surface; #188 renders the held
// values). `window.pyry` is dereferenced only inside effects, never during render (the
// Composer.handleSubmit / LogDataSection discipline), so it server-renders without a bridge mock.

export function RunConfigData(): null {
  // AC2 one-shot guard: the request effect has no symmetric "un-request" cleanup, so a ref flag
  // makes the StrictMode dev double-invoke fire the request exactly once. A genuine close→reopen is a
  // new component instance with a fresh ref (false), so it re-requests — exactly one per open.
  const requested = useRef(false)

  useEffect(() => {
    // Subscribe first (declared before the request effect, so it runs first on mount): the listener
    // is live before the request goes out. The returned off handle is the effect cleanup, so a
    // StrictMode double-mount nets exactly one live listener (the daemonEventBridge idiom). Each
    // snapshotReceived writes verbatim into the app-singleton store via its single setter.
    return subscribeRunConfig(window.pyry.onDaemonEvent, (snapshot) =>
      runConfigStore.getState().setSnapshot(snapshot)
    )
  }, [])

  useEffect(() => {
    // Request once per open. Guarded so the StrictMode double-invoke fires exactly one request (AC2).
    if (requested.current) return
    requested.current = true
    requestRunConfigSnapshot(window.pyry.sendCommand)
  }, [])

  return null
}
