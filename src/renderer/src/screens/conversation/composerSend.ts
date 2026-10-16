// The composer's submit logic — framework-free and React-free, co-located with the screen
// and mirroring pairingState.ts / messageViewModel.ts: the effects are injected so the helper
// is a pure, deterministic function tested with plain spies (no React, no store, no Electron).
// The React container (ConversationScreen's Composer) is thin glue over this.
import type { MessageLifecycleDiagnostic } from '@shared/ipc/diagnostics'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'

export const COMPOSER_MESSAGE_DELIVERY_COPY = { waiting: 'Waiting for connection', 'not-sent': 'Not sent', 'not-delivered': 'Not delivered' } as const
import type { SendMessagePayload } from '@shared/wire/types'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { MessageAttachment, ThreadEvent } from '../../store/threadTimeline'
import type { createThreadSendStore } from '../../store/threadSendStore'

/**
 * One send's claim on the composer's pending attachments (#1055): the set it took, and the undo that
 * puts them back. The two travel together so a caller cannot hold one without the other.
 *
 * DECLARED HERE, WITH THE CONSUMER, AND NOT BESIDE ITS PRODUCER — the module-level rule this repo
 * already follows for `RelayConnection`. `drainPendingAttachments` in ComposerAttach.tsx is what builds
 * one, but that is a `.tsx` module: importing the type FROM there would make this pure, React-free
 * helper name a React module, and a type-only import that is erased at build time is still an edge a
 * reader has to check. The edge runs the other way instead.
 */
export interface PendingAttachmentTake {
  /** The set this take claimed. Already removed from the composer's holder — reading it consumed it. */
  attachments: readonly MessageAttachment[]
  /** Undo this take, restoring exactly the set above. Called when the send did not go. */
  rollback: () => void
}

/** Captured send ownership and effects. Attachments are claimed only after the no-op guards. */
export interface ComposerSendDeps {
  serverId: string
  threadSend: { store: ReturnType<typeof createThreadSendStore>; deviceId: string | null; version?: number }
  diagnose?: (record: MessageLifecycleDiagnostic) => void
  sendCommand: (command: RendererCommand) => void
  newMessageId: () => string
  now?: () => number
  takeAttachments?: () => PendingAttachmentTake
}

/**
 * Retain one locally unaccepted send before crossing the bridge, so synchronous feedback can find it.
 * A bridge exception preserves recoverable text, marks local feedback and rolls attachments back.
 * Acceptance and exact host/device/message settlement belong to the authoritative send store.
 */
export function submitMessage(
  text: string,
  conversationId: string | null,
  deps: ComposerSendDeps
): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || conversationId === null) return false
  const threadSend = deps.threadSend, host = deps.serverId
  if (!host) return false
  const message_id = deps.newMessageId()
  const take = deps.takeAttachments?.()
  const named = take !== undefined && take.attachments.length > 0 ? take.attachments : undefined
  const payload: SendMessagePayload = {
    conversation_id: conversationId, message_id, text: trimmed,
    attachment_ids: named?.map(attachment => attachment.attachmentId)
  }
  const diagnose = (event: MessageLifecycleDiagnostic['event']): void => {
    try { deps.diagnose?.({ event, messageId: message_id, conversationId }) } catch { /* Observe only. */ }
  }
  diagnose('message-queued')
  // Both identities exist before the bridge can synchronously report delivery.
  const echo: ThreadEvent = { type: 'userText', text: trimmed, messageId: message_id,
    createdAt: deps.now?.(), attachments: named }
  threadSend.store.getState().retain(host, conversationId, threadSend.deviceId, echo)
  try {
    deps.sendCommand(sendMessageCommand(payload, deps.serverId))
    threadSend.store.getState().clearReports(host, conversationId, threadSend.version ?? 0)
    return true
  } catch {
    diagnose('message-bridge-failed')
    take?.rollback()
    const failed: ThreadEvent = { type: 'messageDelivery', messageId: message_id, status: 'not-sent' }
    threadSend.store.getState().feedback(host, conversationId, failed)
    return false
  }
}

/**
 * The three fields of a composer keydown that the submit decision reads. Plain values, no React —
 * the container destructures them off the synthetic event so this stays testable without a DOM.
 */
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  /** `event.nativeEvent.isComposing` — true on every keydown fired while an IME composition is live. */
  isComposing: boolean
}

