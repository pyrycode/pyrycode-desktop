import './pairedShell.css'
import { useReducer, useState } from 'react'
import type { ConversationSummary } from '@shared/wire/types'
import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { ChannelList } from './screens/channels/ChannelList'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { ArchiveScreen } from './screens/archive/ArchiveScreen'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { nextPairedRoute, type PairedRoute } from './pairedRoute'
import { useConversationCreatedNav } from './store/conversationCreatedBridge'
import { useConversationDeletedExit } from './store/conversationDeletedBridge'
import { useArchivedActiveConversationExit } from './store/conversationArchivedBridge'
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
import { activeConversationStore } from './store/activeConversationStore'
import { announcedModelStore } from './store/announcedModelStore'
import { conversationLastReadStore } from './store/conversationLastReadStore'
import { conversationTimelineStore } from './store/conversationTimelineStore'
import { modelListStore } from './store/modelListStore'
import { conversationListStore } from './store/conversationListStore'
import { queueStore } from './store/queueStore'
import { backgroundTaskRosterStore } from './store/backgroundTaskRosterStore'
import { modalStore } from './store/modalStore'
import { sessionIdStore } from './store/sessionIdStore'
import { sessionStore } from './store/sessionStore'
import { slashCommandListStore } from './store/slashCommandListStore'
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
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
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
  markViewed: (conversationId) => conversationTimelineStore.getState().markViewed(conversationId)
}

/**
 * #531: the store wiring for the pairing-ended clear, module scope for the same reason as
 * `activateDeps` above — each effect reaches its singleton through `getState()` inside the arrow body,
 * so nothing is dereferenced at module load, nothing is read during render, and the object closes over
 * no per-render value. `sessionStore`, `announcedModelStore`, `slashCommandListStore` and
 * `modelListStore` appear here and nowhere else in this file; PairedShell still subscribes to no store
 * at all and stays server-renderable. #593 widened the set with the announced running model, #779 with
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
  clearSessionId: () => sessionIdStore.getState().clearSessionId()
}

const clearPairingDeps: ClearPairingScopedStateDeps = {
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearAllTimelines: () => conversationTimelineStore.getState().clearAllTimelines(),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  clearAnnouncedModel: () => announcedModelStore.getState().clearAnnouncedModel(),
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
  dispatchSession: (action) => sessionStore.getState().dispatch(action),
  // #779: how far the operator read on the ended pairing's server — cleared in memory AND on disk, since
  // #776 persists the marks. It reaches its store DIRECTLY rather than through
  // `conversationLastReadDeps`, the `markViewed` argument above: the bridge's deps object exists so the
  // SAMPLING branch lives in one tested place, and there is no sampling branch here — the store method
  // takes nothing at all. Widening `ConversationLastReadDeps` with a member the stamp path never uses
  // would put an unused effect on a tested interface.
  clearAllLastRead: () => conversationLastReadStore.getState().clearAllLastRead()
}

/**
 * The pure route→view of the paired region — no hooks, no effects — mirroring how AppView lives beside
 * App. `list` and `thread` both show the #670 two-pane desktop shell: the Channel List sidebar (#141)
 * beside a chat pane that holds the store-backed ConversationScreen on `thread` and nothing on `list`.
 * `settings` shows the Settings scaffold (#333); `archive` shows the Archive scaffold (#347);
 * `pairServer` re-opens the existing PairingScreen from inside the paired app to switch daemons (#152).
 * Those last three replace the WHOLE shell with a full-screen <section> — that is #670's AC5 (Settings,
 * Archive and Pair-another open over both panes) and it cost no edit, which is why the route model was
 * left alone. Adding a future view is one new case, forced by the assertNever default (AC1: an added
 * arm, not a rewrite). The `settings` and `archive` cases reuse the same `onBack` as `thread` (all
 * dispatch `back`, which the absolute `back` arm lands on `list` — now "deselect the conversation and
 * leave the pane empty" rather than "navigate away from the thread").
 *
 * The `pairServer` case passes no `bridge` to PairingScreen — production uses its `window.pyry` default
 * (bridge ?? window.pyry), the same as App's `pairing` route. The two seams are distinct destinations:
 * onCancel → settings (non-destructive, AC4) and onPaired → the new server's list (AC3), so they wire to
 * separate callbacks rather than sharing `onBack`.
 */
