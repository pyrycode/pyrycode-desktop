import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEventHandler
} from 'react'
import './conversation.css'
import { AssistantMarkdown } from './AssistantMarkdown'
import type { Message } from './messageViewModel'
import type { QueuedItem, ConversationCreatedPayload } from '@shared/wire/types'
import type { RelayLinkStatus } from '@shared/ipc/events'
import { useSessionStore, selectStatus, type ConnectionStatus } from '../../store/sessionStore'
import { useRelayLinkStore, selectRelayLinkStatus } from '../../store/relayLinkStore'
import {
  useTimelineStore,
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry,
  selectCompacting,
  selectLocalSendPending
} from '../../store/timelineStore'
import { useQueueStore, selectBacklogFor } from '../../store/queueStore'
import {
  useActiveConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'
import type {
  ThreadItem,
  TurnPhase,
  ApiRetryStatus,
  UnrecognizedSite
} from '../../store/threadTimeline'
import {
  submitMessage,
  shouldSubmitOnKeyDown,
  composerAvailability,
  shouldOfferRepair,
  shouldShowBanner,
  CONNECTION_BANNER_COPY
} from './composerSend'
import { isAtBottom } from './threadScrollPosition'
import { toolHeadline } from './toolHeadline'
import { runUnpair } from './unpairAction'
import { dropQueuedMessage } from './dropQueuedMessage'
import { sendInterrupt } from './sendInterrupt'
import { RunConfigData } from './RunConfigData'
import { RunConfigSections } from './RunConfigSections'
import { LogDataSection } from './LogDataSection'
import { PermissionModal } from './PermissionModal'
import { sessionBoundaryTitle } from './sessionBoundaryViewModel'
import { formatLastActivity, titleFor } from '../channels/channelListViewModel'
import {
  RenameConversationDialogView,
  requestRenameConversation
} from '../channels/RenameConversationDialog'
import { WorkspacePickerSheet } from './WorkspacePickerSheet'
import { BackgroundTaskPanel } from './BackgroundTaskPanel'
import type { RendererCommand } from '@shared/ipc/commands'

// The conversation shell: a scrollable message thread above a pinned composer,
// styled from the mobile Conversation Thread screen (Figma node 16-8) stretched
// to the window. Since #179 the thread reads the structured-stream timeline store
// (the single thread surface); the composer's echo writes there too.
//
// ConversationScreen is the store-bound container (smoke-tested for "renders without
// throwing"); Timeline is the pure, props-in/markup-out view that the tests server-render with
// an injected ThreadItem[] — the same container/view split PairingScreen uses. MessageThread /
// MessageBubble are retained as pure, still-tested residue of the retired coarse path (a later
// cleanup ticket removes them). Composer and UnpairControl stay in-file.
export interface ConversationScreenProps {
  // The App route flip back to pairing (#166), mirroring PairingScreen's onPaired. Optional so the
  // existing bare `<ConversationScreen />` server-render tests stay green; when absent, unpair still
  // clears + resets, it just doesn't navigate.
  onUnpaired?: () => void
  // #140: return from the thread to the paired shell's list view (the leading arrow_back of Figma
  // 16-9). Optional and gated exactly like onUnpaired: when absent, BackControl renders null, so a
  // bare `<ConversationScreen />` keeps today's behavior with no top-bar back affordance (AC3). The
  // PairedShell-mounted thread wires it to a nav dispatch.
  onBack?: () => void
}

export function ConversationScreen({
  onUnpaired,
  onBack
}: ConversationScreenProps = {}): JSX.Element {
  // #179: the structured-stream timeline slice is now the single thread surface — the coarse
  // `MessageThread` is retired (its mount + the `selectMessages` read are gone), and the composer's
  // optimistic echo routes here as a `userText` item beside the daemon's structured reply. `ThreadItem`
  // is already the render model (ADR 0008, camelCase, conversation_id-free) so it flows straight to the
  // pure Timeline view — no adapter. Selecting only the items slice keeps a stream delta from
  // re-rendering unrelated facets.
  const items = useTimelineStore(selectItems)
  // #215: the coarse `phase` scalar, read beside the items slice (mirrors the selectItems → Timeline
  // line above). The container derives the indicator state and passes only that down, so the LABEL CHOICE
  // is a closed client-owned union rather than a daemon value. (#649 narrows the original claim here: the
  // indicator now also takes one separately-named `toolName` prop derived from `items`, which IS a daemon
  // string — deliberately, per the operator's 2026-08-20 decision. See ThinkingIndicator below.)
  // Selecting only `phase` adds no meaningful churn — the container already re-renders per items delta.
  // Inert in production until #179 flips `interactive` (phase stays `idle`), so the indicator is null.
  const phase = useTimelineStore(selectPhase)
  // #317: the coarse `stalled` scalar, read beside `phase` (the selectPhase line above). The container
  // passes only the plain boolean down, so no daemon-supplied string reaches the view — AC4 is a
  // type-level guarantee, and the stall frame carries no daemon content anyway. `stalled` flips at most
  // twice per stall, so it adds no meaningful re-render churn beyond the items delta already here.
  const stalled = useTimelineStore(selectStalled)
  // #493: the api-retry status, read beside `stalled` (the selectStalled line above). A narrow single-slice
  // read of a record the container passes straight down; the view's prop carries two integers and no string
  // field, so AC1 stays a type-level guarantee. Re-render churn is bounded by the reducer's
  // same-reference discipline: every carry-through arm passes the SAME status object and a verbatim
  // repeated rising edge returns the same state, so a repeated frame produces zero re-renders under
  // zustand's Object.is comparison.
  const apiRetry = useTimelineStore(selectApiRetry)
  // #496: the compaction scalar, read beside `apiRetry` (the selectApiRetry line above). A plain boolean
  // the container passes straight down, so AC1 ("no daemon-supplied string is ever rendered") stays a
  // type-level guarantee — the compacting frame carries no string field at all. `compacting` flips at most
  // twice per compaction, and the reducer returns the same state reference on a verbatim repeated frame,
  // so it adds no re-render churn beyond the items delta already here.
  const compacting = useTimelineStore(selectCompacting)
  // #650: the locally-opened working-indicator window, read beside `compacting` (the selectCompacting line
  // above). The FIRST renderer-sourced slice among these five — the operator's own send opened it, not the
  // daemon — and the container passes only the plain boolean into the derivation, so no daemon-supplied
  // string reaches the view through it. It flips at most twice per turn and every carry-through reducer arm
  // preserves the state reference, so it adds no re-render churn beyond the items delta already here.
  const localSendPending = useTimelineStore(selectLocalSendPending)
  // #278: the conversation the thread is showing, snapshotted when the new discussion was created
  // (PairedShell's conversation_created callback). The container derives it and passes it down; the
  // pure WorkspaceChip self-gates to null. A narrow single-slice read — activeConversation changes
  // once (on creation), so it adds no meaningful re-render churn beyond the items delta already here.
  const activeConversation = useActiveConversationStore(selectActiveConversation)
  // #177: the Run configuration sheet's open/closed state — a single-value screen-local boolean →
  // useState, never the store (ADR 0006). It resets to closed on remount for free, so the sheet
  // never reopens itself across a screen remount. The StatusRow trigger sits between the thread and
  // the composer (per Figma); the sheet overlays the whole conversation surface as the last child.
  const [sheetOpen, setSheetOpen] = useState(false)
  // #365: the Channel Info sheet's open/closed state — the `sheetOpen` twin, a single-value screen-local
  // boolean → useState, never the store (ADR 0006), resetting to closed on remount for free. The overflow
  // menu's Channel-info item flips it open; the sheet reads the same `activeConversation` slice already
  // held above. Independent of `sheetOpen`: separate triggers, one sheet at a time in normal use.
  const [channelInfoOpen, setChannelInfoOpen] = useState(false)
  // #383: the Workspace Picker sheet's open/closed state — the `channelInfoOpen` twin, a single-value
  // screen-local boolean → useState, never the store (ADR 0006), resetting to closed on remount for free.
  // The WorkspaceChip's "Change" button flips it open (the named "#157 Workspace Picker seam"); the sheet
  // reads the same `activeConversation` slice and `now` clock already held. One sheet at a time in normal use.
  const [pickerOpen, setPickerOpen] = useState(false)
  // #581: the background-task panel's open/closed state — the `pickerOpen` twin, a single-value
  // screen-local boolean → useState, never the store (ADR 0006), resetting to closed on remount for free.
  // The BackgroundTaskTrigger beside the status row flips it open; the panel reads the roster store itself
  // and needs only the active conversation's id, derived from the `activeConversation` slice already held
  // above (no second subscription). One overlay at a time in normal use.
  const [panelOpen, setPanelOpen] = useState(false)
  // #286: the render-time clock for the session-boundary delimiter's relative time (`2 hours ago`).
  // A plain render-local value, not store state (the ChannelList precedent) — safe under
  // renderToStaticMarkup, adds no subscription, and re-derives on each render so the label stays fresh.
  const now = Date.now()
  // #601: the follow-the-conversation pin. Screen-local, held beside the other screen-local values above —
  // nothing outside this screen reads it and it must not survive a remount (ADR 0006), so a re-entered
  // thread starts pinned again, which is the correct reading. The two handles go to Timeline as one prop.
  // #602: `followBottom` re-arms that pin and goes to the Composer, the thread's sibling under this body.
  const { scrollPin, followBottom } = useThreadScrollPin()
  return (
    <div className="conversation">
      <BackControl onBack={onBack} />
      {/* #276: the trailing overflow menu (Figma 16-16) — the single entry point to per-conversation
          actions. #365 wires its Channel-info item to open the Channel Info sheet (below): the seam is no
          longer a no-op. Gated on onBack presence, the established "mounted in the paired shell" signal
          (BackControl's gate): a bare `<ConversationScreen />` shows neither. Gated at the mount site, not
          self-gated, so ThreadOverflowMenu's hooks stay unconditional (rules-of-hooks). */}
      {onBack && <ThreadOverflowMenu onChannelInfo={() => setChannelInfoOpen(true)} />}
      <UnpairControl onUnpaired={onUnpaired} />
      {/* #279: the prominent, disconnected-only connection banner — the top of the thread, below the
          header row and above the message list. A third read of the connection status, distinct from
          the composer's terse inline gate below. */}
      <ConnectionBannerControl />
      {/* #278: the pre-first-message workspace chip — a sibling above Timeline, not nested inside
          EmptyThread, so Timeline's { items, now } contract stays untouched (no prop cascade). It
          self-gates to null unless the thread is empty and shows an unpromoted (discussion) conversation. */}
      <WorkspaceChip
        conversation={activeConversation}
        isEmpty={items.length === 0}
        onChange={() => setPickerOpen(true)}
      />
      <Timeline items={items} now={now} scrollPin={scrollPin} />
      {/* #648: the gate now tracks the WHOLE running turn (thinking or responding), so a turn spent mostly
          in tool calls no longer reads as a frozen screen; the label tracks the phase. #493/#496 still
          narrow it — a live api-retry, or a live compaction, supersedes this indicator in either phase.
          #649: and the label now NAMES the open tool, derived from the same `items` array Timeline is
          mapping one line above (no second subscription) — so a long turn says what it is doing, not just
          that it is busy. Two derivations, two props: the closed client-owned label choice, and the one
          daemon string.
          #650: and the window now opens the moment the composer accepts the submit, rather than a network
          round-trip later — closing the blank window in FRONT of a turn, as #648 closed the one behind it.
          The local signal composes INSIDE the gate, so #493's and #496's supersede rules apply to it
          unchanged; it stays out of `phase`, so the interrupt control below is untouched by it. */}
      <ThinkingIndicator
        state={workingIndicatorStateWithLocalSend({ phase, apiRetry, compacting }, localSendPending)}
        toolName={openToolName(items)}
      />
      {/* #493: the api-error retry status — mounted directly after its supersede peer, before the stall
          indicator. Shows on a rising edge and clears ONLY on the daemon's explicit falling edge (turn
          activity leaves it showing — the deliberate inverse of the stall indicator). Renders nothing at
          rest. It may still co-render with the stall indicator: AC5 scopes mutual exclusion to thinking. */}
      <ApiRetryIndicator retry={apiRetry} />
      {/* #496: the auto-compaction status — mounted beside its fellow thinking-superseder, still above the
          stall indicator. Shows on a rising edge and clears ONLY on the daemon's explicit falling edge
          (turn activity leaves it showing — the deliberate inverse of the stall indicator). Renders
          nothing at rest, and adds no timeline row while live: it is transient chrome (AC5). It may still
          co-render with the retry and stall statuses: AC4 scopes mutual exclusion to thinking. */}
      <CompactingIndicator isCompacting={compacting} />
      {/* #317: the stalled-turn problem-state indicator — a sibling of the thinking indicator in the
          message-list region. Shows on a daemon stall onset and self-clears (in the reducer) on the next
          turn activity. Renders nothing at rest. */}
      <StallIndicator isStalled={stalled} />
      {/* #294: the held queued backlog — the not-yet-run tail below the delivered thread and the
          working indicator, above the run-config row and composer. Renders nothing when empty. */}
      <QueuedBacklogControl />
      <StatusRow onExpand={() => setSheetOpen(true)} />
      {/* #581: the background-task panel's trigger — a StatusRow sibling in the same region between the
          thread and the composer. Rendered unconditionally, NOT gated on tasks existing: gating would make
          both non-populated panel readings unreachable through the UI. It carries no count badge — a badge
          would need its own roster subscription, which is the panel's job and #580's design call. */}
      <BackgroundTaskTrigger onOpen={() => setPanelOpen(true)} />
      {/* #307: the running-turn interrupt control — a standalone block, right-aligned over the
          composer's send side, shown only while a turn is running (phase thinking or responding) and
          retracting on the daemon's turn_state{idle}. Renders nothing at idle. */}
      <InterruptControl />
      {/* #602: sending is the one act that overrides the conditional pin, so the Composer reports "a
          message entered the timeline" and this screen — which owns the flag — decides that means follow
          the bottom. The Composer learns nothing about scrolling. */}
      <Composer onMessageSent={followBottom} />
      <RepairControl onUnpaired={onUnpaired} />
      {sheetOpen && (
        <StatusSheet onClose={() => setSheetOpen(false)}>
          {/* #187: the headless data path — requests a snapshot on open and holds Model/Effort/YOLO.
              Renders nothing (DOM order immaterial); #188 renders the held values here. */}
          <RunConfigData />
          {/* #188: the read-only Model / Effort / YOLO sections, reading the held snapshot. */}
          <RunConfigSections />
          {/* Log data is the last section ("beneath Context-window"); #182 prepends the
              Context-window section above it as it lands. */}
          <LogDataSection />
        </StatusSheet>
      )}
      {/* #365: the Channel Info sheet — the StatusSheet twin, overlaying the conversation surface with the
          active conversation detail. Reuses the render-time `now` (the Last-activity relative time) and the
          `activeConversation` slice already read above; `null` (a list-opened thread with no create this
          session) still opens gracefully to chrome + a placeholder About. Its empty Actions slot is the
          mount point #366/#367/#368 fill. */}
      {channelInfoOpen && (
        <ChannelInfoSheet
          conversation={activeConversation}
          now={now}
          onClose={() => setChannelInfoOpen(false)}
        />
      )}
      {/* #383: the Workspace Picker sheet — the ChannelInfoSheet twin, overlaying the conversation surface.
          Reuses the render-time `now` (the "Last used …" relative time) and the `activeConversation` slice
          already read above; the container mounts the #382 data-path bridge, marks the current workspace,
          and dispatches `change_workspace` on selection. Opened from the WorkspaceChip's "Change" button. */}
      {pickerOpen && (
        <WorkspacePickerSheet
          conversation={activeConversation}
          now={now}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {/* #581: the background-task panel — the WorkspacePickerSheet twin, overlaying the conversation
          surface with the tasks the daemon holds alive for the open conversation. It reads the roster store
          itself, so only the conversation id goes down; with no active conversation the id is null and the
          panel reads "never observed", which is the correct reading. It mounts no data path — the roster
          bridge is already app-wide in App.tsx. Opened from the trigger beside the status row. */}
      {panelOpen && (
        <BackgroundTaskPanel
          conversationId={activeConversation?.id ?? null}
          onClose={() => setPanelOpen(false)}
        />
      )}
      {/* #224: the interactive permission/trust modal — the last child so it overlays the whole
          conversation surface (the StatusSheet placement). Renders null until an outstanding prompt
          exists, so the layout is unchanged today (inert until #179 flips `interactive`). */}
      <PermissionModal />
    </div>
  )
}

/**
 * The two DOM handles the thread's scroll container needs from the screen. Bundled into ONE value rather
 * than passed as two props so "wired the ref, forgot the handler" is unrepresentable: both or neither.
 */
export interface ThreadScrollPin {
  ref: RefObject<HTMLDivElement>
  onScroll: UIEventHandler<HTMLDivElement>
}

/**
 * What the screen gets back from the pin: the DOM bundle above, plus the one control that re-arms it.
 *
 * `followBottom` is deliberately NOT a third member of ThreadScrollPin. That interface's value is that it is
 * exactly "the two DOM handles the thread's scroll container needs" — both-or-neither is honest only while
 * both are handles for the same node — and it is Timeline's prop type, so a third member would widen
 * Timeline's contract with a value Timeline never reads. This one goes to a different component entirely
 * (the Composer) and touches no DOM node.
 *
 * File-local: nothing outside this module names it.
 */
interface ThreadPin {
  scrollPin: ThreadScrollPin
  /** Resume following the bottom. Called when the operator's own message enters the timeline (#602). */
  followBottom: () => void
}

// The standard isomorphic alias. `document` exists in the window and NOT in vitest's `node` environment
// (vitest.config.ts:27), where the renderer tests server-render through renderToStaticMarkup — and React 18
// logs "useLayoutEffect does nothing on the server" for every component reached that way. There are 33
// `<ConversationScreen` render sites in the renderer tests, so without this the pin would add 33 lines of
// warning noise to every `npm test` run (observed, not projected). Neither hook runs under
// renderToStaticMarkup, so behaviour there is unchanged; in the app `document` exists and the re-assert
// keeps the pre-paint guarantee it actually needs.
const useThreadLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/**
 * #601: keep the thread following the conversation while the operator is already reading at the bottom.
 *
 * The ORDER of the decision is the whole design. The flag is written only by the container's own scroll
 * events; the re-assert reads that flag and never re-measures. A measurement taken when new content lands
 * reads a layout that already includes it, so it cannot say whether the operator was at the bottom
 * beforehand. Mobile draws the same separation with its `userScrolledAway` flag (ThreadScreen.kt:249-256) —
 * what carries over from mobile is the flag, not the measurement (it reverses its layout and tests an exact
 * index, so it has no pixel band to copy).
 *
 * A `useRef`, not `useState`, and deliberately so: nothing renders this value — no markup, class, or
 * attribute depends on it — and scroll events fire at frame rate, so `useState` would re-render the app's
 * most expensive subtree on every scroll frame for a value nothing displays. "State updated from the
 * container's scroll events" means tracked across time, which a ref is.
 *
 * It starts `true`, so a fresh thread pins from its first message. That also covers the late-mounting node
 * (Timeline renders <EmptyThread /> at zero items, so `.conversation__thread` mounts only once an item
 * lands) with no guard of its own, and the merged helper already answers at-bottom for a thread too short
 * to scroll — the distance goes negative when content is no taller than the viewport.
 *
 * Nothing to tear down: `onScroll` is a React prop, so the listener's lifetime is the node's, and there is
 * no manual addEventListener whose attach could race the late mount.
 *
 * #602 adds the one documented exception to "only the operator's own scrolling writes this flag": sending is
 * the operator's own act of moving the conversation forward, so the view follows unconditionally. That is
 * `followBottom` below — a single re-arming assignment, no second mechanism. Because the re-assert has no
 * dependency array it already runs after every render, so "jump to the bottom now" and "stay pinned while
 * the reply streams" are not two behaviours: both are consequences of the flag being `true`.
 */
function useThreadScrollPin(): ThreadPin {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  // NO dependency array — this runs after every render of the screen, and that is what makes the chrome
  // case work rather than being a missing optimization. The working, stall, retry and compaction
  // indicators, the queued backlog, the interrupt control and the status row mount off four different store
  // slices; enumerating them in a dependency array would be exactly the fragile coupling to avoid, and it
  // would rot silently the moment an eighth affordance lands. Every one of those mounts IS a re-render
  // here, so "after every render" covers an items change and a chrome change under one rule.
  //
  // Two properties make the dep-free form safe. It is IDEMPOTENT: it writes only while following, and
  // assigning scrollTop a value it already holds is a no-op that fires no scroll event, so there is no
  // feedback loop (and a StrictMode double-invoke is likewise a no-op). And chrome CANNOT corrupt the flag:
  // a chrome mount shrinks clientHeight while leaving scrollTop and scrollHeight untouched, which raises
  // the maximum scroll offset, so the browser never clamps scrollTop and no scroll event fires at all.
  useThreadLayoutEffect(() => {
    const el = ref.current
    if (el === null || !following.current) return
    // Past the maximum; the browser clamps to exactly the bottom.
    el.scrollTop = el.scrollHeight
  })

  return {
    scrollPin: {
      ref,
      // The metric mapping is the one thing this feature can get wrong with no type error and no unit test:
      // scrollTop is the offset, clientHeight the viewport, scrollHeight the total content. Named fields are
      // what make it correct by inspection. Read synchronously off `currentTarget` and assigned with no
      // branch of its own — every case is a consequence of isAtBottom's single comparison. No useCallback:
      // Timeline is not memoized, so a stable identity buys nothing and React attaches this directly.
      onScroll: (event) => {
        const el = event.currentTarget
        following.current = isAtBottom({
          scrollOffset: el.scrollTop,
          viewportHeight: el.clientHeight,
          contentHeight: el.scrollHeight
        })
      }
    },
    // #602: one assignment, and deliberately nothing more — no measurement of its own and no immediate
    // scrollTop write. The echo is already in the store when this runs (submitMessage dispatches before it
    // returns), and the app mounts through ReactDOM.createRoot (main.tsx:6), so React 18's automatic
    // batching flushes that update only once the discrete event handler returns. The render that mounts the
    // echo therefore always comes after this, and the dep-free re-assert above scrolls it into view before
    // paint. A second write here would defend an ordering that cannot occur and would only re-scroll a
    // container whose content has not grown yet.
    //
    // No useCallback, for onScroll's reason verbatim: Composer is not memoized, so it re-renders with this
    // screen regardless of prop identity and a stable identity buys nothing.
    followBottom: () => {
      following.current = true
    }
  }
}

export function MessageThread({ messages }: { messages: Message[] }): JSX.Element {
  // Renders the adapted messages in arrival order. An empty array renders a valid
  // (empty) scroll region — no crash, no placeholder fallback.
  return (
    <div className="conversation__thread">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: Message }): JSX.Element {
  return (
    <div className={`message-row message-row--${message.type}`}>
      <div className={`bubble bubble--${message.type}`} data-message-role={message.type}>
        {message.text}
      </div>
    </div>
  )
}

// #203: the structured-stream timeline view — the single thread surface since #179 retired the coarse
// MessageThread. Pure props-in/markup-out (exported so tests server-render an injected ThreadItem[]
// with no store, no IPC). Maps items → rows 1:1 in array order; the reducer already coalesced deltas
// into the tail assistantText, so the view never merges. Carries both the user's echo (userText) and
// the daemon's structured reply, so arrival order interleaves them into one continuous thread.
//
// Empty items → the pre-first-message empty state (#277), not null: a fresh thread now reads as a
// purposeful invitation rather than a blank gap between the top bar and the composer. EmptyThread is a
// distinct surface from the thread scroll region, so an empty timeline never renders a thread container.
// #286: `now` (ms) is the render-time clock the sessionBoundary row uses to derive its relative time,
// threaded from the container so the pure view stays deterministic under test. Defaulted to `Date.now()`
// so the existing `<Timeline items={...} />` call sites (which render no sessionBoundary row, so `now` is
// never consulted) stay green untouched — no edit cascade across the test suite.
// #601: `scrollPin` carries the container's two DOM handles for the scroll region — the node ref and the
// scroll handler. OPTIONAL for `now`'s reason, verbatim: the 30 existing `<Timeline` render sites pass
// nothing, get `undefined` for both attributes (legal no-ops under renderToStaticMarkup) and stay green
// untouched. Timeline itself stays pure props-in / markup-out — it holds no scroll state and reads no
// layout; both handles are written out explicitly below rather than spread, so the both-or-neither wiring
// is visible in the markup.
export function Timeline({
  items,
  now = Date.now(),
  scrollPin
}: {
  items: readonly ThreadItem[]
  now?: number
  scrollPin?: ThreadScrollPin
}): JSX.Element {
  if (items.length === 0) return <EmptyThread />
  const lastIndex = items.length - 1
  return (
    <div className="conversation__thread" ref={scrollPin?.ref} onScroll={scrollPin?.onScroll}>
      {items.map((item, index) => (
        // Array index as key. The list is append-only with tail-mutation and never inserts or
        // reorders mid-list (threadTimeline.ts: appendDelta grows the tail assistantText in place;
        // every other arm appends a new tail; fillResult replaces a toolCall at its own index), so
        // index identity is stable per logical item — the usual index-key hazard is absent here.
        // turnId alone is not collision-safe (a tool can split one turn into two assistantText items,
        // post-#205), and any text-bearing key would change every delta and remount the growing bubble.
        <TimelineRow
          key={index}
          item={item}
          inProgress={index === lastIndex && item.kind === 'assistantText'}
          now={now}
        />
      ))}
    </div>
  )
}

// One timeline row, discriminated on `kind`. No `default` / `assertNever`: the switch is exhaustive
// over the six kinds (only turnBoundary null), so a future seventh ThreadItem kind makes it
// non-exhaustive → a compile-time "not all code paths return" error that forces a render decision —
// while a structural-only kind (turnBoundary) still degrades to nothing rather than throwing. That
// guard did its job on the unrecognizedMessage row below: the arm arrived as a compile error here.
// #286: `now` (ms, defaulted to Date.now()) is consulted only by the sessionBoundary case, to format its
// relative time at render — kept out of the item so the label stays fresh (the channel-list precedent).
function TimelineRow({
  item,
  inProgress,
  now = Date.now()
}: {
  item: ThreadItem
  inProgress: boolean
  now?: number
}): JSX.Element | null {
  switch (item.kind) {
    case 'assistantText': {
      // #609: the bubble forks on `inProgress` — the settled reply renders as markdown, the still-growing
      // tail as plain text. No new state: `inProgress` (Timeline:466) already means "the tail, still open",
      // and because the daemon emits one event per COMPLETE content block and the store coalesces a turn's
      // deltas in place, a settled item's text is a whole document — never a half-open fence.
      //
      // #607's bubble--assistant-text (white-space: pre-wrap, see conversation.css) rides the same fork.
      // Making it conditional rather than neutralising it inside the container makes "markdown owns the
      // whitespace" true BY CONSTRUCTION — an absent declaration needs no re-verifying when a new element
      // type appears inside the container, and no stray text node can render as a visible blank. Appended,
      // never inserted — the `bubble bubble--daemon` pair stays contiguous.
      const bubbleClass = inProgress
        ? 'bubble bubble--daemon bubble--assistant-text'
        : 'bubble bubble--daemon'
      return (
        <div className="message-row message-row--daemon">
          <div className={bubbleClass} data-thread-role="assistant">
            {inProgress ? (
              <>
                {/* Text passed as React children (auto-escaped) — never dangerouslySetInnerHTML — so HTML
                    inside a delta renders as visible characters, discharging #199's untrusted-text
                    handoff. AssistantMarkdown holds the same posture on the settled branch: it escapes
                    raw HTML rather than interpreting it, and returns elements rather than an HTML
                    string, so neither branch can hand a sink anything. */}
                {item.text}
                {/* The streaming cursor (Figma 16:56, ▎ U+258E): a trailing inline visual on the
                    in-progress bubble's text run, inheriting the bubble's color/size. Derived structurally
                    (the tail, still-open assistantText), never from `phase` (which has no source until
                    #204). Decorative → aria-hidden. */}
                <span className="bubble__cursor" aria-hidden="true">
                  ▎
                </span>
              </>
            ) : (
              // AssistantMarkdown emits no wrapper of its own (#608), so this container is what the
              // block rhythm hangs on. NOT memoized: parsing does re-run on every timeline render, but no
              // failure has been observed, `React.memo` appears nowhere in src/ (this file declines it
              // twice already, :376 and :394), and nothing in this repo's server-render test tier can
              // observe a skipped re-render — it would ship unverified. If it is ever measured to matter,
              // the seam is a memoized wrapper component keyed on `text` (not useMemo — hooks cannot be
              // called from inside this switch), which is sound because the render is a pure function of
              // that one prop.
              <div className="bubble__markdown">
                <AssistantMarkdown text={item.text} />
              </div>
            )}
          </div>
        </div>
      )
    }
    case 'toolCall':
      // #696 lifted the arm's body into ToolRow so the expanded branch is reachable from a test (there
      // is no click in this repo's server-render tier, so nothing here could ever set the flag). The
      // flag is deliberately NOT threaded through Timeline/TimelineRow: that would force #697's
      // "which rows are expanded" state shape into this slice. Collapsed is the only form the switch
      // produces.
      return <ToolRow item={item} />
    case 'turnBoundary':
      // Structural marker only — no drawn element (Figma has no per-turn divider). Its sole
      // functional role, closing the cursor, is handled by Timeline's tail-check, not by any DOM here.
      return null
    case 'sessionBoundary':
      // #286: the session-boundary delimiter (Figma node 16-35) — a monospace title above a full-width
      // horizontal rule, marking where a /clear, an idle eviction, or a workspace change started a fresh
      // session. Its own visually-distinct row: NO data-thread-role (AC4 — not attributed to
      // assistant/user/tool), identified by class (the .conversation__empty / thinking-indicator idiom).
      // `workspaceCwd` reaches the DOM only INSIDE the title string as auto-escaped React children — never
      // dangerouslySetInnerHTML, no path/markup interpretation (the toolCall/userText posture; the
      // events.ts constraint). The title is formatted at render from the raw `occurredAt` (kept fresh, the
      // channel-list precedent). The rule is a decorative styled div (aria-hidden), not a semantic <hr> —
      // it is purely visual. The explanatory sentence + Install affordance (Figma 16-38) are out of scope
      // (deferred with the memory-plugin subsystem); this builds title + rule only.
      return (
        <div className="session-delimiter">
          <p className="session-delimiter__title">{sessionBoundaryTitle(item, now)}</p>
          <div className="session-delimiter__rule" aria-hidden="true" />
        </div>
      )
    case 'userText':
      // #179: the user's own message, sourced from the composer echo (composerSend → timelineStore).
      // The right-aligned user bubble mirrors MessageBubble's user treatment but carries the timeline's
      // role attribute (data-thread-role="user", distinct from MessageBubble's data-message-role so the
      // two test-count seams stay separate) and reuses .message-row--user / .bubble--user (no CSS
      // change). `text` is auto-escaped React children — never dangerouslySetInnerHTML — so any markup
      // renders as visible characters (this is the least-trusted of the row sources: local user input).
      return (
        <div className="message-row message-row--user">
          <div className="bubble bubble--user" data-thread-role="user">
            {item.text}
          </div>
        </div>
      )
    case 'unrecognizedMessage':
      // The parser-gap diagnostic — the daemon's stream parser met claude output it has no mapping
      // for. Its own visually-distinct row: NO data-thread-role (not attributed to
      // assistant/user/tool — claude did not say this, the daemon did), identified by class, like
      // .session-delimiter.
      return <UnrecognizedRow item={item} />
  }
}

// #218: the tool row (Figma node 16-28) — a compact chip, not a message bubble, so
// data-thread-role="tool" (not "assistant") keeps it out of the daemon bubble count. `toolUseId` stays
// on the item as #121's correlation key, never a React key here (Timeline keys by array index).
//
// #230: the row resolves in place when `result` fills. `tool-row--resolved` iff resolved (lifts
// .tool-row's 50% pending dimming, both outcomes); `tool-row--error` on top iff `result.isError` (the
// error accent). #230 additionally declined to draw `resultSummary` at all, because the Figma mock has
// no result-text slot. #696 REVERSED that: the result text already reaches the renderer and was thrown
// away at the last step, and a tool row that never shows what the tool returned makes the reader leave
// the app to find out (operator's decision, 2026-08-21). The mock still has no expanded state, so the
// body below takes .unrecognized-row__raw's visual language rather than inventing a second one.
//
// #697 supplied the missing half — the control that flips the flag. The chip on a RESOLVED row IS the
// control (the Figma pill has two runs and no third slot, so a separate glyph button would add an
// element the design does not model; making the pill itself the button adds none and leaves the
// collapsed geometry identical). The COLLAPSED form is otherwise unchanged and is still exactly the two
// fields.
//
// STATE PLACEMENT. A component-local `useState` — UnrecognizedRow's shape (:768), and what ADR 0006
// asks for: the LOWEST scope that resets correctly. The container's four booleans (`sheetOpen`,
// `channelInfoOpen`, `pickerOpen`, `panelOpen`, :140-156) sit at the screen because they are
// SCREEN-level facts — one sheet at a time for the whole screen. A per-row disclosure is a ROW-level
// fact, so it lives in the row; ADR 0006 names a scope, not the container. (The note at :539-540
// forbids hooks written INLINE in a switch arm, not per-row state: an arm may return a component that
// holds hooks, which is exactly what :597 already does.)
//
// Nothing needs clearing on a thread reset, and no useEffect resets anything: `reset` returns
// initialTimelineState, whose `items` is `[]` (threadTimeline.ts), so Timeline renders <EmptyThread />
// and every row unmounts with its boolean. The one reset path that leaves the screen mounted — the
// in-thread `conversation_created` confirm (activateConversation.ts) — goes through that same arm.
// And no row can inherit another's: Timeline keys by array index, which is stable per logical item
// because the reducer only ever grows the tail or replaces a toolCall AT ITS OWN INDEX (fillResult,
// via items.map) — never inserts, never reorders. So the pending → resolved transition keeps the same
// instance and the same `false`, and the row appears already collapsed when its result lands.
//
// `defaultExpanded`, NOT `expanded`: #696's prop was a controlled value; it is now the mount-time
// initial value, and React's own convention for that is the `default*` prefix (defaultValue,
// defaultChecked). renderToStaticMarkup never re-renders, so #696's assertions hold verbatim under the
// new name — a prop called `expanded` that a re-render cannot change would just be a quiet lie.
//
// SAFETY. `name`, `inputSummary` and `result.resultSummary` are untrusted daemon display text, and
// `resultSummary` has the widest provenance on the timeline — whatever a tool returned, so file
// contents, a fetched page, or shell output. All three reach the DOM ONLY as auto-escaped React
// children: never dangerouslySetInnerHTML, never an attribute (not `title` — the answer to a body
// clipped by its 240px bound is the scroll container, never a tooltip carrying the string into an
// attribute — and not aria-label, data-*, key or id), never a URL, never a filename/cache key/lookup
// path, never a log line. In particular NOT through AssistantMarkdown (imported into this same file,
// two arms up): markdown yields links and images, and an <img src> in a daemon-relayed result is an
// outbound request issued by a privileged renderer — a beacon whose URL the daemon chose. A <pre> with
// text children cannot emit one. `resultSummary` is read in exactly two places below: as the <pre>'s
// children, and in the `=== ''` comparison that selects the empty state.
//
// #697 made that posture LOAD-BEARING rather than belt-and-braces: before the toggle, the arm passed no
// flag, so the result text was decoded, stored, and then never rendered. This is the first time a
// hostile `resultSummary` reaches the DOM in the shipped product. Four sinks a disclosure control
// invites are therefore declined ON PURPOSE, and each is a MUST FIX if it ever appears here:
//   - NO aria-label. `Show result for ${item.name}` would interpolate daemon text into an ATTRIBUTE.
//     The button's accessible name already comes from its text children plus aria-expanded — a screen
//     reader announces "read_file, schema.ts, button, collapsed" with no attribute involved.
//   - NO aria-controls / id pair. The APG disclosure pattern invites it and the obvious id source is
//     `toolUseId` — a daemon string as both an attribute value and a lookup key, forbidden twice.
//     aria-controls is optional in that pattern, and UnrecognizedRow ships without it. If a future
//     ticket wants one, the id comes from React's useId(), never from the wire.
//   - NO title. .tool-row__summary ellipsizes, which makes `title={item.inputSummary}` the natural next
//     edit; it is the same forbidden shape #696 already declined for `resultSummary`.
//   - NO log line for the toggle. Any useful one would carry `name`, `inputSummary` or `toolUseId` —
//     daemon content in a log, which ADR 0007's content-free rule and CLAUDE.md both forbid.
//
// #705 EXTENDS that posture to a NEWLY untrusted string in the SAME sink. The summary run no longer
// draws `inputSummary` but a value picked out of `item.input` (toolHeadline.ts) — the daemon chooses
// both the field names and the values, so the worst outcome is a misleading or ugly headline that is
// inert text one click from the truth in the body. It reaches the DOM only as auto-escaped React
// children of the same <span>, and three further sinks the pick makes newly tempting are declined,
// each a MUST FIX if it ever appears:
//   - NO title, again and for a new reason. Shortening a path VISIBLY discards information, which
//     makes `title={fullPath}` ("hover for the rest") the natural next edit. Same forbidden shape.
//   - NO linkification of a `url` headline. The picker promotes a field literally named `url` into
//     this run, and AssistantMarkdown sits two arms up in this same file. Rendering the headline
//     through it — or wrapping it in an <a href> — turns a daemon-chosen URL into an outbound request
//     from a privileged renderer, the <img src> beacon shape above. A <span> with text children
//     cannot emit one.
//   - NO input KEY in the DOM. toolHeadline returns the VALUE only; keys are daemon display text too,
//     and drawing them is #706's deliberate, separately reviewed decision.
export function ToolRow({
  item,
  defaultExpanded = false
}: {
  item: Extract<ThreadItem, { kind: 'toolCall' }>
  defaultExpanded?: boolean
}): JSX.Element {
  const { result } = item
  const [expanded, setExpanded] = useState(defaultExpanded)
  const rowClass = result
    ? `tool-row tool-row--resolved${result.isError ? ' tool-row--error' : ''}`
    : 'tool-row'
  // The one derived value behind both new markup facts — the wrapper modifier and the body element.
  // Non-null iff `expanded && result !== null`, so AC3 (a pending row ignores the flag entirely) is
  // structural rather than two conditions that could drift apart. Carrying the narrowed ToolResult
  // rather than a boolean is what lets both readers below use it without re-checking for null.
  const body = expanded ? result : null
  // The chip's two runs, declared once: the element forks below, the children never do.
  const chipRuns = (
    <>
      <span className="tool-row__name">{item.name}</span>
      {/* #705: the second run is now the picked INPUT FIELD (toolHeadline.ts), not `inputSummary` —
          same element, same class, same single-line ellipsizing, different text. `inputSummary` is
          the daemon's whole input compacted, so for an Edit that is mostly replacement text the file
          path was buried in it and usually cut off; it survives as the picker's rule-4 fallback,
          which is what keeps this row working against a pre-pyrycode#1678 daemon. */}
      <span className="tool-row__summary">{toolHeadline(item)}</span>
    </>
  )
  return (
    // tool-row--expanded is appended LAST so the collapsed prefix stays byte-stable.
    <div className={body ? `${rowClass} tool-row--expanded` : rowClass}>
      {result ? (
        // Gated on `result`, NOT on `expanded` — the same condition rowClass already reads, rather
        // than a second predicate that could drift. A pending row must be non-activatable regardless
        // of what `defaultExpanded` says, and `body` above already makes its body structurally
        // unreachable; the chip fork is the same kind of structural fact. Not a disabled <button>
        // either: that is still a control in the accessibility tree and would change the pending
        // markup, where forking leaves the <div> branch below literally untouched.
        <button
          type="button"
          className="tool-row__chip tool-row__chip--toggle"
          data-thread-role="tool"
          aria-expanded={expanded}
          // Functional updater, never `setExpanded(!expanded)`: the latter reads a captured value and
          // is a check-then-act race against React's batching (UnrecognizedRow:775's form).
          onClick={() => setExpanded((open) => !open)}
        >
          {chipRuns}
        </button>
      ) : (
        <div className="tool-row__chip" data-thread-role="tool">
          {chipRuns}
        </div>
      )}
      {body && (
        // A SIBLING of the chip, not a child: the chip is a single-line inline-flex pill with
        // overflow: hidden (conversation.css), so nesting a stacked body inside it would need a new
        // wrapper around the two headline spans and change the collapsed markup. A container rather
        // than a lone text node because #645 lands its per-input-field list in here, above the result.
        <div className={`tool-row__body${body.isError ? ' tool-row__body--error' : ''}`}>
          {body.resultSummary === '' ? (
            // `=== ''` exactly — never `.trim()`, which would relabel whitespace-only output (real
            // output the daemon sent) as absent, and never a falsy check, which would read as if
            // `undefined` were reachable on a `string` field.
            <p className="tool-row__empty">{TOOL_RESULT_EMPTY_COPY}</p>
          ) : (
            // <pre> + white-space: pre (conversation.css), not a <div>: a div inherits
            // white-space: normal and collapses the daemon's newlines onto one line — the defect #607
            // fixed for assistant messages. Tool output is machine output (a listing, a diff, a stack
            // trace, an aligned table) where column position IS the information, so it keeps its exact
            // shape and scrolls — the .unrecognized-row__raw side of the whitespace rule stated above
            // .bubble__markdown pre in conversation.css, not the reflowing code-block side.
            <pre className="tool-row__result">{body.resultSummary}</pre>
          )}
        </div>
      )}
    </div>
  )
}

/** Shown in place of an expanded body when the daemon's result carried no text. Client-owned copy. */
export const TOOL_RESULT_EMPTY_COPY = 'No output'

// The collapsed/expanded diagnostic row. Built SPECIFIC, not generic: this is the first and only
// expand-and-collapse in the repo, there is no <details> anywhere to reuse, and a reusable collapsible
// with no second caller would be speculative work. When a second one arrives, extract then.
//
// A real <button> with aria-expanded, not a div with a click handler, so keyboard activation (Enter and
// Space) and screen-reader semantics come for free rather than being re-implemented and half-missed.
//
// State is component-local useState — a single transient boolean, which ADR 0006 puts in the component
// and never in the store. It resets to collapsed on remount for free, which is the wanted behaviour: a
// diagnostic should not stay expanded across a screen remount.
//
// SAFETY. `raw` and `messageType` are the most untrusted strings the timeline holds — unbounded,
// model-adjacent JSON the daemon could not interpret. Both reach the DOM ONLY as auto-escaped React
// children: never dangerouslySetInnerHTML, never an attribute value, never a URL. React escapes text
// children, so the JSON inside the <pre> is inert, and those two sinks are the only ways to break that.
// Neither appears here.
function UnrecognizedRow({
  item
}: {
  item: Extract<ThreadItem, { kind: 'unrecognizedMessage' }>
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="unrecognized-row">
      <button
        type="button"
        className="unrecognized-row__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="unrecognized-row__glyph" aria-hidden="true">
          ⚠
        </span>
        <span className="unrecognized-row__label">{UNRECOGNIZED_COPY}</span>
        {/* The offending type, in mono so it reads as a literal. Empty for the `undecodable` site —
            nothing decoded, so no type was ever read — in which case the slot is simply omitted rather
            than rendering an empty pair of quotes. */}
        {item.messageType !== '' && (
          <span className="unrecognized-row__type">{item.messageType}</span>
        )}
        <span className="unrecognized-row__site">{unrecognizedSiteLabel(item.site)}</span>
      </button>
      {expanded && (
        <>
          <pre className="unrecognized-row__raw">{item.raw}</pre>
          {/* Only shown when the daemon actually cut the payload, so the reader knows the JSON is
              incomplete by design rather than malformed at the source. */}
          {item.truncated && (
            <p className="unrecognized-row__truncated">{UNRECOGNIZED_TRUNCATED_COPY}</p>
          )}
        </>
      )}
    </div>
  )
}

/** The collapsed row's fixed label. Client-owned copy, never daemon-supplied. */
export const UNRECOGNIZED_COPY = 'Unrecognized message'

/** The note shown under an expanded payload the daemon had to cut. Client-owned copy. */
export const UNRECOGNIZED_TRUNCATED_COPY = 'Payload truncated by the daemon.'

/**
 * A human label for each drop site. A total function over the closed union — CLIENT-OWNED copy, so the
 * daemon's `site` value selects a string but never becomes one, which is what keeps a daemon-supplied
 * value out of the rendered text here. Exhaustive by the union, so a future fifth site is a compile
 * error rather than a blank slot.
 */
export function unrecognizedSiteLabel(site: UnrecognizedSite): string {
  switch (site) {
    case 'line_type':
      return 'whole message'
    case 'assistant_block':
      return 'assistant block'
    case 'user_block':
      return 'user block'
    case 'undecodable':
      return 'could not be decoded'
  }
}

// #277: the pre-first-message empty-thread copy. A module-level, client-owned constant — Timeline
// receives only `items`, so the empty branch can render nothing but this literal, making AC3 ("no
// daemon-supplied string is rendered in the empty state") a structural guarantee (the ThinkingIndicator
// label idiom). Semantically an in-thread invitation, distinct from the channel-list "No conversations
// yet" list-absence line (AC4).
const EMPTY_THREAD_COPY = 'Send a message to get started'

// #277: the empty-thread state Timeline renders when the item list is empty (replacing #203's `return
// null`) — a fresh thread reads as a purposeful pre-first-message invitation, not a blank gap. A
// DISTINCT class from .conversation__thread (never that substring, no data-thread-role) so the
// split-brain guard (AC4) stays green; a decorative chat glyph (aria-hidden — the file's inline-SVG
// idiom) plus the client-owned copy carry the state, visually distinct from the icon-less
// .channel-list__empty (AC1/AC4). The icon+copy centre in the flexible middle region; #278 pins its
// workspace chip to the top of this same surface (not built here).
function EmptyThread(): JSX.Element {
  return (
    <div className="conversation__empty">
      <svg
        className="conversation__empty-icon"
        viewBox="0 0 24 24"
        width="48"
        height="48"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
      </svg>
      <p className="conversation__empty-copy">{EMPTY_THREAD_COPY}</p>
    </div>
  )
}

// #278: the client-owned chip label. A module-level constant (the EMPTY_THREAD_COPY idiom) —
// apostrophe-free (renderToStaticMarkup escapes `'`) and never a daemon string, so no untrusted string
// reaches the label; the only daemon value the chip renders is `cwd`, as auto-escaped React children.
const WORKSPACE_CHIP_LABEL = 'Workspace'

export interface WorkspaceChipProps {
  // The conversation the thread is showing (the create-reply payload, held verbatim). null ⇒ no chip.
  conversation: ConversationCreatedPayload | null
  // The thread has no timeline items yet — the pre-first-message window (AC1/AC3).
  isEmpty: boolean
  // The #157 Workspace Picker seam. Omitted by this ticket's container, so the "Change" button renders
  // disabled — an honest placeholder (AC4). #157 lands as a pure additive: pass an onChange that opens
  // the picker and the button un-disables, with no other change to this view.
  onChange?: () => void
}

// #278: the pre-first-message workspace chip — a Material 3 pill at the top of the empty new-discussion
// thread showing the workspace `cwd` the discussion will run in. The exact ThinkingIndicator idiom: the
// container derives the value (activeConversationStore) and passes it down; this pure view self-gates to
// null; no store read inside it. Exported so tests server-render it with injected props.
//
// Gate (AC1/AC3): render iff the thread is empty (pre-first-message), a real conversation is present, and
// it is a *discussion* (`is_promoted` false — the wire signal for a new discussion vs a channel). Once the
// first message lands, isEmpty flips false and the chip is gone (AC3 — a pre-first-message affordance only).
//
// `cwd` (AC2) is an untrusted daemon string rendered WHOLE and OPAQUE: auto-escaped React children — never
// dangerouslySetInnerHTML, and never split/basenamed/otherwise interpreted as a filesystem path (extracting
// a path segment would itself be "interpreting it as a path", which the AC forbids). React escaping handles
// HTML-ish characters — the toolCall / sessionBoundary untrusted-string posture already in this file.
export function WorkspaceChip({
  conversation,
  isEmpty,
  onChange
}: WorkspaceChipProps): JSX.Element | null {
  if (!isEmpty || conversation === null || conversation.is_promoted) return null
  return (
    <div className="conversation__workspace-chip">
      <span className="conversation__workspace-chip-pill">
        <span className="conversation__workspace-chip-label">{WORKSPACE_CHIP_LABEL}</span>
        <span className="conversation__workspace-chip-cwd">{conversation.cwd}</span>
        <button
          type="button"
          className="conversation__workspace-chip-change"
          aria-label="Change workspace"
          disabled={!onChange}
          onClick={onChange}
        >
          Change
        </button>
      </span>
    </div>
  )
}

// #215: the thinking copy — hoisted by #648 out of the JSX below into a module-level, client-owned
// constant, joining its three siblings (STALL_COPY / API_RETRY_COPY / COMPACTING_COPY). The VALUE is
// unchanged: apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson)
// with the U+2026 ellipsis character. Exported, unlike module-private STALL_COPY, so the tests assert
// against the constant rather than a duplicated literal (#648 AC5).
export const THINKING_COPY = 'Thinking…'

// #648: the copy for the rest of the running turn. During `responding` the client genuinely cannot tell
// tool work from text streaming — the daemon sends no further turn_state inside the tool loop — so there
// is no finer signal to key off and a copy like "Running tools…" would be a lie roughly half the time.
// One generic word answers the operator's actual complaint ("this looks frozen"), is lexically distinct
// from THINKING_COPY (AC2), and matches the one-word register of its direct peer rather than the sentence
// register of the three problem/housekeeping states. Apostrophe-free, U+2026 ellipsis, never a daemon
// string — the wire carries no label for this state, so the guarantee holds by construction.
export const WORKING_COPY = 'Working…'

// #649: the label that names the tool the daemon currently has open — the answer to the operator's
// remaining complaint, that WORKING_COPY reads identically for a 40 ms file read and a four-minute build.
// A function rather than a constant because this copy has a hole, but BOTH fixed runs (the leading verb
// and the trailing U+2026) live inside it, so "the fixed copy is client-owned and only the name is
// daemon-supplied" is true of one readable unit. Apostrophe-free (renderToStaticMarkup escapes `'` →
// `&#x27;`, the standing desktop lesson), U+2026 not three dots, matching its four sibling constants.
// It deliberately does NOT contain WORKING_COPY: the named label REPLACES the generic one rather than
// extending it. The name is returned verbatim — escaping is the renderer's job (React auto-escapes the
// text child), and pre-escaping here would double-escape and would be the very "new mechanism" the
// escaping AC pins against.
export function toolWorkingCopy(name: string): string {
  return `Running ${name}…`
}

// #648: which of the two client-owned labels the indicator shows. A two-member union rather than a
// boolean, because a boolean cannot carry two labels; deliberately NOT `TurnPhase`, which would hand the
// view the store type and make `'idle'` representable-but-illegal inside the shown branch.
//
// #649: deliberately NOT widened to a third member carrying the tool name. Folding the daemon string in
// here would dissolve the client-owned half into the same type as the daemon half, which is exactly the
// distinction that ticket asks to preserve; the name rides a second, separately-named prop instead.
export type WorkingIndicatorState = 'thinking' | 'working'

// #215: the working indicator — Timeline's twin over the coarse `phase` scalar rather than the
// items list. The daemon opens a turn with `turn_state{thinking}` before any assistant_delta
// (pyrycode #632), so during that window there are no timeline items and the thread shows nothing;
// this affordance covers "the daemon is working, no text yet" — distinct from #203's streaming cursor
// (which covers text already arriving on an assistantText tail). Pure props-in/markup-out and exported
// so tests server-render an injected state with no store.
//
// #648: the prop widens from `isThinking: boolean` to `WorkingIndicatorState | null` so the indicator can
// hold for the WHOLE running turn with a label that tracks the phase — the daemon flips to `responding` on
// the first reply token or tool step and stays there silently, which is exactly where the screen used to
// go blank. The `| null` lives on the prop and the return type, not inside the alias (the
// `ApiRetryStatus | null` shape below).
//
// `state` is still NOT `phase: TurnPhase` and still not a plain `string` label — the union keeps the LABEL
// CHOICE a closed set of client-owned literals. The container does that derivation, via
// `workingIndicatorState` below.
//
// #649 DELIBERATELY REVERSES the other half of #648's guarantee, which read here as "the view structurally
// cannot render a daemon string". Per the operator's 2026-08-20 decision the indicator now names the open
// tool, and a tool name is by definition daemon-supplied. The reversal is narrow by construction, and this
// is what survives of the original claim:
//
//   - the label choice stays a closed client-owned union (`state`), unwidened;
//   - exactly ONE separately-named prop (`toolName`) carries the single daemon string;
//   - the fixed copy around that name is client-owned (`toolWorkingCopy` above);
//   - the name reaches the DOM only as an auto-escaped React text child — the identical posture the
//     tool row two rows up already applies to the SAME string (`item.name`, `:551`), never
//     dangerouslySetInnerHTML, no HTML sink. So the indicator adds no exposure that is not already on
//     screen, which is precisely the operator's reasoning for the decision.
//
// `toolName` is REQUIRED, not optional: an optional prop would let the container silently omit it, and
// nothing in this repo could catch that — every container test renders the idle store (zustand v5 reads
// getInitialState() under server render), so `tsc` is the only available detector and the type must be the
// one that fails.
//
// Precedence: the `state === null` guard runs FIRST, so #493's and #496's supersede rules are reached
// before any tool label can render — a live api-retry or compaction still hides the indicator entirely in
// either phase, and an open tool cannot resurrect it. `toolName` then wins over the phase-derived copy,
// which makes `{ state: 'thinking', toolName: 'Bash' }` well-defined rather than illegal; it should not
// arise (the daemon flips to `responding` on the first tool step), so it is a defined edge, not a
// defended one.
//
// null → null (zero layout footprint, AC3 — exactly like Timeline returning null on an empty list). All
// three labels wear the SAME interim treatment: the daemon-bubble surface with muted text (a transient
// affordance), pending the deferred desktop-design pass (the mobile Figma has no indicator node at all —
// the gap already recorded for #215/#317/#493/#496). The tool branch adds ONE modifier, carrying the
// one-line bound an unbounded daemon string needs (see .bubble--tool-label in conversation.css); the two
// unnamed labels render byte-identical markup to #648's, so their assertions stand as regression evidence.
//
// The label is a SINGLE text child, not constant-plus-span like ApiRetryIndicator below. That is
// load-bearing for the bound: one text run ellipsizes as one unit, so on overflow the client `…` is
// truncated away and replaced by the ellipsis the truncation itself draws. Splitting the name into its own
// span would render `Running some-long-na…  …` — two ellipses — and buys nothing, since the name needs no
// distinct type or colour here (there is no Figma node for this state; the indicator is one muted run).
export function ThinkingIndicator({
  state,
  toolName
}: {
  state: WorkingIndicatorState | null
  toolName: string | null
}): JSX.Element | null {
  if (state === null) return null
  // One wrapper, one bubble, two varying pieces — the toolCall row's `rowClass` idiom above (:545), which
  // likewise varies only a className and keeps a single return. Writing the tool case as its own early
  // return would duplicate the wrapper markup, and a drifted copy is exactly what makes the two unnamed
  // labels stop being byte-identical to #648's.
  const bubbleClass = `bubble bubble--daemon bubble--thinking${
    toolName !== null ? ' bubble--tool-label' : ''
  }`
  const label =
    toolName !== null ? toolWorkingCopy(toolName) : state === 'thinking' ? THINKING_COPY : WORKING_COPY
  return (
    <div className="conversation__thinking">
      <div className={bubbleClass}>{label}</div>
    </div>
  )
}

// #317: the stall-indicator copy — a module-level, client-owned constant (the EMPTY_THREAD_COPY /
// 'Thinking…' idiom). Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop
// lesson) and using the U+2026 ellipsis character (matching 'Thinking…'). Never a daemon string — the
// stall frame carries no daemon content, so the plain-text-never-HTML guarantee holds by construction.
const STALL_COPY = 'The turn seems to have stalled…'

// #317: the stall indicator — ThinkingIndicator's twin over the coarse `stalled` scalar. The daemon
// emits a one-shot `stall` onset when claude goes quiet mid-turn (or the screen parser degrades) with no
// "cleared" frame, so the reducer self-clears the flag on the next turn activity; this view just renders
// the current boolean. Pure props-in/markup-out and exported so tests server-render an injected boolean
// with no store.
//
// Takes `isStalled: boolean`, NOT the store type — the boolean makes AC4 ("no daemon-supplied string is
// rendered") a type-level guarantee: the view structurally cannot receive, hence cannot render, a daemon
// string. A plain boolean guard, no switch / assertNever (there is no union to discriminate).
//
// isStalled false → null (zero layout footprint — the ThinkingIndicator / Timeline null-on-empty
// posture). isStalled true → the client-owned copy in a wrapper + bubble carrying stall-distinct classes
// (see conversation.css): it reuses the daemon bubble's fill/radius but diverges to the error role so it
// reads as a PROBLEM state, visually distinct from the muted .bubble--thinking (AC4).
export function StallIndicator({ isStalled }: { isStalled: boolean }): JSX.Element | null {
  if (!isStalled) return null
  return (
    <div className="conversation__stall">
      <div className="bubble bubble--daemon bubble--stall">{STALL_COPY}</div>
    </div>
  )
}

// #493: the api-retry copy — a module-level, client-owned constant (the STALL_COPY / 'Thinking…' idiom).
// Conveys BOTH facts AC1 asks for: claude hit an API error, and it is retrying. Apostrophe-free
// (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson) and using the U+2026 ellipsis
// character (matching 'Thinking…' / STALL_COPY). Never a daemon string — the arm carries no string field,
// so the plain-text-never-HTML guarantee holds by construction. Exported so the tests assert against the
// constant rather than a duplicated literal.
export const API_RETRY_COPY = 'API error — retrying…'

// #493: the coarse thread-chrome scalars the indicator-precedence rule reads. A record, not a positional
// scalar (the one place this departs from `isTurnRunning`): a record grows by one field where a positional
// signature would break every call site. #496 took exactly that route — one field here, one clause below,
// no parallel rule and no second gate — so a third superseding status extends it the same way.
export interface ThreadStatus {
  phase: TurnPhase
  apiRetry: ApiRetryStatus | null
  compacting: boolean
}

// #493: whether the generic thinking indicator shows — thinking, and nothing supersedes it (AC5). This
// closes the mutual-exclusion question #317 deferred: a stall and thinking are compatible facts ("working"
// and "may be stuck") and still co-render, but retrying against an API error is NOT compatible — claude is
// not making progress on the request, it is re-attempting a failed call, so the retry status replaces the
// thinking indicator rather than sitting beside it. Narrowing the gate (rather than deriving a
// mutually-exclusive status union in the container) keeps both views pure and independently
// unit-testable — the isTurnRunning precedent of extracting the named predicate. Presence supersedes, not
// the counter: an unknown-count retry (`{ current: 0, total: 0 }`) hides thinking exactly like a known one.
//
// #496: the second superseder — a live compaction hides thinking too. Claude is not thinking about the
// user's request while compacting, it is rewriting its own context, so "thinking" would be a false
// reading of a silent screen (the premise of #496). The exclusion is scoped to the thinking indicator
// ONLY: compaction, retry, and stall may all co-render, since they are independent daemon facts.
//
// #648: the phase clause BROADENS from `phase === 'thinking'` to the whole running turn, closing the
// divergence isTurnRunning's own comment below flags. The daemon emits `turn_state{thinking}` only while
// claude produces thinking text; the first reply token or tool step flips it to `responding` and nothing
// further arrives until the turn ends, so the narrow gate left a tool-heavy turn looking like a frozen
// screen. This REUSES isTurnRunning rather than re-deriving the test — one predicate, two consumers. Both
// supersede clauses are untouched, so a retry or a compaction still replaces the indicator in the newly
// covered phase exactly as it did in `thinking`. The name stays `shouldShowThinking` because the component
// it gates is still `ThinkingIndicator`, whose identifier this ticket freezes; renaming the gate alone
// would leave the pair inconsistent (a rename is its own Strangler-Fig chore).
export function shouldShowThinking(status: ThreadStatus): boolean {
  return isTurnRunning(status.phase) && status.apiRetry === null && !status.compacting
}

// #648: the label discriminant, composed ON the gate above rather than duplicating it — it delegates the
// whole show/hide decision and adds only the choice between the two client-owned labels. Keeping the gate
// and the discriminant as one function pair (rather than folding both into a single union-returning
// predicate) leaves #493's and #496's nine supersede assertions standing verbatim as AC4's regression
// evidence. `'idle'` is unreachable in the second branch because the gate already excluded it, so there is
// no third case and no assertNever.
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null {
  if (!shouldShowThinking(status)) return null
  return status.phase === 'thinking' ? 'thinking' : 'working'
}

// #650: the locally-opened window — the indicator now opens the moment the composer accepts a submit,
// rather than waiting a network round-trip for the daemon's first `turn_state`. Composed ON the pair above
// rather than added as a fourth `ThreadStatus` field: a fourth field would break 19 status literals in the
// test file as pure retyping with not one expectation changed, and those literals are exactly the standing
// regression evidence that #493's and #496's supersede rules survived #648. This is #648's own recorded
// lesson applied a second time — compose on a proven gate, do not retype its assertions.
//
// Three statements, no new branch logic, and the third is the load-bearing one:
//  1. The daemon's answer WINS — a non-null result is returned unchanged, so every daemon-opened case is
//     byte-identical to today, including the label a send issued mid-turn must not relabel.
//  2. No local send pending ⇒ null: today's behaviour verbatim, and AC1's refused-submit case (a submit
//     the composer refuses dispatches no `userText`, so the flag never opens and no code runs at all).
//  3. Otherwise ASK THE SAME GATE what it would say for a turn that has just begun, by re-calling it with
//     one field substituted. Three properties fall out of writing it as a re-call rather than a fresh
//     expression: (a) #493's and #496's supersede clauses are INHERITED, not restated — a live retry or
//     compaction still returns null because the same two clauses evaluate, so there is no second place the
//     rule lives and it cannot drift; (b) the label is `'thinking'`, which is both honest (the operator has
//     pressed Enter and nothing has been produced — precisely what the daemon's own `thinking` phase means)
//     and FLICKER-FREE, since the daemon's first `turn_state{thinking}` then changes nothing at the seam
//     this ticket exists to smooth, where `'working'` would have flipped Working → Thinking → Working;
//     (c) `workingIndicatorState`'s claim above that `'idle'` is unreachable in its second branch stays
//     literally true, because the synthetic record carries `'thinking'`, never `'idle'`.
//
// The synthetic `phase` NEVER escapes this function: it is not stored, not passed to a view, and not seen
// by `isTurnRunning`. Its one job is gate reuse. That is also why the signal lives in a scalar beside
// `phase` rather than in `phase` itself — the interrupt control reads `selectPhase` alone, so a locally
// opened window structurally cannot arm a stop button for a turn the daemon has not started (AC4).
export function workingIndicatorStateWithLocalSend(
  status: ThreadStatus,
  localSendPending: boolean
): WorkingIndicatorState | null {
  const daemonState = workingIndicatorState(status)
  if (daemonState !== null) return daemonState
  if (!localSendPending) return null
  return workingIndicatorState({ ...status, phase: 'thinking' })
}

// #649: the `name` of the most recently started still-open tool call, or null if none is open. A pure read
// over the `items` slice the container already holds — "a tool is running right now" is `result === null`
// on a `toolCall` item, so this needs no new wire field, no daemon change, no new store state and no new
// subscription. It lives here beside `workingIndicatorState` rather than in threadTimeline.ts, following
// this file's own precedent that pure derivations over store types live with the view that consumes them
// (`isTurnRunning` below is exactly that shape), which keeps the store untouched.
//
// "Most recently started" is the LAST such item in array order: `items` is append-only and `fillResult`
// (threadTimeline.ts:213) fills in place without reordering, so array order IS start order. Descending
// scan with an early return — deliberately NOT `Array.prototype.findLast`, which is ES2023 and would fail
// `npm run typecheck` against tsconfig.web.json's `lib: ["ES2020", …]`.
//
// Total over its input: an empty array, an array with no `toolCall`, and an array whose calls are all
// resolved each return null, which renders #648's generic behaviour. The name is returned VERBATIM — no
// trim, no emptiness check, no length cap. A whitespace-only name would render `Running …`, which is
// degraded rather than broken and is unobserved (the wire requires a name and every real tool has one);
// the CSS bound holds the slot at any length, so no character cap is warranted either.
//
// Known, deliberately undefended: an interrupted turn can leave a `toolCall` permanently unresolved, and
// the next turn's indicator would then name that stale tool. The timeline already shows that call as a
// permanently pending 50%-dimmed row (#230), so the label mirrors what is on screen rather than
// contradicting it. If the operator observes a wrong name after an interrupt, the cheap fix is to stop the
// scan at the first `turnBoundary`, scoping it to the current turn — one extra condition in this loop.
export function openToolName(items: readonly ThreadItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'toolCall' && item.result === null) return item.name
  }
  return null
}

// #493: the api-retry indicator — the StallIndicator twin over the `apiRetry` status record. The daemon
// re-fires the rising edge as the attempt count climbs and sends an explicit falling edge when the retry
// ends, so (unlike the stall) the reducer never self-clears it; this view just renders the held status.
// Pure props-in/markup-out and exported so tests server-render an injected status with no store.
//
// Takes `ApiRetryStatus | null` — two numbers, NO string field. That preserves the ThinkingIndicator /
// StallIndicator type-level guarantee for AC1 ("no daemon-supplied string is ever rendered") in the only
// way open to a view that must show daemon-derived digits: it structurally cannot receive a daemon string.
// Do NOT widen the prop to the ThreadEvent or to a preformatted string.
//
// null → null (zero layout footprint — the ThinkingIndicator / StallIndicator posture). Present → the
// client-owned copy in a wrapper + bubble carrying retry-distinct classes (see conversation.css): the
// daemon bubble's fill/radius diverged to the error role so it reads as a DEGRADING session, distinct from
// both the muted .bubble--thinking and the accent-barred .bubble--stall (AC1).
export function ApiRetryIndicator({ retry }: { retry: ApiRetryStatus | null }): JSX.Element | null {
  if (!retry) return null
  // The counter shows iff `total > 0`. That covers AC3's unknown-count case (`0/0` → omitted entirely, no
  // "0/0" in the markup) and additionally suppresses a meaningless denominator on an undocumented `N/0`.
  // Two client-formatted integers interpolated as digits — NEVER `current / total`, which is NaN at 0/0.
  // This is one comparison, not a validator: the transport type-checks but deliberately does not
  // range-check an inbound wire integer (ADR 0002 drift), and inventing a bound here would be
  // unprecedented scope. `{ current: 0, total: 10 }` is not the unknown sentinel — it renders as 0/10.
  const showCounter = retry.total > 0
  return (
    <div className="conversation__api-retry">
      <div className="bubble bubble--daemon bubble--api-retry">
        {API_RETRY_COPY}
        {showCounter && (
          <span className="api-retry__counter">{` attempt ${retry.current}/${retry.total}`}</span>
        )}
      </div>
    </div>
  )
}

// #496: the compaction copy — a module-level, client-owned constant (the API_RETRY_COPY / STALL_COPY /
// 'Thinking…' idiom). Names the work AND its object, so a silent screen reads as claude rewriting its own
// context rather than a wedged session (the premise of #496) — and reads as progress, never as an error.
// Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson) and using the
// U+2026 ellipsis character (matching 'Thinking…' / STALL_COPY / API_RETRY_COPY). Never a daemon string —
// the arm carries no string field, so the plain-text-never-HTML guarantee holds by construction. Exported
// so the tests assert against the constant rather than a duplicated literal.
export const COMPACTING_COPY = 'Compacting the conversation…'

// #496: the compaction indicator — the StallIndicator twin over the `compacting` scalar. The daemon sends
// an explicit falling edge when compaction ends, so (unlike the stall) the reducer never self-clears it and
// turn activity leaves it showing; this view just renders the current boolean. Pure props-in/markup-out and
// exported so tests server-render an injected boolean with no store.
//
// Takes `isCompacting: boolean`, NOT the store type — the boolean makes AC1 ("no daemon-supplied string is
// ever rendered") a type-level guarantee: the view structurally cannot receive, hence cannot render, a
// daemon string. ApiRetryIndicator needed a record only because it renders daemon-derived digits; the wire
// carries no compaction progress, so there is nothing numeric here and none may be invented (banner-only).
// A plain boolean guard, no switch / assertNever (there is no union to discriminate).
//
// false → null (zero layout footprint — the StallIndicator / ThinkingIndicator posture, and AC5: while
// live it adds no timeline row, and once cleared it leaves nothing behind). true → the client-owned copy in
// a wrapper + bubble carrying compaction-distinct classes (see conversation.css): the daemon bubble's
// fill/radius with .bubble--thinking's muted text — compaction IS a working state — plus a primary-role
// accent bar for distinctness. Deliberately NOT the error role both problem states use: compaction is
// claude working normally, and painting routine housekeeping as a failure would be a design bug.
export function CompactingIndicator({ isCompacting }: { isCompacting: boolean }): JSX.Element | null {
  if (!isCompacting) return null
  return (
    <div className="conversation__compacting">
      <div className="bubble bubble--daemon bubble--compacting">{COMPACTING_COPY}</div>
    </div>
  )
}

// #307: whether a turn is currently running — the interrupt control's gate. This is the one subtle thing
// in the ticket: the gate is BROADER than ThinkingIndicator's (`phase === 'thinking'` only) — a turn is
// "running" in BOTH `thinking` and `responding`, so the interrupt affordance must be available in either.
// Extracted as a named, exported predicate so AC1 (both running phases show, idle hides) is a
// deterministic, store-free unit test rather than a store-mounted render. Takes the `phase` scalar; the
// container derives the boolean and passes only that to the pure view (no daemon string reaches it).
export function isTurnRunning(phase: TurnPhase): boolean {
  return phase === 'thinking' || phase === 'responding'
}

// #307: the client-owned accessible name for the icon-only interrupt button (the DROP_QUEUED_LABEL /
// EMPTY_THREAD_COPY idiom). Icon-only buttons carry no visible text, so aria-label supplies the
// accessible name (the .composer__send / .status-sheet__close pattern in this file). Conveys both "stop"
// and "interrupt" (AC4). Never a daemon string.
const INTERRUPT_LABEL = 'Stop the running turn'

// #307: the interrupt control's pure view — the ThinkingIndicator twin (null-on-false) plus the
// QueuedBacklog icon-button shape (aria-label from a client-owned constant, a required injected effect).
// Pure props-in/markup-out and exported so tests server-render it with an injected boolean, no store.
//
// Takes `isRunning: boolean`, NOT `phase: TurnPhase` — the same type-level guarantee as ThinkingIndicator:
// the view structurally cannot render a daemon-supplied string because it never receives one; the
// container does the `isTurnRunning(phase)` derivation. `onInterrupt` is a REQUIRED injected effect (the
// "a view that cannot answer is a bug" rule) — the container binds it to sendInterrupt; the view never
// touches window.pyry.
//
// !isRunning → null (zero layout footprint, the ThinkingIndicator / QueuedBacklog posture — the
// structural AC1 "absent at idle" guarantee). isRunning → an icon-only <button> carrying an inline M3
// `stop` glyph (a filled square, the mobile-design gap's derived affordance per the spec's Design
// source). Keyboard-activatable is free: a native <button> fires onClick on Enter/Space (AC4), so no
// custom key handling. Not disabled after click and holding no "already interrupted" state — a second Esc
// is harmless (the daemon owes no reply), and a disable-after-click flag would be new client state (AC3
// forbids it); the control simply stays until `phase` leaves the running set.
export function InterruptButton({
  isRunning,
  onInterrupt
}: {
  isRunning: boolean
  onInterrupt: () => void
}): JSX.Element | null {
  if (!isRunning) return null
  return (
    <div className="conversation__interrupt">
      <button
        type="button"
        className="interrupt-button"
        aria-label={INTERRUPT_LABEL}
        onClick={onInterrupt}
      >
        <svg
          className="interrupt-button-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M6 6h12v12H6z" />
        </svg>
      </button>
    </div>
  )
}

// The store-bound container for the interrupt control (#307). Reads the existing `phase` slice (the same
// selectPhase the ConversationScreen container already holds), derives the is-running boolean, and binds
// the injected effect. window.pyry.sendCommand is dereferenced ONLY inside the click closure (interaction
// time, never render — the Composer.handleSubmit / QueuedBacklogControl discipline), so the
// server-rendered container smoke test never touches the bridge. No optimistic mutation: the helper only
// sends (AC3); the control retracts when the daemon's next turn_state{idle} returns `phase` to idle, via
// this subscription — no new client state, no "stopping" flag, no timers. In-file and not exported, like
// QueuedBacklogControl.
function InterruptControl(): JSX.Element | null {
  const phase = useTimelineStore(selectPhase)
  return (
    <InterruptButton
      isRunning={isTurnRunning(phase)}
      onInterrupt={() => sendInterrupt({ sendCommand: window.pyry.sendCommand })}
    />
  )
}

// #296: the client-owned accessible name for the drop control (the EMPTY_THREAD_COPY / WORKSPACE_CHIP_LABEL
// idiom). An icon-only button has no visible text, so aria-label supplies its accessible name (the
// .composer__send / .status-sheet__close pattern already in this file). Never a daemon string.
const DROP_QUEUED_LABEL = 'Drop queued message'

// #294: the held queued backlog view — the messages queued while the daemon is busy (#293's
// replacement-truth queue store), rendered as the not-yet-run tail below the delivered thread. Pure
// props-in/markup-out and exported so tests server-render an injected QueuedItem[] with no store (the
// Timeline / ThinkingIndicator split). Reads `readonly QueuedItem[]` — the wire type held verbatim by
// the store (snake_case, no camelCase remap), so `item.text` / `item.queued_msg_id` are read directly.
//
// items empty → null (the ThinkingIndicator posture): no region, no empty-state chrome (AC4), distinct
// from the Timeline's empty-thread invitation. Live reactivity (AC3) is free from the store
// subscription in the container: a fresh queue_state snapshot replaces the backlog and re-renders here.
//
// Queued messages are the user's own pending sends, so each row reuses the right-aligned user treatment
// (.message-row--user / .bubble--user) unchanged, carrying its own thread role data-thread-role="queued"
// — distinct from the delivered userText row's "user", the AC2 "distinct from delivered" seam. The
// region's 50% dimming (the .tool-row pending precedent) is the within-token "waiting / not yet run"
// signal. `text` is UNTRUSTED, client-originated transit content rendered as auto-escaped React children
// — never dangerouslySetInnerHTML (the wire type's own comment mandates plain-text render; load-bearing
// even though this slice is not security-sensitive). React key = queued_msg_id, a real per-conversation
// unique integer (better than an array index).
//
// #296: each row gains a drop / cancel affordance — an icon-only button, a leading sibling of the bubble
// inside the right-aligned .message-row--user, so it sits at the row's inner edge. `onDrop` is a REQUIRED
// injected effect (the PermissionModalView "a view that cannot answer is a bug" rule) taking only the
// row's queued_msg_id — the CONTAINER owns the conversation id (the conversation-id wall: QueuedItem
// carries none), so the view never sees it. The button appears ONLY here; the delivered rows are drawn by
// Timeline (untouched), so "affordance only on queued rows" (AC4) and "delivered rows unaffected" (AC5)
// are structural, not conventions — no code path reaches a delivered row with this button.
export function QueuedBacklog({
  items,
  onDrop
}: {
  items: readonly QueuedItem[]
  onDrop: (queuedMsgId: number) => void
}): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="conversation__queued">
      {items.map((item) => (
        <div className="message-row message-row--user" key={item.queued_msg_id}>
          <button
            type="button"
            className="queued-row__drop"
            aria-label={DROP_QUEUED_LABEL}
            onClick={() => onDrop(item.queued_msg_id)}
          >
            <svg
              className="queued-row__drop-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
          <div className="bubble bubble--user" data-thread-role="queued">
            {item.text}
          </div>
        </div>
      ))}
    </div>
  )
}

