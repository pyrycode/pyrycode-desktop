import { useEffect, useRef } from 'react'
import { connectedConversationHostNow } from './conversationActionAvailability'
import { activeConversationStore } from '../../store/activeConversationStore'
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
    // #946 restored the active-conversation dependency #491 had dropped, because the daemon stopped
    // answering an unnamed request with anything but zeroes on 2026-08-20. The store is read
    // NON-REACTIVELY, through `getState()` at call time (the idiom runConfigLive.ts already uses for
    // its sibling stores inside callbacks): this leaf subscribes to nothing, so a conversation switch
    // never re-renders it and the render body stays free of store reads. Reading at call time is also
    // what makes the id correct — this effect runs on the sheet's own mount, which happens after
    // `activateConversation` has recorded the conversation the sheet is about to describe.
    //
    // No sheet-opened-too-early failure returns with it: `requestRunConfigSnapshot` sends nothing
    // when nothing is addressable, rather than sending a request that would wipe the held snapshot.
    //
    // No "subscribe first" ordering to preserve any more: the app-level listener (#810) has been live
    // since App mounted, so it is already listening when this request goes out.
    if (requested.current) return
    if (connectedConversationHostNow(activeConversationStore.getState().activeConversation?.id ?? null) === null) return
    requested.current = true
    requestRunConfigSnapshot(
      window.pyry.sendCommand,
      activeConversationStore.getState().activeConversation?.id ?? null
    )
  }, [])

  return null
}