export function PairedShellView(props: {
  route: PairedRoute
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
  switch (props.route) {
    // #670: `list` and `thread` stopped being alternative SCREENS and became one two-pane shell — the
    // sidebar is mounted in both, and the route only decides whether the chat pane holds a thread. They
    // share one arm because the markup is identical; the ternary below is the only fork. Combining the
    // two labels is not a fallthrough (no statement sits between them), so assertNever still narrows to
    // `never` and a sixth route member is still a compile error.
    //
    // Because both routes render ChannelList at the SAME element position, React preserves its subtree
    // across the list↔thread flip instead of remounting it — safe and desirable here: ChannelList is
    // bound to the live useConversationListStore and has no mount-time fetch a remount was refreshing,
    // so its scroll position now survives opening a conversation.
    //
    // The pane renders `null`, never a mounted-but-blank ConversationScreen (AC4). That is load-bearing
    // beyond the ticket's own wording: four e2e assertions use `.conversation` toHaveCount(0) as their
    // "left the thread" proof, which a blank-but-mounted pane would time out. Per the operator, the
    // empty pane stays genuinely empty — no placeholder, illustration or call to action; the wrapper
    // <div> survives only as the layout slot.
    case 'list':
    case 'thread':
      return (
        <div className="paired-shell">
          <div className="paired-shell__sidebar">
            <ChannelList
              onOpen={props.onOpen}
              onOpenSettings={props.onOpenSettings}
              onOpenArchive={props.onOpenArchive}
            />
          </div>
          <div className="paired-shell__pane">
            {props.route === 'thread' ? (
              // `key` is the pane's IDENTITY, not decoration. Switching conversations from the
              // now-always-mounted sidebar leaves the route on `thread` (`open` is absolute), so React
              // reconciles two `thread` renders by PRESERVING this subtree — a path that was unreachable
              // before the shell, because the list was unmounted while a thread was up. Every
              // useState/useRef inside ConversationScreen was written on the assumption that a remount
              // always separates two conversations — five of them say so in as many words (:137 the
              // run-config sheet, :142 Channel info, :147 the workspace picker, :152 the background-task
              // panel, :162 the scroll pin, each "resets on remount for free"), and the composer's draft
              // (:1787) is the sharpest case: it would follow the operator into the conversation they
              // switched to and be SENT there. That is AC4's "never a
              // stale one from a previous selection", and the store-side clear (activateConversation)
              // cannot cover it — it clears the timeline and session id, not screen-local state.
              <ConversationScreen
                key={props.paneKey}
                onUnpaired={props.onUnpaired}
                onBack={props.onBack}
              />
            ) : null}
          </div>
        </div>
      )
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
  // The chat pane's identity (see PairedShellView's `paneKey` prop). Screen-local, ADR 0006, beside the
  // nav reducer — deliberately NOT a subscription to activeConversationStore, which would make this
  // container a store subscriber and give up the server-renderable invariant the two dep-object comments
  // above assert. It does not need to be: the two paths that activate a conversation are BOTH right here
  // (the created-event nav below and `onOpen`), each already holding the conversation it is activating, so
  // the id is recorded from the nav action rather than read back out of a store. The set is exactly
  // co-located with `activateConversation` — that call is the marker for "a third activation must record
  // the id too". The nullary `open` (a notification click, below) records nothing on purpose: it means
  // "show the conversation that is already active", so the pane's identity has not changed. Nothing clears
  // it on the way out either: the exits (delete, archive, unpair, pair-another) all land on a route where
  // the pane renders `null`, so the subtree is destroyed and a stale id cannot preserve anything.
  const [paneKey, setPaneKey] = useState<string | null>(null)
  // The created-event → list→thread nav. #278: also record the created payload (its `cwd` feeds the
  // empty-thread workspace chip) — the callback already receives this payload and previously dropped it.
  // #530: recording now goes through activateConversation, which first clears the previous
  // conversation's timeline rows and daemon session id when the id actually changes — so a newly
  // created discussion opens on an empty thread instead of the last one's history.
  // #670: the FAB's create is a conversation switch too when a thread is already open — `open` is
  // absolute, so the route does not move and the pane would otherwise keep the previous discussion's
  // composer draft. Re-key it on the minted id.
  useConversationCreatedNav((created) => {
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
      { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
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
        { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
        conversationId
      )
  )
  // #393: a notification click drives the same list→thread `open` nav (focus the window + show the
  // active conversation's thread). Crucially NO setActiveConversation — the nullary arm carries no
  // payload; in the single-active model "open" means "show the existing active conversation", so this
  // reuses the existing transition (absolute → thread from any paired view, AC2) with no new route or arm.
  useNotificationActivatedNav(() => dispatch({ type: 'open' }))
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
  // listening. It subscribes for its effect only, never for render, so this container still subscribes to
  // no store and stays server-renderable.
  useConversationLastRead()
  // #1141: the pairing-change wiring, and the ONE dep object in this file that cannot live at module
  // scope — three of its four members close over per-render values (`onUnpaired`, `dispatch`). That
  // is `exitConversationDeps`' situation one notch further: there the single container-bound member
  // is supplied at the call site and an `Omit` keeps the rest module-scope, which is not worth doing
  // for a majority. The per-render allocation is free, exactly as it is for the inline arrows this
  // replaces, and the container still subscribes to no store and stays server-renderable.
  //
  // `clearPairingScopedState` is nullary HERE: `applyPairingChange` decides whether a change clears,
  // never what the clear contains, so `clearPairingDeps` stays module-scope above and the thirteen
  // stores stay behind the helper that enumerates and tests them.
  const pairingChangeDeps: PairingChangeDeps = {
    clearPairingScopedState: () => clearPairingScopedState(clearPairingDeps),
    navigateToPairingScreen: onUnpaired,
    navigateToNewServerList: () => dispatch({ type: 'pairServerPaired' }),
    returnToSettings: () => dispatch({ type: 'pairServerCancelled' })
  }
  return (
    <PairedShellView
      route={route}
      paneKey={paneKey}
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
        activateConversation(activateDeps, conversation)
        setPaneKey(conversation.id)
        dispatch({ type: 'open' })
      }}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onOpenArchive={() => dispatch({ type: 'openArchive' })}
      onBack={() => dispatch({ type: 'back' })}
      // #1141: all three pairing-change callbacks go through `applyPairingChange`, which owns the
      // decision of WHICH of them ends a pairing and so clears. Only `unpaired` does. Wiring them
      // here rather than threading a dep into runUnpair puts the three on adjacent lines and leaves
      // ConversationScreen untouched, and the unpair arm inherits that path's fail-safe posture
      // verbatim: `runUnpair` calls `onUnpaired` only on `result: 'ok'`, so a failed unpair reaches
      // neither this callback nor the clear. What changed at #1141 is `onPairServerPaired`, which
      // used to run the same clear as unpair on the argument that both "end a pairing" — it does not:
      // it ADDS a server beside the ones already paired, and the shell never unmounts, so the
      // conversation the operator was reading and everything scoped to it must survive intact.
      onUnpaired={() => applyPairingChange(pairingChangeDeps, 'unpaired')}
      onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
      onPairServerPaired={() => applyPairingChange(pairingChangeDeps, 'pairedAnotherServer')}
      onPairServerCancelled={() =>
        applyPairingChange(pairingChangeDeps, 'cancelledPairAnotherServer')
      }
    />
  )
}