// The store-bound container for the queued backlog (#294, re-keyed by #448). Reads the ACTIVE
// conversation's backlog — the id the composer now sends under — via a useMemo-stable selector per id.
// selectBacklogFor returns the same array reference (or the stable EMPTY_BACKLOG) for a given id, so a
// snapshot for a DIFFERENT conversation is Object.is-stable here → no re-render churn (AC3
// free-of-noise). With no active conversation the sentinel '' matches nothing and yields the stable
// empty backlog. A pure store read — no window.pyry, no IPC, no effects (AC5).
//
// #296: binds onDrop to the pure dropQueuedMessage helper, supplying the active conversation id (the
// conversation-id wall — the row has none). A populated row implies an active id (the daemon queues
// under real ids only), so the null case cannot reach onDrop; the guard is belt-and-braces.
// window.pyry.sendCommand is dereferenced ONLY inside the click closure (interaction time, never
// render — the Composer.handleSubmit / PermissionModal discipline), so the empty-backlog container
// smoke test stays bridge-free. No optimistic mutation: the helper only sends (AC3); the dropped row
// leaves on the next queue_state snapshot via this subscription.
function QueuedBacklogControl(): JSX.Element | null {
  const activeConversationId = useActiveConversationStore((s) => s.activeConversation?.id ?? null)
  const selectActiveBacklog = useMemo(
    () => selectBacklogFor(activeConversationId ?? ''),
    [activeConversationId]
  )
  const items = useQueueStore(selectActiveBacklog)
  return (
    <QueuedBacklog
      items={items}
      onDrop={(queuedMsgId) => {
        if (activeConversationId === null) return
        dropQueuedMessage(activeConversationId, queuedMsgId, {
          sendCommand: window.pyry.sendCommand
        })
      }}
    />
  )
}

