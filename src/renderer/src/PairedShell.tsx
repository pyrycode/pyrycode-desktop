import './pairedShell.css'
import { connectedConversationHostNow } from './screens/conversation/conversationActionAvailability'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { ChannelList, hostRowLabel } from './screens/channels/ChannelList'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { ArchiveScreen } from './screens/archive/ArchiveScreen'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'
import { useConversationCreatedNav } from './store/conversationCreatedBridge'
import { useConversationDeletedExit } from './store/conversationDeletedBridge'
import { useArchivedActiveConversationExit } from './store/conversationArchivedBridge'
import { useActiveConversationReseed } from './store/activeConversationReseedBridge'
import { useNotificationActivatedNav } from './store/notificationActivatedBridge'
import { usePushNotify } from './store/pushNotifyBridge'
import {
  conversationLastReadDeps,
  stampLastReadFor,
  useConversationLastRead
} from './store/conversationLastReadBridge'
import { activateConversation, type ActivateConversationDeps } from './activateConversation'
import { applyPairingChange, type PairingChangeDeps } from './applyPairingChange'
import {
  clearPairingScopedState,
  type ClearPairingScopedStateDeps
} from './clearPairingScopedState'
import {
  exitActiveConversation,
  type ExitActiveConversationDeps
} from './exitActiveConversation'
import { requestRunConfigSnapshot } from './screens/conversation/runConfigSnapshot'
import { requestModelList } from './store/modelListBridge'
import { requestSystemPrompt } from './store/systemPromptBridge'
import { historyAskDeps, requestOpeningHistory } from './store/historyPageBridge'
import { activeConversationStore } from './store/activeConversationStore'
import { sessionFactsStore } from './store/sessionFactsStore'
import { announcedModelStore } from './store/announcedModelStore'
import { conversationLastReadStore } from './store/conversationLastReadStore'
import { conversationTimelineStore } from './store/conversationTimelineStore'
import { modelListStore } from './store/modelListStore'
import { conversationListStore } from './store/conversationListStore'
import { queueStore } from './store/queueStore'
import { backgroundTaskRosterStore } from './store/backgroundTaskRosterStore'
import { modalStore } from './store/modalStore'
import { conversationActivityStore } from './store/conversationActivityStore'
import { runConfigStore } from './store/runConfigStore'
import { runSettingsWriteStore } from './store/runSettingsWriteStore'
import { systemPromptStore } from './store/systemPromptStore'
import { systemPromptWriteStore } from './store/systemPromptWriteStore'
import { sessionIdStore } from './store/sessionIdStore'
import { sessionStore, useSessionStore } from './store/sessionStore'
import { serverInfoStore, useServerInfoStore, selectServers } from './store/serverInfoStore'
import { useHostLabelStore, selectHostLabelFor } from './store/hostLabelStore'
import { loadServerInfo } from './store/serverInfoLoader'
import { slashCommandListStore } from './store/slashCommandListStore'
import { timelineStore } from './store/timelineStore'
import { usageLimitStore } from './store/usageLimitStore'

/** Compile-time exhaustiveness guard: a new PairedRoute member without a case is a type error. */
function assertNever(route: never): never {
  throw new Error(`Unhandled paired route: ${JSON.stringify(route)}`)
}

/**
 * #530: the store wiring for the conversation-switch clear. Each effect reaches its singleton through
 * `getState()` inside the arrow body — the bridge idiom (timelineBridge.ts:206, sessionIdBridge.ts:68)
 * and the in-component one (CreateFolderDialog.tsx:154) — so nothing is dereferenced at module load and
 * nothing is read during render. The object closes over no per-render value, so module scope is right:
 * The wiring stays independent of render state; PairedShell separately subscribes to recovery status.
 */
