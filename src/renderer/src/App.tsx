import { useEffect, useState } from 'react'
import { PairedShell } from './PairedShell'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { WelcomeScreen } from './screens/welcome/WelcomeScreen'
import { useDaemonEventBridge } from './store/daemonEventBridge'
import { useTimelineBridge } from './store/timelineBridge'
import { useModalBridge } from './store/modalBridge'
import { ConversationListData } from './store/conversationListBridge'
import { SessionIdData } from './store/sessionIdBridge'
import { RunSettingsWriteData } from './store/runSettingsWriteBridge'
import { QueueData } from './store/queueBridge'
import { RelayLinkData } from './store/relayLinkBridge'
import { BackgroundTaskRosterData } from './store/backgroundTaskRosterBridge'
import { AnnouncedModelData } from './store/announcedModelBridge'
import { ConversationActivityData } from './store/conversationActivityBridge'
import { activeConversationStore, selectActiveConversation } from './store/activeConversationStore'
import { routeForStatus, type AppRoute } from './appRoute'

/** Compile-time exhaustiveness guard: a new AppRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled app route: ${JSON.stringify(route)}`)
}

/**
 * The conversation on screen, for the two timeline arms that carry no id of their own (#785). Read
 * through `getState()` at DISPATCH time and never captured: one app-lifetime listener outlives any
 * number of chat switches, so a value read once at subscribe time would file a session boundary into a
 * conversation the operator has already left.
 *
 * MODULE-LEVEL, not an inline arrow at the call site: it is the bridge effect's only dependency, so a
 * fresh identity per render would resubscribe the daemon-event listener on every `App` render. Stable
 * identity keeps exactly one subscribe for the app's lifetime, matching today.
 *
 * Written as an explicit `null` test rather than `open?.id ?? null`, which compiles identically: the
 * explicit form is what makes "no `??` anywhere on this path" literally true end to end, including here.
 * It also keeps an empty-string id an ordinary key instead of collapsing it into "nothing open" the way
 * a truthiness test would.
 *
 * This is NOT the `?? activeConversation` fallback `events.ts:115-117` bans. That ban is about an arm
 * that HAS a routing key being made optional so a consumer can paper over a missing one. These two arms
 * carry no key on the wire and never will, and `timelineWriteTarget` enumerates them by name — an
 * attributed arm never reaches this read at all.
 *
 * Injected as a parameter rather than imported by the bridge, which keeps that module's grep-checkable
 * import ban (`timelineBridge.ts`, on `timelineTargetFor`) literally true.
 */
const openConversationId = (): string | null => {
  const open = selectActiveConversation(activeConversationStore.getState())
  return open === null ? null : open.id
}

/**
 * The pure route→screen view — no hooks, no effects — mirroring how PairingView lives beside
 * PairingScreen. `pending` renders neither screen (AC3).
 *
 * #662 relocated the unpaired root from the pairing screen to the welcome screen, which is what
 * finally gives the pairing screen's `onCancel` seam a meaning. While pairing WAS the root, cancel's
 * only correct app-shell behaviour was "stay put" — the absence of a navigating handler — because a
 * navigating one would have had nowhere safe to go. Now it has: cancel lands on `welcome`, never on
 * the conversation screen, so supplying the handler is both safe and necessary and ADR 0005's
 * fail-safe is untouched.
 *
 * The two navigation props are named after the event that occurred, matching onPaired/onUnpaired —
 * deliberately not `onPair`, which is one letter from `onPaired` in a five-prop object. Both are
 * REQUIRED: the value of the assertNever guard below is that it compile-forces the wiring, and an
 * optional prop would let App forget the CTA handler and still build a dead-end root.
 */
