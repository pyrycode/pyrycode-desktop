import { useSessionFactsStore, selectSessionFactsFor } from '../../store/sessionFactsStore'
import { McpServersSection, boundMcpText, requestMcpStatus } from './McpServersSection'
import { mcpStatusStore, selectUnacknowledgedMcpFailureFor, useMcpStatusStore } from '../../store/mcpStatusStore'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type WheelEventHandler,
  type KeyboardEventHandler,
  type UIEventHandler
} from 'react'
import './conversation.css'
import { connectedConversationHostNow, useConversationActionAvailability } from './conversationActionAvailability'
import { AssistantMarkdown } from './AssistantMarkdown'
import { MARKDOWN_OPEN_FAILED_NOTICE, MarkdownReaderView, useMarkdownReader } from './MarkdownReader'
import { PyryMark } from '../../theme/PyryMark'
import type { Message } from './messageViewModel'
import type { QueuedItem, ConversationCreatedPayload, WireResetHandoff, WireAgent, MemorySearchPayload } from '@shared/wire/types'
import type { ModelRefusalEvent, RelayLinkStatus } from '@shared/ipc/events'
import { sessionStore, useSessionStore, initialSessionState, selectStatusFor, type ConnectionStatus } from '../../store/sessionStore'
import { canRespondToPromptNow, usePromptResponseAvailability } from './promptResponseAvailability'
// #758: only the store hook survives here — the composer's optimistic echo still writes the flat store
// (dual-write, Strangler Fig). Its six selectors are gone with the reads below; retiring the store
// itself is its own ticket.
import { useTimelineStore } from '../../store/timelineStore'
import {
  conversationTimelineStore,
  useConversationTimelineStore,
  selectPrependedRowsFor,
  selectTimelineFor,
  type ConversationTimelineState
} from '../../store/conversationTimelineStore'
import { historyAskDeps, requestOlderHistory } from '../../store/historyPageBridge'
import { historyRetryDeps, retryHistoryPage, selectHistoryFailure } from './historyRetry'
import { useQueueStore, selectBacklogFor } from '../../store/queueStore'
import {
  activeConversationStore,
  useActiveConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'
import {
  useUsageLimitStore,
  selectUsageLimitFor,
  type UsageLimitReading
} from '../../store/usageLimitStore'
import { useReportedContextStore, selectReportedContextFor } from '../../store/reportedContextStore'
import { contextTokenSource } from './contextTokenSource'
import {
  useBackgroundTaskRosterStore,
  selectLiveTaskCountFor
} from '../../store/backgroundTaskRosterStore'
import { TopOverlay } from './TopOverlay'
import { useUsagePillDismissalStore, usagePillDismissalStore } from '../../store/usagePillDismissalStore'
import {
  initialTimelineState,
  type ThreadItem,
  type TimelineState,
  type TurnPhase,
  type ApiRetryStatus,
  type ResettingStatus,
  type UnrecognizedSite,
  type MessageAttachment
} from '../../store/threadTimeline'
import {
  submitMessage,
  shouldSubmitOnKeyDown,
  shouldInterruptOnKeyDown,
  composerAvailability,
  shouldOfferRepair,
  shouldOfferReconnect,
  COMPOSER_RECONNECT_BUTTON_COPY,
  shouldShowBanner,
  CONNECTION_BANNER_COPY,
  COMPOSER_ERROR_CHIP_COPY,
  COMPOSER_ERROR_CHIP_PREFIX_COPY,
  COMPOSER_REPAIR_BUTTON_COPY
} from './composerSend'
import { ComposerActionsMenu, COMPOSER_ACTIONS } from './ComposerActionsMenu'
import { ComposerOptionsMenu } from './ComposerOptionsPanel'
import { markUnavailableActions } from './composerActionAvailability'
import {
  slashCommandListStore,
  useSlashCommandListStore,
  selectSlashCommandListFor
} from '../../store/slashCommandListStore'
import { ComposerPermissionModeMenu } from './ComposerPermissionModeMenu'
import { ComposerModelMenu } from './ComposerModelMenu'
import { ComposerEffortMenu } from './ComposerEffortMenu'
import { ContextBreakdownPopover } from './ContextBreakdownPopover'
import { EffortDefaultData } from './EffortDefaultData'
import {
  ComposerAttachButton,
  ComposerAttachOutcome,
  ComposerAttachmentStrip,
  composerClassName,
  pasteCarriesImageOnly,
  useAttachmentUpload,
  useComposerFileDrop
} from './ComposerAttach'
import { useSlashCommandTypeAhead } from './ComposerSlashCommandTypeAhead'
import { contextUsagePercent, contextUsageStep } from './contextUsage'
import {
  useRunConfigStore,
  selectSnapshot,
  selectMcpServersSupported,
  sessionSupports
} from '../../store/runConfigStore'
import { runSettingsWriteStore, useRunSettingsWriteStore, selectError } from '../../store/runSettingsWriteStore'
import { sessionIdStore, useSessionIdStore, selectSessionId } from '../../store/sessionIdStore'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'
import { isAtBottom, isNearTop } from './threadScrollPosition'
import { toolHeadlineRuns } from './toolHeadline'
import { listedInputFields, shellCommandBlock } from './toolBody'
import { serverIdForOpenConversation } from './unpairAction'
import { requestRunConfigSnapshot } from './runConfigSnapshot'
import { selectDraft, useComposerDraftStore } from '../../store/composerDraftStore'
import {
  conversationListStore,
  useConversationListStore,
  selectConversations,
  selectConversationAgentFor
} from '../../store/conversationListStore'
import { dropQueuedMessage } from './dropQueuedMessage'
import { foldQueuedRows, type QueuedRowHandle } from './foldQueuedRows'
import { groupToolRows } from './groupToolRows'
import { copyMessageText } from './copyMessageText'
import { formatMessageTime } from './messageTime'
import { turnStatsByItemIndex } from './turnStats'
import { AttachmentFileIcon } from './AttachmentFileIcon'
import { isImageAttachmentName } from './attachmentIsImage'
import { BubbleAttachmentImage } from './BubbleAttachmentImage'
import { downloadAttachment, attachmentDownloadDeps } from './downloadAttachment'
import { sendInterrupt } from './sendInterrupt'
import { sendNewSession } from './sendNewSession'
import { RunConfigData } from './RunConfigData'
import { RunConfigSections, useConversationAgent } from './RunConfigSections'
import { SystemPromptSection } from './SystemPromptSection'
import { LogDataSection } from './LogDataSection'
import { PermissionModal } from './PermissionModal'
import { useModalStore, selectHasOutstandingFor } from '../../store/modalStore'
import { QuestionPanelView, optionPickEventFor, otherPickEventFor } from './QuestionPanel'
import {
  useQuestionBatchStore,
  questionBatchStore,
  selectBatchFor
} from '../../store/questionBatchStore'
import { refuseQuestionBatch, answerQuestionBatch, resolveQuestionAnswers } from './questionResolution'
import type { QuestionBatch } from '../../store/questionBatches'
import {
  useQuestionPicksStore,
  questionPicksStore,
  selectQuestionSelection,
  selectBatchSelections
} from '../../store/questionPicksStore'
import { sessionBoundaryTitle } from './sessionBoundaryViewModel'
import { compactionBoundaryTitle } from './compactionBoundaryViewModel'
import { formatSessionCost, latestSessionCostUsd } from './sessionCost'
import { formatLastActivity, titleFor } from '../channels/channelListViewModel'
// #1440 renamed this module for its new title. `requestRenameConversation` KEEPS its name: it owns the
// `renameConversation` wire literal, and renaming the helper would drift it from the verb it sends.
import { EditChatDialogView, requestRenameConversation } from '../channels/EditChatDialog'
// #1431 — the Channel info sheet's second edit modal, the same container `ChannelList` mounts from the
// Channels pen. The CONTAINER and not the view: it owns the system prompt field's daemon subscription,
// whose lifetime has to be the dialog's open lifetime. It imports nothing from this directory, so this
// is the one-way seam `EditChatDialog` already crosses, not a cycle.
import { EditChannelDialog } from '../channels/EditChannelDialog'
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
// cleanup ticket removes them). Composer stays in-file; UnpairControl was in-file here too until
// #1061 deleted it and the bare header row it owned.

// #758: "no conversation is open" as a SELECTOR rather than as a sentinel id. Module-level, so its
// identity is stable and the memoised binding below does not churn its subscription.
const selectNothingHeld = (): null => null

// #1260: the same treatment for the prepended-row count, and for `selectOpenTimelineFor`'s reason rather
// than for symmetry — `''` is an ordinary key in the timeline holder, so `?? ''` could read another
// conversation's count as the open one's. Module-level so the memoised binding's identity is stable.
const selectNoPrependedRows = (): number => 0

/**
 * #758: the selector that binds the chat pane to the OPEN conversation's own retained timeline — the
 * whole of the reader cutover. `null` in, no map lookup at all; an id in, that id's held slice or `null`.
 *
 * DO NOT reintroduce `selectTimelineFor(openConversationId ?? '')` — BackgroundTaskPanel.tsx:342's
 * idiom, which is safe THERE and not here. `''` is an ordinary key in the timeline holder (`dispatchFor`
 * mints a slice for whatever `conversation_id` the daemon asserts), so the sentinel would render that
 * slice as the open conversation's thread while nothing is open. Branching to `selectNothingHeld`
 * performs no lookup on that path, which makes the misattribution unavailable rather than unlikely.
 *
 * Exported for its unit tests and for that guard, not for a second caller: zustand v5 reads
 * `getInitialState()` under `renderToStaticMarkup`, so a seeded store is invisible to this repo's
 * renderer tier and the container can only ever be server-rendered against empty stores. The pure
 * derivation is therefore where the ticket's claim is testable at all — the `workingIndicatorState` /
 * `openToolName` / `isTurnRunning` posture already established in this file. The end-to-end proof is
 * e2e/conversation-switch-keeps-both-threads.spec.ts.
 */
export function selectOpenTimelineFor(
  openConversationId: string | null
): (s: ConversationTimelineState) => TimelineState | null {
  return openConversationId === null ? selectNothingHeld : selectTimelineFor(openConversationId)
}

export interface ConversationScreenProps {
  savedTimelineTarget?: { serverId: string; conversationId: string }
  onRepairHost?: (serverId: string) => void
  // Compatibility prop for existing embedders; repair now delegates through onRepairHost.
  onUnpaired?: () => void
  // #140: the shell's `back` dispatch — return from the thread to route `list`. #1064 deleted the
  // leading arrow that called it, and KEPT the prop: it is the screen's "am I mounted in the paired
  // shell" signal, which the overflow menu is gated on, so dropping it would unmount that menu too.
  // Optional and gated exactly like onUnpaired, so a bare `<ConversationScreen />` (no shell) shows no
  // shell-only chrome. The PairedShell-mounted thread wires it to a nav dispatch; nothing inside this
  // screen calls it any more.
  onBack?: () => void
  // #1634: the background-task drawer's open state, owned by PairedShell ABOVE this screen's per-conversation
  // remount so an open drawer stays open across a switch. Optional as a pair: a bare `<ConversationScreen />`
  // passes neither and the screen keeps its own state, which is what leaves every existing render unchanged.
  backgroundTasksOpen?: boolean
  onBackgroundTasksOpenChange?: (open: boolean) => void
}

export function ConversationScreen({
  savedTimelineTarget,
  onRepairHost,
  onBack,
  backgroundTasksOpen,
  onBackgroundTasksOpenChange
}: ConversationScreenProps = {}): JSX.Element {
  // The current conversation snapshot feeds the top-bar name, Channel Info, edit dialogs and task panel.
  // PairedShell's useActiveConversationReseed updates it from list replies, including renames and
  // automatic naming. Reuse this subscription so the title follows refreshes without reopening the chat.
  // #758 moved it ABOVE the timeline read, which now needs its id: same hook, same selector, same single
  // subscription, only its position in the hook list changed (stable across renders).
  const activeConversation = useActiveConversationStore(selectActiveConversation)
  // #758: the thread on screen is the OPEN conversation's own retained timeline, not the flat
  // single-thread store — which `activateConversation` still resets on every switch, into a store nothing
  // reads any more. That is the whole of "leaving a chat and coming back keeps both threads": the rows
  // that arrived while the operator was elsewhere are still held under their own conversation's key.
  //
  // `??` and not `||`: an empty-string id must survive as an ordinary key rather than collapse into
  // "nothing open" (the :281 / :1955 spelling this file already uses).
  const openConversationId = activeConversation?.id ?? null
  const actionsAvailable = useConversationActionAvailability(openConversationId)
  // A useMemo-stable selector per id (the BackgroundTaskPanel.tsx:342 idiom) so a fresh closure per render
  // does not churn the subscription. NOTHING wraps, copies, maps or derives the result inside the
  // subscription, which is what keeps the selector's return Object.is-stable: a write for ANOTHER
  // conversation rebuilds the outer map but copies every survivor by reference
  // (conversationTimelineStore.ts:214-217), so `get(openId)` hands back the same slice object and this
  // screen does not re-render. That is what makes the switch cheap.
  const selectOpenTimeline = useMemo(
    () => selectOpenTimelineFor(openConversationId),
    [openConversationId]
  )
  const heldTimeline = useConversationTimelineStore(selectOpenTimeline)
  // Active metadata can be reseeded from the wire; the clicked saved coordinates remain client-owned.
  const selectedHost = savedTimelineTarget?.conversationId === openConversationId
    ? savedTimelineTarget.serverId
    : activeConversation !== null && 'serverId' in activeConversation &&
      typeof activeConversation.serverId === 'string' ? activeConversation.serverId : null
  const offline = useSessionStore(s => selectedHost !== null && s.statuses.get(selectedHost)?.type !== 'connected')
  const heldSlice = useConversationTimelineStore(s => openConversationId === null ? undefined : s.timelines.get(openConversationId))
  const ownSlice = heldSlice?.serverId === selectedHost ? heldSlice : undefined
  const openTimeline = selectedHost !== null && ownSlice === undefined ? null : heldTimeline
  const localStatus = ownSlice?.localRead ?? (ownSlice === undefined ? 'loading' : 'loaded')
  const coverage = ownSlice?.coverage ?? (ownSlice?.history?.status === 'loaded'
    ? ownSlice.history : ownSlice?.restored?.coverage)
  const olderSaved = offline && localStatus === 'loaded' &&
    !(coverage && 'atStart' in coverage && coverage.atStart)
  // The absent-slice branch is WRITTEN OUT. `selectTimelineFor(id) ?? initialTimelineState` is banned at
  // every read site (conversationTimelineStore.ts:44-49) because it collapses "nothing is held for this
  // conversation" into "observed, nothing in the thread" with no type error and no failing test; the
  // nullable return is what forces this branch to be written and reasoned about.
  //
  // What `null` means HERE is "no conversation is open" — not "the open one has no rows". #786 stamps the
  // open conversation at the activation seam and `markViewed` CREATES its slice, so by the time this
  // renders an open conversation always has one. The reachable cases are the nullary notification `open`
  // before any conversation was activated (PairedShell.tsx:275) and a bare `<ConversationScreen />` in a
  // test. Both readings put the SAME shipped empty thread on screen, and that resolution is a decision:
  // with no conversation open there is no thread to be about, and an empty thread is the honest render —
  // exactly today's behaviour against an empty flat store. No test can tell the two readings apart at this
  // site, because both render identically; the test that CAN fail is the empty-string-key one in
  // ConversationScreen.test.tsx's `selectOpenTimelineFor` describe.
  const thread = openTimeline === null ? initialTimelineState : openTimeline
  // The seven names below are `TimelineState`'s own seven fields, so every line of JSX under this container
  // is untouched by the cutover. Subscribing to the whole slice rather than to seven narrow selectors is
  // re-render-neutral: each of the six scalars' own comments recorded that it "adds no meaningful
  // re-render churn beyond the items delta already here", so these are the same renders from one
  // subscription instead of six.
  //
  //   items            — #179: the structured-stream rows, the single thread surface since the coarse
  //                      MessageThread was retired. `ThreadItem` is already the render model (ADR 0008,
  //                      camelCase, conversation_id-free), so it flows straight to the pure Timeline view.
  //   phase            — #215: the coarse lifecycle phase. The container derives the indicator state and
  //                      passes only that down, so the LABEL CHOICE stays a closed client-owned union.
  //   stalled          — #317: the onset-only stall scalar; a plain boolean, so no daemon string reaches
  //                      the view.
  //   apiRetry         — #493: the live api-retry status; two integers and no string field.
  //   compacting       — #496: the auto-compaction liveness fact; a plain boolean.
  //   localSendPending — #650: the locally-opened working-indicator window — the one renderer-sourced
  //                      scalar of the five, opened by the operator's own send.
  //   thinkingTokens   — #1314: the latest thinking-token reading, or null. The second of the six to
  //                      carry a value rather than a liveness fact, and like `apiRetry`'s two integers
  //                      it is a number and no string field, so the view's "structurally cannot carry a
  //                      daemon string" guarantee is preserved. It does NOT join the `ThreadStatus`
  //                      record below: that record decides WHICH of the five labels the slot shows, and
  //                      the reading changes none of that — it only extends the text of one of them.
  const { items, phase, stalled, apiRetry, compacting, localSendPending, thinkingTokens, resetting } =
    thread
  const openTool = openToolCall(items)
  // #1556: hoisted out of the JSX — the `openTool` precedent one line up — because the status row now has
  // TWO consumers of this one answer. The label has always read it; the icon's gate joins it, so deriving
  // it once is what stops the two from ever disagreeing about the same render (they disagreed for a full
  // round trip until this ticket, which is the bug). Cheap and pure: the same call the JSX made inline.
  const indicatorState = workingIndicatorStateWithLocalSend(
    { phase, apiRetry, compacting, stalled, resetting },
    localSendPending
  )
  // #1653: which agent runs the open conversation, so a Codex reset says it is restarting codex. Read
  // from the CLIENT-HELD host's own rows through #1649's selector, memoised per (host, id) so a fresh
  // closure per render does not churn the subscription. A primitive, so the read is Object.is-stable.
  const selectOpenAgent = useMemo(
    () => (openConversationId === null
      ? (): WireAgent => 'claude'
      : selectConversationAgentFor(selectedHost, openConversationId)),
    [selectedHost, openConversationId]
  )
  const openAgent = useConversationListStore(selectOpenAgent)
  // #1009: the open conversation's queued backlog, read HERE rather than one level down. #1009's own reason
  // was the scroll pin: the backlog was a REGION between the thread and the composer, so its appearance and
  // growth shrank `.conversation__thread`'s viewport, and the pin's re-assert below is a dep-free layout
  // effect that runs on THIS component's renders. Read one level down (the shape this was until #1009), a
  // `queue_state` push re-rendered that leaf alone, the viewport shrank with no re-assert, and a thread
  // resting at the bottom was left short of it until something unrelated re-rendered this screen — 132px with
  // a two-item backlog, measured on the failing e2e before the fix.
  //
  // #1214 KEPT THE READ AND CHANGED WHAT IT FEEDS. There is no region any more: the backlog folds into the
  // timeline below, so this value is now an INPUT to what the thread draws rather than a sibling of it. Both
  // reasons to read it here still hold — the fold needs it at this level, and a queue_state still re-renders
  // this screen and re-asserts the pin (see useThreadScrollPin's inventory for what that re-assert now covers).
  //
  // The two neighbouring store-bound leaves are documented as deliberately NOT hoisted (ComposerSlot's
  // question batch, ComposerErrorSlotControl's connection status) and this read is not a reversal of either.
  // Both of those arguments are about traffic this screen has no use for — a keystroke in the question panel,
  // a connection-status flap — where waking the timeline buys nothing. A queue snapshot is the opposite on all
  // three axes: it is operator-paced (a message enqueued behind a busy turn, or dropped), the screen NEEDS the
  // render because the fold below is what draws the snapshot at all (and, before #1214, because the event
  // changed the height of a region this screen laid out around a pin it owns), and it
  // is free for every other conversation — selectBacklogFor hands back the same array reference (or the shared
  // EMPTY_BACKLOG) when another conversation's snapshot lands, so `Object.is` short-circuits and nothing here
  // re-renders. The useMemo-stable selector per id is the timeline read's own idiom, for its reason: a fresh
  // closure per render would churn the subscription.
  //
  // `?? ''` and NOT selectOpenTimelineFor's branch-to-a-null-selector treatment, which is the opposite ruling
  // one read above. That branch exists because `''` is an ordinary key in the timeline holder, so the sentinel
  // could render another conversation's thread as this one's. The queue store is written only by queueBridge
  // from a decoded conversation_id, and selectBacklogFor falls back to the shared EMPTY_BACKLOG for a key it
  // does not hold, so the sentinel selects nothing and reads as an empty backlog — which is the correct render
  // with no conversation open. Carried verbatim from the retired control (BackgroundTaskPanel's read too).
  const selectOpenBacklog = useMemo(
    () => selectBacklogFor(openConversationId ?? ''),
    [openConversationId]
  )
  const queuedBacklog = useQueueStore(selectOpenBacklog)
  // A disconnect retains received queues; a local read cannot borrow the id-only queue cache.
  const visibleQueued = selectedHost !== null && (ownSlice === undefined || ownSlice.localRead !== undefined)
    ? EMPTY_QUEUED : queuedBacklog
  // #1213: the two timeline writes the queued-row drop needs, so cancelling a message takes its optimistic
  // echo out of the thread as well as its queued row. They are the SAME pair the Composer writes the echo
  // through (#756) — the flat store for the open thread, the keyed holder for the conversation it was sent
  // to — and both identities are stable, so selecting them here adds no re-render churn (the argument
  // `Composer`'s own reads already make). Read at the container rather than inside the view that draws the
  // row: `Timeline` stays pure props-in/markup-out and store-free, as it has been since #203 (and as the
  // deleted `QueuedBacklog` was until #1214 folded its rows into it).
  const dispatchTimeline = useTimelineStore((s) => s.dispatch)
  const dispatchTimelineFor = useConversationTimelineStore((s) => s.dispatchFor)
  // #177: the Run configuration sheet's open/closed state — a single-value screen-local boolean →
  // useState, never the store (ADR 0006). It resets to closed on remount for free, so the sheet
  // never reopens itself across a screen remount. #962 retired the StatusRow trigger that used to sit
  // between the thread and the composer — the desktop design draws nothing there — so the overflow
  // menu's Run-configuration item flips this now; the sheet still overlays the whole conversation
  // surface as the last child.
  const [sheetOpen, setSheetOpen] = useState(false)
  // #365: the Channel Info sheet's open/closed state — the `sheetOpen` twin, a single-value screen-local
  // boolean → useState, never the store (ADR 0006), resetting to closed on remount for free. The overflow
  // menu's Channel-info item flips it open; the sheet reads the same `activeConversation` slice already
  // held above. Independent of `sheetOpen`: separate triggers, one sheet at a time in normal use.
  const [channelInfoOpen, setChannelInfoOpen] = useState(false)
  // #581: the background-task panel's open/closed state — the `channelInfoOpen` twin, a single-value
  // screen-local boolean → useState, never the store (ADR 0006), resetting to closed on remount for free.
  // #962 retired the clock trigger beside the status row (the design draws no home for it, and #580
  // owns the panel's final one), so the overflow menu's Background-tasks item flips it open now until
  // that drawing lands; the panel reads the roster store itself
  // and needs only the active conversation's id, derived from the `activeConversation` slice already held
  // above (no second subscription). One overlay at a time in normal use.
  // #1634: the drawer no longer takes focus, so it must survive a conversation switch, and a switch remounts
  // this screen. The shell's props win when present; the local state is the bare-screen fallback only.
  const [localPanelOpen, setLocalPanelOpen] = useState(false)
  const panelOpen = backgroundTasksOpen ?? localPanelOpen
  const setPanelOpen = onBackgroundTasksOpenChange ?? setLocalPanelOpen
  // #1627: the markdown reader, screen-local like the three overlays above, so a conversation switch (a
  // remount under PairedShell's key) closes it, drops its notice and ignores any late answer.
  const reader = useMarkdownReader(openConversationId)
  // The render-time clock for the two detail sheets' relative times (#365's "Last activity", #383's
  // "Last used …"). A plain render-local value, not store state (the ChannelList precedent) — safe under
  // renderToStaticMarkup, adds no subscription, and re-derives on each render so the lines stay fresh.
  // It reached Timeline too until #690 removed the session-boundary row's relative time; the sheets kept it.
  const now = Date.now()
  // #601: the follow-the-conversation pin. Screen-local, held beside the other screen-local values above —
  // nothing outside this screen reads it and it must not survive a remount (ADR 0006), so a re-entered
  // thread starts pinned again, which is the correct reading. The two handles go to Timeline as one prop.
  // #602: `followBottom` re-arms that pin and goes to the Composer, the thread's sibling under this body.
  // #1260: the count behind the thread's row keys. A second, narrow subscription rather than a field on
  // the slice above, because it changes only when a served page lands and is `Object.is`-stable on every
  // other write — so it wakes this screen strictly less often than the timeline read already does.
  const selectOpenPrependedRows = useMemo(
    () =>
      openConversationId === null
        ? selectNoPrependedRows
        : selectPrependedRowsFor(openConversationId),
    [openConversationId]
  )
  const prependedRows = useConversationTimelineStore(selectOpenPrependedRows)
  const { scrollPin, followBottom } = useThreadScrollPin(openConversationId, prependedRows)
  // #1579: every open asks for fresh MCP status, from the handler rather than a mount effect so one open
  // is one request. The sheet shows this same `activeConversation`. #1494: the overflow menu's item and the
  // status row's MCP failure notice both call this one closure, so they open the sheet identically.
  const openChannelInfo = (): void => {
    setChannelInfoOpen(true)
    requestMcpStatus(window.pyry.sendCommand, activeConversation?.id ?? null)
    requestRunConfigSnapshot(window.pyry.sendCommand, activeConversation?.id ?? null)
  }
  // #1627: an open reader covers the whole pane, composer included; the sidebar is PairedShell's. The
  // thread and the Composer stay MOUNTED beneath it, hidden, never unmounted: the Composer's pending
  // attachments and its upload listener are mount-local, so an early return here would silently drop them
  // on a same-conversation round trip through the reader. Hiding also keeps the thread's scroll position.
  const readerOpen = reader.state.type !== 'closed'
  return (
    <div className="conversation">
      {reader.state.type !== 'closed' && (
        <MarkdownReaderView
          state={reader.state}
          copied={reader.copied}
          openInAppFailed={reader.openInAppFailed}
          saveFailed={reader.saveFailed}
          onBack={reader.back}
          onRefresh={reader.refresh}
          onCopy={reader.copy}
          onOpenInApp={reader.openInApp}
          onSave={reader.save}
        />
      )}
      <div className="conversation__covered" data-covered={readerOpen ? 'true' : undefined}>
      {/* #276: the trailing overflow menu (Figma 16-16) — the single entry point to per-conversation
          actions. #365 wires its Channel-info item to open the Channel Info sheet (below): the seam is no
          longer a no-op. Gated on onBack presence, the established "mounted in the paired shell" signal —
          established by #140's back affordance, which shared this gate until #1064 deleted it (see the
          note above ThreadOverflowMenu): a bare `<ConversationScreen />` still shows no menu.
          The shared ComposerOptionsMenu owns the interaction state and listener cleanup.
          #962: it now carries all three entry points. The last two setters are VERBATIM what the retired
          StatusRow and BackgroundTaskTrigger did from their own mounts in the region between the thread
          and the composer — the overlays and their open/closed state are untouched, only the affordance
          that flips them moved. This menu is itself mobile-era chrome that a later ticket retires
          together with the sheet, once #683 lands the footer's model and effort controls. */}
      {onBack && (
        <ThreadOverflowMenu
          name={activeConversation?.name ?? UNNAMED_CONVERSATION_LABEL}
          onChannelInfo={openChannelInfo}
          onRunConfiguration={() => setSheetOpen(true)}
          onBackgroundTasks={() => setPanelOpen(true)}
        />
      )}
      {/* #279: the prominent, disconnected-only connection banner — the top of the thread, above the
          message list. A third read of the connection status, distinct from the composer's send gate
          below. #1061 deleted the bare `.conversation__header` row that used to sit between the two,
          so the banner is now the first thing under the overflow menu's gate; nothing else in this
          region moved. */}
      <ConnectionBannerControl />
      {/* #1447: a read that settled on nothing gets no notice. An empty local copy is the ordinary state
          of a chat opened for the first time on this machine, and announcing it in the error-red band
          read as a fault. What survives is a read that has not settled (loading, failed) and an offline
          host whose read DID return rows — the one case where "Offline. Showing saved messages." is a
          true sentence. The disconnection itself is still announced, by the #279 banner above. */}
      {selectedHost !== null && (localStatus !== 'loaded' || (offline && items.length > 0)) &&
        <SavedTimelineNotice status={localStatus} />}
      {/* #1627: a markdown file that could not be opened. One client-owned line, never the path or the
          reason; cleared by the next open, and gone with the screen on a conversation switch. */}
      {reader.state.type === 'closed' && reader.state.notice && (
        <p className="conversation__banner" role="status">{MARKDOWN_OPEN_FAILED_NOTICE}</p>
      )}
      {/* #1214: the backlog goes INTO the thread. `queue_state` is still daemon state held verbatim by
          queueStore and never written through the timeline reducer — the fold is render-time, per
          foldQueuedRows' header — but the two row lists are now joined before they are drawn, so a message
          sent mid-turn draws once. `queuedBacklog` is the same read #1009 hoisted here, unmoved; the drop
          closure below is #1213's, unchanged, only re-hung on this prop.
          window.pyry.sendCommand stays dereferenced INSIDE the click closure (interaction time, never
          render), which is what keeps a container smoke render bridge-free; the null-id guard is
          belt-and-braces, since a populated row implies an active id (the daemon queues under real ids).
          The drop's two clocks — the echo leaves at the click (#1213), the queued item leaves on the
          daemon's next snapshot (#296 AC3) — now land on ONE row, so between them the message is drawn as
          an unmatched tail row for a relay round trip. Accepted, bounded and deliberately undefended: see
          the plan's § Design 8, which names why every alternative reverses a shipped ruling. */}
      {/* #1604: the message area — the thread plus the Top overlay pinned over its top edge. Always
          rendered, so the overlay (Re-pair above all) still shows when an offline host leaves the
          Timeline nothing to draw; the region then stays empty rather than missing. */}
      <div className="conversation__message-area">
      {(!offline || items.length > 0 || visibleQueued.length > 0) && <Timeline
        key={openConversationId}
        items={items}
        scrollPin={scrollPin}
        // #1260: NEGATED, so the first held row's key is minus the number of rows history has already
        // put ahead of it. A prepend of N lowers this by N while every surviving row's index rises by N,
        // which is what leaves their keys — and therefore React's identity for them — unmoved.
        firstRowKey={-prependedRows}
        queued={visibleQueued}
        olderSaved={olderSaved}
        saved={offline || ownSlice?.localRead !== undefined}
        onOpenMarkdownPath={reader.open}
        agent={openAgent}
        onDropQueued={actionsAvailable ? (queuedMsgId, messageId) => {
          if (openConversationId === null || connectedConversationHostNow(openConversationId) === null) return
          dropQueuedMessage(openConversationId, queuedMsgId, messageId, {
            sendCommand: window.pyry.sendCommand,
            dispatch: dispatchTimeline,
            dispatchFor: dispatchTimelineFor
          })
        } : undefined}
      />}
      <TopOverlayControl onRepairHost={onRepairHost} />
      {/* #581: the background-task panel, reading the roster store itself, so only the conversation id goes
          down; with no active conversation the id is null and the panel reads "never observed". It mounts
          no data path — the roster bridge is already app-wide in App.tsx.
          #1634: a non-modal drawer pinned over the right of THIS region (Figma 565:2966 spans exactly the
          message area), the last child so it paints above the Top overlay. `turnRunning` is the stop
          control's own gate, so the drawer yields exactly the Escape the composer will act on. */}
      {panelOpen && (
        <BackgroundTaskPanel
          conversationId={activeConversation?.id ?? null}
          turnRunning={isTurnRunning(phase)}
          agent={openAgent}
          onClose={() => setPanelOpen(false)}
        />
      )}
      </div>
      {/* #962/#967: the region between the thread and the status area is EMPTY, and that emptiness is the
          design (Figma 102:4 stacks the message area straight onto the input area). #493's api-retry,
          #496's compaction and #317's stall each mounted their own null-at-rest bubble block here until
          #967 folded all three into the status row's single label below; the run-config row (#177) and the
          background-task trigger (#581) are retired, their controls now in the input footer
          (#682/#683/#811) and their dots on the sidebar host row (#672/#718); and #1214 folded the queued
          backlog region into the thread above. Their precedence against the working label was never DOM
          adjacency (it lived in workingIndicatorState, which is why #796 could move that label away
          without touching it), so #967's fold moved the three labels and left the rule where it always
          was — widened there from a two-way supersede to the four-way order the one slot forces. */}
      {/* #796: the desktop layout's status area (Figma 111:3525) — a fixed-height row directly above the
          message box, so there is one line telling the operator what is happening and it never moves the
          composer under their cursor. It hosted the working indicator's text and nothing else that slice;
          #967 REOPENED exactly the precedence rule that sentence deferred, and the row's label now carries
          all four thread-status facts — #493's retry, #496's compaction, #317's stall and the working
          label — in the order workingIndicatorState derives. The three loose blocks above are gone.
          The derivations below move VERBATIM off the retired mount — no new subscription, no new store
          read, nothing new across IPC; every one comes from `thread` fields already destructured above,
          which is why folding three surfaces into one costs no store change at all.
          #648: the working label tracks the WHOLE running turn (thinking or responding), so a turn spent
          mostly in tool calls no longer reads as a frozen screen. #493/#496 still supersede it — and
          since #967 they supersede it BY NAME, taking the slot with their own copy instead of blanking it.
          #649: and the label NAMES the open tool, derived from the same `items` array Timeline is mapping
          above (no second subscription). The name is scoped to the working label alone — the three
          superseding states outrank it (#967).
          #650: the window opens the moment the composer accepts the submit rather than a network
          round-trip later, closing the blank window in FRONT of a turn as #648 closed the one behind it.
          The icon's gate was the RAW phase reading through #1517 and is NOT narrowed by the supersede
          rules. Through #963 that made a turning icon beside no text a legal render; #967 closed that
          state as a side effect of the fold, since a running turn now always has a label. The reverse
          still happens by design: a stall or a held retry at `idle` shows its label beside a still icon.
          #1556: the icon's gate is now that same reading WIDENED by the window this mount already opens —
          the label and the mark read one derivation (`indicatorState` above), so the send that opens the
          label turns the mark with it instead of a round trip later. The send button's stop variant keeps
          `isTurnRunning(phase)` alone; only this mount's icon moved.
          `stalled` and a second read of `apiRetry` are #967's only additions to this mount — the record
          gains the field the order needs, and the label takes the retry counter's two integers the way it
          already takes the one daemon tool name.
          #797: the row's right-hand slot, reserved empty by #796, now carries the connection-error chip.
          It arrives as its own store-bound control rather than a status read hoisted into this screen —
          ConversationScreen does not subscribe to sessionStore, and a read here would re-render the whole
          screen, timeline included, on every connection-status change.
          #963: that slot now holds EITHER the chip or an actionable button, so the control filling it owns
          the choice and takes `onUnpaired` down with it — the re-pair flow moved into the slot and #167's
          separate block beneath the composer is gone. */}
      {/* #602: sending is the one act that overrides the conditional pin, so the Composer reports "a
          message entered the timeline" and this screen — which owns the flag — decides that means follow
          the bottom. The Composer learns nothing about scrolling.
          #678: `phase` goes down with it, because the running-turn stop affordance IS the send button now
          (#307's standalone control above the composer is gone). The composer's own send gate is
          orthogonal and unchanged: Enter still sends mid-turn, and the daemon still enqueues it.
          #906: the composer's render site is now its slot, which draws claude's clarifying question in
          the input area's place when one is outstanding for THIS conversation and covers the composer
          whole. The conversation id goes down as a prop off the `activeConversation` slice already read
          above (the BackgroundTaskPanel idiom below); the question store read stays inside the slot, so a
          question arriving never re-renders this screen. */}
      <ComposerSlot
        serverId={selectedHost}
        statusArea={(sendText) => (
          <ComposerStatusArea
            isRunning={isStatusIconTurning(phase, indicatorState)}
            trailing={
              /* #1435: the slot's last reading is the open conversation's background-task count, and the
                 pill opens the SAME overlay the overflow menu's Background-tasks item does. #1634: the pill
                 now TOGGLES it and shows whether it is open; the menu item still only opens. */
              <ComposerErrorSlotControl
                onCommand={sendText}
                backgroundTasksOpen={panelOpen}
                onToggleBackgroundTasks={() => setPanelOpen(!panelOpen)}
                onOpenChannelInfo={openChannelInfo}
              />
            }
          >
            <ThinkingIndicator
              state={indicatorState}
              toolName={openTool?.name ?? null}
              toolElapsedSeconds={openTool?.elapsedSeconds}
              retry={apiRetry}
              resetting={resetting}
              thinkingTokens={thinkingTokens}
              agent={openAgent}
            />
          </ComposerStatusArea>
        )}
        conversationId={activeConversation?.id ?? null}
        phase={phase}
        onMessageSent={followBottom}
      />
      {sheetOpen && (
        <StatusSheet onClose={() => setSheetOpen(false)}>
          {/* #187: the headless data path — requests a snapshot on open and holds Model/Effort/YOLO.
              Renders nothing (DOM order immaterial); #188 renders the held values here. */}
          {actionsAvailable && <RunConfigData />}
          {/* #188: the read-only Model / Effort / YOLO sections, reading the held snapshot.
              #975: the conversation id goes down as a prop off the `activeConversation` slice already
              read above (the ComposerSlot / BackgroundTaskPanel idiom), because the Model rows now come
              from the daemon-published model list, which is keyed by conversation id — not by the
              session id the sheet already had in scope, which keys nothing in that map. */}
          <RunConfigSections conversationId={activeConversation?.id ?? null} />
          {/* Log data is the last section ("beneath Context-window"); #182 prepends the
              Context-window section above it as it lands. */}
          <LogDataSection conversationId={openConversationId} available={actionsAvailable} />
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
          // #1567: scanned only while the sheet is mounted; `items` is the open conversation's thread.
          sessionCostUsd={latestSessionCostUsd(items)}
          onClose={() => setChannelInfoOpen(false)}
        />
      )}
      </div>
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
  onWheel: WheelEventHandler<HTMLDivElement>
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
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
 * The pin's ONE write, shared by the two things that can trigger it: the dep-free layout effect below, and
 * #1049's growth observer beside it.
 *
 * Module-level rather than a closure inside the hook, and deliberately — the observer is constructed once and
 * would otherwise capture its constructing render's closure for the hook's whole life. A function that takes
 * everything it reads carries no such trap for whoever edits here next.
 *
 * BOTH SAFETY PROPERTIES THE DEP-FREE FORM RELIES ON ARE PROPERTIES OF THIS FUNCTION, which is the whole
 * reason #1049 routed its observer through it rather than giving the observer a write of its own. It is
 * IDEMPOTENT: it writes only while following, and assigns scrollTop a value it already holds — a no-op that
 * fires no scroll event — so neither caller can drive a feedback loop, and a StrictMode double-invoke is
 * likewise a no-op. And it is NOT A WRITER OF THE FLAG: `following` is taken read-only, so the hook's
 * contract that only the container's own scroll events and `followBottom` ever set it survives the arrival of
 * a second caller.
 *
 * ⭐ `pinnedOffset` IS WHAT KEEPS THAT SECOND CALLER FROM CORRUPTING THE FLAG, and it is not defensive
 * plumbing — it was MEASURED. A thumbnail settles in more layout steps than one: mounting the <img> applies
 * `.bubble__image-button`'s 12px margin immediately, and the picture's own 160px lands a frame or more later
 * when the bytes decode. Before this record existed, the observer pinned on the 12px step, and the scroll
 * event that write queued dispatched only in the NEXT frame's scroll steps — which run before that frame's
 * resize observations — by which time the row had grown the remaining 160px. `onScroll` then measured a
 * distance of 160 against a reader who had not moved, read it as scrolling away, and cleared the flag one
 * instant before the observation that mattered. Observed as 172px of residual drift with the observer
 * otherwise working (`probeFires` 4 -> 6, `probeFollowing` false).
 *
 * So the write records the offset it produced, and only when the write actually MOVED the offset — a no-op
 * write queues no event and must leave no record behind to swallow the operator's next real scroll. The
 * handler recognises exactly that one echo and declines to re-measure through it. The hook's contract is
 * unchanged in substance: the flag is still written only by the OPERATOR's scrolling, and an event the pin
 * itself caused was never the operator's. Nothing here can go stale for longer than a single event, because
 * the handler clears the record on every scroll, matching or not.
 */
function reassertPinnedToBottom(
  el: HTMLElement,
  following: { readonly current: boolean },
  pinnedOffset: { current: number | null }
): void {
  if (!following.current) return
  el.style.removeProperty('padding-bottom')
  const before = el.scrollTop
  // Past the maximum; the browser clamps to exactly the bottom.
  el.scrollTop = el.scrollHeight
  // Read back rather than recomputing the clamp: the browser owns the rounding, and this is the exact value
  // the queued scroll event will report.
  if (el.scrollTop !== before) pinnedOffset.current = el.scrollTop
}

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
function useThreadScrollPin(conversationId: string | null, prependedRows: number): ThreadPin {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  // #1049's growth observer, and the node its observation set was last synced against. Constructed on first
  // use rather than here, so `ResizeObserver` is never referenced under vitest's `node` environment — where
  // neither hook below runs at all, since renderer tests server-render through renderToStaticMarkup.
  const growth = useRef<ResizeObserver | null>(null)
  const observedRegion = useRef<HTMLElement | null>(null)
  // The offset the pin itself last wrote, while the scroll event that write queued is still outstanding. See
  // `reassertPinnedToBottom` for why this exists and why it cannot go stale.
  const pinnedOffset = useRef<number | null>(null)
  const topAnchor = useRef<{
    row: Element
    top: number
    prependedRows: number
    conversationId: string | null
  } | null>(null)
  const rememberTop = (el: HTMLDivElement): void => {
    const row = el.firstElementChild
    topAnchor.current = el.scrollTop === 0 && row !== null
      ? { row, top: row.getBoundingClientRect().top - el.getBoundingClientRect().top,
          prependedRows, conversationId }
      : null
  }

  // NO dependency array — this runs after every render of the screen, and that is what makes the chrome
  // case work rather than being a missing optimization. Enumerating what changes the region's height in a
  // dependency array would be exactly the fragile coupling to avoid, and it would rot silently the moment the
  // next affordance lands there. "After every render" covers an items change and a chrome change under one
  // rule — but only for chrome that renders WITH this screen, which is a per-surface fact rather than a
  // property of the region. #1009 corrected this paragraph, which used to claim all of it did: the inventory
  // of the strip between the thread and the composer, as this file stands, is
  //
  //   - #1214 REMOVED THIS INVENTORY'S FIRST ENTRY. The queued backlog (.conversation__queued) was chrome in
  //     this strip: a region that mounted and grew between the thread and the composer, SHRINKING the
  //     thread's viewport, which is why #1009 hoisted the queue read into the container so a queue_state
  //     would re-render this screen and re-assert the pin (before that, a bottom-resting thread was left
  //     132px short — measured). The queued rows are now folded INTO the timeline, so their growth is the
  //     thread's own CONTENT growth below the reader: the #1049 observer's case, not this strip's. The
  //     container read stays exactly where #1009 put it and a queue_state still re-renders this screen, so
  //     the re-assert still happens — what changed is the reason, from the region's height to the rows'.
  //   - the status row and its label (ComposerStatusArea / ThinkingIndicator) — SCREEN RENDER, and moot:
  //     every fact it shows is derived from the `thread` slice the container destructures, and since #796 the
  //     row is fixed-height and mounted at all times, so it swaps a label inside an already-present element
  //     and moves no geometry at all.
  //   - the row's trailing slot (ComposerErrorSlotControl) — ITS OWN LEAF ONLY. It reads sessionStore itself,
  //     deliberately (a status read hoisted into the screen would re-render the timeline on every connection
  //     flap), and #963's actionable button grows the row by ~8px. That shrink gets no re-assert.
  //   - the composer slot's question panel (ComposerSlot → QuestionPanelSlot) — ITS OWN LEAF ONLY. It reads
  //     the question-batch store itself, deliberately (so a batch, and every keystroke in the panel, never
  //     wakes the timeline), and the panel takes the slot the covered composer vacates, so its height is not
  //     the composer's. That shrink gets no re-assert either.
  //
  // The last two were a known LATENCY gap, not a broken pin: their shrink fires no scroll event (see below), so
  // the flag stayed correct and the next screen render re-pinned. Neither was measured or under test. Closing
  // either meant the same choice #1009 faced — hoist the read, or observe the container's size directly with a
  // ResizeObserver, which covers every occupant at once. A dependency array was never on that list: no array
  // can reach a leaf that re-renders alone. #1049 BUILT THAT OBSERVER (below) FOR A DIFFERENT CASE, and both
  // fall out of it: each shrinks the flexible middle region, so `.conversation__thread`'s OWN border box
  // changes and the observation fires. Neither has a test of its own and neither was this ticket's
  // deliverable — they are consequences of the mechanism, recorded here so the inventory above stays true.
  //
  // #1046 ADDED A THIRD MEMBER TO THAT CLASS AND FOUND IT ALREADY CLOSED — by the browser, not by this app.
  // A thumbnail (BubbleAttachmentImage) resolves in two events: its own useState flips pending → ready,
  // which re-renders that leaf alone, and then the browser decodes and lays the picture out, growing the
  // row with NO React render anywhere. Hoisting the read cannot close it — the hoisted render would land at
  // the first event, before the image has decoded, and the second is unobserved. What holds the reader's
  // place is Chromium's scroll anchoring, live because .conversation__thread leaves `overflow-anchor` at
  // its default; that is now MEASURED and pinned by thread-scroll-pin.spec.ts's last two tests, which were
  // shown failing with `overflow-anchor: none` present. Two consequences for anyone editing here. Do not
  // add that line to the stylesheet (its rule says the same). And the ResizeObserver #1049 went on to add is
  // NOT a second mechanism over a working one for that case: it meets both terms named there. It does not
  // FIGHT anchoring, because anchoring runs during layout and has already advanced scrollTop by the inserted
  // height by the time resize observations are delivered — so the shared write finds the reader already at
  // the bottom and assigns the value already held. And it keeps the IDEMPOTENCE, because it does not write at
  // all: it calls `reassertPinnedToBottom` above, which is the same guarded write this effect makes.
  //
  // #1049 IS THE ONE CASE ANCHORING IS INDIFFERENT TO — growth BELOW the reader, a thumbnail resolving in
  // their own last row, measured at 172px short with and without `overflow-anchor: none` — AND IT IS WHAT THE
  // OBSERVER BELOW CLOSES. The hinge is this flag rather than a new one: growth re-pins while `following` is
  // set and writes nothing while it is clear, which is one condition on an existing value.
  //
  // WHAT IT OBSERVES IS THE REGION: the container AND each of its direct children. Observing the container
  // alone cannot see this case — it is `flex: 1 1 auto; min-height: 0; overflow-y: auto`, so its border box is
  // fixed by the parent's layout and does not change when content grows inside it; the rows are what grow.
  // Observing the container as WELL is the line that covers the two chrome occupants above, whose shrink is
  // exactly a change to that border box. No content wrapper was introduced to make this one observation
  // instead of many: the flex column, the `gap` and the `padding` all live on the scroll container, so a
  // wrapper would move all three, change the markup run every renderer test asserts against, and interpose an
  // element between the rows and a container several CSS rules describe themselves as stretch items of.
  //
  // THE OBSERVED SET SYNCS HERE because this effect already runs after every render and rows can only appear
  // via a render. `observe()` on an already-observed target with the same box is a no-op, so the loop is
  // O(rows) early returns — and re-observing unconditionally is also what makes the set heal itself after
  // StrictMode's simulated teardown. Rows only ever LEAVE the set with the container: within one container's
  // lifetime the timeline is append-only with tail mutation under index keys, so rows are updated in place,
  // and `.conversation__thread` unmounts outright when the timeline empties (Timeline renders <EmptyThread />
  // at zero items). A change of container identity is therefore the one and only disconnect point.
  //
  // Two properties make the dep-free form safe. It is IDEMPOTENT: it writes only while following, and
  // assigning scrollTop a value it already holds is a no-op that fires no scroll event, so there is no
  // feedback loop (and a StrictMode double-invoke is likewise a no-op). Scrolling resizes nothing, so the
  // observer cannot re-trigger itself either, and when the write does move the offset the scroll event it
  // fires computes at-bottom -> true, which is the value the flag already holds. And chrome CANNOT corrupt the
  // flag: a chrome mount shrinks clientHeight while leaving scrollTop and scrollHeight untouched, which raises
  // the maximum scroll offset, so the browser never clamps scrollTop and no scroll event fires at all.
  useThreadLayoutEffect(() => {
    const el = ref.current
    if (el === null) return

    const anchor = topAnchor.current
    if (!following.current && el.scrollTop === 0 && anchor !== null &&
        anchor.conversationId === conversationId && prependedRows > anchor.prependedRows &&
        anchor.row.parentElement === el) {
      // Chromium suppresses anchoring at zero. Measure the surviving row, not scrollHeight:
      // short threads include unused viewport space that is not part of the inserted content.
      const offset = anchor.row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top
      const padding = Number.parseFloat(getComputedStyle(el).paddingBottom)
      const contentBottom = Array.from(el.children).reduce(
        (bottom, row) => Math.max(bottom, row.getBoundingClientRect().bottom),
        el.getBoundingClientRect().top
      ) - el.getBoundingClientRect().top + padding
      const missingRoom = offset + el.clientHeight - contentBottom
      if (missingRoom > 0) {
        // Retain the short thread's blank space below its rows so the target is reachable.
        // Bottom following removes this measured padding and restores the stylesheet token.
        el.style.paddingBottom = `${padding + Math.ceil(missingRoom)}px`
      }
      el.scrollTop = offset
      if (el.scrollTop !== 0) pinnedOffset.current = el.scrollTop
    }

    const observer = (growth.current ??= new ResizeObserver(() => {
      // Re-read the ref rather than closing over `el`: an observation can be delivered in the same frame as
      // an unmount, and the null path is that case.
      const region = ref.current
      if (region !== null) reassertPinnedToBottom(region, following, pinnedOffset)
    }))
    if (observedRegion.current !== el) {
      observer.disconnect()
      observedRegion.current = el
    }
    observer.observe(el)
    for (const row of el.children) observer.observe(row)

    reassertPinnedToBottom(el, following, pinnedOffset)
    rememberTop(el)
  })

  // The observer's cancellation path, and it needs an effect of its own: the dep-free one above has no
  // dependency array, so ITS cleanup would run after every render and tear down the set it just synced.
  // Mount-scoped, so this cleanup runs exactly at teardown — clearing the recorded node as well, so a
  // StrictMode remount takes the disconnect branch above and rebuilds the set from scratch rather than
  // trusting a stale identity.
  useEffect(() => {
    return () => {
      growth.current?.disconnect()
      observedRegion.current = null
    }
  }, [])

  const demandHistory = (el: HTMLDivElement): void => {
    // Measure before the input scrolls: crossing into the band needs a new input.
    if (connectedConversationHostNow(conversationId) === null) return
    const nearTop = isNearTop({ scrollOffset: el.scrollTop,
      viewportHeight: el.clientHeight, contentHeight: el.scrollHeight })
    if (nearTop) following.current = false
    rememberTop(el)
    requestOlderHistory(historyAskDeps, conversationId, nearTop)
  }

  return {
    scrollPin: {
      onWheel: (event) => {
        if (event.isTrusted && event.deltaY < 0) demandHistory(event.currentTarget)
      },
      onKeyDown: (event) => {
        if (event.isTrusted && event.target === event.currentTarget &&
          ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) demandHistory(event.currentTarget)
      },
      ref,
      // The metric mapping is the one thing this feature can get wrong with no type error and no unit test:
      // scrollTop is the offset, clientHeight the viewport, scrollHeight the total content. Named fields are
      // what make it correct by inspection. Read synchronously off `currentTarget` and assigned with no
      // branch of its own — every case is a consequence of isAtBottom's single comparison. No useCallback:
      // Timeline is not memoized, so a stable identity buys nothing and React attaches this directly.
      onScroll: (event) => {
        const el = event.currentTarget
        rememberTop(el)
        // #1049: the pin's own write queues a scroll event, and that event is not the operator scrolling.
        // Cleared unconditionally so a record can never outlive one event, and matched on the EXACT offset
        // the write produced, so an event the operator caused in the same frame — a different offset —
        // re-measures normally. See `reassertPinnedToBottom` for the drift this was measured to fix.
        //
        // Scroll events update only the local following flag; they never request history.
        const echo = pinnedOffset.current
        pinnedOffset.current = null
        if (echo !== null && el.scrollTop === echo) return
        // Measure the local bottom-following position. The mapping is the one thing
        // this glue can get wrong with no type error and no unit test — scrollTop is the offset,
        // clientHeight the viewport, scrollHeight the total content — so it is written exactly once.
        const metrics = {
          scrollOffset: el.scrollTop,
          viewportHeight: el.clientHeight,
          contentHeight: el.scrollHeight
        }
        following.current = isAtBottom(metrics)
        if (following.current && el.style.paddingBottom !== '') {
          reassertPinnedToBottom(el, following, pinnedOffset)
        }
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
// #601: `scrollPin` carries the container's two DOM handles for the scroll region — the node ref and the
// scroll handler. OPTIONAL so the 30 existing `<Timeline` render sites pass nothing, get `undefined` for
// both attributes (legal no-ops under renderToStaticMarkup) and stay green untouched — the same
// no-edit-cascade reason #286's since-removed `now` prop was optional. Timeline itself stays pure
// props-in / markup-out — it holds no scroll state and reads no layout; both handles are written out
// explicitly below rather than spread, so the both-or-neither wiring is visible in the markup.
// #690 removed `now`: the sessionBoundary row was its only consumer and that row no longer draws a
// relative time, so this subtree is once again a pure function of `items` with no clock in it at all.
//
// #1214: `queued` and `onDropQueued` FOLD THE DAEMON'S BACKLOG INTO THIS LIST. A message sent while claude
// is working used to draw twice — the composer's unconditional optimistic echo here, and a second,
// near-identical row in the `.conversation__queued` region below the thread, which this ticket deletes.
// `foldQueuedRows` joins the two on #1213's `message_id` correlation and yields one row per message; the
// contract, including what an unmatched item does, lives on that function and is not restated here.
//
// BOTH ARE OPTIONAL, for exactly the reason `scrollPin` above already records: a required prop is a
// 72-site edit cascade in ConversationScreen.test.tsx alone, seven times the size table's call-site
// ceiling. Absent `queued` folds against an empty backlog and yields today's rows byte-for-byte, so every
// existing render site stays green untouched. `onDropQueued` is optional on the same terms and is what a
// row's drop control calls; a render that supplies queued rows without it draws them undroppable rather
// than throwing, which is the honest degradation for a view whose container owns the conversation id.
//
// Timeline is still pure props-in / markup-out: the fold is a pure function of the two lists, evaluated
// during render, holding no state between renders. That is what makes a replacement snapshot free (see
// foldQueuedRows) and what keeps this subtree server-renderable with no store and no bridge.
export function SavedTimelineNotice({ status }: {
  status: 'loading' | 'loaded' | 'failed'
}): JSX.Element {
  const text = status === 'failed' ? 'Could not read saved messages on this device.'
    : status === 'loading' ? 'Loading saved messages…'
      : 'Offline. Showing saved messages.'
  return <p className="conversation__banner" role="status">{text}</p>
}

export function Timeline({
  items,
  scrollPin,
  queued,
  onDropQueued,
  firstRowKey = 0,
  olderSaved = false,
  saved = false,
  onOpenMarkdownPath,
  agent
}: {
  items: readonly ThreadItem[]
  scrollPin?: ThreadScrollPin
  queued?: readonly QueuedItem[]
  onDropQueued?: (queuedMsgId: number, messageId: string | undefined) => void
  /** #1260: the key the FIRST item row gets; each row after it counts up from there. Optional and
   *  defaulting to 0, for `scrollPin`'s and `queued`'s reason — the existing render sites pass nothing
   *  and get today's keys byte-for-byte. See the row map below for what a caller passes and why. */
  firstRowKey?: number
  olderSaved?: boolean
  saved?: boolean
  /** #1627: opens the in-app reader for a markdown link in a settled assistant reply. Optional for the
   *  `onDropQueued` reason: absent, such a link keeps its plain-text rendering. */
  onOpenMarkdownPath?: (path: string) => void
  /** #1656: the open conversation's agent, named by the banner and stopped-turn rows. Optional for the
   *  `scrollPin` reason: absent reads Claude, so the existing render sites stay byte-identical. */
  agent?: WireAgent
}): JSX.Element {
  const rows = foldQueuedRows(items, queued ?? EMPTY_QUEUED)
  // #1566: keyed by item index, which is the row index below items.length (foldQueuedRows).
  const turnStats = turnStatsByItemIndex(items)
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<number>>(() => new Set())
  const projection = groupToolRows(rows.map((row) => row.item))
  const hiddenRows = new Set(projection.filter((group) =>
    group.ancestors.some((index) => !expandedTools.has(firstRowKey + index))
  ).map((group) => group.index))
  // Hidden descendants stay mounted; only undrawn boundaries are skipped when joining tool rows.
  const visible = projection.filter((group) => {
    const item = rows[group.index]?.item
    return !hiddenRows.has(group.index) &&
      (item?.kind !== 'turnBoundary' || stoppedTurnText(item) !== null)
  })
  const joins = new Map(visible.map((group, index) => {
    const previous = visible[index - 1]
    const next = visible[index + 1]
    const above = previous?.depth === group.depth ? rows[previous.index]?.item : undefined
    const below = next?.depth === group.depth ? rows[next.index]?.item : undefined
    return [group.index, [
      above?.kind === 'toolCall' && 'tool-group-row--joined-above',
      below?.kind === 'toolCall' && 'tool-group-row--joined-below',
      above?.kind === 'toolCall' && above.denial === undefined && above.result?.isError && 'tool-group-row--error-above',
      below?.kind === 'toolCall' && below.denial === undefined && below.result?.isError && 'tool-group-row--error-below'
    ].filter(Boolean).join(' ')]
  }))
  return (
    <div className="conversation__thread" ref={scrollPin?.ref} onScroll={scrollPin?.onScroll}
      aria-label="Conversation history" tabIndex={0} onWheel={scrollPin?.onWheel} onKeyDown={scrollPin?.onKeyDown}>
      {rows.length === 0 && <EmptyThread />}
      {olderSaved && <p className="conversation__banner">Older messages require a connection.</p>}
      {projection.map((group) => {
        const row = rows[group.index]
        if (!row) return null
        const key = firstRowKey + group.index
        const hidden = hiddenRows.has(group.index)
        if (row.item.kind !== 'toolCall') return (
          <TimelineRow key={group.index < items.length ? key : `q${row.queued?.queuedMsgId ?? group.index}`}
            item={row.item} queued={row.queued} onDropQueued={onDropQueued} turnStats={turnStats.get(group.index)}
            onOpenMarkdownPath={onOpenMarkdownPath} agent={agent}
            inProgress={!saved && group.index === items.length - 1 && row.item.kind === 'assistantText'} />
        )
        const content = (
          <ToolRow
            item={row.item}
            group={group.count > 0 ? {
              count: group.count,
              running: !saved && group.running
            } : undefined}
            expansion={{
              expanded: expandedTools.has(key),
              onToggle: () => setExpandedTools((previous) => {
                const next = new Set(previous)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            }}
          />
        )
        // Origin-relative identity survives history prepends and display regrouping. Keep hidden
        // descendants mounted so their own result expansion survives an outer collapse.
        return (
          <div key={group.index < items.length ? key : `q${row.queued?.queuedMsgId ?? group.index}`}
            className={`tool-group-row tool-group-row--depth-${group.depth} ${joins.get(group.index) ?? ''}`} hidden={hidden}>
            {content}
          </div>
        )
      })}
    </div>
  )
}

// The stable empty backlog for a `<Timeline>` render that passes none — module scope so the fold's input
// identity does not churn per render (the EMPTY_BACKLOG idiom from queueStore).
const EMPTY_QUEUED: readonly QueuedItem[] = []

// #969: the accessible name on the meta row's copy control — a CLIENT-OWNED constant, beside
// DROP_QUEUED_LABEL's precedent below. Never interpolated with the message text: `Copy: ${text}` would
// put relay-peer-authored text into an ATTRIBUTE, which CLAUDE.md's 2026-08-20 ruling forbids outright,
// and "the control has an accessible name" is exactly the requirement that invites it.
const COPY_MESSAGE_LABEL = 'Copy message'

// #969: the meta row at the foot of a text message bubble (Figma `Meta row` 132:4446 assistant /
// 132:4435 user) — a body-small timestamp and the copy control, in --color-inverse-primary. Rendered as
// the bubble's LAST child in both TimelineRow message arms and nowhere else: not on the tool rows
// (which are not bubbles), not on the queued row (nothing sent yet to copy, and no time), and not on
// the unmounted MessageBubble residue, whose exact-markup tests pin the message text as its sole child.
//
// APPENDED, NEVER PREPENDED. interactiveRoundtrip.test.tsx pins the byte string
// `data-thread-role="assistant"><div class="bubble__markdown"><p>`, so the markdown container must stay
// the bubble's opening child; and #691/#686's attachment slots will insert themselves above this row
// simply by being written before it. Last-child is the shape, not a preference.
//
// #1014 fills the timestamp slot from the item's own `createdAt`. The slot still renders EMPTY when the
// item carries no stamp — #1013's contract makes an absent one a LEGAL item, not a defect: it is what
// every producer with no injected clock yields, and the ~39 stamp-free fixtures in ConversationScreen's
// spec are exactly that case. So the read is `createdAt === undefined`, NEVER `'createdAt' in item`,
// which is always true (the reducer assigns the field unconditionally) and would render "undefined".
// `{null}` children emit the same bytes as the self-closing span #969 shipped, so the empty case is
// unchanged rather than re-implemented. An empty inline element generates no line box, which is why
// .bubble__meta carries a min-height rather than taking its 16px from the text — see conversation.css;
// that is also what makes the fill purely additive, with no CSS change and no reflow either way.
//
// NO INJECTED EFFECT, unlike the drop control's `onDropQueued` (Timeline's optional prop, formerly
// QueuedBacklog's required `onDrop`). That injection exists because a queued row cannot see the
// conversation id its send needs; a copy needs the row's own text and nothing else, so the handler is a
// closure over that one value calling the module helper directly. This row therefore added nothing to
// Timeline's prop surface, which is what kept the ~30 existing `<Timeline` render sites untouched — the
// same optionality argument #1214's two props had to make when they DID need to reach the container. The
// promise is explicitly voided — never floating — and copyMessageText handles its own rejection.
//
// #1566: `turnStats` is the formatted turn numbers, passed only to a turn's last assistant bubble. It is
// appended after the copy control as React text only (never an attribute or `title`: the numbers are
// daemon-supplied), and `.bubble__turn-stats` keeps it `display: none` until the row is hovered, so an
// unhovered row draws and measures exactly as before. Absent → byte-identical markup to #1014's.
function BubbleMeta({
  text,
  side,
  createdAt,
  turnStats
}: {
  text: string
  side: 'user' | 'daemon'
  createdAt?: number
  turnStats?: string
}): JSX.Element {
  return (
    <div className={side === 'user' ? 'bubble__meta bubble__meta--user' : 'bubble__meta'}>
      <span className="bubble__meta-time">
        {createdAt === undefined ? null : formatMessageTime(createdAt)}
      </span>
      <button
        type="button"
        className="bubble__copy"
        aria-label={COPY_MESSAGE_LABEL}
        onClick={() => void copyMessageText(text)}
      >
        {/* The Font Awesome `copy-solid-full` export, the family the composer's own glyphs come from.
            Inline SVG with fill: currentColor so it inherits the row's colour (the .queued-row__drop-icon
            idiom), and aria-hidden because the button's label carries the meaning. The drawing's
            clipPath is a full-bleed 11x12 rect — a no-op — and is dropped rather than transcribed. */}
        <svg
          className="bubble__copy-icon"
          viewBox="0 0 11 12"
          width="11"
          height="12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4.71429 0C3.84754 0 3.14286 0.672656 3.14286 1.5V7.5C3.14286 8.32734 3.84754 9 4.71429 9H9.42857C10.2953 9 11 8.32734 11 7.5V2.79844C11 2.39062 10.8257 1.99922 10.5163 1.71562L9.09955 0.417188C8.80737 0.15 8.41696 0 8.01183 0H4.71429ZM1.57143 3C0.704688 3 0 3.67266 0 4.5V10.5C0 11.3273 0.704688 12 1.57143 12H6.28571C7.15246 12 7.85714 11.3273 7.85714 10.5V10.125H6.28571V10.5H1.57143V4.5H1.96429V3H1.57143Z" />
        </svg>
      </button>
      {turnStats !== undefined && <span className="bubble__turn-stats">{turnStats}</span>}
    </div>
  )
}

// #815: the file row a non-image attachment draws inside the message bubble (Figma `File field` 132:4605,
// in the bubble at 121:3860) — the outlined document glyph with its extension overlaid on the lower half,
// and the filename beside it in body-small --color-inverse-primary. #1039 supplied the record it reads.
//
// ONE ROW PER ATTACHMENT, EACH A DIRECT CHILD OF .bubble — no wrapper. That is the shape .bubble dictates
// rather than a shortcut: the bubble is deliberately not a flex column (its own comment gives the reason —
// the in-progress cursor is a sibling of the text and a flex column would drop it onto its own line), so
// the drawing's 12px rhythm is a margin-top on the FOLLOWING sibling, which .bubble__meta already carries.
// Giving each row the same margin makes text → file → file → meta fall out at 12px with no wrapper, no gap
// property, and no second rhythm mechanism to keep in step.
//
// WRITTEN AFTER THE TEXT AND BEFORE <BubbleMeta>, which is AC1 and also the constraint BubbleMeta's own
// header names: interactiveRoundtrip.test.tsx pins the byte string `data-thread-role="assistant"><div
// class="bubble__markdown"><p>`, so nothing may precede the bubble's opening child.
//
// THE USER ARM ONLY, and structurally so. An assistant-produced file cannot reach this window at all —
// `MessagePayload` carries no attachment field and there is no list verb — so `attachments` can only ever
// describe files this client minted itself. The drawing is an assistant bubble because that is the case it
// illustrates; the markup is identical either way, and building the assistant mount would be building for a
// wire change nobody has filed.
//
// THE NAME IS UNTRUSTED DISPLAY TEXT AND THIS IS ITS FIRST DOM SINK — until now the composer renders it
// nowhere on purpose. It reaches the DOM as auto-escaped React CHILDREN only: never an attribute, a title,
// an alt, a URL or dangerouslySetInnerHTML. Two adjacent invitations are declined deliberately. The React
// key is the ARRAY INDEX, not the filename (the list is a frozen record written once at send, so index
// identity is stable — Timeline's own argument — and a name-derived key is the step that makes
// `id={filename}` look natural next). And `attachmentId` is not rendered at all: it is a host-side storage
// handle with no display value, which #816 needs in a click handler rather than in markup.
//
// #816: THE WHOLE ROW IS ONE CONTROL — a real <button>, not a div with a handler, so one tab stop, Enter
// and Space, and screen-reader semantics all come for free rather than being rebuilt (the ChannelList
// row's recorded reason). Neither child takes a tabIndex: the icon and the name are halves of one control,
// which is AC1, and giving either its own would make two.
//
// ⭐ THE ACCESSIBLE NAME IS THE BUTTON'S OWN TEXT CONTENT — deliberately NOT an aria-label. The name is
// computed from the contents, and the extension overlay beside the glyph is already aria-hidden, so the
// button announces exactly the filename, which is what AC1 asks for ("an accessible name that includes the
// file name the row draws"). An aria-label would put this untrusted, model-chosen text into an ATTRIBUTE —
// the sink the paragraph above closes on purpose — and prefixing a client-owned verb instead would need a
// visually-hidden utility this repo does not have (PairingScreen records that adding one is unticketed).
// A content-derived name is the one shape that satisfies the criterion without reopening either question.
//
// The handler is a closure over this row's own record calling the module helper directly, drilling nothing
// — BubbleMeta's copy control established that shape in this same bubble, and Timeline's ~30 render sites
// stay untouched. The conversation id the fetch needs is read outside React from `activeConversationStore`
// inside `attachmentDownloadDeps`, the conversationLastReadBridge idiom, so it is not a prop either.
//
// NOTHING IS SANITISED, TRIMMED OR NORMALISED HERE, and that is deliberate twice over. The timeline store's
// contract forbids a second sanitiser on this side as the divergent-checks shape, and
// `sanitizeAttachmentFilename` already re-runs in main on the value a save actually builds a path from.
// Cleaning the name here would make what the operator SEES differ from what a save WRITES — a worse defect
// than the tidiness it buys.
function BubbleAttachmentRow({ attachment }: { attachment: MessageAttachment }): JSX.Element {
  const conversationId = useActiveConversationStore(s => s.activeConversation?.id ?? null)
  const available = useConversationActionAvailability(conversationId)
  return (
    <button
      type="button"
      className="bubble__file"
      disabled={!available}
      onClick={() => {
        if (connectedConversationHostNow(conversationId) === null) return
        downloadAttachment(attachmentDownloadDeps, attachment)
      }}
    >
      {/* #1262 LIFTED THE DRAWING INTO `AttachmentFileIcon`, which the composer's pending tile now shares.
          The markup this renders is BYTE-IDENTICAL to the transcription that stood here: the component
          takes this row's three class names as props rather than lifting a shared class into their
          attribute runs, precisely because several assertions in ConversationScreen.test.tsx match those
          runs whole and a two-class mix would redden four while a fifth passed vacuously.

          Every decision the transcription recorded moved with it and is documented there: stroke and not
          fill (the export is fill="none" over a stroked path, and the layer's `file-solid-full` name is a
          trap this repo has been caught by), the dropped export artefacts, the inlined path rather than
          Figma's https:// asset URL, and both children aria-hidden so the row's accessible text stays
          exactly the filename. The COLOURS still come from this row's `color` through currentColor — the
          composer's copy resolves its own on its own two classes, which is what lets the two consumers
          differ without either moving. */}
      <AttachmentFileIcon
        filename={attachment.filename}
        frameClassName="bubble__file-icon"
        glyphClassName="bubble__file-glyph"
        labelClassName="bubble__file-ext"
      />
      <span className="bubble__file-name">{attachment.filename}</span>
    </button>
  )
}

// #296: the client-owned accessible name for the drop control (the EMPTY_THREAD_COPY idiom — it named
// #278's WORKSPACE_CHIP_LABEL as its twin until #1486 deleted the workspace row that held it).
// An icon-only button has no visible text, so aria-label supplies its accessible name (the
// .composer__send / .status-sheet__close pattern already in this file). Never a daemon string.
// #1214 moved it up here with the control itself, off the deleted QueuedBacklog.
const DROP_QUEUED_LABEL = 'Drop queued message'

// #296, moved onto the timeline row by #1214: the drop / cancel affordance a queued row carries — an
// icon-only button, a LEADING sibling of the bubble inside the right-aligned .message-row--user, so it
// sits at the row's inner edge. Unchanged markup; only its home moved off the deleted region.
//
// It rides a row ONLY while the daemon's last snapshot reported that message queued, which is what
// `queued !== null` means. Before this ticket "no delivered row can reach this button" was structural
// (only QueuedBacklog rendered it); it is now a condition, so it is asserted directly in the renderer
// spec rather than left to the shape of the file. The compensating structural guard is one level up:
// foldQueuedRows marks `userText` items alone, so no daemon-authored row can acquire this control no
// matter what a `queue_state` claims.
function QueuedRowDrop({
  queued,
  onDropQueued
}: {
  queued: QueuedRowHandle
  onDropQueued?: (queuedMsgId: number, messageId: string | undefined) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="queued-row__drop"
      aria-label={DROP_QUEUED_LABEL}
      disabled={!onDropQueued}
      onClick={() => onDropQueued?.(queued.queuedMsgId, queued.messageId)}
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
  )
}

// One timeline row, discriminated on `kind`. No `default` / `assertNever`: the switch is exhaustive
// over the six kinds (only turnBoundary null), so a future seventh ThreadItem kind makes it
// non-exhaustive → a compile-time "not all code paths return" error that forces a render decision —
// while a structural-only kind (turnBoundary) still degrades to nothing rather than throwing. That
// guard did its job on the unrecognizedMessage row below: the arm arrived as a compile error here.
//
/** Reports remain plain display text; never use them as attributes, commands or log values. */
function stoppedReportText(value: string | undefined): string {
  if (value === undefined || new TextEncoder().encode(value).length > 256) return ''
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
}

export function stoppedTurnText(item: {
  stopReason: string
  outcome?: string
  isError?: boolean
  terminalReason?: string
  errorCategory?: string
}, agent: WireAgent = 'claude'): string | null {
  if (item.stopReason === 'cancelled') return null
  const outcome = stoppedReportText(item.outcome)
  if (item.isError !== true && (outcome === '' || outcome === 'success')) return null
  const terminal = stoppedReportText(item.terminalReason)
  const category = stoppedReportText(item.errorCategory)
  const reason = terminal && terminal !== 'completed' ? terminal
    : outcome === 'error_max_turns' ? 'max_turns' : outcome === 'error_max_budget_usd' ? 'budget_exhausted'
    : category ? 'api_error' : outcome === 'success' ? '' : outcome
  let text: string
  switch (reason) {
    case 'max_turns': text = 'Stopped: turn limit reached'; break
    case 'budget_exhausted': text = 'Stopped: budget exhausted'; break
    case 'prompt_too_long': text = 'Stopped: context too long, compact or reset'; break
    case 'api_error': text = 'Stopped: API error'; break
    case 'hook_stopped': case 'stop_hook_prevented': text = 'Stopped by a hook'; break
    case 'model_error': text = 'Stopped: model error'; break
    default: text = reason ? `Stopped: ${reason}` : 'Stopped: error'
  }
  // #1656: the category is the conversation agent's own report, so the agent's client-owned name credits it.
  return category ? `${text} (${agent === 'codex' ? 'Codex' : 'Claude'} reported: ${category})` : text
}

// #1214: `queued` is the row's not-yet-run state, non-null exactly while the daemon reports this row's
// message queued. Only the `userText` arm reads it — foldQueuedRows can mark no other kind — and the
// whole visual difference is that arm's fork.
function TimelineRow({
  item,
  inProgress,
  queued = null,
  onDropQueued,
  turnStats,
  onOpenMarkdownPath,
  agent
}: {
  item: ThreadItem
  inProgress: boolean
  queued?: QueuedRowHandle | null
  onDropQueued?: (queuedMsgId: number, messageId: string | undefined) => void
  /** #1566: set only on a closed turn's last assistant bubble; read only by the `assistantText` arm. */
  turnStats?: string
  /** #1627: read only by the settled `assistantText` arm; user messages render no markdown. */
  onOpenMarkdownPath?: (path: string) => void
  /** #1656: read by the banner and turnBoundary arms, which name the conversation's agent. */
  agent?: WireAgent
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
                <AssistantMarkdown text={item.text} onOpenMarkdownPath={onOpenMarkdownPath} />
              </div>
            )}
            {/* #969: appended AFTER the fork, so it is the bubble's last child on BOTH branches. The
                in-progress tail gets it too — excluding it would reflow the bubble the moment the turn
                settles, and a partial reply is as copyable as a finished one. #607's pre-wrap reaches
                this subtree on that branch and is inert there: the JSX transform emits no whitespace
                text nodes between elements on separate lines. */}
            <BubbleMeta text={item.text} side="daemon" createdAt={item.createdAt} turnStats={turnStats} />
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
    case 'banner':
      return item.level === 'info' ? null : (
        <p className={item.level === 'warning'
          ? 'session-delimiter__title claude-banner claude-banner--warning'
          : 'session-delimiter__title claude-banner'}>{bannerDisplayText(item, agent)}</p>
      )
    case 'modelRefusal':
      return <ModelRefusalRow refusal={item.refusal} />
    case 'turnBoundary': {
      const text = stoppedTurnText(item, agent)
      return text === null ? null : <p className="session-delimiter__title stopped-turn">{text}</p>
    }
    case 'compactionBoundary':
      return (
        <div className={`session-delimiter compaction-delimiter${item.failed ? ' compaction-delimiter--failed' : ''}`}>
          <div className="session-delimiter__rule" aria-hidden="true" />
          <p className="session-delimiter__title">{compactionBoundaryTitle(item)}</p>
          <div className="session-delimiter__rule" aria-hidden="true" />
        </div>
      )
    case 'sessionBoundary':
      // #286, redrawn #690: the session-boundary delimiter (Figma node 119-3843) — one 16px row, rule /
      // centred label / rule, marking where a /clear, an idle eviction, or a workspace change started a
      // fresh session. The desktop chat screen's inline separator, replacing #286's mobile-derived title
      // stacked above a full-width rule. Its own visually-distinct row: NO data-thread-role (AC4 — not
      // attributed to assistant/user/tool), identified by class (the .conversation__empty /
      // thinking-indicator idiom). `workspaceCwd` reaches the DOM only INSIDE the label string as
      // auto-escaped React children — never dangerouslySetInnerHTML, no path/markup interpretation (the
      // toolCall/userText posture; the events.ts constraint). The two rules are decorative styled divs
      // (aria-hidden), not semantic <hr>s — they are purely visual, and being two IDENTICALLY classed
      // siblings is what makes their equal halves a CSS invariant rather than something to keep in sync.
      // #690 also drops the relative time #286 appended: every message above and below carries its own.
      return (
        <div className="session-delimiter">
          <div className="session-delimiter__rule" aria-hidden="true" />
          <p className="session-delimiter__title">{sessionBoundaryTitle(item)}</p>
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
      //
      // #1214: THE ONE ROW A MESSAGE GETS, delivered or waiting. While the daemon reports it queued the
      // row wears .message-row--queued and data-thread-role="queued" and carries the drop control; when
      // the message runs the treatment simply lifts and the same row, at the same index, becomes an
      // ordinary delivered one. The distinction is an ATTRIBUTE and a CLASS — never position, never text,
      // never which container the row sits in, which is AC1 and the reason the deleted region could not
      // have been kept as a "queued container" instead.
      //
      // THE MODIFIER IS APPENDED, NEVER PREPENDED. ConversationScreen.test.tsx asserts the whole class run
      // `message-row message-row--user` with toContain, which survives a suffix and breaks on a prefix.
      //
      // THE META ROW IS SUPPRESSED WHILE QUEUED, and that is this ticket's ruling on a question #969 left
      // to whoever merged the two rows. #969 draws none on a queued row — "nothing sent yet to copy, and
      // no time" — and that sentence stays true here: a queued message has not been delivered, so a
      // delivered-at timestamp would be a claim the row cannot make. It also makes the two merged forms
      // identical in chrome, which is the point: a MATCHED row is this window's own echo and carries a
      // `createdAt`, while an UNMATCHED one is synthesized from a wire item that has none, so drawing the
      // row either way would ship two things that look different for no reason the operator can see.
      // e2e/user-whitespace.spec.ts depends on this ("a queued bubble carries no meta row, so its box is a
      // different constant height from a delivered bubble's") and needs no edit because of it.
      //
      // ATTACHMENTS STILL DRAW while queued. They are message CONTENT, not chrome: the files are uploaded
      // and the message is queued with them, so drawing what this window knows is honest. An unmatched row
      // draws none because the wire item carries none — a difference in what is known, not in treatment.
      return (
        <div
          className={
            queued ? 'message-row message-row--user message-row--queued' : 'message-row message-row--user'
          }
        >
          {queued && <QueuedRowDrop queued={queued} onDropQueued={onDropQueued} />}
          <div className="bubble bubble--user" data-thread-role={queued ? 'queued' : 'user'}>
            {item.text}
            {/* #815: the attachment rows, written between the text and the meta row — the slot BubbleMeta's
                header reserved. The read is `=== undefined`, never `'attachments' in item`, which is always
                true because the reducer assigns the field unconditionally. `[]` is unreachable from the
                shipped producer (composerSend normalises "nothing pending" to absence at the echo) but is
                representable, and `.map` draws no rows for it — the same bytes as absence, which is the only
                reading consistent with the store's "absent means none". */}
            {/* #1045: an IMAGE draws a picture in place of the row — the same Figma `Slot` (132:4466)
                either way, so this is a branch on what fills the slot rather than a second slot. The
                decision is `isImageAttachmentName`'s and is made over the untrusted filename, because
                nothing tells this window an attachment's type; it decides what is DRAWN and never what is
                fetched or from where, so a name that lies yields a picture that fails to decode rather
                than a different file. Everything around it is unchanged: still direct children of
                .bubble with no wrapper, still keyed by array index, still written between the message
                text and <BubbleMeta>, so a message carrying one of each draws one of each in the order
                the record holds them. */}
            {item.attachments?.map((attachment, attachmentIndex) =>
              isImageAttachmentName(attachment.filename) ? (
                <BubbleAttachmentImage key={attachmentIndex} attachment={attachment} />
              ) : (
                <BubbleAttachmentRow key={attachmentIndex} attachment={attachment} />
              )
            )}
            {/* #969: the same row, right-aligned by its own modifier (the drawing's `justify-end` on
                132:4435). The copy source is the echo the composer wrote — the text as sent.
                #1214 suppresses it while the message is queued — see the arm's header for why. */}
            {!queued && <BubbleMeta text={item.text} side="user" createdAt={item.createdAt} />}
          </div>
        </div>
      )
    case 'unrecognizedMessage':
      // The parser-gap diagnostic — the daemon's stream parser met claude output it has no mapping
      // for. Its own visually-distinct row: NO data-thread-role (not attributed to
      // assistant/user/tool — claude did not say this, the daemon did), identified by class, like
      // .session-delimiter.
      return <UnrecognizedRow item={item} />
    case 'attachmentOffer':
      // #1621: a file the ASSISTANT sent (Figma `File field` 132:4605, in context 102-4), in an
      // assistant-side bubble of its own. It reuses the sent message's two fillings unchanged — the file
      // row or, when `isImageAttachmentName` reads the name as an image, the image slot — so activation
      // is the same `downloadAttachment` closure: the local-original ask answers `unavailable` for an
      // offer, and the path falls back to `requestAttachment` and a save. No BubbleMeta: nothing to copy
      // and no timestamp. The filename reaches the DOM only as escaped text inside those components.
      return (
        <div className="message-row message-row--daemon">
          <div className="bubble bubble--daemon bubble--attachment-offer" data-thread-role="assistant">
            {isImageAttachmentName(item.attachment.filename) ? (
              <BubbleAttachmentImage attachment={item.attachment} />
            ) : (
              <BubbleAttachmentRow attachment={item.attachment} />
            )}
          </div>
        </div>
      )
  }
}

/** Refusal content is bounded, escaped text; model identifiers remain unchanged in the store. */
export function ModelRefusalRow({ refusal, defaultExpanded = false }: {
  refusal: ModelRefusalEvent
  defaultExpanded?: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const model = (value: string): string => value === '' ? 'unknown model' : value.slice(0, 256)
  const title = refusal.type === 'modelRefusalFallback'
    ? `Refused on ${model(refusal.originalModel)}, continued on ${model(refusal.fallbackModel)}`
    : `Refused by ${model(refusal.originalModel)}`
  const label = <span className="session-delimiter__title model-refusal__title">{title}</span>
  return (
    <div className="model-refusal">
      {refusal.banner === '' ? label : (
        <button type="button" className="model-refusal__toggle" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>{label}</button>
      )}
      {expanded && refusal.banner !== '' && (
        <p className="model-refusal__body"><span>Claude: </span>{refusal.banner.slice(0, 8192)}</p>
      )}
    </div>
  )
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
//
// #706 IS that decision, and it changes the CLASSIFICATION of data the item already held: a field NAME
// becomes rendered display text for the first time. A name is exactly as untrusted as the value beside
// it — an MCP tool can name a field anything — so both reach the DOM only as auto-escaped React
// children, the name as a <span>'s and the value as a <pre>'s. Four further sinks the full list makes
// newly tempting are declined, each a MUST FIX if it ever appears:
//   - NO AssistantMarkdown for a value. It is imported into this same file and renders two arms up,
//     which makes routing a `content` or `new_string` field through it sound reasonable. It yields
//     links and images, and an <img src> here is the daemon-chosen beacon described above.
//   - NO title, a third time. The 240px bound clips a long value, and `title={value}` is the natural
//     next edit; the answer to a clipped block is its scroll container, never an attribute.
//   - NO linkified `url` field. The map routinely carries a field literally named `url`, now drawn in
//     full rather than as a headline. An <a href> around it is the same beacon with an extra step.
//   - NO log line for the list. Any useful one ("which fields did we draw?") carries daemon-chosen
//     names and values into a log file, which ADR 0007 and CLAUDE.md both forbid.
//
// #780 promotes a shell call's `command` out of that list and into a code block above it, which adds
// NO newly untrusted string — `command` is already drawn by #705's headline and #706's list, and this
// MOVES one occurrence and REMOVES another, so the set of untrusted strings reaching the DOM is
// unchanged and the number of sinks they reach goes down. It reaches the DOM only as auto-escaped
// React children of a <pre>. Four sinks THIS change makes newly tempting are declined, each a MUST FIX
// if it ever appears:
//   - NO AssistantMarkdown for the command, a second time and now the OBVIOUS reach: the ticket asks
//     for "the same chrome as a fenced code block in a message", and the shortest path to that
//     sentence is `<AssistantMarkdown text={'```\n' + command + '\n```'} />`. It yields the <img src>
//     beacon above, re-interprets backticks in the command as markdown, and lets a crafted command
//     break out of the fence entirely. The chrome is shared through its CSS classes instead.
//   - NO <code> child carrying a `language-*` class, to buy shell highlighting or a header label. AC1
//     forbids the header, and #721's divider hangs on the header precisely so a headerless block draws
//     no doubled edge.
//   - NO title, a fourth time. The block is deliberately unbounded in height (no max-height, unlike
//     .tool-row__result), which makes `title={command}` the natural next edit for anyone who notices.
//     The answer to a long command is that it WRAPS — pre-wrap + break-word on .code-block__body.
//   - NO linkification of a command containing a URL. `curl https://…` is an ordinary shell command
//     and an <a href> around the detected URL is the beacon shape with an extra step.
//
// #854 adds ONE element into that same chip and no untrusted string with it: the vector below is a
// client-owned constant and the two runs are unedited. Three of the clauses above therefore apply to it
// verbatim, each a MUST FIX if it ever appears — NO aria-label, no <title> child and no role="img" on
// the chevron (it is decorative, and an exposed name would perturb the button's own); NO aria-controls /
// id pair, for the reason written at :723-726; and NO title, a fifth time.
//
// #855 adds NO newly untrusted string and opens NO new sink: `command` and `description` already reach
// the DOM today — as the summary run's children via the picker's rule 1, and `command` again as the code
// block's <pre> children — so this MOVES an existing untrusted string between two <span>s that both
// already carry auto-escaped daemon text. Two clauses are inherited verbatim, each a MUST FIX if it ever
// appears: NO title, a SIXTH time — the lead now holds a value that HARD-CUTS at the group boundary,
// which makes `title={command}` the natural next edit for whoever notices, and the answer is that the
// row opens and the body draws the command in full, unwrapped and unbounded, never an attribute; and NO
// linkification of a command and no AssistantMarkdown for either run, since `curl https://…` is an
// ordinary shell command and an <a href> or a markdown render around it is the outbound-beacon shape
// declined at :769-781 for this same string. One clause is genuinely new and is also a MUST FIX: THE
// LEAD IS STILL TEXT CHILDREN OF A <span> AND NEVER BECOMES ANYTHING ELSE. .tool-row__name previously
// only ever carried `item.name`; it now carries a model-authored shell command line, and
// src/shared/wire/types.ts's tool-input contract governs it — these are display strings, not
// capabilities, never resolved, opened, fetched or executed. The routed value is read exactly once, as
// children: never a path, a filename, a cache key, a lookup key or an argument to anything.
//
// #856 ADDS THE FOURTH UNTRUSTED STRING TO THIS CHIP: `result.resultDetail`, the daemon's précis of what
// a call returned. Same class as `resultSummary` and the picked input value, same posture — auto-escaped
// React children of a <span> and nothing else — and it is the FIRST daemon string drawn OUTSIDE
// .tool-row__left, which is what makes its CSS bound load-bearing rather than cosmetic: every other
// untrusted run on this row is bounded by the left group's ellipsis, so an unbounded count would be the
// one that can push the CLIENT'S OWN chevron past the chip's clip edge. conversation.css states that
// bound on .tool-row__count and e2e/tool-row-toggle.spec.ts proves it. Four sinks this string makes newly
// tempting are declined, each a MUST FIX if it ever appears:
//   - NO title, a SEVENTH time, and now with a new pull: the count is the one run that ellipsizes at a
//     cap, which makes `title={resultDetail}` ("hover for the whole thing") the obvious next edit. The
//     answer is the same as it has been six times — the row OPENS and the body says what came back.
//   - NO PARSING IT BACK INTO A NUMBER. "110 of 1676 lines" invites a parseInt, a percentage, a progress
//     bar. It is a précis with unit words and interior spaces (#773 says so, and the daemon's own long
//     tail is empty), so a number derived from it would be a CLIENT-owned claim about a DAEMON-owned
//     value. Nothing reads its length either; the bound is CSS, not arithmetic.
//   - NO aria-label and no data-*. The count joins the button's accessible name for free, as one more
//     text child — which is correct and needs no attribute. Interpolating it into one is #697's shape.
//   - NO log line for the count, for the fourth time: any useful one carries daemon text into a log,
//     which ADR 0007's content-free rule and CLAUDE.md both forbid.
//
// Figma 155:558's chevron, exported verbatim from the design's icon asset (I155:558;134:4925). It points
// RIGHT — the `›` the design draws at the header's trailing edge — and is the right-pointing sibling of
// ComposerActionsMenu's CHEVRON_PATH: same family, same construction, same slight overflow past the
// nominal box, which is why the viewBox reproduces the exporter's own 4x8 rather than being padded to
// contain it. Module-level and NOT exported: no second caller exists. The export's #9DCBFC is this
// scheme's --color-primary exactly (tokens.css:24), so unlike ComposerActionsMenu's there is nothing to
// correct here; it is still dropped for currentColor, per the idiom.
const TOOL_ROW_CHEVRON_PATH =
  'M3.8393 3.58178C4.03385 3.804 4.03385 4.16489 3.8393 4.38711L0.850973 7.80045C0.656421 8.02267 0.340467 8.02267 0.145915 7.80045C-0.048638 7.57822 -0.048638 7.21733 0.145915 6.99511L2.78249 3.98356L0.147471 0.972C-0.0470815 0.749778 -0.0470815 0.388889 0.147471 0.166667C0.342024 -0.0555556 0.657977 -0.0555556 0.85253 0.166667L3.84086 3.58L3.8393 3.58178Z'

// Treat source tokens as an open set, with only client-owned attribution reaching chrome.
function denialAttribution(source: string): string {
  switch (source) {
    case 'classifier':
      return 'Denied by the auto classifier'
    case 'rule':
      return 'Denied by a permission rule'
    case 'mode':
      return 'Denied by the permission mode'
    case 'asyncAgent':
      return 'Denied by an async agent'
    default:
      return 'Denied by the permission gate'
  }
}

// Keep denial prose inert, bounded and free of terminal escapes; tabs/newlines remain text.
function denialDisplayText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .slice(0, 4096)
}

// Presentation only: keep the retained payload intact and leave truncation to the producer.
// #1656: the prefix names the conversation's agent, a client-owned name the agent selects.
function bannerDisplayText(report: { text: string; truncated: boolean }, agent: WireAgent = 'claude'): string {
  const text = report.text
    .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, '')
    .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*(?:[@-~]|$)/g, '')
    .replace(/\x1b[ -/]*[0-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
  return `${agent === 'codex' ? 'Codex' : 'Claude'}: ${text}${report.truncated ? '…' : ''}`
}

export function ComposerBannerReport({ report, agent }: {
  report: { text: string; truncated: boolean }
  agent?: WireAgent
}): JSX.Element {
  return <div className="composer-status__error composer-status__banner" role="status">{bannerDisplayText(report, agent)}</div>
}

export function ToolRow({
  item,
  defaultExpanded = false,
  group,
  expansion
}: {
  item: Extract<ThreadItem, { kind: 'toolCall' }>
  defaultExpanded?: boolean
  group?: { count: number; running: boolean }
  expansion?: { expanded: boolean; onToggle: () => void }
}): JSX.Element {
  const { result, denial } = item
  const elapsed = result === null && denial === undefined ? item.elapsedSeconds : undefined
  const expandable = group !== undefined || result !== null || denial !== undefined
  const [localExpanded, setExpanded] = useState(defaultExpanded)
  const expanded = expansion?.expanded ?? localExpanded
  const rowClass =
    denial !== undefined
      ? 'tool-row tool-row--resolved tool-row--denied'
      : result
        ? `tool-row tool-row--resolved${result.isError ? ' tool-row--error' : ''}`
        : 'tool-row'
  const body = expanded && (result !== null || denial !== undefined)
  const resultText = denial !== undefined
    ? denialDisplayText(result?.resultSummary ?? denial.message)
    : result?.resultSummary ?? ''
  // #780: the shell call's command, or null for every other tool and for a shell call carrying none.
  // A `const` rather than an inline call because it is consumed TWICE below — by the guard and by the
  // child — which is exactly the reason `chipRuns` is one. The field list stays inline for the
  // opposite reason (consumed once), which keeps "a collapsed row never computes the list" structural.
  const command = shellCommandBlock(item)
  // #855: the header's two runs, either of which may be null. A `const` for `command`'s stated reason —
  // it is consumed TWICE below, once per switch — and it is the ONE call for both, so "the two runs
  // agree about which call this is" is structural rather than two calls that could be given different
  // arguments.
  const runs = toolHeadlineRuns(item)
  // The chip's children, declared once: the element forks below, the children never do.
  //
  // #854 SPLITS them into the design's two frames — a Left that fills the header and a Right that hugs
  // its content — which is what pins a trailing element to the header's edge whatever the runs beside
  // it are doing, so a thread of tool rows reads as a column with its edges lined up. <span> and never
  // <div> for both: a resolved chip is a real <button>, which admits phrasing content only, so a <div>
  // in here is invalid HTML and a React DOM-nesting warning. Both are display: flex in CSS — the
  // ELEMENT is chosen for validity, the BOX for layout.
  const chipRuns = (
    <>
      <span className="tool-row__left">
        {/* #855: EITHER RUN CAN BE OFF, which is what makes a thread of shell calls a scannable column
            rather than a wall of near-identical chips. A described shell call draws the description in
            the prose subject and NO LEAD; an undescribed one draws its command in the mono lead and no
            subject; every other call draws both, exactly as it does today. The routing lives in
            toolHeadline.ts, where it is a value in and a value out — this tier renders markup only.

            `!== null`, NEVER a bare `&&` on the string. `runs.subject` can legitimately be `''` — a
            call whose `inputSummary` is empty, which draws the name beside an empty run today and must
            keep doing so — and a truthiness test would silently drop the element for it. Naming the one
            falsy value that means absence is `command !== null`'s argument below, on the same kind of
            value.

            NO EMPTY ELEMENT IN EITHER DIRECTION, and that is the whole reason these are switches rather
            than empty strings: a rendered <span class="tool-row__name"></span> would still take one
            side of the left group's 12px gap and push the subject off the header's hard left. #854's
            "the whole group, not just the chevron" argument, one level down.

            THE CLASSES DO NOT CHANGE and no modifier is added. A command in the lead takes
            .tool-row__name verbatim, which IS the design's mono/14/16/tertiary run for it — the
            type-and-ink claim expressed as the cascade rather than as a second rule. */}
        {runs.lead !== null && <span className="tool-row__name">{runs.lead}</span>}
        {/* #705: the subject is the picked INPUT FIELD (toolHeadline.ts), not `inputSummary` — same
            element, same class, same single-line ellipsizing, different text. `inputSummary` is the
            daemon's whole input compacted, so for an Edit that is mostly replacement text the file path
            was buried in it and usually cut off; it survives as the picker's rule-4 fallback, which is
            what keeps this row working against a pre-pyrycode#1678 daemon. */}
        {runs.subject !== null && <span className="tool-row__summary">{runs.subject}</span>}
      </span>
      {(expandable || elapsed !== undefined) && (
        <span className="tool-row__right">
          {elapsed !== undefined && <span className="tool-row__count">{formatToolElapsed(elapsed)}</span>}
          {denial !== undefined && <span className="tool-row__denied-tag">Denied</span>}
          {/* #856: the daemon's précis of what the call returned — "265 lines", "110 of 1676 lines".
              A <span> and never Figma's <p>: a resolved chip is a real <button>, which admits phrasing
              content only, so flow content in here is invalid HTML and a React DOM-nesting warning.
              #854's ruling for the two group wrappers, one level down — the ELEMENT is chosen for
              validity, the BOX for layout.

              BOTH FALSY VALUES ARE NAMED, and that is the decision this ticket owns rather than a
              verbose Boolean(). Absent means the WIRE omitted it (a daemon predating the field); '' means
              this daemon looked and found no count — the right answer for a failed call and for the long
              tail. Upstream keeps the two distinct on purpose and says so at every stage (the decoder,
              the IPC event, the bridge, the reducer); THIS ROW is where they finally mean the same thing,
              which is draw nothing, and the collapse should be legible at the one place that performs it.

              `!== undefined`, NEVER `'resultDetail' in result`. Structured clone carries the key across
              the IPC bridge whether or not the wire set it, so the `in` form is true for BOTH and would
              silently collapse the distinction #773 paid to keep.

              THIS INVERTS #855's RULE ON THE RUNS BESIDE IT, deliberately. There a bare `&&` would be a
              bug, because '' means "draw the element with no text"; here '' means "there is no count",
              so it must draw nothing. Same file, two opposite conventions, because the two values mean
              opposite things.

              NO GAP FALLS WHERE THIS ISN'T, for free: .tool-row__right's gap lands only BETWEEN two
              children, so not rendering the element IS AC2 — no modifier class, no pending variant.
              #854's "the whole group, not just the chevron" argument one level down again. */}
          {group && (
            <span className="tool-row__count">{group.count} {group.count === 1 ? 'tool' : 'tools'}{group.running ? ' · running' : ''}</span>
          )}
          {!group && result && result.resultDetail !== undefined && result.resultDetail !== '' && (
            <span className="tool-row__count">{result.resultDetail}</span>
          )}
          {/* The .status-row__chevron / .composer__actions-icon idiom: a bare inline <svg> sized by its
              own width/height, fill="currentColor" so it takes the ink from CSS, and aria-hidden so it
              adds no accessible name — the button's name stays exactly its text runs, three of them
              since #856 (the tool name, the headline, and now the count) (WCAG 2.5.3
              label-in-name, ComposerActionsMenu.tsx:81-83's reasoning for the same reason). NOT a
              shared component: three call sites, three different glyphs, and extracting one is a
              refactor this row does not need.

              IT POINTS RIGHT AND IT DOES NOT TURN. Figma draws the collapsed state only (the Body
              frame is hidden in 155:553), so rotating it on open would be design invented here rather
              than implemented — the ruling ComposerActionsMenu.tsx:47-52 already recorded for its own
              chevron. The open state is not going unsaid: aria-expanded carries it and the body
              appearing below is the visible half. If a turning chevron is ever wanted it is a one-rule
              follow-up keyed on the .tool-row--expanded class that already ships, so NO --expanded
              variant class here and no reading of `expanded` to pick a glyph. */}
          {expandable && <svg
            className="tool-row__chevron"
            viewBox="0 0 4 8"
            width="4"
            height="8"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={TOOL_ROW_CHEVRON_PATH} />
          </svg>}
        </span>
      )}
    </>
  )
  return (
    // tool-row--expanded is appended LAST so the collapsed prefix stays byte-stable.
    <div className={body ? `${rowClass} tool-row--expanded` : rowClass}>
      {expandable ? (
        <button
          type="button"
          className="tool-row__chip tool-row__chip--toggle"
          data-thread-role="tool"
          aria-expanded={expanded}
          // Functional updater, never `setExpanded(!expanded)`: the latter reads a captured value and
          // is a check-then-act race against React's batching (UnrecognizedRow:775's form).
          onClick={() => expansion ? expansion.onToggle() : setExpanded((open) => !open)}
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
        // than a lone text node because #706 landed its per-input-field list in here, above the
        // result, and #780 put a shell call's command block at the head of the same column.
        <div className={`tool-row__body${result?.isError && denial === undefined ? ' tool-row__body--error' : ''}`}>
          {/* #780: a shell call's command, as code, leading the body. The SAME two elements and the
              same two classes a message's fenced code block uses (AssistantMarkdown.tsx's `pre`
              override) — the chrome lives entirely in conversation.css keyed on those classes, so a
              later restyle of one lands on both rather than leaving them to drift. No <code> child
              (react-markdown supplies one there; the rule applies --font-mono to both forms) and NO
              header element ever: AC1 forbids a language header and #721's divider hangs on the
              header, so the headerless form draws no doubled edge.

              `command !== null`, never a bare && on the string: the guard names the one falsy value
              the helper can return, so an empty-string command can never render an empty bordered
              box. AssistantMarkdown.tsx's argument for `language !== null`, on the same chrome. */}
          {command !== null && (
            <div className="code-block">
              <pre className="code-block__body">{command}</pre>
            </div>
          )}
          {/* #706: every entry of the map, name and value, in arrival order. Deliberately LITERAL
              where #705's headline is selective — no shortenPath, no salience pick, no re-ordering.

              ONE CARVE-OUT, #780's, and it does not weaken the rule above it. The rule is that this
              list covers the HEADLINE PICK'S MISSES, so a field silently missing from it is worse
              than a repeated one — which is true for every tool whose headline is a GUESS. `Bash` is
              the one tool whose headline is not: toolHeadline's rule 1 matches the name with `===`
              and probes `description` then `command` in fixed order, so there is no miss to cover.
              Its two fields are therefore dropped from the list and drawn ELSEWHERE IN THE SAME BODY
              — `description` on the row's own headline, `command` in the block above — promoted
              rather than missing. Keyed on the TOOL NAME and never on which field the headline
              happened to pick, which is what keeps `BashOutput` and every other tool on the full
              list. Both rules live in toolBody.ts, where they are testable as values.

              NO list-wrapper element and no `.length > 0` guard: an empty array renders literally
              nothing, so "an absent, empty or fully carved-out map draws no field list AND no empty
              container" is structural rather than a second condition that could drift from this one.
              The `??` that collapses absent and `{}` into one expression moved into toolBody.ts with
              the entries call — the distinction stays alive at the item (#643's contract), and the
              DISPLAY decision that both draw nothing still lives in exactly one place.

              Object.entries, never `for...in` and never `input[key]`: own enumerable keys only, in
              insertion order (threadTimeline.ts carries #642's rule — the map is an ordinary-
              prototype object, so `input['toString']` would return an inherited function, and
              `for...in` walks the chain). No .sort(): "never re-sorted" is the absence of a
              transform, not an assertion about it.

              Inline rather than a `const` beside `body`: consumed once, and inlining keeps "a
              collapsed row never computes the list" structural. (`chipRuns` and `command` are consts
              because BOTH their readers consume them; that reason does not apply here.)

              `key={name}` is a React reconciliation identity — it is never serialised to the DOM, so
              it is not the "attribute / filename / cache key / lookup path" the SAFETY block above
              forbids, and the same string is rendered as a text child beside it anyway. Object keys
              are unique by construction, so a collision is impossible. The <pre> is load-bearing
              and not a styled <div>: a div inherits white-space: normal and collapses the daemon's
              newlines onto one line, the defect #607 fixed for assistant text. */}
          {listedInputFields(item).map(([name, value]) => (
            <div className="tool-row__input" key={name}>
              <span className="tool-row__input-name">{name}</span>
              <pre className="tool-row__input-value">{value}</pre>
            </div>
          ))}
          {denial !== undefined && (
            <p className="tool-row__denial">
              {denialAttribution(denial.decisionReasonType)}
              {denial.decisionReason !== '' ? `: ${denialDisplayText(denial.decisionReason)}` : ''}
            </p>
          )}
          {resultText === '' ? (
            // `=== ''` exactly — never `.trim()`, which would relabel whitespace-only output (real
            // output the daemon sent) as absent, and never a falsy check, which would read as if
            // `undefined` were reachable on a `string` field.
            <p className="tool-row__empty">{TOOL_RESULT_EMPTY_COPY}</p>
          ) : (
            // <pre> + white-space: pre (conversation.css), not a <div>: a div inherits
            // white-space: normal and collapses the daemon's newlines onto one line — the defect #607
            // fixed for assistant messages. Tool output is machine output (a listing, a diff, a stack
            // trace, an aligned table) where column position IS the information, so it keeps its exact
            // shape and scrolls — the .unrecognized-row__raw side of the whitespace rule stated on
            // .code-block__body in conversation.css, not the reflowing code-block side.
            <pre className="tool-row__result">{resultText}</pre>
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
 * value out of the rendered text here. Exhaustive by the union, so a future site is a compile
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
    case 'codex_method':
      return 'Codex notification'
    case 'codex_item':
      return 'Codex item'
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
// idiom) plus the client-owned copy carry the state, visually distinct from the icon-less empty state
// the channel list carried until #1070 retired it, and from `.archive__empty`, which kept that shape
// (AC1/AC4). The icon+copy centre in the flexible middle region; #278 pins its
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

// #1494: the status row's notice for a failed MCP server — `toolWorkingCopy`'s shape. Both fixed runs are
// client-owned and apostrophe-free; the one hole holds the server name, untrusted claude text that the
// caller bounds and React escapes. Never pre-escaped here.
export function mcpFailedCopy(name: string): string {
  return `MCP server ${name} failed`
}

// #493: the api-retry copy — a module-level, client-owned constant (the STALL_COPY / 'Thinking…' idiom).
// Conveys BOTH facts AC1 asks for: claude hit an API error, and it is retrying. Apostrophe-free
// (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson) and using the U+2026 ellipsis
// character (matching 'Thinking…' / STALL_COPY). Never a daemon string — the arm carries no string field,
// so the plain-text-never-HTML guarantee holds by construction. Exported so the tests assert against the
// constant rather than a duplicated literal.
//
// #967 MOVED it here, beside its four siblings, when the row's one label slot took over the three loose
// statuses. The VALUE is unchanged. Its old home was directly above ApiRetryIndicator, which is gone.
export const API_RETRY_COPY = 'API error — retrying…'

// #496: the compaction copy — a module-level, client-owned constant (the API_RETRY_COPY / STALL_COPY /
// 'Thinking…' idiom). Names the work AND its object, so a silent screen reads as claude rewriting its own
// context rather than a wedged session (the premise of #496) — and reads as progress, never as an error.
// Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson) and using the
// U+2026 ellipsis character (matching 'Thinking…' / STALL_COPY / API_RETRY_COPY). Never a daemon string —
// the arm carries no string field, so the plain-text-never-HTML guarantee holds by construction. Exported
// so the tests assert against the constant rather than a duplicated literal.
//
// #967 moved it here for the same reason as its retry peer above.
export const COMPACTING_COPY = 'Compacting the conversation…'

// #1517: the reset copy — three module-level, client-owned constants joining the cluster above, plus the
// two handoff suffixes below. Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing
// desktop lesson) and using the U+2026 ellipsis character, matching all five siblings.
//
// THEY NAME THE TWO PHASES THE OPERATOR CAN SEE. A reset is two visible acts — claude writes a handoff
// note, then the daemon restarts it — and the first of them is a REAL TURN, so without this label the row
// reads `Thinking…` across the whole of it. That is the unnamed pause the ticket exists to remove, and it
// is also why the reset takes the TOP of the row's order rather than any lower position.
//
// The wire's two tokens SELECT among these constants and are never interpolated into one. That is the
// difference between this cluster and `toolWorkingCopy` beside it: there the hole holds a daemon string,
// here there is no hole at all, so this slice puts no daemon-supplied string in the DOM. A closed union
// is not a reason to relax that — a narrowed token is still a claim by a peer.
export const RESETTING_COPY = 'Resetting…'
export const RESETTING_WRAPPING_UP_COPY = 'Resetting: writing the handoff note…'
export const RESETTING_RESTARTING_COPY = 'Resetting: restarting claude…'
// #1653: a Codex conversation resets through the same path, so its restarting phase names Codex. The
// conversation's agent SELECTS between the two, exactly as the wire tokens do; it is never interpolated.
export const RESETTING_RESTARTING_CODEX_COPY = 'Resetting: restarting codex…'

// The outcome of the note, appended to the restarting copy as ONE TEXT RUN (see `resettingLabel`). Not
// sentences of their own: the row holds one line, and the phase is the subject both of these modify.
export const HANDOFF_WRITTEN_COPY = 'handoff note written'
export const HANDOFF_SKIPPED_COPY = 'handoff note skipped'

// #317: the stall-indicator copy — a module-level, client-owned constant (the EMPTY_THREAD_COPY /
// 'Thinking…' idiom). Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop
// lesson) and using the U+2026 ellipsis character (matching 'Thinking…'). Never a daemon string — the
// stall frame carries no daemon content, so the plain-text-never-HTML guarantee holds by construction.
//
// #967 moved it here and EXPORTED it. It was the one module-private label of the five, which forced three
// separate test files to assert its literal instead of the constant; grouped and exported, the five labels
// the row's single slot can carry are one reviewable cluster — which is the reason composerSend.ts's own
// chip copy gives for living where it does.
export const STALL_COPY = 'The turn seems to have stalled…'

// #648: which client-owned label the indicator shows. A union rather than a boolean, because a boolean
// cannot carry two labels; deliberately NOT `TurnPhase`, which would hand the view the store type and make
// `'idle'` representable-but-illegal inside the shown branch.
//
// #649: deliberately NOT widened to a member carrying the tool name. Folding the daemon string in here
// would dissolve the client-owned half into the same type as the daemon half, which is exactly the
// distinction that ticket asks to preserve; the name rides a second, separately-named prop instead.
//
// #967 widens it from two members to five, and that is a different act from the one #649 refused: every
// added member is another CLIENT-OWNED literal, so the label CHOICE stays a closed set of this file's own
// constants. The row's one label slot now carries all four thread-status facts, in the order
// `workingIndicatorState` below derives — retry, compacting, stalled, then the working label. The daemon's
// two contributions still ride their own separately-typed props on the view (`toolName`, `retry`).
//
// #1517 widens it to six, by #967's arithmetic rather than a new one: the added member is another
// CLIENT-OWNED literal, so the label choice stays a closed set of this file's own constants. The reset's
// two decoded tokens ride their own separately-typed prop (`resetting`), the third of the daemon's
// contributions to this label and the first whose fields are closed unions rather than free values.
export type WorkingIndicatorState =
  | 'thinking'
  | 'working'
  | 'retrying'
  | 'compacting'
  | 'stalled'
  | 'resetting'

// #967: the label for each of the five states — a total switch with NO default, so a sixth member is a
// `tsc` error here rather than a silently unlabelled row. Every arm returns a client-owned constant; only
// the retry arm interpolates anything, and what it interpolates is two integers (below).
// #1314: the estimate reaches the `'thinking'` arm ALONE. AC2 freezes the other four — a retry, a
// compaction, a stall and the generic working label each keep their own constant verbatim, and none of
// them is about a think whose depth there is a reading of.
// #1517: the sixth arm takes the reset record, the way the retry arm takes the counter. Its own copy
// selection is `resettingLabel` below rather than inline, because it is the one arm with a nested choice.
function statusRowCopy(
  state: WorkingIndicatorState,
  retry: ApiRetryStatus | null,
  thinkingTokens: number | null,
  resetting: ResettingStatus | null,
  agent: WireAgent
): string {
  switch (state) {
    case 'resetting':
      return resettingLabel(resetting, agent)
    case 'retrying':
      return apiRetryLabel(retry)
    case 'compacting':
      return COMPACTING_COPY
    case 'stalled':
      return STALL_COPY
    case 'thinking':
      return thinkingLabel(thinkingTokens)
    case 'working':
      return WORKING_COPY
  }
}

// #1314: the thinking copy with the daemon's running token estimate folded into it — `apiRetryLabel`'s
// sibling directly below, and written to its shape deliberately: the constant, one hole, one client-owned
// unit. ONE TEXT RUN, not constant-plus-span, for the reason stated on `ThinkingIndicator` — the row's
// label ellipsizes as a unit and two runs draw two ellipses on overflow.
//
// The `~` is not decoration. The daemon's own docs call this "approximate progress for spinners/pills, not
// the authoritative billed output_tokens", so the label must never read as a number to bill against.
//
// FORMATTED DEFENSIVELY, which is this arm's stated security obligation and not a style choice. The decode
// (`parseThinkingProgressPayload` → `requireNumber`) proves `typeof value === 'number'` AND NOTHING MORE:
// NaN, ±Infinity, negatives and fractions all decode successfully and structured clone carries every one
// of them across the contextBridge intact. So a value that is not a non-negative finite number is not a
// reading, and the honest render is the bare copy — a DEGRADE on `apiRetryLabel(null)`'s precedent, never
// a throw, since a hostile or buggy daemon must not be able to blank the status row.
//
// NOTHING HERE IS SIZED BY THE READING. No `repeat`, no `Array(n)`, no `padStart`, no loop bounded by it —
// the obligation is never to size an allocation from a daemon-asserted integer, and a right-aligned
// formatter written as `padStart(estimate)` would allocate gigabytes from a claim. Two comparisons, one
// `Math.round` and one interpolation, all O(1). No length cap is needed on top: a JS number stringifies to
// at most ~24 characters, which is `apiRetryLabel`'s own recorded reason for interpolating with no bound.
//
// `Math.round` at both scales rather than a floor or a truncation: below 1000 it is the identity on every
// integer, so a real reading is verbatim (AC3) and only a fractional one is normalised — no digits after
// the point ever reach the DOM. At 1000 and above it rounds to the nearest hundred, so 1250 → 1300 and
// 1249 → 1200. `0` takes the ordinary path and renders as `~0 tokens`: it is a reading, not an absence.
function thinkingLabel(thinkingTokens: number | null): string {
  if (thinkingTokens === null || !Number.isFinite(thinkingTokens) || thinkingTokens < 0) {
    return THINKING_COPY
  }
  const shown =
    thinkingTokens < 1000 ? Math.round(thinkingTokens) : Math.round(thinkingTokens / 100) * 100
  return `${THINKING_COPY} ~${shown} tokens`
}

// #967: the retry label with #493's attempt counter folded into it. The counter shows iff `total > 0`,
// which covers AC3's unknown-count case (`0/0` → omitted entirely, no "0/0" in the markup) and
// additionally suppresses a meaningless denominator on an undocumented `N/0`. Two client-formatted
// integers interpolated as digits — NEVER `current / total`, which is NaN at 0/0. This is one comparison,
// not a validator: the transport type-checks but deliberately does not range-check an inbound wire integer
// (ADR 0002 drift), and inventing a bound here would be unprecedented scope. `{ current: 0, total: 10 }`
// is not the unknown sentinel — it renders as 0/10.
//
// ONE TEXT RUN, not constant-plus-span as #493's bubble rendered it. That is load-bearing rather than
// tidy: the row's label ellipsizes as one unit (see ThinkingIndicator's own comment and
// .composer-status__label--tool), and two runs would render two ellipses on overflow. `.api-retry__counter`
// went with the rest of that bubble's CSS, so the counter carries no distinct weight any more — the
// emphasis it had inside a bubble has no analogue in a one-line row of body-small.
//
// `retry === null` is a DEGRADE, not a defence: the container derives `'retrying'` from `apiRetry !== null`
// and hands this the same record, so it is unreachable from there — but the prop's type admits it and the
// bare copy is the honest answer. Both fields are guaranteed numbers, not daemon strings:
// parseApiRetryPayload narrows them with requireNumber and throws WireDecodeError otherwise, which is what
// bounds this interpolation's length (a JS number stringifies to at most 24 characters).
// #1517: the reset copy chosen by the two decoded tokens — `apiRetryLabel`'s and `thinkingLabel`'s
// sibling, and written to their shape deliberately.
//
// THE TOKENS SELECT, THEY ARE NOT INTERPOLATED, and that is this function's whole security posture (AC4).
// Every returned string is assembled from the constants declared beside `COMPACTING_COPY`; neither
// `phase` nor `handoff` reaches the DOM as a character. The wire narrows both to closed sets, and a
// closed union is precisely the compile-time invitation to read a peer's claim as settled fact — the
// frame's own docblock says so. So a switch that SELECTS is safe where a template that INTERPOLATES
// would be putting a daemon-authored value on screen no matter how small its declared value set is.
//
// TOTAL OVER BOTH SETS, including the pairs the producer never emits. All sixteen (`active`, `phase`,
// `handoff`) combinations decode — the decoder refuses to cross-validate the pair, by name — so the
// unnamed phase and the unresolved handoff are ordinary inputs here, not defended-against ones. Both
// DEGRADE to the nearest honest copy on `apiRetryLabel(null)`'s precedent, never throw and never return
// the empty string: a hostile or merely buggy daemon must not be able to blank the status row.
//
// `resetting === null` is a DEGRADE, not a defence: the container derives `'resetting'` from
// `resetting !== null` and hands this the same record, so it is unreachable from there — but the prop's
// type admits it and the bare copy is the honest answer.
//
// ONE TEXT RUN, not constant-plus-span, for the reason stated on `ThinkingIndicator`: the row's label
// ellipsizes as a unit and two runs draw two ellipses. The handoff outcome is therefore appended into
// the string, exactly as the retry counter is one function down.
function resettingLabel(resetting: ResettingStatus | null, agent: WireAgent): string {
  if (resetting === null) return RESETTING_COPY
  switch (resetting.phase) {
    case 'wrapping_up':
      // The note is being written; whether it lands is not known yet, so `handoff` says `pending` here
      // and the copy deliberately reports no outcome.
      return RESETTING_WRAPPING_UP_COPY
    case 'restarting':
      return `${restartingCopy(agent)}${handoffSuffix(resetting.handoff)}`
    case '':
      // Go's zero value. On the falling edge it never reaches here (the reducer stores `null`); paired
      // with `active: true` it is traffic the daemon does not emit, and the bare copy is what stays
      // true of it — the phase is unnamed, the reset is not.
      return RESETTING_COPY
  }
}

/** #1653: which agent the restarting phase names. Total over `WireAgent`, so a third agent is a `tsc`
 *  error here rather than a reset that silently claims to restart claude. */
function restartingCopy(agent: WireAgent): string {
  switch (agent) {
    case 'claude':
      return RESETTING_RESTARTING_COPY
    case 'codex':
      return RESETTING_RESTARTING_CODEX_COPY
  }
}

/** The restarting label's trailing clause, or nothing while the outcome is still unresolved. Total over
 *  `WireResetHandoff`, so a fifth token is a `tsc` error here rather than a silently dropped outcome. */
function handoffSuffix(handoff: WireResetHandoff): string {
  switch (handoff) {
    case 'written':
      return ` ${HANDOFF_WRITTEN_COPY}`
    case 'skipped':
      return ` ${HANDOFF_SKIPPED_COPY}`
    case 'pending':
    case '':
      // `pending` rides `wrapping_up` upstream, so seeing it here means the daemon moved the phase
      // without settling the note. No suffix is the honest reading — never an invented third outcome.
      return ''
  }
}

function apiRetryLabel(retry: ApiRetryStatus | null): string {
  if (retry === null || retry.total <= 0) return API_RETRY_COPY
  return `${API_RETRY_COPY} attempt ${retry.current}/${retry.total}`
}

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
// one that fails. #967's `retry` prop is required on that same reasoning, and is the second and last of
// the daemon's contributions to this label: two integers and no string field, so the type-level "this prop
// structurally cannot carry a daemon string" guarantee #493's own view had is preserved verbatim.
//
// PRECEDENCE, REVERSED BY #967 for the tool name. Until this ticket the `state === null` guard was what
// enforced #493's and #496's supersede rules, and the tool name then won over the phase-derived copy —
// safe only because a live retry or compaction made `state` null and this function returned before
// reaching the label. Now that all four thread-status facts share one slot, `state === 'retrying'` with a
// tool still open is REACHABLE, and the old order would render the tool name where the row must say
// API_RETRY_COPY. So the name is scoped to the working/thinking state alone (AC1) and the three
// superseding states outrank it. `{ state: 'thinking', toolName: 'Bash' }` stays well-defined rather than
// illegal — it should not arise, since the daemon flips to `responding` on the first tool step, so it is a
// defined edge, not a defended one.
//
// null → null (zero layout footprint, AC3 — exactly like Timeline returning null on an empty list). What
// changes is only where that footprint sits: #796 IS the deferred desktop-design pass this comment used
// to await. The mobile Figma had no indicator node; the desktop one does (111:3525), so all three labels
// have left the daemon-bubble surface and are now the left half of the fixed-height status row above the
// composer (ComposerStatusArea below). The row holds its own height, so this component returning null no
// longer moves the composer — which is what makes the null-at-rest posture safe to keep. The tool branch
// still adds ONE modifier, carrying the one-line bound an unbounded daemon string needs (see
// .composer-status__label--tool in conversation.css, and its rewritten reasoning: the .bubble max-width
// that used to backstop that bound went away with the bubble). Reset copy shares that bound through
// its own modifier: the outcome suffix wraps at minimum window width without it.
//
// `conversation__thinking` is RETAINED on the element deliberately. It styles nothing any more — it is
// the shipped identity hook meaning "the working indicator is showing", and two Electron-launch e2e specs
// use it as their turn-liveness gate (thread-scroll-pin.spec.ts and queued-backlog-interrupt.spec.ts —
// unnumbered on purpose, both move). Renaming it would churn those for no reader benefit. An identity
// class beside a presentation
// class on one element is ordinary BEM, not drift — do not "clean it up".
//
// THE DAEMON TOOL NAME REACHES THE DOM AS A TEXT CHILD AND NOTHING ELSE. No title, no aria-label, no
// data-*, no attribute of any kind carries `label` or `toolName`, and none of it is logged — CLAUDE.md is
// flat that daemon text may be rendered escaped and length-bounded but never "into an attribute or a URL"
// and never into a log. The `text-overflow: ellipsis` below is the specific temptation to add a title
// tooltip; the shipped treatment deliberately had none and neither does this.
//
// The label is a SINGLE text child in EVERY state, never constant-plus-span. That is load-bearing for the
// bound: one text run ellipsizes as one unit, so on overflow the client `…` is truncated away and replaced
// by the ellipsis the truncation itself draws. Splitting the name into its own span would render
// `Running some-long-na…  …` — two ellipses — and buys nothing, since the name needs no distinct type or
// colour here. #967 is what makes this a rule about every state rather than about the tool name: #493's
// retry bubble DID render constant-plus-span (`.api-retry__counter`), and folding it into this one slot is
// exactly why the counter is interpolated into the string instead (see apiRetryLabel above).
//
// The stall takes ONE extra modifier and nothing else (#967). It is the only state that departs from the
// row's --color-primary, because the bubble it had wore the error role (#317 AC4) and it is still the one
// state that reports a problem rather than progress; retry and compaction keep the primary, the only
// colour the design draws. Colour-only is also why no state can move the row (AC4): the modifier changes
// no type, no box and no line-height, so all five labels occupy the same geometry.
export function ThinkingIndicator({
  state,
  toolName,
  retry,
  resetting,
  thinkingTokens,
  toolElapsedSeconds,
  agent = 'claude'
}: {
  state: WorkingIndicatorState | null
  toolName: string | null
  retry: ApiRetryStatus | null
  // #1653: which agent runs the open conversation; it only chooses which name the reset's restarting
  // phase says. Optional where `resetting` is required, because absent MEANS Claude on the wire and in
  // `selectConversationAgentFor` alike, so the default is that contract rather than a guess.
  agent?: WireAgent
  // #1517: REQUIRED, on `toolName`'s and `retry`'s stated reasoning — an optional prop would let the
  // container silently omit it and nothing in this repo could catch that, since every container test
  // renders the idle store. Two closed-set tokens and no free string, so the type-level "this prop
  // structurally cannot carry an arbitrary daemon string" guarantee holds here too.
  resetting: ResettingStatus | null
  thinkingTokens: number | null
  toolElapsedSeconds?: number
}): JSX.Element | null {
  if (state === null) return null
  // The tool name belongs to the working/thinking state alone (#967, AC1). ONE const drives both the label
  // and the modifier below, so "the name is state 4's" lives in one expression rather than in two
  // conditions that have to agree — and it narrows `toolName` in place, so neither a `!` nor a cast is
  // needed to hand it to toolWorkingCopy.
  const toolLabel =
    (state === 'thinking' || state === 'working') && toolName !== null ? toolWorkingCopy(toolName) : null
  // One element, three varying pieces — the toolCall row's `rowClass` idiom above, which likewise varies
  // only a className and keeps a single return. Writing any case as its own early return would duplicate
  // the markup, and a drifted copy is exactly what makes the five labels stop being byte-identical to each
  // other. The modifiers are mutually exclusive: `toolLabel` is null in every superseding state.
  const labelClass = `conversation__thinking composer-status__label${
    toolLabel !== null ? ' composer-status__label--tool' : ''
  }${state === 'stalled' ? ' composer-status__label--stalled' : ''}${
    state === 'resetting' ? ' composer-status__label--resetting' : ''
  }`
  const label = toolLabel !== null
    ? `${toolLabel}${toolElapsedSeconds === undefined ? '' : ` ${formatToolElapsed(toolElapsedSeconds)}`}`
    : statusRowCopy(state, retry, thinkingTokens, resetting, agent)
  return <span className={labelClass}>{label}</span>
}

// #796: the fixed-height status row above the composer (Figma node 111:3525) — the desktop layout's own
// status area, replacing the loose region the working indicator used to float in. It ALWAYS returns an
// element, never null: that is AC2. The height is unconditional, so the composer does not move when the
// label above appears and disappears under it — the deliberate departure from the four indicators'
// null-at-rest posture, and the same reason ComposerSendButton never returns null either.
//
// `isRunning: boolean`, NOT `phase: TurnPhase` — the ComposerSendButton precedent (:1935) for the same
// reason: the view structurally cannot receive the store enum, so `'idle'` is not representable inside
// the turning branch, and no daemon string can reach it. The container does the `isTurnRunning(phase)`
// derivation, reusing the exported predicate rather than re-deriving the phase test.
//
// `children`, not a `label: string` prop — the StatusSheet({ onClose, children }) precedent. It keeps the
// row independent of where its text comes from, which is exactly what #797 needs when it appends the
// error chip to the row's other side. That right-hand slot is EMPTY here and gets no placeholder element:
// the row's own height reserves it, and a spacer would be a defence for a failure nobody has observed.
//
// THE ROW IS SIZED BY ITS OCCUPANT SINCE #963, and the "a second flex child grows nothing" this comment
// used to state is no longer true. The slot's two occupants are different heights — the chip is 24, the
// actionable button is 32 — so `.composer-status` declares a `min-height` rather than a `height` and the
// button is what makes the row 32 when it is there. The row also end-aligns, so the status group stays
// flush with the bottom edge and the label does not move across that transition; see .composer-status's
// own comment for both halves and for why the group had to gain a height of its own.
//
// #797 FILLS that slot, through `trailing` — an added optional prop, so no existing call site or test
// moved. `trailing`, not `error`: the row stays a layout primitive that knows a slot's POSITION and
// nothing about its occupant, the same reason #796 chose `children` over `label: string`. The two slots
// are distinct: `children` is the activity group's, `trailing` is the ROW's, so its occupant renders as
// the group's SIBLING and space-between right-aligns it with no spacer.
//
// `{trailing}` renders BARE, with no .composer-status__trailing wrapper. #797's AC1 is explicit that in
// every non-error arm NOTHING is rendered in that slot, not an empty element — a wrapper would emit an
// empty <div> in all three of them. Rendered bare, a null occupant contributes nothing to the markup,
// which is both what the AC asks for and what makes it assertable in a static render.
//
// The turning modifier is a CLASS, not an inline style. Rotation is a CSS animation, and AC3 requires the
// running-vs-still distinction to be visible in the static markup a renderer spec asserts on — nothing in
// this repo can read a resolved style (CLAUDE.md: renderer specs are static server renders). The
// reduced-motion guard (AC4) rides on the same class in conversation.css and is only observable in the
// Playwright fake tier, where e2e/composer-status-reduced-motion.spec.ts covers it.
//
// The two gates were deliberately INDEPENDENT through #1517: `isRunning` was the raw phase reading, while
// the label above is derived through `workingIndicatorState`'s order. Through #963 that independence made a
// turning icon beside no text a legal, expected render, since a live api-retry or compaction blanked the
// label (#493/#496). #967 CLOSED that state — not by coupling the gates, but as a consequence of the fold:
// the icon turned on `isTurnRunning(phase)`, and whenever that holds the label is non-null (retrying,
// compacting, stalled, or thinking/working), so the icon could no longer turn beside nothing. The paragraph
// stays rather than being deleted because closing that render is a result worth recording.
//
// #1556 COUPLES THEM, in one direction and by exactly one state. The container's gate is now
// `isStatusIconTurning(phase, state)` — `isTurnRunning` widened by `state === 'thinking'` — so #650's
// locally opened window turns the mark the moment the label appears rather than a round trip later. Read
// the predicate's own comment for why that widening adds no daemon-sourced render. What is unchanged here:
// this view still receives a BOOLEAN it cannot re-derive, `isTurnRunning` is still the stop affordance's
// sole gate, and the CONVERSE render is still reachable and still intended — a stall or a held retry at
// `idle` shows its label beside a still icon, exactly the ungated behaviour #967's AC2 preserves and
// #1556's own AC2 re-pins.
export function ComposerStatusArea({
  isRunning,
  children,
  trailing
}: {
  isRunning: boolean
  children?: ReactNode
  trailing?: ReactNode
}): JSX.Element {
  const iconClass = `composer-status__icon${isRunning ? ' composer-status__icon--spinning' : ''}`
  return (
    <div className="composer-status">
      <div className="composer-status__activity">
        {/* The shipped snowflake at the Figma's 14x16 (theme/PyryMark) — the SAME glyph the welcome hero
            draws, verified numerically against this node rather than assumed, so the two read as one
            brand mark. Rendered UNFLIPPED, and note that this diverges from BOTH neighbours rather than
            matching either: Figma's export for this node wraps the vector in -scale-y-100, and
            .welcome__mark applies its own transform: scaleY(-1) (welcome.css:84, itself matching the
            welcome frame and diverging from the mobile app). Carried here that would be a transform on a
            glyph that spends its visible life rotating, where a vertical flip is unobservable — so it
            buys nothing and is left off. Confirmed against the node's own render at 14x16. */}
        <PyryMark className={iconClass} width={14} height={16} />
        {children}
      </div>
      {trailing}
    </div>
  )
}

// #493: the coarse thread-chrome scalars the indicator-precedence rule reads. A record, not a positional
// scalar (the one place this departs from `isTurnRunning`): a record grows by one field where a positional
// signature would break every call site. #496 took exactly that route — one field here, one clause below,
// no parallel rule and no second gate — so a third superseding status extends it the same way.
//
// #967 IS that third status, and it takes the field #650 declined to take. `stalled` is REQUIRED, not
// optional: an optional field is precisely the silent-omission hole `toolName`'s own comment refuses, and
// the type is the only detector this repo has here, since every container test renders the initial store.
// The cascade that costs — every `ThreadStatus` literal in the test file gains one token — is the price of
// having a detector at all, and `tsc` names every site.
//
// #1517 IS THE FOURTH, and it takes the field on #967's own terms: required, one more token in every
// literal, and `tsc` names every site. What is different is where it lands in the order — the TOP, not
// the middle — for the reason the constants above give.
export interface ThreadStatus {
  phase: TurnPhase
  apiRetry: ApiRetryStatus | null
  compacting: boolean
  stalled: boolean
  resetting: ResettingStatus | null
}

// #493: whether the generic thinking indicator shows — thinking, and nothing supersedes it (AC5).
// Retrying against an API error is NOT compatible with "thinking" — claude is not making progress on the
// request, it is re-attempting a failed call, so the retry status replaces the thinking indicator rather
// than sitting beside it. Narrowing the gate (rather than deriving a mutually-exclusive status union in
// the container) keeps both views pure and independently unit-testable — the isTurnRunning precedent of
// extracting the named predicate. Presence supersedes, not the counter: an unknown-count retry
// (`{ current: 0, total: 0 }`) hides thinking exactly like a known one.
//
// #496: the second superseder — a live compaction hides thinking too. Claude is not thinking about the
// user's request while compacting, it is rewriting its own context, so "thinking" would be a false
// reading of a silent screen (the premise of #496).
//
// #967 MADE THE CO-RENDER SENTENCES FALSE, and they are gone rather than qualified. This docblock used to
// say twice that the statuses co-render — that a stall and thinking are compatible facts ("working" and
// "may be stuck") which still show side by side, and that compaction, retry and stall may all co-render
// since they are independent daemon facts. All of that was true while each status owned its own surface.
// The row's label slot holds ONE string, so the four facts now have a precedence instead of a layout, and
// the function that picks between them is `workingIndicatorState` below. What this predicate answers after
// the fold is the narrower question its name always asked: whether the WORKING label is what the slot
// shows. Its two supersede clauses are kept textually untouched, and they are now dominated by that
// function's earlier returns — they stay because they are #493's and #496's standing regression evidence,
// and because this predicate is exported and tested in its own right. It deliberately gains NO `stalled`
// clause: one order lives in one function, and a second copy of the stall rule here is exactly the drift
// #650's comment below exists to prevent.
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
// show/hide decision for the working label and adds only the choice between the two client-owned labels.
// Keeping the gate and the discriminant as one function pair (rather than folding both into a single
// union-returning predicate) leaves #493's and #496's nine supersede assertions standing verbatim as AC4's
// regression evidence. `'idle'` is unreachable in the last branch because the gate already excluded it, so
// there is no further case and no assertNever.
//
// #967: THIS IS THE ONE PLACE THE ROW'S FOUR-WAY ORDER LIVES. The row's label slot holds one string, so
// the four thread-status facts need a precedence rather than four surfaces, and this is it:
//
//   0. resetting  — #1517, and it goes on TOP rather than into the middle. The wrap-up turn is a REAL
//                   turn, so the thread's phase is thinking or responding throughout it; any lower
//                   position would render `Thinking…` across the whole first phase, which is the
//                   unnamed pause that ticket exists to remove. Read before the gate like the three
//                   below it, because the restarting phase has no turn of its own to be gated on.
//   1. retry      — a live rising/falling-edge signal; claude is re-attempting a failed call.
//   2. compacting — the same kind of signal. The two never overlap in practice; retry wins if they do.
//   3. stalled    — a one-shot onset with no clearing frame, cleared only by the next turn activity, so
//                   the two freshest live signals outrank it. It DOES outrank the working label: a stall
//                   and thinking are compatible facts, and while one slot can no longer show both, the
//                   stall is the more useful of the two while it lasts.
//   4. thinking / working — what the design draws, tool-named where a tool is open.
//
// THE FIRST THREE ARE READ BEFORE THE GATE, AND THAT ORDERING IS THE WHOLE POINT (AC2). All three shipped
// views rendered off their own scalar alone, with no phase in their props at all; `shouldShowThinking`
// requires `isTurnRunning`, so folding them in BEHIND it would silently narrow three shipped behaviours to
// the running turn. That is not a judgement call — `thread-scroll-pin.spec.ts` pushes its stall onto a turn
// the primer has already returned to `idle` and asserts the label renders. Only the working label is gated
// on a running turn.
//
// The two supersede clauses inside the gate are now dominated by the first two returns here, and are left
// standing deliberately: see the gate's own docblock above for why. Presence supersedes, not the counter —
// an unknown-count retry (`{ current: 0, total: 0 }`) picks `'retrying'` exactly like a known one, and the
// counter's absence is then apiRetryLabel's business, not this function's.
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null {
  if (status.resetting !== null) return 'resetting'
  if (status.apiRetry !== null) return 'retrying'
  if (status.compacting) return 'compacting'
  if (status.stalled) return 'stalled'
  if (!shouldShowThinking(status)) return null
  return status.phase === 'thinking' ? 'thinking' : 'working'
}

// #650: the locally-opened window — the indicator now opens the moment the composer accepts a submit,
// rather than waiting a network round-trip for the daemon's first `turn_state`. Composed ON the pair above
// rather than added as a fourth `ThreadStatus` field.
//
// THAT PARAGRAPH USED TO ARGUE AGAINST TAKING THE FIELD AT ALL, and #967 took one — so it is rewritten
// here rather than left to contradict the code above it. #650's reasoning was that a fourth field would
// break 19 status literals in the test file as pure retyping with not one expectation changed, and that
// those literals are the standing regression evidence for #493's and #496's supersede rules. Both halves
// were true, and neither carries to a status in the MIDDLE of the order. The difference is the precedence
// position: this window is a LOWER-priority fallback, so it composes on top of a proven gate without
// restating anything. A stall sits below retry and compaction and above the working label, so a wrapper
// would have had to re-read `apiRetry` and `compacting` itself to choose between `'retrying'`,
// `'compacting'` and `'stalled'` — putting the supersede facts in two places, which is the drift this
// comment exists to prevent. So #967 took the field, paid the retype (32 literals by then), and kept one
// record, one function, one order. What survives here unchanged is the shape below: this wrapper still
// adds only its own lower-priority window and still restates nothing.
//
// Three statements, no new branch logic, and the third is the load-bearing one:
//  1. The daemon's answer WINS — a non-null result is returned unchanged, so every daemon-opened case is
//     byte-identical to today, including the label a send issued mid-turn must not relabel.
//  2. No local send pending ⇒ null: today's behaviour verbatim, and AC1's refused-submit case (a submit
//     the composer refuses dispatches no `userText`, so the flag never opens and no code runs at all).
//  3. Otherwise ASK THE SAME GATE what it would say for a turn that has just begun, by re-calling it with
//     one field substituted. Three properties fall out of writing it as a re-call rather than a fresh
//     expression: (a) #493's and #496's supersede facts are INHERITED, not restated, so there is no second
//     place the rule lives and it cannot drift — through #963 that read "a live retry or compaction still
//     returns null because the same two clauses evaluate", and after #967's fold the inheritance is
//     stronger rather than weaker: a live retry or compaction is answered by statement 1 above, since
//     `workingIndicatorState` now returns that status's own LABEL instead of null, so statement 3 never
//     sees one at all; (b) the label is `'thinking'`, which is both honest (the operator has
//     pressed Enter and nothing has been produced — precisely what the daemon's own `thinking` phase means)
//     and FLICKER-FREE, since the daemon's first `turn_state{thinking}` then changes nothing at the seam
//     this ticket exists to smooth, where `'working'` would have flipped Working → Thinking → Working;
//     (c) `workingIndicatorState`'s claim above that `'idle'` is unreachable in its second branch stays
//     literally true, because the synthetic record carries `'thinking'`, never `'idle'`.
//
// The synthetic `phase` NEVER escapes this function: it is not stored, not passed to a view, and not seen
// by `isTurnRunning`. Its one job is gate reuse. That is also why the signal lives in a scalar beside
// `phase` rather than in `phase` itself — the Composer is handed `phase` alone (#678 moved that referent
// from #307's standalone interrupt control to the composer's send button, which now wears the stop
// variant), so a locally opened window structurally cannot arm a stop button for a turn the daemon has not
// started (AC4).
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
  return openToolCall(items)?.name ?? null
}

function openToolCall(items: readonly ThreadItem[]): Extract<ThreadItem, { kind: 'toolCall' }> | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'toolCall' && item.result === null && item.denial === undefined) return item
  }
  return null
}

function formatToolElapsed(seconds: number): string {
  const absolute = Math.abs(seconds)
  const sign = seconds < 0 ? '-' : ''
  return absolute < 60
    ? `${sign}${absolute}s`
    : `${sign}${Math.floor(absolute / 60)}m ${String(absolute % 60).padStart(2, '0')}s`
}

// #307: whether a turn is currently running. This is the one subtle thing in the ticket: the gate is
// BROADER than ThinkingIndicator's (`phase === 'thinking'` only) — a turn is "running" in BOTH `thinking`
// and `responding`, so the stop affordance must be available in either. Extracted as a named, exported
// predicate so AC1 (both running phases show, idle hides) is a deterministic, store-free unit test rather
// than a store-mounted render. Takes the `phase` scalar; the container derives the boolean and passes only
// that to the pure view (no daemon string reaches it).
//
// #678 retargeted its primary consumer: the stop affordance is no longer a standalone control but the
// composer send button's stop VARIANT (ComposerSendButton below), so this is that variant's gate. Three
// further production consumers read it and are untouched: `shouldShowThinking` above, a cross-module
// import in store/conversationActivityBridge.ts, and the tie documented at store/conversationActivityStore.ts.
export function isTurnRunning(phase: TurnPhase): boolean {
  return phase === 'thinking' || phase === 'responding'
}

// #1556: the status ICON's gate, which is no longer `isTurnRunning` itself. #650 opened the label's window
// on the composer's accept, but the mark beside it kept the raw phase reading, so a send from idle drew
// `Thinking…` next to a STILL snowflake until the daemon's first `turn_state` crossed the wire — the one
// round trip this ticket closes. ComposerStatusArea's docblock above calls the two gates "deliberately
// INDEPENDENT"; that is still true of `isTurnRunning`, which stays the stop affordance's sole gate, and
// what changes is only which derivation the icon reads.
//
// It takes the LABEL'S ANSWER, not `localSendPending`. That is the whole design: #650's window is decided
// in exactly one place (`workingIndicatorStateWithLocalSend`), and re-reading the flag here would put the
// rule in two, which is the drift that function's own comment exists to prevent. The icon now follows the
// label rather than paralleling it.
//
// Widening by `'thinking'` alone is narrower than it looks, and that is deliberate:
//  - `'thinking'` off the DAEMON path adds no render at all. `workingIndicatorState` reaches it only past
//    `shouldShowThinking`, which requires `isTurnRunning` — so the first clause already held. The second
//    clause's only new inhabitant is the locally opened window, and every daemon-sourced frame is
//    byte-identical to what shipped.
//  - `'working'` needs no clause either: it is `phase === 'responding'`, which is `isTurnRunning`.
//  - the four superseding states are EXCLUDED on purpose (AC2). A held retry, a compaction, a stall or a
//    reset at `idle` still shows its label beside a still mark — the converse render the row's docblock
//    records as intended. A gate spelled `state !== null` would spin all four and quietly retire it.
//
// The animation stops on its own: any `turn_state`, `idle` included, clears `localSendPending`
// (threadTimeline's turnState arm), so the local window closes with the turn and needs no second rule.
export function isStatusIconTurning(phase: TurnPhase, state: WorkingIndicatorState | null): boolean {
  return isTurnRunning(phase) || state === 'thinking'
}

// #1214 DELETED `QueuedBacklog` AND ITS `.conversation__queued` REGION. #294 drew the backlog as a
// separate dimmed tail below the thread, which meant a message sent mid-turn was drawn twice — once as
// the composer's optimistic echo in the timeline and once here. The rows are now folded into the thread
// (foldQueuedRows → Timeline → TimelineRow's userText arm), so there is one row per message and the
// "waiting" treatment is a modifier on that row rather than a container around a copy of it. Everything
// this view owned survived the move: the queued thread role, the reused right-aligned user bubble, the
// 50% dimming (now .message-row--queued, which is the smallest element containing both the bubble and the
// drop button the region's opacity used to dim as one group) and the drop control itself (QueuedRowDrop,
// above). `DROP_QUEUED_LABEL` moved with the control.

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
// EMPTY_THREAD_COPY idiom). Every literal is apostrophe-free: renderToStaticMarkup
// escapes `'` → `&#x27;` (the standing desktop lesson). None is ever a daemon string — the only daemon
// values the sheet renders (name / cwd / id) are auto-escaped React children, never these labels.
const CHANNEL_INFO_FALLBACK_TITLE = 'Channel info'
const UNNAMED_CONVERSATION_LABEL = 'Unnamed conversation'
const CHANNEL_INFO_ABOUT_HEADER = 'About'
const CHANNEL_INFO_ACTIONS_HEADER = 'Actions'
const CHANNEL_INFO_WORKSPACE_LABEL = 'Workspace'
const CHANNEL_INFO_LAST_ACTIVITY_LABEL = 'Last activity'
const CHANNEL_INFO_EMPTY_COPY = 'No conversation details yet'
// #1567: the one label here with an apostrophe, so the static-markup tests match `&#x27;`.
const CHANNEL_INFO_COST_LABEL = "Cost (Claude's estimate)"
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
// dangerouslySetInnerHTML, never path/markup interpretation (the toolCall / sessionBoundary posture). They
// are already rendered elsewhere in this file, so no new trust boundary.
function memorySearchStatus(report: MemorySearchPayload | undefined): string {
  switch (report?.availability) {
    case 'available': return 'Memory search available'
    case 'unavailable': return 'Memory search unavailable'
    case 'absent': return 'No memory-search provider detected'
    default: return 'Memory search status unknown'
  }
}

function memoryProviderStatus(provider: MemorySearchPayload['providers'][number]): string {
  if (!provider.installed) return 'Not installed'
  if (!provider.enabled) return 'Installed, disabled'
  switch (provider.availability) {
    case 'available': return 'Installed, enabled'
    case 'unavailable': return 'Installed, unavailable'
    case 'absent': return 'Installed, search absent'
    case 'unknown': return 'Installed, status unknown'
  }
}

export function ChannelInfoSheetView({
  conversation,
  now = Date.now(),
  onClose,
  onRename,
  onArchive,
  onDelete,
  deleteConfirmPending,
  onDeleteConfirm,
  onDeleteCancel,
  systemPromptSection,
  mcpServersSection,
  memorySearch,
  sessionFacts = null,
  sessionCostUsd = null,
  agent = 'claude'
}: {
  conversation: ConversationCreatedPayload | null
  /** #1656: the conversation's agent, which the Session section's version row names; absent reads Claude. */
  agent?: WireAgent
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
  // #1078: the System prompt section, injected as a slot — the StatusSheet `children` idiom in narrow
  // form, so this view stays pure (props in, markup out) while the section reads two stores of its own.
  // The container supplies it ONLY in the `conversation !== null` branch, exactly like the three action
  // callbacks above, so the list-opened graceful-empty case grows no editor.
  sessionFacts?: ReturnType<ReturnType<typeof selectSessionFactsFor>>
  // #1567: the latest positive running cost from `latestSessionCostUsd`, or null for no row.
  sessionCostUsd?: number | null
  systemPromptSection?: ReactNode
  // #1490: the MCP servers section, a slot supplied only for a non-null conversation like the one above.
  mcpServersSection?: ReactNode
  memorySearch?: MemorySearchPayload
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
          {/* #1078: the System prompt section — between the About detail and the Actions, per the
              ticket. It brings its own section header, so the slot needs none here. */}
          {conversation !== null && (
            <>
              <p className="status-sheet__section-header">Session</p>
              {[
                // #1656: the label names the agent; the field stays the wire's truncation key.
                { field: 'claude_code_version', label: agent === 'codex' ? 'Codex version' : 'Claude version', value: sessionFacts?.claudeCodeVersion },
                { field: 'permission_mode', label: 'Reported permission mode', value: sessionFacts?.permissionMode }
              ].map(({ field, label, value }) => {
                // Bound code points, keeping surrogate pairs intact; claims never drive controls.
                const characters = Array.from(value ?? '')
                const truncated = characters.length > 256 || sessionFacts?.truncatedFields?.includes(field)
                return (
                  <div className="channel-info__row" key={field}>
                    <span className="channel-info__row-label">{label}</span>
                    <span className="channel-info__row-value channel-info__session-value">
                      <span>{characters.slice(0, 256).join('') || 'Not reported'}</span>
                      {truncated && <span className="channel-info__session-truncated">Truncated</span>}
                    </span>
                  </div>
                )
              })}
              {/* #1567: claude's unverified estimate, so the label attributes it to Claude. */}
              {sessionCostUsd !== null && (
                <div className="channel-info__row">
                  <span className="channel-info__row-label">{CHANNEL_INFO_COST_LABEL}</span>
                  <span className="channel-info__row-value">{formatSessionCost(sessionCostUsd)}</span>
                </div>
              )}
            </>
          )}
          {conversation !== null && (
            <>
              <p className="status-sheet__section-header">Memory search</p>
              <div className="channel-info__row">
                <span className="channel-info__row-label">Status</span>
                <span className="channel-info__row-value">{memorySearchStatus(memorySearch)}</span>
              </div>
              {memorySearch?.providers.map((provider, index) => (
                <div className="channel-info__row" key={index}>
                  <span className="channel-info__row-label channel-info__memory-name">
                    {boundMcpText(provider.display_name)}
                  </span>
                  <span className="channel-info__row-value channel-info__memory-state">
                    {memoryProviderStatus(provider)}
                  </span>
                </div>
              ))}
            </>
          )}
          {mcpServersSection}
          {systemPromptSection}
          <p className="status-sheet__section-header">{CHANNEL_INFO_ACTIONS_HEADER}</p>
          {/* The Actions slot #365 left for #366/#367/#368. Rename (#368) then Archive (#366) then
              Delete (#377), each a `.channel-info__action` tonal pill rendered only when its callback is
              supplied (⇒ there is an active conversation). Destructive-last order: edit (Rename) →
              soft-remove (Archive) → permanent Delete (#377) — the last carrying the `--danger` variant
              and an inline confirm before it dispatches. */}
          <div className="channel-info__actions">
            {onRename && (
              // #1440 — the word moves, the wiring does not. The pill reads **Edit chat** because the
              // dialog it opens is now the Edit chat modal; `onRename` keeps its prop name because it
              // still opens the rename-capable dialog, and the Archive and Delete pills beside it are
              // untouched.
              //
              // #1431 ADDED THE CHANNEL WORD, DERIVED HERE RATHER THAN HANDED IN. `is_promoted` is the
              // wire's only signal for "a saved channel" vs "an ad-hoc discussion" (there is no `kind`
              // enum), and this view already reads `cwd`, `name` and `last_used_at` off the same
              // payload a few lines up — so a `promoted?: boolean` prop would be a second authority on
              // a fact already in scope, and the two could disagree. The optional chain is what keeps
              // the null-conversation branch typed without a `!`; it can only be reached with a
              // conversation anyway, since the pill stays gated on `onRename`, which the container
              // supplies exactly in its `conversation !== null` branch. The container mounts the
              // matching dialog off the SAME expression, so the word and the modal cannot drift.
              <button type="button" className="channel-info__action" onClick={onRename}>
                {conversation?.is_promoted ? 'Edit channel' : 'Edit chat'}
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
  sessionCostUsd,
  onClose
}: {
  conversation: ConversationCreatedPayload | null
  now: number
  sessionCostUsd: number | null
  onClose: () => void
}): JSX.Element {
  // #368: the Rename dialog's per-interaction state — a screen-local copy of the ChannelList shape
  // (transient UI state → useState, not the store; ADR 0006). `renameOpen` gates the dialog; `renameName`
  // is the controlled field, seeded from the conversation's displayed title on open. Both reset for free
  // on the sheet's unmount (it only mounts while open). `window.pyry` is dereferenced only inside the
  // interaction callbacks below, never during render, so the pure view stays server-renderable.
  const available = useConversationActionAvailability(conversation?.id ?? null)
  // #1431: the open chat's owning host, resolved at render time — `useSessionSettingsConnected`'s two
  // lines, with both imports already in this file. `EditChannelDialog` needs the id as a prop (it gates
  // its own daemon subscription on `event.serverId`), and `available` above answers only whether that
  // host is connected, not which one it is. `selectConversations` is a bare field read, so this
  // subscription re-renders the sheet only when the list itself changes — and the sheet is mounted only
  // while it is open.
  const serverId = serverIdForOpenConversation(
    useConversationListStore(selectConversations),
    conversation?.id ?? null
  )
  const sessionFacts = useSessionFactsStore(selectSessionFactsFor(conversation?.id ?? null))
  const agent = useConversationAgent(conversation?.id ?? null)
  // #1655: a session that reports no MCP status (a Codex session) gets no MCP section, rather than one
  // showing its unavailable line forever. The snapshot is the open conversation's, which this sheet is.
  const mcpServers = useRunConfigStore(selectMcpServersSupported)
  const memorySearch = useRunConfigStore(selectSnapshot)?.memorySearch
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
        sessionFacts={sessionFacts}
        sessionCostUsd={sessionCostUsd}
        agent={agent}
        memorySearch={memorySearch}
        now={now}
        onClose={onClose}
        // Supply onRename ONLY for a non-null conversation — a null active conversation yields no button
        // (AC1). Seed the field via titleFor so a null-name conversation prefills with 'Untitled' (AC2).
        onRename={
          conversation === null || !available
            ? undefined
            : () => {
                setRenameName(titleFor(conversation.name))
                setRenameOpen(true)
              }
        }
        // #366: Archive dispatches then closes (no dialog — unlike Rename). Supplied only for a non-null
        // conversation (AC1). `window.pyry` is dereferenced only inside this callback (AC4).
        onArchive={
          conversation === null || !available
            ? undefined
            : () => {
                if (connectedConversationHostNow(conversation.id) === null) return
                requestArchiveConversation(window.pyry.sendCommand, conversation.id)
                onClose()
              }
        }
        // #377: Delete is the two-step destructive action. onDelete only opens the confirm (no wire
        // traffic, AC2); it is supplied only for a non-null conversation (AC1), mirroring onArchive's
        // gating. onDeleteConfirm dispatches then closes — `window.pyry` is dereferenced ONLY here (AC5).
        // onDeleteCancel dismisses with no wire effect (AC3).
        onDelete={conversation === null || !available ? undefined : () => setDeleteConfirmOpen(true)}
        deleteConfirmPending={deleteConfirmOpen}
        onDeleteConfirm={
          conversation === null || !available
            ? undefined
            : () => {
                if (connectedConversationHostNow(conversation.id) === null) return
                requestDeleteConversation(window.pyry.sendCommand, conversation.id)
                onClose()
              }
        }
        onDeleteCancel={() => setDeleteConfirmOpen(false)}
        // #1078: the System prompt section, gated on a non-null conversation like the three actions
        // above — so `conversationId` below is a plain required string with no empty-string fallback.
        systemPromptSection={
          conversation === null ? undefined : (
            <SystemPromptSection conversationId={conversation.id} />
          )
        }
        mcpServersSection={
          conversation === null || !mcpServers ? undefined : (
            <McpServersSection conversationId={conversation.id} />
          )
        }
      />
      {/* #1431: the channel arm of the one pill. Split on the SAME `is_promoted` the label above reads,
          so the word and the modal cannot disagree, and mounting #1476/#1477's container rather than a
          view because the system prompt field it draws owns a daemon subscription whose lifetime must be
          the dialog's open lifetime.

          THE HOST CONDITION IS THIS ARM'S ALONE and deliberately unlike its chat twin's. That dialog
          carries an `available` prop and goes dead in place on a disconnect; this one has no such prop
          by design (its header explains why: one button, no gap between two disabled expressions), and
          `edit-channel-dialog.md` records the contract that replaces it — "the dialog closes if the
          row's host stops being connected", the render gate re-evaluating on every status change, plus
          the live re-check the save takes below. `available` is this sheet's spelling of that gate; the
          `serverId !== null` beside it is what narrows the prop to `string` without a `!` or an `as`.
          Both are already true when the pill is clickable, since `onRename` is withheld unless
          `available` — so the pair only ever fires as a CLOSE, never as a refusal to open. */}
      {renameOpen && conversation !== null && conversation.is_promoted && serverId !== null &&
        available && (
        <EditChannelDialog
          conversationId={conversation.id}
          serverId={serverId}
          name={renameName}
          onNameChange={setRenameName}
          // Cancel and the header close are one callback and send nothing; the draft dies with the
          // cell, so a reopen re-seeds from the conversation's stored title. The SHEET stays standing —
          // this closes the dialog alone, exactly as the chat arm's Cancel does.
          onCancel={() => setRenameOpen(false)}
          // `ChannelList`'s body restated in `ChannelList`'s order — the live host re-check first, then
          // the container's prompt write (unreachable except from inside this guard, which is why it
          // arrives as a parameter), then the rename, then the dismissal.
          //
          // ONE DELIBERATE DIVERGENCE: no unchanged-name no-send. The sheet has always sent its rename
          // unconditionally — `requestRenameConversation`'s own header names `ConversationScreen` as one
          // of the callers that do — and adding the comparison to this arm alone would make one pill
          // mean two different things depending on which kind of conversation is open. The prompt write
          // still takes its own decision and sends nothing when the box has not moved off what the
          // daemon said.
          onSave={(writePrompt) => {
            if (connectedConversationHostNow(conversation.id) === null) return
            writePrompt()
            requestRenameConversation(window.pyry.sendCommand, conversation, renameName)
            setRenameOpen(false)
          }}
          // #1438 gave this dialog its own put-away button, and a REQUIRED prop — so this sheet is a
          // caller of it by compile error rather than by choice, which is exactly the point: one modal
          // must not grow a button on one of its two mount sites and not the other. The estimate on that
          // ticket forecast no change here; it had not traced that #1431 made this the container's
          // second mount site.
          //
          // The chat arm's sequence below, restated verbatim for the channel: re-check the host at
          // interaction time, send ONE command, close the dialog AND the sheet — a sheet left standing
          // describes a row on its way out. No rename and no prompt write go out whatever the fields
          // hold, nothing is stored and nothing navigates here; `useArchivedActiveConversationExit`
          // leaves the thread on the daemon's word. The guard is deliberately THIS surface's
          // (`connectedConversationHostNow`, which acts on the open conversation) and not the sidebar's
          // `canMutateHost` — the two are not interchangeable and neither is imported across.
          onArchive={() => {
            if (connectedConversationHostNow(conversation.id) === null) return
            requestArchiveConversation(window.pyry.sendCommand, conversation.id)
            setRenameOpen(false)
            onClose()
          }}
        />
      )}
      {/* The chat arm, #1440's verbatim — including the `available` prop that its two buttons' differing
          disabled expressions need and `EditChannelDialog` deliberately still has no equivalent for
          (#1438 answered that forecast "no": its own button carries no disabled arm at all). */}
      {renameOpen && conversation !== null && !conversation.is_promoted && (
        <EditChatDialogView
          name={renameName}
          available={available}
          onNameChange={setRenameName}
          onCancel={() => setRenameOpen(false)}
          onSave={() => {
            if (connectedConversationHostNow(conversation.id) === null) return
            requestRenameConversation(window.pyry.sendCommand, conversation, renameName)
            setRenameOpen(false)
          }}
          // #1440 — the archive arm, the sheet's own `onArchive` sequence verbatim one level down:
          // re-check the host at interaction time, send ONE command, then close. It closes the DIALOG
          // AND the sheet, which is what that pill already does — leaving the sheet standing over an
          // archived chat would be a surface describing a row that is on its way out. No rename is sent
          // whatever the field holds, nothing is written to a store and nothing navigates here: the
          // existing `useArchivedActiveConversationExit` bridge leaves the thread on the daemon's word.
          onArchive={() => {
            if (connectedConversationHostNow(conversation.id) === null) return
            requestArchiveConversation(window.pyry.sendCommand, conversation.id)
            setRenameOpen(false)
            onClose()
          }}
        />
      )}
    </>
  )
}

// The two client-owned accessible names the composer's one control wears, kept side by side because BOTH
// ARE LOAD-BEARING e2e LOCATORS AND NEITHER MAY EVER BE REWORDED. `Send` is a getByRole locator at ~15
// sites under e2e/ and the CONVERSATION_MARKER literal in App.test.tsx / PairedShell.test.tsx;
// `Stop the running turn` is #307's INTERRUPT_LABEL verbatim, a getByRole locator in
// queued-backlog-interrupt.spec.ts, real-claude-interrupt.spec.ts and real-claude-queue-drop.spec.ts (the
// last two are real-claude tier, which SKIPS SILENTLY AND EXITS 0 without a credential — `npm run e2e`
// cannot catch a break in them; use `npm run e2e:real:gate` and read the skip reasons). Icon-only buttons
// carry no visible text, so aria-label supplies the accessible name (the .status-sheet__close pattern in
// this file). Never daemon strings.
const SEND_LABEL = 'Send'
const INTERRUPT_LABEL = 'Stop the running turn'

// #678: the composer's send control — ONE component with TWO VARIANTS, named for the .composer__send class
// it owns (this file's component↔class habit) even though it also renders a stop. A running turn turns it
// into the stop affordance, so interrupting is where the operator's hand already is; #307's standalone
// InterruptButton / InterruptControl above the composer are deleted, not stacked on top of this.
//
// Pure props-in/markup-out and exported so tests server-render it with injected values, no store. Three
// properties are load-bearing, each pinned by a named test:
//
//  1. It NEVER returns null — the deliberate departure from InterruptButton's null-on-false posture. The
//     composer row holds exactly one button in every state, which is what makes AC1's "exactly one stop
//     affordance renders" structural rather than a convention: a second one cannot be stacked above it.
//  2. `isRunning` and `canSend` are SEPARATE booleans and only `canSend` gates. The stop variant is never
//     disabled — #307's behaviour verbatim. A turn can be running while the session is disconnected, and
//     disabling stop there would hide the only interrupt affordance at exactly the moment an operator most
//     wants to try it (sendInterrupt already swallows a bridge failure). Do NOT collapse the two gates.
//  3. It takes `isRunning: boolean`, NOT `phase: TurnPhase` — the ThinkingIndicator type-level guarantee:
//     the view structurally cannot render a daemon-supplied string because it never receives one; the
//     container does the `isTurnRunning(phase)` derivation.
//
// Both callbacks are REQUIRED injected effects (the "a view that cannot answer is a bug" rule) — the
// container binds them; the view never touches window.pyry. Keyboard activation is free: a native <button>
// fires onClick on Enter/Space. The stop variant is not disabled after a click and holds no "already
// interrupted" state — a second click is harmless (the daemon owes no reply) and a disable-after-click flag
// would be new client state (AC2 forbids it); it simply stays until `phase` leaves the running set.
//
// Both variants share the .composer__send chrome with no modifier class — the 48px control whose
// :hover:not(:disabled) already behaves for a never-disabled button and whose :disabled never matches the
// stop variant. The variants are distinguished in markup by aria-label and glyph, which is exactly the
// seam the e2e locators already use.
//
// #951 CLOSED THE FOLLOW-UP #678 NAMED HERE. Both glyphs are now the same export family at the same
// 28×28: the stop is Figma 114:3552's `circle-stop-solid-full` and the send is 347:6440's
// `circle-chevron-up-solid-full`, each a disc with its shape knocked out by the nonzero fill rule — the
// two subpaths of each wind opposite ways, so do not "tidy" either one's direction. The 28-unit viewBox
// departs from this file's 24-unit habit deliberately: viewBox is only a coordinate space, the rendered
// size comes from width/height, and rescaling an exported path by hand is transcription risk for no gain.
//
// NEITHER PATH CARRIES A FILL OF ITS OWN. Both exports ship the resolved #9DCBFC; that is --color-primary's
// value, and inlining it would hardcode the export's fallback hex — the rule stated over and over in
// conversation.css. `fill="currentColor"` takes the colour from .composer__send instead, which is also
// what makes the :disabled rule's muted content reach the glyph unchanged.
export function ComposerSendButton({
  isRunning,
  canSend,
  onSend,
  onInterrupt
}: {
  isRunning: boolean
  canSend: boolean
  onSend: () => void
  onInterrupt: () => void
}): JSX.Element {
  if (isRunning) {
    return (
      <button
        type="button"
        className="composer__send"
        aria-label={INTERRUPT_LABEL}
        disabled={!canSend}
        onClick={onInterrupt}
        // #1072: the SECOND Escape binding, and it is not optional. Chromium focuses a <button> on click
        // and nothing in the composer moves focus back (`handleSubmit` only clears the text), so after a
        // mouse send the operator's focus is on this control — and this control is what the send button
        // BECOMES: both variants render a <button> at the same position in the same parent, so React
        // patches the node in place rather than remounting and the focus survives the flip. Without a
        // handler here Escape does nothing in exactly the state the operator most often reaches, and the
        // message box's own handler never sees the keystroke.
        //
        // The predicate's `turnRunning` argument is `true` BY CONSTRUCTION rather than by a prop read: this
        // element only exists inside the `isRunning` branch. It is still asked, so that both bindings
        // consult one decision and a change to the key or to the composing rule lands on both at once.
        //
        // No new prop and no window.pyry: the container-injected `onInterrupt` is already the effect, and
        // this view still never touches the bridge (the "a view that cannot answer is a bug" rule).
        // An event handler renders no attribute, so this moves no markup assertion.
        onKeyDown={(event) => {
          const { key, shiftKey, nativeEvent } = event
          if (!shouldInterruptOnKeyDown({ key, shiftKey, isComposing: nativeEvent.isComposing }, true)) {
            return
          }
          onInterrupt()
        }}
      >
        <svg
          className="composer__send-icon"
          viewBox="0 0 28 28"
          width="28"
          height="28"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M14 28C21.7328 28 28 21.7328 28 14C28 6.26719 21.7328 0 14 0C6.26719 0 0 6.26719 0 14C0 21.7328 6.26719 28 14 28ZM10.5 8.75H17.5C18.468 8.75 19.25 9.53203 19.25 10.5V17.5C19.25 18.468 18.468 19.25 17.5 19.25H10.5C9.53203 19.25 8.75 18.468 8.75 17.5V10.5C8.75 9.53203 9.53203 8.75 10.5 8.75Z" />
        </svg>
      </button>
    )
  }
  return (
    <button
      type="button"
      className="composer__send"
      aria-label={SEND_LABEL}
      onClick={onSend}
      disabled={!canSend}
    >
      <svg
        className="composer__send-icon"
        viewBox="0 0 28 28"
        width="28"
        height="28"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M14 28C21.7328 28 28 21.7328 28 14C28 6.26719 21.7328 0 14 0C6.26719 0 0 6.26719 0 14C0 21.7328 6.26719 28 14 28ZM20.6172 14.8203C21.1312 15.3344 21.1312 16.1656 20.6172 16.6742C20.1031 17.1828 19.2719 17.1883 18.7633 16.6742L14.0055 11.9164L9.24766 16.6742C8.73359 17.1883 7.90234 17.1883 7.39375 16.6742C6.88516 16.1602 6.87969 15.3289 7.39375 14.8203L13.0703 9.13281C13.5844 8.61875 14.4156 8.61875 14.9242 9.13281L20.6172 14.8203Z" />
      </svg>
    </button>
  )
}

// #602: `onMessageSent` fires exactly when the operator's message enters the timeline. REQUIRED, not
// optional — `<Composer />` above is the only render site in the repo (Composer is not exported and no test
// renders it), so requiring it costs no edit cascade and makes "forgot to wire it" a compile error. That is
// the opposite call from Timeline's optional `scrollPin`, and for the opposite reason: there, 30 existing
// render sites made optional the only non-cascading choice.
//
// #678: `phase` arrives on the same terms and for the same reason — the open conversation's phase, already
// destructured by the container, handed down so the send button can derive its stop variant. A required
// prop, not a subscription of its own.
//
// #906: `covered` is the third prop and arrives on the same required terms. When an outstanding question
// batch belongs to the conversation on screen, ComposerSlot below draws the panel in this component's
// slot and passes `covered` so the whole composer goes behind it.
function Composer({
  serverId,
  conversationId,
  phase,
  onMessageSent,
  covered,
  beforeComposer
}: {
  serverId: string | null
  conversationId: string | null
  phase: TurnPhase
  onMessageSent: () => void
  covered: boolean
  beforeComposer: (sendText: (value: string) => boolean) => ReactNode
}): JSX.Element {
  // Selected coordinates survive metadata refreshes; only transient UI belongs to the keyed pane.
  const text = useComposerDraftStore(s => selectDraft(s, serverId, conversationId))
  const setDraft = useComposerDraftStore(s => s.setDraft)
  const setText = (value: string): void => {
    if (serverId !== null && conversationId !== null) setDraft(serverId, conversationId, value)
  }
  // #179: the optimistic echo now writes into timelineStore (a userText ThreadEvent), not sessionStore
  // — content lives in one store. The send gate below still reads sessionStore's connection status;
  // two stores in one component is fine (status vs. content are orthogonal facets).
  const dispatch = useTimelineStore((s) => s.dispatch)
  // Stamp the local echo with the resolved send host so saved-chat reopening retains it.
  // The store action is stable, just like the flat timeline's dispatch.
  const dispatchLocalEcho = useConversationTimelineStore((s) => s.dispatchLocalEcho)
  // #31: gate the send control on the live connection status. Selecting `status` re-renders the
  // Composer when it changes, so the control re-enables reactively on connect (AC3) with no reload.
  // The thread selects only the timeline `items` slice, so status changes don't re-render it.
  const status = useOpenConnectionStatus()
  const { canSend } = composerAvailability(status)
  // #448: the send targets the ACTIVE conversation. submitMessage no-ops on a null id (the daemon
  // rejects an unknown conversation_id with an error frame, so a placeholder is never sent).
  const activeConversationId = useActiveConversationStore((s) => s.activeConversation?.id ?? null)
  // #863: the attach affordance's held outcome and the intent that clears it. ADR 0006 state — ephemeral,
  // screen-local, read by nothing else — held HERE rather than in a store, and the two halves it feeds
  // mount in different places (the button in the footer row, the line beneath it), which is why the hook
  // returns a pair instead of this being one component. It resets on remount for free: PairedShellView
  // keys the chat pane on the conversation id, so a switch rebuilds this component with a fresh outcome.
  // No `window.pyry` dereference happens during render — see the hook.
  // #1205: it takes the open conversation's id, the same value `submitMessage` sends under, because the
  // daemon files an upload under the conversation the ask names and refuses one naming none. Read here
  // from the store the send already reads, so the two cannot name different chats.
  const attach = useAttachmentUpload({ conversationId: activeConversationId })
  // #890: the drop entry into that same flow. It takes `attach.dropFile` — the hook's own third member —
  // rather than a second bridge call of its own, which is what keeps ONE owner of the clear-on-gesture
  // and one outcome surface for both entries. The conversation rides `attach.dropFile` itself (#1205).
  const fileDrop = useComposerFileDrop({ onFile: attach.dropFile })

  // #680: the composer's ONE send path, extracted from handleSubmit so the Actions menu's picked command
  // takes the identical route a typed message does rather than a parallel one. The gate, the deps object,
  // the notify and their order are moved verbatim, not rewritten — which is what makes the typed path
  // behaviour-preserving by construction. Everything except the message box's own text-clearing lives
  // here, because clearing an input a command never touched would be wrong.
  //
  // It is also the whole of AC4: this first line is the only send gate, and there is no second entry point
  // to forget. The Actions menu holds no `canSend` prop of its own precisely so a drift-capable copy of it
  // cannot exist.
  const sendText = (value: string): boolean => {
    // AC1: the authoritative gate. Return before touching submitMessage so no sendCommand and no
    // optimistic echo fire while not connected — this blocks the Enter path (handleKeyDown) as well
    // as the button. The input is not cleared; nothing was sent.
    const serverId = connectedConversationHostNow(activeConversationId)
    if (!canSend || serverId === null) return false
    // `window.pyry` is dereferenced only here, at interaction time — never during render — so the
    // server-rendered container smoke test never touches the bridge. Do NOT hoist the deps object out of
    // this function: that would move the dereference into the render path, where `window.pyry` does not
    // exist under renderToStaticMarkup, and every container smoke test would throw.
    const sent = submitMessage(value, activeConversationId, {
      sendCommand: window.pyry.sendCommand,
      dispatch,
      dispatchFor: (conversationId, event) => {
        if (event.type === 'userText') dispatchLocalEcho(serverId, conversationId, event)
      },
      newMessageId: () => crypto.randomUUID(),
      // #1013: the echo's clock. Referenced, not called — `submitMessage` reads it once, past both of its
      // `false` returns, so a refused submit never stamps. `Date.now` rather than a store value because
      // the moment being recorded IS now: this line is inside the send handler, not the render path.
      now: Date.now,
      // #1039: the files this message is being sent with — the uploads that have completed since the last
      // send. Referenced, not called, exactly like the clock above, and for a sharper reason: this take is
      // DESTRUCTIVE (the hook clears its pending set in the same act), so calling it here would consume the
      // operator's attachments on a submit `submitMessage` is about to refuse. That helper reads it once,
      // below both of its `false` returns, which is what makes "cleared by a send that actually happened,
      // and only by one" a property of the code rather than of this line.
      //
      // Both of `sendText`'s callers reach this — the composer's own submit and ComposerActionsMenu's
      // picked command — and that is correct: a slash command is a message that was sent, so it records
      // and consumes what is pending exactly as a typed one does.
      takeAttachments: attach.takePendingAttachments
    })
    // #602: `sent === true` is exactly "a message entered the timeline", which is why the notify sits HERE
    // and not at the top of this function or just past the `!canSend` gate. Both of submitMessage's `false`
    // returns (composerSend.ts:56-57 — whitespace-only, null conversation id) are above its echo dispatch,
    // and the gate above returns before submitMessage is called at all, so a submit that sends nothing never
    // reaches this line: it leaves the scroll position as the operator's own scrolling set it and leaves NO
    // armed pin behind, so the next unrelated arriving item still cannot yank a scrolled-up operator. A send
    // whose bridge call throws is caught (composerSend.ts:69-72), still posts the echo and still returns
    // `true`, so it follows — correctly, because the timeline did move.
    if (sent) onMessageSent()
    return sent
  }

  // The notify now runs a line BEFORE the clear rather than a line after it. Inert: `onMessageSent` is
  // `followBottom`, a single ref assignment with no measurement and no scrollTop write (:464-475), and
  // both calls sit in one discrete handler that React 18 batches, so the render mounting the echo lands
  // after the whole handler either way.
  const handleSubmit = (): void => {
    if (sendText(text)) {
      setText('')
      window.pyry.sendDiagnostic({ event: 'composer-draft-cleared', code: 'local-submit' })
    }
  }

  // New session uses its own command, with the same current-owner gate as message sends.
  const startNewSession = (): void => {
    if (connectedConversationHostNow(activeConversationId) === null) return
    sendNewSession(activeConversationId, { sendCommand: window.pyry.sendCommand })
  }

  // Completion writes the same retained draft as typing; sending keeps its existing single path.
  const typeAhead = useSlashCommandTypeAhead({
    text,
    conversationId: activeConversationId,
    onComplete: setText
  })

  /**
   * #1033: the PASTE entry into the attach flow, and the third gesture that reaches it.
   *
   * ⭐ IT MOUNTS ON THE TEXTAREA, WHICH IS THE OPPOSITE CALL FROM #890's DROP HANDLERS one element up.
   * Those spread onto `.composer` deliberately, so a drop on the footer row counts as much as one on
   * the message box. A paste fires on the FOCUSED element and bubbles, so either mount point would
   * receive it — this is a choice about SCOPE, not reachability. The handler's whole job is to suppress
   * a default paste, and the textarea is the only element in the composer that has one; mounting on
   * `.composer` would additionally intercept a paste made while a footer button holds focus, turning a
   * keystroke with no text destination into a network transfer. Narrower is the right call for a
   * handler whose effect is to start an upload.
   *
   * It adds NO CLASS and changes no class run — an event handler renders no attribute at all, so
   * composerSlot.test.tsx's whole-run match on `class="composer__input"` is untouched by construction.
   *
   * The early return is the whole of "text pastes stay text": a clipboard `pasteCarriesImageOnly`
   * declines is not consumed, not prevented and not reported, so the default paste runs exactly as it
   * does today — including the copied web-page selection that carries an image alongside its text.
   * `clipboardData` is read for `types` and nothing else; the bytes stay in the operator's clipboard
   * and #1032's background-process path reads them there.
   */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!pasteCarriesImageOnly(event.clipboardData?.types)) return
    event.preventDefault()
    attach.pasteImage()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // #940: the open type-ahead sees the keystroke FIRST, and reports whether it consumed it. That one
    // line is the whole of "Enter completes, it does not send": on a consumed key the composer returns
    // before shouldSubmitOnKeyDown is consulted, so the send gate below is never reached. A second Enter
    // meets a closed panel, is not consumed, and sends exactly as a typed message does.
    if (typeAhead.handleKeyDown(event)) return
    // ONE record, TWO questions (#1072). `isComposing` is on the DOM event, not React's synthetic one, so
    // it is read through `nativeEvent` — writing `event.isComposing` is a compile error, which is what
    // keeps this untested glue honest.
    const { key, shiftKey, nativeEvent } = event
    const keystroke = { key, shiftKey, isComposing: nativeEvent.isComposing }
    // #1072: Escape stops the running turn, and its position in this handler IS its ordering guarantee.
    // Sitting BELOW the type-ahead's claim above is the whole of "one Escape does one thing": a consumed
    // Escape returned already, so the first closes the panel and sends nothing and the second — panel now
    // closed, key not consumed — reaches here. Every other Escape claimant on this screen takes focus when
    // it opens and mounts its `document` listener only while open, so while one is open this handler is not
    // on the event's path at all; that is why binding inside the composer needs no open-state and no
    // listener ordering. #1634's background-task drawer is the one exception: it takes no focus, so its
    // capture listener sees this press first and DEFERS to it through `drawerClosesOnKeyDown`, which asks
    // this same `shouldInterruptOnKeyDown` — a press that stops the turn leaves the drawer open. NO preventDefault(): Escape has no default action in a textarea, so there is
    // nothing to suppress. The gate is isTurnRunning(phase) ALONE, the stop button's gate and for its
    // reason (#650's localSendPending would arm an interrupt for a turn the daemon has not started), and
    // `window.pyry` is dereferenced HERE, at interaction time, never during render.
    if (shouldInterruptOnKeyDown(keystroke, isTurnRunning(phase))) {
      // #1092: `activeConversationId` is the SAME expression the send and `startNewSession` read,
      // which is what stops the three ever naming different chats; `sendInterrupt` refuses a null or
      // empty id and sends nothing.
      if (connectedConversationHostNow(activeConversationId) !== null) {
        sendInterrupt(activeConversationId, { sendCommand: window.pyry.sendCommand })
      }
      return
    }
    // Enter sends; Shift+Enter inserts a newline; the Enter that commits an IME composition does
    // neither (#512). The `return` MUST precede preventDefault(): preventing the default
    // on the committing keydown would break the IME commit itself. Disjoint from the branch above by key,
    // so the two orderings are a reading convenience and Enter's path is untouched either way.
    if (!shouldSubmitOnKeyDown(keystroke)) return
    event.preventDefault()
    handleSubmit()
  }

  const body = (
    // #906: the native `hidden` attribute is the WHOLE cover mechanism, and one attribute doing three
    // jobs is why it was chosen over the alternatives. It hides the subtree, drops it from the tab order
    // and drops it from the accessibility tree, while leaving every element MOUNTED — so the draft in
    // `text` above survives the batch and is still in the message box when the daemon dismisses it. A
    // conditional render would reset transient controls; `aria-hidden` alone would leave a focusable invisible
    // textarea whose Enter still sends. `.composer__footer` and `.composer__row` are CHILDREN of this
    // div, so the one attribute takes the footer menus, the context reading and the send/stop control
    // with it — there is no second element to hide separately, and nothing to draw a disabled state for.
    // ComposerStatusArea is a SIBLING of this div in the conversation column, not a descendant, so the
    // working indicator above the composer is deliberately untouched.
    // conversation.css MUST carry `.composer[hidden] { display: none }`: the UA's `[hidden]` rule loses
    // to the author-level `.composer { display: flex }` regardless of specificity, so without it this
    // attribute is a no-op for layout and only the accessibility half works.
    // #890: the whole block is the drop target, so a drop on the footer row counts as much as one on the
    // message box. `composerClassName` is a BRANCH rather than an interpolation because the resting run
    // must stay byte-identical — three shipped assertions in composerSlot.test.tsx match `class="composer"`
    // as a whole attribute run, two of them as `class="composer" hidden=""` — so `className` also stays
    // ahead of `hidden` in this list. The spread carries event handlers only and renders no markup.
    <div className={composerClassName(fileDrop.active)} hidden={covered} {...fileDrop.handlers}>
      {/* #1262: the pending attachments, this column's FIRST child (Figma `Attachment area` 390:7136, at
          y=40 between a status area ending at 32 and an input beginning at 108 — the drawn 8px above and
          below). Note that ComposerAttachOutcome below is the same column's LAST child: "the composer
          column takes a row of its own for this" is the shared reasoning, not the position.

          The 8px ABOVE needs no rule at all — `.composer`'s own padding-top already sits between the
          status row and this child, which is exactly what the design draws. The 8px BELOW is the column's
          --space-1 gap plus the strip's own --space-1 margin; conversation.css states that arithmetic.

          It renders `null` until an upload completes, and `null` costs no flex gap — the same criterion
          the outcome line answers the same way, and load-bearing here for a sharper reason: an element
          that mounted empty would move the message box down on every launch, in every spec, forever.

          It is INSIDE the element that wears `hidden`, so #906's question panel covers the tiles along
          with the message box and the footer — nothing new to hide. And a conversation switch clears it
          for free: PairedShellView keys the chat pane on the conversation id, so this composer is rebuilt
          around a fresh holder. */}
      {/* #1264: each tile's remove control takes that tile back out of the pending set, so the next send
          does not name its id. Nothing crosses the wire — the hook writes its two holdings and stops. */}
      <ComposerAttachmentStrip attachments={attach.pending} onRemove={attach.removePending} />
      {/* #940: this row is the type-ahead's ANCHOR — its left edge is the message box's, and the panel
          positions against it (`position: relative` in conversation.css) and inherits the clamp's
          --composer-options-shift from it. It deliberately does NOT wear `.composer-options-anchor`,
          even though that block was written for this consumer: the class carries only position: relative
          and display: flex, both of which this row already declares for itself, so wearing it would add
          nothing. (Until #988 this comment gave a second reason — that e2e/composer-options-clamp.spec.ts
          locates that class bare and relies on exactly one existing in the app. That reason is SPENT: the
          footer's model menu renders a second anchor whenever a model list has arrived, and that spec now
          scopes its locator to the Actions trigger. The decision above stands on its own.) */}
      <div className="composer__row" ref={typeAhead.anchorRef}>
        {/* The textarea stays enabled while not connected — the user may draft; only the send
            control is gated (AC1). The ref is the type-ahead's: a row picked with the MOUSE moves focus
            onto a button that then unmounts, so the completion hands focus back to the box. */}
        <textarea
          ref={typeAhead.inputRef}
          className="composer__input"
          placeholder="Message…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {/* #678: one control, two variants. `isRunning` is derived from `phase` on EVERY render and is
            never a local flag set on click, so a turn that ends on its own returns the button to send with
            no user action (AC3). It is gated on isTurnRunning(phase) ALONE: #650's `localSendPending`
            opens the working-indicator window while `phase` is still the daemon-owned `idle`, and wiring
            it in here would arm a stop button for a turn the daemon has not started. `onInterrupt` MUST
            stay an arrow function so `window.pyry` is dereferenced at interaction time, never during
            render — hoisting it (or the deps object) would move that dereference into the render path,
            where `window.pyry` does not exist under renderToStaticMarkup, and every container smoke test
            would throw. No optimistic state: the button returns to send on the daemon's next
            turn_state{idle}, which the live store subscription renders. #1092: it names
            `activeConversationId`, the same expression the Escape branch above reads, so the two Stop
            affordances cannot address different chats. */}
        <ComposerSendButton
          isRunning={isTurnRunning(phase)}
          canSend={canSend}
          onSend={handleSubmit}
          onInterrupt={() => {
            if (connectedConversationHostNow(activeConversationId) === null) return
            sendInterrupt(activeConversationId, { sendCommand: window.pyry.sendCommand })
          }}
        />
        {/* #940: the panel, last child of its anchor. It is `position: absolute`, so it is not a flex
            item of this row and moves neither the box nor the button; `null` when the type-ahead is
            closed, which is every state but a matching slash fragment. */}
        {typeAhead.panel}
      </div>
      {/* #811: the input footer row (Figma 110:3494), beneath the message box. An inline BEM child of
          .composer like __row above it — not a component: ComposerStatusArea is one because it
          is a SIBLING of .composer in the conversation column, with props and two slots, while this is
          the composer's own second sub-row (#968 retired __hint, which used to be the first). It renders
          UNCONDITIONALLY and holds its height from the
          stylesheet, which is what stops the message box moving when the reading comes and goes (AC4).

          Still NO wrapper element for the group Figma's `Info and buttons` sub-frame draws — and with #863
          the reason has changed rather than gone. The old sentence here said attach was blocked on daemon
          work that does not exist; #862 shipped that work and #863 wires the button to it, so the row now
          holds all five items the design draws. What survives is the RULE, not the blocker: the group is a
          Figma grouping, and emitting a wrapper element for it would buy nothing the row's own flex layout
          does not already give. The attach button is a SIBLING of that group in the design too (115:3654
          against 115:3660), which is what makes it right-aligned rather than the group's fifth member.

          #680: Actions is the row's FIRST item (Figma 115:3677 at x=0), ahead of the reading. It takes
          `sendText`, so a picked command travels the identical path a typed one does — the same gate, the
          same submitMessage call, the same optimistic echo and the same scroll follow (AC3, AC4). No
          `canSend` prop goes down with it: the gate stays in one place.

          #682: the permission-mode menu (Figma 115:3678), the row's SECOND item, now at the design's
          x=76 — it is the control the two notes below were holding the slot for, so the row finally
          matches Figma's own order (Actions · mode · model · effort · reading).

          #1022 gave it `conversationId`, which it did not take until then. Its VOCABULARY is still
          client-owned rather than daemon-published, but one entry of it is now conditional: a row's
          `supports_auto_mode` hides `auto` on a model that refuses it, so this control selects the same
          model-list slice its two neighbours do. It subtracts one named mode from a list it owns, where
          they take their whole entry list from the daemon.

          IT IS STILL THE ONE FOOTER MENU THAT IS ALWAYS OPERABLE, and that survived #1022 unchanged. The
          other two go inert when no list has arrived for the conversation; this one's list never falls
          below four entries whatever the daemon says or does not say, so a mode being known is still the
          whole condition — which is why the row's anchor and aria-haspopup counts move by one here as
          soon as a snapshot lands, and why several sibling assertions were re-counted with #682.

          #988: the model menu (Figma 115:3683), at the design's x=135. It takes `conversationId` and
          reads its own four store slices, so a snapshot tick re-renders this leaf rather than the textarea
          beside it.

          #989: the effort menu (Figma 115:3688), the row's LAST control before the reading, at the
          design's x=197. Same shape as the model menu beside it and the same four store slices, but its
          label is the session's effort VALUE rather than a looked-up name: claude publishes these levels
          byte-identical to what it accepts, so there is nothing to relabel — where the permission menu
          above DOES look its label up, since a mode arrives as a camelCase machine identifier. All three
          controls render nothing at all until a run-config snapshot has arrived.

          #863: the attach button (Figma 115:3654), the row's LAST item, right-aligned past all four
          controls and the reading by `margin-left: auto` — which this comment block has named as attach's
          alignment since #811. It is the one item here that renders UNCONDITIONALLY: the three menus above
          each wait on a run-config snapshot, and this control has no daemon-published anything to be
          missing. It takes no `conversationId` and reads no store, because the intent it dispatches names
          no conversation and no file — the picker, the path and the bytes all stay in the background
          process. */}
      <div className="composer__footer">
        <ComposerActionsMenu
          conversationId={activeConversationId}
          onCommand={sendText}
          onNewSession={startNewSession}
        />
        <ComposerPermissionModeMenu conversationId={activeConversationId} />
        <ComposerModelMenu conversationId={activeConversationId} />
        <ComposerEffortMenu conversationId={activeConversationId} />
        {/* #1169: headless — it renders null, so it adds no item to this row and no count, anchor or
            geometry assertion in e2e can see it. It sits beside the control it feeds rather than
            app-level in App.tsx because its decision reads the OPEN chat's session and published levels,
            and this is where that conversation id is already in hand and where its lifetime is the open
            chat's. */}
        <EffortDefaultData conversationId={activeConversationId} />
        <ContextUsageControl conversationId={activeConversationId} />
        <ComposerAttachButton onAttach={attach.requestAttach} />
      </div>
      {/* #863: the attach outcome, the composer column's last child and NOT a member of the footer row
          above. Three reasons, and each is independently sufficient: the row holds a hard height: 20px, so
          a sentence in it would overflow rather than grow it; four shipped e2e specs assert
          `.composer__footer [role="alert"]` has count 0, which a live region in that row invites a
          collision with; and the outcome wraps, which a 20px row cannot express. The status row's trailing
          slot is not available either — ComposerErrorSlotControl owns it and .composer-status is
          min-height sized BY that occupant, so a third thing there means settling precedence between two
          error surfaces and can move the composer.

          It renders `null` until an outcome arrives, and `null` costs no flex gap, which is the whole of
          AC5's second half: nothing is reserved while nothing is showing. */}
      <ComposerAttachOutcome outcome={attach.outcome} />
    </div>
  )
  return <>{beforeComposer(sendText)}{body}</>
}

/**
 * #906: the composer's slot — the store-bound container that decides whether the operator sees a message
 * box or a clarifying question. The #224 split: the panel's markup is QuestionPanelView's, the store read
 * is here, and this is also the only place that can own it, because covering the composer needs
 * `Composer`, which is this module's own.
 *
 * `conversationId` arrives as a PROP rather than as a store read of its own, the BackgroundTaskPanel
 * idiom two screens up: ConversationScreen already holds `activeConversation`, and re-reading it here
 * would buy nothing. What that leaves is the question read, isolated in this leaf — so a batch arriving
 * re-renders the composer slot and never ConversationScreen, whose re-render would take the whole
 * timeline with it.
 *
 * `selectBatchFor` IS CALLED INLINE, with no `useMemo` and no per-conversation selector cache, on the
 * store's own ruling: `useStore` compares the selector's RESULT under `Object.is`, not the selector's
 * identity, and the held batch comes back by reference. A memo table keyed on a conversation id would be
 * merely redundant; keyed on anything claude-authored it would put untrusted text in a lookup path, which
 * is this family's named failure mode.
 *
 * `conversationId === null` is an explicit test and deliberately not `?? ''`, matching App.tsx's
 * `openConversationId`: an empty-string id stays an ordinary key rather than collapsing into "nothing
 * open" the way a truthiness test would.
 *
 * The BATCH read is this container's; the PICKS read is `QuestionPanelSlot`'s, one level down, so a pick
 * re-renders the panel without waking the composer this slot is covering. `batch.questions[…]` is read
 * there with no guard and no `!`: `reduceQuestionBatches` returns state unchanged when `questions` is empty
 * — the guard sits before the match — so `[]` never reaches `outstanding`, even though the wire type admits
 * it. WHICH of them is drawn has been the operator's choice since #915; see the slot below.
 *
 * The questionnaire wrapper is hidden only during permission coverage. Keeping it mounted preserves
 * its active question while the composer independently retains the draft beneath both request types.
 */
export function ComposerSlot({
  serverId = null,
  conversationId,
  phase,
  onMessageSent,
  statusArea
}: {
  serverId?: string | null
  conversationId: string | null
  phase: TurnPhase
  onMessageSent: () => void
  statusArea?: (sendText: (value: string) => boolean) => ReactNode
}): JSX.Element {
  const batch = useQuestionBatchStore((s) =>
    conversationId === null ? undefined : selectBatchFor(conversationId)(s)
  )
  const hasPermission = useModalStore((s) =>
    conversationId !== null && selectHasOutstandingFor(conversationId)(s)
  )
  return (
    <Composer
      serverId={serverId} conversationId={conversationId}
      phase={phase} onMessageSent={onMessageSent} covered={hasPermission || batch !== undefined}
      beforeComposer={(sendText) => (
        <>
          {statusArea?.(sendText)}
          <PermissionModal conversationId={conversationId} />
          {/* Keep the active question mounted while permission temporarily takes precedence. */}
          {batch && (
            <div hidden={hasPermission}>
              <QuestionPanelSlot key={batch.questionBatchId} batch={batch} />
              <div className="composer__footer">
                <ComposerModelMenu conversationId={conversationId} />
              </div>
            </div>
          )}
        </>
      )}
    />
  )
}

/** The question a batch OPENS on, and since #915 that is all it is: the seed for the slot's own state, not
 *  the only question the panel can draw. The two-places warning it used to carry now belongs to
 *  `activeIndex` below, which is still read once and used twice — the question read and the picks key —
 *  because a silent disagreement there would render one question's rows against another's selection. */
const FIRST_QUESTION_INDEX = 0

/**
 * #912 / #915: the panel's own store-bound container — the picks half of the #224 split, and the seam where
 * a gesture on a row (or, since #915, on a header tab) becomes a store event or a jump.
 *
 * THE JUMP IS PANEL-LOCAL COMPONENT STATE, never a new arm on the picks store, and the asymmetry with the
 * picks is the point. What must survive a chat switch is the PICKS, and they already do because they live
 * outside the pane `PairedShell` keys on the conversation id (#670) — so this leaf remounts on a switch and
 * the batch re-opens on its first question, which is intended rather than a gap to defend. Putting the index
 * in the store instead would widen its event union and every clearing arm for nothing observable.
 *
 * A SEPARATE LEAF FROM `ComposerSlot`, MOUNTED ONLY WHILE A BATCH IS UP, rather than a picks read added
 * beside the batch read above. Hooks cannot be conditional, so reading the picks store in `ComposerSlot`
 * would need a sentinel batch id for the no-batch case AND would subscribe the composer to pick traffic —
 * every keystroke in the Other field re-rendering the message box it is covering. A leaf that only exists
 * while the panel does needs no sentinel and keeps a pick re-rendering the panel alone.
 *
 * `selectQuestionSelection` IS CALLED INLINE, no `useMemo`, on the picks store's own explicit ruling:
 * `useStore` compares the selector's RESULT under `Object.is`, and both of its branches (the held selection,
 * or the shared empty constant) are reference-stable. `ComposerSlot`'s note above applies unchanged — a memo
 * table keyed on anything claude-authored would be this family's named failure mode.
 *
 * **THE KEY IS `batch.questionBatchId`, NOT `conversationId`, and the substitution would compile clean.**
 * The nonce is what makes AC4's second half hold for free: a batch dismissed and immediately replaced for
 * the same conversation reads a FRESH empty selection, with no clearing effect to get wrong and no stale
 * pick reachable. Keyed on the conversation, the new batch would inherit the old one's picks.
 *
 * The two `*PickEventFor` mappings are `QuestionPanelView`'s, deliberately: the view stays variant-neutral
 * so it has no arm to transpose, and this container — which holds `multiSelect`, the nonce and the index —
 * is where the single-versus-multi distinction is told to the store. `dispatch` is read off the store rather
 * than through a hook: it is a stable function on a singleton, so subscribing to it would buy nothing.
 *
 * `reconnected` IS NOT DISPATCHED HERE — `questionBridge` drives it from the transport's own
 * (re)handshake, which this container cannot see. `dismissed` NOW IS (#921), and this slot is the FIRST
 * thing in the family to raise one locally: Cancel refuses the batch and clears it optimistically, so the
 * daemon's own broadcast is no longer the only exit. The bridge still owns the remote path; both go
 * through `refuseQuestionBatch`'s and `subscribeQuestionBatches`' shared picks-first order, so the local
 * and remote clears cannot drift. The daemon's `question_dismissed` arriving afterwards is an unknown-id
 * no-op in both stores, returning the same state reference, so nothing further re-renders.
 *
 * THE SEND ITSELF IS NOT INLINE HERE, and that is what makes it testable at all. Renderer specs in this
 * repo are static server renders with no DOM and nothing to click, so a guarded send written into this
 * closure would put "a throwing bridge still clears the panel" out of vitest's reach entirely. It lives in
 * `refuseQuestionBatch` (the `modalResolution` / `composerSend` seam) with plain-spy coverage, and this
 * container stays thin glue. `window.pyry` is dereferenced only inside the click closure — interaction
 * time, never render — so the container's smoke render still touches no bridge.
 */
export function QuestionPanelSlot({ batch }: { batch: QuestionBatch }): JSX.Element {
  const responseAvailable = usePromptResponseAvailability(batch.conversationId)
  const [jumpedTo, setJumpedTo] = useState(FIRST_QUESTION_INDEX)
  // CLAMPED, AND THIS IS A CRASH GUARD RATHER THAN TIDINESS. `jumpedTo` is component state; the batch is
  // store state; they move independently. A same-nonce `question_shown` re-delivery REPLACES the held batch
  // in place (reduceQuestionBatches' `shown` arm, latest wins), so the nonce key upstream does not change,
  // this leaf does not remount, and a re-delivery carrying fewer questions than the operator has jumped past
  // would read `batch.questions[jumpedTo]` as undefined and throw out of the render — on a frame the daemon
  // controls and the reducer explicitly supports. `questions` is never empty (the reducer's guard sits
  // before the match), so `length - 1` is always a valid position.
  // COMPUTED ONCE and used twice below, which is FIRST_QUESTION_INDEX's old warning in its new home: the
  // question read and the picks key must be the same value. A `?? questions[0]` fallback would look like the
  // same fix and be the wrong one — it renders one question's rows against another question's selection.
  const activeIndex = Math.min(jumpedTo, batch.questions.length - 1)
  const question = batch.questions[activeIndex]
  const selection = useQuestionPicksStore(
    selectQuestionSelection(batch.questionBatchId, activeIndex)
  )
  // #922: the WHOLE batch's picks, beside the active question's. Two subscriptions to one store, and
  // the narrow one is not redundant — it is what the rows are drawn from, and it stays because
  // deriving it from the map below would need the picks store's deliberately-unexported empty
  // sentinel. The wide read costs no extra render either: it already changes on every pick in this
  // batch, so it is a superset of what the narrow one wakes on.
  const selections = useQuestionPicksStore(selectBatchSelections(batch.questionBatchId))
  // THE GATE AND THE PAYLOAD, FROM ONE CALL. `null` means some question in the batch holds no value:
  // it renders Continue unavailable AND is what `answerQuestionBatch` refuses, so the button's state
  // and the frame's contents cannot disagree. Computed inline in the render with no `useMemo` — it is
  // a pure pass over one batch's questions, and memoising it would need a key derived from the picks.
  const answers = resolveQuestionAnswers(batch.questions, selections)
  const at = {
    multiSelect: question.multiSelect,
    questionBatchId: batch.questionBatchId,
    questionIndex: activeIndex
  }
  const dispatch = questionPicksStore.getState().dispatch
  return (
    <QuestionPanelView
      responseAvailable={responseAvailable}
      questions={batch.questions}
      activeIndex={activeIndex}
      onQuestionSelected={setJumpedTo}
      // #921. The id read is `batch.questionBatchId` — the same value this leaf is keyed on upstream, so
      // the batch refused is by construction the batch drawn. Both stores' `dispatch` are read off their
      // singletons rather than through a hook: each is a stable function, so subscribing would buy
      // nothing (the existing `dispatch` read below made the same call).
      onCancel={() => {
        if (!canRespondToPromptNow(batch.conversationId)) return
        refuseQuestionBatch(batch.questionBatchId, {
          sendCommand: window.pyry.sendCommand,
          dispatchPicks: dispatch,
          dispatchBatch: questionBatchStore.getState().dispatch
        })
      }}
      // #922. The same three injected effects as the refusal above — one `QuestionResolveDeps` serves
      // both exits — with the assembled entries in place of nothing. The id read is
      // `batch.questionBatchId`, the value this leaf is keyed on upstream, so the batch answered is by
      // construction the batch drawn.
      canAnswer={answers !== null}
      onAnswer={() => {
        if (!canRespondToPromptNow(batch.conversationId)) return
        answerQuestionBatch(batch.questionBatchId, answers, {
          sendCommand: window.pyry.sendCommand,
          dispatchPicks: dispatch,
          dispatchBatch: questionBatchStore.getState().dispatch
        })
      }}
      selection={selection}
      onOptionChosen={(optionIndex) => dispatch(optionPickEventFor({ ...at, optionIndex }))}
      onOtherChosen={() => dispatch(otherPickEventFor(at))}
      onOtherTextChanged={(text) => dispatch({ type: 'otherTextChanged', ...at, text })}
    />
  )
}

// #279: the prominent, disconnected-only connection banner's pure view — the third read of the
// ConnectionStatus slice (beside the composer gate and the re-pair prompt), and the surface
// composerSend's docstring already reserves ("the connection banner's surface"). Returns null unless
// shouldShowBanner(status); when shown, renders a single band carrying CONNECTION_BANNER_COPY and
// nothing derived from `status` — so no daemon-supplied string (ConnectionError.message) can reach it
// (AC3, a structural guarantee, not a convention — the EMPTY_THREAD_COPY / ThinkingIndicator idiom).
// Visibility is a `status` PROP (not a store read) so the present/absent matrix is proven by directly
// server-rendering this view (the ComposerErrorSlot discipline, RepairPrompt's before #963 retired it).
// role="status" makes it a polite live region: the band persists visually, so a polite announcement
// suffices and nothing is lost by not stealing focus. It was also written to avoid an assertive
// double-announce with the composer's own caption; #968 retired that caption, so this band is now the
// only announcement of the transition in every non-connected arm — the reason for `status` over `alert`
// is unchanged, and the surface it was avoiding is simply gone.
export function ConnectionBanner({ status }: { status: ConnectionStatus }): JSX.Element | null {
  if (!shouldShowBanner(status)) return null
  return (
    <p className="conversation__banner" role="status">
      {status.type === 'error' && status.error.code === 'pairing-rejected'
        ? 'Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.'
        : CONNECTION_BANNER_COPY}
    </p>
  )
}

// The store-bound container for the connection banner (#279). Selects only `status` (selectStatus) so
// it re-renders exactly on a connection-status change and never on a timeline delta (AC4 reactivity —
// the same narrow-slice seam the composer gate and ComposerErrorSlotControl already use; no new store
// wiring, no window.pyry dereference, no effects — a pure read). Unlike that control, whose visible
// branches both need `error`, the banner's disconnected branch is a VISIBLE state, so the initial
// (disconnected) store is enough to server-render the container's shown path.
function useOpenConnectionStatus(): ConnectionStatus {
  const openId = useActiveConversationStore(s => s.activeConversation?.id ?? null)
  const rows = useConversationListStore(selectConversations)
  const serverId = serverIdForOpenConversation(rows, openId)
  return useSessionStore(s => serverId === null ? initialSessionState.status
    : selectStatusFor(serverId)(s) ?? initialSessionState.status)
}

function ConnectionBannerControl(): JSX.Element | null {
  const status = useOpenConnectionStatus()
  return <ConnectionBanner status={status} />
}

// #797: the connection-error chip filling the right-hand slot #796 reserved in the composer status row
// (Figma 112:3529). The FOURTH read of the ConnectionStatus slice and the narrowest of them: it reads the
// discriminant to decide WHETHER to show, and reads nothing out of the arm it shows for.
//
// IT NEVER DESTRUCTURES `status.error`. That is the whole of AC2 and it is deliberately structural, not
// conventional — the CONNECTION_BANNER_COPY guarantee one component over. Neither `message` nor `code`
// reaches the DOM as text, in an attribute, in a title, or into a console.* while debugging; since there
// is no rendering path for either, there is nothing to escape, length-bound or newline-strip, and nothing
// that can be forgotten. The design carries this independently: the mock's text node is a single 132x16
// line, which a relayed ErrorPayload.message would not fit.
//
// A <div>, not the banner's <p>. The banner is a paragraph in a band; this chip lives in a row with a
// hard height: 24px and this repo ships no global box-sizing/margin reset, so a <p>'s UA margin would be
// a live layout hazard against AC3 for no semantic gain.
//
// NO LIVE REGION — no role="status", no role="alert", no aria-live. The ConnectionStatusIndicator ruling
// below applies verbatim ("a STATIC labelled group, not a live region"): the banner (#279) already
// politely announces disconnects, and
// shouldShowBanner is true on the `error` arm, so a connected → error transition mounts the banner and
// this chip in the same commit. Two polite regions would queue two announcements of one fact.
//
// AC4's marking is HIDDEN TEXT, not an aria-label. An aria-label on a bare <div>/<span> is prohibited by
// ARIA 1.2 — those elements map to role="generic", which is on the name-prohibited list, so browsers drop
// the name: it would look right in the markup, assert green in a toContain, and do nothing for a real
// screen reader. A real text node cannot be dropped. Do not "simplify" this back to an attribute.
export function ComposerErrorChip({ status }: { status: ConnectionStatus }): JSX.Element | null {
  if (status.type !== 'error') return null
  return (
    <div className="composer-status__error">
      <span className="composer-status__error-prefix">{COMPOSER_ERROR_CHIP_PREFIX_COPY}</span>
      {COMPOSER_ERROR_CHIP_COPY}
    </div>
  )
}

// #1435: the count of background tasks claude has alive in the open conversation — the slot's LAST
// reading, drawn as the design's neutral Pill (347:6617) rather than in either error treatment, because a
// running task is not a failure.
//
// A `count` PROP, not a store read, on ComposerUsageLimitNotice's reasoning and for its reason: zustand
// v5's useStore reads getInitialState() under renderToStaticMarkup, so a store-bound container test can
// reach exactly one arm, and this view's arms are only assertable if the number is injected. `onOpen` is
// a prop for the second reason that view's `onRepair` sibling carries — it keeps every store and window
// dereference out of this render path.
//
// NO DAEMON STRING CAN REACH THIS DOM, and here that is a property of the TYPE rather than of a
// convention. The roster this number comes from also holds `description` — for `taskType: local_bash`
// the literal command line claude ran — and `latestUpdate.patch`, both untrusted and model-influenced
// (see backgroundTaskRosterStore's SECURITY paragraph). `count: number` is the whole boundary: no string
// from that store is representable here. The only interpolation is `${count}` into a TEXT run, which
// React escapes, and `className` is a single literal with NO interpolation — deliberately, since
// interpolating into a class is the edit ComposerUsageLimitNotice's docblock records as one step from
// putting an untrusted value in an attribute.
//
// `count <= 0` RETURNS NULL, and the comparison is `<= 0` rather than `=== 0` on purpose: the count is
// `tasks.size + droppedTasks` and `dropped_tasks` decodes through a plain requireNumber (the type is
// checked, the value is not), so a hostile or merely buggy daemon can drive the sum negative. Absent is
// the right reading for both, and "never observed" collapses here too — the container resolves a null
// roster to 0. NULL rather than an empty element, which is AC2 and is the same posture ContextUsageReading
// takes one row down: the row's own height holds the slot, never a placeholder node.
//
// A <button>, and a real one rather than a div wearing a handler: keyboard activation, the UA focus ring
// and the accessible name all come from the element. NOT `button-small` — that treatment is the 32px
// error button, and AC5 keeps this row at the 24px it already reserves. No aria-label and no hidden
// prefix: the visible text says what it is in plain words, so it is already the accessible name (the
// ComposerUsageLimitNotice ruling, which is also why there is NO LIVE REGION here — the row is not a
// place to queue announcements, and a count that moves with every turn would announce on each one).
//
// A SINGLE text run per arm, each a client-owned literal chosen by an explicit two-way conditional —
// never one string with a spliced-in plural suffix. One run has one predictable serialisation, which is
// what makes the exact-markup assertions in this file's specs stable (.composer-status__label's
// discipline). No copy constant for two strings with one call site each: this module's copy constants
// exist for strings asserted across FILES or that must be provably free of daemon text, and neither
// applies (ContextUsageReading's ruling, verbatim).
//
// #1634: the pill TOGGLES the drawer, and wears the design's Primary outline (the `--open` modifier) and
// `aria-expanded` only while it is open. `open` defaults to closed and both attributes are absent when
// closed, so the closed render is byte-identical to the one every pre-existing site asserts.
export function ComposerTaskCount({ count, onToggle, open = false }: {
  count: number
  onToggle: () => void
  open?: boolean
}): JSX.Element | null {
  if (count <= 0) return null
  return (
    <button
      type="button"
      className={open ? 'composer-status__tasks composer-status__tasks--open' : 'composer-status__tasks'}
      aria-expanded={open ? true : undefined}
      onClick={onToggle}
    >
      {count === 1 ? '1 task running' : `${count} tasks running`}
    </button>
  )
}

// #1494: a failed MCP server the operator has not yet seen, in the #963 Error-type small button. The name
// reaches the DOM only as the escaped text run below, bounded as the Channel info sheet bounds it, and
// never in an attribute; the modifier class caps the width so a long name truncates rather than growing
// the row. The visible text says what it is, so it is the accessible name.
export function ComposerMcpFailure({ name, onOpen }: {
  name: string
  onOpen: () => void
}): JSX.Element {
  return (
    <button type="button" className="button-small button-small--error composer-status__mcp-failure" onClick={onOpen}>
      {mcpFailedCopy(boundMcpText(name))}
    </button>
  )
}

// #963: the status row's right-hand slot, resolved. An error the operator can ACT on becomes a button in
// the slot the chip otherwise holds (operator ruling 2026-09-02), which is what retires #167's separate
// `.composer__repair` block beneath the composer — one control, in the place the operator already looks.
//
// Reconnect is the one actionable error left here (#1604 moved Re-pair to the Top overlay), ahead of
// the chip and all connected-only occupants. Error fields select a branch but never supply markup, attributes, accessible copy or logs.
// Inject status and handlers so the pure view remains statically testable without stores or window.
export function ComposerErrorSlot({
  status,
  onReconnect,
  notice,
  recovery,
  refusal,
  history,
  mcpFailure,
  taskCount
}: {
  status: ConnectionStatus
  onReconnect: () => void
  notice: JSX.Element | null
  recovery?: JSX.Element | null
  refusal?: JSX.Element | null
  history?: JSX.Element | null
  mcpFailure?: JSX.Element | null
  taskCount?: JSX.Element | null
}): JSX.Element | null {
  // #1604 moved Re-pair out of this slot into the conversation's Top overlay (`TopOverlayControl`), so
  // pairing rejection — which `shouldOfferReconnect` excludes — now falls through to the chip below.
  if (shouldOfferReconnect(status)) {
    return (
      <button type="button" className="button-small button-small--error" onClick={onReconnect}>
        {COMPOSER_RECONNECT_BUTTON_COPY}
      </button>
    )
  }
  // #1321 SPLIT THIS ARM IN TWO, and the split is what makes AC4 structural. Through #963 the delegate
  // covered all four connection arms at once, because ComposerErrorChip's own guard returns null on three
  // of them. With a third occupant below, the `error` discriminant has to be asked HERE, or the notice
  // would render beside the chip instead of behind it. #797's view, its treatment and its tests are
  // untouched: this reaches it on exactly the arm it already showed on.
  if (status.type === 'error') return <ComposerErrorChip status={status} />
  // The notice fills the slot ONLY WHILE THE CONNECTION IS HEALTHY, which is stricter than AC4's "with a
  // connection error live" and deliberately so. A connection error — actionable or not — is the more
  // urgent fact and makes a quota reading stale anyway; the same is true while disconnected or
  // connecting, where #279's banner is up saying so, and a quota claim beside it would contradict it.
  //
  // `notice` is a ReactNode-shaped prop rather than the reading itself — ComposerStatusArea's own
  // `trailing` seam one level down. This view stays a slot that knows its occupants' PRIORITY and nothing
  // about a usage window, which is also what keeps the added prop cheap: every pre-existing call site
  // passes `notice={null}` and no assertion in them moved. Required rather than optional, on the standing
  // rule that an optional prop is the silent-omission hole a type cannot catch.
  //
  // #1435 APPENDS THE TASK COUNT TO THE END OF THIS CHAIN, and the end is the whole of its AC3: every
  // reading already here outranks it, so a re-pair, an error, a recovery, a refusal, a notice or a
  // history failure replaces it. ONE precedence rule, not a second beside it — and the count needs no
  // connection gate of its own, since the whole chain already sits inside the `connected` arm and the
  // three other arms still return null unchanged (AC2's connection half, for free).
  //
  // `taskCount` is OPTIONAL, matching `recovery` / `refusal` / `history` rather than `notice`. The
  // paragraph above argues the other way and is left standing because its reasoning is sound in general;
  // it loses HERE on cost — required would rewrite every pre-existing ComposerErrorSlot render in this
  // file's specs to add `taskCount={null}`, for a hole one call site cannot fall into.
  //
  // AN ABSENT OCCUPANT MUST ARRIVE AS ACTUAL `null`, never as an element whose component renders
  // nothing: `??` tests the ELEMENT, not what it renders, so a non-null placeholder wins the slot and
  // hides everything below it. That rule is why ComposerErrorSlotControl checks its count before
  // constructing the pill, and it is stated here rather than only there because this is the expression it
  // constrains. At the chain's LAST position nothing is below to hide, so it is not yet load-bearing for
  // precedence — it is kept because it is the rule the day a sixth occupant is appended, and because
  // creating the element unconditionally would put an empty node in the slot AC2 requires be empty.
  //
  // #1494 inserts the MCP failure notice after the history failure and ahead of the task count: every
  // error above outranks it, and it outranks a count that is not a failure. It is that sixth occupant,
  // so the null rule above is now load-bearing for it — the container passes actual null when absent.
  return status.type === 'connected'
    ? recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null
    : null
}

export function ComposerHistoryFailure({ retryable, onRetry }: {
  retryable: boolean
  onRetry: () => void
}): JSX.Element {
  return <div className="stopped-turn-recovery" role="status">
    <span>Could not load older messages</span>
    {retryable && <button type="button" className="button-small button-small--error" onClick={onRetry}>Retry</button>}
  </div>
}

// The store-bound container for the slot (#963), collapsing #797's ComposerErrorChipControl and #167's
// RepairControl into one — they read the same slice for the same fact and now fill the same hole.
// Selects `status` (selectStatus) and `dispatch`, exactly the two RepairControl already read, so the
// re-render footprint narrows rather than grows: a status change re-renders this control and the
// composer, never the thread. A container rather than a `status` prop threaded down from
// ConversationScreen — that screen does not subscribe to sessionStore at all, and a read there would
// re-render the whole screen, timeline included, on every connection-status change.
//
// Repair delegates to the shell and preserves this host's saved credentials and held chats.
//
// #1435 threads ONE callback down and nothing else: this control already reads the open conversation for
// the usage reading, so the roster it needs is a store read here rather than a prop, and the panel the
// pill opens is the screen's own overlay — the same `setPanelOpen` the More actions item calls, so that
// entry point and the panel itself are untouched. #1634 adds the open reading the pill's outline needs.
function ComposerErrorSlotControl({
  onCommand,
  backgroundTasksOpen,
  onToggleBackgroundTasks,
  onOpenChannelInfo
}: {
  onCommand: (command: string) => boolean
  backgroundTasksOpen: boolean
  onToggleBackgroundTasks: () => void
  onOpenChannelInfo: () => void
}): JSX.Element | null {
  const status = useOpenConnectionStatus()
  const open = useActiveConversationStore(selectActiveConversation)
  // #1656: the stopping banner's prefix names this conversation's agent.
  const agent = useConversationAgent(open?.id ?? null)
  const rows = useConversationListStore(selectConversations)
  const historyHost = serverIdForOpenConversation(rows, open?.id ?? null)
  const historyFailure = useConversationTimelineStore(s =>
    selectHistoryFailure(open === null ? undefined : s.timelines.get(open.id), historyHost))
  const retryHistory = (): void => {
    if (open !== null && historyHost !== null && historyFailure !== null) {
      retryHistoryPage(historyRetryDeps, open, historyHost, historyFailure)
    }
  }
  // #1435: the open conversation's background-task count. `TopOverlayControl`'s usage read's shape, and
  // for the same reasons — a fresh selector identity per render costs a re-subscribe and never a
  // loop, because the selector returns a PRIMITIVE, so useSyncExternalStore's Object.is check
  // short-circuits even when another conversation's write produces a new outer map.
  //
  // #1561: the number is the LIVE count, `selectLiveTaskCountFor`, not the roster's size. The listed
  // tasks claude has not reported `completed` / `failed` / `stopped`, plus `droppedTasks` (the daemon
  // caps a roster at 8 rows and a dropped entry has no id to match a status against). A roster's size
  // alone kept the pill lit for a finished task whenever the emptier roster never came. The store owns
  // the arithmetic so any other surface counting live tasks cannot disagree with this one. Both "no
  // roster yet" and "nothing alive" read 0 and render no pill, a collapse this surface is entitled to
  // make where the panel is not.
  const taskCount = useBackgroundTaskRosterStore(
    open === null ? NO_TASK_COUNT : selectLiveTaskCountFor(open.id)
  )
  // #1494: the open conversation's first failed MCP server not yet acknowledged, as a primitive — the
  // task-count read's shape, with the same hoisted constant for the no-conversation arm.
  const mcpFailure = useMcpStatusStore(
    open === null ? NO_MCP_FAILURE : selectUnacknowledgedMcpFailureFor(open.id)
  )
  // Acknowledge every server the current report shows as failed, then open the sheet the way the
  // overflow menu does, status refresh included.
  const openMcpFailure = (): void => {
    if (open !== null) mcpStatusStore.getState().acknowledgeMcpFailures(open.id)
    onOpenChannelInfo()
  }
  const latest = useConversationTimelineStore((s) =>
    open === null ? undefined : s.timelines.get(open.id)?.timeline.latestTurnEnd
  )
  const stoppingBanner = useConversationTimelineStore((s) =>
    open === null ? undefined : s.timelines.get(open.id)?.timeline.stoppingBanner
  )
  const menu = useSlashCommandListStore((s) => open === null ? null : selectSlashCommandListFor(open.id)(s))
  const unavailable = markUnavailableActions(COMPOSER_ACTIONS, menu)
    .find((action) => action.id === '/compact')?.unavailable === true
  const stopped = latest !== undefined && stoppedTurnText(latest) !== null
  const contextOverflow = stopped && latest.terminalReason === 'prompt_too_long'
  let recoveryCopy: string | null = null
  if (contextOverflow) {
    recoveryCopy = 'Context too long. Compact or reset the session.'
  } else if (stopped && latest.errorCategory === 'billing_error') {
    recoveryCopy = 'Claude reported a billing error. Check Claude billing on this server.'
  } else if (stopped && latest.errorCategory === 'authentication_failed') {
    recoveryCopy = 'Claude reported an authentication failure. Check Claude sign-in on this server.'
  }
  const compact = (): void => {
    const current = selectActiveConversation(activeConversationStore.getState())
    if (current === null || current.id !== open?.id) return
    const currentMenu = selectSlashCommandListFor(current.id)(slashCommandListStore.getState())
    const action = markUnavailableActions(COMPOSER_ACTIONS, currentMenu)
      .find((entry) => entry.id === '/compact')
    if (action?.unavailable) return
    onCommand('/compact')
  }
  const settingsError = useRunSettingsWriteStore(selectError)
  const sessionId = useSessionIdStore(selectSessionId)
  const writes = useRunSettingsWriteStore(s => s)
  const offer = useConversationTimelineStore(s => open === null ? undefined : s.timelines.get(open.id)?.timeline.refusalOffer)
  // Navigation clears settings writes; the retained offer still owns an outstanding recovery.
  const modelPending = offer?.changeId !== undefined || [...writes.pending.values()].some(change => change.field === 'model')
  const switchBack = (): void => {
    const currentId = activeConversationStore.getState().activeConversation?.id
    const currentOffer = currentId === undefined ? undefined : conversationTimelineStore.getState().timelines.get(currentId)?.timeline.refusalOffer
    const currentSession = sessionIdStore.getState().sessionId
    const currentWrites = runSettingsWriteStore.getState()
    const serverId = serverIdForOpenConversation(selectConversations(conversationListStore.getState()), currentId ?? null)
    if (currentId === undefined || currentId !== open?.id || !offer || currentOffer !== offer || currentOffer.changeId !== undefined ||
        serverId === null || sessionStore.getState().statuses.get(serverId)?.type !== 'connected' || !isAddressableSessionId(currentSession) ||
        [...currentWrites.pending.values()].some(change => change.field === 'model')) return
    changeSetting({ sessionId: currentSession, sendCommand: window.pyry.sendCommand,
      dispatch: event => {
        if (event.type === 'changeDispatched') {
          conversationTimelineStore.getState().dispatchFor(currentId, { type: 'refusalWriteStarted', offer, changeId: event.changeId })
          window.pyry.sendDiagnostic({ event: 'refusal-recovery', code: 'dispatched' })
        }
        currentWrites.dispatch(event)
      }
    }, { field: 'model', value: offer.report.originalModel })
  }

  const handleReconnect = async (): Promise<void> => {
    const open = selectActiveConversation(activeConversationStore.getState())
    const serverId = serverIdForOpenConversation(
      selectConversations(conversationListStore.getState()),
      open === null ? null : open.id
    )
    if (serverId === null) return
    try {
      await window.pyry.reconnectServer(serverId)
    } catch {
      window.pyry.sendDiagnostic({ event: 'composer-reconnect-failed', code: 'bridge-rejected' })
    }
  }

  return (
    <ComposerErrorSlot
      status={status}
      onReconnect={handleReconnect}
      recovery={recoveryCopy === null ? null : (
        <div className="stopped-turn-recovery" role="status">
          <span>{recoveryCopy}</span>
          {contextOverflow && (
            <button type="button" className="button-small button-small--error"
              disabled={unavailable} onClick={compact}>Compact</button>
          )}
        </div>
      )}
      refusal={offer && isAddressableSessionId(sessionId) ? (
        <div className="model-refusal-recovery">
          {(offer.rejected || settingsError === 'model') && (
            <div className="composer-status__error composer-status__error--settings" role="alert">
              Could not change the model — try again.
            </div>
          )}
          <button type="button" className="button-small button-small--error" disabled={modelPending}
            onClick={switchBack}>Switch back</button>
        </div>
      ) : null}
      notice={
        settingsError === 'model' ? (
          <div className="composer-status__error composer-status__error--settings" role="alert">
            Could not change the model — try again.
          </div>
        ) : (
          stoppingBanner !== undefined ? <ComposerBannerReport report={stoppingBanner} agent={agent} /> : null
        )
      }
      history={historyFailure === null ? null :
        <ComposerHistoryFailure retryable={historyFailure.retryable} onRetry={retryHistory} />}
      mcpFailure={mcpFailure === null ? null : <ComposerMcpFailure name={mcpFailure} onOpen={openMcpFailure} />}
      /* The count is checked HERE and not left to the view's own guard: `??` tests the element, not what
         it renders, so an unconditionally constructed pill would occupy the slot at a zero count — the
         `historyFailure === null` line above exists for exactly this reason. The view guards too, which
         is what makes it total and its absent arm assertable. */
      taskCount={taskCount === 0 ? null :
        <ComposerTaskCount count={taskCount} open={backgroundTasksOpen} onToggle={onToggleBackgroundTasks} />}
    />
  )
}

// #1604: the store-bound container for the conversation's Top overlay — the usage-limit reading and the
// pairing-error Re-pair, moved out of the composer slot so neither waits behind the slot's other
// occupants. A sibling leaf of the thread, so its reads (usage, dismissal, connection status) re-render
// this control and never the timeline.
//
// The usage read is #1321's, moved verbatim. THE CLOCK IS READ AT RENDER AND NOTHING IS SCHEDULED FROM
// `resetsAt`: expiry is the one comparison inside `selectUsageLimitFor`, so an expired reading leaves on
// the next render rather than on a tick. `Math.floor(Date.now() / 1000)` is UNIX SECONDS, the unit that
// selector and `usageLimitNotice` take — milliseconds would expire every reading on arrival. A fresh
// selector identity per render costs a re-subscribe, never a loop: the selector returns the held record
// or `null`, both stable references.
//
// UNLIKE THE SLOT, NO CONNECTION GATE ON THE READING: an account's quota does not change when a socket
// drops, and the move exists so the warning stops waiting behind other readings.
//
// Repair resolves the host from the stores at CLICK time and delegates to the shell, preserving this
// host's saved credentials and held chats — the slot's former `handleRepair`, moved.
function TopOverlayControl({ onRepairHost }: {
  onRepairHost?: (serverId: string) => void
}): JSX.Element | null {
  const status = useOpenConnectionStatus()
  const open = useActiveConversationStore(selectActiveConversation)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const usageLimit = useUsageLimitStore(
    open === null ? NO_USAGE_LIMIT_READING : selectUsageLimitFor(open.id, nowSeconds)
  )
  const dismissed = useUsagePillDismissalStore(s => s.dismissed)
  const handleRepair = (): void => {
    const current = selectActiveConversation(activeConversationStore.getState())
    const serverId = serverIdForOpenConversation(
      selectConversations(conversationListStore.getState()),
      current === null ? null : current.id
    )
    if (serverId !== null) onRepairHost?.(serverId)
  }
  return (
    <TopOverlay
      reading={usageLimit}
      nowSeconds={nowSeconds}
      dismissed={dismissed}
      repair={shouldOfferRepair(status)}
      onDismissUsage={reading => usagePillDismissalStore.getState().dismiss(reading)}
      onRepair={handleRepair}
    />
  )
}

// #1321: the selector for "no conversation is open", hoisted to module scope so its identity is STABLE.
// Built inline it would be a fresh function every render on that arm, which useSyncExternalStore answers
// with a re-subscribe per render for a value that is always the same `null`. Typed against the state-only
// interface, exactly as `selectUsageLimitFor`'s return is.
const NO_USAGE_LIMIT_READING = (): UsageLimitReading | null => null

// #1435: the same constant for the task-count read beside it, hoisted for the same reason — built inline
// it would be a fresh function every render on the no-conversation-open arm, which useSyncExternalStore
// answers with a re-subscribe per render for a value that is always the same `0` (#1561).
const NO_TASK_COUNT = (): number => 0

// #1494: the same constant for the MCP failure read, hoisted for the same reason.
const NO_MCP_FAILURE = (): string | null => null

// #811: the context-window reading, first occupant of the composer footer row (Figma 110:3497,
// "Context: 84%"). The percentage USED, not remaining. Its arithmetic is contextUsagePercent —
// deliberately the SAME function the run-configuration sheet's gauge calls, so the two surfaces cannot
// disagree about either the number or whether there is one to show.
//
// Returns null exactly when contextUsagePercent does, and returns NULL rather than an empty element: the
// slot is not held by an empty node, the ROW's own height is what holds it (AC2/AC4). That is the
// ComposerErrorChip posture one row lower.
//
// A <span>, not a <p>: the row sets a hard height and this repo ships no global box-sizing/margin reset,
// so a <p>'s UA margin is a live layout hazard against AC4 for no semantic gain (the ComposerErrorChip
// ruling above, verbatim).
//
// NOTHING beyond className — no onClick, no tabIndex, no role, no title, no href. That is AC3 ("a
// reading, not a control"), and it is structural: the emitted markup is short enough that the test pins
// it EXACTLY, so nothing can be added here without a failing assertion.
//
// NO LIVE REGION — no role="status", no aria-live. The ComposerErrorChip ruling applies and is stronger
// here: since #810 these figures refresh on every connect and every turn end, so a polite region would
// announce a percentage after every turn.
//
// A SINGLE text run, one template literal — not `Context: {pct}%` split across JSX children. The
// .composer-status__label discipline: one run has one predictable serialisation, which is what makes the
// exact-markup assertion stable. The prefix is a client-owned literal and the only interpolated value is
// an integer in [0, 100], so no daemon-supplied STRING reaches this surface at all — there is nothing to
// escape and nothing to length-bound. No copy constant for an 18-character string with one call site: the
// module's copy constants exist for strings asserted across files or that must be provably free of
// daemon text, and neither applies.
//
// #1062 — THE SEVERITY LADDER. The colour is emphasis on a fact the reader can already read, so the
// arithmetic stays where it was and only the presentation branches. Two derived values, both from
// contextUsageStep (the boundaries live there as values, never here as inline conditionals):
//
//   CLASS. The base token stays LEADING and the modifier is APPENDED, never swapped in — six assertions
//   in this file's footer-order describes locate the reading by `composer__context` as a substring, and
//   all of them survive a suffix. The primary arm emits the bare class, byte-identical to the markup
//   this component shipped before #1062: the step that means "nothing to see" must not move at all.
//
//   TEXT. The word rides the TOP step alone. Below 70% the percentage is already legible as text, so
//   amber is emphasis and WCAG 1.4.1 is satisfied without a second channel; at 70% the message becomes
//   actionable ("you are running out"), which is the one step where a reader who cannot separate amber
//   from the row's blue would lose something real. A WORD, not a glyph: a glyph inside a text run cannot
//   be hidden from a screen reader. NOT an aria-label — name-from-author is not supported on a generic
//   role — and still no live region, for the reason stated above.
//
// The copy stays HERE rather than in contextUsage.ts: that module maps a number to a step, and the step
// is a role, not a string. Everything the ruling above forbids is still forbidden and still structural —
// the three renderings are each pinned as exact markup, so nothing can be added to any of them silently.
export function ContextUsageReading({
  usedTokens,
  windowTokens
}: {
  usedTokens: number
  windowTokens: number
}): JSX.Element | null {
  const pct = contextUsagePercent(usedTokens, windowTokens)
  if (pct === null) return null
  const step = contextUsageStep(pct)
  const className =
    step === 'primary' ? 'composer__context' : `composer__context composer__context--${step}`
  const label = step === 'error' ? `Context high: ${pct}%` : `Context: ${pct}%`
  return <span className={className}>{label}</span>
}

// The store-bound container for the reading (#811) — the ComposerErrorChipControl shape. A container
// rather than a prop threaded down from Composer or ConversationScreen: Composer already subscribes to
// four stores, and adding a fifth read for a figure that now ticks on every turn end (#810) would
// re-render the textarea and the send button on every tick; ConversationScreen would re-render the whole
// screen, timeline included.
//
// ONE selectSnapshot read, not two narrow field selectors. Both figures come out of the same object in
// the same render pass, so the numerator and denominator can never be read from different store ticks —
// two selectors could tear across an update and produce a percentage of two unrelated snapshots. The
// null coalescing is RunConfigSections' verbatim (`snapshot?.usedTokens ?? 0`), so a not-yet-loaded store
// and the daemon's window_tokens: 0 "usage unavailable" signal collapse into one branch on both surfaces.
// No window.pyry dereference and no effects — a pure read, server-renderable with no bridge mock.
//
// #1421 — CLAUDE'S OWN READING IS THE SOURCE, the settings pair the fallback. The transcript scan behind
// the snapshot reads 0% for any conversation opened in a workspace and guesses the window until a turn
// ends; claude's figure is right for every conversation and matches what the terminal shows. Which pair
// wins is decided by contextTokenSource, deliberately the SAME function the run-configuration sheet's
// gauge calls — so the two surfaces cannot disagree for one conversation, which is this ticket, exactly as
// sharing contextUsagePercent is what stopped them disagreeing about the arithmetic at #811.
//
// The fallback fires on an ABSENT reading only, never on a present one: see contextTokenSource, where the
// only branch is `=== null`. A present reading whose maximum is zero therefore still wins and resolves to
// the null this control already returns for an unavailable reading — not to the transcript figure.
//
// `conversationId` is a PROP, not a fifth store read: `activeConversationId` is already in scope at the
// composer__footer row and every sibling control in it takes that prop. A useMemo-stable selector per id
// (the RunConfigSections idiom), because a fresh closure each render would churn the subscription; the
// null-conversation arm selects nothing THROUGH THE SAME PATH, with no invented key and no second branch.
// The selector hands back the HELD RECORD ITSELF or `null`, both stable references, so a reading published
// for another conversation leaves this one Object.is-identical and does not re-render the footer.
//
// Claude's own `percentage` field is held by the store and deliberately NOT read here: the reading keeps
// going through contextUsagePercent, computed from the total and the maximum, so the clamp, the finiteness
// guard and the severity ladder stay the one computation across both surfaces. The wire contract says the
// opposite — that a client recomputing disagrees with the figure claude reported — and #1421 recomputes
// anyway, on purpose. Do not flip this on reading ContextUsagePayload's docblock; raise it on the issue.
//
// #1254 — the reading is the trigger of a breakdown popover. The span above stays inert and byte-identical;
// ContextBreakdownPopover wraps it in the button. The popover gets `reported` alone, never the settings
// snapshot: on the fallback arm it is `null` and the panel says a reading arrives after the next turn. No
// trigger renders when there is no percentage to show, exactly as the reading rendered nothing before.
function ContextUsageControl({ conversationId }: { conversationId: string | null }): JSX.Element | null {
  const snapshot = useRunConfigStore(selectSnapshot)
  const selectReported = useMemo(
    () => (conversationId === null ? () => null : selectReportedContextFor(conversationId)),
    [conversationId]
  )
  const reported = useReportedContextStore(selectReported)
  const tokens = contextTokenSource(reported, snapshot)
  if (contextUsagePercent(tokens.usedTokens, tokens.windowTokens) === null) return null
  const reading = <ContextUsageReading usedTokens={tokens.usedTokens} windowTokens={tokens.windowTokens} />
  // #1655: a session with no context-usage breakdown (a Codex session) keeps the reading but not the
  // button — the panel would say a reading arrives after the next turn, forever.
  if (!sessionSupports(snapshot, 'contextUsageDetail')) return reading
  return <ContextBreakdownPopover reading={reported}>{reading}</ContextBreakdownPopover>
}

// #330: the two-dot Relay/Pyrycode connection-status indicator — the persistent at-a-glance state that
// complements the failure-only ConnectionBanner (#279). Two legs read independently: the relay-socket leg
// (relayLinkStore, #329) and the daemon-session leg (sessionStore's ConnectionStatus). Mirrors mobile's
// ConnectionStatusLine (mobile #397/#398): each leg shows its own honest state so "relay up, daemon still
// handshaking" is expressible rather than a single false "connected".

// A leg's coarse display category. The dot colour is driven ONLY by this (success / warning / error, plus
// #719's neutral `unknown`); the visible status word rides `label`, so status is legible without colour
// perception (AC2). `unknown` is the relay leg's alone — see relayLeg and daemonLeg below.
export type LegCategory = 'up' | 'in-progress' | 'down' | 'unknown'

// One rendered leg: its category (→ dot colour) and its full visible label (leg name + status word). The
// leg name is baked into the label so the pure view stays dumb — a coloured dot plus the label, nothing
// else — and no daemon-status value ever chooses the leg name.
export interface ConnectionLeg {
  category: LegCategory
  label: string
}

// The relay-link leg mapping (#329's RelayLinkStatus | null → a ConnectionLeg). `daemon-absent` reads
// up/"Reachable" — the relay IS reachable; the missing daemon is the daemon leg's story, not a relay
// failure (mobile's DaemonAbsent → green "Reachable", AC4). `null` is the "no status has arrived yet"
// sentinel — definitionally none of the three the wire delivers — and since #719 it maps to its own
// `unknown` category rather than being collapsed into `down` as #330's AC1 had it. "Not known yet" and
// "known to be down" are different facts, and since #718 put these dots on the sidebar (on screen from the
// first frame of every launch) the collapse made every cold start open by claiming an outage. Still NOT
// in-progress: the relay leg has no in-progress arm (that category is the daemon leg's `connecting`), and
// nothing is probing — this state is the absence of information, not an attempt to get it.
// Independent of daemonLeg — the two never cross-reference (AC4). The `null` guard stays AHEAD of the
// switch so the switch keeps operating on a plain RelayLinkStatus: explicit return type + no `default`
// means a future RelayLinkStatus member still trips TS2366 (the exhaustive-switch guard, #719 AC4).
export function relayLeg(status: RelayLinkStatus | null): ConnectionLeg {
  if (status === null) return { category: 'unknown', label: 'Relay Unknown' }
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
// It never produces `unknown`: ConnectionStatus starts at `disconnected` and has no null, so it has no
// not-yet-known state to report — that widened member is the relay leg's alone (#719 AC3).
export function daemonLeg(status: ConnectionStatus): ConnectionLeg {
  switch (status.type) {
    case 'connected':
      return { category: 'up', label: 'Pyrycode Connected' }
    case 'connecting':
      return { category: 'in-progress', label: 'Pyrycode Connecting' }
    case 'disconnected':
      return { category: 'down', label: 'Pyrycode Offline' }
    case 'error':
      return { category: 'down', label: status.error.code === 'pairing-rejected'
        ? 'Pyrycode Pairing rejected' : 'Pyrycode Offline' }
  }
}

// #962 retired #330's two-dot indicator — the pure `ConnectionStatusIndicator` view and its store-bound
// container — along with the status row that hosted it. The dots have been on the sidebar host row since
// #718 (`HostConnectionDots` in ChannelList.tsx), which reads the two legs through the same narrow
// selectors this container used and renders them in the design's reversed order. The three mappings
// above are what SURVIVE the deletion: `ChannelList.tsx` imports `relayLeg`, `daemonLeg` and
// `ConnectionLeg`, and the leg → category → label matrix is still proven on them directly. The four
// `.conn-dot--*` colour bindings moved to `channels.css` beside `.channel-list__host-dot` rather than
// dying with the row's stylesheet block, since the sidebar wears them without the `.conn-dot` base.

// #1064 DELETED #140's LEADING BACK AFFORDANCE — an `aria-label="Back"` button holding the 24px
// arrow_back glyph (Figma 16-9 → 16-11), rendered as the first child of `.conversation`. It was the
// mobile chat screen's leading control, ported when the app showed one screen at a time. Since #670 the
// sidebar is permanently mounted beside the thread, so the list it "returned to" was already on screen
// and the arrow's real job had become DESELECT: flip the shell's route from `thread` to `list`, emptying
// the right pane and leaving the sidebar exactly as it was. The desktop drawing's `Content` frame
// (Figma 106:3321) has no leading affordance above the thread at all. Operator call, 2026-09-04.
//
// The empty pane is not what went — it is still reachable three ways, all landing on route `list`
// (`back` is absolute in `nextPairedRoute`): the shell enters at `list`, Settings and Archive return
// there through their own back controls, and the delete and archive exits dispatch `back` too. What is
// gone is the way back to it FROM the open thread, which is the point.
//
// `onBack` deliberately SURVIVES the control it was named for: it is the screen's "am I mounted in the
// paired shell" signal, and the overflow menu above is gated on it. The header row this control led is
// also staying — #1061 deleted the bare row and Juhana will draw its replacement, carrying a channel
// title and a channel settings button. #1444 ended the interim this note used to describe: the overflow
// trigger no longer floats over the thread's top-right corner but sits in the card's drawn top bar, and
// the thread starts at the drawn 97 from the card's top edge rather than "higher by the deleted control".
// The back affordance itself stays deleted: no padding, spacer or reserved band holds its old offset.

// The title and divider retain the top-bar layout. Only the shared menu's trigger anchor owns
// outside-click containment, so clicking the adjacent title still dismisses the menu.
function ThreadOverflowMenu({
  name,
  onChannelInfo,
  onRunConfiguration,
  onBackgroundTasks
}: {
  name: string
  onChannelInfo: () => void
  onRunConfiguration: () => void
  onBackgroundTasks: () => void
}): JSX.Element {
  const actions = [
    { id: 'channel-info', label: 'Channel info', onSelect: onChannelInfo },
    { id: 'run-configuration', label: 'Run configuration', onSelect: onRunConfiguration },
    { id: 'background-tasks', label: 'Background tasks', onSelect: onBackgroundTasks }
  ]
  return (
    <div className="conversation__overflow">
      <div className="conversation__overflow-content">
        <p className="conversation__overflow-title">{name}</p>
        <ComposerOptionsMenu
          options={actions}
          currentId={null}
          onSelect={(id) => actions.find((action) => action.id === id)?.onSelect()}
          ariaLabel="More actions"
          triggerAriaLabel="More actions"
          triggerClassName="conversation__overflow-trigger"
          placement="bottom-end"
          triggerContent={
            <svg
              className="conversation__overflow-icon"
              viewBox="0 0 6 24"
              width="6"
              height="24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3 6C1.34464 6 0 4.65536 0 3C0 1.34464 1.34464 0 3 0C4.65536 0 6 1.34464 6 3C6 4.65536 4.65536 6 3 6ZM3 18C4.65536 18 6 19.3446 6 21C6 22.6554 4.65536 24 3 24C1.34464 24 0 22.6554 0 21C0 19.3446 1.34464 18 3 18ZM6 12C6 13.6554 4.65536 15 3 15C1.34464 15 0 13.6554 0 12C0 10.3446 1.34464 9 3 9C4.65536 9 6 10.3446 6 12Z" />
            </svg>
          }
        />
      </div>
      <div className="conversation__overflow-rule" />
    </div>
  )
}
