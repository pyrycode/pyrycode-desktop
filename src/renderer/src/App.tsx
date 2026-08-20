import { useEffect, useState } from 'react'
import { PairedShell } from './PairedShell'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { useDaemonEventBridge } from './store/daemonEventBridge'
import { useTimelineBridge } from './store/timelineBridge'
import { useModalBridge } from './store/modalBridge'
import { ConversationListData } from './store/conversationListBridge'
import { SessionIdData } from './store/sessionIdBridge'
import { RunSettingsWriteData } from './store/runSettingsWriteBridge'
import { QueueData } from './store/queueBridge'
import { ScreenSnapshotData } from './store/screenSnapshotBridge'
import { RelayLinkData } from './store/relayLinkBridge'
import { BackgroundTaskRosterData } from './store/backgroundTaskRosterBridge'
import { AnnouncedModelData } from './store/announcedModelBridge'
import { routeForStatus, type AppRoute } from './appRoute'

/** Compile-time exhaustiveness guard: a new AppRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled app route: ${JSON.stringify(route)}`)
}

/**
 * The pure route→screen view — no hooks, no effects — mirroring how PairingView lives beside
 * PairingScreen. `pending` renders neither screen (AC3). The pairing branch deliberately does NOT
 * pass `onCancel`: when unpaired the pairing screen is the app root, so cancel's correct app-shell
 * behavior is "stay put", which is exactly the absence of a navigating handler (AC5). Wiring a
 * navigating onCancel would risk exposing the conversation screen before pairing.
 */
export function AppView(props: {
  route: AppRoute
  onPaired: () => void
  onUnpaired: () => void
}): JSX.Element | null {
  switch (props.route) {
    case 'pending':
      return null
    case 'pairing':
      return <PairingScreen onPaired={props.onPaired} />
    case 'conversation':
      // #140: the conversation route now mounts the inner list ⇄ thread shell (PairedShell) rather
      // than dropping straight into a single ConversationScreen. onUnpaired threads through unchanged.
      return <PairedShell onUnpaired={props.onUnpaired} />
    default:
      return assertNever(props.route)
  }
}

/**
 * The app-shell router container. Owns the ephemeral route-selection state (ADR 0006: screen-local
 * ephemeral state → useState, not the store) and the one-shot launch query that picks the initial
 * screen from #79's pairing-status signal. The daemon-event bridge stays app-level and unconditional
 * — one stable app-lifetime listener with no subscribe/unsubscribe churn as the route flips.
 */
