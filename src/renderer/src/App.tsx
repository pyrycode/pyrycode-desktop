import { useEffect, useState } from 'react'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { useDaemonEventBridge } from './store/daemonEventBridge'
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
export function AppView(props: { route: AppRoute; onPaired: () => void }): JSX.Element | null {
  switch (props.route) {
    case 'pending':
      return null
    case 'pairing':
      return <PairingScreen onPaired={props.onPaired} />
    case 'conversation':
      return <ConversationScreen />
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

  // onPaired is the whole of AC4: a successful confirm flips the route to conversation, unmounting
  // the pairing screen and mounting the conversation screen with no restart. It can only fire after
  // the launch query has already resolved to a non-paired route, so there is no ordering hazard with
  // the launch effect's setRoute.
  return <AppView route={route} onPaired={() => setRoute('conversation')} />
}

export default App