// The collapsed status row between the thread and the composer (Figma node 16-57) — the trigger that
// opens the Run configuration sheet (#177). Its live `model · effort · context%` summary (the left
// region) is the collapsed mirror of the sheet's read sections, owned by #181/#182; this shell renders
// the row as the trigger only, leaving that region empty. An icon-only button, so aria-label supplies
// the accessible name (the .composer__send pattern). In-file and not exported, like Composer.
function StatusRow({ onExpand }: { onExpand: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="status-row"
      aria-label="Run configuration"
      aria-haspopup="dialog"
      onClick={onExpand}
    >
      {/* The live summary region. #330 mounts the two-dot connection indicator here as a distinct child;
          #181/#182's run-config summary text ("Opus 4.7 · high · 73% used") lands as a SIBLING beside it —
          this slot is a flex row, not claimed exclusively by either. */}
      <span className="status-row__summary">
        <ConnectionStatusIndicatorControl />
      </span>
      <svg
        className="status-row__chevron"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
      </svg>
    </button>
  )
}

// #581: the background-task panel's trigger label — client-owned copy, apostrophe-free (the standing
// renderToStaticMarkup lesson). Never a daemon string.
const BACKGROUND_TASK_TRIGGER_LABEL = 'Background tasks'

// #581: the trigger that opens the background-task panel — the StatusRow idiom (an icon-only button whose
// aria-label supplies its accessible name, advertising its popup via aria-haspopup="dialog"), mounted as a
// StatusRow sibling. Chosen over the two other trigger idioms the ticket names: the overflow menu is
// hardcoded to a single item, so routing through it would mean generalising the menu and its tests for no
// gain here; and WorkspaceChip self-gates to null once the thread has a message, which is exactly when
// background tasks exist. It subscribes to nothing — the panel owns the store read. In-file, like StatusRow.
function BackgroundTaskTrigger({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="background-task-trigger"
      aria-label={BACKGROUND_TASK_TRIGGER_LABEL}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {/* The Material `schedule` glyph — decorative, so aria-hidden; the button's aria-label is the
          accessible name. */}
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
      </svg>
    </button>
  )
}