/**
 * Whether this keydown asks the composer to submit (#512). Enter sends; Shift+Enter inserts a newline;
 * and — the fix — the Enter that COMMITS an IME composition does neither. For a CJK user that commit
 * keydown is ordinary typing: it arrives with `key === 'Enter'` and `shiftKey === false`, so the old
 * handler sent the half-composed text and blanked the input mid-word.
 *
 * The caller must `return` on `false` BEFORE calling `preventDefault()`. Preventing the default on the
 * committing keydown breaks the IME commit itself — the candidate never lands and the user's text is
 * stranded — so "do not submit" has to mean "do not touch the event" too.
 *
 * `isComposing` is the standard signal and it is reliable on the committing keydown in Chromium, which
 * is the only renderer this app has (Electron ^33.2.1). Chromium also sets the legacy `keyCode === 229`
 * on the same event, but one signal identifies the composition; a second would be a defense for a
 * failure mode nobody has observed here.
 *
 * This deliberately does NOT absorb the `canSend` gate. That gate lives in the container's
 * `handleSubmit` and is authoritative for the send button as well as for Enter; #31's contract is that
 * a disconnected Enter is *swallowed* (prevented, nothing sent, input preserved), not turned into a
 * newline. This answers keystroke intent only.
 */
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}

/**
 * Whether this keydown asks the composer to STOP the running turn (#1072). Escape while a turn is running
 * interrupts; Escape at idle does not; and the Escape that cancels an in-progress IME composition never
 * does. Placed here, directly after `shouldSubmitOnKeyDown`, because it reads the same axis — did this
 * keystroke ask for something — and the same record.
 *
 * IT REUSES `ComposerKeyEvent` RATHER THAN MINTING A SECOND RECORD. A near-duplicate interface would buy a
 * new exported type for one dropped field, and would give the container a second shape to destructure at a
 * call site that already builds this one. The two predicates share one destructure and answer two questions.
 *
 * `shiftKey` IS DELIBERATELY NOT READ, even though the record carries it. Escape has no meaningful shifted
 * variant, so a `!shiftKey` clause would be a defence for a failure mode nobody has observed — the same
 * evidence rule that kept the legacy `keyCode === 229` out of the predicate above. composerSend.test.ts pins
 * the non-read with a Shift+Escape case, so adding the clause "for symmetry" reddens rather than ships.
 *
 * `isComposing` IS LOAD-BEARING HERE, and it is not a mirror of the gate above for symmetry either. The
 * slash type-ahead's own handler returns `false` on a composing keystroke EVEN WHILE ITS PANEL IS OPEN
 * (`useSlashCommandTypeAhead`'s handleKeyDown), so the Escape that cancels a half-typed IME candidate falls
 * straight through to the composer's handler. Without this input a CJK operator cancelling a candidate
 * mid-turn would stop the turn.
 *
 * `turnRunning` is a SECOND POSITIONAL ARGUMENT rather than a field of the record, and the split is the
 * point: the record models the keystroke, this models the app's state. Folding them would make the container
 * fabricate a synthetic key-event field, and would make the stop control's call site — where the value is
 * `true` by construction, since that variant only renders while running — read as if the button knew
 * something about the keydown that it does not. It is `isTurnRunning(phase)` at both call sites and never
 * `localSendPending`: that scalar opens the working-indicator window while `phase` is still the daemon-owned
 * `idle` (#650), so wiring it in would arm an interrupt for a turn the daemon has not started — the same
 * reason the stop button ignores it.
 *
 * Like the gate above, this answers keystroke intent ONLY. It does not absorb the connection gate: a
 * running turn on a dropped connection must still offer the stop (ComposerSendButton's second load-bearing
 * property), and `sendInterrupt` already swallows a bridge failure. Unlike the gate above there is nothing
 * for the caller to suppress — Escape has no default action in a textarea — so no `preventDefault()` belongs
 * on this path at all; if one were ever added it would have to sit below a `false` return, the rule
 * `shouldSubmitOnKeyDown`'s docblock states.
 */
export function shouldInterruptOnKeyDown(event: ComposerKeyEvent, turnRunning: boolean): boolean {
  return turnRunning && event.key === 'Escape' && !event.isComposing
}

/**
 * Whether the composer may send (#31). #968 retired the "why" caption that used to travel beside it, so
 * this is a one-field record: the call site already destructures from it, and collapsing it to a bare
 * boolean would rewrite that site for no behavioural gain.
 */
export interface ComposerAvailability {
  canSend: boolean // true only when the session is connected
}

/** Compile-time exhaustiveness guard: a new ConnectionStatus arm without a case is a type error. */
function assertNever(status: never): never {
  throw new Error(`Unhandled connection status: ${JSON.stringify(status)}`)
}

