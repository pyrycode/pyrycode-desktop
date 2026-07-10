import { useReducer } from 'react'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'

/** Compile-time exhaustiveness guard: a new PairedRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled paired route: ${JSON.stringify(route)}`)
}

/**
 * The pure route→view of the paired region — no hooks, no effects — mirroring how AppView lives beside
 * App. `list` shows the throwaway placeholder home; `thread` shows the existing store-backed
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
      return <PlaceholderList onOpen={props.onOpen} />
    case 'thread':
      return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    default:
      return assertNever(props.route)
  }
}

// A throwaway stand-in for the real Channel List — #141 replaces this whole list view. Its one
// affordance opens the single active conversation (already held in sessionStore) into the thread, so
// today's send/stream round-trip stays reachable (AC2: no regression from the direct-to-thread
// landing). Per the ticket scope, build no list visuals here.
function PlaceholderList({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <div className="paired-list-placeholder">
      <button type="button" onClick={onOpen}>
        Open conversation
      </button>
    </div>
  )
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
