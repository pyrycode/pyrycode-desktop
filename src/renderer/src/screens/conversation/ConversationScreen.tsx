import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import './conversation.css'
import type { Message } from './messageViewModel'
import type { QueuedItem, ConversationCreatedPayload } from '@shared/wire/types'
import { useSessionStore, selectStatus, type ConnectionStatus } from '../../store/sessionStore'
import { useTimelineStore, selectItems, selectPhase, selectStalled } from '../../store/timelineStore'
import { useQueueStore, selectBacklogFor } from '../../store/queueStore'
import {
  useActiveConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'
import type { ThreadItem, TurnPhase } from '../../store/threadTimeline'
import {
  submitMessage,
  composerAvailability,
  shouldOfferRepair,
  shouldShowBanner,
  CONNECTION_BANNER_COPY,
  MILESTONE_CONVERSATION_ID
} from './composerSend'
import { runUnpair } from './unpairAction'
import { dropQueuedMessage } from './dropQueuedMessage'
import { sendInterrupt } from './sendInterrupt'
import { requestScreenSnapshot } from './requestScreenSnapshot'
import {
  useScreenSnapshotStore,
  selectScreenSnapshot,
  type ScreenSnapshot
} from '../../store/screenSnapshotStore'
import { RunConfigData } from './RunConfigData'
import { RunConfigSections } from './RunConfigSections'
import { LogDataSection } from './LogDataSection'
import { PermissionModal } from './PermissionModal'
import { sessionBoundaryTitle } from './sessionBoundaryViewModel'

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
  // #276→#155: the overflow menu's Channel-info item invokes this. Optional and absent this ticket, so
  // selecting the item just closes the menu (a live no-op); #155 passes it from PairedShell to open the
  // Channel Info sheet (Figma 20-48). The same optional-callback seam as WorkspaceChip's onChange? (#278).
  onChannelInfo?: () => void
}