// A stable id tying the dialog's aria-labelledby to its title element.
const STATUS_SHEET_TITLE_ID = 'status-sheet-title'

export interface StatusSheetProps {
  onClose: () => void
  // Each Run configuration section (Model/Effort/YOLO/Context window/Log data) mounts as a child so
  // StatusSheet stays a pure shell — a childless sheet has no sections, keeping the shell-only test
  // (#177) valid. #72 mounts <LogDataSection/>; #181/#182 add the others.
  children?: ReactNode
}

// The Run configuration host modal (#177) — an absolutely-positioned overlay inside .conversation
// (not a React portal), bottom-anchored, matching Figma node 20-100. This shell renders only the
// drag handle, the title row, and an empty scrollable body; each section (Model/Effort/YOLO/Context
// window/Log data) is a follow-up (#181/#182/#72) that owns both its header and its content — add
// none here. Exported and pure (props in, markup out), the MessageThread pattern, so the open-state
// chrome is server-rendered directly in tests. The × close control is the authoritative dismissal
// (AC3); the scrim adds near-free backdrop-click dismissal.
export function StatusSheet({ onClose, children }: StatusSheetProps): JSX.Element {
  return (
    <div className="status-sheet-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed. */}
      <div className="status-sheet-overlay__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="status-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={STATUS_SHEET_TITLE_ID}
      >
        <div className="status-sheet__handle" aria-hidden="true" />
        <div className="status-sheet__header">
          <p id={STATUS_SHEET_TITLE_ID} className="status-sheet__title">
            Run configuration
          </p>
          <button type="button" className="status-sheet__close" aria-label="Close" onClick={onClose}>
            <svg
              className="status-sheet__close-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        {/* The scrollable container follow-ups populate section by section; each child owns both its
            header and its content. Empty (no children) in the shell-only test. */}
        <div className="status-sheet__body">{children}</div>
      </div>
    </div>
  )
}