export function AppView(props: {
  route: AppRoute
  onPaired: () => void
  onUnpaired: () => void
  onPairRequested: () => void // the welcome screen's primary CTA was pressed
  onPairingCancelled: () => void // the pairing screen's Cancel fired
}): JSX.Element | null {
  switch (props.route) {
    case 'pending':
      return null
    case 'welcome':
      return <WelcomeScreen onPair={props.onPairRequested} />
    case 'pairing':
      return <PairingScreen onPaired={props.onPaired} onCancel={props.onPairingCancelled} />
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
  // #785 injects the open-conversation read, so the two timeline arms carrying no conversation id —
  // the session boundary and the reconnect chrome reconcile — file into the thread on screen instead of
  // being dropped from the keyed store. The module-level constant above is what keeps this one
  // subscribe for the app's lifetime; passing an inline arrow here would resubscribe every render.
  useTimelineBridge(openConversationId)
  // #224: the modal bridge is the third independent subscriber on the one daemon-event channel (#202),
  // folding the two modal arms into modalStore so the outstanding permission/trust prompt becomes live
  // renderer state. App-lifetime and unconditional like its twins; it derefs window.pyry only inside its
  // effect, so the <App/> server-render test stays ''. Inert until #179 flips `interactive`.
  useModalBridge()
  const [route, setRoute] = useState<AppRoute>('pending')

  useEffect(() => {
    // One mount-time read. Fail-safe in both directions: routeForStatus sends every non-paired
    // outcome to the welcome screen, and a rejected invoke (handler absent — should not happen per
    // #79) also lands on welcome, never the conversation screen. The catch arm is the one non-paired
    // path that bypasses routeForStatus entirely, which is why it is spelled out here rather than
    // inferred. It stays SILENT deliberately: a rejection from the pairing-status invoke can carry a
    // userData path or internal state, and the renderer console is readable by anything that can open
    // DevTools. The `active` flag makes the StrictMode double-mount net exactly one applied setRoute.
    let active = true
    window.pyry
      .pairingStatus()
      .then((status) => {
        if (active) setRoute(routeForStatus(status))
      })
      .catch(() => {
        if (active) setRoute('welcome')
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
  // onUnpaired stays on 'pairing' AFTER #662 moved the launch fallback to 'welcome', deliberately: it
  // is a mid-session flip, not a launch status, and an operator who just unpaired is re-pairing. The
  // two new arrows are the user-action half #662 adds — welcome's CTA into pairing, and pairing's
  // Cancel back out to welcome (never to conversation, so the fail-safe is untouched).
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
  // BackgroundTaskRosterData (#573) is the SIXTH headless leaf (count the JSX below, not these
  // comments — RelayLinkData landed without one): it lands each unsolicited `backgroundTaskRoster`
  // snapshot into the keyed roster store for the panel slice (#568), on the same App-level
  // always-listening rationale — a roster can arrive before #568 is ever mounted and for a
  // conversation the user is not looking at. Reactive-only, no gate. Ships dormant. Its `connected`
  // branch is the sole enforcement of AC5 (no previous pairing's tasks survive a re-handshake), which
  // is why this store is deliberately absent from clearPairingScopedState.
  // AnnouncedModelData (#588) is the SEVENTH headless leaf: it lands each unsolicited `modelAnnounced`
  // announcement into the announced-model store for the run-configuration sheet (#560), on the same
  // App-level always-listening rationale — the announcement rides the turn's init line, so it can
  // arrive long before that sheet is ever opened. Reactive-only, no gate. Ships dormant. Unlike its
  // roster neighbour above it has no `connected` branch, BECAUSE the announcement survives a
  // re-handshake to the same daemon — it still describes that daemon. Its store is pairing-scoped and
  // the pairing-change clear is clearPairingScopedState's (#593), not this leaf's.
  // ConversationActivityData (#748) is the EIGHTH headless leaf: it lands the four activity arms
  // (`turnState`, `stallDetected`, `apiRetry`, `compacting`) into the per-conversation activity store
  // (#747) under each event's OWN conversationId, for the sidebar dot (#676). Same App-level
  // always-listening rationale, sharpened here: the whole point is a chat the operator has NEVER
  // OPENED, so a screen-scoped listener would miss exactly the case the store exists for. It is a
  // SECOND subscriber on these four arms — timelineBridge keeps feeding the open conversation's chrome
  // untouched. Reactive-only, no gate. Like AnnouncedModelData and unlike BackgroundTaskRosterData it
  // has no `connected` branch: both of this store's clears are #749's.
  return (
    <>
      <ConversationListData />
      <SessionIdData />
      <RunSettingsWriteData />
      <QueueData />
      <RelayLinkData />
      <BackgroundTaskRosterData />
      <AnnouncedModelData />
      <ConversationActivityData />
      <AppView
        route={route}
        onPaired={() => setRoute('conversation')}
        onUnpaired={() => setRoute('pairing')}
        onPairRequested={() => setRoute('pairing')}
        onPairingCancelled={() => setRoute('welcome')}
      />
    </>
  )
}

export default App
