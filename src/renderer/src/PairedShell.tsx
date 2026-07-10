import { useReducer } from 'react'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { ChannelList } from './screens/channels/ChannelList'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'

/** Compile-time exhaustiveness guard: a new PairedRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled paired route: ${JSON.stringify(route)}`)
}

/**
 * The pure route→view of the paired region — no hooks, no effects — mirroring how AppView lives beside
 * App. `list` shows the Channel List home screen (#141); `thread` shows the existing store-backed
 * ConversationScreen with a back affordance. Both routes render, so there is no null arm. Adding a
 * future `settings` / `archive` view is one new case, forced by the assertNever default (AC1: an added
 * arm, not a rewrite).
 */
export function PairedShellView(props: {
  route: PairedRoute
  onOpen: () => void
  onBack: () => void
  onUnpaired: () => void
}): JSX.Element {
  switch (props.route) {
    case 'list':
      return <ChannelList onOpen={props.onOpen} />
    case 'thread':
      return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    default:
      return assertNever(props.route)
  }
}

/**
 * The paired region's inner router container. Owns the ephemeral nav state via useReducer over the
 * pure nextPairedRoute — ADR 0006 (screen-local, resets on remount, never the session store; AC5).
 * Enters at `list` (AC2); the view calls onOpen/onBack and this dispatches. onUnpaired threads
 * straight through to ConversationScreen unchanged (#166). No effects and no window deref, so it is
 * server-renderable and the pending/pairing neutral-first-paint invariant is untouched (PairedShell
 * only mounts on the `conversation` route).
 */
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  return (
    <PairedShellView
      route={route}
      onOpen={() => dispatch({ type: 'open' })}
      onBack={() => dispatch({ type: 'back' })}
      onUnpaired={onUnpaired}
    />
  )
}
