import { useReducer } from 'react'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { ChannelList } from './screens/channels/ChannelList'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { ArchiveScreen } from './screens/archive/ArchiveScreen'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'
import { useConversationCreatedNav } from './store/conversationCreatedBridge'
import { useActiveConversationStore } from './store/activeConversationStore'

/** Compile-time exhaustiveness guard: a new PairedRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled paired route: ${JSON.stringify(route)}`)
}

/**
 * The pure route→view of the paired region — no hooks, no effects — mirroring how AppView lives beside
 * App. `list` shows the Channel List home screen (#141); `thread` shows the existing store-backed
 * ConversationScreen with a back affordance; `settings` shows the Settings scaffold (#333); `archive`
 * shows the Archive scaffold (#347); `pairServer` re-opens the existing PairingScreen from inside the
 * paired app to switch daemons (#152). Every route renders, so there is no null arm. Adding a future
 * view is one new case, forced by the assertNever default (AC1: an added arm, not a rewrite). The
 * `settings` and `archive` cases reuse the same `onBack` as `thread` (all dispatch `back`, which the
 * absolute `back` arm lands on `list`).
 *
 * The `pairServer` case passes no `bridge` to PairingScreen — production uses its `window.pyry` default
 * (bridge ?? window.pyry), the same as App's `pairing` route. The two seams are distinct destinations:
 * onCancel → settings (non-destructive, AC4) and onPaired → the new server's list (AC3), so they wire to
 * separate callbacks rather than sharing `onBack`.
 */
export function PairedShellView(props: {
  route: PairedRoute
  onOpen: () => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  onBack: () => void
  onUnpaired: () => void
  onOpenPairServer: () => void
  onPairServerPaired: () => void
  onPairServerCancelled: () => void
}): JSX.Element {
  switch (props.route) {
    case 'list':
      return (
        <ChannelList
          onOpen={props.onOpen}
          onOpenSettings={props.onOpenSettings}
          onOpenArchive={props.onOpenArchive}
        />
      )
    case 'thread':
      return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    case 'settings':
      return <SettingsScreen onBack={props.onBack} onPairAnother={props.onOpenPairServer} />
    case 'archive':
      return <ArchiveScreen onBack={props.onBack} />
    case 'pairServer':
      return (
        <PairingScreen
          onPaired={props.onPairServerPaired}
          onCancel={props.onPairServerCancelled}
        />
      )
    default:
      return assertNever(props.route)
  }
}

/**
 * The paired region's inner router container. Owns the ephemeral nav state via useReducer over the
 * pure nextPairedRoute — ADR 0006 (screen-local, resets on remount, never the session store; AC5).
 * Enters at `list` (AC2); the view calls onOpen/onBack and this dispatches. onUnpaired threads
 * straight through to ConversationScreen unchanged (#166). The FAB's create is confirmed asynchronously:
 * useConversationCreatedNav subscribes to the daemon's `conversationCreated` event (#242) and drives the
 * same `open` transition, so a create the daemon never confirms simply does not navigate. The hook
 * dereferences `window.pyry` only inside its effect, so this container stays server-renderable and the
 * pending/pairing neutral-first-paint invariant is untouched (PairedShell only mounts on the
 * `conversation` route).
 */
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  // #278: the setter that snapshots the created discussion so the empty thread's workspace chip can read
  // its `cwd`. Read via the store hook (the Composer/UnpairControl store-write idiom); the reference is
  // stable, so no re-render churn, and the created-event callback below closes over it.
  const setActiveConversation = useActiveConversationStore((s) => s.setActiveConversation)
  // The created-event → list→thread nav. #278: also record the created payload (its `cwd` feeds the
  // empty-thread workspace chip) — the callback already receives this payload and previously dropped it.
  // The `open` nav stays conversation-agnostic (it opens the single active conversation, the same interim
  // as the row's onClick), reusing the existing transition with no new route or nav arm.
  useConversationCreatedNav((created) => {
    setActiveConversation(created)
    dispatch({ type: 'open' })
  })
  return (
    <PairedShellView
      route={route}
      onOpen={() => dispatch({ type: 'open' })}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onOpenArchive={() => dispatch({ type: 'openArchive' })}
      onBack={() => dispatch({ type: 'back' })}
      onUnpaired={onUnpaired}
      onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
      onPairServerPaired={() => dispatch({ type: 'pairServerPaired' })}
      onPairServerCancelled={() => dispatch({ type: 'pairServerCancelled' })}
    />
  )
}