const activateDeps: ActivateConversationDeps = {
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  setActiveConversation: (conversation) =>
    activeConversationStore.getState().setActiveConversation(conversation),
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  // #1167: the departing conversation's run configuration, all halves dropped as one act — the held
  // daemon snapshot, the write machine's pending / confirmed / rejected state, since #1231 the held
  // system-prompt reading, and since #1250 the outcome of that conversation's system-prompt write. Four
  // `getState()` arrows in one body rather than four members, the `requestConversationConfig` shape
  // below; these four singletons appear here and nowhere else in this file, and none is subscribed to.
  //
  // #1231 joins this body rather than earning a member of its own for the reason the member's docstring
  // gives: it is the SAME act ("this chat's configuration is no longer the one to show"), it always
  // fires with the other two, and it is a value describing one chat's session held in an app-wide
  // singleton keyed by nothing. Its staleness is the sharpest of the three once #1078 lands — a stale
  // prompt shown against another chat's thread is offered for EDIT, not merely displayed — while its
  // self-healing is the weakest: this arm is reply-only, so nothing pushes a correction unsolicited and
  // the only refill is the ask fired moments later from `requestConversationConfig` below.
  //
  // #1250's fourth arrow is the one that NEVER self-heals — nothing asks for it and nothing pushes it,
  // because it describes an act the operator performed rather than a value the daemon holds. It uses
  // the same `conversationSwitched` arm as its write-machine sibling above and for the same reason:
  // past this seam the WHOLE of that state (in flight, confirmed, refused alike) describes a chat that
  // is no longer the one being shown, where the reconnect edge clears only what strands.
  clearRunConfig: () => {
    runConfigStore.getState().clearSnapshot()
    runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
    systemPromptStore.getState().clearReading()
    systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  },
  // #777: restore point 1 of "the open conversation's mark equals its own held item count" — the stamp
  // for the conversation being opened. It reaches its two singletons through the bridge's own production
  // wiring object rather than a fourth `getState()` arrow here, so the sampling branch lives in one
  // tested place; `stampLastReadFor` never consults the open conversation, so the id below is the whole
  // input. Restore point 2 is `useConversationLastRead` in the container.
  stampLastRead: (conversationId) => stampLastReadFor(conversationLastReadDeps, conversationId),
  // #786: the view stamp that ranks the opened conversation last in the retained timelines' eviction
  // order — the write path that arms the ten-slice bound. Unlike `stampLastRead` above it reaches its
  // store DIRECTLY, the `clearTimelineFor` / `clearAllTimelines` shape below: there is no sampling branch
  // to keep in one tested place, because the store method takes the id and nothing else.
  markViewed: (conversationId) => conversationTimelineStore.getState().markViewed(conversationId),
  // #1166: ask the daemon for the opened conversation's run configuration and its published model list,
  // and since #1231 its stored system prompt. All three senders are the tested, React-free helpers on
  // their own paths and each already refuses a falsy id, so this arrow holds no branch — only the three
  // calls, in the order the three lanes were built. The sequence does not matter (all are
  // fire-and-forget and their replies are whole-value replaces landing through app-lifetime
  // subscribers), which is exactly why no gate or await appears here.
  //
  // #1231's ask is the one that CANNOT be dropped without the vertical going dark. The other two frames
  // are also pushed unsolicited, so a missing ask costs freshness; `system_prompt` is REPLY-ONLY, so
  // with no ask the event never fires at all and the store stays permanently at its not-loaded state.
  // Its sender's falsy guard is correspondingly load-bearing rather than tidy: this verb has no error
  // frame, so an unroutable id would draw an ordinary-looking `no_session` reply that nothing
  // downstream could tell from a true reading.
  //
  // `window.pyry` is dereferenced INSIDE the arrow body, the `getState()` shape every member above uses:
  // it runs only when a conversation is activated, never at module load and never during render, so this
  // module stays server-renderable.
  //
  // #1259's ask is the FOURTH and the only one that is not unconditional. The three above are
  // whole-value replaces for which a duplicate costs nothing, so they fire on every activation
  // including a re-click of the row already open. A duplicate history page replaces nothing — it
  // PREPENDS its rows a second time — so that ask carries its own per-conversation gate, which lives
  // inside `requestOpeningHistory` where a spy can reach it rather than as a branch in this arrow. It
  // reaches its store through `historyAskDeps` (the `stampLastRead` shape) rather than a fourth
  // `getState()` arrow here, so the read-then-mark decision stays in one tested place.
  requestConversationConfig: (conversationId) => {
    if (connectedConversationHostNow(conversationId) === null) return
    requestRunConfigSnapshot(window.pyry.sendCommand, conversationId)
    requestModelList(window.pyry.sendCommand, conversationId)
    requestSystemPrompt(window.pyry.sendCommand, conversationId)
    requestOpeningHistory(historyAskDeps, conversationId)
  }
}