export function ConversationScreen({
  onUnpaired,
  onBack,
  onChannelInfo
}: ConversationScreenProps = {}): JSX.Element {
  // #179: the structured-stream timeline slice is now the single thread surface — the coarse
  // `MessageThread` is retired (its mount + the `selectMessages` read are gone), and the composer's
  // optimistic echo routes here as a `userText` item beside the daemon's structured reply. `ThreadItem`
  // is already the render model (ADR 0008, camelCase, conversation_id-free) so it flows straight to the
  // pure Timeline view — no adapter. Selecting only the items slice keeps a stream delta from
  // re-rendering unrelated facets.
  const items = useTimelineStore(selectItems)
  // #215: the coarse `phase` scalar, read beside the items slice (mirrors the selectItems → Timeline
  // line above). The container derives the `isThinking` boolean and passes only that down, so no
  // daemon-supplied string reaches the view (AC3 is a type-level guarantee, not a convention).
  // Selecting only `phase` adds no meaningful churn — the container already re-renders per items delta.
  // Inert in production until #179 flips `interactive` (phase stays `idle`), so the indicator is null.
  const phase = useTimelineStore(selectPhase)
  // #317: the coarse `stalled` scalar, read beside `phase` (the selectPhase line above). The container
  // passes only the plain boolean down, so no daemon-supplied string reaches the view — AC4 is a
  // type-level guarantee, and the stall frame carries no daemon content anyway. `stalled` flips at most
  // twice per stall, so it adds no meaningful re-render churn beyond the items delta already here.
  const stalled = useTimelineStore(selectStalled)
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
  // #286: the render-time clock for the session-boundary delimiter's relative time (`2 hours ago`).
  // A plain render-local value, not store state (the ChannelList precedent) — safe under
  // renderToStaticMarkup, adds no subscription, and re-derives on each render so the label stays fresh.
  const now = Date.now()
  return (
    <div className="conversation">
      <BackControl onBack={onBack} />
      {/* #276: the trailing overflow menu (Figma 16-16) — the single entry point to per-conversation
          actions, opening the Channel Info sheet first (#155). Gated on onBack presence, the established
          "mounted in the paired shell" signal (BackControl's gate): a bare `<ConversationScreen />` shows
          neither. Gated at the mount site, not self-gated, so ThreadOverflowMenu's hooks stay
          unconditional (rules-of-hooks). */}
      {onBack && <ThreadOverflowMenu onChannelInfo={onChannelInfo} />}
      <UnpairControl onUnpaired={onUnpaired} />
      {/* #279: the prominent, disconnected-only connection banner — the top of the thread, below the
          header row and above the message list. A third read of the connection status, distinct from
          the composer's terse inline gate below. */}
      <ConnectionBannerControl />
      {/* #278: the pre-first-message workspace chip — a sibling above Timeline, not nested inside
          EmptyThread, so Timeline's { items, now } contract stays untouched (no prop cascade). It
          self-gates to null unless the thread is empty and shows an unpromoted (discussion) conversation. */}
      <WorkspaceChip conversation={activeConversation} isEmpty={items.length === 0} />
      <Timeline items={items} now={now} />
      <ThinkingIndicator isThinking={phase === 'thinking'} />
      {/* #317: the stalled-turn problem-state indicator — a sibling of the thinking indicator in the
          message-list region. Shows on a daemon stall onset and self-clears (in the reducer) on the next
          turn activity. Renders nothing at rest. */}
      <StallIndicator isStalled={stalled} />
      {/* #294: the held queued backlog — the not-yet-run tail below the delivered thread and the
          working indicator, above the run-config row and composer. Renders nothing when empty. */}
      <QueuedBacklogControl />
      <StatusRow onExpand={() => setSheetOpen(true)} />
      {/* #324: the screen-snapshot action & display — a request button (gated on the same connection read
          the composer's send-gate uses) plus a bounded <pre> panel showing the held daemon screen text
          (#323's store). Always visible (button + placeholder-or-<pre>); the <pre> is CSS-bounded so a large
          screen dump scrolls internally rather than shoving the composer off-screen. */}
      <ScreenSnapshotControl />
      {/* #307: the running-turn interrupt control — a standalone block, right-aligned over the
          composer's send side, shown only while a turn is running (phase thinking or responding) and
          retracting on the daemon's turn_state{idle}. Renders nothing at idle. */}
      <InterruptControl />
      <Composer />
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
      {/* #224: the interactive permission/trust modal — the last child so it overlays the whole
          conversation surface (the StatusSheet placement). Renders null until an outstanding prompt
          exists, so the layout is unchanged today (inert until #179 flips `interactive`). */}
      <PermissionModal />
    </div>
  )
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
export function Timeline({
  items,
  now = Date.now()
}: {
  items: readonly ThreadItem[]
  now?: number
}): JSX.Element {
  if (items.length === 0) return <EmptyThread />
  const lastIndex = items.length - 1
  return (
    <div className="conversation__thread">
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
// over the five kinds (only turnBoundary null), so a future sixth ThreadItem kind makes it
// non-exhaustive → a compile-time "not all code paths return" error that forces a render decision —
// while a structural-only kind (turnBoundary) still degrades to nothing rather than throwing.
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
    case 'assistantText':
      return (
        <div className="message-row message-row--daemon">
          {/* Text passed as React children (auto-escaped) — never dangerouslySetInnerHTML — so HTML
              inside a delta renders as visible characters, discharging #199's untrusted-text handoff. */}
          <div className="bubble bubble--daemon" data-thread-role="assistant">
            {item.text}
            {/* The streaming cursor (Figma 16:56, ▎ U+258E): a trailing inline visual on the
                in-progress bubble's text run, inheriting the bubble's color/size. Derived structurally
                (the tail, still-open assistantText), never from `phase` (which has no source until
                #204). Decorative → aria-hidden. */}
            {inProgress && (
              <span className="bubble__cursor" aria-hidden="true">
                ▎
              </span>
            )}
          </div>
        </div>
      )
    case 'toolCall': {
      // #218: the tool row (Figma node 16-28) — a compact chip, not a message bubble, so
      // data-thread-role="tool" (not "assistant") keeps it out of the daemon bubble count. `name` and
      // `inputSummary` are untrusted daemon strings rendered as inert React children (auto-escaped) —
      // never dangerouslySetInnerHTML, no markup/path interpretation — the assistantText posture above.
      // `toolUseId` stays on the item as #121's correlation key, never a React key here (Timeline keys
      // by array index).
      //
      // #230: the row resolves in place when `result` fills. Only the wrapper className varies with
      // `item.result` (narrowed to ToolResult | null by this case) — the chip's inner markup is
      // unchanged, so `resultSummary` is NOT surfaced (the Figma mock has no result-text slot; the
      // not-pending + isError signals satisfy the story), keeping the untrusted surface at today's two
      // fields. `tool-row--resolved` iff resolved (lifts .tool-row's 50% pending dimming, both
      // outcomes); `tool-row--error` on top iff `result.isError` (the error accent). See conversation.css.
      const { result } = item
      const rowClass = result
        ? `tool-row tool-row--resolved${result.isError ? ' tool-row--error' : ''}`
        : 'tool-row'
      return (
        <div className={rowClass}>
          <div className="tool-row__chip" data-thread-role="tool">
            <span className="tool-row__name">{item.name}</span>
            <span className="tool-row__summary">{item.inputSummary}</span>
          </div>
        </div>
      )
    }
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

// #215: the thinking indicator — Timeline's twin over the coarse `phase` scalar rather than the
// items list. The daemon opens a turn with `turn_state{thinking}` before any assistant_delta
// (pyrycode #632), so during that window there are no timeline items and the thread shows nothing;
// this affordance covers "the daemon is working, no text yet" — distinct from #203's streaming cursor
// (which covers text already arriving on an assistantText tail). Pure props-in/markup-out and exported
// so tests server-render an injected boolean with no store.
//
// Takes `isThinking: boolean`, NOT `phase: TurnPhase` — the boolean makes AC3 ("no daemon-supplied
// string is rendered") a type-level guarantee: the view structurally cannot render a daemon string
// because it never receives one. The container does the trivial `phase === 'thinking'` derivation.
// The visible label is a client-owned constant, not `phase`. A plain boolean guard (no switch /
// assertNever — there is no union to discriminate).
//
// isThinking false → null (zero layout footprint, AC2 — exactly like Timeline returning null on an
// empty list); the interim treatment reuses the daemon-bubble surface with muted text (a transient
// affordance), pending the deferred desktop-design pass (the mobile Figma has no thinking node).
export function ThinkingIndicator({ isThinking }: { isThinking: boolean }): JSX.Element | null {
  if (!isThinking) return null
  return (
    <div className="conversation__thinking">
      <div className="bubble bubble--daemon bubble--thinking">Thinking…</div>
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

// #324: the client-owned request-button label (the EMPTY_THREAD_COPY / INTERRUPT_LABEL idiom). The button
// carries visible text, so this string IS its accessible name — never a daemon string. A single static
// label covers both the initial request and a later re-request (a "refresh"); a snapshot-aware label swap
// is optional polish, not an AC.
const SCREEN_SNAPSHOT_REQUEST_LABEL = 'Show daemon screen'

// #324: the "no snapshot received yet" placeholder copy (the EMPTY_THREAD_COPY idiom) — module-level and
// client-owned, apostrophe-free (renderToStaticMarkup escapes `'`), never a daemon string. Distinct from a
// received blank screen: this shows only while the store holds `null`; a received `{ text: '', ts }` renders
// an empty <pre> instead (AC3).
const SCREEN_SNAPSHOT_EMPTY_COPY = 'No screen snapshot yet'

// #324: the screen-snapshot action & display — one surface (the request button + the display region),
// bundled as a single pure view because action + display ship as one `s` (a request button with nothing to
// render is dead UI; a display with no trigger only shows unsolicited pushes). Pure props-in/markup-out and
// exported so tests server-render it with injected props (no store), the InterruptButton posture.
//
// Takes `snapshot: ScreenSnapshot | null` (null = no screen received yet), `canRequest: boolean` (the
// connection gate the container derives from composerAvailability — the SAME send-gate read the composer
// uses, AC2), and a REQUIRED injected `onRequest` effect (the "a view that cannot act is a bug" rule) — the
// container binds it to requestScreenSnapshot; the view never touches window.pyry.
//
// AC4 — the untrusted-text sink: `snapshot.text` is daemon-relayed content rendered as AUTO-ESCAPED React
// children inside the <pre> (`{snapshot.text}`), never dangerouslySetInnerHTML / innerHTML. Any terminal
// control sequences or HTML render as literal characters — the assistantText / toolCall / workspaceCwd
// posture already in this file. The <pre> gives monospace + whitespace preservation (a terminal screen);
// ANSI-to-styling is explicitly out of scope (a separate fidelity follow-up). The display region is
// discriminated on the null-vs-value distinction so "no snapshot yet" (the placeholder, no <pre>) is
// structurally distinct from a received blank screen (an empty <pre>, no placeholder) — AC3.
export function ScreenSnapshotView({
  snapshot,
  canRequest,
  onRequest
}: {
  snapshot: ScreenSnapshot | null
  canRequest: boolean
  onRequest: () => void
}): JSX.Element {
  return (
    <div className="screen-snapshot">
      <button
        type="button"
        className="screen-snapshot__request"
        disabled={!canRequest}
        onClick={onRequest}
      >
        {SCREEN_SNAPSHOT_REQUEST_LABEL}
      </button>
      {snapshot === null ? (
        <p className="screen-snapshot__empty">{SCREEN_SNAPSHOT_EMPTY_COPY}</p>
      ) : (
        <pre className="screen-snapshot__screen">{snapshot.text}</pre>
      )}
    </div>
  )
}

// #324: the store-bound container for the screen-snapshot control. Reads the connection status (for the
// gate) and the held screen snapshot (#323's store), binds the injected request effect, and mounts the pure
// view. Two narrow-slice reads, both orthogonal to the timeline, so this re-renders only on a connection
// change or a new snapshot (AC3 reactivity is free — #323's setSnapshot replaces the object, most-recent
// wins). window.pyry.sendCommand is dereferenced ONLY inside the onRequest click closure (the
// InterruptControl / Composer.handleSubmit discipline), so the server-rendered container smoke never touches
// the bridge. In-file and not exported, like InterruptControl. No new store, no new bridge, no daemon-event
// re-subscription — #323 already populates the store app-wide; this only reads it.
function ScreenSnapshotControl(): JSX.Element {
  const status = useSessionStore(selectStatus)
  const snapshot = useScreenSnapshotStore(selectScreenSnapshot)
  return (
    <ScreenSnapshotView
      snapshot={snapshot}
      canRequest={composerAvailability(status).canSend}
      onRequest={() => requestScreenSnapshot({ sendCommand: window.pyry.sendCommand })}
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

// The store-bound container for the queued backlog (#294). Reads the single active conversation's
// backlog under MILESTONE_CONVERSATION_ID (the constant the composer sends under; no nav plumbing to
// thread a conversation id — that is a separate future concern). The selector is hoisted to module
// scope so it is created once; because selectBacklogFor returns the same array reference (or the stable
// EMPTY_BACKLOG) for a given id, a snapshot for a DIFFERENT conversation is Object.is-stable here → no
// re-render churn (AC3 free-of-noise). A pure store read — no window.pyry, no IPC, no effects (AC5).
//
// #296: binds onDrop to the pure dropQueuedMessage helper, supplying MILESTONE_CONVERSATION_ID (the
// conversation-id wall — the row has none). window.pyry.sendCommand is dereferenced ONLY inside the
// click closure (interaction time, never render — the Composer.handleSubmit / PermissionModal
// discipline), so the empty-backlog container smoke test stays bridge-free. No optimistic mutation: the
// helper only sends (AC3); the dropped row leaves on the next queue_state snapshot via this subscription.
const selectMilestoneBacklog = selectBacklogFor(MILESTONE_CONVERSATION_ID)

function QueuedBacklogControl(): JSX.Element | null {
  const items = useQueueStore(selectMilestoneBacklog)
  return (
    <QueuedBacklog
      items={items}
      onDrop={(queuedMsgId) =>
        dropQueuedMessage(MILESTONE_CONVERSATION_ID, queuedMsgId, {
          sendCommand: window.pyry.sendCommand
        })
      }
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
      {/* The live summary region, intentionally empty in this shell (#181/#182 populate it). */}
      <span className="status-row__summary" />
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

function Composer(): JSX.Element {
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

  const handleSubmit = (): void => {
    // AC1: the authoritative gate. Return before touching submitMessage so no sendCommand and no
    // optimistic echo fire while not connected — this blocks the Enter path (handleKeyDown) as well
    // as the button. The input is not cleared; nothing was sent.
    if (!canSend) return
    // `window.pyry` is dereferenced only here, at interaction time — never during render — so the
    // server-rendered container smoke test never touches the bridge.
    const sent = submitMessage(text, {
      sendCommand: window.pyry.sendCommand,
      dispatch,
      newMessageId: () => crypto.randomUUID()
    })
    if (sent) setText('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
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