// #365: the Channel Info sheet's copy + its title id — module-level, client-owned constants (the
// EMPTY_THREAD_COPY / WORKSPACE_CHIP_LABEL idiom). Every literal is apostrophe-free: renderToStaticMarkup
// escapes `'` → `&#x27;` (the standing desktop lesson). None is ever a daemon string — the only daemon
// values the sheet renders (name / cwd / id) are auto-escaped React children, never these labels.
const CHANNEL_INFO_FALLBACK_TITLE = 'Channel info'
const UNNAMED_CONVERSATION_LABEL = 'Unnamed conversation'
const CHANNEL_INFO_ABOUT_HEADER = 'About'
const CHANNEL_INFO_ACTIONS_HEADER = 'Actions'
const CHANNEL_INFO_WORKSPACE_LABEL = 'Workspace'
const CHANNEL_INFO_LAST_ACTIVITY_LABEL = 'Last activity'
const CHANNEL_INFO_EMPTY_COPY = 'No conversation details yet'
const CHANNEL_ID_PREFIX = 'Channel ID: '
// Distinct from STATUS_SHEET_TITLE_ID so both sheets can coexist without duplicate ids.
const CHANNEL_INFO_SHEET_TITLE_ID = 'channel-info-sheet-title'

// #365: the Channel Info sheet's pure view (Figma node 20-48) — the StatusSheet twin, reusing its
// `.status-sheet__*` overlay/scrim/panel/handle/header/close/body chrome verbatim (the ticket sanctions
// the reuse) and adding only the About detail, the empty Actions slot, and the Channel ID footer. Pure
// props-in/markup-out (no store, no effects, no window.pyry) and exported so tests server-render it with
// an injected conversation — the StatusSheet / ThreadOverflowMenuView discipline.
//
// `conversation` is the active conversation (activeConversationStore's held ConversationCreatedPayload) or
// `null` — a list-opened thread never populates the store (the app is single-active-conversation until the
// deferred select-and-load transport lands), so the sheet must open gracefully on `null`: chrome + a
// placeholder About, the Channel ID footer omitted (there is no id). `now` (ms, defaulted to Date.now() —
// the Timeline precedent) feeds the Last-activity relative time, kept out of the payload so it stays fresh
// and injectable under test.
//
// The daemon strings (name / cwd / id) reach the DOM only as auto-escaped React children — never
// dangerouslySetInnerHTML, never path/markup interpretation (the WorkspaceChip / toolCall posture). They
// are already rendered elsewhere in this file, so no new trust boundary.
export function ChannelInfoSheetView({
  conversation,
  now = Date.now(),
  onClose,
  onRename,
  onArchive,
  onDelete,
  deleteConfirmPending,
  onDeleteConfirm,
  onDeleteCancel
}: {
  conversation: ConversationCreatedPayload | null
  now?: number
  onClose: () => void
  // #368: the Rename action, supplied by the container ONLY when there is a conversation to rename.
  // Absent ⇒ no Rename control (the list-opened null-conversation case, AC1) — the ChannelList
  // `onRename?`-optional-affordance idiom: the button is gated on the callback, not on `conversation`.
  onRename?: () => void
  // #366: the Archive action, callback-gated exactly like `onRename` (supplied only for an active
  // conversation, AC1). Reuses #368's `.channel-info__action` tonal pill verbatim; renders below Rename.
  onArchive?: () => void
  // #377: the Delete action, callback-gated like the others (supplied only for an active conversation,
  // AC1). Delete is a two-step: `onDelete` opens the inline confirm (it never dispatches, AC2); the
  // container owns the confirm state and threads `deleteConfirmPending` (which sub-state to render),
  // `onDeleteConfirm` (dispatch + close) and `onDeleteCancel` (dismiss, no wire effect, AC3).
  onDelete?: () => void
  deleteConfirmPending?: boolean
  onDeleteConfirm?: () => void
  onDeleteCancel?: () => void
}): JSX.Element {
  // Title: the daemon name when present; the client-owned unnamed label when `name === null` (a distinct
  // "unnamed scratch conversation", not an empty string); the fallback when there is no conversation.
  const title =
    conversation === null
      ? CHANNEL_INFO_FALLBACK_TITLE
      : (conversation.name ?? UNNAMED_CONVERSATION_LABEL)
  return (
    <div className="status-sheet-overlay">
      <div className="status-sheet-overlay__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="status-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={CHANNEL_INFO_SHEET_TITLE_ID}
      >
        <div className="status-sheet__handle" aria-hidden="true" />
        <div className="status-sheet__header">
          <p id={CHANNEL_INFO_SHEET_TITLE_ID} className="status-sheet__title">
            {title}
          </p>
          <button type="button" className="status-sheet__close" aria-label="Close" onClick={onClose}>
            <svg
              className="status-sheet__close-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <div className="status-sheet__body">
          <p className="status-sheet__section-header">{CHANNEL_INFO_ABOUT_HEADER}</p>
          {conversation === null ? (
            // The graceful-empty About: a single placeholder line, no rows (AC4).
            <p className="channel-info__empty">{CHANNEL_INFO_EMPTY_COPY}</p>
          ) : (
            <>
              <div className="channel-info__row">
                <span className="channel-info__row-label">{CHANNEL_INFO_WORKSPACE_LABEL}</span>
                {/* `cwd` is opaque daemon display text — auto-escaped, never resolved as a path. */}
                <span className="channel-info__row-value--mono">{conversation.cwd}</span>
              </div>
              <div className="channel-info__row">
                <span className="channel-info__row-label">{CHANNEL_INFO_LAST_ACTIVITY_LABEL}</span>
                {/* formatLastActivity returns '' only on an unparseable timestamp (last_used_at is always
                    present) — an em-dash then keeps the row from looking broken. */}
                <span className="channel-info__row-value">
                  {formatLastActivity(conversation.last_used_at, now) || '—'}
                </span>
              </div>
            </>
          )}
          <p className="status-sheet__section-header">{CHANNEL_INFO_ACTIONS_HEADER}</p>
          {/* The Actions slot #365 left for #366/#367/#368. Rename (#368) then Archive (#366) then
              Delete (#377), each a `.channel-info__action` tonal pill rendered only when its callback is
              supplied (⇒ there is an active conversation). Destructive-last order: edit (Rename) →
              soft-remove (Archive) → permanent Delete (#377) — the last carrying the `--danger` variant
              and an inline confirm before it dispatches. */}
          <div className="channel-info__actions">
            {onRename && (
              <button type="button" className="channel-info__action" onClick={onRename}>
                Rename
              </button>
            )}
            {onArchive && (
              <button type="button" className="channel-info__action" onClick={onArchive}>
                Archive
              </button>
            )}
            {onDelete &&
              (deleteConfirmPending ? (
                // The confirm step, in place of the pill: a prompt line then Cancel (no-op escape) and
                // the destructive confirm, both full-width pills stacked in the existing flex column.
                <>
                  <p className="channel-info__confirm-text">
                    Delete this conversation permanently? This cannot be undone.
                  </p>
                  <button type="button" className="channel-info__action" onClick={onDeleteCancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="channel-info__action channel-info__action--danger"
                    onClick={onDeleteConfirm}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="channel-info__action channel-info__action--danger"
                  onClick={onDelete}
                >
                  Delete
                </button>
              ))}
          </div>
          {conversation !== null && (
            <p className="channel-info__footer">{CHANNEL_ID_PREFIX + conversation.id}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// #366: fire the `archiveConversation` command (#363 wired the main side through to the daemon). An
// inline literal typed as RendererCommand — no constructor added, keeping the change renderer-contained,
// the mirror-image of `requestUnarchiveConversation` (both a single REQUIRED `conversation_id`, both
// fire-and-forget: `sendCommand` returns void, no try/catch). Exported so the dispatch stays directly
// unit-testable — the sheet renders server-side only, so the click handler cannot be fired via a DOM
// event. The archived conversation leaving the active list is free: the daemon replies with
// `conversation_updated`, on which the existing list bridge re-requests the conversations (#275).
export function requestArchiveConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string
): void {
  sendCommand({ type: 'archiveConversation', payload: { conversation_id: conversationId } })
}

// #377: fire the `deleteConversation` command (#364 wired the main side through to the daemon, and #376
// reflects the removal by re-listing on the `conversationDeleted` event). Cloned from
// `requestArchiveConversation` — the nearest sibling: a single REQUIRED `conversation_id`, fire-and-forget
// (`sendCommand` returns void, no try/catch), an inline literal typed as RendererCommand with no
// constructor. Exported so the dispatch stays directly unit-testable: the sheet renders server-side only,
// so the confirm handler cannot be fired via a DOM event.
export function requestDeleteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string
): void {
  sendCommand({ type: 'deleteConversation', payload: { conversation_id: conversationId } })
}

// #365: the Channel Info sheet's thin interaction container (the ThreadOverflowMenu idiom minus its own
// open-state, which ConversationScreen owns). Its sole effect is an Escape document-listener: because the
// sheet only mounts while open (gated in ConversationScreen), the listener attaches on mount and detaches
// on unmount via the cleanup — no `open` flag needed, no leak past close. Renders the pure view. In-file
// and not exported, like ThreadOverflowMenu.
function ChannelInfoSheet({
  conversation,
  now,
  onClose
}: {
  conversation: ConversationCreatedPayload | null
  now: number
  onClose: () => void
}): JSX.Element {
  // #368: the Rename dialog's per-interaction state — a screen-local copy of the ChannelList shape
  // (transient UI state → useState, not the store; ADR 0006). `renameOpen` gates the dialog; `renameName`
  // is the controlled field, seeded from the conversation's displayed title on open. Both reset for free
  // on the sheet's unmount (it only mounts while open). `window.pyry` is dereferenced only inside the
  // interaction callbacks below, never during render, so the pure view stays server-renderable.
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  // #377: the Delete confirm's per-interaction state — the `renameOpen` twin (transient UI state →
  // useState, not the store; ADR 0006). It gates the inline confirm step and resets for free on the
  // sheet's unmount (it only mounts while open). `window.pyry` is dereferenced only inside onDeleteConfirm.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  useEffect(() => {
    // Index the DOM event map — the top-level `import { type KeyboardEvent }` shadows the global one, so a
    // bare `KeyboardEvent` annotation would resolve to React's synthetic type (the ThreadOverflowMenu note).
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <>
      <ChannelInfoSheetView
        conversation={conversation}
        now={now}
        onClose={onClose}
        // Supply onRename ONLY for a non-null conversation — a null active conversation yields no button
        // (AC1). Seed the field via titleFor so a null-name conversation prefills with 'Untitled' (AC2).
        onRename={
          conversation === null
            ? undefined
            : () => {
                setRenameName(titleFor(conversation.name))
                setRenameOpen(true)
              }
        }
        // #366: Archive dispatches then closes (no dialog — unlike Rename). Supplied only for a non-null
        // conversation (AC1). `window.pyry` is dereferenced only inside this callback (AC4).
        onArchive={
          conversation === null
            ? undefined
            : () => {
                requestArchiveConversation(window.pyry.sendCommand, conversation.id)
                onClose()
              }
        }
        // #377: Delete is the two-step destructive action. onDelete only opens the confirm (no wire
        // traffic, AC2); it is supplied only for a non-null conversation (AC1), mirroring onArchive's
        // gating. onDeleteConfirm dispatches then closes — `window.pyry` is dereferenced ONLY here (AC5).
        // onDeleteCancel dismisses with no wire effect (AC3).
        onDelete={conversation === null ? undefined : () => setDeleteConfirmOpen(true)}
        deleteConfirmPending={deleteConfirmOpen}
        onDeleteConfirm={
          conversation === null
            ? undefined
            : () => {
                requestDeleteConversation(window.pyry.sendCommand, conversation.id)
                onClose()
              }
        }
        onDeleteCancel={() => setDeleteConfirmOpen(false)}
      />
      {renameOpen && conversation !== null && (
        <RenameConversationDialogView
          name={renameName}
          onNameChange={setRenameName}
          onCancel={() => setRenameOpen(false)}
          onSave={() => {
            requestRenameConversation(window.pyry.sendCommand, conversation, renameName)
            setRenameOpen(false)
          }}
        />
      )}
    </>
  )
}

// #602: `onMessageSent` fires exactly when the operator's message enters the timeline. REQUIRED, not
// optional — `<Composer />` above is the only render site in the repo (Composer is not exported and no test
// renders it), so requiring it costs no edit cascade and makes "forgot to wire it" a compile error. That is
// the opposite call from Timeline's optional `scrollPin`, and for the opposite reason: there, 30 existing
// render sites made optional the only non-cascading choice.
function Composer({ onMessageSent }: { onMessageSent: () => void }): JSX.Element {
  // Thin controlled container over composerSend.submitMessage (the pairing container/pure-logic
  // split). Input text is ephemeral single-value screen-local state → useState, never the store
  // (ADR 0006). `dispatch` identity is stable, so selecting it adds no re-render churn.
  const [text, setText] = useState('')
  // #179: the optimistic echo now writes into timelineStore (a userText ThreadEvent), not sessionStore
  // — content lives in one store. The send gate below still reads sessionStore's connection status;
  // two stores in one component is fine (status vs. content are orthogonal facets).
  const dispatch = useTimelineStore((s) => s.dispatch)
  // #31: gate the send control on the live connection status. Selecting `status` re-renders the
  // Composer when it changes, so the control re-enables reactively on connect (AC3) with no reload.
  // The thread selects only the timeline `items` slice, so status changes don't re-render it.
  const status = useSessionStore(selectStatus)
  const { canSend, hint } = composerAvailability(status)
  // #448: the send targets the ACTIVE conversation. submitMessage no-ops on a null id (the daemon
  // rejects an unknown conversation_id with an error frame, so a placeholder is never sent).
  const activeConversationId = useActiveConversationStore((s) => s.activeConversation?.id ?? null)

  const handleSubmit = (): void => {
    // AC1: the authoritative gate. Return before touching submitMessage so no sendCommand and no
    // optimistic echo fire while not connected — this blocks the Enter path (handleKeyDown) as well
    // as the button. The input is not cleared; nothing was sent.
    if (!canSend) return
    // `window.pyry` is dereferenced only here, at interaction time — never during render — so the
    // server-rendered container smoke test never touches the bridge.
    const sent = submitMessage(text, activeConversationId, {
      sendCommand: window.pyry.sendCommand,
      dispatch,
      newMessageId: () => crypto.randomUUID()
    })
    // #602: `sent === true` is exactly "a message entered the timeline", which is why the notify sits HERE
    // and not at the top of this function or just past the `!canSend` gate. Both of submitMessage's `false`
    // returns (composerSend.ts:47-48 — whitespace-only, null conversation id) are above its echo dispatch,
    // and the gate above returns before submitMessage is called at all, so a submit that sends nothing never
    // reaches this line: it leaves the scroll position as the operator's own scrolling set it and leaves NO
    // armed pin behind, so the next unrelated arriving item still cannot yank a scrolled-up operator. A send
    // whose bridge call throws is caught (composerSend.ts:60-63), still posts the echo and still returns
    // `true`, so it follows — correctly, because the timeline did move.
    if (sent) {
      setText('')
      onMessageSent()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter inserts a newline; the Enter that commits an IME composition does
    // neither (#512). `isComposing` is on the DOM event, not React's synthetic one, so it is read
    // through `nativeEvent` — writing `event.isComposing` is a compile error, which is what keeps
    // this untested glue honest. The `return` MUST precede preventDefault(): preventing the default
    // on the committing keydown would break the IME commit itself.
    const { key, shiftKey, nativeEvent } = event
    if (!shouldSubmitOnKeyDown({ key, shiftKey, isComposing: nativeEvent.isComposing })) return
    event.preventDefault()
    handleSubmit()
  }

  return (
    <div className="composer">
      {/* role="status" makes this a polite live region: a screen reader announces the change
          without stealing focus (AC2/AC3). On connect, `hint` is null, the caption unmounts. */}
      {hint && (
        <p className="composer__hint" role="status">
          {hint}
        </p>
      )}
      <div className="composer__row">
        {/* The textarea stays enabled while not connected — the user may draft; only the send
            control is gated (AC1). */}
        <textarea
          className="composer__input"
          placeholder="Message…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="composer__send"
          aria-label="Send"
          onClick={handleSubmit}
          disabled={!canSend}
        >
          <svg
            className="composer__send-icon"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// #167: the proactive re-pair affordance's pure view. Returns null unless shouldOfferRepair(status),
// i.e. only in a terminal, non-retryable error — where it extends the composer's inline error hint
// with an escape hatch back to pairing. Visibility is a `status` PROP (not a store read) so the
// present/absent matrix is proven by directly server-rendering this view — the container's populated
// branch is unreachable under server render (zustand v5 reads getInitialState() = disconnected). A bare
// text button whose accessible name is its visible `Re-pair` text, reusing the .conversation__unpair
// de-emphasized treatment (#166's Unpair); the wrapper only positions it beneath the composer hint.
export function RepairPrompt({
  status,
  onRepair
}: {
  status: ConnectionStatus
  onRepair: () => void
}): JSX.Element | null {
  if (!shouldOfferRepair(status)) return null
  return (
    <div className="composer__repair">
      <button type="button" className="conversation__unpair" onClick={onRepair}>
        Re-pair
      </button>
    </div>
  )
}

// The store-bound container for the re-pair affordance (#167). Selects `status` independently of
// ConversationScreen (which selects only messages), so a status change re-renders Composer and this
// control — never the thread. Re-pair reuses the SAME clear-and-return-to-pairing flow as the manual
// unpair (runUnpair): no second clear path, no new IPC. Unlike UnpairControl it has no confirm or busy
// phase — it only appears in an already-terminal error, so a confirm step is pure friction, and it
// self-hides on both outcomes (ok → store resets to disconnected + route unmounts the screen; error →
// store lands on code 'unpair', which the predicate excludes). So handleRepair fires runUnpair as a
// bare `void`: runUnpair never rejects (it catches internally), so the floating promise is safe and
// needs no `.then`. window.pyry is dereferenced only inside handleRepair (interaction time), never
// during render, so the container smoke-render never touches the bridge.
function RepairControl({ onUnpaired }: { onUnpaired?: () => void }): JSX.Element | null {
  const status = useSessionStore(selectStatus)
  const dispatch = useSessionStore((s) => s.dispatch)

  const handleRepair = (): void => {
    void runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired: () => onUnpaired?.() })
  }

  return <RepairPrompt status={status} onRepair={handleRepair} />
}

// #279: the prominent, disconnected-only connection banner's pure view — the third read of the
// ConnectionStatus slice (beside the composer gate and the re-pair prompt), and the surface
// composerSend's docstring already reserves ("the connection banner's surface"). Returns null unless
// shouldShowBanner(status); when shown, renders a single band carrying CONNECTION_BANNER_COPY and
// nothing derived from `status` — so no daemon-supplied string (ConnectionError.message) can reach it
// (AC3, a structural guarantee, not a convention — the EMPTY_THREAD_COPY / ThinkingIndicator idiom).
// Visibility is a `status` PROP (not a store read) so the present/absent matrix is proven by directly
// server-rendering this view (the RepairPrompt discipline). role="status" makes it a polite live region
// (the .composer__hint treatment): the band persists visually, so a polite announcement suffices and
// avoids an assertive double-announce with the composer hint. The band is deliberately MORE prominent
// copy than the composer's terse gate (AC5), and both remain visible while disconnected.
export function ConnectionBanner({ status }: { status: ConnectionStatus }): JSX.Element | null {
  if (!shouldShowBanner(status)) return null
  return (
    <p className="conversation__banner" role="status">
      {CONNECTION_BANNER_COPY}
    </p>
  )
}

// The store-bound container for the connection banner (#279). Selects only `status` (selectStatus) so
// it re-renders exactly on a connection-status change and never on a timeline delta (AC4 reactivity —
// the same narrow-slice seam the composer gate and RepairControl already use; no new store wiring, no
// window.pyry dereference, no effects — a pure read). Unlike RepairControl, whose visible branch needs
// `error`, the banner's disconnected branch is a VISIBLE state, so the initial (disconnected) store is
// enough to server-render the container's shown path.
function ConnectionBannerControl(): JSX.Element | null {
  const status = useSessionStore(selectStatus)
  return <ConnectionBanner status={status} />
}

// #330: the two-dot Relay/Pyrycode connection-status indicator — the persistent at-a-glance state that
// complements the failure-only ConnectionBanner (#279). Two legs read independently: the relay-socket leg
// (relayLinkStore, #329) and the daemon-session leg (sessionStore's ConnectionStatus). Mirrors mobile's
// ConnectionStatusLine (mobile #397/#398): each leg shows its own honest state so "relay up, daemon still
// handshaking" is expressible rather than a single false "connected".

// A leg's coarse display category. The dot colour is driven ONLY by this (success / warning / error); the
// visible status word rides `label`, so status is legible without colour perception (AC2).
export type LegCategory = 'up' | 'in-progress' | 'down'

// One rendered leg: its category (→ dot colour) and its full visible label (leg name + status word). The
// leg name is baked into the label so the pure view stays dumb — a coloured dot plus the label, nothing
// else — and no daemon-status value ever chooses the leg name.
export interface ConnectionLeg {
  category: LegCategory
  label: string
}

// The relay-link leg mapping (#329's RelayLinkStatus | null → a ConnectionLeg). `daemon-absent` reads
// up/"Reachable" — the relay IS reachable; the missing daemon is the daemon leg's story, not a relay
// failure (mobile's DaemonAbsent → green "Reachable", AC4). `null` is the initial "relay not yet up" state
// and maps down (AC1) — the relay leg has NO in-progress arm (that category is the daemon leg's
// `connecting`). Independent of daemonLeg — the two never cross-reference (AC4). Explicit return type +
// no `default` so a future RelayLinkStatus member trips TS2366 (the exhaustive-switch guard).
export function relayLeg(status: RelayLinkStatus | null): ConnectionLeg {
  if (status === null) return { category: 'down', label: 'Relay Offline' }
  switch (status) {
    case 'connected':
      return { category: 'up', label: 'Relay Connected' }
    case 'daemon-absent':
      return { category: 'up', label: 'Relay Reachable' }
    case 'offline':
      return { category: 'down', label: 'Relay Offline' }
  }
}

// The daemon-session leg mapping (sessionStore's ConnectionStatus → a ConnectionLeg). Reaches up ONLY on
// `connected` (handshake complete) — `connecting` is in-progress (amber), never green (AC3, no false
// green). `error` maps to the same down/"Offline" as `disconnected`, rendering a fixed client-owned label
// so no ConnectionError.message reaches this indicator (the banner #279 owns the error text). Independent
// of relayLeg (AC4). Explicit return type + no `default` so a future ConnectionStatus member trips TS2366.
export function daemonLeg(status: ConnectionStatus): ConnectionLeg {
  switch (status.type) {
    case 'connected':
      return { category: 'up', label: 'Pyrycode Connected' }
    case 'connecting':
      return { category: 'in-progress', label: 'Pyrycode Connecting' }
    case 'disconnected':
      return { category: 'down', label: 'Pyrycode Offline' }
    case 'error':
      return { category: 'down', label: 'Pyrycode Offline' }
  }
}

// #330: the two-dot indicator's pure view — takes the two already-mapped legs (relay first, then daemon)
// and renders a coloured dot + its label per leg. Pure props-in/markup-out and exported so tests
// server-render the full category × label matrix directly with injected legs (the ConnectionBanner /
// ThinkingIndicator discipline). The wrapper is a STATIC labelled group, not a live region — this is the
// persistent at-a-glance state; the banner (#279) already politely announces disconnects, so a second
// live region here would double-announce. Each dot is aria-hidden (decorative — its colour is redundant
// with the label text, AC2); the category drives ONLY the dot's modifier class.
export function ConnectionStatusIndicator({
  relay,
  daemon
}: {
  relay: ConnectionLeg
  daemon: ConnectionLeg
}): JSX.Element {
  return (
    <span className="status-row__connection" role="group" aria-label="Connection status">
      <span className="conn-leg">
        <span className={`conn-dot conn-dot--${relay.category}`} aria-hidden="true" />
        <span className="conn-leg__label">{relay.label}</span>
      </span>
      <span className="conn-leg">
        <span className={`conn-dot conn-dot--${daemon.category}`} aria-hidden="true" />
        <span className="conn-leg__label">{daemon.label}</span>
      </span>
    </span>
  )
}

// The store-bound container (#330). Reads both stores with narrow single-slice selectors — the relay leg
// from relayLinkStore (#329), the daemon leg from sessionStore — and passes the mapped legs to the pure
// view (the QueuedBacklogControl two-store precedent). No window.pyry, no IPC, no effects: a pure read,
// so the server-rendered smoke test touches no bridge (initial state → two "Offline" dots, AC3 no false
// green). The two narrow selectors re-render this control only on its own leg's change.
function ConnectionStatusIndicatorControl(): JSX.Element {
  const relayStatus = useRelayLinkStore(selectRelayLinkStatus)
  const daemonStatus = useSessionStore(selectStatus)
  return <ConnectionStatusIndicator relay={relayLeg(relayStatus)} daemon={daemonLeg(daemonStatus)} />
}

// #140: the leading back affordance of the thread's top app bar (Figma node 16-9 → arrow_back 16-11):
// a 48px touch target holding the 24px arrow_back glyph in on-surface, returning to the paired shell's
// list view. Optional-prop-gated exactly like #166's onUnpaired — returns null when onBack is absent,
// so a bare `<ConversationScreen />` (no shell) is unchanged DOM-wise and only the PairedShell-mounted
// thread shows it (AC3/AC4). Icon-only, so aria-label supplies the accessible name (the
// .composer__send / StatusRow pattern). The title from Figma 16-9 is a future ticket; its trailing
// overflow menu (16-16) is #276's ThreadOverflowMenu, mounted beside this control.
function BackControl({ onBack }: { onBack?: () => void }): JSX.Element | null {
  if (!onBack) return null
  return (
    <button type="button" className="conversation__back" aria-label="Back" onClick={onBack}>
      <svg
        className="conversation__back-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
      </svg>
    </button>
  )
}

// #276: the thread top app bar's trailing overflow menu's pure view (Figma node 16-16) — the
// BackControl twin on the right edge, the single entry point to per-conversation actions. Props-in /
// markup-out with NO state and NO effects, so renderToStaticMarkup renders both the collapsed and open
// states directly (the entire tested contract, the InterruptButton / ThinkingIndicator posture). The
// interaction shell (toggle, Escape / outside-click dismiss, focus-return) lives in the container below.
//
// The trigger is an icon-only <button> carrying the 24px more_vert glyph (Figma 16-17) in a 48px frame,
// the .conversation__back treatment; aria-label supplies its accessible name, aria-haspopup="menu"
// advertises the popup, and aria-expanded tracks open/closed (React stringifies the aria boolean under
// server render → "true"/"false", both directly assertable). When `open`, a role="menu" surface drops
// below it holding a single role="menuitem" — the documented extension slot #155 and later action
// tickets (#274/#153/#154) add rows to. The item is ENABLED and routed to `onSelect` (a live no-op this
// ticket, since onChannelInfo is undefined) rather than disabled, so "dismisses on selecting an item"
// (AC3) is genuinely live now. Copy `More actions` / `Channel info` is apostrophe-free (renderToStaticMarkup
// escapes ' → &#x27; — the standing desktop lesson). `triggerRef` is forwarded for the container's
// focus-return; omitted in tests (a native <button> accepts ref={undefined}).
export function ThreadOverflowMenuView({
  open,
  onToggle,
  onSelect,
  triggerRef
}: {
  open: boolean
  onToggle: () => void
  onSelect: () => void
  triggerRef?: Ref<HTMLButtonElement>
}): JSX.Element {
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="conversation__overflow-trigger"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg
          className="conversation__overflow-icon"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
        </svg>
      </button>
      {open && (
        <div className="conversation__overflow-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="conversation__overflow-item"
            onClick={onSelect}
          >
            Channel info
          </button>
        </div>
      )}
    </>
  )
}

// #276: the store-free interaction container for the overflow menu — the thin shell around the pure view
// (the RepairControl / ConnectionBannerControl split, minus the store read: this control subscribes to
// nothing). Menu open/closed is screen-local useState, never the session store (ADR 0006, the `sheetOpen`
// precedent), so it resets to closed on remount for free (AC5). In-file and not exported, like Composer.
//
// close/select both return focus to the trigger (AC3); select also invokes onChannelInfo (undefined this
// ticket → the item just closes). Dismiss-on-Escape and dismiss-on-outside-click (AC3) attach document
// listeners only while open, torn down by the effect cleanup on close/unmount so no listener outlives an
// open menu. Both handlers read the DOM event via addEventListener's event-map inference — NOT an
// annotation — because this file imports React's `KeyboardEvent` type at the top, which would otherwise
// shadow the DOM one; the outside-click target is narrowed with `instanceof Node` (never an `as` cast).
function ThreadOverflowMenu({ onChannelInfo }: { onChannelInfo?: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const select = (): void => {
    setOpen(false)
    onChannelInfo?.()
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    // Index the DOM event map for the exact event types — the top-level `import { type KeyboardEvent }`
    // shadows the global one, so a bare `KeyboardEvent` annotation would resolve to React's synthetic type.
    const onMouseDown = (event: DocumentEventMap['mousedown']): void => {
      const target = event.target
      if (target instanceof Node && wrapperRef.current && !wrapperRef.current.contains(target)) {
        close()
      }
    }
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="conversation__overflow">
      <ThreadOverflowMenuView
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onSelect={select}
        triggerRef={triggerRef}
      />
    </div>
  )
}

// The minimal unpair escape hatch (#166) — a slim header row above the thread, the seed of the
// future top app bar. Mirrors PairingScreen in reverse: a confirm guard (AC3) then an injected
// route flip (AC2). All decision logic lives in the pure runUnpair helper; this is thin glue over an
// ephemeral confirm phase (screen-local useState, ADR 0006 — like Composer's `text`).
function UnpairControl({ onUnpaired }: { onUnpaired?: () => void }): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'unpairing'>('idle')
  const dispatch = useSessionStore((s) => s.dispatch)

  const handleConfirm = (): void => {
    // `unpairing` disables both buttons so a double-click cannot launch a second runUnpair (belt-and-
    // suspenders; clear() is idempotent regardless). window.pyry.unpair is dereferenced only here, at
    // interaction time — never during render — so the server-rendered smoke test never touches the
    // bridge (same discipline as Composer.handleSubmit).
    setPhase('unpairing')
    void runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired: () => onUnpaired?.() }).then(
      (outcome) => {
        // On 'ok' the route flips and this screen unmounts, so no 'ok' branch is needed (a setState
        // after unmount is a harmless React-18 no-op). On 'error' we stay; re-arm the idle trigger.
        if (outcome === 'error') setPhase('idle')
      }
    )
  }

  if (phase === 'idle') {
    return (
      <div className="conversation__header">
        <button
          type="button"
          className="conversation__unpair"
          onClick={() => setPhase('confirming')}
        >
          Unpair
        </button>
      </div>
    )
  }

  const busy = phase === 'unpairing'
  return (
    <div className="conversation__header">
      <span className="conversation__unpair-prompt">Forget this pairing?</span>
      <button
        type="button"
        className="conversation__unpair"
        onClick={() => setPhase('idle')}
        disabled={busy}
      >
        Cancel
      </button>
      <button
        type="button"
        className="conversation__unpair conversation__unpair--confirm"
        onClick={handleConfirm}
        disabled={busy}
      >
        {busy ? 'Forgetting…' : 'Confirm'}
      </button>
    </div>
  )
}