/**
 * Total mapping over ConnectionStatus's four arms. Pure — no store, no React, no I/O — so the
 * send/no-send decision (AC1) is unit-testable without a DOM, the same reason submitMessage is pure.
 * This is a UX affordance, not a safety net: the deterministic no-throw safety on a disconnected send
 * already lives in #65's daemonConnection.send() and #66's guarded sendCommand — this only governs what
 * the composer shows.
 *
 * Since #968 it reads `status.type` and nothing else: the three captions it used to return are gone with
 * the element that rendered them, so no string leaves this function and `status.error` is never touched.
 * The exhaustive switch stays — a total mapping is still what this is, and a future fifth arm must be a
 * compile error here rather than a silently-sendable state.
 */
export function composerAvailability(status: ConnectionStatus): ComposerAvailability {
  switch (status.type) {
    case 'connected':
      return { canSend: true }
    case 'connecting':
      return { canSend: false }
    case 'disconnected':
      return { canSend: false }
    case 'error':
      return { canSend: false }
    default:
      return assertNever(status)
  }
}

/** The host's daemon lacks `thread` (#1908): its copy names the daemon, never this app. */
export function isDaemonUpdateRequired(status: ConnectionStatus | undefined): boolean {
  return status?.type === 'error' && status.error.code === 'update-required' && status.error.cause === 'daemon'
}

/** Client-owned copy for that state; no download link, since the app is not what needs updating. */
export const DAEMON_UPDATE_REQUIRED_COPY = 'The Pyrycode daemon on this host needs an update. Update pyry on the host to reconnect.'

/** Only an explicit pairing rejection establishes that re-pairing can help. */
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code === 'pairing-rejected'
}

/** Other terminal failures can redial a saved host; failed removal and absent pairing cannot. */
export function shouldOfferReconnect(status: ConnectionStatus): boolean {
  return (
    status.type === 'error' && !status.error.retryable &&
    status.error.code !== 'pairing-rejected' &&
    status.error.code !== 'unpair' && status.error.code !== 'not-paired'
  )
}

/**
 * The connection banner's copy (#279) — a single, exported, module-level client-owned string. This is
 * the banner's ENTIRE text; it is never derived from `status`, so AC3 ("no daemon-supplied string is
 * rendered as the banner text") is a structural guarantee, not a convention (the EMPTY_THREAD_COPY /
 * ThinkingIndicator label idiom). It is deliberately lexically distinct from the status row's two strings
 * (`Host connection down!` #797, `Pairing error - Re-pair` #963) — it leads with "Cannot reach" and
 * shares no leading words — so the prominent banner and the row directly above the message box never read
 * as the same string stacked twice (AC5). Until #968 that set also held the three composer captions; they
 * are retired, and this banner is now the ONLY thing said in the `connecting` and `disconnected` arms.
 * A single constant, not a per-arm map: every non-connected arm is a state where pyry is unreachable, so
 * one sentence covers all three honestly (no "restored"/"lost" temporal claim), and a three-way copy split
 * would be three ways to say one fact. It is a client-owned constant, so PO/design may tune the wording;
 * the load-bearing contract is (a) one client-owned constant, (b) lexically distinct from the status row's
 * strings, (c) zero daemon-supplied substring. Apostrophe-free by design
 * — the EMPTY_THREAD_COPY / `Thinking…` convention — so a server-rendered `toContain` assertion matches
 * it verbatim (renderToStaticMarkup escapes `'` → `&#x27;`).
 */
export const CONNECTION_BANNER_COPY =
  'Cannot reach pyrybox — your messages will not send until the connection is back.'

/**
 * Whether the prominent, disconnected-only connection banner should show (#279) — the third,
 * independent read of the single `ConnectionStatus` slice, beside `composerAvailability` (the composer's
 * send gate) and `shouldOfferRepair` (the terminal-error escape hatch). True for every
 * non-connected arm (`disconnected` | `connecting` | `error`), false only when `connected` (AC1/AC2).
 *
 * Expressed as `!== 'connected'` rather than an exhaustive switch/assertNever (composerAvailability's
 * shape): unlike that gate — where each arm maps to different copy, so it must enumerate — every
 * non-connected arm maps to the SAME behavior (show the banner), so "show unless connected" is the
 * honest shape. Its fail-mode is correct too: a hypothetical future 5th `ConnectionStatus` arm would
 * default to SHOWING the not-connected band — the safe direction (over-showing a "not connected" banner
 * beats silently hiding it).
 */
export function shouldShowBanner(status: ConnectionStatus): boolean {
  return status.type !== 'connected'
}