function App(): JSX.Element {
  useDaemonEventBridge()
  // #203: the timeline bridge is useDaemonEventBridge's twin — a second independent subscriber on the
  // one daemon-event channel (#202), folding the v2 structured stream into timelineStore. App-lifetime
  // and unconditional, matching the coarse bridge; both deref window.pyry only inside their effect, so
  // the <App/> server-render test stays ''. Inert until #179 flips `interactive` (no stream arrives).
  useTimelineBridge()
  // #224: the modal bridge is the third independent subscriber on the one daemon-event channel (#202),
  // folding the two modal arms into modalStore so the outstanding permission/trust prompt becomes live
  // renderer state. App-lifetime and unconditional like its twins; it derefs window.pyry only inside its
  // effect, so the <App/> server-render test stays ''. Inert until #179 flips `interactive`.
  useModalBridge()
  const [route, setRoute] = useState<AppRoute>('pending')

  useEffect(() => {
    // One mount-time read. Fail-safe in both directions: routeForStatus sends every non-paired
    // outcome to the pairing screen, and a rejected invoke (handler absent — should not happen per
    // #79) also lands on pairing, never the conversation screen. The `active` flag makes the
    // StrictMode double-mount net exactly one applied setRoute.
    let active = true
    window.pyry
      .pairingStatus()
      .then((status) => {
        if (active) setRoute(routeForStatus(status))
      })
      .catch(() => {
        if (active) setRoute('pairing')
      })
    return () => {
      active = false
    }
  }, [])

  // onPaired flips the route to conversation on a successful confirm; onUnpaired is its exact reverse
  // (#166) — a successful unpair flips back to pairing in-place, no restart. Both unmount one screen
  // and mount the other with no restart. The unpair path clears the stored pairing BEFORE this flip
  // (in runUnpair), so the launch-status invariant "conversation only when paired" still holds if the
  // user relaunches immediately after.
  // ConversationListData is a headless leaf mounted app-level alongside the daemon-event bridge: it
  // keeps the conversation-list store live for #141 regardless of the current route. A component (not
  // a hook here) deliberately isolates its connected-gate `useSessionStore` read, so status flips
  // re-render the leaf, not App (whose inline onPaired/onUnpaired arrows would otherwise cascade a
  // re-render into ConversationScreen). It renders null, so the neutral-paint invariant holds.
  // SessionIdData (#259) is a sibling headless leaf: it retains the current daemon session_id from
  // the always-arriving `sessionTransition` marker for #257, on the same App-level always-listening
  // rationale. Reactive-only (no request half), so it has no connected-gate read at all.
  // RunSettingsWriteData (#256) is a third sibling headless leaf: it folds the correlated
  // sessionSettingsUpdated / sessionSettingsRejected replies into the write store, on the same
  // App-level always-listening rationale — a confirm/reject reply can arrive after the Run config
  // sheet (#257) closes, so the listener must outlive the sheet.
  // QueueData (#293) is a fourth sibling headless leaf: it lands each unsolicited `queueState`
  // snapshot into the keyed queue store for the render slice (#294), on the same App-level
  // always-listening rationale — a snapshot can arrive before #294 is ever mounted, and (per daemon
  // #878/#879) several for different conversations can arrive back-to-back. Reactive-only, no gate.
  // ScreenSnapshotData (#323) is a fifth sibling headless leaf: it lands each unsolicited
  // `screenSnapshotReceived` marker into the screen-snapshot store for the display slice (#324), on the
  // same App-level always-listening rationale — a snapshot can arrive before #324 is ever mounted, so
  // the latest rendered screen must be retained regardless of which screen is shown. Reactive-only, no
  // gate. Ships dormant — it populates the store, but nothing renders it yet (#324).
  // BackgroundTaskRosterData (#573) is the SEVENTH headless leaf (count the JSX below, not these
  // comments — RelayLinkData landed without one): it lands each unsolicited `backgroundTaskRoster`
  // snapshot into the keyed roster store for the panel slice (#568), on the same App-level
  // always-listening rationale — a roster can arrive before #568 is ever mounted and for a
  // conversation the user is not looking at. Reactive-only, no gate. Ships dormant. Its `connected`
  // branch is the sole enforcement of AC5 (no previous pairing's tasks survive a re-handshake), which
  // is why this store is deliberately absent from clearPairingScopedState.
  // AnnouncedModelData (#588) is the EIGHTH headless leaf: it lands each unsolicited `modelAnnounced`
  // announcement into the announced-model store for the run-configuration sheet (#560), on the same
  // App-level always-listening rationale — the announcement rides the turn's init line, so it can
  // arrive long before that sheet is ever opened. Reactive-only, no gate. Ships dormant. Unlike its
  // roster neighbour above it has no `connected` branch, BECAUSE the announcement survives a
  // re-handshake to the same daemon — it still describes that daemon. Its store is pairing-scoped and
  // the pairing-change clear is clearPairingScopedState's (#593), not this leaf's.
  return (
    <>
      <ConversationListData />
      <SessionIdData />
      <RunSettingsWriteData />
      <QueueData />
      <ScreenSnapshotData />
      <RelayLinkData />
      <BackgroundTaskRosterData />
      <AnnouncedModelData />
      <AppView
        route={route}
        onPaired={() => setRoute('conversation')}
        onUnpaired={() => setRoute('pairing')}
      />
    </>
  )
}

export default App
