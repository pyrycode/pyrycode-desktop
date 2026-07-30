import { useReducer } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { ChannelList } from './screens/channels/ChannelList'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { ArchiveScreen } from './screens/archive/ArchiveScreen'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'
import { useConversationCreatedNav } from './store/conversationCreatedBridge'
import { useNotificationActivatedNav } from './store/notificationActivatedBridge'
import { usePushNotify } from './store/pushNotifyBridge'
import { activateConversation, type ActivateConversationDeps } from './activateConversation'
import {
  clearPairingScopedState,
  type ClearPairingScopedStateDeps
} from './clearPairingScopedState'
import { activeConversationStore } from './store/activeConversationStore'
import { sessionIdStore } from './store/sessionIdStore'
import { sessionStore } from './store/sessionStore'
import { timelineStore } from './store/timelineStore'

/** Compile-time exhaustiveness guard: a new PairedRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled paired route: ${JSON.stringify(route)}`)
}

/**
 * #530: the store wiring for the conversation-switch clear. Each effect reaches its singleton through
 * `getState()` inside the arrow body — the bridge idiom (timelineBridge.ts:206, sessionIdBridge.ts:68)
 * and the in-component one (CreateFolderDialog.tsx:154) — so nothing is dereferenced at module load and
 * nothing is read during render. The object closes over no per-render value, so module scope is right:
 * PairedShell subscribes to no store at all now and re-renders only on its own nav dispatch, which keeps
 * it server-renderable.
 */
const activateDeps: ActivateConversationDeps = {
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  setActiveConversation: (conversation) =>
    activeConversationStore.getState().setActiveConversation(conversation),
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearSessionId: () => sessionIdStore.getState().clearSessionId()
}

/**
 * #531: the store wiring for the pairing-ended clear, module scope for the same reason as
 * `activateDeps` above — each effect reaches its singleton through `getState()` inside the arrow body,
 * so nothing is dereferenced at module load, nothing is read during render, and the object closes over
 * no per-render value. `sessionStore` appears here and nowhere else in this file; PairedShell still
 * subscribes to no store at all and stays server-renderable.
 */
const clearPairingDeps: ClearPairingScopedStateDeps = {
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  dispatchSession: (action) => sessionStore.getState().dispatch(action)
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
  onOpen: (conversation: ConversationSummary) => void
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
 * Enters at `list` (AC2); the view calls onOpen/onBack and this dispatches. onUnpaired reaches
 * ConversationScreen through the #531 pairing-ended clear (below) and is otherwise the same App route
 * flip it has been since #166. The FAB's create is confirmed asynchronously:
 * useConversationCreatedNav subscribes to the daemon's `conversationCreated` event (#242) and drives the
 * same `open` transition, so a create the daemon never confirms simply does not navigate. The hook
 * dereferences `window.pyry` only inside its effect, so this container stays server-renderable and the
 * pending/pairing neutral-first-paint invariant is untouched (PairedShell only mounts on the
 * `conversation` route).
 */
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  // The created-event → list→thread nav. #278: also record the created payload (its `cwd` feeds the
  // empty-thread workspace chip) — the callback already receives this payload and previously dropped it.
  // #530: recording now goes through activateConversation, which first clears the previous
  // conversation's timeline rows and daemon session id when the id actually changes — so a newly
  // created discussion opens on an empty thread instead of the last one's history.
  useConversationCreatedNav((created) => {
    activateConversation(activateDeps, created)
    dispatch({ type: 'open' })
  })
  // #393: a notification click drives the same list→thread `open` nav (focus the window + show the
  // active conversation's thread). Crucially NO setActiveConversation — the nullary arm carries no
  // payload; in the single-active model "open" means "show the existing active conversation", so this
  // reuses the existing transition (absolute → thread from any paired view, AC2) with no new route or arm.
  useNotificationActivatedNav(() => dispatch({ type: 'open' }))
  // #392: watch the daemon-event channel for turn-end / permission-prompt moments and, gated by the
  // Settings push toggle (#408), ask main to raise an OS notification (#391 owns the unfocused-window
  // gate). A headless subscriber — no nav, no payload — that tears down with the shell on unpair.
  usePushNotify()
  return (
    <PairedShellView
      route={route}
      // #448: opening a row records THAT conversation as active before navigating, the same
      // record-then-open the created-event path above performs — so the thread's wire actions (send,
      // snapshot, dequeue) target the clicked conversation's real id, not a placeholder. A
      // ConversationSummary carries every ConversationCreatedPayload field (plus two more), so the
      // store accepts it structurally; most-recent-wins replacement is the store's contract. #530: the
      // record goes through activateConversation, which clears the previous conversation's rows and
      // session id ONLY when the id changes — a re-click of the already-active row keeps its thread.
      onOpen={(conversation) => {
        activateConversation(activateDeps, conversation)
        dispatch({ type: 'open' })
      }}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onOpenArchive={() => dispatch({ type: 'openArchive' })}
      onBack={() => dispatch({ type: 'back' })}
      // #531: the two paths that END a pairing, and the one place both clear the same set. They are
      // NOT symmetric, which is why neither can be left to the other: unpair flips App's route to
      // `pairing` and unmounts this shell, while pair-another transitions `pairServer` → `list` INSIDE
      // it (pairedRoute.ts:62-65), so the shell never unmounts and nothing a remount would have
      // cleared gets cleared. Wrapping the props here rather than threading a dep into runUnpair puts
      // both wirings on adjacent lines and leaves ConversationScreen untouched — and it inherits the
      // unpair fail-safe posture verbatim, because runUnpair calls `onUnpaired` only on `result: 'ok'`
      // (unpairAction.ts:61-64), so a failed unpair reaches neither this wrapper nor the clear.
      // Clear-then-navigate on both: no observer may see the new pairing's view against the ended
      // pairing's rows, conversation id or session. `onPairServerCancelled` is deliberately NOT
      // wrapped — cancelling out of pair-another ends no pairing, so it must clear nothing.
      onUnpaired={() => {
        clearPairingScopedState(clearPairingDeps)
        onUnpaired()
      }}
      onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
      onPairServerPaired={() => {
        clearPairingScopedState(clearPairingDeps)
        dispatch({ type: 'pairServerPaired' })
      }}
      onPairServerCancelled={() => dispatch({ type: 'pairServerCancelled' })}
    />
  )
}