/**
 * The composer status row's error-chip copy (#797) — the chip's ENTIRE visible text, and one of the three
 * strings this module owns about the single `ConnectionStatus` fact (this, CONNECTION_BANNER_COPY and
 * COMPOSER_REPAIR_BUTTON_COPY; #968 retired the three `composerAvailability` captions that used to sit
 * beside them). It lives here rather than as a module-level constant in ConversationScreen.tsx (where
 * THINKING_COPY / STALL_COPY live), precisely so the lexical distinctness those three owe each other is
 * reviewable in one place.
 *
 * It carries CONNECTION_BANNER_COPY's three-part contract verbatim: (a) one client-owned constant,
 * (b) lexically distinct from the banner copy — it leads with "Host" and shares no leading word with
 * `Cannot reach pyrybox…`; its distinctness from the button that replaces it in the same slot is argued
 * in COMPOSER_REPAIR_BUTTON_COPY's own docblock below — and (c) zero daemon-supplied substring. (c) is
 * structural rather than conventional here too: ComposerErrorChip narrows on `status.type` and never
 * destructures `status.error`, so no ConnectionError field has a rendering path to escape, length-bound
 * or newline-strip. Apostrophe-free by design (renderToStaticMarkup escapes `'` → `&#x27;`, the standing
 * desktop lesson), so a server-rendered `toContain` matches it verbatim. PO/design may tune the wording
 * — the contract is load-bearing, the exact words are not; the exclamation mark is the mock's.
 */
export const COMPOSER_ERROR_CHIP_COPY = 'Host connection down!'

/**
 * The error chip's assistive-technology marking (#797, AC4) — rendered as visually hidden TEXT inside
 * the chip, ahead of COMPOSER_ERROR_CHIP_COPY, so the chip's error nature does not rest on its colour
 * alone. Hidden text rather than an `aria-label`, because a bare <div>/<span> maps to role="generic",
 * which ARIA 1.2 puts on the name-prohibited list — an aria-label there asserts green in a markup test
 * and is dropped by a real screen reader. See ComposerErrorChip's own comment.
 *
 * THE TRAILING SPACE IS LOAD-BEARING. It is the entire separator between the two runs when a screen
 * reader concatenates them into "Error: Host connection down!"; an editor's trim silently degrades the
 * announcement. composerSend.test.ts pins it. Client-owned and apostrophe-free like its sibling above.
 */
export const COMPOSER_ERROR_CHIP_PREFIX_COPY = 'Error: '

/**
 * The actionable-error button's label (#963) — the button that takes the chip's slot whenever
 * `shouldOfferRepair` is true, and the third of the strings this module owns about the single
 * `ConnectionStatus` fact. It lives here for COMPOSER_ERROR_CHIP_COPY's stated reason, which transfers
 * verbatim: the lexical distinctness these three owe each other is only reviewable if they sit together.
 *
 * The design's label pattern is "Type of error - Action", and both halves are load-bearing. The type is
 * what lets this occupant drop the chip's visually-hidden `Error: ` prefix — that prefix exists because
 * "Host connection down!" does not say it is an error, and "Pairing error" does. The action is what makes
 * the control read as a button rather than as a status. Since the button carries no `aria-label`, this
 * string is also the accessible name, which is the first time one of these three is both.
 *
 * It carries CONNECTION_BANNER_COPY's three-part contract: (a) one client-owned constant, (b) lexically
 * distinct from the two strings above — it leads with "Pairing" and shares no leading word with
 * `Host connection down!` or `Cannot reach pyrybox…` — and (c) zero daemon-supplied substring. The chip
 * copy is in that set even though the two never render together: they occupy the SAME slot, so a reader
 * who sees one and then the other must not read them as one string. (c) needs stating more carefully here than
 * for the chip: ComposerErrorChip narrows on `status.type` and never touches the error arm at all, while
 * this button's gate (`shouldOfferRepair`) READS `status.error.retryable` and `.code`. Those reads decide
 * a boolean and reach no markup — ConversationScreen's ComposerErrorSlot binds no local to `status.error`
 * — and ConversationScreen.test.tsx pins that with sentinel values on the button's own arm.
 *
 * Apostrophe-free by design (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson),
 * and the separator is an ASCII hyphen-minus for the same reason, so a server-rendered `toContain`
 * matches it verbatim. PO/design may tune the wording; the contract is load-bearing, the exact words are
 * not.
 */
export const COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'

/** Client-owned visible and accessible label; error fields never supply button content. */
export const COMPOSER_RECONNECT_BUTTON_COPY = 'Connection error - Reconnect'