/**
 * #531: the store wiring for the pairing-ended clear, module scope for the same reason as
 * `activateDeps` above — each effect reaches its singleton through `getState()` inside the arrow body,
 * so nothing is dereferenced at module load, nothing is read during render, and the object closes over
 * no per-render value. `sessionStore`, `announcedModelStore`, `slashCommandListStore` and
 * `modelListStore` appear here and nowhere else in this file; the wiring stays server-renderable. #593 widened the set with the announced running model, #779 with
 * the per-conversation read marks, #955 with the published slash-command menus and #977 with the
 * published model menus, and each was a single edit here rather than one per call site — which is the
 * whole reason the clear lives in the shared helper, and which survives #1141 narrowing the callers to
 * one. THAT the set is enumerated in one reviewable, testable place is the property; that two paths
 * once shared it was the occasion, not the reason.
 *
 * #1141: exactly one path reaches this object now — unpair, through `applyPairingChange`'s `unpaired`
 * arm. Pair-another-server ran the same clear until then, on the argument that both paths end a
 * pairing. It does not end one: it ADDS a server beside those already paired, and since #1117 and
 * #1084 the background process holds a live connection for each of them. The clear itself is
 * unchanged and stays unconditional on the path that remains.
 */
/**
 * #652: the store wiring for the deleted-conversation exit, module scope for the same reason as the two
 * objects above — each effect reaches its singleton through `getState()` inside the arrow body, so
 * nothing is dereferenced at module load, nothing is read during render, and the object closes over no
 * per-render value. `navigateToList` is the one effect that CANNOT live here: it needs the container's
 * `dispatch`, so it is supplied at the call site and the `Omit` makes the missing field explicit rather
 * than leaving a partial object silently typed as complete.
 */
const exitConversationDeps: Omit<ExitActiveConversationDeps, 'navigateToList'> = {
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearTimelineFor: (id) => conversationTimelineStore.getState().clearTimelineFor(id),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  // #1167: the same one act as in `activateDeps` above, and the two bodies are deliberately identical —
  // a delete or an archive ends the conversation this state describes exactly as a switch does. #1231
  // added its third line to both in the same edit and #1250 its fourth, for that reason: a store added
  // to one body and not the other is precisely how #1167's own defect arose.
  clearRunConfig: () => {
    runConfigStore.getState().clearSnapshot()
    runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
    systemPromptStore.getState().clearReading()
    systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  }
}

