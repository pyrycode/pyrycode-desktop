import { useEffect, useRef } from 'react'
import { requestRunConfigSnapshot } from './runConfigSnapshot'

// The Run configuration sheet's data-path binding (#187) — a headless container mounted inside the
// open-only sheet body (`{sheetOpen && <StatusSheet>…}`), so it mounts on open and unmounts on close.
// It renders nothing (no visible surface; #188 renders the held values). `window.pyry` is dereferenced
// only inside the effect, never during render (the Composer.handleSubmit / LogDataSection discipline),
// so it server-renders without a bridge mock.
//
// #810 moved the SUBSCRIPTION out to `RunConfigLiveData`, the app-level leaf in App.tsx, and left the
// REQUEST here. Split by lifetime: the reply must be landed whether or not this sheet is open (the usage
// figures have to be current before the first open and after a close), while the on-open read is exactly
// what this container's mount means. One listener app-wide is the honest shape — while the sheet was
// open, a second subscriber here would write identical values into both stores on every reply, including
// a duplicated write into the session-id store whose two-ingress contract exists because arrival order
// matters. The request effect below is unchanged, so opening the sheet still populates it exactly as
// before.

export function RunConfigData(): null {
  // AC2 one-shot guard: the request effect has no symmetric "un-request" cleanup, so a ref flag
  // makes the StrictMode dev double-invoke fire the request exactly once. A genuine close→reopen is a
  // new component instance with a fresh ref (false), so it re-requests — exactly one per open.
  const requested = useRef(false)

  useEffect(() => {
    // Request once per open. Guarded so the StrictMode double-invoke fires exactly one request.
    //
    // #491 dropped the active-conversation dependency: the request is bare and its reply is
    // daemon-wide, so there is no id to resolve first. That also removes the old failure shape
    // where a sheet opened before the active conversation resolved would fire nothing at all.
    //
    // No "subscribe first" ordering to preserve any more: the app-level listener (#810) has been live
    // since App mounted, so it is already listening when this request goes out.
    if (requested.current) return
    requested.current = true
    requestRunConfigSnapshot(window.pyry.sendCommand)
  }, [])

  return null
}
