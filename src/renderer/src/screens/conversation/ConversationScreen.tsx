import { useState, type KeyboardEvent, type ReactNode } from 'react'
import './conversation.css'
import { toMessageViewModel, type Message } from './messageViewModel'
import {
  useSessionStore,
  selectMessages,
  selectStatus,
  type ConnectionStatus
} from '../../store/sessionStore'
import { submitMessage, composerAvailability, shouldOfferRepair } from './composerSend'
import { runUnpair } from './unpairAction'
import { LogDataSection } from './LogDataSection'

// The conversation shell: a scrollable message thread above a pinned composer,
// styled from the mobile Conversation Thread screen (Figma node 16-8) stretched
// to the window. The thread now reads the live session store (#69); the composer
// stays inert (controlled input + send dispatch are #66).
//
// ConversationScreen is the store-bound container (smoke-tested for "renders without
// throwing"); MessageThread is the pure, props-in/markup-out view that the tests
// server-render with arbitrary Message[] — the same container/view split PairingScreen
// uses. Composer and UnpairControl stay in-file. The load-bearing seam is the MessageThread prop.
export interface ConversationScreenProps {
  // The App route flip back to pairing (#166), mirroring PairingScreen's onPaired. Optional so the
  // existing bare `<ConversationScreen />` server-render tests stay green; when absent, unpair still
  // clears + resets, it just doesn't navigate.
  onUnpaired?: () => void
}

export function ConversationScreen({ onUnpaired }: ConversationScreenProps = {}): JSX.Element {
  // Read the messages slice and adapt each wire MessagePayload to the shell view model
  // at this boundary (ADR 0004). Selecting only the messages slice keeps connection-status
  // changes from re-rendering the thread.
  const messages = useSessionStore(selectMessages).map(toMessageViewModel)
  // #177: the Run configuration sheet's open/closed state — a single-value screen-local boolean →
  // useState, never the store (ADR 0006). It resets to closed on remount for free, so the sheet
  // never reopens itself across a screen remount. The StatusRow trigger sits between the thread and
  // the composer (per Figma); the sheet overlays the whole conversation surface as the last child.
  const [sheetOpen, setSheetOpen] = useState(false)
  return (
    <div className="conversation">
      <UnpairControl onUnpaired={onUnpaired} />
      <MessageThread messages={messages} />
      <StatusRow onExpand={() => setSheetOpen(true)} />
      <Composer />
      <RepairControl onUnpaired={onUnpaired} />
      {sheetOpen && (
        <StatusSheet onClose={() => setSheetOpen(false)}>
          {/* Log data is the last section ("beneath Context-window"); #181/#182 prepend their
              sections above it as they land. */}
          <LogDataSection />
        </StatusSheet>
      )}
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
  const dispatch = useSessionStore((s) => s.dispatch)
  // #31: gate the send control on the live connection status. Selecting `status` re-renders the
  // Composer when it changes, so the control re-enables reactively on connect (AC3) with no reload.
  // The thread selects only `selectMessages`, so status changes don't re-render it.
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
