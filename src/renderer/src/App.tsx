import { useEffect, useState } from 'react'
import { PairedShell } from './PairedShell'
import { PairingScreen } from './screens/pairing/PairingScreen'
import { WelcomeScreen } from './screens/welcome/WelcomeScreen'
import { useDaemonEventBridge } from './store/daemonEventBridge'
import { useTimelineBridge } from './store/timelineBridge'
import { useModalBridge } from './store/modalBridge'
import { useQuestionBridge } from './store/questionBridge'
import { useHistoryPageBridge } from './store/historyPageBridge'
import { ConversationListData } from './store/conversationListBridge'
import { SessionIdData } from './store/sessionIdBridge'
import { RunSettingsWriteData } from './store/runSettingsWriteBridge'
import { QueueData } from './store/queueBridge'
import { RelayLinkData } from './store/relayLinkBridge'
import { BackgroundTaskRosterData } from './store/backgroundTaskRosterBridge'
import { AnnouncedModelData } from './store/announcedModelBridge'
import { ConversationActivityData } from './store/conversationActivityBridge'
import { SlashCommandListData } from './store/slashCommandListBridge'
import { ModelListData } from './store/modelListBridge'
import { SystemPromptData } from './store/systemPromptBridge'
import { SystemPromptWriteData } from './store/systemPromptWriteBridge'
import { RunConfigLiveData } from './screens/conversation/runConfigLive'
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
 * This is NOT the `?? activeConversation` fallback the `unrecognizedMessage` arm in `events.ts` bans.
 * That ban is about an arm that HAS a routing key being made optional so a consumer can paper over a
 * missing one. Neither of these two arms is attributed by `conversationIdOf`, and `timelineWriteTarget`
 * enumerates them BY NAME — an attributed arm never reaches this read at all. The enumeration is what
 * makes that safe, and #1192 is why it has to be: `sessionTransition` now carries a routing key on the
 * wire, this bridge still does not read it, and a name-by-name list says so deliberately where a
 * "carries no key" rationale would just have gone quietly false.
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
  // #785 injects the open-conversation read, so the two timeline arms this bridge does not attribute
  // from the event — the session boundary and the reconnect chrome reconcile — file into the thread on
  // screen instead of being dropped from the keyed store. Since #1192 the boundary's wire payload does
  // carry a conversation id; routing the delimiter by it is a separate deliverable, so this read still
  // covers both. The module-level constant above is what keeps this one
  // subscribe for the app's lifetime; passing an inline arrow here would resubscribe every render.
  useTimelineBridge(openConversationId)
  // #224: the modal bridge is the third independent subscriber on the one daemon-event channel (#202),
  // folding the two modal arms into modalStore so the outstanding permission/trust prompt becomes live
  // renderer state. App-lifetime and unconditional like its twins; it derefs window.pyry only inside its
  // effect, so the <App/> server-render test stays ''. Inert until #179 flips `interactive`.
  useModalBridge()
  // #906: the question bridge is the fourth independent subscriber on the one daemon-event channel
  // (#202), folding the two question arms into questionBatchStore so claude's outstanding clarifying
  // questions become live renderer state. App-lifetime and unconditional like its three twins, and for
  // the sharpened reason ConversationActivityData carries: a batch is raised against a conversation the
  // operator may not be looking at, so a screen-scoped mount would miss it and the panel would appear
  // only for whichever chat happened to be open when the daemon asked. It derefs window.pyry only inside
  // its effect, so the <App/> server-render test stays ''. This mount is what ends the vertical's dormant
  // period: #899's store and #900's bridge both shipped with nothing calling them.
  useQuestionBridge()
  // #1223: the history-page bridge is the fifth independent subscriber on the one daemon-event channel
  // (#202), folding a served page of past entries into rows at the head of that conversation's held
  // timeline. App-lifetime and unconditional like its four twins, and for the reason the question bridge
  // states: a page names its own conversation and may arrive for one the operator is not looking at, so
  // a screen-scoped mount would drop it. It takes no `openConversationId` — unlike `useTimelineBridge`
  // above, which needs one for the two arms carrying no id of their own — because a page's
  // `conversationId` is required and client-owned, so there is nothing to fall back to and nothing to
  // resolve. It derefs window.pyry only inside its effect, so the <App/> server-render test stays ''.
  // Live and idle until #1224 asks for a page.
  useHistoryPageBridge()
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
  // RunConfigLiveData (#810) is the NINTH headless leaf: it is now the only listener that lands
  // `runConfigReceived` into the run-config and session-id stores, and it re-requests the reply on the two
  // edges where the context-usage figures can have moved — each rising edge to `connected` and each
  // running → not-running turn transition. App-level for the reason the others are, sharpened: the whole
  // point is that the figures are current when the run-configuration sheet has NEVER been opened, and that
  // they stay current after it closes. It is the one leaf here that lives under `screens/` rather than
  // `store/` — its helpers are the conversation screen's, and it imports `isTurnRunning` from
  // ConversationScreen, which is what keeps it out of runConfigSnapshot.ts (that would be a cycle).
  // Unlike its neighbours it has a REQUEST half, because `session_settings` is reply-only: nothing pushes
  // it unsolicited, so a subscription alone would never see a second value. `RunConfigData` keeps its
  // per-open request inside the sheet and has lost its subscription to this leaf.
  // SlashCommandListData (#954) is the TENTH headless leaf: it lands each unsolicited
  // `slashCommandList` frame into the per-conversation slash-command store for the type-ahead (#940)
  // and the Actions-menu grey-out (#681). Same App-level always-listening rationale, sharpened the
  // way ConversationActivityData's is: the daemon publishes the menu from a conversation's
  // `initialize` reply, so a frame arrives for a conversation the operator may NEVER HAVE OPENED and
  // long before either consumer is mounted — a screen-scoped listener would miss exactly the case the
  // store exists for. Reactive-only, no gate, and — unlike the leaf above — no request half at all:
  // the list is pushed, never asked for, and delivery is best-effort, so a conversation with no menu
  // is a normal permanent state rather than something to retry. Ships dormant. Like AnnouncedModelData
  // and unlike BackgroundTaskRosterData it has no `connected` branch, because a reconnect to the same
  // daemon in the same working directory does not invalidate a published menu; its pairing-scoped clear
  // is clearPairingScopedState's (#955), not this leaf's.
  // ModelListData (#974) is the ELEVENTH headless leaf and the leaf above's structural twin: it lands
  // each unsolicited `modelList` frame into the per-conversation model-list store for the
  // run-configuration sheet's model rows (#975) and effort segments (#976), the input footer's model
  // and effort menus (#683), and the permission-mode menu (#682), which since #1022 reads each row's
  // `supports_auto_mode` to HIDE a mode the running model refuses. Both frames ride the SAME
  // `initialize` control reply — this one inventories the IDENTITIES claude will run as, that one the
  // VERBS the working directory will accept — so the App-level rationale is identical and equally
  // sharpened: a frame arrives for a conversation the operator may NEVER HAVE OPENED and long before
  // any of the four consumers is mounted, and without this mount every other criterion still passes
  // against an injected subscribe function while nothing ever writes the singleton. THIS LEAF is
  // reactive-only and has no gate: the list is pushed here, and since #1166 the request half that also
  // exists is fired from the conversation-activation path — the only place the conversation to name is
  // known — never from this mount. Delivery stays best-effort, so a conversation with no list is a normal
  // permanent state rather than something to retry. Ships dormant. No `connected` branch, for the reason
  // its twin has none; its pairing-scoped clear is clearPairingScopedState's (#977), not this leaf's.
  // SystemPromptData (#1231) is the TWELFTH headless leaf: it lands the correlated `systemPromptReceived`
  // reply — what system prompt the open conversation holds, and whether the running session was started
  // with a different one — into the single-slot system-prompt store for the editor surface (#1078). The
  // App-level rationale is the OTHER HALF of its neighbours': this arm is REPLY-ONLY, so unlike the two
  // pushed frames above it can never arrive for a conversation the operator has never opened — but a
  // reply CAN land after the operator has navigated on, so a screen-scoped listener would unmount before
  // the reply its attribution gate exists to adjudicate ever arrives, and the drop would be silent. That
  // gate is `subscribeSystemPrompt`'s third parameter, read per event: a reply describing any chat but
  // the open one is dropped rather than held, and one arriving with nothing open lands nowhere.
  // Reactive-only, no gate, no `connected` branch: the ask that makes this arm fire at all is
  // `requestSystemPrompt`, sent from the conversation-activation path (PairedShell's
  // `requestConversationConfig`) — the only place the conversation to name is known — never from this
  // mount, and it is a one-shot on open rather than a retry. Its conversation-lifetime clear is the
  // shared `clearRunConfig` dep member's, not this leaf's. Ships dormant.
  // SystemPromptWriteData (#1250) is the THIRTEENTH headless leaf and the leaf above's write-side
  // counterpart: it folds the two correlated `set_system_prompt` outcomes — one confirmation, one
  // refusal carrying which of four conditions it was — into the system-prompt write store the editor
  // surface (#1078) will read, and flips the `connected` edge into the clear that drops the markers a
  // re-dial stranded. App-level for RunSettingsWriteData's reason rather than its read twin's: an
  // outcome can arrive AFTER the editor surface closes, so a surface-scoped listener would miss it and
  // strand a marker reporting a save as permanently in flight — and that rationale covers the reconnect
  // clear for free, since that edge fires whether or not the editor is open. Unlike its read twin it
  // takes NO attribution gate: the store is keyed by conversation id, so an outcome naming a
  // conversation with nothing in flight settles nothing by construction, and a gate would give one
  // decision two implementations. Reactive-only — the outbound half (`submitSystemPrompt`) is called
  // from the editor surface, the only place the value to write is known, never from this mount, and it
  // is never a retry. Its conversation-lifetime clear is the shared `clearRunConfig` dep member's, not
  // this leaf's. Ships dormant.
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
      <RunConfigLiveData />
      <SlashCommandListData />
      <ModelListData />
      <SystemPromptData />
      <SystemPromptWriteData />
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