const clearPairingDeps: ClearPairingScopedStateDeps = {
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearAllTimelines: () => conversationTimelineStore.getState().clearAllTimelines(),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  clearAnnouncedModel: () => announcedModelStore.getState().clearAnnouncedModel(),
  clearSessionFacts: () => sessionFactsStore.getState().clearSessionFacts(),
  // #955: every conversation's published slash-command menu, dropped as one. It reaches its store
  // DIRECTLY, the `clearAllLastRead` shape below, and for the same reason — there is no sampling or
  // gating branch to keep in one tested place, because the store method takes nothing at all.
  clearAllSlashCommandLists: () => slashCommandListStore.getState().clearAllSlashCommandLists(),
  // #977: every conversation's published MODEL menu, dropped as one, the same shape and for the same
  // reason as its twin above — the store method takes nothing at all, so there is no sampling or
  // gating branch to keep in one tested place. Adding it to THIS object is what makes the unpair path
  // below drop it; the call site needed no edit.
  clearAllModelLists: () => modelListStore.getState().clearAllModelLists(),
  // #1086: every server's conversation rows, dropped as one. The same direct, nullary shape as the
  // three clears above — no sampling or gating branch to keep in one tested place, because the store
  // method takes nothing at all. Adding it to THIS object is what makes the unpair path below drop
  // it; the call site needed no edit.
  clearAllConversations: () => conversationListStore.getState().clearAllConversations(),
  // #1138: every conversation's queued backlog, dropped as one. The same direct, nullary shape as the
  // four clears above. It is the only member of this object whose store the `connected` edge ALSO
  // clears — scoping that edge's reset to the reconnecting server (which is what #1138 does) is exactly
  // what stopped a re-pairing's first `connected` from blanking the map on its way past, so the two
  // mechanisms now split the work rather than one covering for the other.
  clearAllBacklogs: () => queueStore.getState().clearAllBacklogs(),
  // #1139: every conversation's background-task roster, dropped as one — the same direct, nullary
  // shape as the five clears above, and the SECOND member whose store the `connected` edge also
  // clears. Scoping that edge to the reconnecting server (which is what #1139 does) is what stopped a
  // re-pairing's first `connected` from blanking the map on its way past, and this family re-asserts
  // nothing at all, so without this entry a departed pairing's command lines would latch for the life
  // of the process. Adding it to THIS object is what makes the unpair path below drop it; the call
  // site needed no edit.
  clearAllRosters: () => backgroundTaskRosterStore.getState().clearAllRosters(),
  // #1140: every outstanding permission prompt, its suppression bookkeeping and its rejection banners,
  // dropped as one — and the THIRD member whose store the `connected` edge also clears. It reaches its
  // store through `dispatch` rather than a `clearAll*` setter because that is `modalStore`'s only write
  // path, the `dispatchTimeline` / `dispatchSession` shape above and below; the action is payload-free,
  // so the nullary property the six setters carry holds here too. Scoping the edge to the reconnecting
  // server (which is what #1140 does) is what stopped a re-pairing's first `connected` from clearing the
  // store on its way past, and the daemon's reconcile re-sends only the NEW server's prompts, so without
  // this entry a departed pairing's answerable prompts would latch for the life of the process. Adding
  // it to THIS object is what makes the unpair path below drop it; the call site needed no edit. Note
  // "DEPARTED": since #1141 a prompt raised by a server that is still paired survives a pair-another
  // and stays answerable, which is the point — `answerModal` routes by modal id to the connection that
  // raised it, so the answer reaches a daemon that is still waiting for it.
  dispatchModal: (event) => modalStore.getState().dispatch(event),
  // #1145: every conversation's working, stalled, retrying and compacting dot, dropped as one — the
  // same direct, nullary shape as the six setters above, and the FOURTH member whose store the
  // `connected` edge also clears. Scoping that edge to the reconnecting server (which is what #1145
  // does) is what stopped a re-pairing's first `connected` from blanking the map on its way past, and
  // nothing re-asserts an activity fact except that conversation's own next `turnState` — which for a
  // turn that ended while unpaired never arrives — so without this entry a departed pairing's working
  // dot would sit on a sidebar row indefinitely. Adding it to THIS object is what makes the unpair
  // path below drop it; the call site needed no edit.
  clearAllActivity: () => conversationActivityStore.getState().clearAllActivity(),
  // #1320: every conversation's held usage-limit reading, dropped as one — the same direct, nullary
  // shape as the seven setters above, and the FIRST member whose store the `connected` edge does NOT
  // clear and must not: after a reconnect to the same daemon the account's quota window is exactly what
  // it was, and there is no request half that could re-fetch a value blanked at that edge. The store's
  // own two exits cannot cover this boundary either — the expiry has no instant to fire at for a reading
  // claude reported no reset for, and the per-conversation `allowed` clear is daemon-driven — so without
  // this entry a departed ACCOUNT's quota posture would latch for the life of the process and be
  // attributed to the newly paired one. Adding it to THIS object is what makes the unpair path below
  // drop it; the call site needed no edit.
  clearAllUsageLimits: () => usageLimitStore.getState().clearAllUsageLimits(),
  dispatchSession: (action) => sessionStore.getState().dispatch(action),
  // #779: how far the operator read on the ended pairing's server — cleared in memory AND on disk, since
  // #776 persists the marks. It reaches its store DIRECTLY rather than through
  // `conversationLastReadDeps`, the `markViewed` argument above: the bridge's deps object exists so the
  // SAMPLING branch lives in one tested place, and there is no sampling branch here — the store method
  // takes nothing at all. Widening `ConversationLastReadDeps` with a member the stamp path never uses
  // would put an unused effect on a tested interface.
  clearAllLastRead: () => conversationLastReadStore.getState().clearAllLastRead()
}

const PAIRING_REJECTION_NOTICE = 'Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.'

/**
 * The pure route→view of the paired region — no hooks, no effects — mirroring how AppView lives beside
 * App. `list` and `thread` both show the #670 two-pane desktop shell: the Channel List sidebar (#141)
 * beside a chat pane that holds the store-backed ConversationScreen on `thread` and nothing on `list`.
 * `settings` shows the Settings scaffold (#333); `archive` shows the Archive scaffold (#347);
 * `pairServer` re-opens the existing PairingScreen from inside the paired app to switch daemons (#152).
 * Settings, Archive and ordinary pairing replace the shell; host recovery stays beside the sidebar.
 * The original full-screen navigation followed #670's AC5 (Settings,
 * Archive and Pair-another open over both panes) and it cost no edit, which is why the route model was
 * left alone. Adding a future view is one new case, forced by the assertNever default (AC1: an added
 * arm, not a rewrite). The `settings` and `archive` cases reuse the same `onBack` as `thread` (all
 * dispatch `back`, which the absolute `back` arm lands on `list` — now "deselect the conversation and
 * leave the pane empty" rather than "navigate away from the thread").
 *
 * The `pairServer` case passes no `bridge` to PairingScreen — production uses its `window.pyry` default
 * (bridge ?? window.pyry), the same as App's `pairing` route. The two seams are distinct destinations:
 * onCancel → the surface pairing was launched from (non-destructive, AC4; #1303 widened that from
 * `settings` alone) and onPaired → the new server's list (AC3), so they wire to separate callbacks
 * rather than sharing `onBack`.
 *
 * #1303 GAVE `onOpenPairServer` A SECOND CONSUMER. It is still one prop and one act — "open the pairing
 * flow" — reaching SettingsScreen as its `onPairAnother` row and ChannelList as the plus on both section
 * headers. Nothing here tells the two apart, and nothing needs to: the container decides where cancel
 * lands from the route it was on when the flow opened, not from which control opened it.
 */
export function PairedShellView(props: {
  recoveryServerId?: string | null
  recoveryRejected?: boolean
  recoveryLabel?: string
  onRepairHost?: (serverId: string) => void
  route: PairedRoute
  pairingOrigin?: PairedRoute
  /** The identity of the chat pane's subtree — the active conversation's id, or null when none has been
   *  activated in this shell. Applied as ConversationScreen's `key`, so a change REMOUNTS it. Required,
   *  not optional: forgetting to wire it is the exact regression it exists to prevent, so it is a compile
   *  error rather than a silent `undefined`. See the container's `paneKey` state for why it is a prop. */
  paneKey: string | null
  onOpen: (conversation: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  onBack: () => void
  onUnpaired: () => void
  onOpenPairServer: () => void
  onPairServerPaired: () => void
  onPairServerCancelled: () => void
}): JSX.Element {
  const pairing = <PairingScreen key={props.recoveryServerId} presentation="modal"
    context={props.recoveryServerId ? <>
      <p>Repair pairing: {props.recoveryLabel ?? 'Server'}</p>
      {props.recoveryRejected && <p role="status">{PAIRING_REJECTION_NOTICE}</p>}
    </> : undefined}
    onPaired={props.onPairServerPaired} onCancel={props.onPairServerCancelled} />
  const visibleRoute = props.route === 'pairServer'
    ? props.pairingOrigin ?? (props.recoveryServerId ? 'list' : 'settings')
    : props.route
  // Stable element position and paneKey retain the invoking view through pairing.
  const background = (): JSX.Element => {
    switch (visibleRoute) {
      case 'list':
      case 'thread':
        return (
          <div className="paired-shell">
            <div className="paired-shell__sidebar">
              <ChannelList
                onOpen={props.onOpen}
                onOpenSettings={props.onOpenSettings}
                onOpenArchive={props.onOpenArchive}
                onRepairHost={props.onRepairHost}
                onPairNewHost={props.onOpenPairServer}
              />
            </div>
            <div className="paired-shell__pane">
              {visibleRoute === 'thread' ? (
                <ConversationScreen
                  key={props.paneKey}
                  onRepairHost={props.onRepairHost}
                  onBack={props.onBack}
                />
              ) : null}
            </div>
          </div>
        )
      case 'settings':
        return (
          <SettingsScreen
            onBack={props.onBack}
            onPairAnother={props.onOpenPairServer}
            onUnpaired={props.onUnpaired}
          />
        )
      case 'archive':
        return <ArchiveScreen onBack={props.onBack} />
      case 'pairServer':
        return <></>
      default:
        return assertNever(visibleRoute)
    }
  }
  return <>{background()}{props.route === 'pairServer' && pairing}</>
}

/**
 * The paired region's inner router container. Owns the ephemeral nav state via useReducer over the
 * pure nextPairedRoute — ADR 0006 (screen-local, resets on remount, never the session store; AC5).
 * Enters at `list` (AC2); the view calls onOpen/onBack and this dispatches. Settings keeps the
 * pairing-ended clear and App route flip; recovery retains the paired shell. The FAB's create is confirmed asynchronously:
 * useConversationCreatedNav subscribes to the daemon's `conversationCreated` event (#242) and drives the
 * same `open` transition, so a create the daemon never confirms simply does not navigate. The hook
 * dereferences `window.pyry` only inside its effect, so this container stays server-renderable and the
 * pending/pairing neutral-first-paint invariant is untouched (PairedShell only mounts on the
 * `conversation` route).
 */
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  // The chat pane's identity (see PairedShellView's `paneKey` prop). Screen-local, ADR 0006, beside the
  // nav reducer. The two paths that activate a conversation are BOTH right here
  // (the created-event nav below and `onOpen`), each already holding the conversation it is activating, so
  // the id is recorded from the nav action rather than read back out of a store. The set is exactly
  // co-located with `activateConversation` — that call is the marker for "a third activation must record
  // the id too". The nullary `open` (a notification click, below) records nothing on purpose: it means
  // "show the conversation that is already active", so the pane's identity has not changed. Nothing clears
  // it on the way out. In-app pairing now preserves the background subtree, so
  // both this identity and the composer's local draft survive idle cancellation.
  const [paneKey, setPaneKey] = useState<string | null>(null)
  // #1303 — WHERE CANCELLING THE PAIRING FLOW PUTS THE OPERATOR BACK: the route this shell was on when
  // the flow was opened. Screen-local beside `paneKey` and for its reasons (ADR 0006) — never a store,
  // never persisted, never sent over IPC — and it dies with the shell on unpair, which is correct, since
  // a pairing origin has no meaning across pairings.
  //
  // RECORDED FROM `route` AT `openPairServer`, NOT PER ENTRY, which is what makes one rule cover both:
  // neither the Settings row nor either header plus has to know its own name — clicked from Settings the
  // route reads `settings`, clicked from a plus it reads `list` or `thread`. Host recovery captures
  // that same route when the user opens it from the sidebar or composer.
  //
  // SEEDED `'settings'`, the shipped destination, so the never-opened-but-cancelled frame behaves exactly
  // as it did before this ticket. That frame is unreachable — `pairServerCancelled` is dispatched only by
  // the pairing screen, which only the `openPairServer` that writes this cell puts up — so the seed
  // states which behaviour to preserve rather than being a fallback anything relies on.
  const [pairServerReturn, setPairServerReturn] = useState<PairedRoute>('settings')
  const [recoveryServerId, setRecoveryServerId] = useState<string | null>(null)
  const pairingGeneration = useRef(0)
  const activePairingGeneration = pairingGeneration.current
  useEffect(() => () => { pairingGeneration.current += 1 }, [])
  const servers = useServerInfoStore(selectServers)
  const statuses = useSessionStore(s => s.statuses)
  const recoveryLabel = useHostLabelStore(selectHostLabelFor(recoveryServerId))
  const recoveryStatus = recoveryServerId === null ? undefined : statuses.get(recoveryServerId)
  const leaveRecovery = (): void => {
    pairingGeneration.current += 1
    setRecoveryServerId(null)
  }
  const openRecovery = (serverId: string): void => {
    if (!servers.some(server => server.serverId === serverId)) return
    if (route === 'pairServer' && recoveryServerId === serverId) return
    pairingGeneration.current += 1
    if (route !== 'pairServer') setPairServerReturn(route)
    setRecoveryServerId(serverId)
    dispatch({ type: 'openPairServer' })
    window.pyry.sendDiagnostic({ event: 'pairing-recovery', code: 'opened' })
  }
  // The created-event → list→thread nav. #278: also record the created payload (its `cwd` feeds the
  // empty-thread workspace chip) — the callback already receives this payload and previously dropped it.
  // #530: recording now goes through activateConversation, which first clears the previous
  // conversation's timeline rows and daemon session id when the id actually changes — so a newly
  // created discussion opens on an empty thread instead of the last one's history.
  // #670: the FAB's create is a conversation switch too when a thread is already open — `open` is
  // absolute, so the route does not move and the pane would otherwise keep the previous discussion's
  // composer draft. Re-key it on the minted id.
  useConversationCreatedNav((created) => {
    leaveRecovery()
    activateConversation(activateDeps, created)
    setPaneKey(created.id)
    dispatch({ type: 'open' })
  })
  // #652: the delete confirmation → thread exit. Symmetric with the created-event nav above and driven
  // by the same rule — navigate on the DAEMON's confirmation, not on the click — so a delete the daemon
  // never confirms leaves the operator in the thread (AC5) rather than stranding them on a list that
  // still shows the row. exitActiveConversation gates on the id, so a confirmation naming a different
  // discussion (the operator opened another one while the reply was in flight) changes nothing (AC4).
  // The per-render object allocation is free: the hook holds this inline arrow in a ref and re-reads it
  // on each delivery, so nothing needs memoizing and the subscription never re-establishes.
  useConversationDeletedExit((conversationId) =>
    exitActiveConversation(
      { ...exitConversationDeps, navigateToList: () => { leaveRecovery(); dispatch({ type: 'back' }) } },
      conversationId
    )
  )
  // #653: the archive half of the same exit — the SAME decision, a different trigger, and no new deps
  // object. Archiving has no confirmation event that says so: `conversation_updated` fires identically on
  // rename and change-workspace, both reachable on the open discussion from inside its own thread, so the
  // signal is DERIVED from the daemon's authoritative list instead (see conversationArchivedBridge). Still
  // the same rule as the two navs above — navigate on the DAEMON's word, not on the click — so an archive
  // the daemon never confirms leaves the operator in the thread (AC5). The id getter is
  // `exitConversationDeps`' own `getActiveConversation`, so the bridge's gate and the helper's gate read
  // the SAME source and cannot disagree about which conversation is on screen.
  useArchivedActiveConversationExit(
    () => exitConversationDeps.getActiveConversation()?.id ?? null,
    (conversationId) =>
      exitActiveConversation(
        { ...exitConversationDeps, navigateToList: () => { leaveRecovery(); dispatch({ type: 'back' }) } },
        conversationId
      )
  )
  // #1184: the open chat's snapshot follows the daemon's list. The bridge above DERIVES an exit from the
  // same reply; this one derives a re-seed, and the two are deliberately independent subscriptions with
  // no ordering contract — neither reads the other's store, both read the event's own rows. NO new deps
  // object and no navigation: the two members are `activateDeps`' own, so a re-seed writes through the
  // exact setter the activation path uses, and the snapshot cannot end up sourced from two ideas of what
  // "the open chat" is. Both are module-scope arrows, which is what lets the hook take them as
  // subscribe-once pass-throughs rather than effect dependencies.
  useActiveConversationReseed(activateDeps.getActiveConversation, activateDeps.setActiveConversation)
  // #393: a notification click drives the same list→thread `open` nav (focus the window + show the
  // active conversation's thread). Crucially NO setActiveConversation — the nullary arm carries no
  // payload; in the single-active model "open" means "show the existing active conversation", so this
  // reuses the existing transition (absolute → thread from any paired view, AC2) with no new route or arm.
  useNotificationActivatedNav(() => { leaveRecovery(); dispatch({ type: 'open' }) })
  // #392: watch the daemon-event channel for turn-end / permission-prompt moments and, gated by the
  // Settings push toggle (#408), ask main to raise an OS notification (#391 owns the unfocused-window
  // gate). A headless subscriber — no nav, no payload — that tears down with the shell on unpair.
  usePushNotify()
  // #777: restore point 2 — keep the OPEN conversation's last-read mark level with its own held item
  // count as content lands, so a chat the operator is looking at never accrues an unread mark against
  // itself. It observes conversationTimelineStore rather than the daemon-event channel: the composer's
  // optimistic echo writes that store with no IPC arm behind it, and a second `onDaemonEvent` listener
  // would sample the count before or after the timeline fan-out depending on registration order.
  // Deliberately mounted HERE and not app-level beside the eight headless leaves in App: those exist for
  // conversations the operator has NEVER opened, whereas this one only ever writes the OPEN conversation
  // — a concept that exists only inside the paired shell. Every path that unmounts this shell clears the
  // active conversation first, so there is no state in which a conversation is open and this is not
  // listening. This hook subscribes for its effect only; recovery owns the render subscriptions.
  useConversationLastRead()
  // #1141: the pairing-change wiring, and the ONE dep object in this file that cannot live at module
  // scope — three of its four members close over per-render values (`onUnpaired`, `dispatch`). That
  // is `exitConversationDeps`' situation one notch further: there the single container-bound member
  // is supplied at the call site and an `Omit` keeps the rest module-scope, which is not worth doing
  // for a majority. The per-render allocation is free, exactly as it is for the inline arrows this
  // replaces; the recovery subscriptions are separate from this wiring.
  //
  // `clearPairingScopedState` is nullary HERE: `applyPairingChange` decides whether a change clears,
  // never what the clear contains, so `clearPairingDeps` stays module-scope above and the fifteen
  // stores stay behind the helper that enumerates and tests them.
  const pairingChangeDeps: PairingChangeDeps = {
    clearPairingScopedState: () => clearPairingScopedState(clearPairingDeps),
    navigateToPairingScreen: onUnpaired,
    navigateToNewServerList: () => dispatch({ type: 'pairServerPaired' }),
    // #1303 — the origin recorded when the flow opened, handed to the reducer as the event's own
    // destination. THIS OBJECT MUST STAY A PER-RENDER LITERAL, which it already is and which its own
    // header argues for a different reason (three members close over per-render values): hoisting it to
    // module scope, or wrapping it in a `useMemo` whose dependency array omits `pairServerReturn`, would
    // close over a stale origin and send cancel to the wrong surface — with no type error, and with no
    // test reddening but the three-origin cases in `pairedRoute.test.ts`.
    returnToPairingOrigin: () =>
      dispatch({ type: 'pairServerCancelled', returnTo: pairServerReturn })
  }
  return (
    <PairedShellView
      route={route}
      pairingOrigin={pairServerReturn}
      paneKey={paneKey}
      recoveryServerId={recoveryServerId}
      recoveryLabel={hostRowLabel(recoveryLabel)}
      recoveryRejected={recoveryStatus?.type === 'error' && recoveryStatus.error.code === 'pairing-rejected'}
      onRepairHost={openRecovery}
      // #448: opening a row records THAT conversation as active before navigating, the same
      // record-then-open the created-event path above performs — so the thread's wire actions (send,
      // snapshot, dequeue) target the clicked conversation's real id, not a placeholder. A
      // ConversationSummary carries every ConversationCreatedPayload field (plus two more), so the
      // store accepts it structurally; most-recent-wins replacement is the store's contract. #530: the
      // record goes through activateConversation, which clears the previous conversation's rows and
      // session id ONLY when the id changes — a re-click of the already-active row keeps its thread.
      // #670: this is the sidebar switch the two-pane shell exists to enable — clicking a row while a
      // DIFFERENT conversation's thread is up. Re-keying the pane on the clicked id is what stops that
      // thread's screen-local state from following the operator into the new one.
      onOpen={(conversation) => {
        leaveRecovery()
        activateConversation(activateDeps, conversation)
        setPaneKey(conversation.id)
        dispatch({ type: 'open' })
      }}
      onOpenSettings={() => { leaveRecovery(); dispatch({ type: 'openSettings' }) }}
      onOpenArchive={() => { leaveRecovery(); dispatch({ type: 'openArchive' }) }}
      onBack={() => { leaveRecovery(); dispatch({ type: 'back' }) }}
      // #1141: all three pairing-change callbacks go through `applyPairingChange`, which owns the
      // decision of WHICH of them ends a pairing and so clears. Only `unpaired` does. Wiring them
      // here rather than threading a dep into runUnpair puts the three on adjacent lines and leaves
      // ConversationScreen's own prop untouched, and the unpair arm inherits that path's fail-safe
      // posture verbatim: both unpair helpers call their route-flip dep only on `result: 'ok'`, so a
      // failed unpair reaches neither this callback nor the clear. Since #1163 they also call it only
      // when the erase left NOTHING paired, so forgetting one of several servers stays in the shell.
      // What changed at #1141 is `onPairServerPaired`, which
      // used to run the same clear as unpair on the argument that both "end a pairing" — it does not:
      // it ADDS a server beside the ones already paired, and the shell never unmounts, so the
      // conversation the operator was reading and everything scoped to it must survive intact.
      onUnpaired={() => applyPairingChange(pairingChangeDeps, 'unpaired')}
      // #1303 — BOTH entries arrive here: the Settings row's "Pair another server" and the plus on each
      // section header, which `PairedShellView` binds to this same prop. Recording the route FIRST is the
      // whole of the origin machinery — see `pairServerReturn` above for why it is read off `route` here
      // rather than passed in by whichever control was clicked. React batches the two calls, and the
      // arrow is re-created each render, so `route` is never a stale closure.
      onOpenPairServer={() => {
        leaveRecovery()
        if (route !== 'pairServer') setPairServerReturn(route)
        dispatch({ type: 'openPairServer' })
      }}
      onPairServerPaired={() => {
        // Refresh saved order after upsert; the loader contains its own failure mapping.
        void loadServerInfo(window.pyry.serverInfo, serverInfoStore.getState().setServers)
        // Saving is authorized across navigation; only the initiating flow may change the pane.
        if (pairingGeneration.current !== activePairingGeneration) return
        pairingGeneration.current += 1
        setRecoveryServerId(null)
        applyPairingChange(pairingChangeDeps, 'pairedAnotherServer')
      }}
      onPairServerCancelled={() => {
        leaveRecovery()
        window.pyry.sendDiagnostic({ event: 'pairing-recovery', code: 'cancelled' })
        applyPairingChange(pairingChangeDeps, 'cancelledPairAnotherServer')
      }}
    />
  )
}
